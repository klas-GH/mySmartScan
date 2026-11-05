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

const { execFileSync } = require("child_process");
const path = require("path");

const SUITES = [
  "zip.test.js",
  "utils.test.js",
  "state.test.js"
];

let failedCommands = 0;

for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===\n`);
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, suite)], {
      cwd: __dirname,
      stdio: "pipe",
      encoding: "utf8"
    });
    process.stdout.write(out);
  } catch (error) {
    process.stdout.write(error.stdout || "");
    process.stderr.write(error.stderr || "");
    failedCommands++;
  }
}

// Run the ZIP self-test inside the sandbox, which is normally
// disabled during app startup.
console.log("\n=== ZIP self-test (runZipSelfTest) ===\n");
try {
  const zipSelfTest = [
    "const h = require('./tests/harness.js');",
    "const ok = h.getSandbox().runZipSelfTest();",
    "console.log(ok ? 'ZIP self-test PASSED' : 'ZIP self-test FAILED');",
    "process.exit(ok ? 0 : 1);"
  ].join(" ");
  const out = execFileSync(process.execPath, ["-e", zipSelfTest], {
    cwd: path.join(__dirname, ".."),
    stdio: "pipe",
    encoding: "utf8"
  });
  process.stdout.write(out);
} catch (error) {
  process.stdout.write(error.stdout || "");
  process.stderr.write(error.stderr || "");
  failedCommands++;
}

const commandCount = SUITES.length + 1;
console.log(
  `\nTest run complete: ${commandCount - failedCommands}/${commandCount} commands passed.`
);
process.exitCode = failedCommands ? 1 : 0;
