#!/usr/bin/env python3
"""Snapshot the live leaderboard into a static JSON file the game can fall back to.

The game reads this file whenever Supabase is unreachable, so the hall of fame stays readable
forever -- it is served from GitHub Pages alongside the game and needs no backend at all. Run
weekly by .github/workflows/leaderboard-snapshot.yml; also runnable by hand:

    python scripts/snapshot_leaderboard.py

Only the publishable (anon) key is used. It is read-only by RLS and already public in chess.js,
so this needs no secrets.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://froggegesqnoznvenoyt.supabase.co")
ANON_KEY = os.environ.get(
    "SUPABASE_ANON_KEY", "sb_publishable_JFBcrijOlFo2S8EucZl4HA_4ej0DSpo"
)
OUT = os.environ.get("SNAPSHOT_OUT", "leaderboard-snapshot.json")

# Keep in step with LB_BOARDS in chess.js. `asc` boards rank by lowest value.
BOARDS = [("hs_untimed", False), ("hs_15s", False)]
ROWS_PER_BOARD = 25  # LB_MAX_ROWS is 15; the extra gives headroom without bloating the file


def fetch_board(key: str, asc: bool):
    order = "asc" if asc else "desc"
    url = (
        f"{SUPABASE_URL}/rest/v1/scores?board=eq.{key}"
        f"&select=name,value,created_at&order=value.{order}&limit={ROWS_PER_BOARD}"
    )
    req = urllib.request.Request(
        url, headers={"apikey": ANON_KEY, "Authorization": "Bearer " + ANON_KEY}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.status != 200:
            raise RuntimeError(f"{key}: HTTP {r.status}")
        return json.load(r)


def main() -> int:
    boards = {}
    for key, asc in BOARDS:
        try:
            boards[key] = fetch_board(key, asc)
            print(f"  {key}: {len(boards[key])} rows")
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, TimeoutError) as e:
            # One failing board must not blow away a good snapshot of the other, nor replace a
            # previous snapshot with an empty one.
            print(f"  {key}: FAILED ({e})", file=sys.stderr)
            return 1

    if not any(boards.values()):
        print("every board came back empty -- refusing to overwrite the snapshot", file=sys.stderr)
        return 1

    snap = {
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SUPABASE_URL,
        "boards": boards,
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(snap, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {OUT} at {snap['fetched_at']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
