"""
Convert the slim openCaselist parquet into JSONL for the trainer.

Deliberately does no feature engineering. Features are computed once, in
TypeScript, by the same code the live ranker uses — if they were computed
here too, the two implementations would drift and the model would quietly
stop matching what it was trained on. This script only changes the format.

  python3 scripts/export-training-jsonl.py [--max N] [--min-dupes N] [--event pf]
"""
import argparse, json, glob, os, re, sys
import pyarrow.parquet as pq

ap = argparse.ArgumentParser()
ap.add_argument("--max", type=int, default=0, help="cap rows (0 = all)")
ap.add_argument("--min-dupes", type=int, default=0,
                help="keep only cards re-cut at least this many times")
ap.add_argument("--event", default="", help="filter to one event, e.g. pf / ld / cx")
ap.add_argument("--out", default="data/training/cards.jsonl")
args = ap.parse_args()

parts = sorted(glob.glob("data/opencaselist/slim/part-*.parquet"))
if not parts:
    sys.exit("No shards found. Run scripts/fetch-opencaselist.py first.")

os.makedirs(os.path.dirname(args.out), exist_ok=True)

def as_int(v):
    m = re.search(r"\d+", str(v or ""))
    return int(m.group()) if m else 0

kept = skipped = 0
by_event, by_year = {}, {}

with open(args.out, "w", encoding="utf-8") as out:
    for path in parts:
        table = pq.read_table(path)
        cols = {c: table.column(c).to_pylist() for c in table.column_names}

        for i in range(table.num_rows):
            tag = (cols["tag"][i] or "").strip()
            body = (cols["fulltext"][i] or "").strip()
            spoken = (cols["spoken"][i] or "").strip()

            # A usable example needs something asked for and something chosen.
            if len(tag) < 15 or len(body) < 200:
                skipped += 1
                continue

            dupes = as_int(cols["duplicateCount"][i])
            if dupes < args.min_dupes:
                skipped += 1
                continue

            event = (cols["event"][i] or "").strip()
            if args.event and event != args.event:
                skipped += 1
                continue

            out.write(json.dumps({
                "id": cols["id"][i],
                "tag": tag,
                "body": body,
                "spoken": spoken,
                "summary": (cols["summary"][i] or "").strip(),
                "cite": (cols["fullcite"][i] or cols["cite"][i] or "").strip(),
                # How many teams independently re-cut this card. The only
                # quality label in the corpus that isn't our own opinion.
                "dupes": dupes,
                "year": (cols["year"][i] or "").strip(),
                "event": event,
                "level": (cols["level"][i] or "").strip(),
                # A = affirmative, N = negative. Two cards on the same topic
                # from opposite sides are the only stance-contrast pairs the
                # corpus contains, and stance is what keywords cannot see.
                "side": (cols["side"][i] or "").strip(),
                "bucketId": cols["bucketId"][i],
            }, ensure_ascii=False) + "\n")

            kept += 1
            by_event[event] = by_event.get(event, 0) + 1
            y = (cols["year"][i] or "").strip()
            by_year[y] = by_year.get(y, 0) + 1

            if args.max and kept >= args.max:
                break
        if args.max and kept >= args.max:
            break
        print(f"  {os.path.basename(path)}  kept={kept:,}", flush=True)

size = os.path.getsize(args.out) / 1e6
print(f"\nkept {kept:,}  skipped {skipped:,}  ->  {args.out}  ({size:.0f} MB)")
print("by event:", dict(sorted(by_event.items(), key=lambda x: -x[1])[:8]))
print("by year :", dict(sorted(by_year.items())[-8:]))
