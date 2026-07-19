# Style Guide — how to build a narrative page

This is the playbook behind pages like Westpac, Bunnings, IAG and the
Decisioning Hub framing. Follow the structure below and the page will
read the way customers expect.

---

## Salesforce Brand System (2026)

Source: Salesforce Brand Guidelines & Toolkits 2026. These are the canonical rules that override any prior conventions.

### Personality — Tight, Bright, Bold

In a winner-take-all market, safe is invisible. Salesforce is evolving its brand personality beyond the norms of boring B2B space. These three traits define how we show up — they answer the question: what would create the Salesforce brand experience on its best day?

| Principle | Definition | Voice tactics |
|-----------|-----------|--------------|
| **Tight** | Honesty meets clarity | 1. Tell it straight · 2. Keep it simple |
| **Bright** | Optimism meets wit | 1. Make it possible · 2. Clever with purpose |
| **Bold** | Confidence meets customer obsession | 1. Disrupt the default · 2. Obsess over the customer |

#### Tight — tactics

**Tell it straight:**
- Do: Lead with details and product truths
- Do: Reference outcomes grounded in facts and data (e.g., stats about ROI)
- Do: Be honest about hard work, but connect it to positive outcomes. e.g., "Implementing Agentforce may not be easy, but it's worth it"
- Don't: Use fillers or fluff
- Don't: Bury the lede
- Don't: Exaggerate or use hyperbole

**Keep it simple:**
- Do: Use plain, simple language and demystify complexity. Say "use" not "utilize"
- Do: Ruthlessly edit — use as few words as possible. Say "to" not "in order to"
- Do: Make punchy, declarative statements. e.g., "Make plans, not concessions"
- Don't: Overcomplicate with complex clauses
- Don't: Write run-on sentences
- Don't: Use vague or noncommittal language

#### Bright — tactics

**Make it possible:** Frame everything as potential and opportunity, not a pitch. Copy should feel like energy.

**Clever with purpose:** Wit is allowed — but every clever line must serve the reader's understanding, not just be entertaining.

#### Bold — tactics

**Disrupt the default:** Name what's broken. Don't hedge. Challenge the status quo directly.

**Obsess over the customer:** Every sentence answers "what does the customer get?" — not "what does Salesforce do?"

### Color — Official 2026 Digital Palette

**80/20 rule:** 80% of visible color must come from primary blues. 20% maximum from secondary/accent palette.

**Primary palette (Electric Blue scale):**

| Token | Hex | Name | Use |
|-------|-----|------|-----|
| `--sf-navy` | `#001E5B` | Electric Blue 15 | Hero/section dark backgrounds |
| `--sf-blue` | `#022AC0` | Electric Blue 30 | Headings, eyebrows, CTAs |
| `--sf-blue-m` | `#066AFE` | Electric Blue 50 | Mid accents |
| `--sf-blue-l` | `#00B3FF` | Cloud Blue 68 | Stat highlights, em spans |
| `--cloud-80` | `#90D0FE` | Cloud Blue 80 | Subtle tints |
| `--cloud-95` / `--off-white` | `#EAF5FE` | Cloud Blue 95 | Section backgrounds |

**Secondary palette (max 20% total) — full digital scale:**

| Shade | Teal | Yellow | Pink | Violet |
|-------|------|--------|------|--------|
| 20 (deep) | `#023434` | `#4F2100` | `#61022A` | `#481A54` |
| 60/70/40/30 (core) | `#06A59A` | `#E4A201` | `#B60554` | `#730394` |
| 80/80/60/65 (light) | `#04E1CB` | `#FCC003` | `#FF538A` | `#D17DFE` |
| 95 (tint) | `#DEF9F3` | `#FBF3E0` | `#FEF0F3` | `#F9F0FF` |

Use the **core shades** as single accent pops. Use **95 tints** for badge backgrounds. Never use two secondary colours on the same card.

**Customer accent:** `--accent` overrides one secondary colour per deal. Always replace a secondary slot, never a primary one.

**Gradient types:**

Two types of gradients exist in the 2026 system:

| Type | Built from | Use when |
|------|-----------|----------|
| **Primary gradients** | Linear primary blues only | Deep, immersive environments signalling trust and stability — hero backgrounds, section backdrops |
| **Secondary gradients** | Linear secondary/vibrant colours | Spark specific subjects, add energy — use in 20% zone only |

