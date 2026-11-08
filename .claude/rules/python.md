---
paths: ["pipeline/**/*.py"]
---
- Offline only: the app never imports the pipeline. Run modules as `python -m pipeline.<name>` from the repo root.
- Type hints on public functions. Prefer dataclasses over dicts for structured records.
- Every prediction may use only matches that kicked off earlier; never leak the dev/test splits into training.
- After changing anything that feeds `pipeline.export`, re-export and run the matching `node pipeline/parity*.mjs`.
- No new dependencies without saying so in the reply.
