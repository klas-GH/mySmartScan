/* =========================================================
   SmartScan V0
   ---------------------------------------------------------
   Architecture intentionally keeps UI, state and storage
   separated so native capabilities can be added later.
   ========================================================= */

/* =========================================================
   STORAGE
   ========================================================= */

const STORAGE_KEY = "smartscan-v0";

const defaultState = {
  documents: [],
  folders: [],
  settings: {
    theme: "system",
    defaultFilter: "original",
    defaultExportFormat: "pdf"
  }
};

let state = loadState();

/*
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) {
      return structuredClone(defaultState);
    }

    return {
      ...structuredClone(defaultState),
      ...JSON.parse(saved)
    };
  } catch (error) {
    console.error("Could not load SmartScan data:", error);
    return structuredClone(defaultState);
  }
}
*/

/*
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
*/


/* =========================================================
   APP STATE
   ========================================================= */

const app = {
  // Current screen
  currentScreen: "home",

  // Currently opened SmartScan document
  activeDocumentId: null,

  // Page currently being edited
  editingPageId: null,

  // Temporary image being edited
  pendingImage: null,

  // Confirmed crop for a page that does not exist yet.
  // Stored as a fraction of the original image, not pixels.
  pendingCrop: null,

  /*
   * Filter forced onto a page that does not exist yet.
   * Normally null, so a new page starts from settings.defaultFilter.
   * Reset sets it to "original" so clearing edits means the same
   * thing for a new page as it does for a saved one.
   */
  pendingFilter: null,

  // Live crop rectangle while the crop overlay is open
  cropDraft: null,

  cropMode: false,

  // Scanner session
  scannerPages: [],

  // Scanner state
  scannerActive: false,

  // Current folder
  activeFolderId: null,

  // Search
  searchQuery: "",

  // UI
  modalOpen: false,

  // Prevent accidental double actions
  busy: false
};


/* =========================================================
   DOM
   ========================================================= */

const main = document.getElementById("main");
const scanFab = document.getElementById("scanFab");
const backBtn = document.getElementById("backBtn");
const settingsBtn = document.getElementById("settingsBtn");
const imageInput = document.getElementById("imageInput");
const modalRoot = document.getElementById("modalRoot");
const screenSubtitle = document.getElementById("screenSubtitle");

/* =========================================================
   UTILITIES
   ========================================================= */

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function formatDate(dateString) {
  const date = new Date(dateString);

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function createId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}


function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDocument(documentId) {
  if (!documentId) {
    return null;
  }

  return state.documents.find(
    doc => doc.id === documentId
  ) || null;
}


function getFolder(folderId) {
  if (!folderId) {
    return null;
  }

  return state.folders.find(
    folder => folder.id === folderId
  ) || null;
}


function normalizePageOrder(doc) {
  if (!doc || !Array.isArray(doc.pages)) {
    return;
  }

  doc.pages.forEach((page, index) => {
    page.order = index;
  });
}


function getPage(doc, pageId) {
  return doc?.pages?.find(
    page => page.id === pageId
  ) || null;
}


function documentPageCount(doc) {
  return doc?.pages?.length || 0;
}


function documentThumbnail(doc) {
  return (
    doc?.pages?.[0]?.processedImagePath ||
    doc?.pages?.[0]?.originalImagePath ||
    ""
  );
}



function showToast(message) {
  const existing = document.querySelector(".toast");

  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2200);
}


function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        documents: [],
        folders: [],
        settings: {
          theme: "system",
          defaultFilter: "original",
          defaultExportFormat: "pdf"
        }
      };
    }

    const parsed = JSON.parse(raw);

    return {
      documents: Array.isArray(parsed.documents)
        ? parsed.documents
        : [],

      folders: Array.isArray(parsed.folders)
        ? parsed.folders
        : [],

      settings: {
        theme: parsed.settings?.theme || "system",
        defaultFilter:
          parsed.settings?.defaultFilter || "original",
        defaultExportFormat:
          parsed.settings?.defaultExportFormat || "pdf"
      }
    };

  } catch (error) {
    console.error("Failed to load SmartScan state:", error);

    return {
      documents: [],
      folders: [],
      settings: {
        theme: "system",
        defaultFilter: "original",
        defaultExportFormat: "pdf"
      }
    };
  }
}


function saveState() {
  try {
    const serialized = JSON.stringify(state);

    localStorage.setItem(
      STORAGE_KEY,
      serialized
    );

    return true;

  } catch (error) {
    console.error("Failed to save SmartScan state:", error);

    if (error.name === "QuotaExceededError") {
      showToast(
        "Storage is full. Delete an old document and try again."
      );
    } else {
      showToast(
        "Could not save your changes."
      );
    }

    return false;
  }
}

function startScanner() {
  app.scannerPages = [];
  app.pendingImage = null;
  app.editingPageId = null;

  app.activeDocumentId = null;
  app.scannerActive = true;

  navigate("scanner");
}


function startScannerForDocument(documentId) {
  app.scannerPages = [];
  app.pendingImage = null;
  app.editingPageId = null;

  app.activeDocumentId = documentId;
  app.scannerActive = true;

  navigate("scanner");
}



function startNewScannerSession() {
  app.scannerPages = [];
  app.pendingImage = null;
  app.editingPageId = null;
  app.scannerActive = true;

  navigate("scanner");
}


function addScannerPage(imageData) {
  if (!imageData) {
    showToast("No image captured.");
    return;
  }

  app.scannerPages.push({
    id: createId(),

    order: app.scannerPages.length,

    originalImagePath: imageData,

    processedImagePath: imageData,

    filter: "original",

    rotation: 0
  });
}


function getScannerPageCount() {
  return app.scannerPages.length;
}


function clearScannerSession() {
  app.scannerPages = [];
  app.pendingImage = null;
  app.pendingCrop = null;
  app.pendingFilter = null;
  app.cropDraft = null;
  app.cropMode = false;
  app.editingPageId = null;
  app.scannerActive = false;
}

function acceptCapturedPage(imageData) {
  if (!imageData) {
    showToast("No page to accept.");
    return;
  }

  addScannerPage(imageData);

  app.pendingImage = null;

  renderScanner();

  showToast(
    `Page ${app.scannerPages.length} added`
  );
}


function retakeCapturedPage() {
  app.pendingImage = null;

  renderScanner();

  showToast("Ready to capture again.");
}


function addAnotherPage() {
  app.pendingImage = null;

  navigate("scanner");

  showToast("Capture the next page.");
}

/*
function finishScanning() {
  if (app.scannerPages.length === 0) {
    showToast("Capture at least one page first.");
    return;
  }

  createDocumentFromScanner();
}
*/


/* =========================================================
   ROUTING
   ========================================================= */

function navigate(route, options = {}) {
  if (options.from) {
    app.previousRoute = options.from;
  }

  app.route = route;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goBack() {
  if (app.route === "scanner") {
    navigate("home");
    return;
  }

  if (app.route === "scan-session") {
    navigate("document-editor");
    return;
  }

  if (app.route === "page-editor") {
    navigate("document-editor");
    return;
  }

  if (app.route === "document-editor") {
    navigate("home");
    return;
  }

  if (app.route === "folder") {
    navigate("folders");
    return;
  }

  navigate("home");
}


/* =========================================================
   RENDERING
   ========================================================= */

function render() {
  updateNavigation();
  updateHeader();
  updateScanButton();

  switch (app.route) {
    case "home":
      renderHome();
      break;

    case "documents":
      renderDocuments();
      break;

    case "folders":
      renderFolders();
      break;

    case "folder":
      renderFolder();
      break;

    case "scanner":
      renderScanner();
      break;

    case "page-editor":
      renderPageEditor();
      break;

    case "document-editor":
      renderDocumentEditor();
      break;

    case "settings":
      renderSettings();
      break;

    case "scan-session":
  	renderScanSession();
  	break;


    default:
      navigate("home");
  }
}

function updateNavigation() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle(
      "active",
      item.dataset.route === app.route ||
      (app.route === "folder" && item.dataset.route === "folders") ||
      (["scanner", "page-editor", "document-editor"].includes(app.route) &&
        item.dataset.route === "home")
    );
  });
}

