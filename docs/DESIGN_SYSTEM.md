# LocalDeck design system

All styling lives in `src/styles.css`. Theme logic lives in `src/theme.ts`, and a matching inline script in `index.html` applies the saved theme before first paint.

## Themes

`<html data-theme="…">` selects a token set. Components use only the semantic tokens below and never raw colors, so every screen works in every theme.

| Theme | Mode | Background | Surface | Accent |
|---|---|---|---|---|
| Obsidian (default dark) | dark | `#0B0C12` | `#171821` | `#A78BFA` |
| Midnight | dark | `#090E1A` | `#121A2B` | `#7AA2F7` |
| Forest | dark | `#090F0D` | `#121C18` | `#5DD5A2` |
| Rose | dark | `#100C0F` | `#1C161A` | `#F08FB4` |
| Pearl | light | `#F4F3F8` | `#FFFFFF` | `#6546D6` |
| System | follows `prefers-color-scheme` | Pearl or Obsidian | | |

A custom accent (Settings → Appearance) overrides `--accent`, `--accent-rgb` and `--on-accent` inline on `<html>`. `readableAccent` in `src/theme.ts` darkens the picked color in Pearl, or lightens it in the dark themes, until it reaches 4.5:1 as text on every surface and on its own 14% tint. `--on-accent` is whichever of white or near-black has more contrast. The top-bar sun/moon button switches between Pearl and Obsidian. Preferences are stored in `localStorage` under `localdeck-appearance`.

### Semantic tokens

- Surfaces: `--bg`, `--sidebar`, `--surface` (cards, panels), `--elevated` (menus, dialogs, buttons), `--interactive` (hover fills, tracks), `--code-bg`, `--player-bg`, `--glass` (translucent bars), `--scrim`
- Text: `--text`, `--text-2` (secondary), `--muted` (tertiary, metadata). All three reach 4.5:1 on every surface.
- Lines: `--line`, `--line-strong` (decorative), `--field` (edges of inputs, chips and switches, at least 3:1)
- Create-account green: `--go`
- Accent: `--accent`, `--accent-2`, `--on-accent`, `--accent-soft` (14% tint), `--accent-softer` (8%), `--accent-line` (32%)
- Status: `--success`, `--warning`, `--error`
- Elevation: `--shadow-1` (resting), `--shadow-2` (hover/hero), `--shadow-3` (menus, dialogs)

## Typography

Inter Variable, bundled through `@fontsource-variable/inter` so it also works offline. It falls back to system fonts. Body text is 14px/1.5. The smallest text is 11px (tab bar labels) and metadata is 12–12.5px.

| Role | Size | Weight |
|---|---|---|
| Page title | `clamp(26px, 2.6vw, 34px)` | 700, −0.032em |
| Hero title | `clamp(28px, 3vw, 42px)`, max 3 lines | 720 |
| Section title | 19px | 650 |
| Card title | 14.5px | 620 |
| Body / controls | 13.5–14px | 500–600 |

Labels use sentence case, with no all-caps eyebrows.

## Spacing and shape

The spacing scale is a 4/8px rhythm. Page padding is 40px on desktop, 28px below 1280px, 20px on tablet and 16px on phone. Grid gaps are 20px on desktop and 12px on phone.

Corner radii: controls `--r-sm` 10px, buttons/inputs `--r-md` 12px, cards `--r-card` 18px, panels `--r-surface` 22px, dialogs `--r-dialog` 24px, hero and import surfaces 26px.

## Signature element: generated covers

A project without its own cover gets deterministic SVG artwork (`generatedCoverImage` in `src/shared.tsx`). It is seeded from the title, subject and type. Each content type has its own hue pair and motif: pixel grid (game), ruled sheet (learning/PDF), answer rows (quiz), orbits (simulation), slide with chart (presentation), app tiles (app/tool), waves (other). The title is set on the cover in white with a bottom gradient. When a real cover exists it is layered on top and the overlaid title is hidden. On Home, the featured project's art is blurred into the hero backdrop and shown again as a tilted card.

## Components and where they live

- `src/shared.tsx` holds the cards and helpers that every screen uses. `ItemCard` is the grid card: clicking the cover opens the project and clicking the title opens its details. `ItemRow` is the list-view row. `ItemMenu` is the actions menu, opened from the ••• button or by right-clicking a card or row. `Shelf` is a titled row of cards with a "See all" link. `Chips` are the type filters. `colorFor` gives each subject a stable color. Every project action comes from one `ItemActionsContext` that `App` provides.
- `src/views.tsx` holds the screens: Home (hero, shelves, collection tiles, quick access), `LibraryView` (All items, Favorites, Recently opened, Learning hub, Games & apps), Collections (cover-mosaic tiles) and the project details page at `#/item/<id>`.
- Library pages have a grid/list toggle, remembered in `localStorage` under `localdeck-library-view`. Recently opened is grouped by day. Learning hub and Games & apps show subject or genre tiles that filter the page.

## Layout and responsive rules

- Above 860px: fixed 250px sidebar (228px below 1280px), sticky translucent top bar.
- 860px and below: the sidebar becomes a drawer, and a bottom tab bar (Home, Library, Learn, Import, More) appears with safe-area padding.
- 640px and below: compact top bar (search icon only), stacked page headings, full-width actions, bottom-sheet dialogs, full-screen code editor, two-row player toolbar.
- 380px and below: single-column card grid.
- Card grid: `repeat(auto-fill, minmax(232px, 1fr))`.

## Interaction and motion

- Cards lift 2px on hover, the art zooms 4.5%, and the play button fades in. On touch devices the play button is always visible.
- Menus and dialogs use a short pop (140–180ms, `--ease`). Route changes fade and slide 8px through Motion.
- Focus: a 2px accent outline on `:focus-visible` everywhere.
- Keyboard: menus, tabs, chips and view switches use `rovingKeys` from `src/a11y.tsx` (arrow keys, Home, End). Overlays call `useReturnFocus`, and the page behind the player and quick search is `inert`. Escape closes them.
- Pause: `MotionToggle` (top bar, and bottom right on the sign-in pages) sets `.ambient-paused` on `<html>` and stops every endless loop. Scripted motion must check `useStillMotion()`.
- Touch: under `@media (pointer: coarse)` every control is at least 44px high.
- Reduced motion: honours `prefers-reduced-motion`, and the Settings toggle adds `.reduce-motion` to `<html>`. Higher contrast: `prefers-contrast: more` strengthens lines and secondary text.
