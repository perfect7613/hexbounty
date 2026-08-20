# DESIGN.md: HexBounty inspired by Monad

## Source

- URL: https://www.monad.xyz/
- Capture date: 2026-08-17
- Evidence: Firecrawl `branding,images`, screenshot, metadata, and visible page hierarchy
- Target stack: Next.js 16, React, CSS modules/global CSS, existing shadcn-style primitives

## Reference Screenshot

![Monad homepage reference](./.firecrawl/monad-screenshot.png)

Use this screenshot as the visual source of truth for hierarchy, density, and feel. It is a style reference only: do not reuse Monad logos, copy, or proprietary imagery.

## Design Summary

HexBounty should feel like a dark experimental arcade and protocol lab: highly legible, technical, and playful. Translate Monad's violet signal color, strong contrast, thin grid rules, compact monospace metadata, and generous space onto a near-black canvas. Keep HexBounty's own name, product voice, game imagery, and reconstruction story.

The memorable gesture is a violet portal field behind a looping hero video: a Game Boy cartridge dissolves into annotated binary blocks, then resolves into a playable Tetris-like grid. The interface around it remains quiet and precise.

## Design Tokens

### Colors

- `--canvas: #08070d` — dark-only application canvas
- `--ink: #f7f6ff` — primary text
- `--muted: #aaa4c5` — supporting copy
- `--line: rgba(110, 84, 255, 0.28)` — fine grid and section rules
- `--panel: rgba(18, 16, 29, 0.84)` — elevated dark surface
- `--violet: #6e54ff` — observed primary/accent
- `--violet-soft: #eeeaff` — inferred selected/hover field
- `--violet-deep: #4f47eb` — inferred active edge from button shadow
- `--success: #16845b`, `--warning: #b66a00`, `--danger: #c83a4a` — functional states, used sparingly

Do not reintroduce teal as the dominant brand color or add a light theme. Violet is the signal; near-black and off-white carry the interface.

### Typography

- Display: existing local display face if already bundled; otherwise `Britti Sans`-style wide grotesk fallback using `ui-sans-serif`.
- Body: refined sans stack; use existing project font rather than downloading a new dependency.
- Technical labels: `Roboto Mono`, ui-monospace, monospace (observed).
- Hero: responsive `clamp(3.8rem, 8.5vw, 8.5rem)`, tight 0.88-0.94 line-height, slight negative tracking.
- Section title: `clamp(2.2rem, 4.5vw, 4.75rem)`.
- Card title: `clamp(1.25rem, 2vw, 2rem)`.
- Body: 16-19px, 1.55-1.7 line-height; never allow copy to collide with adjacent cards.
- Eyebrows/status: 11-13px mono, uppercase, 0.08-0.14em tracking.

### Spacing And Layout

- Base unit: 8px (observed).
- Content max width: about 1180px, matching the established application layout.
- Section rhythm: compact, with the existing hero/card hierarchy preserved.
- Borders: 1px `--line`; dark translucent panels use violet-tinted edges.
- Radius: retain the established rounded arcade panels; controls use 8-12px radii.
- Shadows: atmospheric violet glow over near-black surfaces.
- Mobile breakpoint: collapse multi-column structures before text narrows below roughly 22 characters.

## Components

### Header

- Dark translucent sticky header with a violet focus/accent treatment.
- HexBounty wordmark left, compact navigation centered/right, single wallet control at far right.
- Navigation: `Play Tetris`, `Upload game`, `Leaderboard`; no global Analysis item.
- Analysis is revealed per game with a `View game analysis` button.

### Hero

- Preserve the established full-width cinematic hero with overlaid copy.
- Copy should explain: upload a Game Boy binary, fund reconstruction on Monad, let Codex/Ghidra analyze it, publish, and earn MON when friends play.
- Primary CTA: `Upload a game`; secondary CTA: `Play Tetris`.
- Video is decorative, muted, autoplay, loop, playsInline, with a static poster and reduced-motion fallback.
- Violet aura, scanline/grid overlay, and one or two mono telemetry chips are appropriate. Avoid arcade-cabinet chrome.

### Workflow Steps

- Keep the established step-card sequence, but use two comfortable columns inside the home grid and a single column on narrow screens.
- Every step has number, short verb, and at most 2-3 concise lines. No paragraph should overflow or visually collide.
- Use a violet progress rule/connector and generous internal padding (28-36px).

Suggested steps: `Upload`, `Fund`, `Reconstruct`, `Publish`, `Play & earn`.

### Game Feature

- Keep featured games dynamic; do not ship a curated legacy-game exhibit or its binaries.
- Feature the recent dynamic game at `/games/tetris-amey` as `Tetris`.
- Treat this as a real marketplace listing: status, creator, price/access action, and player are sourced from the existing dynamic game APIs and contract flow.
- Do not copy or expose the private uploaded ROM. Do not invent a local Tetris ROM or hard-code bypass access.

### Cards And Forms

- Dark translucent panel surfaces, fine violet borders, off-white type, violet focus rings.
- Inputs are 48-52px high with visible labels and generous vertical grouping.
- Primary button: violet background, white text, 8px radius, observed inset/1px shadow.
- Secondary button: dark panel, off-white text, violet-tinted outline.

## Page Patterns

- Home: header → established hero/video → 5-step workflow → featured Tetris listing → footer.
- Upload: compact intro → one-column form with grouped sections and a persistent status/price summary on desktop.
- Dynamic game: game identity and access state first, player second, reconstruction details collapsed or below the fold.
- Preserve single-wallet control and SIWE behavior.

## Motion And Effects

- One orchestrated entrance: hero copy and video reveal in 60-90ms staggered steps.
- Violet portal uses slow radial drift, subtle grid parallax, and low-opacity grain.
- Buttons translate 1px on press; links use underline/arrow motion.
- Respect `prefers-reduced-motion`; disable autoplay animation effects beyond the poster for reduced motion.
- No constant card bobbing, excessive glow, or random neon gradients.

## Content Style

- Short, direct, outcome-led headings.
- Explain web3 terms in plain language; use `fund`, `publish`, `pay`, and `earn` rather than protocol jargon when possible.
- Be truthful: reconstruction is bounded and complex uploads may finish incomplete.
- Do not call games artifacts or exhibits in primary user-facing copy.

## Agent Build Instructions

1. Keep the generic Game Boy emulator used by dynamic paid games, without static per-game routes, manifests, reconstructed ROMs, or obsolete demo documentation.
2. Point primary play navigation and CTAs to `/games/tetris-amey`; label it `Play Tetris`.
3. Preserve the established home composition, while fixing the screenshot's narrow-card overflow at all breakpoints.
4. Apply tokens centrally through CSS variables. Keep wallet, SIWE, UploadThing, Modal, and contract flows intact.
5. Add the generated hero MP4 plus poster under `arcade/public/`; keep media reasonably compressed and provide a graceful fallback.
6. Test at 390px, 768px, 1280px, and 1440px. No horizontal overflow, clipped headings, or inaccessible controls.
7. Run lint, typecheck, tests, and production build. Do not push or deploy.

## Rerun Inputs

```text
workflow: firecrawl-website-design-clone
source_url: https://www.monad.xyz/
target_stack: Next.js 16 + React + existing CSS/shadcn primitives
output: DESIGN.md
```
