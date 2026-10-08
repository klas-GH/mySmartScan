/// part 1
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

/* =========================================================
   INDEXEDDB — Image blob storage
   ========================================================= */

const DB_NAME = "smartscan-images";
const DB_VERSION = 1;
const IMAGE_STORE = "images";

let imageDb = null;

/* In-memory fallback for environments without IndexedDB (e.g., tests) */
const memoryImageStore = new Map();

function hasIndexedDB() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openImageDb() {
  // Use in-memory store if IndexedDB not available
  if (!hasIndexedDB()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    if (imageDb) {
      resolve(imageDb);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE);
      }
    };
    request.onsuccess = () => {
      imageDb = request.result;
      resolve(imageDb);
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveImageBlob(key, blob) {
  if (!hasIndexedDB()) {
    memoryImageStore.set(key, blob);
    return;
  }
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getImageBlob(key) {
  if (!hasIndexedDB()) {
    return memoryImageStore.get(key) || undefined;
  }
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const request = tx.objectStore(IMAGE_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteImageBlob(key) {
  if (!hasIndexedDB()) {
    memoryImageStore.delete(key);
    return;
  }
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/*
 * Extract all image data URLs from state, store blobs in IndexedDB,
 * and replace with keys in the state object for localStorage.
 */
async function extractImagesForStorage(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return Promise.all(obj.map(extractImagesForStorage));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.startsWith("data:image/")) {
      result[key] = await storeImage(value);
    } else if (value && typeof value === "object") {
      result[key] = await extractImagesForStorage(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/*
 * Restore image data URLs from IndexedDB keys in state.
 */
async function restoreImagesFromStorage(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return Promise.all(obj.map(restoreImagesFromStorage));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.startsWith("img_")) {
      result[key] = await resolveImage(value);
    } else if (value && typeof value === "object") {
      result[key] = await restoreImagesFromStorage(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/*
 * Generate a unique key for an image.
 */
function imageKey() {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/*
 * In-memory cache for data URLs (for fast synchronous rendering).
 * Keyed by IndexedDB key (img_*). Bounded to prevent unbounded memory growth.
 * Uses simple LRU eviction when limit is reached.
 */
const IMAGE_CACHE_MAX_SIZE = 50;
const imageDataUrlCache = new Map();

/*
 * Tiny inline SVG placeholder used when a real image is not yet in the
 * synchronous cache. Keeps document cards and scanner previews from
 * showing a broken-image icon while the async cache warms.
 */
const PLACEHOLDER_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    `<rect width="48" height="48" rx="8" fill="#2b2e3a"/>` +
    `<path d="M14 32l6-8 5 6 4-5 5 7" fill="none" stroke="#8a8f9c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );

function cacheSet(key, value) {
  if (imageDataUrlCache.size >= IMAGE_CACHE_MAX_SIZE) {
    // Remove oldest entry (first inserted)
    const firstKey = imageDataUrlCache.keys().next().value;
    if (firstKey) imageDataUrlCache.delete(firstKey);
  }
  imageDataUrlCache.set(key, value);
}

function cacheGet(key) {
  const value = imageDataUrlCache.get(key);
  // Move to end (most recently used)
  if (value !== undefined) {
    imageDataUrlCache.delete(key);
    imageDataUrlCache.set(key, value);
  }
  return value;
}

function cacheDelete(key) {
  imageDataUrlCache.delete(key);
}

/*
 * Convert a data URL to a Blob for IndexedDB storage.
 * Works in browser (fetch) and Node.js (manual base64 decode).
 */
async function dataUrlToBlob(dataUrl) {
  if (typeof fetch === "function") {
    try {
      const res = await fetch(dataUrl);
      return res.blob();
    } catch {
      // fall through
    }
  }
  // Manual base64 decode fallback
  const marker = dataUrl.indexOf("base64,");
  if (marker === -1) throw new Error("Invalid data URL");
  const base64 = dataUrl.slice(marker + 7);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes]);
}

/*
 * Convert a Blob to a data URL for UI rendering.
 */
async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/*
 * Store an image (data URL or Blob) in IndexedDB and return its key.
 * If it's already a key (starts with "img_"), return as-is.
 * Also caches the data URL for fast synchronous access.
 */
async function storeImage(imageData) {
  if (typeof imageData === "string" && imageData.startsWith("img_")) {
    return imageData;
  }
  const key = imageKey();
  let dataUrl;

  if (typeof imageData === "string") {
    dataUrl = imageData;
    const blob = await dataUrlToBlob(imageData);
    await saveImageBlob(key, blob);
  } else {
    const blob = imageData;
    await saveImageBlob(key, blob);
    dataUrl = await blobToDataUrl(blob);
  }

  // Cache for fast synchronous access
  cacheSet(key, dataUrl);
  return key;
}

/*
 * Resolve an image key to a data URL for UI display.
 * Checks in-memory cache first (synchronous), then IndexedDB (async).
 */
async function resolveImage(key) {
  if (!key) return "";
  if (typeof key === "string" && key.startsWith("data:")) {
    return key; // already a data URL (legacy)
  }
  if (typeof key === "string" && key.startsWith("blob:")) {
    return key; // blob URL (legacy)
  }

  // Check cache first (synchronous)
  const cached = cacheGet(key);
  if (cached) return cached;

  // Fall back to IndexedDB (async)
  const blob = await getImageBlob(key);
  if (!blob) return "";
  const dataUrl = await blobToDataUrl(blob);
  cacheSet(key, dataUrl);
  return dataUrl;
}

/*
 * Synchronous resolve for rendering - uses cache only.
 * Returns a data URL if in cache, otherwise a placeholder so the
 * UI never shows a broken image while the async cache warms.
 */
function resolveImageSync(key) {
  if (!key) return PLACEHOLDER_DATA_URL;
  if (typeof key === "string" && key.startsWith("data:")) return key;
  if (typeof key === "string" && key.startsWith("blob:")) return key;
  return cacheGet(key) || PLACEHOLDER_DATA_URL;
}

/*
 * Delete an image from IndexedDB.
 */
async function removeImage(key) {
  if (!key || typeof key !== "string" || !key.startsWith("img_")) return;
  await deleteImageBlob(key);
}

/*
 * Clean up orphaned images from IndexedDB.
 * Keeps only images referenced by current state.
 */
async function gcImages() {
  const db = await openImageDb();

  // IndexedDB may be unavailable (private mode, test sandbox); in that
  // case there is nothing to collect.
  if (!db) {
    return;
  }

  const tx = db.transaction(IMAGE_STORE, "readonly");
  const allKeys = await new Promise((resolve, reject) => {
    const request = tx.objectStore(IMAGE_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const referenced = new Set();
  for (const doc of state.documents) {
    for (const page of doc.pages) {
      if (page.originalImagePath) referenced.add(page.originalImagePath);
      if (page.processedImagePath) referenced.add(page.processedImagePath);
      if (page.thumbnailPath) referenced.add(page.thumbnailPath);
    }
  }

  for (const key of allKeys) {
    if (!referenced.has(key)) {
      await deleteImageBlob(key);
    }
  }
}

/*
 * function loadState() {
 *   try {
 *     const saved = localStorage.getItem(STORAGE_KEY);
 *
 *     if (!saved) {
 *       return structuredClone(defaultState);
 *     }
 *
 *     return {
 *       ...structuredClone(defaultState),
 *       ...JSON.parse(saved)
 *     };
 *   } catch (error) {
 *     console.error("Could not load SmartScan data:", error);
 *     return structuredClone(defaultState);
 *   }
 * }
 *
 * function saveState() {
 *   localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
 * }
 */

/* =========================================================
   APP STATE
   ========================================================= */

const app = {
  // Currently opened SmartScan document
  activeDocumentId: null,

  // Page currently being edited
  editingPageId: null,

  // Temporary image being edited
  pendingImage: null,

  // Natural size of the image currently in the editor. Needed to
  // preview a saved crop, because the crop frame's aspect ratio is
  // the crop region's aspect ratio in pixels.
  editorImageSize: null,

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


/* =========================================================
   OCR — Tesseract.js integration
   ========================================================= */

let tesseractWorker = null;
let tesseractLoading = null;

/*
 * Load Tesseract.js from CDN and create a worker.
 * Uses the browser/CDN approach to keep zero build dependencies.
 */
async function loadTesseract() {
  if (tesseractWorker) {
    return tesseractWorker;
  }

  // Ensure Tesseract.js script is loaded
  if (!window.Tesseract) {
    if (!tesseractLoading) {
      tesseractLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Tesseract.js from CDN."));
        document.head.appendChild(script);
      });
    }
    await tesseractLoading;
  }

  try {
    tesseractWorker = await window.Tesseract.createWorker("eng", 1, {
      logger: m => {
        if (m.status === "recognizing text") {
          showToast(`Recognizing text… ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    return tesseractWorker;
  } catch (error) {
    console.error("Failed to create Tesseract worker:", error);
    throw new Error("OCR engine failed to load.");
  }
}

/*
 * Render the current page appearance (original + crop + filter + rotation)
 * to a canvas and return a data URL for OCR processing.
 * Reuses the existing editing pipeline logic.
 */
async function renderPageForOcr(page) {
  const originalKey = page.originalImagePath || page.processedImagePath;

  if (!originalKey) {
    throw new Error("No image available for OCR.");
  }

  // Resolve image key to data URL for OCR
  const original = await resolveImage(originalKey);

  if (!original) {
    throw new Error("Could not load image for OCR.");
  }

  const image = new Image();

  return new Promise((resolve, reject) => {
    image.onload = () => {
      try {
        const crop = page.crop;
        const rotation = page.rotation || 0;
        const filter = page.filter || "original";

        const sourceX = crop ? crop.x * image.naturalWidth : 0;
        const sourceY = crop ? crop.y * image.naturalHeight : 0;
        const sourceWidth = crop ? crop.w * image.naturalWidth : image.naturalWidth;
        const sourceHeight = crop ? crop.h * image.naturalHeight : image.naturalHeight;

        const radians = rotation * Math.PI / 180;
        const swapDimensions = rotation % 180 !== 0;

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          throw new Error("Could not create canvas for OCR.");
        }

        canvas.width = Math.max(1, Math.round(
          swapDimensions ? sourceHeight : sourceWidth
        ));
        canvas.height = Math.max(1, Math.round(
          swapDimensions ? sourceWidth : sourceHeight
        ));

        ctx.filter = filterStyle(filter);
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          -sourceWidth / 2,
          -sourceHeight / 2,
          sourceWidth,
          sourceHeight
        );

        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };

    image.onerror = () => reject(new Error("Image could not be loaded."));
    image.src = original;
  });
}

/*
 * Recognize text from an image data URL using Tesseract.js.
 * Returns the recognized plain text.
 */
async function recognizeText(imageDataUrl) {
  const worker = await loadTesseract();

  try {
    const { data: { text } } = await worker.recognize(imageDataUrl);
    return text.trim();
  } catch (error) {
    console.error("OCR recognition failed:", error);
    throw new Error("Could not recognize text.");
  }
}

/*
 * Open the OCR modal for a page.
 * Shows existing OCR text if available, otherwise runs OCR.
 */
async function openOcrModal(page) {
  const doc = getDocument(app.activeDocumentId);
  if (!doc || !page) {
    showToast("Page not found.");
    return;
  }

  // If OCR text already exists, show it immediately
  if (page.ocrText) {
    showOcrResultModal(page);
    return;
  }

  // Show loading state
  showOcrLoadingModal(page);

  try {
    // Generate current page appearance for OCR
    const imageDataUrl = await renderPageForOcr(page);

    // Run OCR
    const text = await recognizeText(imageDataUrl);

    if (!text) {
      throw new Error("No text was detected on this page.");
    }

    // Save OCR text to page
    page.ocrText = text;
    doc.updatedAt = now();
    saveState();

    // Show result
    showOcrResultModal(page);
  } catch (error) {
    showOcrErrorModal(page, error.message);
  }
}

/*
 * Show OCR loading modal.
 */
function showOcrLoadingModal(page) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="ocrModal">
      <div class="modal">
        <h2>OCR</h2>
        <div style="text-align:center;padding:24px;">
          <div style="font-size:18px;margin-bottom:12px;">Recognizing text…</div>
          <div class="spinner" style="margin:0 auto;"></div>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById("ocrModal");
  modal?.addEventListener("click", e => {
    if (e.target === modal) closeOcrModal();
  });
}

/*
 * Show OCR result modal with recognized text and copy button.
 */
function showOcrResultModal(page) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="ocrModal">
      <div class="modal">
        <h2>Recognized Text</h2>
        <textarea
          id="ocrTextArea"
          readonly
          style="min-height:200px;"
        >${escapeHtml(page.ocrText || "")}</textarea>
        <div class="modal-actions">
          <button id="ocrCopyBtn" class="primary-btn">Copy text</button>
          <button id="ocrRerunBtn" class="secondary-btn">Run again</button>
          <button id="ocrCloseBtn" class="secondary-btn">Close</button>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById("ocrModal");
  modal?.addEventListener("click", e => {
    if (e.target === modal) closeOcrModal();
  });

  document.getElementById("ocrCopyBtn")?.addEventListener("click", async () => {
    await copyOcrText(page);
  });

  document.getElementById("ocrRerunBtn")?.addEventListener("click", async () => {
    page.ocrText = null;
    const doc = getDocument(app.activeDocumentId);
    if (doc) {
      doc.updatedAt = now();
      saveState();
    }
    await openOcrModal(page);
  });

  document.getElementById("ocrCloseBtn")?.addEventListener("click", closeOcrModal);
}

/*
 * Show OCR error modal with retry option.
 */
function showOcrErrorModal(page, message) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="ocrModal">
      <div class="modal">
        <h2>OCR Error</h2>
        <p style="text-align:center;margin:16px 0;">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button id="ocrRetryBtn" class="primary-btn">Try again</button>
          <button id="ocrCloseErrorBtn" class="secondary-btn">Close</button>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById("ocrModal");
  modal?.addEventListener("click", e => {
    if (e.target === modal) closeOcrModal();
  });

  document.getElementById("ocrRetryBtn")?.addEventListener("click", async () => {
    page.ocrText = null;
    const doc = getDocument(app.activeDocumentId);
    if (doc) {
      doc.updatedAt = now();
      saveState();
    }
    await openOcrModal(page);
  });

  document.getElementById("ocrCloseErrorBtn")?.addEventListener("click", closeOcrModal);
}

/*
 * Copy OCR text to clipboard.
 */
async function copyOcrText(page) {
  if (!page.ocrText) {
    showToast("No text to copy.");
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(page.ocrText);
      showToast("Text copied.");
    } else {
      // Fallback for older browsers
      const textarea = document.getElementById("ocrTextArea");
      if (textarea) {
        textarea.select();
        document.execCommand("copy");
        showToast("Text copied.");
      } else {
        throw new Error("Clipboard not available.");
      }
    }
  } catch (error) {
    console.error("Copy failed:", error);
    showToast("Failed to copy text.");
  }
}

/*
 * Close OCR modal.
 */
function closeOcrModal() {
  modalRoot.innerHTML = "";
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

/*
 * Extract images to IndexedDB and save state with keys.
 * Returns true on success, false on failure.
 */
async function saveStateAsync() {
  try {
    const stateForStorage = await extractImagesForStorage(state);

    const serialized = JSON.stringify(stateForStorage);

    // Verify no data URLs leaked into localStorage
    if (serialized.includes("data:image/")) {
      console.warn("WARNING: data URLs found in state serialization!");
    }

    localStorage.setItem(STORAGE_KEY, serialized);

    // Re-keying images into IndexedDB can orphan blobs that are no
    // longer referenced by the new state. Collect them so IndexedDB
    // does not grow by a full copy of every image on every save.
    try {
      await gcImages();
    } catch (error) {
      // Garbage collection is best-effort; a failure must not
      // prevent the state itself from being persisted.
      console.warn("Image garbage collection failed:", error);
    }

    return true;
  } catch (error) {
    console.error("Failed to save SmartScan state:", error);

    // Provide specific error messages for common IndexedDB failures
    let message = "Could not save your changes.";
    if (error.name === "QuotaExceededError") {
      message = "Storage is full. Delete an old document and try again.";
    } else if (error.name === "ConstraintError" || error.name === "DataError") {
      message = "Storage error: data could not be written.";
    } else if (error.name === "SecurityError" || error.message?.includes("private")) {
      message = "Storage unavailable in private/incognito mode.";
    } else if (error.name === "UnknownError" || error.name === "AbortError") {
      message = "Storage operation failed. Please try again.";
    }

    showToast(message);
    return false;
  }
}

/*
 * Migrate legacy data URLs in localStorage to IndexedDB.
 * Call once after loading state if localStorage contains data URLs.
 */
async function migrateLegacyImages() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return true;

  if (!raw.includes("data:image/")) {
    return true; // Already clean
  }

  try {
    console.log("Migrating legacy images to IndexedDB...");
    await saveStateAsync();
    console.log("Migration complete.");
    return true;
  } catch (error) {
    console.error("Migration failed:", error);
    return false;
  }
}

/*
 * Restore image data URLs from IndexedDB keys in state.
 * Call after loadState() to populate data URLs for rendering.
 */
async function restoreImagesInState() {
  state = await restoreImagesFromStorage(state);
}

/* Synchronous wrapper for backward compatibility.
 * Queues async save with image extraction.
 * Returns a promise that resolves when save is complete.
 */
let saveStatePending = false;

function saveState() {
  if (saveStatePending) {
    return Promise.resolve(true);
  }
  saveStatePending = true;

  return saveStateAsync().finally(() => {
    saveStatePending = false;
  });
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

function addAnotherPage() {
  app.pendingImage = null;

  navigate("scanner");

  showToast("Capture the next page.");
}


/* =========================================================
   ROUTING
   ========================================================= */

function navigate(route, options = {}) {
  if (options.from) {
    app.previousRoute = options.from;
  }

  app.route = route;

  // Render synchronously if initialization has already completed.
  // Otherwise wait for the async initialization promise.
  if (appInitializationComplete) {
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (typeof appInitialization !== "undefined") {
    appInitialization.then(() => {
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  } else {
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
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
      <div class="hero-kicker">SMARTSCAN V1.2.0</div>
      <h2>Paper → clean document.</h2>
      <p>
        Scan, clean and organize your documents locally.
        Your files stay on this device.
      </p>
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
    <div
      class="document-card"
      role="button"
      tabindex="0"
      data-document-id="${document.id}"
      aria-label="Open ${escapeHtml(document.name)}"
    >
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
        type="button"
        data-action="menu"
        data-id="${document.id}"
        aria-label="Document actions"
        onclick="event.stopPropagation()"
      >
        ⋮
      </button>
    </button>
  `;
}

function attachDocumentCardEvents() {
  document.querySelectorAll(".document-card").forEach(card => {
    const open = () => openDocument(card.dataset.documentId);

    card.addEventListener("click", event => {
      if (event.target.closest("[data-action='menu']")) {
        return;
      }
      open();
    });

    // Make the card keyboard-activatable like a button.
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
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
    ?.addEventListener("click", async () => {
      await deleteFolder(folder.id);
    });

  attachDocumentCardEvents();
}

/* =========================================================
   SCANNER
   ========================================================= */



function renderScanner() {
  // A pending capture is shown in the scanner preview so the user
  // can accept or retake it from this screen. If none is pending,
  // show the empty capture frame instead.
  const pendingSrc = app.pendingImage ? resolveImageSync(app.pendingImage) : "";

  main.innerHTML = `
    <section class="scanner">

      <div class="scanner-preview">
        ${
          pendingSrc
            ? `<img src="${pendingSrc}" alt="Pending capture" />`
            : ""
        }
      </div>

      <div class="scanner-controls">

        <div class="capture-row">

          <button
            class="capture-button"
            id="captureButton"
            aria-label="Capture"
          ></button>

        </div>

      </div>
    </section>
  `;

  document
    .getElementById("captureButton")
    ?.addEventListener("click", chooseImage);

  if (app.pendingImage) {
    wireScannerPreviewActions();
  }
}

function wireScannerPreviewActions() {
  // Allow accepting or retaking the pending capture from the
  // scanner screen without going through the page editor first.
  const preview = document.querySelector(".scanner-preview");
  if (!preview) {
    return;
  }

  const accept = document.createElement("button");
  accept.className = "primary-btn";
  accept.textContent = "Accept page";
  accept.addEventListener("click", () => {
    if (app.pendingImage) {
      navigate("page-editor");
    }
  });

  const retake = document.createElement("button");
  retake.className = "secondary-btn";
  retake.textContent = "Retake";
  retake.addEventListener("click", () => {
    app.pendingImage = null;
    app.pendingCrop = null;
    app.pendingFilter = null;
    app.cropDraft = null;
    app.cropMode = false;
    app.editorImageSize = null;
    renderScanner();
    showToast("Ready to capture again.");
  });

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "9px";
  actions.style.marginTop = "14px";
  actions.appendChild(accept);
  actions.appendChild(retake);

  document.querySelector(".scanner-controls")?.appendChild(actions);
}


function renderScanSession() {
  const doc = getDocument(app.activeDocumentId);

  if (!doc) {
    navigate("home");
    return;
  }

  const pageCount = doc.pages.length;

  const thumbnailKey =
    doc.pages?.[pageCount - 1]?.processedImagePath ||
    doc.pages?.[pageCount - 1]?.originalImagePath ||
    "";

  const thumbnailSrc = resolveImageSync(thumbnailKey);

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
        thumbnailSrc
          ? `
            <div class="editor-preview">
              <img
                src="${thumbnailSrc}"
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
    // Convert file to blob and store in IndexedDB
    const blob = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

    const key = await storeImage(new Blob([blob], { type: file.type }));

    app.pendingImage = key;

    // A fresh capture starts with no crop.
    app.pendingCrop = null;
    app.pendingFilter = null;
    app.cropDraft = null;
    app.cropMode = false;

    // The natural size is relearned from the new capture.
    app.editorImageSize = null;

navigate("page-editor");
  } catch (error) {
    console.error(error);
    showToast("Could not load that image.");
  }
});

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

  // The live editor image is already loaded here, so its natural
  // size can be read synchronously to preview the applied crop.
  rememberEditorImageSize();

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

/*
 * The element that visually carries the editor preview's rotation
 * and filter. With a saved crop they are applied to the crop frame
 * so they take effect after the crop; without one they live on the
 * image itself, exactly as before.
 */
function editorVisualTarget() {
  return document.querySelector(".crop-result") ||
    document.getElementById("editorImage");
}

/*
 * Read the natural size of the image already in the editor.
 */
function rememberEditorImageSize() {
  const image = document.getElementById("editorImage");

  if (image && image.naturalWidth && image.naturalHeight) {
    app.editorImageSize = {
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  }
}

/*
 * Learn the original's natural size once the editor image loads.
 * A saved crop can only be previewed after that, because the crop
 * frame's aspect ratio is the crop region's aspect ratio in pixels.
 * The size never changes for the same original, so this re-renders
 * at most once per opened image.
 */
function wireEditorImage() {
  const image = document.getElementById("editorImage");

  if (!image) {
    return;
  }

  const onLoad = () => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;

    if (!width || !height) {
      return;
    }

    const known = app.editorImageSize;

    if (!known || known.width !== width || known.height !== height) {
      app.editorImageSize = { width, height };

      if (getCropState() && !app.cropMode) {
        renderPageEditor();
      }
    }
  };

  if (image.complete && image.naturalWidth) {
    onLoad();
  } else if (typeof image.addEventListener === "function") {
    image.addEventListener("load", onLoad);
  }
}

function renderPageEditor() {
  if (!app.pendingImage) {
    navigate("scanner");
    return;
  }

  // Resolve image key to data URL for display (synchronous, uses cache)
  const imageSrc = resolveImageSync(app.pendingImage);

  // If not in cache yet, trigger async resolution and re-render when done
  if (!imageSrc) {
    resolveImage(app.pendingImage).then(dataUrl => {
      if (dataUrl && app.route === "page-editor") {
        renderPageEditor();
      }
    });
    // Show placeholder or wait for async resolution
  }

  const edit = getEditState();

  const crop = getCropState();
  const size = app.editorImageSize;

  /*
   * A saved crop is previewed by clipping the untouched original
   * to the crop region, so the editor shows the same result that
   * Use Page produces. The crop frame's aspect ratio is the crop
   * region's aspect ratio in pixels, which needs the original's
   * natural size. Until that is known (the first render after a
   * page is reopened) the full original is shown, and
   * wireEditorImage() re-renders once the size is learned.
   */
  const showCrop =
    !!crop && !app.cropMode && !!size && crop.w > 0 && crop.h > 0;

  const transform = app.cropMode
    ? "none"
    : `rotate(${edit.rotation}deg)`;

  const filter = filterStyle(edit.filter);

  let cropRatio = 0;

  if (showCrop) {
    cropRatio = (crop.w * size.width) / (crop.h * size.height);
  }

  main.innerHTML = `
    <div class="page-heading">
      <h1>Edit page</h1>
      <p>Clean up your scanned page before saving it.</p>
    </div>

    <div class="editor-preview">
      ${
        showCrop
          ? `
        <div
          class="crop-result"
          style="
            aspect-ratio: ${cropRatio};
            width: min(88%, calc(360px * ${cropRatio}));
            transform: ${transform};
            filter: ${filter};
          "
        >
          <img
            id="editorImage"
            src="${imageSrc}"
            alt="Scanned page"
            data-rotation="${edit.rotation}"
            data-filter="${edit.filter}"
            style="
              width: ${100 / crop.w}%;
              left: ${-100 * crop.x / crop.w}%;
              top: ${-100 * crop.y / crop.h}%;
            "
          />
        </div>
          `
          : `
        <div class="crop-stage">
          <img
            id="editorImage"
            src="${imageSrc}"
            alt="Scanned page"
            data-rotation="${edit.rotation}"
            data-filter="${edit.filter}"
            style="
              transform: ${transform};
              filter: ${filter};
            "
          />

          ${cropOverlayMarkup()}
        </div>
          `
      }
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
        <span>${!!crop ? "Crop ✓" : "Crop"}</span>
      </button>

      <button class="tool-btn" id="ocrBtn" disabled title="OCR is available after the page is saved to a document.">
        <span>◰</span>
        <span>OCR</span>
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
    .getElementById("ocrBtn")
    ?.addEventListener("click", () => {
      openOcrModal();
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

  wireEditorImage();
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
  editorVisualTarget().style.transform = `rotate(${next}deg)`;

  showToast("Page rotated.");
}

function applyFilter(filter) {
  const image = document.getElementById("editorImage");

  if (!image) {
    return;
  }

  image.dataset.filter = filter;

  editorVisualTarget().style.filter = filterStyle(filter);
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

  source.onload = async () => {
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

    const processedImage = canvas.toDataURL("image/jpeg", 0.88);

    const processedKey = await storeImage(processedImage);

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
        existingPage.processedImagePath = processedKey;
        existingPage.thumbnailPath = processedKey;
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
        processedKey,

      thumbnailPath:
        processedKey,

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

  // Resolve img_* key to data URL for processing
  const resolvedSrc = await resolveImage(app.pendingImage);
  if (!resolvedSrc) {
    showToast("Could not load image for processing.");
    return;
  }
  source.src = resolvedSrc;
}

/////part2

/* =========================================================
   DOCUMENT CREATION
   ========================================================= */

async function createDocumentFromScanner(options = {}) {
  if (!app.scannerPages.length) {
    showToast("No scanned pages.");
    return;
  }

  const timestamp = now();

  // Store all page images in IndexedDB and get their keys
  const pages = await Promise.all(app.scannerPages.map(async (page, index) => {
    const originalKey = await storeImage(page.originalImagePath);
    const processedKey = page.processedImagePath
      ? await storeImage(page.processedImagePath)
      : originalKey;
    const thumbnailKey = page.thumbnailPath
      ? await storeImage(page.thumbnailPath)
      : originalKey;

    return {
      id: page.id || createId(),

      documentId: null,

      order: index,

      originalImagePath: originalKey,

      processedImagePath: processedKey,

      thumbnailPath: thumbnailKey,

      rotation: page.rotation || 0,

      filter: page.filter || "original",

      crop: page.crop || null
    };
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

  // Restore new document's images to data URLs for immediate rendering
  await restoreImagesInState();

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
    .getElementById("exportBtn")
    ?.addEventListener("click", () => {
      showExportSheet(doc.id);
    });

  attachPageEvents(doc);
}

function pageCard(document, page, index) {
  const imageKey =
    page.processedImagePath ||
    page.originalImagePath ||
    "";

  const imageSrc = resolveImageSync(imageKey);

  return `
    <article class="page-card">

      <span class="page-number">
        ${index + 1}
      </span>

      ${
        imageSrc
          ? `<img class="page-image" src="${imageSrc}" alt="Page ${index + 1}" />`
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

        <button
          data-page-action="ocr"
          data-page-id="${page.id}"
        >
          OCR
        </button>

      </div>
    </article>
  `;
}

function attachPageEvents(doc) {
  window.document
    .querySelectorAll("[data-page-action]")
    .forEach(button => {
      button.addEventListener("click", async event => {
        event.stopPropagation();

        const action = button.dataset.pageAction;
        const pageId = button.dataset.pageId;

        await handlePageAction(doc.id, pageId, action);
      });
    });
}


async function handlePageAction(documentId, pageId, action) {
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

    // The natural size must be relearned for the newly opened image.
    app.editorImageSize = null;

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
    const confirmed = await confirmAction(
      "Delete this page?",
      {
        title: "Delete page",
        detail: "This page will be removed from the document."
      }
    );

    if (!confirmed) {
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

  // -----------------------------------------
  // OCR page
  // -----------------------------------------

  if (action === "ocr") {
    const page = doc.pages[index];
    openOcrModal(page);
    return;
  }
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
    .addEventListener("click", async () => {
      closeModal();
      await deleteDocument(documentId);
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

async function deleteDocument(documentId) {
  const doc = getDocument(documentId);

  if (!doc) {
    return;
  }

  const confirmed = await confirmAction(
    `Delete "${doc.name}"?`,
    {
      title: "Delete document",
      detail: "This document and all of its pages will be removed."
    }
  );

  if (!confirmed) {
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
  {
    id: "pdf",
    label: "PDF",
    hint: "One file, all pages"
  },
  {
    id: "jpg",
    label: "JPG",
    hint: "JPG or ZIP for multiple pages"
  },
  {
    id: "png",
    label: "PNG",
    hint: "PNG or ZIP for multiple pages"
  }
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

async function loadImageElement(source) {
  // Resolve IndexedDB key to data URL if needed
  const dataUrl = await resolveImage(source);

  if (!dataUrl) {
    throw new Error("Could not load a page image.");
  }

  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Could not load a page image."));

    image.src = dataUrl;
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

/* =========================================================
   STORE-ONLY ZIP
   ---------------------------------------------------------
   Minimal ZIP writer for SmartScan image exports.

   Features:
   - ZIP method 0 (stored / no compression)
   - UTF-8 filenames
   - CRC-32
   - Multiple files
   - No external dependencies
   - No ZIP64 for V1

   Intended for JPG/PNG export only.
   ========================================================= */

const ZIP_VERSION_NEEDED = 20;
const ZIP_GENERAL_PURPOSE_UTF8 = 0x0800;
const ZIP_METHOD_STORE = 0;

function writeUint16LE(value) {
  const bytes = new Uint8Array(2);

  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;

  return bytes;
}

function writeUint32LE(value) {
  const bytes = new Uint8Array(4);

  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;
  bytes[2] = (value >>> 16) & 0xff;
  bytes[3] = (value >>> 24) & 0xff;

  return bytes;
}

function concatByteArrays(chunks) {
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


/* ---------------------------------------------------------
   CRC-32
   --------------------------------------------------------- */

const ZIP_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index++) {
    let value = index;

    for (let bit = 0; bit < 8; bit++) {
      value =
        value & 1
          ? 0xedb88320 ^ (value >>> 1)
          : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index++) {
    crc =
      ZIP_CRC32_TABLE[
        (crc ^ bytes[index]) & 0xff
      ] ^
      (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}


/* ---------------------------------------------------------
   ZIP filename encoding
   --------------------------------------------------------- */

const ZIP_TEXT_ENCODER = new TextEncoder();

function zipUtf8(text) {
  return ZIP_TEXT_ENCODER.encode(String(text));
}


/* ---------------------------------------------------------
   DOS date/time
   --------------------------------------------------------- */

function zipDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());

  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);

  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return {
    time: dosTime,
    date: dosDate
  };
}


/* ---------------------------------------------------------
   ZIP writer
   --------------------------------------------------------- */

function buildStoreOnlyZip(files) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error("ZIP requires at least one file.");
  }

  const localParts = [];
  const centralParts = [];

  let localOffset = 0;

  const nowDate = zipDosDateTime();

  files.forEach(file => {
    if (!file || !file.name || !file.data) {
      throw new Error("Invalid ZIP file entry.");
    }

    const data =
      file.data instanceof Uint8Array
        ? file.data
        : new Uint8Array(file.data);

    const nameBytes = zipUtf8(file.name);

    if (nameBytes.length > 0xffff) {
      throw new Error("ZIP filename is too long.");
    }

    if (data.length > 0xffffffff) {
      throw new Error("ZIP file is too large.");
    }

    const checksum = crc32(data);

    /*
     * Local file header
     *
     * Signature              4
     * Version needed         2
     * Flags                   2
     * Compression             2
     * Time                    2
     * Date                    2
     * CRC-32                  4
     * Compressed size         4
     * Uncompressed size       4
     * Filename length         2
     * Extra length            2
     */

    const localHeader = concatByteArrays([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),

      writeUint16LE(ZIP_VERSION_NEEDED),

      writeUint16LE(
        ZIP_GENERAL_PURPOSE_UTF8
      ),

      writeUint16LE(ZIP_METHOD_STORE),

      writeUint16LE(nowDate.time),
      writeUint16LE(nowDate.date),

      writeUint32LE(checksum),

      writeUint32LE(data.length),
      writeUint32LE(data.length),

      writeUint16LE(nameBytes.length),

      writeUint16LE(0)
    ]);

    localParts.push(
      localHeader,
      nameBytes,
      data
    );

    /*
     * Central directory entry
     *
     * Signature              4
     * Version made by       2
     * Version needed         2
     * Flags                  2
     * Compression            2
     * Time                   2
     * Date                   2
     * CRC-32                 4
     * Compressed size        4
     * Uncompressed size      4
     * Filename length        2
     * Extra length            2
     * Comment length         2
     * Disk number             2
     * Internal attributes    2
     * External attributes    4
     * Local header offset    4
     */

    const centralHeader = concatByteArrays([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),

      // Version made by:
      // 3 = Unix, 20 = ZIP version 2.0
      writeUint16LE(0x0314),

      writeUint16LE(ZIP_VERSION_NEEDED),

      writeUint16LE(
        ZIP_GENERAL_PURPOSE_UTF8
      ),

      writeUint16LE(ZIP_METHOD_STORE),

      writeUint16LE(nowDate.time),
      writeUint16LE(nowDate.date),

      writeUint32LE(checksum),

      writeUint32LE(data.length),
      writeUint32LE(data.length),

      writeUint16LE(nameBytes.length),

      writeUint16LE(0), // extra length
      writeUint16LE(0), // comment length

      writeUint16LE(0), // disk number

      writeUint16LE(0), // internal attributes

      writeUint32LE(0), // external attributes

      writeUint32LE(localOffset)
    ]);

    centralParts.push(
      centralHeader,
      nameBytes
    );

    localOffset +=
      localHeader.length +
      nameBytes.length +
      data.length;
  });

  const centralDirectory = concatByteArrays(
    centralParts
  );

  const localDirectory = concatByteArrays(
    localParts
  );

  const centralDirectoryOffset =
    localDirectory.length;

  /*
   * End of central directory
   *
   * Signature                  4
   * Disk number                2
   * Central directory disk     2
   * Entries on disk            2
   * Total entries              2
   * Central directory size     4
   * Central directory offset   4
   * Comment length             2
   */

  const endOfCentralDirectory = concatByteArrays([
    new Uint8Array([
      0x50, 0x4b, 0x05, 0x06
    ]),

    writeUint16LE(0),
    writeUint16LE(0),

    writeUint16LE(files.length),
    writeUint16LE(files.length),

    writeUint32LE(
      centralDirectory.length
    ),

    writeUint32LE(
      centralDirectoryOffset
    ),

    writeUint16LE(0)
  ]);

  return concatByteArrays([
    localDirectory,
    centralDirectory,
    endOfCentralDirectory
  ]);
}

/* =========================================================
   ZIP SELF-TEST
   ---------------------------------------------------------
   Development-only integrity test.

   Verifies:
   - ZIP can be parsed
   - filenames survive UTF-8 encoding
   - stored bytes are unchanged
   - CRC-32 values are correct
   - empty files work
   ========================================================= */

function bytesEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

function assertZipSelfTest(condition, message) {
  if (!condition) {
    throw new Error(
      `ZIP self-test failed: ${message}`
    );
  }
}


/*
 * Read the local file entries from the exact ZIP format
 * produced by buildStoreOnlyZip().
 *
 * This is intentionally NOT a general ZIP parser.
 * It only understands our store-only ZIP format.
 */
function readStoreOnlyZipForTest(bytes) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );

  const decoder = new TextDecoder();

  const entries = [];

  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature =
      view.getUint32(offset, true);

    /*
     * Local file header
     */
    if (signature === 0x04034b50) {
      const compression =
        view.getUint16(
          offset + 8,
          true
        );

      const checksum =
        view.getUint32(
          offset + 14,
          true
        );

      const compressedSize =
        view.getUint32(
          offset + 18,
          true
        );

      const uncompressedSize =
        view.getUint32(
          offset + 22,
          true
        );

      const fileNameLength =
        view.getUint16(
          offset + 26,
          true
        );

      const extraLength =
        view.getUint16(
          offset + 28,
          true
        );

      assertZipSelfTest(
        compression === ZIP_METHOD_STORE,
        "entry is not store-only"
      );

      assertZipSelfTest(
        compressedSize === uncompressedSize,
        "stored entry has different compressed/uncompressed sizes"
      );

      const nameStart =
        offset + 30;

      const nameEnd =
        nameStart + fileNameLength;

      const extraEnd =
        nameEnd + extraLength;

      const name =
        decoder.decode(
          bytes.slice(
            nameStart,
            nameEnd
          )
        );

      const dataEnd =
        extraEnd + compressedSize;

      assertZipSelfTest(
        dataEnd <= bytes.length,
        `entry "${name}" extends beyond ZIP`
      );

      const data =
        bytes.slice(
          extraEnd,
          dataEnd
        );

      entries.push({
        name,
        data,
        checksum
      });

      offset = dataEnd;

      continue;
    }

    /*
     * Central directory.
     *
     * We only need the local entries for the
     * byte-for-byte integrity test.
     */
    if (signature === 0x02014b50) {
      break;
    }

    /*
     * End of central directory.
     */
    if (signature === 0x06054b50) {
      break;
    }

    throw new Error(
      `Unexpected ZIP signature at offset ${offset}`
    );
  }

  return entries;
}


function runZipSelfTest() {
  console.group("SmartScan ZIP self-test");

  try {
    /*
     * Deliberately use recognizable bytes rather than
     * real images. The ZIP layer doesn't care whether
     * the bytes came from JPG, PNG or anything else.
     */

    const testFiles = [
      {
        name: "page-1.jpg",

        data: new Uint8Array([
          0xff, 0xd8, 0xff, 0xe0,
          0x00, 0x10, 0x4a, 0x46,
          0x49, 0x46, 0x00, 0x01,
          0x02, 0x03, 0x04,
          0xff, 0xd9
        ])
      },

      {
        name: "page 2.png",

        data: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47,
          0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52
        ])
      },

      {
        name: "unicode-ășț.png",

        data: new Uint8Array([
          0x00,
          0x01,
          0x02,
          0x7f,
          0x80,
          0xfe,
          0xff
        ])
      },

      {
        name: "empty.jpg",

        data: new Uint8Array([])
      }
    ];


    /*
     * Build ZIP.
     */
    const zipBytes =
      buildStoreOnlyZip(
        testFiles
      );


    assertZipSelfTest(
      zipBytes instanceof Uint8Array,
      "buildStoreOnlyZip() did not return Uint8Array"
    );

    assertZipSelfTest(
      zipBytes.length > 0,
      "ZIP is empty"
    );


    /*
     * Read entries back.
     */
    const extracted =
      readStoreOnlyZipForTest(
        zipBytes
      );


    assertZipSelfTest(
      extracted.length === testFiles.length,
      `expected ${testFiles.length} entries, got ${extracted.length}`
    );


    /*
     * Verify every entry.
     */
    testFiles.forEach(
      (expected, index) => {
        const actual =
          extracted[index];

        assertZipSelfTest(
          actual.name === expected.name,
          `filename mismatch at entry ${index + 1}`
        );

        assertZipSelfTest(
          bytesEqual(
            actual.data,
            expected.data
          ),
          `byte mismatch in "${expected.name}"`
        );


        /*
         * Verify CRC stored in the ZIP header.
         */
        const expectedCrc =
          crc32(expected.data);

        assertZipSelfTest(
          actual.checksum === expectedCrc,
          `CRC mismatch in "${expected.name}"`
        );


        /*
         * Recalculate CRC from the extracted bytes.
         *
         * This gives us an additional integrity check.
         */
        const extractedCrc =
          crc32(actual.data);

        assertZipSelfTest(
          extractedCrc === expectedCrc,
          `extracted CRC mismatch in "${expected.name}"`
        );


        console.log(
          `✓ ${expected.name} — ` +
          `${expected.data.length} bytes — ` +
          `CRC ${expectedCrc.toString(16).padStart(8, "0")}`
        );
      }
    );


    /*
     * Verify the ZIP end-of-central-directory record
     * exists somewhere in the archive.
     */
    let foundEndRecord = false;

    for (
      let index = 0;
      index + 4 <= zipBytes.length;
      index++
    ) {
      if (
        zipBytes[index] === 0x50 &&
        zipBytes[index + 1] === 0x4b &&
        zipBytes[index + 2] === 0x05 &&
        zipBytes[index + 3] === 0x06
      ) {
        foundEndRecord = true;
        break;
      }
    }

    assertZipSelfTest(
      foundEndRecord,
      "end-of-central-directory record not found"
    );


    console.log(
      `✓ ${extracted.length} entries verified`
    );

    console.log(
      "✓ ZIP byte-for-byte integrity verified"
    );

    console.log(
      "✓ ZIP CRC-32 values verified"
    );

    console.log(
      "✓ ZIP self-test passed"
    );

    return true;

  } catch (error) {
    console.error(
      "✗ ZIP self-test failed:",
      error
    );

    return false;

  } finally {
    console.groupEnd();
  }
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


async function exportDocumentImages(
  documentId,
  extension,
  mode = "download"
) {
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

  const type =
    extension === "png"
      ? "image/png"
      : "image/jpeg";

  const quality =
    type === "image/jpeg"
      ? 0.92
      : undefined;

  const many = sources.length > 1;

  try {
    /*
     * -------------------------------------------------------
     * Single page
     *
     * Keep the existing behaviour:
     *
     * document.jpg
     * document.png
     * -------------------------------------------------------
     */

    if (!many) {
      const canvas =
        await renderPageToCanvas(sources[0]);

      const blob =
        await canvasToBlob(
          canvas,
          type,
          quality
        );

      const exports = [{
        blob,
        fileName:
          exportFileName(
            doc.name,
            extension
          )
      }];

      await deliverExports(
        exports,
        mode,
        extension.toUpperCase(),
        1
      );

      return;
    }


    /*
     * -------------------------------------------------------
     * Multiple pages
     *
     * Create:
     *
     * document.zip
     *
     * containing:
     *
     * document-1.jpg
     * document-2.jpg
     * document-3.jpg
     *
     * or:
     *
     * document-1.png
     * document-2.png
     * document-3.png
     * -------------------------------------------------------
     */

    const zipFiles = [];

    for (
      let index = 0;
      index < sources.length;
      index++
    ) {
      const canvas =
        await renderPageToCanvas(
          sources[index]
        );

      const blob =
        await canvasToBlob(
          canvas,
          type,
          quality
        );

      const data =
        new Uint8Array(
          await blob.arrayBuffer()
        );

      zipFiles.push({
        name:
          exportFileName(
            doc.name,
            extension,
            `-${index + 1}`
          ),

        data
      });
    }

    const zipBytes =
      buildStoreOnlyZip(zipFiles);

    const zipBlob =
      new Blob(
        [zipBytes],
        {
          type: "application/zip"
        }
      );

    const exports = [{
      blob: zipBlob,

      fileName:
        exportFileName(
          doc.name,
          "zip"
        )
    }];

    await deliverExports(
      exports,
      mode,
      `${extension.toUpperCase()} ZIP`,
      sources.length
    );

  } catch (error) {
    console.error(
      `SmartScan ${extension} export failed:`,
      error
    );

    showToast(
      `Could not export the ${extension.toUpperCase()} pages.`
    );

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
   CONFIRMATION MODAL
   ========================================================= */

/*
 * Replace native confirm() dialogs with an in-app modal so
 * destructive actions feel consistent with the rest of the UI.
 *
 * Resolves with true when the user confirms, false otherwise.
 */
function confirmAction(message, options = {}) {
  return new Promise(resolve => {
    const confirmText = options.confirmText || "Delete";
    const cancelText = options.cancelText || "Cancel";
    const danger = options.danger !== false;
    const detail = options.detail || "";

    modalRoot.innerHTML = `
      <div class="modal-backdrop" id="confirmBackdrop">
        <div class="modal">

          <h2>${escapeHtml(options.title || "Confirm")}</h2>

          <p>${escapeHtml(message)}</p>

          ${
            detail
              ? `<small>${escapeHtml(detail)}</small>`
              : ""
          }

          <div class="modal-actions">
            <button id="confirmCancel" class="secondary-btn">
              ${escapeHtml(cancelText)}
            </button>

            <button
              id="confirmOk"
              class="${danger ? "danger-btn" : "primary-btn"}"
            >
              ${escapeHtml(confirmText)}
            </button>
          </div>

        </div>
      </div>
    `;

    const backdrop = document.getElementById("confirmBackdrop");
    const ok = document.getElementById("confirmOk");
    const cancel = document.getElementById("confirmCancel");

    const cleanup = result => {
      backdrop.removeEventListener("click", onBackdrop);
      resolve(result);
    };

    const onBackdrop = event => {
      if (event.target.id === "confirmBackdrop") {
        cleanup(false);
      }
    };

    backdrop.addEventListener("click", onBackdrop);

    cancel.addEventListener("click", () => cleanup(false));
    ok.addEventListener("click", () => cleanup(true));

    ok.focus();
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

async function deleteFolder(folderId) {
  const folder = getFolder(folderId);

  if (!folder) {
    return;
  }

  const confirmed = await confirmAction(
    `Delete folder "${folder.name}"?`,
    {
      title: "Delete folder",
      detail: "Documents in this folder will not be deleted."
    }
  );

  if (!confirmed) {
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
            <small>Stored locally on this device.</small>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <strong>Storage used</strong>
            <small id="storageEstimateLabel">Checking…</small>
          </div>
          <button id="refreshStorageBtn" class="secondary-btn" style="min-height:38px;padding:0 12px;">
            ↻
          </button>
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
        <h2>SmartScan V1.2.0</h2>
        <p>
          Local-first document scanning with multi-page capture,
          editing, PDF/JPG/PNG export, and native sharing.
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

  refreshStorageEstimate();
  document
    .getElementById("refreshStorageBtn")
    ?.addEventListener("click", refreshStorageEstimate);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "unknown";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/*
 * Surface the browser's storage estimate in Settings so the
 * local-first story is concrete. Best-effort: failures fall back to
 * a static message rather than breaking the settings screen.
 */
async function refreshStorageEstimate() {
  const label = document.getElementById("storageEstimateLabel");
  if (!label) {
    return;
  }

  if (!navigator.storage?.estimate) {
    label.textContent = "Storage estimate unavailable.";
    return;
  }

  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) {
      label.textContent = "Unlimited local storage.";
      return;
    }
    label.textContent =
      `${formatBytes(usage)} used of ${formatBytes(quota)}`;
  } catch (error) {
    console.warn("Could not read storage estimate:", error);
    label.textContent = "Storage estimate unavailable.";
  }
}

async function clearImageDb() {
  if (!hasIndexedDB()) {
    memoryImageStore.clear();
    return;
  }

  try {
    const db = await openImageDb();
    if (!db) {
      memoryImageStore.clear();
      return;
    }

    if (!db.objectStoreNames.contains(IMAGE_STORE)) {
      return;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readwrite");
      tx.objectStore(IMAGE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Drop the store so the database starts fresh; avoids stale
    // version metadata if the schema ever changes. Reset the cached
    // handle so the next openImageDb() opens the new database.
    db.close();
    imageDb = null;
    indexedDB.deleteDatabase(DB_NAME);
  } catch (error) {
    console.warn("Could not clear image storage:", error);
  }
}

async function clearAllData() {
  const confirmed = await confirmAction(
    "Clear all SmartScan documents, folders and settings?",
    {
      title: "Clear all data",
      confirmText: "Clear everything",
      detail: "This cannot be undone."
    }
  );

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);

  state = structuredClone(defaultState);

  app.activeDocumentId = null;
  app.scannerPages = [];
  app.pendingImage = null;

  // Clear the image blob store too, otherwise "clear all data"
  // leaves orphaned blobs behind in IndexedDB.
  clearImageDb().catch(error => {
    console.warn("Image storage cleanup failed:", error);
  });

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
  if (appInitializationComplete) {
    render();
  } else if (typeof appInitialization !== "undefined") {
    appInitialization.then(() => render());
  } else {
    render();
  }
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

/* =========================================================
   INITIALIZE
   ========================================================= */

applyTheme();

// Global initialization promise
let appInitializationComplete = false;
let appInitialization = (async () => {
  // Request persistent storage if supported
  if (navigator.storage?.persist) {
    try {
      const persistent = await navigator.storage.persist();
      console.log("Persistent storage:", persistent);
    } catch {}
  }

  // Monitor storage estimate if supported
  if (navigator.storage?.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      console.log(
        `Storage: ${(usage / 1024 / 1024).toFixed(1)} MB / ` +
        `${(quota / 1024 / 1024).toFixed(1)} MB`
      );
    } catch {}
  }

  // Restore image data URLs from IndexedDB before initial render
  await restoreImagesInState().catch(err => {
    console.error("Failed to restore images:", err);
  });

  // Migrate any legacy data URLs in localStorage to IndexedDB
  await migrateLegacyImages().catch(err => {
    console.error("Legacy image migration failed:", err);
  });

  // Register the service worker so the app shell is cached for
  // offline use. This is best-effort and never blocks startup.
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
      console.log("SmartScan service worker registered.");
    } catch (error) {
      console.warn("SmartScan service worker registration failed:", error);
    }
  }

  render();
  appInitializationComplete = true;
})();
// runZipSelfTest();