function updateHeader() {
  const titles = {
    home: ["Documents", "Your documents, simplified."],
    documents: ["Documents", "Everything you've scanned."],
    folders: ["Folders", "Keep your documents organized."],
    folder: ["Folder", "Documents in this folder."],
    scanner: ["Scan", "Capture a clean page."],
    "page-editor": ["Edit page", "Clean up your scan."],
    "document-editor": ["Document", "Arrange your pages."],
    settings: ["Settings", "Control your SmartScan experience."]
  };

  const [title, subtitle] = titles[app.route] || titles.home;

  const brandName = document.querySelector(".brand-name");

  if (brandName) {
    brandName.textContent = title;
  }

  screenSubtitle.textContent = subtitle;

  backBtn.classList.toggle(
    "hidden",
    ["home", "documents", "folders", "settings"].includes(app.route)
  );
}

function updateScanButton() {
  const hiddenRoutes = [
  "scanner",
  "scan-session",
  "page-editor",
  "document-editor",
  "settings",
  "folder"
];


  scanFab.classList.toggle("hidden", hiddenRoutes.includes(app.route));
}

/* =========================================================
   HOME
   ========================================================= */

function renderHome() {
  const recent = [...state.documents]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);

  main.innerHTML = `
    <section class="hero">
      <div class="hero-kicker">SMARTSCAN V0</div>
      <h2>Paper → clean document.</h2>
      <p>
        Scan, clean and organize your documents locally.
        Your files stay on this device.
      </p>
      <button class="primary-btn" id="heroScanBtn">
        Scan your first document
      </button>
    </section>

    <section class="section">
      <div class="section-header">
        <h2>Recent documents</h2>
        ${
          state.documents.length
            ? `<button id="viewAllBtn">View all</button>`
            : ""
        }
      </div>

      ${
        recent.length
          ? `<div class="document-list">
              ${recent.map(documentCard).join("")}
             </div>`
          : emptyDocuments()
      }
    </section>

    <section class="section">
      <div class="section-header">
        <h2>Folders</h2>
        <button id="newFolderBtn">＋ New</button>
      </div>

      ${
        state.folders.length
          ? `<div class="folder-grid">
              ${state.folders.slice(0, 4).map(folderCard).join("")}
             </div>`
          : `
            <div class="empty-state">
              <div class="empty-icon">□</div>
              <h2>No folders yet</h2>
              <p>Create a folder when you're ready to organize your documents.</p>
            </div>
          `
      }
    </section>
  `;

  document
    .getElementById("heroScanBtn")
    ?.addEventListener("click", startScanner);

  document
    .getElementById("viewAllBtn")
    ?.addEventListener("click", () => navigate("documents"));

  document
    .getElementById("newFolderBtn")
    ?.addEventListener("click", createFolder);

  attachDocumentCardEvents();
  attachFolderCardEvents();
}

function emptyDocuments() {
  return `
    <div class="empty-state">
      <div class="empty-icon">▧</div>
      <h2>No documents yet</h2>
      <p>
        Scan your first paper document and SmartScan
        will keep it safely on this device.
      </p>
      <button class="primary-btn" onclick="startScanner()">
        Scan your first document
      </button>
    </div>
  `;
}

/* =========================================================
   DOCUMENTS
   ========================================================= */

function renderDocuments() {
  const filtered = getFilteredDocuments();

  main.innerHTML = `
    <div class="page-heading">
      <h1>Documents</h1>
      <p>${state.documents.length} document${state.documents.length === 1 ? "" : "s"}</p>
    </div>

    <input
      id="documentSearch"
      class="search"
      type="search"
      placeholder="Search documents..."
      value="${escapeHtml(app.searchQuery)}"
    />

    ${
      filtered.length
        ? `<div class="document-list">
            ${filtered.map(documentCard).join("")}
           </div>`
        : `
          <div class="empty-state">
            <div class="empty-icon">⌕</div>
            <h2>No matches</h2>
            <p>Try a different document name.</p>
          </div>
        `
    }
  `;

  document
    .getElementById("documentSearch")
    ?.addEventListener("input", event => {
      app.searchQuery = event.target.value;
      renderDocuments();
      const input = document.getElementById("documentSearch");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });

  attachDocumentCardEvents();
}

function getFilteredDocuments() {
  const query = app.searchQuery.trim().toLowerCase();

  if (!query) {
    return [...state.documents].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  }

  return state.documents.filter(document =>
    document.name.toLowerCase().includes(query)
  );
}

function documentCard(document) {
  const thumbnail = documentThumbnail(document);

  return `
    <article class="document-card" data-document-id="${document.id}">
      <div class="document-thumb">
        ${
          thumbnail
            ? `<img src="${thumbnail}" alt="" />`
            : `<span>▧</span>`
        }
      </div>

      <div class="document-info">
        <h3>${escapeHtml(document.name)}</h3>
        <div class="document-meta">
          ${documentPageCount(document)}
          page${documentPageCount(document) === 1 ? "" : "s"}
          · ${formatDate(document.updatedAt)}
        </div>
      </div>

      <button
        class="card-menu"
        data-action="menu"
        data-id="${document.id}"
        aria-label="Document actions"
      >
        ⋮
      </button>
    </article>
  `;
}

function attachDocumentCardEvents() {
  document.querySelectorAll(".document-card").forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest("[data-action='menu']")) {
        return;
      }

      openDocument(card.dataset.documentId);
    });
  });

  document.querySelectorAll("[data-action='menu']").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      showDocumentMenu(button.dataset.id);
    });
  });
}

function openDocument(id) {
  app.activeDocumentId = id;
  navigate("document-editor");
}


/* =========================================================
   FOLDERS
   ========================================================= */

function renderFolders() {
  main.innerHTML = `
    <div class="page-heading">
      <h1>Folders</h1>
      <p>Organize your scanned documents.</p>
    </div>

    <button id="createFolderButton" class="secondary-btn" style="width:100%;margin-bottom:16px;">
      ＋ Create folder
    </button>

    ${
      state.folders.length
        ? `<div class="folder-grid">
            ${state.folders.map(folderCard).join("")}
           </div>`
        : `
          <div class="empty-state">
            <div class="empty-icon">□</div>
            <h2>No folders</h2>
            <p>Create your first folder to organize documents.</p>
          </div>
        `
    }
  `;

  document
    .getElementById("createFolderButton")
    ?.addEventListener("click", createFolder);

  attachFolderCardEvents();
}

function folderCard(folder) {
  const count = state.documents.filter(
    document => document.folderId === folder.id
  ).length;

  return `
    <button class="folder-card" data-folder-id="${folder.id}">
      <div class="folder-icon">▰</div>
      <h3>${escapeHtml(folder.name)}</h3>
      <p>${count} document${count === 1 ? "" : "s"}</p>
    </button>
  `;
}

function attachFolderCardEvents() {
  document.querySelectorAll("[data-folder-id]").forEach(card => {
    card.addEventListener("click", () => {
      app.activeDocumentId = null;
      app.activeFolderId = card.dataset.folderId;
      navigate("folder");
    });
  });
}

function renderFolder() {
  const folder = getFolder(app.activeFolderId);

  if (!folder) {
    navigate("folders");
    return;
  }

  const documents = state.documents.filter(
    document => document.folderId === folder.id
  );

  main.innerHTML = `
    <div class="page-heading">
      <h1>${escapeHtml(folder.name)}</h1>
      <p>${documents.length} document${documents.length === 1 ? "" : "s"}</p>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:18px;">
      <button id="renameFolderBtn" class="secondary-btn">Rename</button>
      <button id="deleteFolderBtn" class="danger-btn">Delete folder</button>
    </div>

    ${
      documents.length
        ? `<div class="document-list">
            ${documents.map(documentCard).join("")}
           </div>`
        : `
          <div class="empty-state">
            <div class="empty-icon">□</div>
            <h2>This folder is empty</h2>
            <p>Move a document here from its document menu.</p>
          </div>
        `
    }
  `;

  document
    .getElementById("renameFolderBtn")
    ?.addEventListener("click", () => renameFolder(folder.id));

  document
    .getElementById("deleteFolderBtn")
    ?.addEventListener("click", () => deleteFolder(folder.id));

  attachDocumentCardEvents();
}

/* =========================================================
   SCANNER
   ========================================================= */



function renderScanner() {
  main.innerHTML = `
    <section class="scanner">

      <div class="scanner-preview"></div>

      <div class="scanner-controls">

        <div class="scanner-top-controls">
          <button class="scanner-control" id="galleryBtn">
            ▧
          </button>
        </div>

        <div class="capture-row">

          <button
            class="scanner-control"
            id="manualButton"
            title="Manual capture"
          >
            ＋
          </button>

          <button
            class="capture-button"
            id="captureButton"
            aria-label="Capture"
          ></button>

          <button
            class="scanner-control"
            id="finishScanButton"
            title="Finish"
          >
            ✓
          </button>

        </div>

      </div>
    </section>
  `;

  document
    .getElementById("captureButton")
    ?.addEventListener("click", chooseImage);

  document
    .getElementById("manualButton")
    ?.addEventListener("click", chooseImage);

  document
    .getElementById("galleryBtn")
    ?.addEventListener("click", chooseImage);

  document
    .getElementById("finishScanButton")
    ?.addEventListener("click", finishScanning);
}


