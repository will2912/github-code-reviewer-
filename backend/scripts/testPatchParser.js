import assert from "node:assert";
import { parsePatch } from "../service/patchParser.js";

const patch = [
    "@@ -10,4 +10,5 @@ function login(user) {",
    " function login(user) {",
    "-  const b = 2;",
    "+  const b = 3;",
    "+  const c = 4;",
    "   return b;",
    " }",
    "@@ -40,3 +41,3 @@ function logout() {",
    "   x();",
    "-  y();",
    "+  z();",
    "   done();"
].join("\n");

const { regions, commentableLines } = parsePatch(patch);

assert.strictEqual(regions.length, 2);

assert.strictEqual(regions[0].startLine, 11);
assert.strictEqual(regions[0].endLine, 12);
assert.strictEqual(regions[0].added.length, 2);
assert.strictEqual(regions[0].removed.length, 1);

assert.strictEqual(regions[1].startLine, 42);
assert.strictEqual(regions[1].endLine, 42);

assert.deepStrictEqual(
    [...commentableLines].sort((a, b) => a - b),
    [10, 11, 12, 13, 14, 41, 42, 43]
);

// a region that only deletes code
const deletionOnly = parsePatch(["@@ -5,3 +5,2 @@", " a", "-b", " c"].join("\n"));
assert.strictEqual(deletionOnly.regions.length, 1);
assert.strictEqual(deletionOnly.regions[0].isPureDeletion, true);
assert.strictEqual(deletionOnly.regions[0].startLine, 6);

console.log("All patchParser tests passed");