Primary gradients are the four atmosphere gradients (Morning/Midday/Dusk/Evening). Secondary gradients (`--grad-teal`, `--grad-yellow`, etc.) are available in `tokens.css` but use sparingly — a single secondary gradient per page maximum.

### Gradients — Atmosphere System

Gradients are **approved for hero moments and immersive backgrounds**. Use solid colors for data-dense sections (compare tables, stack diagrams) where legibility is priority.

| Gradient | CSS var | Use when |
|----------|---------|----------|
| **Evening** | `--grad-evening` | Hero background — dark, immersive, high impact |
| **Dusk** | `--grad-dusk` | Proof/closing dark sections |
| **Midday** | `--grad-midday` | Light section backgrounds needing energy |
| **Morning** | `--grad-morning` | Softest option — off-white sections with blue warmth |

The hero always uses `--grad-evening`. The proof-wrap uses `--sf-navy` solid (data-dense). Never apply a gradient to a card interior.

### Typography

**Display/Headlines:** Avant Garde SFDC Demi (`--font-display`) — all `h1`–`h4` elements pick this up automatically via `tokens.css`. Falls back to system-ui if font files aren't present.

**Body:** Salesforce Sans (`--font-body`) — all body text, cards, labels.

**Font files** (live in `assets/fonts/`):

| File | Weight | Use |
|------|--------|-----|
| `SalesforceSans-Regular.woff2/.woff` | 400 | Body copy |
| `SalesforceSans-Semibold.woff2/.woff` | 600 | Card titles, nav labels |
| `SalesforceSans-Bold.woff2/.woff` | 700 | Eyebrows, KPI values, CTAs |
| `SalesforceSans-Light.woff2/.woff` | 300 | Hero sub, large captions |
| `SalesforceSans-Italic.woff2/.woff` | 400i | Quotes, hero-quote cite |
| `TrailheadMedium.otf` | 500 | Trailhead/learning contexts |
| `TrailheadBold.otf` | 700 | Trailhead/learning contexts |

Use `var(--font-trailhead)` for any Trailhead-branded content. All other copy uses `var(--font-body)`. System-ui fallback ensures no broken layouts if fonts fail to load.

### Characters

**Astro** (`char-astro-*.png`) — general corporate storytelling. Light touch only — one per page, supportive role, never the focal point of a section.

**Agent Astro** (`char-agent-astro-*.png`) — use **only** when the content is specifically about Agentforce or the Agentic Enterprise. Agent Astro is not Astro in a robot suit — they are a different character with a different meaning.

**Einstein** (`char-agent-einstein-1.png`) — Einstein Studio / AI-specific moments only.

Never use both Astro and Agent Astro on the same page.

### Icons

| Icon type | Where to use |
|-----------|-------------|
| **3D icons** | Top-of-funnel, hero moments, campaign-level — Dreamforce-style energy |
| **2D multicolor** | Sales outreach, emails, webinars — our narrative pages live here |
| **2D one-color** | First appearance of an icon in a UI context |
| **2D stroke** | Repeat appearances after one-color has been introduced |

For narrative pages: use 2D multicolor product icons (`icon-agentforce.png`, `icon-data360.png`, etc.) in card icons. Never 3D in a document context.

### Accessibility

- Minimum contrast ratio: **4.5:1** for all text on backgrounds
- Never put `--sf-blue` (`#022AC0`) text on `--sf-navy` (`#001E5B`) — insufficient contrast
- Always use `--sf-blue-l` (`#00B3FF`) or white for text on dark gradient backgrounds
- All `<img>` tags in narrative pages must have descriptive `alt` attributes

## The page shape (top-to-bottom)