function renderScanSession() {
  const doc = getDocument(app.activeDocumentId);

  if (!doc) {
    navigate("home");
    return;
  }

  const pageCount = doc.pages.length;

  const thumbnail =
    doc.pages?.[pageCount - 1]?.processedImagePath ||
    doc.pages?.[pageCount - 1]?.originalImagePath ||
    "";

  main.innerHTML = `
    <section class="scan-session">

      <div class="page-heading">
        <h1>Page added</h1>
        <p>
          ${pageCount} page${pageCount === 1 ? "" : "s"}
          in this document.
        </p>
      </div>

      ${
        thumbnail
          ? `
            <div class="editor-preview">
              <img
                src="${thumbnail}"
                alt="Last scanned page"
              />
            </div>
          `
          : ""
      }

      <div class="section" style="margin-top:20px;">
        <div class="empty-state">

          <div class="empty-icon">✓</div>

          <h2>
            ${pageCount === 1
              ? "Your first page is ready."
              : "Another page is ready."}
          </h2>

          <p>
            Add another page or finish this document.
          </p>

          <div
            style="
              display:flex;
              flex-direction:column;
              gap:10px;
              margin-top:18px;
            "
          >

            <button
              id="addAnotherPageBtn"
              class="primary-btn"
              style="width:100%;"
            >
              ＋ Add another page
            </button>

            <button
              id="doneScanningBtn"
              class="secondary-btn"
              style="width:100%;"
            >
              ✓ Done
            </button>

          </div>

        </div>
      </div>

    </section>
  `;

  document
  .getElementById("addAnotherPageBtn")
  ?.addEventListener("click", () => {
    if (!app.activeDocumentId) {
      showToast("Document session not found.");
      return;
    }

    // IMPORTANT:
    // Keep the current document active while scanning another page.
    startScannerForDocument(app.activeDocumentId);
  });


 document
  .getElementById("doneScanningBtn")
  ?.addEventListener("click", () => {
    finishScanSession();
  });


}

function finishScanSession() {
  const doc = getDocument(app.activeDocumentId);

  if (!doc) {
    showToast("Document not found.");
    navigate("home");
    return;
  }

  if (!doc.pages || doc.pages.length === 0) {
    showToast("Add at least one page first.");
    return;
  }

  // Scanner session is finished.
  app.scannerActive = false;
  app.scannerPages = [];
  app.pendingImage = null;
  app.editingPageId = null;

  doc.updatedAt = now();

  saveState();

  // Explicitly leave the scan-session screen.
  navigate("document-editor");

  // Confirm completion after navigation.
  setTimeout(() => {
    showToast(
      `Scan complete — ${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"}`
    );
  }, 50);
}


function chooseImage() {
  /*
    V0 intentionally uses the browser/native file picker.

    Later this function becomes the native camera entry point.
  */
  imageInput.value = "";
  imageInput.click();
}

function finishScanning() {
  // Nothing has been captured yet.
  if (!app.activeDocumentId && app.scannerPages.length === 0) {
    showToast("Capture a page first.");
    return;
  }

  // If we are already working inside an existing document,
  // simply return to its editor.
  if (app.activeDocumentId) {
    navigate("document-editor");
    return;
  }

  // If pages somehow exist without a document,
  // create the document now.
  if (app.scannerPages.length > 0) {
    createDocumentFromScanner();
    return;
  }

  showToast("Nothing to finish.");
}


imageInput.addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
    const imageData = await fileToDataUrl(file);

    app.pendingImage = imageData;

    // A fresh capture starts with no crop.
    app.pendingCrop = null;
    app.pendingFilter = null;
    app.cropDraft = null;
    app.cropMode = false;

    navigate("page-editor");
  } catch (error) {
    console.error(error);
    showToast("Could not load that image.");
  }
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        // Keep V0 lightweight.
        // The real V1 storage layer will use proper file/blob storage.
        const MAX_SIZE = 1400;

        let width = image.naturalWidth;
        let height = image.naturalHeight;

        if (width > MAX_SIZE || height > MAX_SIZE) {
          const scale = Math.min(
            MAX_SIZE / width,
            MAX_SIZE / height
          );

          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");

        ctx.drawImage(
          image,
          0,
          0,
          width,
          height
        );

        // JPEG dramatically reduces the amount of data
        // compared with keeping the original PNG/photo.
        const compressed = canvas.toDataURL(
          "image/jpeg",
          0.72
        );

        resolve(compressed);
      };

      image.onerror = reject;
      image.src = reader.result;
    };

    reader.onerror = reject;

    reader.readAsDataURL(file);
  });
}



/* =========================================================
   PAGE EDITOR
   ========================================================= */

const FILTER_STYLES = {
  original: "none",
  grayscale: "grayscale(1)",
  bw: "grayscale(1) contrast(2)",
  enhance: "contrast(1.15) brightness(1.04) saturate(.8)"
};

function filterStyle(filter) {
  return FILTER_STYLES[filter] || "none";
}

/*
 * ---------------------------------------------------------
   Crop
   ---------------------------------------------------------
   A crop is stored as fractions of the original image
   ({x, y, w, h} between 0 and 1) rather than pixels, so it is
   independent of preview size and of capture resolution, and it
   can be re-applied to the pristine original on every re-edit.

   Crop is applied first in the pipeline, then rotation, then filter.
   ---------------------------------------------------------
 */

const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };
const MIN_CROP = 0.05;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCrop(crop) {
  if (!crop) {
    return null;
  }

  const x = clamp(crop.x, 0, 1);
  const y = clamp(crop.y, 0, 1);

  const box = {
    x,
    y,
    w: clamp(crop.w, 0, 1 - x),
    h: clamp(crop.h, 0, 1 - y)
  };

  // A rectangle covering the whole image is stored as "no crop".
  const isFull =
    box.x < 0.001 && box.y < 0.001 &&
    box.w > 0.999 && box.h > 0.999;

  return isFull ? null : box;
}

function getCropState() {
  if (app.editingPageId && app.activeDocumentId) {
    const page = getPage(
      getDocument(app.activeDocumentId),
      app.editingPageId
    );

    if (page) {
      return page.crop || null;
    }
  }

  return app.pendingCrop || null;
}

function setCropState(crop) {
  if (app.editingPageId && app.activeDocumentId) {
    const doc = getDocument(app.activeDocumentId);
    const page = getPage(doc, app.editingPageId);

    if (page) {
      page.crop = crop || null;
      doc.updatedAt = now();
      saveState();
      return;
    }
  }

  app.pendingCrop = crop || null;
}

function resizeCrop(crop, corner, dx, dy) {
  const next = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };

  if (corner === "move") {
    next.x = clamp(crop.x + dx, 0, 1 - crop.w);
    next.y = clamp(crop.y + dy, 0, 1 - crop.h);

    return next;
  }

  // Dragging a corner changes the two edges that meet there.
  if (corner === "nw" || corner === "sw") {
    const right = crop.x + crop.w;
    next.x = clamp(crop.x + dx, 0, right - MIN_CROP);
    next.w = right - next.x;
  }

  if (corner === "ne" || corner === "se") {
    next.w = clamp(crop.w + dx, MIN_CROP, 1 - crop.x);
  }

  if (corner === "nw" || corner === "ne") {
    const bottom = crop.y + crop.h;
    next.y = clamp(crop.y + dy, 0, bottom - MIN_CROP);
    next.h = bottom - next.y;
  }

  if (corner === "sw" || corner === "se") {
    next.h = clamp(crop.h + dy, MIN_CROP, 1 - crop.y);
  }

  return normalizeCrop(next) || FULL_CROP;
}

function renderCropOverlay() {
  const rect = document.getElementById("cropRect");

  if (!rect) {
    return;
  }

  const crop = app.cropDraft || FULL_CROP;

  rect.style.left = (crop.x * 100) + "%";
  rect.style.top = (crop.y * 100) + "%";
  rect.style.width = (crop.w * 100) + "%";
  rect.style.height = (crop.h * 100) + "%";
}

