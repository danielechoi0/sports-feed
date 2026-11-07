"""Turn raw ESPN match summaries into flat tables.

    python -m pipeline.extract

Writes data/tables/{matches,appearances,shots,events}.csv.gz:
  matches      one row per match: teams, score, team shots/SOT/possession,
               formations, shots counted from commentary (for the check)
  appearances  one row per player who played: minutes on/off, shots, SOT,
               goals, saves, position
  shots        one row per shot from the commentary: minute, team, shooter,
               outcome, field position, body part, assist type, penalty
  events       goals, red cards and substitutions with their minute
Match minutes are "base + added time" (45'+2' -> 47), which is close enough
for minute-level rates.
"""
import gzip
import json
import re
from collections import Counter

import pandas as pd

from .config import LEAGUES, RAW, TABLES

MIN_RE = re.compile(r"(\d+)'?(?:\s*\+\s*(\d+))?")


def minute(txt):
    m = MIN_RE.search(str(txt or ""))
    if not m:
        return None
    return int(m.group(1)) + (int(m.group(2)) if m.group(2) else 0)


def pos_group(abbr):
    a = str(abbr or "").upper()
    if a in ("G", "GK"):
        return "G"
    if re.match(r"^(CD|LB|RB|LWB|RWB|D|CB|SW)", a):
        return "D"
    if re.match(r"^(AM|LW|RW|W|LAM|RAM)", a):
        return "AM"
    if re.match(r"^(F|CF|ST|SS|LF|RF)", a):
        return "F"
    return "M"