| # | Section | Purpose | Component |
|---|---------|---------|-----------|
| 1 | **Nav** | Co-branded lockup, confidentiality tag | `nav` + `.nav-lockup` |
| 2 | **Hero** | One headline, one sub, one quote, four KPIs | `.hero` + `.hero-kpi` |
| 3 | **Why Now** | Four cards proving the moment is right | `.card-grid-2` with `.card-accent-*` |
| 4 | **The Gap** | Today vs. Tomorrow comparison | `.compare-wrap` |
| 5 | **Connected Stack** | Layered architecture diagram | `.stack-wrap` |
| 6 | **Beachheads** | Where to start — two use-case cards | `.beach-card` x 2 |
| 7 | **Scale Story** | Phase 2 — how it extends | `.scale-card` x 3 |
| 8 | **Proof** | Customer quote + four stat tiles | `.proof-wrap` |
| 9 | **Roadmap** | Two phase cards with deliverables | `.phase-card` x 2 |
| 10 | **Closing** | Three-step CTA with primary highlight | `.closing-inner` |

Delete sections you don't need. Don't add new ones — if a new idea doesn't
fit one of these, it's usually a second page.

## The rules

### Voice
- **Declarative, not tentative.** "The decisions that used to require a human can now be made in milliseconds." Not "We believe…" or "Could potentially…"
- **Short clauses, em-dash driven.** Break long thoughts with em-dashes (—), not commas.
- **Bold the punchlines.** Each `card-body` gets one bolded phrase. That's the line the reader remembers.
- **Name the customer's language.** If their programme is "UNITE", use UNITE. Don't translate to generic terms.

### Copy lengths
- **H1:** 6–10 words, split onto two lines with a `<br/>`. Second line wrapped in `<em>` to pick up `--sf-blue-l`.
- **Hero sub:** 1–2 sentences, ~40 words max.
- **Card title:** 4–6 words.
- **Card body:** 2–3 sentences, one strong bolded clause.
- **Eyebrows:** 1–3 words, ALL UPPERCASE (done via CSS), letter-spacing 0.1em.

### Numbers
- **Use them everywhere.** The hero KPIs, proof stats, and section eyebrows carry the narrative as much as the prose.
- **Format:** whole integer + unit. `90 days`, `$660m`, `350 bankers`, `75%`.
- **Colour:** wrap the number itself in a `<span>` to pick up `--sf-blue-l` on dark backgrounds. Leaves the label neutral.

### Rhythm
Pages alternate:
- `section` (white) → `section-bg` (off-white) → `section` (white) → `section-bg` …
- Put an `<hr class="divider" />` between sections.
- End every block with bottom padding (handled by `.section { padding: 80px 48px }`).

## Per-page override

Everything else stays the same — the one thing you change per deal is the
accent colour. In the `<head>` of every page, after the main stylesheets:

```html
<style>
  :root {
    --accent:   #DA1710;   /* Westpac red */
    --accent-l: #FF4A3D;
  }
</style>
```

Customer accents seen so far:
- Westpac: `#DA1710` / `#FF4A3D`
- Bunnings: green (use their brand hex)
- IAG: blue (check their brand book)
- Xero: `#13B5EA` with teal secondary `#0B8A7D`
- Asahi: red, black, white

## Assets — when to use which

| File | Use when |
|------|----------|
| `logos/Salesforce-Corporate-Logo-Horiz-RGB.svg` | Nav on white background — primary horizontal mark |
| `logos/Salesforce-Corporate-Logo-Horiz-White-RGB.svg` | Nav or footer on dark/gradient backgrounds |
| `logos/Salesforce-Corporate-Logo-Horiz-KO-RGB.svg` | Hero on dark gradient — knockout version |
| `logos/Salesforce-Corporate-Logo-Cloud-RBG.svg` | Cloud mark only — icon/favicon contexts |
| `logos/Salesforce-Corporate-Logo-Cloud-White-RBG.svg` | Cloud mark on dark backgrounds |
| `sf-logo.jpeg` | Legacy — replace with SVG above where possible |
| `sf-logo-cloud.png` | Legacy — replace with SVG above where possible |
| `icon-agentforce.png` | Referring to Agentforce specifically |
| `icon-data360.png` | Data Cloud / Data 360 |
| `icon-marketing.png` | Marketing Cloud |
| `icon-platform.png` | Platform capabilities |
| `icon-salesrevenue.png` | Sales Cloud / revenue use cases |
| `icon-slack.png` | Slack integrations |
| `xero-einstein-icon.png` | Einstein Studio (the icon name is a legacy — re-use anywhere) |
| `xero-perso-icon.png` | Personalisation |
| `xero-rtom-icon.png` | Real-Time Orchestration |
| `dc-logo.png` | Data Cloud standalone |
| `char-agent-astro-*.png` | Astro-as-agent moments — hero accents, feature cards |
| `char-agent-einstein-1.png` | Einstein-as-agent moments |
| `char-astro-jumping.png` | Kinetic moments — closing CTAs, excitement |
| `sf-star-gold.png` | Premium badge / award callouts |
| `moments.svg` / `moments-light.svg` | Decorative backdrop for dark (or light) sections |
| `anatomy-decisioning.png` | When explaining the decisioning architecture |
| `screenshots/*` | In-context product screenshots — use sparingly |

