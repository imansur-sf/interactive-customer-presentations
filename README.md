# Interactive Customer Presentations

A web portal that mirrors the [sf-decktools](https://github.com/mtoolin/sf-decktools) Claude skill, making its capabilities accessible to people who don't use Claude Code.

Users interact with a conversational AI interview to build a Salesforce customer narrative deck, watch it come together in a live preview, click into individual slides for targeted edits, and download a self-contained HTML deck.

## Stack

- **Frontend:** static HTML/CSS/JS, hosted on GitHub Pages
- **Backend:** Cloudflare Worker (`worker/`) — LLM proxy against Salesforce LLM Gateway or Anthropic API
- **Design system:** the sf-decktools brand kit (`assets/`) — tokens, components, fonts, icons, characters
- **Skill context:** the sf-decktools skill files (`skill-context/`) — sent as the LLM system prompt on every call, so the model behaves as if the skill were loaded

## Repo layout

```
interactive-customer-presentations/
├── index.html              # three-pane app: chat | preview | slide nav
├── assets/                 # design system (fonts, icons, css, characters)
├── skill-context/          # SKILL.md + style guides + reference deck (system prompt payload)
└── worker/                 # Cloudflare Worker + wrangler.toml
```

## Local dev

```
npx serve .
```

Open `http://localhost:3000`.

## Deploy

- Frontend: push to `main`, GitHub Pages serves `/index.html`.
- Worker: `cd worker && wrangler deploy`.

## Credit

Design system, brand rules, and interview flow adapted from the sf-decktools Claude skill by [Miles Toolin](https://www.linkedin.com/in/milestoolin/).
