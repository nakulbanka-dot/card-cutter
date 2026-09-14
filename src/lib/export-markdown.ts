import type { FindResponse } from "./pipeline/free";

/**
 * Builds the block you paste into Claude (or any assistant you already pay
 * for) to do the cutting. This is the free path to Opus-quality judgment:
 * the expensive stage runs inside a subscription you already have, instead of
 * being billed per token through the API.
 *
 * The preamble carries the same verbatim rule the paid pipeline enforces in
 * code. Here it's an instruction rather than a guarantee — a human is checking
 * the output, which is the trade you accept for it being free.
 */

const PREAMBLE = `Below are passages I pulled from sources on a debate claim.
Cut evidence cards from them.

For each card give me:
- TAG: one sentence, the claim the card proves, written to be read aloud
- CITE: author, their qualification, publication, date
- BODY: the passage copied EXACTLY, word for word
- The MLA line is already generated from the page's metadata — reuse it, and
  say so if a field is marked missing rather than inventing one

Rules:
- Do not reword, tighten, or fix the grammar of the body. Copy it character
  for character. A card whose body has been altered is a fabricated card.
- If a passage isn't worth cutting, say so and skip it. Most won't be.
- Then mark which phrases of the body should be underlined for reading aloud
  (aim for 20-40%) — the claim, the mechanism, the magnitude.`;

export function toMarkdown(result: FindResponse): string {
  const lines: string[] = [PREAMBLE, ""];

  lines.push(
    `CLAIM: ${result.query}`,
    "I want evidence that SUPPORTS this claim.",
    "",
    "---",
    "",
  );

  if (result.sources.length === 0) {
    lines.push("_No sources found._");
    return lines.join("\n");
  }

  result.sources.forEach((source, i) => {
    lines.push(`## Source ${i + 1}: ${source.title}`);
    lines.push(`URL: ${source.url}`);
    lines.push(`MLA: ${source.mla}`);
    if (source.missingCiteFields.length > 0) {
      lines.push(
        `(citation is missing: ${source.missingCiteFields.join(", ")} — fill in before using)`,
      );
    }
    lines.push("");

    source.passages.forEach((passage, j) => {
      lines.push(`### Passage ${i + 1}.${j + 1}`);
      lines.push("");
      // Blockquoted so the assistant can see exactly where the text begins
      // and ends, which matters when it's told to copy verbatim.
      lines.push(
        passage.text
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n"),
      );
      lines.push("");
    });

    lines.push("---", "");
  });

  return lines.join("\n");
}
