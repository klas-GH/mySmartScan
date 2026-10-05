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
    autoCapture: true,
    defaultExportFormat: "pdf"
  }
};

let state = loadState();

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

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* =========================================================
   APP STATE
   ========================================================= */

const app = {
  route: "home",
  previousRoute: null,
  activeDocumentId: null,
  editingPageId: null,
  searchQuery: "",
  scannerPages: [],
  pendingImage: null
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

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDocument(id) {
  return state.documents.find(document => document.id === id);
}

function getFolder(id) {
  return state.folders.find(folder => folder.id === id);
}

function getPage(document, pageId) {
  return document?.pages?.find(page => page.id === pageId);
}

function documentPageCount(document) {
  return document?.pages?.length || 0;
}

function documentThumbnail(document) {
  return document?.pages?.[0]?.processedImagePath ||
         document?.pages?.[0]?.originalImagePath ||
         "";
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

function startScanner() {
  app.scannerPages = [];

  navigate("scanner");
}

function renderScanner() {
  main.innerHTML = `
    <section class="scanner">

      <div class="scanner-preview">
        <div class="scanner-label">
          <span class="scanner-pill">Document detection</span>
          <span class="scanner-pill">V0 preview</span>
        </div>
      </div>

      <div class="scanner-controls">

        <div class="scanner-top-controls">
          <button class="scanner-control" id="flashBtn">
            ◐
          </button>

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

  document
    .getElementById("flashBtn")
    ?.addEventListener("click", () => {
      showToast("Flash control will use the native camera in the next stage.");
    });
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

function renderPageEditor() {
  if (!app.pendingImage) {
    navigate("scanner");
    return;
  }

  main.innerHTML = `
    <div class="page-heading">
      <h1>Edit page</h1>
      <p>Clean up your scanned page before saving it.</p>
    </div>

    <div class="editor-preview">
      <img id="editorImage" src="${app.pendingImage}" alt="Scanned page" />
    </div>

    <div class="editor-tools">
      <button class="tool-btn" id="rotateBtn">
        <span>↻</span>
        <span>Rotate</span>
      </button>

      <button class="tool-btn" id="cropBtn">
        <span>⌗</span>
        <span>Crop</span>
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
        ${filterButton("original", "Original")}
        ${filterButton("grayscale", "Grayscale")}
        ${filterButton("bw", "B&W")}
        ${filterButton("enhance", "Enhance")}
      </div>
    </div>

    <div style="display:flex;gap:9px;">
      <button id="retakeBtn" class="secondary-btn" style="flex:1;">
        Retake
      </button>

      <button id="savePageBtn" class="primary-btn" style="flex:1;">
        Use page
      </button>
    </div>
  `;

  document
    .getElementById("rotateBtn")
    ?.addEventListener("click", rotateEditorImage);

  document
    .getElementById("cropBtn")
    ?.addEventListener("click", () => {
      showToast("Crop engine will be added in the image-processing stage.");
    });

  document
    .getElementById("perspectiveBtn")
    ?.addEventListener("click", () => {
      showToast("Perspective correction comes with the real scanner engine.");
    });

  document
    .getElementById("resetBtn")
    ?.addEventListener("click", () => {
      const image = document.getElementById("editorImage");

      image.style.filter = "";
      image.style.transform = "";

      showToast("Edits reset.");
    });

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

function filterButton(id, label) {
  return `
    <button
      class="filter-btn ${id === "original" ? "active" : ""}"
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

  const filters = {
    original: "none",
    grayscale: "grayscale(1)",
    bw: "grayscale(1) contrast(2)",
    enhance: "contrast(1.15) brightness(1.04) saturate(.8)"
  };

  image.style.filter = filters[filter] || "none";
}

function usePage() {
  const image = document.getElementById("editorImage");

  const page = {
    id: uid("page"),
    order: 0,
    originalImagePath: app.pendingImage,
    processedImagePath: app.pendingImage,
    thumbnailPath: app.pendingImage,
    rotation: Number(image?.dataset.rotation || 0),
    filter: "original"
  };

  app.scannerPages.push(page);
  app.pendingImage = null;

  showToast("Page added.");

  /*
    If this is the first page, create a new document.
    If we're adding from an existing document, append to it.
  */

  if (app.activeDocumentId) {
    const document = getDocument(app.activeDocumentId);

    if (document) {
      page.order = document.pages.length;
      document.pages.push(page);
      document.updatedAt = now();

      saveState();
      navigate("document-editor");
      return;
    }
  }

  createDocumentFromScanner();
}

/* =========================================================
   DOCUMENT CREATION
   ========================================================= */

function createDocumentFromScanner() {
  const timestamp = now();

  const document = {
    id: uid("doc"),
    name: `Scan ${formatDate(timestamp)}`,
    folderId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    pages: [...app.scannerPages]
  };

  state.documents.unshift(document);
  saveState();

  app.activeDocumentId = document.id;
  app.scannerPages = [];

  navigate("document-editor");
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

    <div style="display:flex;gap:8px;margin-bottom:18px;">
      <button id="addPageBtn" class="secondary-btn">
        ＋ Add page
      </button>

      <button id="saveDocumentBtn" class="primary-btn">
        Save
      </button>
    </div>

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
      app.pendingImage = null;
      startScanner();
    });

  document
    .getElementById("saveDocumentBtn")
    ?.addEventListener("click", () => {
      doc.updatedAt = now();
      saveState();
      showToast("Document saved.");
    });

  attachPageEvents(document);
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

function attachPageEvents(document) {
  document
    .querySelectorAll("[data-page-action]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const action = button.dataset.pageAction;
        const pageId = button.dataset.pageId;

        handlePageAction(document.id, pageId, action);
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

    app.pendingImage =
      page.processedImagePath ||
      page.originalImagePath;

    app.editingPageId = page.id;

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


function normalizePageOrder(document) {
  document.pages.forEach((page, index) => {
    page.order = index;
  });
}

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
            <strong>Auto-capture</strong>
            <small>Automatically capture detected documents.</small>
          </div>

          <button
            id="autoCaptureToggle"
            class="toggle ${state.settings.autoCapture ? "active" : ""}"
            aria-label="Toggle auto capture"
          ></button>
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
    .getElementById("autoCaptureToggle")
    .addEventListener("click", () => {
      state.settings.autoCapture =
        !state.settings.autoCapture;

      saveState();
      renderSettings();
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
