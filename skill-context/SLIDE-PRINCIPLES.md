# Slide Design Principles — Salesforce Narrative System

Codified rules for building slide decks using the decktools design system. Every deck built with this system must follow these principles without exception. They are derived directly from the Salesforce Brand Guidelines & Toolkits 2026.

---

## Architecture

### File structure
Every customer deck is a single HTML file at the root of `decktools/`:
```
priceline.html
xero.html
westpac.html   ← example
```

Link to the shared stylesheets — never copy tokens or components into the page:
```html
<link rel="stylesheet" href="tokens.css" />
<link rel="stylesheet" href="components.css" />
```

### The slide engine
All decks use the keyboard-navigable slide engine from `xero.html`. Copy it verbatim:
- Fixed nav at top (`position: fixed; z-index: 100`)
- `.slide-deck` fills the viewport
- Each `.slide` is `display: none` except `.slide.active`
- Arrow keys and dot clicks navigate between slides
- `slides[current].scrollTop = 0` on every transition

### Per-deck override (required)
The only thing that changes per deck is the accent colour. Add immediately after the stylesheet links:
```html
<style>
  :root {
    --accent:   #EC2B8C;   /* customer hex */
    --accent-l: #F55EAA;
  }
</style>
```
Never override primary blues. Never add a second accent.

---

## Slide sequence

Follow the 10-section narrative shape from STYLE-GUIDE.md:

| Slide | Section | Component |
|-------|---------|-----------|
| 1 | Hero | `.hero` + `.hero-kpi` |
| 2 | Why Now | `.card-grid-2` with `.card-accent-*` |
| 3 | The Gap | `.compare-wrap` |
| 4 | Connected Stack | `.stack-wrap` |
| 5 | Beachheads | `.beach-card` × 2 |
| 6 | Scale Story | `.card-grid-3` + `.scale-card` |
| 7 | Proof | `.proof-wrap` |
| 8 | Roadmap | `.phase-card` × 2 |
| 9 | Closing | `.closing-inner` |

Add or remove slides — but never add a new section type. If an idea doesn't fit one of these shapes, it belongs on a second deck.

---

## Color

### The 80/20 rule
80% of visible colour must come from primary blues. The accent fills the remaining 20%.

### Primary blues — use these exclusively on dark/gradient backgrounds
| Token | Hex | Use on slides |
|-------|-----|--------------|
| `--sf-navy` `#001E5B` | Hero/section dark backgrounds, diagram headers |
| `--sf-blue` `#022AC0` | Eyebrows, labels, badge text on light |
| `--sf-blue-m` `#066AFE` | Mid accents, API colour codes |
| `--sf-blue-l` `#00B3FF` | Stat values, em spans, eyebrow text on dark |

### The hero always uses `--grad-evening`
```css
background: var(--grad-evening);
/* = linear-gradient(180deg, #001E5B 0%, #022AC0 40%, #066AFE 75%, #00B3FF 100%) */
```
The 3px accent stripe at the bottom of the hero uses `--accent`.

### Gradients are for full-bleed backgrounds only
- Hero: `--grad-evening`
- Dark proof/closing sections: `--sf-navy` solid (data-dense, use solid not gradient)
- Never apply a gradient inside a card, badge, or table cell

### Customer accent
Used for: hero accent stripe, primary nav dot colour, phase badges, `.c-step.primary`, beachhead badge colour, `bc-dot` for customer-specific use cases.

Never use accent on: primary blues, text on dark backgrounds, tables, stack diagram layers.

---

## Typography

### Fonts
All slides inherit from `tokens.css`. No Google Fonts, no Inter, no Poppins in narrative pages.
- Headlines (`h1`–`h4`): `--font-display` → Salesforce Sans
- Body, cards, labels: `--font-body` → Salesforce Sans
- Trailhead content only: `--font-trailhead`

### Font weights
| Weight | Token file | Use |
|--------|-----------|-----|
| 700 | Bold | H1, eyebrows, KPI values, card titles, CTAs |
| 600 | Semibold | Card titles, nav labels |
| 400 | Regular | Body copy, card body |
| 300 | Light | Hero sub, captions |

Max weight is 700. Never use `font-weight: 800` or `font-weight: 900` — Salesforce Sans doesn't have these weights. Browser silently clamps; visually inconsistent.

### H1 structure
```html
<h1>Top-line promise.<br/><em>Bold second clause.</em></h1>
```
`em` inside H1 picks up `color: var(--sf-blue-l)` from `.hero h1 em`. 6–10 words total.

### Eyebrow structure
```html
<div class="hero-eyebrow">Theme · Theme · Theme</div>
```
3 words max, separated by `·`. CSS handles uppercase and letter-spacing automatically.

---

## Icons

### Which tier for narrative slides
2D full colour only. Files live in `assets/icons/2d/`.

Never use 3D icons (Dreamforce/campaign tier only) in narrative pages or Q&A slides.

### Using icons in cards
```html
<div class="card-icon">
  <img src="assets/icons/2d/Data Cloud.png" width="28" height="28" alt="Data Cloud" />
</div>
```
Always explicit `width` and `height`. Never emoji as a card icon.

### Icon assignments — Digital Product Suite
| Product | File |
|---------|------|
| Data 360 | `Data Cloud.png` |
| MC Next | `Marketing.png` |
| Marketing Intelligence | `Tableau.png` |
| Personalisation | `Segments.png` |
| Loyalty Management | `Loyalty Management.svg` |
| Digital Engagement | `Contact Center.png` |
| Adaptive Web | `Experience Cloud.png` |
| Real-Time Offer Management | `Commerce.png` |
| Agentforce | `Agentforce.svg` |

