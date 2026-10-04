import test from "node:test";
import assert from "node:assert/strict";
import { readCapped } from "./read-capped.ts";

/** A body that hands out `chunks` pieces of `size` characters, and counts how many were read. */
function streamed(chunks: number, size: number) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(new TextEncoder().encode("a".repeat(size)));
    },
  });
  return { res: new Response(body), pulled: () => pulled };
}

test("returns the whole body when it is under the cap", async () => {
  assert.equal(await readCapped(new Response("short page"), 100), "short page");
});

test("cuts the text at the cap", async () => {
  const { res } = streamed(10, 1_000);
  assert.equal((await readCapped(res, 2_500)).length, 2_500);
});

test("stops downloading once the cap is reached", async () => {
  const { res, pulled } = streamed(1_000, 1_000);
  await readCapped(res, 3_000);
  // A chunk or two of read-ahead is fine; reading all thousand is the bug.
  assert.ok(pulled() < 10, `read ${pulled()} chunks`);
});

test("keeps multi-byte characters intact across chunk boundaries", async () => {
  const bytes = new TextEncoder().encode("“quoted” — café");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const b of bytes) controller.enqueue(new Uint8Array([b]));
      controller.close();
    },
  });
  assert.equal(await readCapped(new Response(body), 100), "“quoted” — café");
});

test("an empty body is an empty string", async () => {
  assert.equal(await readCapped(new Response(null), 100), "");
});
