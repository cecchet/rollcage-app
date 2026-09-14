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

function buildCatalogText(elements) {
  return elements
    .map((e, i) => {
      const opts = e.boolean
        ? "options: \"yes\" (present) / \"no\" (absent)"
        : "options: " + (e.options || []).map((o) => `"${o.id}" = ${o.label}`).join("; ");
      return `${i + 1}. id="${e.id}" -- ${e.name}. ${e.description || ""} ${opts}`;
    })
    .join("\n");
}

function buildPrompt(elements) {
  return [
    "You are helping pre-fill a rollcage (roll cage) inspection checklist from photos of an installed roll cage, or a cage blueprint/diagram.",
    "Multiple photos may show the same cage from different angles -- combine information across all of them before answering; a bar that's unclear in one photo may be obvious in another.",
    "For each checklist item below, decide which single option (by its exact id string) is clearly visible in the photos. If you cannot tell, or the item simply isn't visible/determinable from any photo, OMIT that item from your answer entirely -- do not guess just to fill every item.",
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
