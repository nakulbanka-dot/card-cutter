"""
Which sentences did the debater actually underline?

Every card in the user's own files carries character spans for underlining and
highlighting. That is the most direct supervision in the whole dataset: not
"this article is relevant" or even "this paragraph is cuttable", but "these
exact words do the argumentative work, and the rest is context I kept for
honesty."

Nothing has used it yet. It supports a feature the product currently cannot
offer — handing back a passage with the card already underlined — and it is
its own training signal: given a tag and a paragraph, mark the sentences that
prove it.

Labelling rule: a sentence is positive when at least a third of its characters
fall inside an underline span. Debaters underline mid-sentence constantly, so
requiring full coverage would label almost nothing; a third is enough to mean
the sentence was being used rather than brushed.
"""
import json, re
from pathlib import Path

SRC = Path("data/cards.jsonl")
OUT = Path("data/training/highlight.jsonl")
MIN_COVER = 0.33


# Citation fragments masquerading as sentences.
#
# "Everything before the first underline is the cite" is not enough: debaters
# routinely underline into the citation line, and the splitter breaks on the
# dots inside a URL, so "https://www.commondreams.org/opinion/..." arrives as
# several short "sentences" carrying high underline coverage. Left in, the
# model would learn that URLs are worth underlining.
CITE_MARKER = re.compile(
    r"https?://|www\.|\baccessed\b|\bdoa\b|\bretrieved\b|\bdoi\b|//[a-z]{2,4}\b", re.I)


def is_cite_fragment(t: str) -> bool:
    if CITE_MARKER.search(t):
        return True
    # Dense with digits and punctuation, thin on words — a date/page string.
    noisy = sum(1 for ch in t if ch.isdigit() or ch in "[](){};:,/|—-")
    return noisy / max(1, len(t)) > 0.25


def sentences(text: str):
    """Sentence spans, kept as offsets so they line up with the mark spans."""
    for m in re.finditer(r"[^.!?]+(?:[.!?]+|$)", text):
        s, e = m.start(), m.end()
        t = text[s:e].strip()
        if len(t.split()) >= 5 and not is_cite_fragment(t):
            yield s, e, t


def covered(start, end, spans):
    """Characters of [start,end) that fall inside any span."""
    n = 0
    for sp in spans:
        a, b = max(start, sp["start"]), min(end, sp["end"])
        if b > a:
            n += b - a
    return n


def main():
    cards = kept = pos = neg = 0
    with SRC.open() as fin, OUT.open("w") as out:
        for line in fin:
            if not line.strip():
                continue
            c = json.loads(line)
            cards += 1
            tag, body = (c.get("tag") or "").strip(), c.get("body") or ""
            marks = c.get("underlines") or []
            if not tag or not body or not marks:
                continue

            # Everything before the first mark is the citation block, not prose.
            first = min(m["start"] for m in marks)
            rows = []
            for s, e, t in sentences(body):
                if e <= first:
                    continue
                frac = covered(s, e, marks) / max(1, e - s)
                label = 1 if frac >= MIN_COVER else 0
                rows.append({"tag": tag, "sentence": t, "label": label,
                             "cover": round(frac, 3), "source": c.get("source", "")})

            # A card with no contrast teaches nothing about where to stop.
            if not rows or not any(r["label"] for r in rows) or all(r["label"] for r in rows):
                continue
            for r in rows:
                out.write(json.dumps(r) + "\n")
                pos += r["label"]
                neg += 1 - r["label"]
            kept += 1

    print(f"cards read          {cards:,}")
    print(f"cards usable        {kept:,}  (have both underlined and passed-over sentences)")
    print(f"sentences           {pos + neg:,}   underlined {pos:,} ({pos/(pos+neg):.1%})")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
