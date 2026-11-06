# Game Day – Timeline × Scoreboard implementation spec

Nov 6, 2026 · @dan

## Goal and scope

Restyle and restructure the Game Day main screen so games are grouped by status and kickoff time instead of by sport, in a light UI with scoreboard-style details. This spec is written for a coding agent working in the existing repo.

**Existing app.** Node server plus vanilla JS/CSS frontend, no build step, served at localhost:3000. Data comes from ESPN (scores, schedules, lineups) and Open-Meteo (weather). Keep it that way: no framework, no bundler, no new runtime dependencies. Web fonts load from Google Fonts with system fallbacks.

**In scope**

- Main screen layout: top bar, filter row, Live now, Coming up, Final, footer.
- New card and row components, design tokens, and the three web fonts.
- Grouping and sorting logic on the client.

**Out of scope (leave working as is)**

- Server routes, feed parsing, and the data shapes they return.
- The detail modal's content. Only re-skin it with the new tokens and fonts so it does not clash.
- Auto-refresh timing, keyboard shortcuts, and localStorage keys, except where this spec says otherwise.

**Before writing code:** read the current frontend files to find where cards are rendered and where the CSS custom properties are defined. Reuse the existing render functions' data access; replace their markup and styles.

## Design tokens

Define these as CSS custom properties on `:root`, replacing the current values. The design was drawn in light theme only; see Open decisions for dark.

| Token | Value | Used for |
| --- | --- | --- |
| `--bg` | `#F5F6F8` | Page background, weather panel background |
| `--surface` | `#FFFFFF` | Top bar, cards, active tab, active league chip |
| `--surface-2` | `#E9EBF0` | Tab group track |
| `--border` | `#DFE2E8` | Card borders, rail line, button borders, dashed dividers |
| `--text` | `#14171C` | Primary text |
| `--muted` | `#5A6270` | Secondary text, AWAY tag, losing team name |
| `--accent` | `#FFB703` | Header underline, Refresh button, HOME tag, rail marker fill, digits on dark tiles |
| `--board` | `#0B0E11` | Score tile background |
| `--board-line` | `#343C45` | Divider inside the live score tile |
| `--board-dim` | `#9AA4AE` | Losing score digits on a dark tile |
| `--chip-dark` | `#14171C` | League chip background (text is `--accent`) |
| `--live` | `#C62828` | "Live now" heading text |
| `--live-dot` | `#D32F2F` | Pulsing dot on light backgrounds |
| `--live-border` | `#EBC4C4` | Live card border |
| `--live-on-board` | `#FF8A8A` text, `#FF4D4D` dot | Live clock inside the dark tile |
| `--win` / `--draw` / `--loss` | `#3DDC84` / `#FFB703` / `#FF8A8A` | Form squares, always with `#0B0E11` letters |

**Accent rule.** Amber never carries text on a light background (contrast is too low). It is a fill with `--text` on top, or it is text on a dark tile or dark chip.

**Fonts**

| Role | Family | Use |
| --- | --- | --- |
| UI | Inter 400/500/600/700, then system-ui | Body, buttons, venue, TV network |
| Display | Barlow Condensed 600/700, uppercase | App title, day label, group headings, team names, weather condition |
| Numeric | JetBrains Mono 400/700 | Scores, clocks, kickoff times, records, spreads, counts, league chip, HOME/AWAY tag, badge letters, weather numbers |

Set `font-variant-numeric: tabular-nums` on the page.

**Shape and spacing**

- Radii: cards 14px; buttons and inputs 10px; league filter chips fully round; tab track 12px, tabs 9px; score tiles 10px (live) and 6px (row); team badges 6px (live) and 5px (row); league chip and tags 4px; form squares 2px.
- Live cards only: `box-shadow: 0 1px 2px rgba(20,23,28,0.05)`. Rows have no shadow.
- Page content is centered in a `max-width: 1120px` column with 32px side padding (16px under 600px). The top bar is full width.
- Pulse animation for live dots: opacity to 0.3 at 50%, 1.4s, infinite. Disable under `prefers-reduced-motion`.

