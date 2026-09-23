import test from "node:test";
import assert from "node:assert/strict";
import { usefulQual } from "./metadata.ts";

test("a heading is not a qualification", () => {
  // "About Elissa Tennant" reached a live citation: the heading above the bio
  // rather than the bio, admitted by the very rule meant to keep junk out —
  // that a real bio names the person.
  assert.equal(usefulQual("About Elissa Tennant", "Elissa Tennant"), false);
  assert.equal(usefulQual("More from Wei Chen", "Wei Chen"), false);
  assert.equal(usefulQual("Posts by John Smith", "John Smith"), false);
});

test("a real qualification survives", () => {
  assert.ok(usefulQual("Senior Fellow, Brookings Institution", "Wei Chen"));
  assert.ok(usefulQual(
    "Gregorio Bettiza is Senior Lecturer in International Relations at Exeter",
    "Gregorio Bettiza",
  ));
  assert.ok(usefulQual("Professor of Economics at Stanford University", "Jane Doe"));
});

test("the outlet's own name is not a qualification", () => {
  assert.equal(
    usefulQual("Canada's National Observer", "Elizabeth McSheffrey", "Canada's National Observer"),
    false,
  );
});
