# Game Day – design brief

## Product
A single-page local web app that aggregates every game relevant to the user on a given day: NFL, NBA, and soccer from the Premier League, LaLiga, Bundesliga, Serie A, Ligue 1, Champions League and Europa League. Node server + vanilla JS/CSS frontend, no build step, runs at localhost:3000. Light and dark themes via `prefers-color-scheme`. Responsive down to phone width.

## Global layout
- Sticky top bar: app title, human-readable day label ("Friday, November 6"), date controls (prev / Today / next, native date picker), "Updated 3:02 PM" stamp, Refresh button.
- Optional warning banner under the top bar when a feed fails.
- Three stacked sections in fixed order: NFL, NBA, Soccer. Each has a heading, a game count, and a responsive card grid (auto-fill, ~340px min column). Empty-state card when a section has no games.
- Soccer section header carries league filter chips (EPL, LaLiga, BuLi, Serie A, Ligue 1, UCL, UEL) with per-league counts; toggling hides/shows leagues, persisted in localStorage.
- Footer with data attribution (ESPN, Open-Meteo) and timezone note.
- Keyboard: left/right arrows change day, Enter/Space opens a focused card, Esc closes the modal.
- Auto-refresh: every 60s when any game is live, every 5 min on today's date otherwise; also on tab re-focus.

## Game card: common elements
- Top line: league chip, broadcast network(s), betting spread (NFL/NBA), and a status slot on the right: local kickoff time (pre), live clock with pulsing red dot (in progress), "FT"/"Final" (post).
- Two team rows: logo, name, HOME/AWAY tag (HOME accented), record. Pre-game the right column shows the record; live/final it shows the score, with the loser dimmed.
- Bottom line: venue name and city.
- Whole card is clickable (and focusable) to open the detail modal; live cards get a red-tinted border.

## Soccer card (home listed first)
- Each team row also has a five-chip form strip (W green / D amber / L red), oldest to newest, with hover tooltip: result, score, vs/@ opponent, date, competition.
- Bottom-right weather chip: icon, temperature °F, rain probability, wind mph. Tooltip gives condition and geocoded place.

## NFL card (away listed first)
- Right-hand weather side panel separated by a divider: weather icon, large temperature, condition label, wind and precipitation chance. Domes show a house icon and "Indoors / Dome or roof". Missing forecast shows a thermometer and "No forecast".
- Stacks the panel below the teams on narrow screens.

## NBA card (away listed first)
- Standard card only; no weather.

## Detail modal (all sports)
- Centered card over a dimmed backdrop, close button, header with both logos, names, big scores (if started), then a subline: status, venue, broadcast, spread.
- Body is a responsive two-column panel grid; panels are subdued boxes with uppercase small-caps headings carrying the team logo and a right-aligned context label.

## Soccer detail
- One lineup panel per team: formation in the heading, starting XI ordered by formation place (shirt number, name, position abbreviation, on/off substitution flags), collapsible substitutes list.
- If lineups aren't published yet: a full-width note ("Starting XIs are not out yet…") followed by each team's most recent starting XI, titled with that match's result, score, opponent, date, competition.
- Key events panel (full width): minute, icon (goal / yellow / red), player, event type, team.
- "Last 5" table per team: result chip, score, opponent logo and name with vs/@, competition, date (newest first).
- Weather panel: icon, large temperature, condition, wind with gusts, precipitation chance, place.

## NFL detail
- Rankings panel per team: 2×2 tiles for Pass offense, Rush offense, Pass defense, Rush defense. Each tile shows an ordinal rank (large; green for top quarter, red for bottom quarter, neutral otherwise) and yards per game. Footnote: games counted, "through week N".
- Injuries panel per team: player name, position, injury type/side, expected return date, and a status pill (Out / Injured Reserve red; Questionable / Day-To-Day amber; Probable green).
- Weather panel as in soccer.

## NBA detail
- Once tipped: per-team panel with starters (number, name, position, minutes and points), a Bench sub-list, and a collapsible "Did not play" list with reason.
- Pre-game: full-width note ("Starting fives post at tip-off…"), then per-team roster panels (healthy players first, then injured with status pills), followed by injury panels.

## Visual system currently in place
- CSS custom properties for bg / surface / surface-2 / border / text / muted / accent, plus win/draw/loss and rank-good/mid/bad colors, with light and dark values.
- System font stack, 14px-radius cards, soft shadows, tabular numerals for scores and clocks, inline SVG weather icon set (sun, cloud-sun, cloud, fog, drizzle, rain, snow, storm, thermometer, indoor).

## Data notes a designer should know
- Team logos come from ESPN URLs and may fail to load (hidden on error).
- Team names can be long ("Borussia Mönchengladbach"); cards use short names and ellipsis truncation, modals use full names.
- Soccer lineups appear ~1 hour before kickoff; NBA starters only at tip-off; the "not yet" states are first-class, not edge cases.
- A day can hold 0–16 NFL games, 0–15 NBA games, 0–30 soccer matches.
