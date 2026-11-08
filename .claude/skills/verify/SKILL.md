---
name: verify
description: Run the project's verification gate (tests, lint, typecheck) and report only failures. Use before declaring any task complete.
model: haiku
effort: low
---

Run, in order, the Test and Lint/typecheck commands from CLAUDE.md (skip any marked "none"). Pipe each through `tail -60`.

Report:
- One line per command: PASS or FAIL with counts.
- For failures: name, file:line, one-line message.
- Nothing else.

If everything passes, reply exactly: "Gate: PASS" plus the counts line.