function onCropPointerDown(event) {
  const handle = event.target.closest("[data-crop-handle]");
  const overlay = document.getElementById("cropOverlay");

  if (!overlay) {
    return;
  }

  const box = overlay.getBoundingClientRect();

  if (!box.width || !box.height) {
    return;
  }

  const corner = handle ? handle.dataset.cropHandle : "move";
  const active = handle || document.getElementById("cropRect");

  if (!active) {
    return;
  }

  const origin = {
    x: event.clientX,
    y: event.clientY,
    box,
    crop: { ...(app.cropDraft || FULL_CROP) }
  };

  event.preventDefault();

  try {
    active.setPointerCapture(event.pointerId);
  } catch (error) {
    // Capture is an optimisation; dragging still works without it.
  }

  const move = moveEvent => {
    const dx = (moveEvent.clientX - origin.x) / origin.box.width;
    const dy = (moveEvent.clientY - origin.y) / origin.box.height;

    app.cropDraft = resizeCrop(origin.crop, corner, dx, dy);

    renderCropOverlay();
  };

  const stop = () => {
    active.removeEventListener("pointermove", move);
    active.removeEventListener("pointerup", stop);
    active.removeEventListener("pointercancel", stop);
  };

  active.addEventListener("pointermove", move);
  active.addEventListener("pointerup", stop);
  active.addEventListener("pointercancel", stop);
}

function toggleCropMode() {
  app.cropMode = !app.cropMode;
  app.cropDraft = app.cropMode
    ? { ...(getCropState() || FULL_CROP) }
    : null;

  renderPageEditor();
}

function applyCrop() {
  setCropState(normalizeCrop(app.cropDraft));

  app.cropMode = false;
  app.cropDraft = null;

  renderPageEditor();

  showToast(getCropState() ? "Crop applied." : "Crop cleared.");
}

function cancelCrop() {
  app.cropMode = false;
  app.cropDraft = null;

  renderPageEditor();
}

function cropOverlayMarkup() {
  if (!app.cropMode) {
    return "";
  }

  return `
    <div class="crop-overlay" id="cropOverlay">
      <div class="crop-rect" id="cropRect">
        <button
          class="crop-handle"
          data-crop-handle="nw"
          aria-label="Crop top left"
        ></button>

        <button
          class="crop-handle"
          data-crop-handle="ne"
          aria-label="Crop top right"
        ></button>

        <button
          class="crop-handle"
          data-crop-handle="sw"
          aria-label="Crop bottom left"
        ></button>

        <button
          class="crop-handle"
          data-crop-handle="se"
          aria-label="Crop bottom right"
        ></button>
      </div>
    </div>
  `;
}

/*
 * Editing an existing page starts from its saved rotation and filter.
 * A new page starts from the configured default filter, unless a reset
 * has forced app.pendingFilter.
 *
 * The source image itself is chosen by whoever opened the editor
 * (app.pendingImage): a new capture, or a page's untouched
 * originalImagePath when re-editing.
 */
function getEditState() {
  if (app.editingPageId && app.activeDocumentId) {
    const page = getPage(
      getDocument(app.activeDocumentId),
      app.editingPageId
    );

    if (page) {
      return {
        rotation: page.rotation || 0,
        filter: page.filter || "original"
      };
    }
  }

  return {
    rotation: 0,
    filter: app.pendingFilter || state.settings.defaultFilter || "original"
  };
}

function renderPageEditor() {
  if (!app.pendingImage) {
    navigate("scanner");
    return;
  }

  const edit = getEditState();

  const hasCrop = !!getCropState();

  main.innerHTML = `
    <div class="page-heading">
      <h1>Edit page</h1>
      <p>Clean up your scanned page before saving it.</p>
    </div>

    <div class="editor-preview">
      <div class="crop-stage">
        <img
          id="editorImage"
          src="${app.pendingImage}"
          alt="Scanned page"
          data-rotation="${edit.rotation}"
          data-filter="${edit.filter}"
          style="
            transform: ${
              app.cropMode
                ? "none"
                : `rotate(${edit.rotation}deg)`
            };
            filter: ${filterStyle(edit.filter)};
          "
        />

        ${cropOverlayMarkup()}
      </div>
    </div>

    <div class="editor-tools">
      <button
        class="tool-btn"
        id="rotateBtn"
        ${app.cropMode ? "disabled" : ""}
      >
        <span>↻</span>
        <span>Rotate</span>
      </button>

      <button
        class="tool-btn ${app.cropMode ? "active" : ""}"
        id="cropBtn"
      >
        <span>⌗</span>
        <span>${hasCrop ? "Crop ✓" : "Crop"}</span>
      </button>

      <button class="tool-btn" id="perspectiveBtn">
        <span>◇</span>
        <span>Perspective</span>
      </button>

      <button class="tool-btn" id="resetBtn">
        <span>↺</span>
        <span>Reset</span>
      </button>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>Filter</h2>
      </div>

      <div class="filter-row">
        ${filterButton("original", "Original", edit.filter === "original")}
        ${filterButton("grayscale", "Grayscale", edit.filter === "grayscale")}
        ${filterButton("bw", "B&W", edit.filter === "bw")}
        ${filterButton("enhance", "Enhance", edit.filter === "enhance")}
      </div>
    </div>

    ${
      app.cropMode
        ? `
          <div style="display:flex;gap:9px;">
            <button
              id="cancelCropBtn"
              class="secondary-btn"
              style="flex:1;"
            >
              Cancel crop
            </button>

            <button
              id="applyCropBtn"
              class="primary-btn"
              style="flex:1;"
            >
              Apply crop
            </button>
          </div>
        `
        : `
          <div style="display:flex;gap:9px;">
            <button
              id="retakeBtn"
              class="secondary-btn"
              style="flex:1;"
            >
              Retake
            </button>

            <button
              id="savePageBtn"
              class="primary-btn"
              style="flex:1;"
            >
              Use page
            </button>
          </div>
        `
    }
  `;

  if (app.cropMode) {
    renderCropOverlay();

    document
      .getElementById("cropOverlay")
      ?.addEventListener("pointerdown", onCropPointerDown);
  }

  document
    .getElementById("rotateBtn")
    ?.addEventListener("click", rotateEditorImage);

  document
    .getElementById("cropBtn")
    ?.addEventListener("click", toggleCropMode);

  document
    .getElementById("cancelCropBtn")
    ?.addEventListener("click", cancelCrop);

  document
    .getElementById("applyCropBtn")
    ?.addEventListener("click", applyCrop);

  document
    .getElementById("perspectiveBtn")
    ?.addEventListener("click", () => {
      showToast("Perspective correction is not available in this version.");
    });

  document
    .getElementById("resetBtn")
    ?.addEventListener("click", resetEditorImage);

  document
    .getElementById("retakeBtn")
    ?.addEventListener("click", () => navigate("scanner"));

  document
    .getElementById("savePageBtn")
    ?.addEventListener("click", usePage);

  document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", () => {
      applyFilter(button.dataset.filter);

      document.querySelectorAll(".filter-btn").forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");
    });
  });
}

function filterButton(id, label, active = false) {
  return `
    <button
      class="filter-btn ${active ? "active" : ""}"
      data-filter="${id}"
    >
      ${label}
    </button>
  `;
}


function rotateEditorImage() {
  const image = document.getElementById("editorImage");

  const current = Number(image.dataset.rotation || 0);
  const next = current + 90;

  image.dataset.rotation = next;
  image.style.transform = `rotate(${next}deg)`;

  showToast("Page rotated.");
}

function applyFilter(filter) {
  const image = document.getElementById("editorImage");

  if (!image) {
    return;
  }

  image.dataset.filter = filter;

  image.style.filter = filterStyle(filter);
}

function resetEditorImage() {
  app.cropMode = false;
  app.cropDraft = null;

  if (app.editingPageId && app.activeDocumentId) {
    const doc = getDocument(app.activeDocumentId);
    const page = getPage(doc, app.editingPageId);

    if (page) {
      page.rotation = 0;
      page.filter = "original";
      page.crop = null;

      // Reset restores the unprocessed capture.
      page.processedImagePath = app.pendingImage;
      page.thumbnailPath = app.pendingImage;

      doc.updatedAt = now();
      saveState();
    }
  }

  app.pendingCrop = null;
  app.pendingFilter = "original";

  renderPageEditor();

  showToast("Edits reset.");
}

