/*
 * SmartScan test harness.
 *
 * Loads the real app.js source in a Node sandbox that mimics the
 * browser, then exposes the pure functions for direct testing.
 *
 * Usage:
 *   node tests/harness.js
 *
 * The harness is intentionally dependency-free and runs under Node.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { buildBrowserStub } = require("./browser-stub");

const APP_SRC = fs.readFileSync(
  path.join(__dirname, "..", "app.js"),
  "utf8"
);

function createSandbox() {
  const stub = buildBrowserStub();
  const sandbox = stub;
  sandbox.console = console;

  // runZipSelfTest is intentionally disabled during normal app
  // startup; run it explicitly from the test harness instead.
  const src = APP_SRC.replace(
    "// runZipSelfTest();",
    "// runZipSelfTest(); // disabled during app startup"
  );

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "app.js" });

  return sandbox;
}

let sandbox = null;
function getCtx() {
  if (!sandbox) sandbox = createSandbox();
  return sandbox;
}

function ctx() {
  return getCtx();
}

function getSandbox() {
  return getCtx();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${message}: expected ${b}, got ${a}`);
  }
}

module.exports = { ctx, assert, assertEqual, assertDeepEqual, getCtx, getSandbox };