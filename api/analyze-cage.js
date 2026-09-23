// Vercel serverless function -- proxies a rollcage photo-analysis request to
// Gemini's vision API. GEMINI_API_KEY lives only here (a Vercel environment
// variable), never in client-side code, so it's never exposed in the
// browser. Zero npm dependencies (uses the platform's built-in fetch) so
// this stays a near-static deploy with one added function, not a full Node
// build -- no package.json needed.
//
// Request body (JSON): { images: [{mimeType, data (base64, no data: prefix)}],
//                        elements: [{id, name, description, options?:[{id,label}], boolean?:true}] }
// Response body (JSON): { suggestions: [{elementId, value, confidence, rationale}] }
//   or, on failure: { error: "...", detail?: "..." }
//
// Same model PassTech (a sibling project) already uses successfully with
// Gemini's free tier.
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Same 2-key pattern as PassTech: GEMINI_API_KEY is a free-tier key (used
// first, at no cost); GEMINI_API_KEY_PAID is an optional tier-1 (paid) key
// that only gets used as a fallback once the free tier's quota is
// exhausted for the day/minute (Gemini returns 429, or occasionally 503
// when the free tier is under heavy load). If only one of the two is set,
// this still works -- it just has no fallback.

// Extra vision-specific guidance per element, keyed by id -- appended to
// that element's catalog line only when it's actually in the request.
// Added after real-world testing showed the model struggling with these
// specific items even from clear photos: it couldn't tell 253-1/2/3 apart
// (they mostly differ in places a typical photo doesn't show), it kept
// misreading an obvious 253-9 X-brace as "nascar" or "none", and it was
// guessing on 253-25 (which usually just isn't in frame at all) instead of
// omitting it -- 253-25 (anti_intrusion_present) is now excluded from the
// request entirely rather than hinted (see app.js's AI_NEVER_IDS), since
// it was never worth asking about at all. Keep these in sync with
// rules-data.js's own option ids if those ever change.
const ELEMENT_HINTS = {
  main_structure_layout:
    "253-1/253-2/253-3 are genuinely hard to tell apart from a photo alone -- the real distinguishing detail is where/how the front and lateral sections are welded together, which a typical photo doesn't show clearly. Your best guess should usually be either \"253-3\" (main rollbar + two lateral half rollbars -- by far the most common design) or \"half-rollcage\" (main rollbar + backstays only, nothing forward at all) -- pick between those two unless you clearly see either: a distinct, separately-braced front hoop with its own uprights (253-1), or two full floor-to-roof vertical hoops at both the front AND rear of the cabin (253-2). Low confidence is expected and fine here; this is best attempted from a whole-cage overview or diagram, not a close-up.",
  main_hoop_diagonals:
    "Look at the main rollbar (the rearmost/tallest hoop) for diagonal bracing between its two legs. Two straight bars crossing in a clear X = \"253-7-1\" or \"253-7-2\" (pick either if you can't tell which tube is the continuous one -- it doesn't matter which). Anything else is one of 5 other configurations, captured for identification (none of these satisfy the X-brace rule): a single diagonal from top-left to bottom-right = \"diag-left\"; a single diagonal from top-right to bottom-left = \"diag-right\"; one horizontal bar straight across = \"diag-horizontal\"; two short bars each only spanning the lower half = \"diag-lower-half\"; a V/chevron shape meeting at the center = \"diag-v-center\".",
  backstay_diagonals:
    "Look at the two backstays (the bars running rearward from the main rollbar's top bends) for a diagonal brace between them, usually visible from a rear-interior or rear-3/4 angle. A single diagonal bar between the two backstays = \"253-20\" (top end on the left backstay) or \"253-20-right\" (top end on the right backstay) -- pick whichever side the diagonal's top end is actually on. Two bars crossing in an X between the backstays = \"253-21-1\" or \"253-21-2\" (pick either if you can't tell which tube is continuous). A V/chevron shape meeting at the center = \"253-22\" (this one pairs with a single-center-peak roof bar design, if that's also visible). Do not guess \"none\" just because the angle is unclear -- omit the item instead if you can't tell whether a diagonal is present at all.",
  a_pillar_reinforcement:
    "This is the windscreen-pillar/A-pillar bar running from the front rollbar's top down to the front floor/foot, alongside the windscreen opening. Count the gussets (bracing plates) visible along its length in side view: essentially one gusset or none at all (just plain welds) = \"continuous\" (1 continuous bar); two (or more) clearly separate gusseted joints partway down = \"two_bars\" (built as 2 bars meeting the door bar). If no gusset is clearly visible either way, default to \"continuous\" -- it's the more common build.",
  lower_main_hoop_bar_present:
    "253-30 is a rare, optional bar running straight across the BOTTOM of the main rollbar, low near the floor -- most cages do not have one. Only answer \"yes\" if you can clearly and unambiguously see a bar spanning the main hoop's two legs down near the floor; otherwise OMIT this item entirely rather than guessing \"no\" or \"yes\" -- do not answer just because the item is in the list.",
  door_bars_left:
    "Look carefully at the shape between the main hoop/A-pillar and the door sill on the LEFT/driver-typical side: two bars crossing in a clear X pattern = \"253-9-intersection-1\" or \"253-9-intersection-2\" (pick either if you can't tell which tube is continuous) or \"253-9-bent\" if the two bars bend rather than cross at a single point. A single diagonal plus a horizontal bar forming a triangle (not an X) = \"253-10\". Two bars that run roughly PARALLEL to each other, not crossing = \"253-11\". Only pick \"nascar\" if you see a visibly different, more complex multi-bar arrangement typical of oval-track cars (usually 3+ bars with extra bracing), not just a simple X or parallel pair -- an X-brace is 253-9, not NASCAR, and should not default to \"none\" just because you're unsure which exact 253-9 sub-variant it is.",
  door_bars_right:
    "Same guidance as the left side's door bar design -- look for the X-brace (253-9), triangle (253-10), parallel double bars (253-11), or a visibly more complex multi-bar NASCAR-style arrangement. An X-brace is 253-9, not NASCAR or none, even if you can't tell exactly which 253-9 sub-variant it is.",
  door_bars_left__sill_bar:
    "A sill bar runs low and roughly horizontal along the bottom of the door opening, near the rocker panel/sill -- distinct from (and below) the main door bar design above it. Only answer if this side's lower sill area is actually visible; omit otherwise rather than guessing \"no\".",
  door_bars_right__sill_bar:
    "Same guidance as the left side's sill bar -- a low, roughly horizontal bar along the door sill, distinct from the main door bar design. Omit if that area isn't visible rather than guessing \"no\".",
};

function buildCatalogText(elements) {
  return elements
    .map((e, i) => {
      const opts = e.boolean
        ? "options: \"yes\" (present) / \"no\" (absent)"
        : "options: " + (e.options || []).map((o) => `"${o.id}" = ${o.label}`).join("; ");
      const hint = ELEMENT_HINTS[e.id] ? " HINT: " + ELEMENT_HINTS[e.id] : "";
      return `${i + 1}. id="${e.id}" -- ${e.name}. ${e.description || ""} ${opts}${hint}`;
    })
    .join("\n");
}

function buildPrompt(elements) {
  return [
    "You are helping pre-fill a rollcage (roll cage) inspection checklist from photos of an installed roll cage, or a cage blueprint/diagram.",
    "Multiple photos may show the same cage from different angles -- combine information across all of them before answering; a bar that's unclear in one photo may be obvious in another.",
    "For each checklist item below, decide which single option (by its exact id string) is clearly visible in the photos. If you cannot tell, or the item simply isn't visible/determinable from any photo, OMIT that item from your answer entirely -- do not guess just to fill every item. Some structural elements only show up in a photo aimed at that specific area of the car; if none of the provided photos cover that area, omit the item rather than assuming it's absent.",
    "",
    "Checklist items:",
    buildCatalogText(elements),
    "",
    'Respond with a JSON object matching the provided schema. For each item you include, "value" must be exactly one of that item\'s option id strings (or "yes"/"no" for boolean items) -- never invent a new id. Give a one-sentence "rationale" describing what you actually saw that supports this, and a "confidence" of "low", "medium", or "high".',
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          value: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          rationale: { type: "string" },
        },
        required: ["elementId", "value", "confidence", "rationale"],
      },
    },
  },
  required: ["suggestions"],
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKeys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_PAID].filter(Boolean);
  if (!apiKeys.length) {
    res.status(500).json({ error: "Neither GEMINI_API_KEY nor GEMINI_API_KEY_PAID is configured on the server. Add at least one under the Vercel project's Settings -> Environment Variables, then redeploy." });
    return;
  }

  let body;
  try {
    body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch (e) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const images = Array.isArray(body.images) ? body.images : [];
  const elements = Array.isArray(body.elements) ? body.elements : [];
  if (!images.length) {
    res.status(400).json({ error: "No images provided" });
    return;
  }
  if (!elements.length) {
    res.status(400).json({ error: "No checklist elements provided" });
    return;
  }

  const parts = [{ text: buildPrompt(elements) }];
  images.forEach((img) => {
    if (img && img.data && img.mimeType) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    }
  });

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  // Try each key in order (free tier first), only falling through to the
  // next one on a quota-exhausted-style error -- a genuine bad-request/auth
  // error shouldn't be retried with a different key, since it'll just fail
  // the same way again.
  let geminiStatus = null;
  let rawText = null;
  let lastErr = null;
  for (let i = 0; i < apiKeys.length; i++) {
    try {
      const geminiRes = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKeys[i] },
        body: JSON.stringify(requestBody),
      });
      geminiStatus = geminiRes.status;
      rawText = await geminiRes.text();
      if (geminiRes.ok) break;
      const isQuotaError = geminiRes.status === 429 || geminiRes.status === 503;
      if (!(isQuotaError && i < apiKeys.length - 1)) break;
    } catch (e) {
      lastErr = e;
      if (i === apiKeys.length - 1) {
        res.status(502).json({ error: "Failed to reach Gemini API: " + e.message });
        return;
      }
    }
  }
  if (geminiStatus === null) {
    res.status(502).json({ error: "Failed to reach Gemini API: " + (lastErr ? lastErr.message : "unknown error") });
    return;
  }
  if (geminiStatus < 200 || geminiStatus >= 300) {
    res.status(geminiStatus).json({ error: "Gemini API error", detail: rawText.slice(0, 4000) });
    return;
  }

  let geminiJson;
  try {
    geminiJson = JSON.parse(rawText);
  } catch (e) {
    res.status(502).json({ error: "Gemini returned a non-JSON response", detail: rawText.slice(0, 4000) });
    return;
  }

  const candidate = geminiJson.candidates && geminiJson.candidates[0];
  const textOut = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!textOut) {
    res.status(502).json({ error: "Unexpected Gemini response shape", detail: JSON.stringify(geminiJson).slice(0, 4000) });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch (e) {
    res.status(502).json({ error: "Gemini's output wasn't valid JSON", detail: textOut.slice(0, 4000) });
    return;
  }

  res.status(200).json({ suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [] });
};