## Page structure

The page is one column, top to bottom:

1. **Top bar** (sticky, full width, `--surface`, 3px `--accent` bottom border, wraps on narrow screens).
   - Left: "GAME DAY" in Display 700, 28px, letter-spacing 0.05em. Then the day label ("SUNDAY, NOVEMBER 8") in Display 600, 20px, `--muted`.
   - Right, pushed with `margin-left: auto`: previous-day button (‹), Today, next-day button (›), native date input, "Updated 1:42 PM" in Numeric 12px `--muted`, Refresh button (amber fill, `--text` label, weight 700).
   - All controls are at least 44px tall. Icon-only buttons need `aria-label`.
2. **Warning banner** (existing behavior): keep it directly under the top bar when a feed fails. Style it as a `--surface` strip with a 1px `--border` bottom and `--text` copy.
3. **Filter row** (wraps).
   - Left: sport tabs in a `--surface-2` track with 4px padding: All, NFL, NBA, Soccer. Each shows its game count in Numeric 12px `--muted`. The active tab is `--surface`. Use `aria-pressed`.
   - Right: league chips (EPL, LaLiga, BuLi, Serie A, Ligue 1, UCL, UEL), each with its count. On: `--surface` fill, 1px `--text` border, `--text` label. Off: transparent, 1px `--border`, `--muted` label.
4. **Live now · N**: heading in Display 700, 22px, `--live`, with the pulsing dot. Below it, a grid of live cards: `repeat(auto-fill, minmax(min(300px, 100%), 1fr))`, 14px gap. Hide the whole group when nothing is live.
5. **Coming up · N**: heading in Display 700, 22px, `--text`. Below it, rail rows, one per game, earliest kickoff first.
6. **Final · N**: same heading style. Rail rows, with "FT" or "Final" in the time column in `--muted`. Hide when empty.
7. **Footer**: 12px `--muted`: data attribution (ESPN, Open-Meteo) and the timezone note.

When the day has no games at all (after filters), show one empty-state card in place of the three groups: `--surface`, 14px radius, 1px `--border`, centered `--muted` text.

## Components

Two containers (live card, rail row) share the same small parts. Team order inside both follows the existing rule: away first for NFL and NBA, home first for soccer.

### Shared parts

| Part | Spec |
| --- | --- |
| Team badge | Keep the ESPN logo `<img>` (hidden on error, as today). Size 32px in live cards, 28px in rows. If the logo fails, fall back to a rounded square in the team color with the abbreviation in white Numeric 700, 9–10px. |
| Team name | Short name, Display 600, uppercase, letter-spacing 0.02em, single line with ellipsis. 24px in live cards, 21px in rows. `--muted` for the loser of a finished game. |
| HOME / AWAY tag | Numeric 700, 10px, padding 1px 6px, radius 4px. HOME: `--accent` fill, `--text` letters. AWAY: no fill, `--muted` letters. |
| League chip | `--chip-dark` fill, `--accent` text, Numeric 700, 11–12px, padding 2px 7px, radius 4px. Shows NFL, NBA, or the soccer league short name. |
| Form strip (soccer) | Five 16px squares, 3px gap, oldest to newest, letter W/D/L in Numeric 700 10px `#0B0E11` on `--win` / `--draw` / `--loss`. Keep the existing hover tooltip (result, score, vs/@ opponent, date, competition). |
| Record | Numeric 13px `--muted`, right-aligned in the team row. Shown only before kickoff. |
| Spread | Numeric 12px `--muted`, next to the TV network. NFL and NBA only. |

### Live card

A `--surface` card, 1px `--live-border`, radius 14px, in three stacked bands:

1. **Meta line** (padding 12px 16px 0, 12px `--muted`): league chip, TV network, spread.
2. **Body** (padding 12px 16px, flex row, 12px gap):
   - Left, flexible: the two team rows (badge, name, tag), 12px apart, vertically centered.
   - Right, fixed: the **score tile**. `--board` background, radius 10px, padding 8px 12px, min-width 84px, centered column. Two scores stacked, Numeric 700, 28px, `--accent`. Under them, above a 1px `--board-line` rule: pulsing dot plus the live clock ("Q2 8:42", "58'") in Numeric 700, 11px, `--live-on-board`.