## Gating

If the page is customer-facing and you want visitor analytics, drop:

```html
<script src="gate.js" data-page="Westpac NBA Narrative"></script>
```

- `data-page` → shows up in tracking logs and email subject lines
- Password is set in `gate.js` (default `SFNBA2026!`) — override per script tag via `data-password="..."`
- Visitors only enter credentials once per browser — `localStorage` remembers them across all pages in the series

## Things to avoid

- **No emoji-dense layouts.** One emoji per card icon is the limit.
- **No gradient text.** Gradient backgrounds yes — gradient-filled text no.
- **No gradients inside cards.** Card interiors are always solid white or `--off-white`. Gradients are for full-bleed section backgrounds only.
- **No drop shadows on dark backgrounds.** Use subtle borders instead.
- **No more than 4 KPI cards in the hero.** Readers can't parse more.
- **No stack diagram with more than 7 layers.** If you have more, the story is too complex.
- **No tables of feature bullets.** Use cards. Bullets read as a backlog, not a narrative.
- **No secondary colors on data-dense sections.** Compare tables, stack diagrams, and proof stats use primary blues only — secondary colors only appear as single accent pops in card icons or badges.
- **Never mix Astro and Agent Astro** on the same page.

---

## Narrative Guardrails (Persuasion)

These rules translate Michelle Bowden's Persuasion Blueprint into copy discipline for narrative pages. Apply them when writing or reviewing any section.

### Before you write — define the goal

State this explicitly before drafting any section:

> **Convince [specific audience] to [specific action] by [deadline/meeting].**

If you can't complete that sentence, the page isn't ready to write. The entire structure — headline, KPIs, comparison, roadmap — should serve that one action ask.

### The leading statement

Every page needs one contentious-but-reasonable belief the reader should leave holding. It sits in the hero sub or the opening of the "Why Now" section. Rules:

- It must **support the action ask** — not just be interesting
- It must be **slightly challengeable** — if no reasonable person would dispute it, it has no rhetorical force
- It should be **provable** by the evidence that follows on the page
- One per page. Don't stack them.

Example: *"The decisions that used to require a human can now be made in milliseconds — and the companies that move first will set the standard everyone else chases."*

### WIIFM — always audience-centred

Every card body, section sub, and proof description must answer "What's in it for me?" from the **customer's** perspective, not Salesforce's. The test: re-read the copy and ask — is this about them, or about us?

Structure for WIIFM copy:

| Frame | Pattern |
|-------|---------|
| Reduce | *"Cut the time your team spends on X from Y to Z."* |
| Maintain | *"Keep [competitive advantage] as [market changes]."* |
| Improve | *"Turn [current process] into [better outcome]."* |

At least two of the three frames should appear across the hero KPIs and proof stats.

### Ban "but" and "however"

These words signal to the reader that you're about to contradict what they just accepted. They create resistance.

- Replace **"but"** → **"and"** or restructure
- Replace **"however"** → **"in fact"** or **"and so"**
- Replace **"although"** → **"and"** then reframe

This applies to all body copy, card bodies, and proof descriptions. No exceptions in headings.

### Pacing objections (POO)

When copy touches a likely objection — cost, complexity, change management — use this structure:

