/*
 * SmartScan — utility & crop-math suite.
 *
 * Tests pure helper functions: filename sanitisation, crop
 * normalisation/clamping, escapeHtml, and the filter mapping.
 */

"use strict";

const { ctx, assert, assertEqual } = require("./harness");

let passed = 0;
let failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

const c = ctx();

console.log("Utility functions");
run("escapeHtml escapes ampersand", () => {
  assertEqual(c.escapeHtml("a & b"), "a &amp; b", "amp");
});
run("escapeHtml escapes angle brackets", () => {
  assertEqual(c.escapeHtml("<div>"), "&lt;div&gt;", "angle");
});
run("escapeHtml escapes quotes", () => {
  assertEqual(c.escapeHtml('a "b" \'c\''), "a &quot;b&quot; &#039;c&#039;", "quotes");
});
run("escapeHtml defaults to empty string", () => {
  assertEqual(c.escapeHtml(), "", "default");
});

console.log("Filename sanitisation");
run("strips path separators", () => {
  const name = c.exportFileName("a/b\\c:d*e?f<g>h|i", "pdf");
  assert(!name.includes("/"), "no slash");
  assert(!name.includes("\\"), "no backslash");
  assert(name.endsWith(".pdf"), "extension kept");
});
run("collapses whitespace", () => {
  const name = c.exportFileName("  my   doc  ", "jpg");
  assertEqual(name, "my doc.jpg", "whitespace collapsed");
});
run("truncates to 80 chars", () => {
  const long = "x".repeat(200);
  const name = c.exportFileName(long, "pdf");
  assert(name.length <= "x".repeat(80).length + ".pdf".length, "truncated");
});
run("handles Windows reserved names", () => {
  assertEqual(c.exportFileName("con", "pdf"), "con-document.pdf", "con");
  assertEqual(c.exportFileName("PRN", "pdf"), "PRN-document.pdf", "PRN");
  assertEqual(c.exportFileName("nul", "pdf"), "nul-document.pdf", "nul");
  assertEqual(c.exportFileName("com1", "pdf"), "com1-document.pdf", "com1");
  assertEqual(c.exportFileName("lpt9", "pdf"), "lpt9-document.pdf", "lpt9");
});
run("empty name falls back to document", () => {
  assertEqual(c.exportFileName("", "pdf"), "document.pdf", "empty");
  assertEqual(c.exportFileName("   ", "pdf"), "document.pdf", "spaces");
});
run("strips leading/trailing dots", () => {
  const name = c.exportFileName(".hidden.", "pdf");
  assert(!name.startsWith("."), "no leading dot");
  assertEqual(name, "hidden.pdf", "dots stripped, ext kept");
});

console.log("Crop math");
run("normalizeCrop returns null for full crop", () => {
  assertEqual(c.normalizeCrop({ x: 0, y: 0, w: 1, h: 1 }), null, "full");
});
run("normalizeCrop keeps partial crop", () => {
  const crop = c.normalizeCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  assert(crop, "partial kept");
  assertEqual(crop.x, 0.1, "x");
  assertEqual(crop.y, 0.1, "y");
  assertEqual(crop.w, 0.5, "w");
  assertEqual(crop.h, 0.5, "h");
});
run("normalizeCrop clamps out-of-range values", () => {
  const crop = c.normalizeCrop({ x: -0.5, y: 2, w: 5, h: 5 });
  assert(crop.x >= 0, "x clamped low");
  assert(crop.y >= 0, "y clamped low");
  assert(crop.x + crop.w <= 1, "x+w clamped");
  assert(crop.y + crop.h <= 1, "y+h clamped");
});
run("normalizeCrop returns null for null input", () => {
  assertEqual(c.normalizeCrop(null), null, "null");
});

console.log("Filter mapping");
run("filterStyle maps known filters", () => {
  assertEqual(c.filterStyle("original"), "none", "original");
  assertEqual(c.filterStyle("grayscale"), "grayscale(1)", "grayscale");
  assertEqual(c.filterStyle("bw"), "grayscale(1) contrast(2)", "bw");
  assertEqual(c.filterStyle("enhance"), "contrast(1.15) brightness(1.04) saturate(.8)", "enhance");
});
run("filterStyle falls back to none", () => {
  assertEqual(c.filterStyle("unknown"), "none", "unknown");
  assertEqual(c.filterStyle(), "none", "undefined");
});

console.log("Image resolution");
run("resolveImageSync returns a data URL placeholder on cache miss", () => {
  const result = c.resolveImageSync("img_does_not_exist");
  assert(typeof result === "string", "returns a string");
  assert(result.startsWith("data:image/svg+xml;utf8,"), "placeholder is a data URL");
  assert(result.length > 0, "placeholder is not empty");
});
run("resolveImageSync returns empty placeholder for falsy key", () => {
  assertEqual(c.resolveImageSync(null), c.resolveImageSync(undefined), "null and undefined agree");
  assert(c.resolveImageSync(null).startsWith("data:image/svg+xml;utf8,"), "null -> placeholder");
});
run("resolveImageSync passes through data: URLs", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  assertEqual(c.resolveImageSync(dataUrl), dataUrl, "data: passthrough");
});
run("resolveImageSync passes through blob: URLs", () => {
  const blobUrl = "blob:abc123";
  assertEqual(c.resolveImageSync(blobUrl), blobUrl, "blob: passthrough");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);