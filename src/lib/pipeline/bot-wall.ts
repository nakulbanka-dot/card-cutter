/**
 * Recognising a page that blocked us instead of serving the article.
 *
 * Kept in its own module, with no imports, for two reasons. It is used by both
 * extraction and the citation path, and it has to be reachable from a test
 * without dragging in the Tavily client — the previous test copied the pattern
 * inline precisely to avoid that, and then passed while the real check went
 * unexercised.
 *
 * A wall returns a full page of text, so a length check waves it through and
 * it ranks on keyword overlap like any other source.
 */

const BOT_WALL =
  /(checking your browser|recaptcha|cloudflare|are you a robot|enable javascript to continue|access denied|verify you are human|ddos protection|attention required)/i;

/** True when the page is a block screen rather than an article. */
export function isWall(title: string, body: string): boolean {
  // Title and opening only; an article may legitimately discuss these words.
  return BOT_WALL.test(title) || BOT_WALL.test(body.slice(0, 400));
}

/**
 * The same test for a title on its own.
 *
 * Citation metadata is fetched in a second request, separate from the one that
 * read the article, and a site that served the extractor can still block that
 * one. The wall's <title> then becomes the article title and reaches the
 * citation the user pastes onto a card, even though the body is genuine.
 */
export function looksLikeBotWall(title: string): boolean {
  return BOT_WALL.test(title);
}