//usePage
async function usePage() {
  const image = document.getElementById("editorImage");

  if (!image || !app.pendingImage) {
    showToast("No page to save.");
    return;
  }

  const rotation = Number(
    image.dataset.rotation || 0
  );

  const selectedFilter =
    image.dataset.filter || "original";

  const filter = filterStyle(selectedFilter);

  const crop = getCropState();

  const source = new Image();

  source.onload = () => {
    /*
     * Crop comes first and is expressed as a fraction of the pristine
     * original, so it is applied before rotation and never compounds
     * with a previous encode.
     */
    const sourceX = crop ? crop.x * source.naturalWidth : 0;
    const sourceY = crop ? crop.y * source.naturalHeight : 0;

    const sourceWidth = crop
      ? crop.w * source.naturalWidth
      : source.naturalWidth;

    const sourceHeight = crop
      ? crop.h * source.naturalHeight
      : source.naturalHeight;

    const radians = rotation * Math.PI / 180;

    const swapDimensions =
      rotation % 180 !== 0;

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(
      swapDimensions ? sourceHeight : sourceWidth
    ));

    canvas.height = Math.max(1, Math.round(
      swapDimensions ? sourceWidth : sourceHeight
    ));

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      showToast("Could not process the page.");
      return;
    }

    ctx.filter = filter;

    ctx.translate(
      canvas.width / 2,
      canvas.height / 2
    );

    ctx.rotate(radians);

    ctx.drawImage(
      source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      -sourceWidth / 2,
      -sourceHeight / 2,
      sourceWidth,
      sourceHeight
    );

    const processedImage =
      canvas.toDataURL("image/jpeg", 0.78);

    /*
     * =====================================================
     * EDITING AN EXISTING PAGE
     * =====================================================
     */

    if (app.editingPageId && app.activeDocumentId) {
      const doc = getDocument(app.activeDocumentId);
      const existingPage = getPage(
        doc,
        app.editingPageId
      );

      if (doc && existingPage) {
        existingPage.processedImagePath = processedImage;
        existingPage.thumbnailPath = processedImage;
        existingPage.rotation = rotation;
        existingPage.filter = selectedFilter;
        existingPage.crop = crop;

        doc.updatedAt = now();

        saveState();

        app.pendingImage = null;
        app.editingPageId = null;

        navigate("document-editor");

        showToast("Page updated.");
        return;
      }
    }

    /*
     * =====================================================
     * CREATE NEW PAGE
     * =====================================================
     */

    const page = {
      id: uid("page"),

      documentId: app.activeDocumentId || null,

      order: 0,

      originalImagePath:
        app.pendingImage,

      processedImagePath:
        processedImage,

      thumbnailPath:
        processedImage,

      rotation,

      filter: selectedFilter,

      crop
    };

    /*
     * =====================================================
     * ADD TO EXISTING DOCUMENT
     * =====================================================
     */

    if (app.activeDocumentId) {
      const doc = getDocument(app.activeDocumentId);

      if (!doc) {
        showToast("Document not found.");
        return;
      }

      page.documentId = doc.id;
      page.order = doc.pages.length;

      doc.pages.push(page);

      normalizePageOrder(doc);

      doc.updatedAt = now();

      saveState();

      app.pendingImage = null;
      app.editingPageId = null;

      /*
       * Stay in the scanner session.
       * This is what allows:
       *
       * 1 page → Add another → 2 pages
       * 2 pages → Add another → 3 pages
       */
      navigate("scan-session");

      showToast(
        `Page ${doc.pages.length} added.`
      );

      return;
    }

    /*
     * =====================================================
     * FIRST PAGE OF NEW DOCUMENT
     * =====================================================
     */

    app.scannerPages.push(page);

    app.pendingImage = null;
    app.editingPageId = null;

    createDocumentFromScanner({
      session: true
    });
  };

  source.onerror = () => {
    showToast("Could not process the page.");
  };

  source.src = app.pendingImage;
}



/* =========================================================
   DOCUMENT CREATION
   ========================================================= */

function createDocumentFromScanner(options = {}) {
  if (!app.scannerPages.length) {
    showToast("No scanned pages.");
    return;
  }

  const timestamp = now();

  const pages = app.scannerPages.map((page, index) => ({
    id: page.id || createId(),

    documentId: null,

    order: index,

    originalImagePath:
      page.originalImagePath,

    processedImagePath:
      page.processedImagePath ||
      page.originalImagePath,

    thumbnailPath:
      page.processedImagePath ||
      page.originalImagePath,

    rotation:
      page.rotation || 0,

    filter:
      page.filter || "original",

    crop: page.crop || null
  }));

  const docId = createId();

  const doc = {
    id: docId,

    name:
      `Scan ${new Date().toLocaleDateString()}`,

    folderId: null,

    createdAt: timestamp,

    updatedAt: timestamp,

    pages
  };

  pages.forEach(page => {
    page.documentId = docId;
  });

  state.documents.unshift(doc);

  saveState();

  app.activeDocumentId = docId;

  clearScannerSession();

  if (options.session) {
    navigate("scan-session");
  } else {
    navigate("document-editor");
  }
}


/* =========================================================
   DOCUMENT EDITOR
   ========================================================= */

function renderDocumentEditor() {
  const doc = getDocument(app.activeDocumentId);

  if (!doc) {
    navigate("home");
    return;
  }


  main.innerHTML = `
    <div class="page-heading">
      <p>${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"}</p>
    </div>

    <input
      id="documentTitle"
      class="document-editor-title"
      value="${escapeHtml(doc.name)}"
      aria-label="Document title"
    />

    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button id="addPageBtn" class="secondary-btn">
        ＋ Add page
      </button>

      <button id="saveDocumentBtn" class="primary-btn">
        Save
      </button>
    </div>

    <button
      id="exportBtn"
      class="secondary-btn"
      style="width:100%;margin-bottom:18px;"
    >
      ⇩ Export as ${getDefaultExportFormat().toUpperCase()}
    </button>

    ${
      doc.pages.length
        ? `<div class="page-grid">
            ${doc.pages.map((page, index) =>
              pageCard(doc, page, index)
            ).join("")}
           </div>`
        : `
          <div class="empty-state">
            <div class="empty-icon">▧</div>
            <h2>No pages</h2>
            <p>Add a page to this document.</p>
          </div>
        `
    }
  `;

  document
    .getElementById("documentTitle")
    ?.addEventListener("input", event => {
      doc.name = event.target.value || "Untitled document";
      doc.updatedAt = now();
      saveState();
    });

  document
  	.getElementById("addPageBtn")
 	 ?.addEventListener("click", () => {
    	startScannerForDocument(doc.id);
   });


  document
    .getElementById("saveDocumentBtn")
    ?.addEventListener("click", () => {
      doc.updatedAt = now();
      saveState();
      showToast("Document saved.");
    });

  document
    .getElementById("exportBtn")
    ?.addEventListener("click", () => {
      showExportSheet(doc.id);
    });

  attachPageEvents(doc);
}

function pageCard(document, page, index) {
  const image =
    page.processedImagePath ||
    page.originalImagePath ||
    "";

  return `
    <article class="page-card">

      <span class="page-number">
        ${index + 1}
      </span>

      ${
        image
          ? `<img class="page-image" src="${image}" alt="Page ${index + 1}" />`
          : `<div class="page-image"></div>`
      }

      <div class="page-actions">

        <button
          data-page-action="edit"
          data-page-id="${page.id}"
        >
          Edit
        </button>

        <button
          data-page-action="up"
          data-page-id="${page.id}"
          ${index === 0 ? "disabled" : ""}
        >
          ↑
        </button>

        <button
          data-page-action="down"
          data-page-id="${page.id}"
          ${index === document.pages.length - 1 ? "disabled" : ""}
        >
          ↓
        </button>

        <button
          data-page-action="delete"
          data-page-id="${page.id}"
        >
          ×
        </button>

      </div>
    </article>
  `;
}

function attachPageEvents(doc) {
  window.document
    .querySelectorAll("[data-page-action]")
    .forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();

        const action = button.dataset.pageAction;
        const pageId = button.dataset.pageId;

        handlePageAction(doc.id, pageId, action);
      });
    });
}


