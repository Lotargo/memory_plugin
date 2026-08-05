import assert from "node:assert";
import {
  parseFactEntry,
  factText,
  factMeta,
  factTitle,
  factBody,
  autoGenerateTitle,
  withTitleAndBody,
} from "./fact_format.js";

console.log("--- Running Part A1 Unit Tests ---");

const line1 = "- [2026-08-01 12:03] **Title here** — user prefers TypeScript";
const line2 = "- [2026-08-01 12:03] user prefers TypeScript"; // legacy / plain
const line3 = "- [2026-08-01 12:03] **Another Title**: some content <!-- id:12345 -->";

// Test factTitle
assert.strictEqual(factTitle(line1), "Title here");
assert.strictEqual(factTitle(line2), "user prefers TypeScript");
assert.strictEqual(factTitle(line3), "Another Title");

// Test factBody
assert.strictEqual(factBody(line1), "user prefers TypeScript");
assert.strictEqual(factBody(line2), "user prefers TypeScript");
assert.strictEqual(factBody(line3), "some content");

// Test autoGenerateTitle
assert.strictEqual(autoGenerateTitle("**Explicit Title** - fact here"), "Explicit Title");
assert.strictEqual(autoGenerateTitle("This is a simple fact. With some more sentences."), "This is a simple fact");
assert.strictEqual(autoGenerateTitle("Key — some value"), "Key");

// Test withTitleAndBody
const updatedLine = withTitleAndBody(line1, { title: "New Title", body: "New Body" });
assert.strictEqual(factTitle(updatedLine), "New Title");
assert.strictEqual(factBody(updatedLine), "New Body");

const updatedLine2 = withTitleAndBody(line2, { title: "Added Title" });
assert.strictEqual(factTitle(updatedLine2), "Added Title");
assert.strictEqual(factBody(updatedLine2), "user prefers TypeScript");

console.log("✅ All Part A1 tests passed!");
