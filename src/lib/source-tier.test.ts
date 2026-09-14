import test from "node:test";
import assert from "node:assert/strict";
import { classifySource, archiveUrl } from "./source-tier.ts";

const cat = (u: string) => classifySource(u).category;

test("journals are peer-reviewed tier 1", () => {
  assert.equal(cat("https://www.nature.com/articles/x"), "Peer-reviewed");
  assert.equal(classifySource("https://doi.org/10.1234/y").tier, 1);
});

test(".edu and law repositories are academic", () => {
  assert.equal(cat("https://digitalcommons.law.umaryland.edu/jbtl/vol1"), "Academic");
  assert.equal(cat("https://economics.mit.edu/paper"), "Academic");
});

test(".gov and .mil are government", () => {
  assert.equal(cat("https://www.eia.gov/todayinenergy/detail.php"), "Government");
  assert.equal(cat("https://www.army.mil/report"), "Government");
});

test("think tanks and major news are tier 2", () => {
  assert.equal(classifySource("https://www.brookings.edu/x").tier, 1, "brookings.edu is .edu");
  assert.equal(classifySource("https://www.csis.org/analysis/x").tier, 2);
  assert.equal(classifySource("https://www.reuters.com/world/x").tier, 2);
});

test("self-published platforms drop to the bottom", () => {
  assert.equal(classifySource("https://medium.com/@someone/post").tier, 4);
  assert.equal(classifySource("https://substack.com/p/x").tier, 4);
});

test("subdomains inherit their parent's classification", () => {
  assert.equal(cat("https://journals.sagepub.com/doi/x"), "Peer-reviewed");
  assert.equal(cat("https://www.bbc.co.uk/news/x"), "Major news");
});

test("an unknown .org is a weak think tank, not peer-reviewed", () => {
  assert.equal(classifySource("https://someadvocacy.org/x").tier, 3);
});

test("malformed urls degrade instead of throwing", () => {
  assert.equal(classifySource("not a url").category, "Other");
  assert.equal(classifySource("").tier, 4);
});

test("archive url is encoded", () => {
  assert.ok(archiveUrl("https://wsj.com/a?b=c").startsWith("https://archive.is/newest/"));
  assert.ok(archiveUrl("https://wsj.com/a?b=c").includes("%3A%2F%2F"));
});
