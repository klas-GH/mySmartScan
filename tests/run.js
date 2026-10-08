/*
 * SmartScan — test runner.
 *
 * Runs every suite under tests/ plus the ZIP self-test (which is
 * normally disabled during app startup) and reports a summary.
 *
 * Usage:
 *   node tests/run.js
 */

"use strict";

const { execSync } = require("child_process");
const path = require("path");

const SUITES = [
  "zip.test.js",
  "utils.test.js"
];

let totalPassed = 0;
let totalFailed = 0;

for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===\n`);
  try {
    const out = execSync(`node ${path.join(__dirname, suite)}`, {
      cwd: __dirname,
      stdio: "pipe",
      encoding: "utf8"
    });
    process.stdout.write(out);
  } catch (error) {
    process.stdout.write(error.stdout || "");
    process.stderr.write(error.stderr || "");
  }
}

// Run the ZIP self-test inside the sandbox, which is normally
// disabled during app startup.
console.log("\n=== ZIP self-test (runZipSelfTest) ===\n");
try {
  const out = execSync(
    `node -e "const h=require('./tests/harness.js'); const c=h.getSandbox(); const ok=c.runZipSelfTest(); console.log(ok ? 'ZIP self-test PASSED' : 'ZIP self-test FAILED'); process.exit(ok?0:1);"`,
    { cwd: path.join(__dirname, ".."), stdio: "pipe", encoding: "utf8" }
  );
  process.stdout.write(out);
} catch (error) {
  process.stdout.write(error.stdout || "");
  process.stderr.write(error.stderr || "");
}

console.log("\nAll suites complete.");