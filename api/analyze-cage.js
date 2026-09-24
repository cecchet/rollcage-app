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
// it was never worth asking about at all. Later testing against a real
// installed-cage photo (a door bar with a visible mid-span bend/weld joint
// and a gusset plate at each end mount) showed the model picking "253-10"
// instead of 253-9, and the A-pillar bar's own end-mount gussets being
// read as "continuous" instead of "two_bars" -- both hints below now
// explicitly separate normal END-mount gussets (present on any design)
// from the specific MID-SPAN joint/gusset that's the actual deciding
// signal, and call out that 253-10 is rare and needs a distinct
// horizontal top rail, not just "some kind of diagonal shape". Later
// testing found the model always picking "253-12" for roof bars and never
// "253-22" for backstay diagonals, even against an obvious 253-14/253-22
// V-shaped cage (diagram and photos both) -- the likely cause is that
// rules-data.js's own element descriptions are compliance ADVICE for a
// human builder ("Pick 253-12 or 253-14", "253-20 is the compulsory
// baseline"), which gets sent verbatim as part of the catalog text
// (buildCatalogText below) and reads to the model like an instruction to
// default to whichever option that prose names first/calls the baseline,
// regardless of what's actually in the photo. Both hints below now
// explicitly call this out and tell the model to ignore that prose for
// identification purposes. Keep these in sync with rules-data.js's own
// option ids if those ever change.
const ELEMENT_HINTS = {
  main_structure_layout:
    "253-1/253-2/253-3 are genuinely hard to tell apart from a photo alone -- the real distinguishing detail is where/how the front and lateral sections are welded together, which a typical photo doesn't show clearly. Your best guess should usually be either \"253-3\" (main rollbar + two lateral half rollbars -- by far the most common design) or \"half-rollcage\" (main rollbar + backstays only, nothing forward at all) -- pick between those two unless you clearly see either: a distinct, separately-braced front hoop with its own uprights (253-1), or two full floor-to-roof vertical hoops at both the front AND rear of the cabin (253-2). Low confidence is expected and fine here; this is best attempted from a whole-cage overview or diagram, not a close-up.",
  roof_bars:
    "IMPORTANT: this item's own description above (\"Pick 253-12 or 253-14\") is compliance advice for a human BUILDING a cage, not an instruction for you -- it does not mean you should default to 253-12. Identify purely from the roof's actual visible shape. 253-12 is a full X spanning corner-to-corner across the ENTIRE roof: one long diagonal running all the way from one front corner to the OPPOSITE rear corner, crossed by another bar doing the same the other way (pick \"253-12-1\" or \"253-12-2\", either is fine if you can't tell which tube is continuous). 253-14 is a V/chevron shape instead: TWO separate bars, each running from a FRONT corner back to a shared peak at the CENTER of the roof -- they do NOT reach the opposite rear corner. If the bars stop at a center peak rather than crossing all the way to the far corner, that is \"253-14\", not 253-12 -- do not default to 253-12 just because it's listed first or recommended for compliance. \"253-13\" has no front roof corner support at all (rare and deficient -- only pick it if the front corners are specifically unsupported). A single bar reaching only one point = one of the \"single-...\" options.",
  main_hoop_diagonals:
    "Look at the main rollbar (the rearmost/tallest hoop) for diagonal bracing between its two legs. Two straight bars crossing in a clear X = \"253-7-1\" or \"253-7-2\" (pick either if you can't tell which tube is the continuous one -- it doesn't matter which). Anything else is one of 5 other configurations, captured for identification (none of these satisfy the X-brace rule): a single diagonal from top-left to bottom-right = \"diag-left\"; a single diagonal from top-right to bottom-left = \"diag-right\"; one horizontal bar straight across = \"diag-horizontal\"; two short bars each only spanning the lower half = \"diag-lower-half\"; a V/chevron shape meeting at the center = \"diag-v-center\". If the main rollbar is clearly visible and has no bracing bar between its legs at all = \"none\" -- but omit the item rather than answer \"none\" if the hoop's lower area isn't clearly in frame.",
  backstay_diagonals:
    "IMPORTANT: this item's own description above calls 253-20 \"the compulsory baseline\" -- that is compliance guidance for a human BUILDING a cage (253-20 is the minimum acceptable design), not an instruction for you to default your answer to it. Identify purely from what the photo actually shows. Look at the two backstays (the bars running rearward from the main rollbar's top bends) for a diagonal brace between them, usually visible from a rear-interior or rear-3/4 angle. A single diagonal bar between the two backstays = \"253-20\" (top end on the left backstay) or \"253-20-right\" (top end on the right backstay) -- pick whichever side the diagonal's top end is actually on. Two bars crossing in an X between the backstays = \"253-21-1\" or \"253-21-2\" (pick either if you can't tell which tube is continuous). A V/chevron shape where two bars meet at a shared CENTER point = \"253-22\" (this one pairs with a center-peak/253-14 roof bar design, if that's also visible) -- do not default to 253-20 just because it's called the baseline; pick 253-22 whenever that V shape is actually visible. Do not guess \"none\" just because the angle is unclear -- omit the item instead if you can't tell whether a diagonal is present at all.",
  a_pillar_reinforcement:
    "This is the windscreen-pillar/A-pillar bar running from the front rollbar's top down to the front floor/foot, alongside the windscreen opening. A gusset plate at each of its two END mounts (top and bottom) is normal for EITHER design -- that alone is not evidence of anything. The deciding signal is whether there's an ADDITIONAL gusseted joint somewhere in the MIDDLE of the run: a separate plate connecting two tube segments partway down, not at either end. If you see that mid-span joint, it's built as 2 bars meeting there = \"two_bars\". If the tube runs unbroken for its full length with no joint in the middle (only the two end gussets, or no gussets at all) = \"continuous\". Do not default to \"continuous\" just because gussets are visible -- check specifically for one in the MIDDLE of the span, not just at the ends.",
  lower_main_hoop_bar_present:
    "253-30 is a rare, optional bar running straight across the BOTTOM of the main rollbar, low near the floor -- most cages do not have one. Only answer \"yes\" if you can clearly and unambiguously see a bar spanning the main hoop's two legs down near the floor; otherwise OMIT this item entirely rather than guessing \"no\" or \"yes\" -- do not answer just because the item is in the list.",
  door_bars_left:
    "Look for a JOINT roughly midway along the bar span between the door sill and the upper pillar/main-hoop mount -- a visible weld bead or kink where two tube segments meet at an angle, not just at the two end mounts. That midway joint (whether the tubes form a true crossing X, or just bend to meet there without truly crossing) is the hallmark of 253-9: two bars crossing in a clear X = \"253-9-intersection-1\" or \"253-9-intersection-2\" (pick either if you can't tell which tube is continuous); two bars that bend to meet at that midpoint rather than crossing = \"253-9-bent\". Gusset plates at BOTH the top and bottom end mounts are also normal for 253-9 -- don't mistake those END gussets for \"253-10\". 253-10 is a RARE design and specifically requires a distinct, clearly HORIZONTAL bar running along the TOP of the door opening (roughly parallel to the sill/floor), with a separate diagonal meeting it only at the corners -- no bend or crossing joint partway down. Only pick \"253-10\" if that horizontal top bar is actually visible; a diagonal-only shape with a joint mid-span is 253-9, not 253-10, no matter how that joint looks. Two bars that run roughly PARALLEL, not crossing or bending together = \"253-11\". Only pick \"nascar\" for a visibly more complex multi-bar arrangement (usually 3+ bars with extra bracing) typical of oval-track cars -- an X or bent-bar shape is 253-9, not NASCAR, and should not default to \"none\" just because you're unsure which exact 253-9 sub-variant it is.",
  door_bars_right:
    "Look for a JOINT roughly midway along the bar span between the door sill and the upper pillar/main-hoop mount -- a visible weld bead or kink where two tube segments meet at an angle, not just at the two end mounts. That midway joint (crossing X, or just bending to meet there) is the hallmark of 253-9: a clear X = \"253-9-intersection-1\" or \"253-9-intersection-2\" (pick either if you can't tell which tube is continuous); a bend rather than a true crossing = \"253-9-bent\". Gusset plates at BOTH end mounts are normal for 253-9 too -- don't mistake those for \"253-10\". 253-10 is a RARE design requiring a distinct, clearly HORIZONTAL bar along the TOP of the door opening, with a separate diagonal meeting it only at the corners -- no mid-span joint. Only pick \"253-10\" if that horizontal top bar is actually visible; a diagonal-only shape with a mid-span joint is 253-9, not 253-10. Roughly PARALLEL bars, not crossing or bending together = \"253-11\". Only pick \"nascar\" for a visibly more complex multi-bar arrangement (usually 3+ bars) typical of oval-track cars -- an X or bent-bar shape is 253-9, not NASCAR, even if you're unsure which exact sub-variant.",
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
