# frcog MCP server

Lets an authenticated Claude session curate the French words you collect in
tutoring: read the list, add what came up in a lesson, fix a translation, drop
one you no longer want. Changes appear on your phone at the next sync.

Its token is scoped to `words`, so Claude can shape vocabulary but cannot read
your review history or touch scheduling.

## Install

```bash
cd mcp && npm install
```

Register it with Claude Code:

```bash
claude mcp add frcog -- node /home/ambrus/french-learning/mcp/src/server.js
```

Set the two variables it needs, using a token minted with scope `words`:

```
FRCOG_API=https://frcog-sync.<your-subdomain>.workers.dev
FRCOG_TOKEN=<the words-scoped token>
```

## Tools

| Tool | Does |
|---|---|
| `list_words` | every word you added by hand |
| `add_words` | add or update words, optionally tagged with a lesson |
| `update_word` | correct the French spelling, translations, part of speech, gender or a note — the key stays, so the word keeps its cards and history |
| `remove_word` | remove a word; the removal syncs |
| `get_progress` | counts only, never the review log itself |