function handlePageAction(documentId, pageId, action) {
  const doc = getDocument(documentId);

  if (!doc) {
    return;
  }

  const index = doc.pages.findIndex(
    page => page.id === pageId
  );

  if (index === -1) {
    return;
  }

  // -----------------------------------------
  // Edit page
  // -----------------------------------------

  if (action === "edit") {
    const page = doc.pages[index];

    /*
     * Re-edit from the untouched original, never from the already
     * processed JPEG, so repeated edits do not stack up encoding
     * loss. getEditState() restores the saved rotation and filter.
     */
    app.pendingImage =
      page.originalImagePath ||
      page.processedImagePath;

    app.editingPageId = page.id;

    app.cropMode = false;
    app.cropDraft = null;

    navigate("page-editor");
    return;
  }

  // -----------------------------------------
  // Delete page
  // -----------------------------------------

  if (action === "delete") {
    if (!confirm("Delete this page?")) {
      return;
    }

    doc.pages.splice(index, 1);

    normalizePageOrder(doc);

    doc.updatedAt = now();

    saveState();
    renderDocumentEditor();

    return;
  }

  // -----------------------------------------
  // Move page up
  // -----------------------------------------

  if (action === "up" && index > 0) {
    [
      doc.pages[index - 1],
      doc.pages[index]
    ] = [
      doc.pages[index],
      doc.pages[index - 1]
    ];

    normalizePageOrder(doc);

    doc.updatedAt = now();

    saveState();
    renderDocumentEditor();

    return;
  }

  // -----------------------------------------
  // Move page down
  // -----------------------------------------

  if (
    action === "down" &&
    index < doc.pages.length - 1
  ) {
    [
      doc.pages[index],
      doc.pages[index + 1]
    ] = [
      doc.pages[index + 1],
      doc.pages[index]
    ];

    normalizePageOrder(doc);

    doc.updatedAt = now();

    saveState();
    renderDocumentEditor();
  }
}

/*
function normalizePageOrder(document) {
  document.pages.forEach((page, index) => {
    page.order = index;
  });
}
*/

/* =========================================================
   DOCUMENT MENU
   ========================================================= */

function showDocumentMenu(documentId) {
  const doc = getDocument(documentId);

  if (!doc) {
    return;
  }

  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal">

        <h2>${escapeHtml(doc.name)}</h2>

        <p>Choose an action for this document.</p>

        <div class="modal-actions" style="flex-wrap:wrap;">

          <button
            id="modalOpen"
            class="primary-btn"
          >
            Open
          </button>

          <button
            id="modalRename"
            class="secondary-btn"
          >
            Rename
          </button>

          <button
            id="modalMove"
            class="secondary-btn"
          >
            Move
          </button>

          <button
            id="modalDelete"
            class="danger-btn"
          >
            Delete
          </button>

          <button
            id="modalCancel"
            class="secondary-btn"
          >
            Cancel
          </button>

        </div>

      </div>
    </div>
  `;

  document
    .getElementById("modalOpen")
    .addEventListener("click", () => {
      closeModal();
      openDocument(documentId);
    });

  document
    .getElementById("modalRename")
    .addEventListener("click", () => {
      closeModal();
      renameDocument(documentId);
    });

  document
    .getElementById("modalMove")
    .addEventListener("click", () => {
      closeModal();
      moveDocument(documentId);
    });

  document
    .getElementById("modalDelete")
    .addEventListener("click", () => {
      closeModal();
      deleteDocument(documentId);
    });

  document
    .getElementById("modalCancel")
    .addEventListener("click", closeModal);

  document
    .getElementById("modalBackdrop")
    .addEventListener("click", event => {
      if (event.target.id === "modalBackdrop") {
        closeModal();
      }
    });
}



function closeModal() {
  modalRoot.innerHTML = "";
}

/* =========================================================
   DOCUMENT ACTIONS
   ========================================================= */

function renameDocument(documentId) {
  const doc = getDocument(documentId);

  if (!doc) {
    return;
  }

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">

        <h2>Rename document</h2>

        <input
          id="renameInput"
          class="modal-input"
          value="${escapeHtml(doc.name)}"
        />

        <div class="modal-actions">
          <button id="cancelRename" class="secondary-btn">
            Cancel
          </button>

          <button id="confirmRename" class="primary-btn">
            Save
          </button>
        </div>

      </div>
    </div>
  `;

  const input = document.getElementById("renameInput");
  input.focus();
  input.select();

  document
    .getElementById("cancelRename")
    .addEventListener("click", closeModal);

  document
    .getElementById("confirmRename")
    .addEventListener("click", () => {
      doc.name = input.value.trim() || "Untitled document";
      doc.updatedAt = now();

      saveState();
      closeModal();
      render();

      showToast("Document renamed.");
    });
}

function moveDocument(documentId) {
  const doc = getDocument(documentId);

  if (!doc) {
    return;
  }

  if (!state.folders.length) {
    showToast("Create a folder first.");
    return;
  }

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">

        <h2>Move document</h2>
        <p>Select a folder.</p>

        <div class="settings-list">
          ${state.folders.map(folder => `
            <button
              class="setting-row"
              data-move-folder="${folder.id}"
            >
              <div class="setting-info">
                <strong>${escapeHtml(folder.name)}</strong>
              </div>
              <span>→</span>
            </button>
          `).join("")}
        </div>

        <button
          id="removeFolder"
          class="secondary-btn"
          style="width:100%;margin-top:12px;"
        >
          Remove from folder
        </button>

      </div>
    </div>
  `;

  document
    .querySelectorAll("[data-move-folder]")
    .forEach(button => {
      button.addEventListener("click", () => {
        doc.folderId = button.dataset.moveFolder;
        doc.updatedAt = now();

        saveState();
        closeModal();
        render();

        showToast("Document moved.");
      });
    });

  document
    .getElementById("removeFolder")
    .addEventListener("click", () => {
      doc.folderId = null;
      doc.updatedAt = now();

      saveState();
      closeModal();
      render();

      showToast("Document removed from folder.");
    });
}

function deleteDocument(documentId) {
  const doc = getDocument(documentId);

  if (!doc) {
    return;
  }

  if (!confirm(`Delete "${doc.name}"?`)) {
    return;
  }

  state.documents = state.documents.filter(
    item => item.id !== documentId
  );

  saveState();

  if (app.activeDocumentId === documentId) {
    app.activeDocumentId = null;
    navigate("home");
  } else {
    render();
  }

  showToast("Document deleted.");
}

/* =========================================================
   EXPORT
   ---------------------------------------------------------
   Minimal, dependency-free export layer.

   PDF pages are the page JPEGs the editor already produces,
   embedded as DCTDecode image XObjects, so no re-encoding
   is needed for the common case.
   ========================================================= */

const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;

const EXPORT_FORMATS = [
  { id: "pdf", label: "PDF", hint: "One file, all pages" },
  { id: "jpg", label: "JPG", hint: "One file per page" },
  { id: "png", label: "PNG", hint: "One file per page" }
];

function getDefaultExportFormat() {
  return EXPORT_FORMATS.some(
    format => format.id === state.settings.defaultExportFormat
  )
    ? state.settings.defaultExportFormat
    : "pdf";
}

function exportablePages(doc) {
  return [...(doc?.pages || [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(page => page.processedImagePath || page.originalImagePath)
    .filter(Boolean);
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function exportFileName(name, extension, suffix = "") {
  const base = String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/^[.\s]+|[.\s]+$/g, "");

  const safe = !base
    ? "document"
    : WINDOWS_RESERVED_NAME.test(base)
      ? `${base}-document`
      : base;

  return `${safe}${suffix}.${extension}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.rel = "noopener";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const SHARE_RESULT = {
  SHARED: "shared",
  CANCELLED: "cancelled",
  UNSUPPORTED: "unsupported"
};

function createExportFile(blob, fileName) {
  try {
    return new File([blob], fileName, {
      type: blob.type,
      lastModified: Date.now()
    });
  } catch (error) {
    console.error("SmartScan could not build a shareable file:", error);
    return null;
  }
}

function canShareFiles(files) {
  if (!files.length) {
    return false;
  }

  if (typeof navigator === "undefined") {
    return false;
  }

  if (typeof navigator.share !== "function") {
    return false;
  }

  if (typeof navigator.canShare !== "function") {
    return false;
  }

  try {
    return navigator.canShare({ files }) === true;
  } catch (error) {
    return false;
  }
}

/*
 * Share support can only be confirmed against a real File, so the
 * export sheet probes with a tiny throwaway file.
 */
function canShareExportedFile() {
  const probe = createExportFile(
    new Blob([new Uint8Array([0])], { type: "application/pdf" }),
    "smartscan-probe.pdf"
  );

  return probe ? canShareFiles([probe]) : false;
}

async function shareExports(exports) {
  const files = exports
    .map(item => createExportFile(item.blob, item.fileName))
    .filter(Boolean);

  if (!files.length) {
    return SHARE_RESULT.UNSUPPORTED;
  }

  let shareable = canShareFiles(files);

  // Some platforms refuse more than one file; retry with the first.
  if (!shareable && files.length > 1) {
    shareable = canShareFiles([files[0]]);

    if (shareable) {
      files.length = 1;
    }
  }

  if (!shareable) {
    return SHARE_RESULT.UNSUPPORTED;
  }

  try {
    await navigator.share({
      files,
      title: files[0].name
    });

    return SHARE_RESULT.SHARED;

  } catch (error) {
    // The user dismissed the sheet, so do not download behind their back.
    if (error && error.name === "AbortError") {
      return SHARE_RESULT.CANCELLED;
    }

    console.error("SmartScan share failed, falling back to download:", error);

    return SHARE_RESULT.UNSUPPORTED;
  }
}

async function downloadExports(exports) {
  const many = exports.length > 1;

  for (let index = 0; index < exports.length; index++) {
    downloadBlob(exports[index].blob, exports[index].fileName);

    // Browsers throttle back-to-back automatic downloads.
    if (many && index < exports.length - 1) {
      await wait(180);
    }
  }
}

async function deliverExports(exports, mode, formatLabel, pageCount) {
  const summary =
    ` ${pageCount} page${pageCount === 1 ? "" : "s"} as ${formatLabel}.`;

  if (mode === "share") {
    const outcome = await shareExports(exports);

    if (outcome === SHARE_RESULT.SHARED) {
      showToast("Shared" + summary);
      return;
    }

    if (outcome === SHARE_RESULT.CANCELLED) {
      return;
    }
  }

  await downloadExports(exports);

  showToast("Exported" + summary);
}

async function runExport(documentId, format, mode) {
  if (format === "pdf") {
    await exportDocumentPdf(documentId, mode);
    return;
  }

  await exportDocumentImages(documentId, format, mode);
}

function beginExport() {
  if (app.busy) {
    showToast("An export is already running.");
    return false;
  }

  app.busy = true;
  return true;
}

function endExport() {
  app.busy = false;
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Could not load a page image."));

    image.src = source;
  });
}