1. **State the objection** briefly and neutrally (don't over-amplify it)
2. **Pivot** with *"actually"* or *"in fact"* — not "but"
3. **Resolve** in one sentence
4. **Because** — one reason why the resolution holds

Example: *"Rolling out a new decisioning layer sounds like a six-month project — in fact, the beachhead use case ships in 90 days because the platform reuses data you already have in Service Cloud."*

Use POO in: The Gap (compare cells), Scale Story cards, Roadmap phase bodies. Never in the hero.

### Consequence framing ("If we don't" → "When we do")

The Why Now section sets urgency. Structure each card as a consequence pair:

- **Negative consequence first** (If we don't act): costs, risks, competitive lag — factual, not catastrophising
- **Positive consequence second** (When we do): the outcome the customer gets — specific, time-bound if possible

Don't use both in the same card. Alternate: two cards framed as risk, two framed as opportunity. The final card in a four-card Why Now should always be the positive frame — end on momentum.

### 4Mat — answer structure for objection sections

When a section needs to explain a concept or answer a likely "why" question, follow this order:

| Step | Question answered | Where to use |
|------|-------------------|-------------|
| **Why** | Why does this matter to the customer? | Opening sentence of the section sub |
| **What** | What is the thing we're describing? | First card or stack layer |
| **How** | How does it work / get deployed? | Middle cards or stack layers |
| **What if** | What becomes possible? | Final card, proof stat, or closing line |

Don't skip to "How" without establishing "Why" first — that's the most common copy mistake.

### Audience balance (Cats and Dogs)

Narrative pages are read by two audience types simultaneously:

| Type | What they need | Where to serve them |
|------|---------------|---------------------|
| **Cats** (analytical, sceptical) | Data, architecture, proof, logic | Proof stats, stack diagram, compare table |
| **Dogs** (relational, energetic) | Vision, story, momentum, people | Hero quote, beachhead use cases, closing CTA |

A page that's all Cats loses the sponsor. A page that's all Dogs loses the technical buyer. Check: does each half of the page have something for both types?

### Opening hook formula

The hero eyebrow + H1 + sub is the hook. It must follow: **Hook → Intro → Link**.

- **Hook**: the provocation — a stat, a consequence, or a pointed question (never a product name)
- **Intro**: who you are in this context (implied by co-branding, not stated explicitly)
- **Link**: the bridge to why they're reading this now

The H1 `<em>` line is the hook sharpened. The hero sub is the link.

### Closing discipline

The closing section (`closing-inner`) is not a summary. Rules:

- **Don't restate the consequences** — the reader has already processed them
- **Don't repeat the action ask** if it appeared in the hero
- **Do** make the next step frictionless and concrete — three steps maximum, first step always free or low-cost
- **Do** end on the outcome, not the process: *"Your first use case live in 90 days"* not *"Schedule a discovery call"*

The `c-step.primary` highlight should always be the step the customer needs to take *this week*, not the final destination.

---

## Data Visualisation

Source: Salesforce Brand Guidelines & Toolkits 2026 — Data Vis Visual Treatments.

Choose the treatment based on where the data lives and the energy required:

| Treatment | When to use | Channel |
|-----------|------------|---------|
| **Solid colour** | Information-dense: reports, slide decks, documents, complex datasets and detailed comparisons. Prioritises legibility. | Narrative pages, decks, PDFs |
| **Glass effect** | Making a statement: social media, event displays, hero banners. Layer simple bold metrics over brand imagery to add depth. | Top-of-funnel, social, Dreamforce |

**For narrative pages and sales decks:** Solid colour is always correct. White or `--off-white` backgrounds with `--sf-navy` text and `--sf-blue-l` number highlights. Glass effect is never appropriate in our HTML narrative pages — it belongs in campaign creative.

**KPI/stat formatting rules (solid colour treatment):**
- Whole integer + unit. `90 days`, `$660m`, `3.2×`, `75%`
- Wrap the number in `<span>` to pick up `--sf-blue-l` on dark backgrounds
- Leave the label in neutral — white at 50% opacity on dark, `--muted` on light
- Maximum 4 stats in any single grid (hero KPIs, proof stats)

---

## AI-Assisted Presentation Writing — Bowden Prompt Guide

Source: The Presenters AI Prompt Guide — Michelle Bowden 2026. Use these prompt structures when using Claude or any AI to write presentation content within this system.

### Step 1 — Define the goal first
Before writing any copy, complete this statement:

> Convince **[specific audience]** to **[specific action]** by **[deadline or meeting]**.
> They should care because **[WIIFM]**. The business priority this supports is **[KPI]**.

### Step 2 — Leading statement
Prompt structure:
> "Help me write a leading statement. The action I want is [action]. The benefit is [benefit]. The risk of not doing it is [risk]. The audience is [audience]. The tone is confident and supportive. Don't say 'but' or 'however'."

### Step 3 — WIIFM (reduce/maintain/improve)
Prompt structure:
> "Write a short WIIFM statement using the reduce, maintain, improve structure. My audience is [describe]. Their mindset is [time-poor/sceptical/etc.]. My leading statement is [statement]. Goal is to build their motivation. Don't say 'but' or 'however'."

### Step 4 — Icebreaker (hook → intro → link)
Three hook types — choose one:

**Stats hook:**
> "Write an icebreaker following the formula: hook, intro, link. The hook is a stacking hook with three statistics one after another. Topic: [topic]. Audience: [audience]. Desired emotion: [motivated/compelled]. Geographic focus: Australia. Don't say 'but' or 'however'. Don't start with 'Hi'."

**Story/case study hook:**
> "Write an icebreaker following hook, intro, link. The hook is a story or case study. Topic: [topic]. Audience: [audience]. Tone: [shocking/impressive/relatable]. Don't say 'but' or 'however'."

### Step 5 — Pacing objections (POO)
Prompt structure:
> "Write a POO statement for this objection: '[exact objection]'. It should: state the objection clearly, use 'and'/'so' or a pause (not 'but'), include 'actually' or 'in fact' to introduce the solution, offer a brief solution, end with 'because' and the reason. Context: [topic]. Don't use 'but' or 'however'."

### Step 6 — Consequences framing
Prompt structure:
> "Write a persuasive script. My topic is [topic]. My audience is [audience]. Clearly state the negative consequence starting with 'If we don't…' then the positive outcome starting with 'When we do…'. Confident, motivating tone. Don't use 'but' or 'however'."

### Step 7 — Cats and Dogs balance check
Prompt structure:
> "Review my presentation and enhance it to engage both Cats (analytical, sceptical — need data, logic, proof) and Dogs (relational, energetic — need vision, story, momentum). My presenting style is [style]. Audience mix is [mostly Cats / mostly Dogs / balanced]. Platform: [live/virtual]. Don't use 'but' or 'however'."

### Step 8 — Q&A invitation (three-hook formula)
Prompt structure:
> "Write a Q&A invitation using this formula: 'You might have some questions at this time. Perhaps you'd like to know more about [x], or about anything at all we've discussed, or even about [z]. Who would like to begin this [morning/afternoon]?' x and z are specific hooks relevant to the topic. The wildcard 'anything at all' is always the middle position. Most important question last (z)."

### Step 9 — 4Mat answer structure
When answering a technical or strategic question in a deck, structure the response:
1. **Why** — why does this matter to the audience?
2. **What** — what is the fact/concept?
3. **How** — how does it work in practice?
4. **What if** — what becomes possible?

Prompt: "Answer the following question using Bernice McCarthy's 4Mat model (Why, What, How, What if). Audience: [audience]. Leading statement: [statement]. Don't use 'but' or 'however'. Question: [question]."

---

## Narrative Checklist (pre-send)

Run through this before sharing any narrative page:

- [ ] Hero has `--grad-evening` background
- [ ] `--accent` is set to customer brand hex
- [ ] No emoji in card icons — all using `assets/icons/2d/` files
- [ ] All `<img>` tags have descriptive `alt` attributes
- [ ] All SVG logos have explicit `width` and `height` attributes
- [ ] No `font-weight: 800` or `900` anywhere
- [ ] No hardcoded `#032D60` (old SF navy) — using `#001E5B`
- [ ] No hardcoded `#0176D3` (old SLDS blue) — using `#022AC0` or `#066AFE`
- [ ] 80% of colour is primary blues — secondary/accent max 20%
- [ ] No gradient inside any card interior
- [ ] No gradient text
- [ ] Astro and Agent Astro not both present
- [ ] Hero has max 4 KPI cards
- [ ] Stack has max 7 layers
- [ ] Leading statement is present and contentious-but-reasonable
- [ ] No "but" or "however" in any body copy
- [ ] Closing ends on outcome, not process
- [ ] `c-step.primary` is the action for this week
