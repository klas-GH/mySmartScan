/*
 * Minimal browser/DOM stub used by the SmartScan Node test harness.
 *
 * It is intentionally tiny: it only provides enough of the browser
 * surface area for app.js to load and for the pure, dependency-free
 * functions (ZIP, PDF, crop math, filename sanitisation, etc.) to be
 * exercised. Nothing here fakes scanning, OCR or storage behaviour.
 */

function makeStubElement() {
  const el = {
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === true) this._classes.add(c);
        else if (force === false) this._classes.delete(c);
        else if (this._classes.has(c)) this._classes.delete(c);
        else this._classes.add(c);
        return this._classes.has(c);
      },
      contains(c) { return this._classes.has(c); }
    },
    style: {},
    dataset: {},
    _children: [],
    _listeners: new Map(),
    addEventListener(type, fn) {
      const set = this._listeners.get(type) || [];
      set.push(fn);
      this._listeners.set(type, set);
    },
    removeEventListener(type, fn) {
      const set = this._listeners.get(type);
      if (!set) return;
      for (let i = 0; i < set.length; i++) {
        if (set[i] === fn) { set.splice(i, 1); return; }
      }
    },
    appendChild(child) { this._children.push(child); return child; },
    remove() {},
    removeChild() { return null; },
    append() {},
    click() {},
    focus() {},
    select() {},
    setSelectionRange() {},
    setPointerCapture() {},
    getBoundingClientRect() {
      return { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
    },
    closest() { return null; },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  Object.defineProperty(el, "innerHTML", { get: () => "", set: () => {} });
  Object.defineProperty(el, "textContent", { get: () => "", set: () => {} });
  return el;
}

function makeDocument() {
  const doc = {
    _listeners: new Map(),
    addEventListener(type, fn) {
      const set = this._listeners.get(type) || [];
      set.push(fn);
      this._listeners.set(type, set);
    },
    removeEventListener(type, fn) {
      const set = this._listeners.get(type);
      if (!set) return;
      for (let i = 0; i < set.length; i++) {
        if (set[i] === fn) { set.splice(i, 1); return; }
      }
    },
    getElementById() { return makeStubElement(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeStubElement(); },
    body: makeStubElement(),
    head: makeStubElement(),
    appendChild() {}
  };
  return doc;
}

function makeWindow() {
  const listeners = new Map();
  return {
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    scrollTo() {},
    addEventListener(type, fn) {
      const set = listeners.get(type) || [];
      set.push(fn);
      listeners.set(type, set);
    },
    removeEventListener() {},
    Tesseract: undefined
  };
}

function makeNavigator() {
  return {
    storage: {
      persist() { return Promise.resolve(false); },
      estimate() { return Promise.resolve({ usage: 0, quota: 0 }); }
    },
    clipboard: { writeText() { return Promise.resolve(); } },
    share() { return Promise.resolve(); },
    canShare() { return false; }
  };
}

function makeFileReader() {
  return function () {
    const r = makeStubElement();
    r.readAsDataURL = function () {};
    r.readAsArrayBuffer = function () {};
    return r;
  };
}

function makeUrl() {
  return {
    createObjectURL() { return "blob:stub"; },
    revokeObjectURL() {}
  };
}

function makeBlob() {
  return function (parts, opts) {
    return { _parts: parts, type: (opts && opts.type) || "" };
  };
}

function makeFile() {
  return function (blob, name, opts) {
    return { _blob: blob, name: name || "file", type: (opts && opts.type) || "" };
  };
}

function buildBrowserStub() {
  const g = {
    document: makeDocument(),
    window: makeWindow(),
    navigator: makeNavigator(),
    localStorage: {
      _store: new Map(),
      getItem(k) { return this._store.has(k) ? this._store.get(k) : null; },
      setItem(k, v) { this._store.set(k, String(v)); },
      removeItem(k) { this._store.delete(k); },
      clear() { this._store.clear(); }
    },
    indexedDB: undefined,
    fetch: undefined,
    Blob: makeBlob(),
    File: makeFile(),
    FileReader: makeFileReader(),
    URL: makeUrl(),
    atob(s) { return Buffer.from(s, "base64").toString("binary"); },
    btoa(s) { return Buffer.from(s, "binary").toString("base64"); },
    TextEncoder,
    TextDecoder,
    DataView,
    console,
    Math,
    Date,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  return g;
}

module.exports = { buildBrowserStub };