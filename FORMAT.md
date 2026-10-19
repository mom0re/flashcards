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
    { "section": 2, "type": "calc", "q": "…", "a": "<div class=\"eq\">working\n= <span class=\"res\">answer</span></div>",
      "hint": "optional", "tip": "optional exam tip", "source": "optional, e.g. Past paper 2025 Q3" }
  ]
}
```
- `type`: `recall`, `explain`, `calc` or `formula`.
- Only `cards[].q` and `cards[].a` are required.
- Imported decks are limited to simple HTML (b, i, p, br, lists, tables, `eq`/`res` classes); scripts and links are stripped.

## Adding a built-in deck
1. Save the deck as `decks/<id>.json`.
2. Add `{ "id": "<id>", "file": "decks/<id>.json" }` to `decks/index.json`.
3. Commit to `main`; Vercel redeploys automatically.
