// POST /api/generate
// Body (JSON): { passcode, details?, files: [{ name, type, data /* base64 */ }] }
// Streams Claude's reply (the deck JSON) back as plain text.
// Needs Vercel environment variables:
//   ANTHROPIC_API_KEY   - your Claude API key
//   FLASHCARD_PASSCODE  - the passcode friends type in the app
//   ANTHROPIC_MODEL     - optional, defaults to claude-sonnet-5-5
const crypto = require("crypto");

const MAX_CARDS = 150;
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 3.2 * 1024 * 1024; // raw bytes; base64 + JSON must stay under Vercel's 4.5 MB body limit
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);

// Soft per-instance limit; the real safeguard is a monthly spend limit in the Anthropic console.
const recent = [];
const PER_HOUR = 20;

const PROMPT = `Make study flashcards from the notes, slides or past papers attached.

Reply with ONLY valid JSON (no other text, no code fences) in exactly this shape:
{
  "name": "Full course name",
  "short": "Short name (max 25 characters)",
  "exam": "YYYY-MM-DD",
  "sectionWord": "Chapter",
  "sections": { "1": "First chapter title", "2": "Second chapter title" },
  "cards": [
    { "section": 1, "type": "recall", "q": "Question", "a": "Answer" },
    { "section": 2, "type": "calc", "q": "Question with all the data it needs", "a": "<div class=\\"math\\">$$\\\\begin{aligned} x &= ... \\\\\\\\ &= \\\\boxed{...} \\\\end{aligned}$$</div>", "hint": "optional nudge", "tip": "optional exam tip", "source": "optional, e.g. Past paper 2024 Q3", "ref": "where in the material", "group": "optional", "part": 1 }
  ]
}

Rules:
- At most ${MAX_CARDS} cards. Scale the number to the material: short notes need fewer cards. Cover every topic; prioritise what is most likely to be examined.
- "type" is one of: recall (facts, lists, definitions), explain (discuss/compare/why), calc (worked numerical problems), formula (state an equation and define its terms).
- If past papers are included, mirror their command words ("Identify", "Discuss", "Calculate", "Sketch") and include their questions with model answers, setting "source".
- Phrase questions the way an exam would ask them. Keep answers concise, accurate and in the course's own terms. Use only facts supported by the material.
- Every answer must come from the attached material. Add "ref" saying where (e.g. "Lecture 3 slides, Darcy's law" or "Notes §4.2").
- "a" can be plain text or simple HTML: <b>, <i>, <p>, <br>, <ul><li>, <ol><li>, <table><tr><td>.
- Write ALL maths in LaTeX so it displays as proper equations: inline as $V = f\\lambda$, and worked steps as <div class="math">$$\\begin{aligned} d &= \\frac{V \\times TWT}{2} \\\\ &= \\boxed{400\\ \\text{m}} \\end{aligned}$$</div>. Box final answers with \\boxed{}. Escape backslashes for JSON.
- For calc cards, show the full working, state assumptions, and double-check the arithmetic. Each card must make sense on its own: restate any data it needs.
- For multi-part questions, give every part the same "group" (e.g. "Q3") and a "part" number (1, 2, 3…) so they stay together in order.
- "exam", "hint", "tip", "source", "ref", "group" and "part" are optional; leave out anything you don't know. Never invent an exam date.
- Output must be valid JSON: plain double quotes, and escape quotes and backslashes inside strings.`;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function fail(res, status, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Use POST.");
  const key = process.env.ANTHROPIC_API_KEY;
  const pass = process.env.FLASHCARD_PASSCODE;
  if (!key || !pass) return fail(res, 503, "Card making isn't set up yet: the site owner needs to add ANTHROPIC_API_KEY and FLASHCARD_PASSCODE in Vercel.");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") return fail(res, 400, "Couldn't read the upload.");
  if (!safeEqual(body.passcode, pass)) return fail(res, 401, "Wrong passcode.");

  const now = Date.now();
  while (recent.length && now - recent[0] > 3600e3) recent.shift();
  if (recent.length >= PER_HOUR) return fail(res, 429, "Too many decks made in the last hour. Try again later.");

  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return fail(res, 400, "Add at least one file.");
  if (files.length > MAX_FILES) return fail(res, 400, `Upload at most ${MAX_FILES} files at a time.`);

  const content = [];
  let total = 0;
  for (const f of files) {
    const type = String(f.type || "").toLowerCase();
    const data = String(f.data || "");
    total += Math.floor(data.length * 3 / 4);
    if (total > MAX_TOTAL_BYTES) return fail(res, 413, "Those files are too big together (about 3 MB max). Split them and make two decks.");
    const name = String(f.name || "file").slice(0, 100);
    if (type === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: name });
    } else if (IMAGE_TYPES.has(type)) {
      content.push({ type: "image", source: { type: "base64", media_type: type, data } });
    } else if (TEXT_TYPES.has(type) || /\.(txt|md|csv)$/i.test(name)) {
      const text = Buffer.from(data, "base64").toString("utf8");
      content.push({ type: "text", text: `File "${name}":\n${text}` });
    } else {
      return fail(res, 415, `"${name}" isn't supported. Use PDF, a photo, or a text file (export Word/PowerPoint as PDF first).`);
    }
  }
  const details = String(body.details || "").slice(0, 500).trim();
  content.push({ type: "text", text: PROMPT + (details ? `\n\nExtra details from the student (course, exam date, focus): ${details}` : "") });

  recent.push(now);

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 32000,
        stream: true,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (e) {
    return fail(res, 502, "Couldn't reach Claude. Try again in a minute.");
  }
  if (!upstream.ok) {
    let msg = `Claude returned an error (${upstream.status}).`;
    try { const j = await upstream.json(); if (j && j.error && j.error.message) msg += " " + j.error.message; } catch (e) {}
    return fail(res, upstream.status === 401 ? 500 : 502, msg);
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = event.split("\n").find(l => l.startsWith("data:"));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") res.write(ev.delta.text);
        else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason === "max_tokens") res.write("\n[[ERROR:The deck got too long to finish. Try fewer or shorter files.]]");
        else if (ev.type === "error") res.write("\n[[ERROR:" + ((ev.error && ev.error.message) || "Claude stopped unexpectedly.") + "]]");
      }
    }
  } catch (e) {
    res.write("\n[[ERROR:The connection to Claude dropped. Try again.]]");
  }
  res.end();
};
