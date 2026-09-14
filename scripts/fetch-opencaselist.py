"""
Pull the openCaselist corpus (MIT, ~4.8M cards) into a slim local dataset.

Drops the `markup` column, which is ~47% of the bytes and redundant: `spoken`
and `summary` already carry the highlighted and underlined text, and the
verbatim matcher can locate them inside `fulltext` when positions are needed.

Streams one shard at a time — download, project, delete — so peak disk stays
under a gigabyte rather than needing the full 27.6 GB at once. Resumable: a
part that already exists is skipped.
"""
import os, subprocess, sys, time
import pyarrow.parquet as pq

N_SHARDS = 109
BASE = "https://huggingface.co/datasets/Yusuf5/OpenCaselist/resolve/main/data"
OUT = "data/opencaselist/slim"
TMP = "data/opencaselist/_tmp.parquet"

KEEP = [
    "id", "tag", "cite", "fullcite", "summary", "spoken", "fulltext",
    "bucketId", "duplicateCount", "side", "year", "event", "level",
    "caselistName", "schoolId", "teamId",
]

os.makedirs(OUT, exist_ok=True)
started = time.time()
total_rows = 0
done = 0

for i in range(N_SHARDS):
    part = f"{OUT}/part-{i:05d}.parquet"
    if os.path.exists(part):
        total_rows += pq.ParquetFile(part).metadata.num_rows
        done += 1
        continue

    url = f"{BASE}/train-{i:05d}-of-00109.parquet"
    for attempt in range(3):
        r = subprocess.run(["curl", "-sfL", "--max-time", "600", "-o", TMP, url])
        if r.returncode == 0:
            break
        print(f"  shard {i}: download failed (attempt {attempt + 1}), retrying", flush=True)
        time.sleep(5)
    else:
        print(f"  shard {i}: GAVE UP", flush=True)
        continue

    table = pq.read_table(TMP, columns=KEEP)
    pq.write_table(table, part, compression="zstd")
    os.remove(TMP)

    total_rows += table.num_rows
    done += 1
    elapsed = time.time() - started
    rate = done / elapsed if elapsed else 0
    eta = (N_SHARDS - done) / rate / 60 if rate else 0
    print(
        f"[{done:3d}/{N_SHARDS}] {total_rows:>9,} cards  "
        f"{elapsed/60:5.1f}m elapsed  ~{eta:4.1f}m left",
        flush=True,
    )

size = subprocess.run(["du", "-sh", OUT], capture_output=True, text=True).stdout.split()[0]
print(f"\nDONE  {total_rows:,} cards  ->  {OUT}  ({size})")
