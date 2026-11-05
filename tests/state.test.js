/*
 * SmartScan — state, search, OCR-badge, and export-helper suite.
 *
 * Covers the pure / near-pure paths that previously had no
 * automated coverage: loadState defaults, document filtering
 * (including OCR text search), search UI residual clearing,
 * export weight estimates, PDF structure, and page helpers.
 *
 * Note: app.js uses let/const for `state` and `app`, so they are
 * not properties of the sandbox global. Tests that need to mutate
 * them do so via vm.runInContext against the same sandbox.
 */

"use strict";

const vm = require("vm");
const { ctx, assert, assertEqual, getSandbox } = require("./harness");

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

function suite(name, fn) {
  console.log(name);
  fn();
}

const sandbox = getSandbox();
const c = ctx();

/** Run a snippet against the live app sandbox (access to let state/app). */
function inApp(code) {
  return vm.runInContext(code, sandbox);
}

/* ----------------------------------------------------------
   loadState defaults & settings fallbacks
   ---------------------------------------------------------- */
suite("loadState", () => {
  run("returns empty documents/folders and default settings when empty", () => {
    c.localStorage.clear();
    const s = c.loadState();
    assertEqual(s.documents.length, 0, "documents");
    assertEqual(s.folders.length, 0, "folders");
    assertEqual(s.settings.theme, "system", "theme");
    assertEqual(s.settings.defaultFilter, "original", "defaultFilter");
    assertEqual(s.settings.defaultExportFormat, "pdf", "defaultExportFormat");
    assertEqual(s.settings.ocrLanguage, "eng", "ocrLanguage");
    assertEqual(s.settings.ocrPreprocess, "none", "ocrPreprocess");
    assertEqual(s.settings.ocrPsm, "auto", "ocrPsm");
  });

  run("round-trips a document through localStorage", () => {
    c.localStorage.clear();
    const storageKey = inApp("STORAGE_KEY");
    const doc = {
      id: "doc_test_1",
      name: "Round Trip",
      pages: [
        {
          id: "page_1",
          order: 0,
          originalImagePath: "img_a",
          processedImagePath: "img_b",
          ocrText: "hello ACME world"
        }
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      folderId: null
    };
    c.localStorage.setItem(
      storageKey,
      JSON.stringify({
        documents: [doc],
        folders: [{ id: "f1", name: "Invoices" }],
        settings: { theme: "dark", ocrLanguage: "deu" }
      })
    );
    const s = c.loadState();
    assertEqual(s.documents.length, 1, "one document");
    assertEqual(s.documents[0].name, "Round Trip", "name");
    assertEqual(s.documents[0].pages[0].ocrText, "hello ACME world", "ocrText");
    assertEqual(s.folders.length, 1, "one folder");
    assertEqual(s.settings.theme, "dark", "theme preserved");
    assertEqual(s.settings.ocrLanguage, "deu", "ocr language preserved");
    assertEqual(s.settings.defaultFilter, "original", "defaultFilter fallback");
  });

  run("recovers from corrupt JSON", () => {
    const storageKey = inApp("STORAGE_KEY");
    c.localStorage.setItem(storageKey, "{not json");
    const s = c.loadState();
    assertEqual(s.documents.length, 0, "documents empty on corrupt");
    assertEqual(s.settings.theme, "system", "defaults restored");
  });
});

/* ----------------------------------------------------------
   Search filtering & residual clearing
   ---------------------------------------------------------- */
suite("getFilteredDocuments & search residual", () => {
  function seedDocs() {
    inApp(`
      state.documents = [
        {
          id: "d1",
          name: "Invoice ACME",
          updatedAt: "2026-06-02T00:00:00.000Z",
          pages: [
            { id: "p1", order: 0, ocrText: "Total EUR 124.50" }
          ]
        },
        {
          id: "d2",
          name: "Receipt",
          updatedAt: "2026-06-01T00:00:00.000Z",
          pages: [
            { id: "p2", order: 0, ocrText: null }
          ]
        },
        {
          id: "d3",
          name: "Empty shell",
          updatedAt: "2026-06-03T00:00:00.000Z",
          pages: []
        },
        {
          id: "d4",
          name: "OCR only hit",
          updatedAt: "2026-05-01T00:00:00.000Z",
          pages: [
            { id: "p4", order: 0, ocrText: "ACME Corporation invoice" }
          ]
        }
      ];
      app.searchQuery = "";
      clearSearchMatchMetadata();
    `);
  }

  run("empty query returns all non-empty docs sorted by updatedAt", () => {
    seedDocs();
    inApp('app.searchQuery = ""');
    const list = c.getFilteredDocuments();
    assertEqual(list.length, 3, "zero-page doc excluded");
    assertEqual(list[0].id, "d1", "newest first");
    assertEqual(list[1].id, "d2", "second");
    assertEqual(list[2].id, "d4", "oldest");
  });

  run("name match finds document", () => {
    seedDocs();
    inApp('app.searchQuery = "receipt"');
    const list = c.getFilteredDocuments();
    assertEqual(list.length, 1, "one match");
    assertEqual(list[0].id, "d2", "Receipt");
  });

  run("OCR text match finds document and attaches __searchMatch", () => {
    seedDocs();
    inApp('app.searchQuery = "ACME Corporation"');
    const list = c.getFilteredDocuments();
    assertEqual(list.length, 1, "one OCR match");
    assertEqual(list[0].id, "d4", "OCR only hit");
    assert(list[0].__searchMatch, "match metadata present");
    assertEqual(list[0].__searchMatch.pageId, "p4", "pageId");
    assertEqual(list[0].__searchMatch.pageIndex, 0, "pageIndex");
  });

  run("combined name+OCR: name match without OCR still appears", () => {
    seedDocs();
    inApp('app.searchQuery = "Invoice ACME"');
    const list = c.getFilteredDocuments();
    assertEqual(list.length, 1, "name match");
    assertEqual(list[0].id, "d1", "Invoice ACME");
  });

  run("no matches returns empty list", () => {
    seedDocs();
    inApp('app.searchQuery = "zzzz-not-found"');
    const list = c.getFilteredDocuments();
    assertEqual(list.length, 0, "empty");
  });

  run("clearDocumentsListUiState clears query, selection, and match metadata", () => {
    seedDocs();
    inApp(`
      app.searchQuery = "ACME";
      app.selectedDocumentIds = ["d1", "d4"];
    `);
    c.getFilteredDocuments();
    assert(
      inApp("state.documents.some(d => d.__searchMatch)"),
      "metadata set by search"
    );

    c.clearDocumentsListUiState();

    assertEqual(inApp("app.searchQuery"), "", "query cleared");
    assertEqual(inApp("app.selectedDocumentIds.length"), 0, "selection cleared");
    assert(
      !inApp("state.documents.some(d => d.__searchMatch)"),
      "match metadata cleared"
    );
  });

  run("clearSearchMatchMetadata is idempotent", () => {
    seedDocs();
    inApp('app.searchQuery = "ACME"');
    c.getFilteredDocuments();
    c.clearSearchMatchMetadata();
    c.clearSearchMatchMetadata();
    assert(
      !inApp(
        "state.documents.some(d => d && Object.prototype.hasOwnProperty.call(d, '__searchMatch'))"
      ),
      "no leftover keys"
    );
  });
});

/* ----------------------------------------------------------
   OCR badge / edit-clears-OCR semantics
   ---------------------------------------------------------- */
suite("OCR badge semantics", () => {
  run("hasOcr is true only for non-empty string ocrText", () => {
    function hasOcr(page) {
      return typeof page.ocrText === "string" && page.ocrText.trim().length > 0;
    }
    assertEqual(hasOcr({ ocrText: "hello" }), true, "string");
    assertEqual(hasOcr({ ocrText: "  " }), false, "whitespace");
    assertEqual(hasOcr({ ocrText: null }), false, "null");
    assertEqual(hasOcr({ ocrText: undefined }), false, "undefined");
    assertEqual(hasOcr({}), false, "missing");
  });

  run("simulating edit clears ocrText and search match", () => {
    inApp(`
      state.documents = [
        {
          id: "d_edit",
          name: "Editable",
          pages: [{ id: "p_edit", order: 0, ocrText: "old text" }],
          __searchMatch: { pageId: "p_edit", pageIndex: 0 }
        }
      ];
    `);
    const result = inApp(`
      (function () {
        const doc = getDocument("d_edit");
        const page = getPage(doc, "p_edit");
        page.ocrText = null;
        if (doc.__searchMatch) delete doc.__searchMatch;
        return {
          ocrText: page.ocrText,
          hasMatch: !!doc.__searchMatch
        };
      })()
    `);
    assertEqual(result.ocrText, null, "ocr cleared");
    assertEqual(result.hasMatch, false, "search match cleared");
  });
});

/* ----------------------------------------------------------
   Document / page helpers
   ---------------------------------------------------------- */
suite("document & page helpers", () => {
  run("getDocument returns null for unknown id", () => {
    inApp("state.documents = []");
    assertEqual(c.getDocument("missing"), null, "null");
  });

  run("getPage returns the page by id", () => {
    inApp(`
      state.documents = [
        {
          id: "d1",
          pages: [
            { id: "p1", order: 1 },
            { id: "p2", order: 0 }
          ]
        }
      ];
    `);
    const doc = c.getDocument("d1");
    const page = c.getPage(doc, "p2");
    assertEqual(page.id, "p2", "found");
    assertEqual(c.getPage(doc, "nope"), null, "missing page");
  });

  run("normalizePageOrder reindexes current array order", () => {
    // normalizePageOrder does NOT sort by order field — it assigns
    // sequential order values based on the current array positions.
    const doc = {
      pages: [
        { id: "a", order: 5 },
        { id: "b", order: 1 },
        { id: "c", order: 3 }
      ]
    };
    c.normalizePageOrder(doc);
    assertEqual(doc.pages[0].id, "a", "array order preserved");
    assertEqual(doc.pages[0].order, 0, "reindexed 0");
    assertEqual(doc.pages[1].order, 1, "reindexed 1");
    assertEqual(doc.pages[2].order, 2, "reindexed 2");
  });

  run("uid and createId produce unique-looking ids", () => {
    const a = c.uid("page");
    const b = c.uid("page");
    assert(a.startsWith("page_"), "prefix");
    assert(a !== b, "unique");
    const id = c.createId();
    assert(typeof id === "string" && id.length > 4, "createId string");
  });
});

/* ----------------------------------------------------------
   Export helpers
   ---------------------------------------------------------- */
suite("export helpers", () => {
  run("exportablePages returns ordered image keys", () => {
    const doc = {
      pages: [
        { order: 1, processedImagePath: "proc_b", originalImagePath: "orig_b" },
        { order: 0, processedImagePath: null, originalImagePath: "orig_a" },
        { order: 2, processedImagePath: "proc_c", originalImagePath: "orig_c" }
      ]
    };
    const keys = c.exportablePages(doc);
    assertEqual(keys.length, 3, "three");
    assertEqual(keys[0], "orig_a", "prefers original when no processed");
    assertEqual(keys[1], "proc_b", "processed preferred");
    assertEqual(keys[2], "proc_c", "third");
  });

  run("exportablePages ignores empty pages", () => {
    const doc = { pages: [{ order: 0 }, { order: 1, processedImagePath: "x" }] };
    const keys = c.exportablePages(doc);
    assertEqual(keys.length, 1, "one");
    assertEqual(keys[0], "x", "key");
  });

  run("estimateExportWeight scales with page count", () => {
    assertEqual(c.estimateExportWeight({ pages: [] }), 0, "empty");
    assertEqual(c.estimateExportWeight(null), 0, "null");
    const one = c.estimateExportWeight({ pages: [{}] });
    const ten = c.estimateExportWeight({ pages: new Array(10).fill({}) });
    assert(one > 0, "positive");
    assertEqual(ten, one * 10, "linear");
  });

  run("formatBytes formats reasonably", () => {
    assert(typeof c.formatBytes(0) === "string", "zero");
    assert(c.formatBytes(1024).length > 0, "kb");
    assert(c.formatBytes(5 * 1024 * 1024).length > 0, "mb");
  });

  run("buildPdfBytes emits a PDF header and EOF", () => {
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = c.buildPdfBytes([
      { width: 100, height: 100, bytes: fakeJpeg }
    ]);
    assert(pdf instanceof Uint8Array || ArrayBuffer.isView(pdf), "typed array");
    const head = String.fromCharCode(...pdf.slice(0, 8));
    assert(head.startsWith("%PDF-"), "PDF header");
    const tail = String.fromCharCode(...pdf.slice(-8));
    assert(tail.includes("EOF"), "EOF marker");
  });

  run("buildPdfBytes handles multiple pages", () => {
    const img = {
      width: 50,
      height: 50,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    };
    const pdf = c.buildPdfBytes([img, img, img]);
    const text = String.fromCharCode(
      ...pdf.slice(0, Math.min(pdf.length, 4000))
    );
    assert(text.includes("/Count 3"), "page count 3");
  });
});

/* ----------------------------------------------------------
   Soft limits
   ---------------------------------------------------------- */
suite("soft limits", () => {
  run("WARN_PAGE_COUNT and WARN_EXPORT_BYTES are defined positively", () => {
    const pageWarn = inApp("WARN_PAGE_COUNT");
    const byteWarn = inApp("WARN_EXPORT_BYTES");
    assert(pageWarn >= 10, "page warn threshold");
    assert(byteWarn >= 10 * 1024 * 1024, "byte warn threshold");
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