3. **Foot** (padding 10px 16px, 1px dashed `--border` top, 12px `--muted`): "Venue · City" with ellipsis. Right-aligned when weather exists: weather icon plus "81° · 10%" in Numeric 700 `--text`; for domes show the icon and "Indoors". NBA shows no weather.

### Rail row

Each row is a flex line with three parts:

1. **Time column**, 84px wide, top padding 18px: kickoff time ("4:25 PM") in Numeric 700, 13px, `--text`. In the Final group it shows "FT" (soccer) or "Final" in `--muted`.
2. **Rail**: the row's content wrapper has a 2px `--border` left border and 22px left padding. A marker sits on the line 20px from the top: 8px square, radius 2px, `--accent` fill, 2px `--text` border.
3. **Card**: `--surface`, 1px `--border`, radius 14px, 12px below it before the next row. Inside, a wrapping flex row:
   - **Main area** (`flex: 999 1 420px`, padding 14px 16px, wraps, 12px 24px gap):
     - Teams block (`flex: 2 1 280px`): two team rows, 8px apart. Each row: badge, name, tag, form strip (soccer), then right-aligned either the record (before kickoff) or a small score tile (final).
     - Info block (`flex: 1 1 190px`, 13px `--muted`): line 1 league chip, TV network, spread; line 2 venue in `--text` weight 500; line 3 city.
   - **Weather panel** (`flex: 1 0 120px`, NFL and soccer only): `--bg` background, 1px `--border` line on its top and left edges, padding 12px, centered column. Icon 26px in `--text`; temperature in Numeric 700, 22px; condition in Display 600, 16px; then "9 mph · 10%" in Numeric 11px `--muted`. Dome: house icon, "INDOORS", "Dome or roof", no temperature. Missing forecast: thermometer icon and "No forecast". The panel drops below the main area when the card is too narrow.

**Small score tile (finals):** `--board` background, radius 6px, padding 2px 8px, min-width 34px, Numeric 700, 18px. Winner's digits `--accent`; loser's digits `--board-dim`. In a draw both are `--accent`.

### Interaction

Live cards and rail-row cards open the existing detail modal on click. Make each one focusable (a `<button>` or `<a>` wrapper, or `tabindex="0"` with Enter/Space handling as today) with a visible focus ring: 2px `--text` outline, 2px offset. Hover: border darkens to `--text` at 40% opacity.

## Grouping, sorting and state rules

The client merges all three sports into one list, then splits it by status. The feeds already expose pre / in-progress / post state per game; use that.

| Group | Contains | Sort | Container |
| --- | --- | --- | --- |
| Live now | Games in progress | NFL, then NBA, then soccer; within a sport by kickoff time | Live card |
| Coming up | Games not started | Kickoff time ascending; ties broken NFL, NBA, soccer | Rail row |
| Final | Finished games | Kickoff time ascending | Rail row |

- **Counts.** Each group heading shows its count after filters. Sport tabs show per-sport totals for the day; league chips show per-league totals.
- **Sport tabs.** All shows every game. NFL, NBA or Soccer narrows all three groups to that sport. Persist the selected tab in localStorage under a new key.
- **League chips.** They hide or show soccer leagues, persisted with the existing localStorage key. They have no effect on NFL or NBA games. Disable them (reduced opacity, `aria-disabled`) when the NFL or NBA tab is active.
- **Postponed, delayed or cancelled games.** Put them in Coming up with the status word in the time column in place of a kickoff time, sorted by their original time.
- **Halftime and breaks.** Still Live now; show the feed's short status text ("Half", "HT", "End Q1") in place of the clock.
- **Past and future dates.** On a past day everything lands in Final; on a future day everything lands in Coming up. Empty groups are hidden.
- **Loser dimming.** Applies only to finished games: losing team name `--muted`, losing score digits `--board-dim`.
- **Transitions.** On refresh, a game moves between groups by re-rendering; no animation is required.