function dataUrlToBytes(dataUrl) {
  const marker = dataUrl.indexOf("base64,");

  if (marker === -1) {
    throw new Error("Unexpected image data.");
  }

  const binary = atob(dataUrl.slice(marker + 7));

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToLatin1(text) {
  const bytes = new Uint8Array(text.length);

  for (let index = 0; index < text.length; index++) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }

  return bytes;
}

function concatBytes(chunks) {
  let total = 0;

  chunks.forEach(chunk => {
    total += chunk.length;
  });

  const result = new Uint8Array(total);

  let offset = 0;

  chunks.forEach(chunk => {
    result.set(chunk, offset);
    offset += chunk.length;
  });

  return result;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function renderPageToCanvas(source) {
  const image = await loadImageElement(source);

  const canvas = document.createElement("canvas");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Image processing is unavailable.");
  }

  ctx.drawImage(image, 0, 0);

  return canvas;
}

async function readJpegImage(source) {
  const image = await loadImageElement(source);

  if (/^data:image\/jpe?g;base64,/i.test(source)) {
    return {
      bytes: dataUrlToBytes(source),
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  }

  const canvas = await renderPageToCanvas(source);

  return {
    bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)),
    width: canvas.width,
    height: canvas.height
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Image encoding failed."));
      },
      type,
      quality
    );
  });
}

function buildPdfBytes(images) {
  const chunks = [];

  const offsets = [0];

  let byteLength = 0;

  const writeString = text => {
    const bytes = bytesToLatin1(text);

    chunks.push(bytes);
    byteLength += bytes.length;
  };

  const writeBytes = bytes => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  const beginObject = number => {
    offsets[number] = byteLength;

    writeString(`${number} 0 obj\n`);
  };

  const endObject = () => writeString("endobj\n");

  const catalogNumber = 1;
  const pagesNumber = 2;
  const firstObject = 3;

  const objectCount = 2 + images.length * 3;

  writeString("%PDF-1.4\n");

  // Binary marker so tools treat the file as binary.
  writeBytes(
    bytesToLatin1(String.fromCharCode(0x25, 0xc3, 0xa4, 0xc3, 0xbc, 0x0a))
  );

  beginObject(catalogNumber);
  writeString(`<< /Type /Catalog /Pages ${pagesNumber} 0 R >>\n`);
  endObject();

  beginObject(pagesNumber);

  const kids = images
    .map((_, index) => `${firstObject + index * 3} 0 R`)
    .join(" ");

  writeString(
    `<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>\n`
  );

  endObject();

  images.forEach((image, index) => {
    const pageNumber = firstObject + index * 3;
    const contentNumber = pageNumber + 1;
    const imageNumber = pageNumber + 2;

    // A4 page with the image centred and scaled to fit.
    const scale = Math.min(
      PDF_PAGE_WIDTH / image.width,
      PDF_PAGE_HEIGHT / image.height
    );

    const drawWidth = round2(image.width * scale);
    const drawHeight = round2(image.height * scale);

    const offsetX = round2((PDF_PAGE_WIDTH - drawWidth) / 2);
    const offsetY = round2((PDF_PAGE_HEIGHT - drawHeight) / 2);

    const content =
      `q\n${drawWidth} 0 0 ${drawHeight} ${offsetX} ${offsetY} cm\n` +
      `/Im0 Do\nQ\n`;

    beginObject(pageNumber);
    writeString(
      `<< /Type /Page /Parent ${pagesNumber} 0 R ` +
      `/MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /ProcSet [/PDF /ImageC] ` +
      `/XObject << /Im0 ${imageNumber} 0 R >> >> ` +
      `/Contents ${contentNumber} 0 R >>\n`
    );

    endObject();

    beginObject(contentNumber);
    writeString(`<< /Length ${content.length} >>\nstream\n`);
    writeString(content);
    writeString("\nendstream\n");
    endObject();

    beginObject(imageNumber);
    writeString(
      `<< /Type /XObject /Subtype /Image ` +
      `/Width ${image.width} /Height ${image.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode ` +
      `/Length ${image.bytes.length} >>\nstream\n`
    );

    writeBytes(image.bytes);
    writeString("\nendstream\n");
    endObject();
  });

  const startxref = byteLength;

  writeString(`xref\n0 ${objectCount + 1}\n`);
  writeString("0000000000 65535 f \n");

  for (let number = 1; number <= objectCount; number++) {
    writeString(
      `${String(offsets[number]).padStart(10, "0")} 00000 n \n`
    );
  }

  writeString(
    `trailer\n<< /Size ${objectCount + 1} /Root ${catalogNumber} 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`
  );

  return concatBytes(chunks);
}

async function exportDocumentPdf(documentId, mode = "download") {
  const doc = getDocument(documentId);

  if (!doc) {
    showToast("Document not found.");
    return;
  }

  const sources = exportablePages(doc);

  if (!sources.length) {
    showToast("This document has no pages to export.");
    return;
  }

  if (!beginExport()) {
    return;
  }

  try {
    const images = [];

    for (const source of sources) {
      images.push(await readJpegImage(source));
    }

    const exports = [{
      blob: new Blob([buildPdfBytes(images)], {
        type: "application/pdf"
      }),
      fileName: exportFileName(doc.name, "pdf")
    }];

    await deliverExports(exports, mode, "PDF", images.length);

  } catch (error) {
    console.error("SmartScan PDF export failed:", error);

    showToast("Could not generate the PDF.");

  } finally {
    endExport();
  }
}

async function exportDocumentImages(documentId, extension, mode = "download") {
  const doc = getDocument(documentId);

  if (!doc) {
    showToast("Document not found.");
    return;
  }

  const sources = exportablePages(doc);

  if (!sources.length) {
    showToast("This document has no pages to export.");
    return;
  }

  if (!beginExport()) {
    return;
  }

  const type = extension === "png" ? "image/png" : "image/jpeg";
  const quality = type === "image/jpeg" ? 0.92 : undefined;

  const many = sources.length > 1;

  try {
    const exports = [];

    for (let index = 0; index < sources.length; index++) {
      const canvas = await renderPageToCanvas(sources[index]);

      const blob = await canvasToBlob(canvas, type, quality);

      const suffix = many ? `-${index + 1}` : "";

      exports.push({
        blob,
        fileName: exportFileName(doc.name, extension, suffix)
      });
    }

    await deliverExports(exports, mode, extension.toUpperCase(), sources.length);

  } catch (error) {
    console.error(`SmartScan ${extension} export failed:`, error);

    showToast(`Could not export the ${extension.toUpperCase()} page.`);

  } finally {
    endExport();
  }
}