def stat(p, name):
    for s in p.get("stats") or []:
        if s.get("name") == name:
            try:
                return float(s.get("value", s.get("displayValue")) or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


SHOT_TYPES = {
    "shot off target": "off",
    "shot on target": "saved",
    "shot blocked": "blocked",
    "shot hit woodwork": "woodwork",
    "goal": "goal",
    "goal - header": "goal",
    "goal - free-kick": "goal",
    "goal - volley": "goal",
    "penalty - scored": "goal",
    "penalty - saved": "saved",
    "penalty - missed": "off",
}


def shot_outcome(type_text, text):
    t = str(type_text or "").lower()
    if t in SHOT_TYPES:
        return SHOT_TYPES[t]
    if t.startswith("goal") and "own goal" not in t:
        return "goal"
    if t.startswith("penalty"):
        return "goal" if "scored" in t else "off"
    return None


def body_part(text):
    t = text.lower()
    if "header" in t:
        return "head"
    if "left footed" in t:
        return "left"
    if "right footed" in t:
        return "right"
    return "other"


def assist_type(text):
    t = text.lower()
    if "following a corner" in t or "from a corner" in t:
        return "corner"
    if "free kick" in t and "direct" in t:
        return "direct_fk"
    if "following a set piece" in t or "set piece situation" in t:
        return "set_piece"
    if "fast break" in t:
        return "fast_break"
    if "with a cross" in t:
        return "cross"
    if "through ball" in t:
        return "through_ball"
    if "with a headed pass" in t:
        return "headed_pass"
    if "assisted by" in t:
        return "pass"
    return "none"


def zone(text):
    t = text.lower()
    for key, z in (
        ("six yard box", "six_yard"),
        ("very close range", "six_yard"),
        ("centre of the box", "box_centre"),
        ("side of the box", "box_side"),
        ("outside the box", "outside"),
        ("more than 35 yards", "long"),
        ("long range", "long"),
        ("difficult angle", "angle"),
    ):
        if key in t:
            return z
    return "unknown"


def extract_match(league, d):
    hdr = d["header"]
    comp = hdr["competitions"][0]
    eid = str(hdr["id"])
    season = hdr.get("season", {}).get("year")
    teams = {}
    for c in comp.get("competitors", []):
        teams[str(c["team"]["id"])] = {
            "id": str(c["team"]["id"]),
            "name": c["team"].get("displayName"),
            "home": c.get("homeAway") == "home",
            "goals": int(c.get("score") or 0),
        }
    if len(teams) != 2:
        return None
    name_to_team = {t["name"]: tid for tid, t in teams.items()}
    home_id = next(t for t, v in teams.items() if v["home"])
    away_id = next(t for t, v in teams.items() if not v["home"])

    # Team stats from the box score.
    tstats = {}
    for t in (d.get("boxscore") or {}).get("teams", []):
        s = {x.get("name"): x.get("displayValue") for x in t.get("statistics", [])}
        tstats[str(t["team"]["id"])] = s

    def tnum(tid, key):
        try:
            return float(str(tstats.get(tid, {}).get(key, "")).replace("%", ""))
        except ValueError:
            return None

    commentary = d.get("commentary") or []
    end_min = max([minute((x.get("time") or {}).get("displayValue")) or 0 for x in commentary] + [90])

    # Appearances.
    apps = []
    name_to_player = {}
    formations = {}
    for r in d.get("rosters") or []:
        tid = str((r.get("team") or {}).get("id"))
        if tid not in teams:
            continue
        formations[tid] = r.get("formation")
        for p in r.get("roster") or []:
            a = p.get("athlete") or {}
            pid = str(a.get("id"))
            name_to_player[(tid, a.get("displayName"))] = pid
            plays = p.get("plays") or []
            subs = [minute(x.get("clock", {}).get("displayValue")) for x in plays if x.get("substitution")]
            subs = [m for m in subs if m is not None]
            reds = [minute(x.get("clock", {}).get("displayValue")) for x in plays if x.get("redCard")]
            reds = [m for m in reds if m is not None]
            starter = bool(p.get("starter"))
            on = 0 if starter else (subs[0] if p.get("subbedIn") and subs else None)
            if on is None:
                continue  # unused substitute
            off = end_min
            if p.get("subbedOut"):
                outs = subs if starter else subs[1:]
                if outs:
                    off = outs[0]
            red = reds[0] if reds else None
            if red is not None:
                off = min(off, red)
            pos = (p.get("position") or {}).get("abbreviation")
            apps.append(
                {
                    "match_id": eid,
                    "team_id": tid,
                    "opp_id": away_id if tid == home_id else home_id,
                    "home": tid == home_id,
                    "player_id": pid,
                    "name": a.get("displayName"),
                    "pos": pos,
                    "pos_group": pos_group(pos),
                    "starter": starter,
                    "on_min": on,
                    "off_min": off,
                    "minutes": max(0, off - on),
                    "red_min": red,
                    "shots": stat(p, "totalShots"),
                    "sot": stat(p, "shotsOnTarget"),
                    "goals": stat(p, "totalGoals"),
                    "saves": stat(p, "saves"),
                    "conceded": stat(p, "goalsConceded"),
                }
            )

    # Shots from commentary.
    shots = []
    for x in commentary:
        pl = x.get("play") or {}
        ttext = (pl.get("type") or {}).get("text")
        outcome = shot_outcome(ttext, x.get("text", ""))
        if outcome is None:
            continue
        tname = (pl.get("team") or {}).get("displayName")
        tid = name_to_team.get(tname)
        if tid is None:
            continue
        parts = pl.get("participants") or []
        shooter = (parts[0].get("athlete") or {}).get("displayName") if parts else None
        text = x.get("text") or pl.get("text") or ""
        shots.append(
            {
                "match_id": eid,
                "team_id": tid,
                "player_id": name_to_player.get((tid, shooter)),
                "name": shooter,
                "minute": minute((pl.get("clock") or {}).get("displayValue")),
                "period": (pl.get("period") or {}).get("number"),
                "outcome": outcome,
                "on_target": outcome in ("goal", "saved"),
                "goal": outcome == "goal",
                "penalty": str(ttext or "").lower().startswith("penalty") or "penalty" in text.lower()[:60],
                "x": pl.get("fieldPositionX"),
                "y": pl.get("fieldPositionY"),
                "body": body_part(text),
                "assist": assist_type(text),
                "zone": zone(text),
                "type_text": ttext,
            }
        )

    # Events: goals (incl. own goals), red cards, substitutions.
    events = []
    for k in d.get("keyEvents") or []:
        ttext = str((k.get("type") or {}).get("text") or "")
        tid = str((k.get("team") or {}).get("id") or "")
        m = minute((k.get("clock") or {}).get("displayValue"))
        low = ttext.lower()
        kind = None
        if "own goal" in low:
            kind = "own_goal"
        elif k.get("scoringPlay") or low.startswith("goal") or low == "penalty - scored":
            kind = "goal"
        elif "red card" in low:
            kind = "red"
        elif low == "substitution":
            kind = "sub"
        if kind and tid in teams:
            events.append({"match_id": eid, "team_id": tid, "minute": m, "kind": kind, "type_text": ttext})

    shot_count = Counter(s["team_id"] for s in shots)
    match = {
        "match_id": eid,
        "league": league,
        "season": season,
        "date": comp.get("date") or hdr.get("competitions", [{}])[0].get("date"),
        "home_id": home_id,
        "away_id": away_id,
        "home_name": teams[home_id]["name"],
        "away_name": teams[away_id]["name"],
        "home_goals": teams[home_id]["goals"],
        "away_goals": teams[away_id]["goals"],
        "home_shots": tnum(home_id, "totalShots"),
        "away_shots": tnum(away_id, "totalShots"),
        "home_sot": tnum(home_id, "shotsOnTarget"),
        "away_sot": tnum(away_id, "shotsOnTarget"),
        "home_poss": tnum(home_id, "possessionPct"),
        "away_poss": tnum(away_id, "possessionPct"),
        "home_formation": formations.get(home_id),
        "away_formation": formations.get(away_id),
        "end_min": end_min,
        "home_shots_comm": shot_count.get(home_id, 0),
        "away_shots_comm": shot_count.get(away_id, 0),
        "n_commentary": len(commentary),
    }
    return match, apps, shots, events


def main():
    rows = {"matches": [], "appearances": [], "shots": [], "events": []}
    bad = 0
    for league in LEAGUES:
        for path in sorted((RAW / league).glob("*.json.gz")):
            with gzip.open(path, "rt") as f:
                d = json.load(f)
            try:
                out = extract_match(league, d)
            except Exception as e:  # noqa: BLE001
                print(f"{path.name}: {e}")
                bad += 1
                continue
            if not out:
                bad += 1
                continue
            m, a, s, e = out
            rows["matches"].append(m)
            rows["appearances"] += a
            rows["shots"] += s
            rows["events"] += e
    TABLES.mkdir(parents=True, exist_ok=True)
    for name, r in rows.items():
        pd.DataFrame(r).to_csv(TABLES / f"{name}.csv.gz", index=False)
        print(f"{name}: {len(r)} rows")
    if bad:
        print(f"skipped {bad} matches")


if __name__ == "__main__":
    main()