---

## Logos

### Nav — light background
```html
<img src="assets/logos/Salesforce-Corporate-Logo-Horiz-RGB.svg" width="140" height="28" alt="Salesforce" />
```

### Hero / dark background
```html
<img src="assets/logos/Salesforce-Corporate-Logo-Horiz-White-RGB.svg" width="140" height="28" alt="Salesforce" />
```

Always provide explicit `width` and `height` on SVG `<img>` elements — browsers render them blurry without it.

### Customer logo placement
```html
<div class="nav-divider"></div>
<img src="assets/CUSTOMER-logo.png" height="28" class="nav-logo-customer" alt="Customer Name" />
```
Put customer logo on white or very light background if the logo has a coloured background. Use `border-radius: 4px` to contain it.

---

## Characters

| Character | When |
|-----------|------|
| Agent Astro (`char-agent-astro-*.png`) | Agentforce-specific content ONLY |
| Astro (`char-astro-jumping.png`) | General closing / excitement moments |
| Einstein (`char-agent-einstein-1.png`) | Einstein Studio / AI-specific moments |

Never mix Astro and Agent Astro on the same deck. One character per deck maximum. Supportive role only — never the focal point of a slide.

---

## Stack diagram colour assignments
Use these layer colours consistently across all decks:

| Layer | CSS class | Colour |
|-------|-----------|--------|
| 01 | `sl-layer-01` | `--violet` `#730394` |
| 02 | `sl-layer-02` | `--sf-blue` `#022AC0` |
| 03 | `sl-layer-03` | `--accent` (customer) |
| 04 | `sl-layer-04` | `--pink` `#FF538A` |
| 05 | `sl-layer-05` | `--yellow` `#E4A201` |
| 06 | `sl-layer-06` | `--sf-blue-l` `#00B3FF` |
| 07 | `sl-layer-07` | `--teal` `#06A59A` |

Never use more than 7 layers. Never repeat a colour within a single stack.

---

## Beachhead badges
```html
<!-- Phase 1 — always blue -->
<div class="bc-badge" style="background:rgba(2,42,192,0.08);color:var(--sf-blue);border:1px solid rgba(2,42,192,0.15);">Phase 1</div>

<!-- Customer use case — always accent -->
<div class="bc-badge" style="background:rgba(236,43,140,0.08);color:var(--accent);border:1px solid rgba(236,43,140,0.2);">Phase 1</div>
```
The `rgba()` values change with `--accent` — manually update the alpha channel when accent changes.

---

## Roadmap phase badges
```html
<!-- Phase 1 -->
<div class="phase-badge" style="background:rgba(2,42,192,0.08);color:var(--sf-blue);border:1px solid rgba(2,42,192,0.15);">Phase 1 · 0–90 days</div>

<!-- Phase 2 -->
<div class="phase-badge" style="background:rgba(236,43,140,0.08);color:var(--accent);border:1px solid rgba(236,43,140,0.2);">Phase 2 · 90 days – 18 months</div>
```

---

## Voice rules (applies to all copy)

- **Declarative, not tentative.** "The data is already there." Not "We believe this could potentially..."
- **Em-dash driven.** Break long thoughts with —, not commas.
- **Bold the punchline.** One `<strong>` per card body. That's the line the reader remembers.
- **Name the customer's language.** If their programme is "Beauty Club", use Beauty Club throughout.
- **No "but" or "however".** Replace with "and" or restructure. They create resistance.

### Copy lengths
| Element | Length |
|---------|--------|
| H1 | 6–10 words, split on `<br/>` |
| Hero sub | 1–2 sentences, ~40 words max |
| Card title | 4–6 words |
| Card body | 2–3 sentences, one `<strong>` |
| Eyebrow | 1–3 words |
| Closing H2 | 3 punchy lines |

---

## Things never to do in a slide deck

- No emoji as card icons — use `assets/icons/2d/` PNGs/SVGs
- No gradient text — backgrounds yes, text fill no
- No gradient inside a card interior
- No drop shadows on dark backgrounds — use subtle borders instead
- No more than 4 KPI cards in the hero
- No stack with more than 7 layers
- No Inter, Poppins, or Google Fonts — Salesforce Sans only
- No `font-weight: 800` or `900` — max is 700
- No hardcoded `#032D60` — use `#001E5B` (Electric Blue 15)
- No hardcoded `#0176D3` — use `#022AC0` (Electric Blue 30) or `#066AFE` (Electric Blue 50)
- No mixing Astro and Agent Astro on the same page
- No secondary palette colours in data-dense sections (tables, stack, proof stats)

---

## Q&A / Technical slides (Responses.jsx pattern)

When building technical response decks (RFP answers, requirement responses), apply the same brand tokens:

```js
// Header gradient
background: 'linear-gradient(180deg, #001E5B 0%, #022AC0 60%, #066AFE 100%)'

// Eyebrow on dark
color: '#00B3FF', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase'

// Diagram headers
background: '#001E5B'

// Primary blue labels/badges
color: '#022AC0', background: 'rgba(2,42,192,0.08)'

// Font family
fontFamily: "'Salesforce Sans', system-ui, -apple-system, sans-serif"

// Font weight max
fontWeight: 700
```
