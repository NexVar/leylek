---
name: Leylek
colors:
  primary: "#0F1729"
  primary-hover: "#1A2440"
  primary-foreground: "#FFFFFF"
  accent: "#FF6B5C"
  accent-hover: "#E5594B"
  accent-foreground: "#FFFFFF"
  surface: "#F4F5F7"
  surface-raised: "#FFFFFF"
  surface-sunken: "#E8EAEF"
  ink: "#0B0F1A"
  ink-muted: "#4A5260"
  ink-subtle: "#8089A0"
  border: "#D8DCE3"
  border-strong: "#0F1729"
  success: "#16A34A"
  warning: "#F59E0B"
  danger: "#DC2626"
  info: "#2563EB"
typography:
  display:
    fontFamily: Inter
    fontWeight: 700
    fontSize: 2.5rem
    lineHeight: "1.1"
    letterSpacing: "-0.02em"
  h1:
    fontFamily: Inter
    fontWeight: 700
    fontSize: 1.875rem
    lineHeight: "1.2"
    letterSpacing: "-0.015em"
  h2:
    fontFamily: Inter
    fontWeight: 600
    fontSize: 1.5rem
    lineHeight: "1.3"
    letterSpacing: "-0.01em"
  h3:
    fontFamily: Inter
    fontWeight: 600
    fontSize: 1.125rem
    lineHeight: "1.4"
  body-lg:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 1rem
    lineHeight: "1.6"
  body-md:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 0.9375rem
    lineHeight: "1.55"
  body-sm:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 0.8125rem
    lineHeight: "1.5"
  label:
    fontFamily: Inter
    fontWeight: 500
    fontSize: 0.8125rem
    lineHeight: "1.4"
    letterSpacing: "0.01em"
  mono:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 0.8125rem
    lineHeight: "1.5"
rounded:
  sm: 6px
  md: 12px
  lg: 16px
  xl: 24px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  "2xl": 48px
  "3xl": 64px
shadows:
  sm: "0 1px 2px rgba(11, 15, 26, 0.04)"
  md: "0 4px 12px rgba(11, 15, 26, 0.06), 0 1px 3px rgba(11, 15, 26, 0.04)"
  lg: "0 12px 32px rgba(11, 15, 26, 0.08), 0 2px 6px rgba(11, 15, 26, 0.04)"
  focus: "0 0 0 3px rgba(255, 107, 92, 0.35)"
---

## Overview

