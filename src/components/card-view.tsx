import type { Card } from "@/lib/types";

/**
 * Renders one card the way a debater expects to see it: tag, cite, then the
 * body with underlined spans marked. Unmarked text stays visible but greyed,
 * since it's in the doc and not read aloud.
 */
export function CardView({ card }: { card: Card }) {
  return (
    <article className="border-t border-neutral-300 pt-5 dark:border-neutral-700">
      <h3 className="font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
        {card.tag}
      </h3>

      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">
          {card.cite.author}
        </span>
        {card.cite.qualification && <>, {card.cite.qualification}</>}
        {" — "}
        {card.cite.publication}
        {card.cite.date && <> ({card.cite.date.slice(0, 10)})</>}{" "}
        <a
          href={card.cite.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          link
        </a>
      </p>

      <p className="mt-3 font-serif text-[15px] leading-relaxed text-neutral-400 dark:text-neutral-500">
        {segment(card).map((part, i) =>
          part.underlined ? (
            <strong
              key={i}
              className="font-bold text-neutral-900 underline underline-offset-2 dark:text-neutral-50"
            >
              {part.text}
            </strong>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>

      {card.rationale && (
        <p className="mt-2 text-xs italic text-neutral-500 dark:text-neutral-500">
          {card.rationale}
        </p>
      )}
    </article>
  );
}

/** Split the body into underlined / not-underlined runs. */
function segment(card: Card): { text: string; underlined: boolean }[] {
  const parts: { text: string; underlined: boolean }[] = [];
  let cursor = 0;

  for (const { start, end } of [...card.underlines].sort((a, b) => a.start - b.start)) {
    if (start > cursor) {
      parts.push({ text: card.body.slice(cursor, start), underlined: false });
    }
    parts.push({ text: card.body.slice(start, end), underlined: true });
    cursor = end;
  }

  if (cursor < card.body.length) {
    parts.push({ text: card.body.slice(cursor), underlined: false });
  }

  return parts;
}
