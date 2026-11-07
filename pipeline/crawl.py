"""Download every completed match of the configured leagues and seasons.

    python -m pipeline.crawl            # all configured leagues/seasons
    python -m pipeline.crawl --refresh  # re-list matches (new games this week)

Lists matches with one scoreboard request per league per calendar year
(`dates=YYYY`), keeps completed matches whose season is configured, then
downloads each match summary once into data/raw/<league>/<id>.json.gz.
Re-runs only fetch what is missing, so the crawl is resumable and incremental.
"""
import argparse
import gzip
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from .config import LEAGUES, RAW, SEASONS, SITE

UA = {"User-Agent": "sports-feed-shot-pipeline/1.0"}


def get_json(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as e:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)
    return None


def list_matches(league, refresh=False):
    """[{id, date, season}] for completed matches in configured seasons."""
    index = RAW / league / "_index.json"
    if index.exists() and not refresh:
        return json.loads(index.read_text())
    years = sorted({y for s in SEASONS for y in (s, s + 1)})
    seen = {}
    for year in years:
        d = get_json(f"{SITE}/{league}/scoreboard?dates={year}&limit=1000")
        for e in d.get("events", []):
            season = (e.get("season") or {}).get("year")
            if season not in SEASONS:
                continue
            if not e.get("status", {}).get("type", {}).get("completed"):
                continue
            # Cup competitions (UCL, UEL) are keyed by the season's starting year
            # like the leagues: group/league phase in the autumn, knockouts in
            # the next calendar year, all under the same season.year.
            seen[e["id"]] = {"id": e["id"], "date": e["date"], "season": season, "stage": (e.get("season") or {}).get("slug")}
    out = sorted(seen.values(), key=lambda x: x["date"])
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(json.dumps(out))
    return out


def fetch_summary(league, eid):
    path = RAW / league / f"{eid}.json.gz"
    if path.exists():
        return "cached"
    d = get_json(f"{SITE}/{league}/summary?event={eid}")
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt") as f:
        json.dump(d, f)
    tmp.rename(path)
    return "fetched"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-list matches")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--leagues", nargs="*", default=LEAGUES)
    args = ap.parse_args()
    for league in args.leagues:
        matches = list_matches(league, args.refresh)
        by_season = {}
        for m in matches:
            by_season[m["season"]] = by_season.get(m["season"], 0) + 1
        print(f"{league}: {len(matches)} completed matches {by_season}", flush=True)
        counts = {"cached": 0, "fetched": 0, "failed": 0}
        with ThreadPoolExecutor(args.workers) as ex:
            futs = {ex.submit(fetch_summary, league, m["id"]): m["id"] for m in matches}
            for i, f in enumerate(as_completed(futs), 1):
                try:
                    counts[f.result()] += 1
                except Exception as e:  # noqa: BLE001
                    counts["failed"] += 1
                    print(f"  {futs[f]} failed: {e}", file=sys.stderr)
                if i % 200 == 0:
                    print(f"  {i}/{len(matches)} {counts}", flush=True)
        print(f"  done {counts}", flush=True)


if __name__ == "__main__":
    main()