function showExportSheet(documentId) {
  const doc = getDocument(documentId);

  if (!doc) {
    showToast("Document not found.");
    return;
  }

  const pageCount = doc.pages.length;

  const shareSupported = canShareExportedFile();

  let selectedFormat = getDefaultExportFormat();

  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="exportBackdrop">
      <div class="modal">

        <h2>Export</h2>

        <p>
          ${escapeHtml(doc.name)} · ${pageCount} page${pageCount === 1 ? "" : "s"}
        </p>

        <div class="export-formats">
          ${EXPORT_FORMATS.map(format => `
            <button
              class="export-format ${format.id === selectedFormat ? "active" : ""}"
              data-export-format="${format.id}"
            >
              <strong>${format.label}</strong>
              <small>${format.hint}</small>
            </button>
          `).join("")}
        </div>

        <div class="modal-actions">
          <button id="cancelExport" class="secondary-btn">
            Cancel
          </button>

          <button
            id="confirmExport"
            class="${shareSupported ? "secondary-btn" : "primary-btn"}"
          >
            ${shareSupported ? "Download" : "Export"}
          </button>

          ${
            shareSupported
              ? `
                <button id="shareExport" class="primary-btn">
                  Share
                </button>
              `
              : ""
          }
        </div>

      </div>
    </div>
  `;

  document
    .querySelectorAll("[data-export-format]")
    .forEach(button => {
      button.addEventListener("click", () => {
        selectedFormat = button.dataset.exportFormat;

        document
          .querySelectorAll("[data-export-format]")
          .forEach(item => {
            item.classList.toggle(
              "active",
              item.dataset.exportFormat === selectedFormat
            );
          });
      });
    });

  document
    .getElementById("cancelExport")
    .addEventListener("click", closeModal);

document
    .getElementById("confirmExport")
    ?.addEventListener("click", async () => {
      closeModal();

      await runExport(documentId, selectedFormat, "download");
    });

  document
    .getElementById("shareExport")
    ?.addEventListener("click", async () => {
      closeModal();

      await runExport(documentId, selectedFormat, "share");
    });

  document
    .getElementById("exportBackdrop")
    .addEventListener("click", event => {
      if (event.target.id === "exportBackdrop") {
        closeModal();
      }
    });
}

/* =========================================================
   FOLDERS ACTIONS
   ========================================================= */

function createFolder() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">

        <h2>New folder</h2>

        <input
          id="folderInput"
          class="modal-input"
          placeholder="e.g. Work"
        />

        <div class="modal-actions">
          <button id="cancelFolder" class="secondary-btn">
            Cancel
          </button>

          <button id="confirmFolder" class="primary-btn">
            Create
          </button>
        </div>

      </div>
    </div>
  `;

  const input = document.getElementById("folderInput");
  input.focus();

  document
    .getElementById("cancelFolder")
    .addEventListener("click", closeModal);

  document
    .getElementById("confirmFolder")
    .addEventListener("click", () => {
      const name = input.value.trim();

      if (!name) {
        showToast("Enter a folder name.");
        return;
      }

      state.folders.push({
        id: uid("folder"),
        name,
        createdAt: now()
      });

      saveState();
      closeModal();
      render();

      showToast("Folder created.");
    });
}

function renameFolder(folderId) {
  const folder = getFolder(folderId);

  if (!folder) {
    return;
  }

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">

        <h2>Rename folder</h2>

        <input
          id="folderRenameInput"
          class="modal-input"
          value="${escapeHtml(folder.name)}"
        />

        <div class="modal-actions">
          <button id="cancelFolderRename" class="secondary-btn">
            Cancel
          </button>

          <button id="confirmFolderRename" class="primary-btn">
            Save
          </button>
        </div>

      </div>
    </div>
  `;

  const input = document.getElementById("folderRenameInput");
  input.focus();
  input.select();

  document
    .getElementById("cancelFolderRename")
    .addEventListener("click", closeModal);

  document
    .getElementById("confirmFolderRename")
    .addEventListener("click", () => {
      folder.name = input.value.trim() || "Untitled folder";

      saveState();
      closeModal();
      render();

      showToast("Folder renamed.");
    });
}

function deleteFolder(folderId) {
  const folder = getFolder(folderId);

  if (!folder) {
    return;
  }

  if (!confirm(`Delete folder "${folder.name}"? Documents will not be deleted.`)) {
    return;
  }

  state.documents.forEach(document => {
    if (document.folderId === folderId) {
      document.folderId = null;
    }
  });

  state.folders = state.folders.filter(
    item => item.id !== folderId
  );

  saveState();
  navigate("folders");

  showToast("Folder deleted.");
}

/* =========================================================
   SETTINGS
   ========================================================= */

function renderSettings() {
  main.innerHTML = `
    <div class="page-heading">
      <h1>Settings</h1>
      <p>SmartScan works locally on this device.</p>
    </div>

    <section class="section">

      <div class="section-header">
        <h2>Appearance</h2>
      </div>

      <div class="settings-list">

        <div class="setting-row">
          <div class="setting-info">
            <strong>Theme</strong>
            <small>Choose how SmartScan looks.</small>
          </div>

          <select id="themeSetting">
            <option value="system" ${state.settings.theme === "system" ? "selected" : ""}>
              System
            </option>

            <option value="light" ${state.settings.theme === "light" ? "selected" : ""}>
              Light
            </option>

            <option value="dark" ${state.settings.theme === "dark" ? "selected" : ""}>
              Dark
            </option>
          </select>
        </div>

      </div>

    </section>

    <section class="section">

      <div class="section-header">
        <h2>Scanning</h2>
      </div>

      <div class="settings-list">

        <div class="setting-row">
          <div class="setting-info">
            <strong>Default scan filter</strong>
            <small>Applied to new pages.</small>
          </div>

          <select id="filterSetting">
            <option value="original">Original</option>
            <option value="grayscale">Grayscale</option>
            <option value="bw">Black & White</option>
            <option value="enhance">Enhance</option>
          </select>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <strong>Default export format</strong>
            <small>Used when exporting documents.</small>
          </div>

          <select id="exportSetting">
            <option value="pdf">PDF</option>
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
          </select>
        </div>

      </div>

    </section>

    <section class="section">

      <div class="section-header">
        <h2>Storage</h2>
      </div>

      <div class="settings-list">

        <div class="setting-row">
          <div class="setting-info">
            <strong>${state.documents.length} documents</strong>
            <small>Stored locally in this V0 build.</small>
          </div>
        </div>

        <button
          id="clearDataBtn"
          class="danger-btn"
          style="width:100%;"
        >
          Clear all local data
        </button>

      </div>

    </section>

    <section class="section">
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <h2>SmartScan V0</h2>
        <p>
          Local-first foundation.
          Camera processing, PDF generation and native sharing
          will be added in later stages.
        </p>
      </div>
    </section>
  `;

  document.getElementById("filterSetting").value =
    state.settings.defaultFilter;

  document.getElementById("exportSetting").value =
    state.settings.defaultExportFormat;

  document
    .getElementById("themeSetting")
    .addEventListener("change", event => {
      state.settings.theme = event.target.value;
      saveState();
      applyTheme();
    });

  document
    .getElementById("filterSetting")
    .addEventListener("change", event => {
      state.settings.defaultFilter = event.target.value;
      saveState();
    });

  document
    .getElementById("exportSetting")
    .addEventListener("change", event => {
      state.settings.defaultExportFormat = event.target.value;
      saveState();
    });

  document
    .getElementById("clearDataBtn")
    .addEventListener("click", clearAllData);
}

function clearAllData() {
  const confirmed = confirm(
    "Clear all SmartScan documents, folders and settings?"
  );

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);

  state = structuredClone(defaultState);

  app.activeDocumentId = null;
  app.scannerPages = [];
  app.pendingImage = null;

  saveState();
  applyTheme();
  navigate("home");

  showToast("All local data cleared.");
}

/* =========================================================
   THEME
   ========================================================= */

function applyTheme() {
  const theme = state.settings.theme;

  let dark = false;

  if (theme === "dark") {
    dark = true;
  }

  if (theme === "system") {
    dark = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  document.body.classList.toggle("dark", dark);

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      dark ? "#101116" : "#f7f8fc"
    );
}

/* =========================================================
   GLOBAL EVENTS
   ========================================================= */

scanFab.addEventListener("click", startScanner);

backBtn.addEventListener("click", goBack);

settingsBtn.addEventListener("click", () => {
  navigate("settings");
});

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    const route = item.dataset.route;

    if (route === "home") {
      app.searchQuery = "";
    }

    navigate(route);
  });
});

window.addEventListener("storage", () => {
  state = loadState();
  render();
});

window
  .matchMedia?.("(prefers-color-scheme: dark)")
  ?.addEventListener("change", () => {
    if (state.settings.theme === "system") {
      applyTheme();
    }
  });

/* =========================================================
   INITIALIZE
   ========================================================= */

applyTheme();
render();