## Responsive, accessibility and preserved behaviors

**Responsive.** The layout uses flex-wrap and auto-fill grids, so it needs only one breakpoint.

- Live grid: three columns at desktop width, one column on a phone, with no media query.
- Rail row: the weather panel wraps under the main area when the card is narrower than about 540px; the info block wraps under the teams block below about 500px.
- Under 600px: side padding 16px; time column 64px; top-bar controls wrap to a second line; the filter row stacks tabs above chips.
- No horizontal page scroll at 360px width. Long team names truncate with ellipsis.

**Accessibility**

- Real `<button>` elements for all controls; `aria-pressed` on tabs and chips; `aria-label` on the icon-only previous/next buttons and the date input.
- Group headings are `<h2>`. Each card or row is an `<article>` with an accessible name such as "Bills at Dolphins, live, 14 to 10".
- Weather icons carry the condition as `aria-label`; decorative dots and rail markers are `aria-hidden`.
- Form squares carry the letter, so result is never conveyed by color alone. Live state is conveyed by the word and position as well as color.
- Text contrast is at least 4.5:1 with the tokens above. Do not place `--accent` text on `--surface` or `--bg`.

**Behaviors to keep unchanged**

- Keyboard: left/right arrows change day, Enter/Space opens a focused card, Esc closes the modal.
- Auto-refresh: every 60s while any game is live, every 5 minutes on today's date otherwise, and on tab re-focus.
- Team logos hide on load error. Local kickoff times. "Updated" stamp after each refresh.
- Weather icon set (sun, cloud-sun, cloud, fog, drizzle, rain, snow, storm, thermometer, indoor): reuse the existing inline SVGs, drawn with `currentColor`, stroke width about 1.8.

## Open decisions and acceptance checklist

**Open decisions.** Each has a default the agent should take unless told otherwise.

| Question | Default |
| --- | --- |
| Dark theme: the mockup is light only, but the current app follows `prefers-color-scheme`. | Keep dark support. Suggested dark values: `--bg #0B0E11`, `--surface #14181D`, `--surface-2 #1C2128`, `--border #2C333B`, `--text #F2F4F5`, `--muted #9AA4AE`, `--chip-dark #242A31`, `--board #000000`, `--live #FF6B6B`, `--live-border #B33A3A`. Accent and form colors stay the same. These are untested; check contrast. |
| Sport tabs are new; the original brief had fixed NFL / NBA / Soccer sections. | Build the tabs as specified. |
| Soccer weather is now a full side panel in rows, where the brief had a small chip. | Use the panel for both NFL and soccer. |
| The per-sport section order is gone. | Status grouping replaces it; sport order survives only as the tie-breaker. |
| Detail modal restyle depth. | Tokens and fonts only; no layout changes. |

**Acceptance checklist**

- [ ] Tokens and three fonts are in place; no leftover references to removed tokens.
- [ ] A day with live, upcoming and finished games shows three groups in that order, with correct counts.
- [ ] Live cards show the dark score tile with amber digits and a pulsing live clock.
- [ ] Coming up rows are in kickoff order with the time on the rail; Final rows show small score tiles with the loser dimmed.
- [ ] NFL and soccer rows show the weather panel, including the dome and no-forecast states; NBA rows show none.
- [ ] Soccer rows show five-square form strips with working tooltips.
- [ ] Sport tabs and league chips filter correctly and persist across reloads.
- [ ] Empty groups are hidden; a day with no games shows the empty-state card.
- [ ] Clicking or pressing Enter on any card opens the detail modal; Esc closes it; arrow keys change the day.
- [ ] Auto-refresh intervals behave as before.
- [ ] No horizontal scroll at 360px; layout verified at 360, 768 and 1280px.
- [ ] Tested against a 0-game day and a heavy day (16 NFL, 15 NBA, 30 soccer).

**Reference.** The visual source of truth is the "6 · Timeline × Scoreboard" artboard on the Game Day design canvas. Its sample matchups, scores and weather are placeholders, not real data.
