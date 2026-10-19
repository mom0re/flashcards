# Swipe Study Cards: deck format

Live app: https://flashcards-dun-ten.vercel.app

## Two kinds of deck
- **Built-in decks** (everyone sees them): a JSON file in `decks/`, listed in `decks/index.json`.
- **Your own decks** (only you see them): in the app, open the deck menu, tap **Add your own deck**, copy the AI prompt, and paste the AI's reply back in. Up to 150 cards per deck. These are saved in that phone's browser only.

Study progress is never saved: it resets on refresh or after 3 hours idle.

## Deck JSON
```json
{
  "name": "Introduction to Petroleum Engineering",
  "short": "Petroleum (G10UG)",
  "exam": "2026-10-27",
  "sectionWord": "Chapter",
  "sections": { "1": "Field development", "2": "Petroleum geoscience" },
  "cards": [
    { "section": 1, "type": "recall", "q": "Question", "a": "Answer (plain text or simple HTML)" },
    { "section": 2, "type": "calc", "q": "…", "a": "<div class=\"math\">$$\\begin{aligned} d &= \\frac{V \\times TWT}{2} \\\\ &= \\boxed{400\\ \\text{m}} \\end{aligned}$$</div>",
      "hint": "optional", "tip": "optional exam tip", "source": "optional, e.g. Past paper 2025 Q3",
      "ref": "Ch 3 notes, §6", "group": "pp25-q1", "part": 1 }
  ]
}
```
- `type`: `recall`, `explain`, `calc` or `formula`.
- Maths is LaTeX, rendered with KaTeX: inline `$V = f\lambda$`, worked steps as `<div class="math">$$\begin{aligned} … \end{aligned}$$</div>`, final answers in `\boxed{}`. In JSON, backslashes are doubled.
- `ref`: where the answer comes from in the source material (shown under the answer).
- `group` + `part`: parts of one multi-part question share a `group` and are numbered by `part`; they always appear together, in order, even when shuffled. Each part should still restate the data it needs.
- Only `cards[].q` and `cards[].a` are required.
- Imported decks are limited to simple HTML (b, i, p, br, lists, tables, `eq`/`res` classes); scripts and links are stripped.

## Adding a built-in deck
1. Save the deck as `decks/<id>.json`.
2. Add `{ "id": "<id>", "file": "decks/<id>.json" }` to `decks/index.json`.
3. Commit to `main`; Vercel redeploys automatically.

## Upload notes → cards (Claude API)
`api/generate.js` is a Vercel function that sends uploaded files (PDF, images, text; ~3 MB total, 5 files) to Claude and streams back a deck in the format above. It needs these Vercel environment variables:
- `ANTHROPIC_API_KEY`: Claude API key (console.anthropic.com). Set a monthly spend limit there.
- `FLASHCARD_PASSCODE`: passcode people type in the app.
- `ANTHROPIC_MODEL` (optional): defaults to `claude-sonnet-5-5`.