Leylek is a **financial confidence tool dressed as an AI agent platform.** The
visual identity has to read calm and trustworthy at a glance (this is the
user's ad budget on the line) while staying alive enough that someone scrolling
past a fintech dashboard pauses and says "what's that orange button doing on
a navy header." We chose **Modern Fintech + warm coral**: dark-navy primary
surfaces signal financial seriousness; a single coral accent owns every
action the user can take. There is no purple, no gradient, no glassmorphism —
those would push the brand into "AI startup" generic.

Tone is **direct Turkish**. Status lives in colored pills. Reasoning lives in
plain prose. Numbers are right-aligned and tabular. The agent's voice is
confident but not chatty — it tells you what it did, with the number that
justifies it, then stops.

## Colors

### Navy `#0F1729` (primary)

Top-bar background, primary heading text on light surfaces, primary buttons.
Use this on solid blocks where the user needs to feel anchored — the app
shell, the campaign status header, the agent timeline rail. Combine with
`primary-foreground` (white) for text. Never put coral text on navy — coral
is for buttons and badges only, never for body text.

### Coral `#FF6B5C` (accent / CTA)

**Exactly one role:** the primary action on the current screen. "Şimdi
Optimize Et", "Reklamı Yayınla", "Onayla". Never decorative. If a screen
has two coral buttons, one of them is wrong. The accent + its foreground
white pass WCAG AA on solid 16px+ text (`accent` only — not on light surface).

A muted coral tint (`#FFEDEB`) is acceptable for the focus halo on inputs
and for status-pill backgrounds in non-destructive contexts.

### Cool gray `#F4F5F7` (surface)

App canvas background. Cards sit on top of this as `surface-raised`
(`#FFFFFF`). Form fields and disabled buttons use `surface-sunken`
(`#E8EAEF`). The triple-layer hierarchy is intentional — when an agent
log card slides in, it lifts above the canvas; when a metric is "stale"
or pending, it sinks below it.

### Ink `#0B0F1A` (text)

Primary text on light surfaces. `ink-muted` (`#4A5260`) for secondary
labels and timestamps. `ink-subtle` (`#8089A0`) for placeholder and the
"separator dot" between metadata.

### Semantic colors

| Token     | Hex       | Role                                                |
|-----------|-----------|-----------------------------------------------------|
| `success` | `#16A34A` | "ad 2 winner" pills, positive deltas                |
| `warning` | `#F59E0B` | "marjinal" pills, "learning phase" copy             |
| `danger`  | `#DC2626` | "zararda" pills, pause icon                         |
| `info`    | `#2563EB` | links and informational badges                      |

Status pills use the semantic color at 16% alpha for background and 100%
for text and icon. This keeps them readable next to coral CTAs without
fighting for attention.

## Typography

**Inter, variable.** Loaded from Google Fonts with `weight 100..900` and
`display=swap`. JetBrains Mono only for the agent-log "request_id" line and
the campaign ID column.

The scale is **fluid in spirit, fixed in numbers**: `display` (40px) for the
auth split-pane hero only; `h1` (30px) for the dashboard "Hoş geldin" line;
`h2` (24px) for section headings ("Reklam Varyantları", "Ajan Kararları");
`h3` (18px) for card titles. Body text is 15px (`body-md`) — slightly
denser than 16px, more characters per line in the timeline. The 13px
`body-sm` is for metadata timestamps and pill labels.

Numbers (spend, CPA, impressions) are rendered with `font-variant-numeric:
tabular-nums` so columns line up. The CPA delta in the timeline is the only
place we use `font-weight: 600` on a number.

Turkish-specific: never letterspace below `-0.02em` on `display` — the
"ç", "ğ", "ş" descenders + glyph widths look broken when tracked too tight.

## Spacing & layout

4px grid. **`md` (16px) is the default gap between sibling elements;** `lg`
(24px) separates logical groups inside a card; `xl` (32px) separates cards
on the canvas. The agent timeline uses `sm` (8px) between log rows because
the visual rhythm is verb → reason → timestamp on three short lines.

Page max-width is 1280px on the dashboard; the auth pages center a 480px
column. Internal padding on raised surfaces is 24px on the inset and 16px
on the rail, intentionally asymmetric so the card has a clear "title side".

## Rounded corners

**12px is the default** for cards, buttons, inputs, modals. 6px for status
pills and tag chips (smaller objects need tighter geometry). 16px for the
auth hero panel. 24px for the dashboard's hero "spend chart" card — its
larger surface earns a softer corner. `pill` (999px) only on radio chips
and the floating "Şimdi Optimize Et" demo trigger.

## Shadows

Three tiers, none decorative.
- `sm`: the persistent surface elevation for cards on the canvas.
- `md`: hover state on cards; opens-on-hover popovers.
- `lg`: modals, dropdowns, the agent-decision toast.
- `focus`: 3px coral halo at 35% alpha — the only focus ring in the system.
  Replaces the default browser outline; never remove without replacement.

## Components

### Buttons

- **Primary (coral):** `bg-accent`, `text-accent-foreground`, weight 500,
  height 40px on desktop / 44px on mobile, 16px x-padding, 12px radius.
  Hover: `accent-hover`. Active: shift +1px translate-y. Disabled: 50%
  opacity, no hover. Loading: replace label with a 16px spinner + dim
  remainder of label to 60%.
- **Secondary (navy outline):** `border: 1px solid primary`, `text: primary`,
  transparent background. Hover: `bg-primary/4`. Used for "İptal", "Geri".
- **Ghost:** no border, ink text, hover surface-sunken. For toolbar actions.
- **Destructive:** danger-tinted (`bg-danger`, white text). Reserved for
  irreversible removals — pausing an ad does NOT use destructive style,
  it uses secondary, because pause is reversible.

### Inputs

White background, 1px `border` border, 12px radius, 12px x-padding, 40px
height, ink-colored text, ink-subtle placeholder. Focus: `border-strong`
+ `shadows.focus`. Error: 1px `danger` border + 13px danger helper text
below. Labels sit above (`typography.label`, ink-muted), 8px gap.

### Cards

`surface-raised` background, 12px radius, 1px hairline `border`, `shadow.sm`.
Card title is `h3` ink, 8px gap to body. The card header may hold a
right-aligned pill (status) or icon (ghost button) but never a primary CTA —
primary CTAs live below the card body, full-width on mobile, auto-width
on desktop.

### Status pills

`h-6`, 8px x-padding, 6px radius, 12px font, weight 500. Background
`{color}/16%`, text `{color}`. Available variants: `success`, `warning`,
`danger`, `info`, `neutral` (ink-muted / surface-sunken).

### Agent log row

`flex` row, 12px gap. Left: 8px coral dot (or navy if `agent: content`,
danger if `action: PAUSED_AD`). Middle: bolded agent name + action
verb, then full Turkish reasoning, 13px wrap. Right: relative timestamp,
`mono`, ink-subtle, ALIGN to top so multi-line reasoning doesn't push
the timestamp down.

### Toast / decision popover

`surface-raised`, 16px radius, `shadow.lg`, 24px padding. The agent
reasoning streams in line-by-line from Gemini — render with a 200ms
fade-in per chunk. Confidence is shown as a 4px progress bar at the
bottom of the toast: full bar at 1.0, coral fill at >0.8, warning fill
at 0.5–0.8, danger fill below 0.5.

## Motion

Default transition: **150ms ease-out**. Reserve longer durations (300ms)
for modal mount and toast slide-in. Skip transitions on inputs entirely —
state needs to be immediate so users feel responsive feedback.

Never animate the spend chart from zero on mount — render fully then
animate only on data changes. A zero-baseline animation on a money chart
reads as a UI gimmick, not a financial tool.

## Tone & copy

- **Turkish, lowercase headings discouraged.** Capitalize first word, leave
  the rest sentence-case. "Reklam Varyantları" not "REKLAM VARYANTLARI".
- **Numbers before nouns:** "3 reklam aktif" not "Aktif 3 reklam".
- **Reasoning is the product.** Every agent decision shows up with its
  full Gemini reasoning, never truncated. If the agent's reason fits in
  one line it should still wrap rather than be cropped.
- **No emojis in agent output.** The brand voice is "calm engineer", not
  "chatty assistant". UI affordances may use icons (Lucide) but agent
  reasoning text is plain prose.

## What this design is NOT

- Not a marketing site — no hero parallax, no gradient backgrounds.
- Not a glassmorphic dashboard — no `backdrop-filter`, no transparent
  cards. Solid surfaces, real shadows.
- Not a generic AI app — coral CTAs and Inter typography are tuned for
  financial trust, not for "AI sparkle". No purple, no gradient text.
- Not enterprise-bland — the coral exists precisely to keep the page from
  looking like every other navy-and-gray fintech tool.

## Reference

Tokens in this front matter map 1:1 to Tailwind v4 `@theme` variables in
`apps/web/src/index.css`. When a value here changes, rerun
`design.md export DESIGN.md --to tailwind` to regenerate the CSS variables.
