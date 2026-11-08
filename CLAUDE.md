# sports-dashboard

Dependency-free Node 20+ app (server.js, lib/, public/, api/ for Vercel) plus an offline Python pipeline (pipeline/) that trains the soccer shot model. Under 300 tokens; situational rules go in .claude/rules/.

## Run
- Install: none for the app. Pipeline: `python -m venv .venv && .venv/Scripts/pip install -r pipeline/requirements.txt`
- Dev server: `npm run dev` (http://localhost:3000)
- Test: `node --test "test/*.test.js"` (no network)
- Model parity after an export: `node pipeline/parity.mjs`, `node pipeline/parity-pooled.mjs`
- Lint/typecheck: none configured

## Hard rules
- No npm dependencies in the app. No new Python deps without saying so.
- Never hand-edit: `models/*.json` (from `pipeline.export`), `pipeline/reports/` (generated + experiment ledger), `data/`.
- Never run pipeline commands with `--unseal` (sealed test split) unless asked.
- Small, revertible changes. One concern per commit.
- Before claiming done: run the test command and show the pass/fail line.

## Working style
- Use the `explore` agent to locate code; do not read whole directories into context.
- Use `logreader` after tests instead of reading raw output.
- Run `reviewer` on the diff before you say a task is finished.
- Keep PROGRESS.md current (3–6 lines: done / in progress / next). Re-read it after any compaction.
