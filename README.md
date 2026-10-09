# SmartScan

SmartScan is a small, fast, mobile-first document scanner. It turns paper
documents into clean, shareable PDFs, JPGs and PNGs — entirely on your device.

## Features

- Scan multiple pages into one document (camera or file import).
- Import existing images from device gallery/files into new or existing documents.
- Crop, rotate and apply filters (Original, Grayscale, Black & White, Enhance).
- Lossless re-editing: the original image is preserved, so edits never compound.
- OCR on saved pages — runs locally via Tesseract.js.
  - 11 languages: English, Spanish, French, German, Italian, Portuguese,
    Chinese (Simplified), Japanese, Korean, Russian, Arabic.
  - Configurable preprocessing: adaptive (resize+grayscale+binarize), grayscale only, or none.
  - Configurable page segmentation (PSM): auto, single block, single line, word, raw line.
- Organize documents into folders.
- Export as PDF, JPG or PNG. Multi-page JPG/PNG exports bundle into a ZIP.
- Share through the native share sheet when supported, otherwise download.
- Light / dark / system theme.
- PWA: installable, works offline, caches app shell.
- All data stays on this device. No account, no cloud, no upload.
- Documents with zero pages are automatically removed from views.

## Architecture

- Vanilla JavaScript, HTML and CSS. **No build step or package manager required.**
- Uses **Tesseract.js** (loaded from CDN) for optical character recognition.
- Relies on browser-native **IndexedDB** and **Clipboard API** for local storage and clipboard access.
- State in `localStorage`; images in `IndexedDB` with an in-memory LRU cache.
- Hand-rolled store-only ZIP writer and PDF generator.
- Cross-tab sync via `storage` event.

## Running locally

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080/`.

## Browser support

SmartScan runs in any modern browser with IndexedDB, a Clipboard API and
Tesseract.js support. It also works from `file://`, but the native
share sheet and some clipboard features are best on a real server.

- **Copy text** uses the async Clipboard API first, then falls back to
  `document.execCommand("copy")`. `execCommand` is deprecated but still
  supported by every current browser, so it stays as the last resort.
- **Share** probes `navigator.canShare` with a throwaway file and retries
  with a single file if multi-file sharing is refused, then falls back
  to a download.

## Version

V1.10.1.

## License

MIT — see [LICENSE](LICENSE).

Tesseract.js is used under the Apache License 2.0 — see
[LICENSES/TESSERACT-JS-APACHE-2.0.txt](LICENSES/TESSERACT-JS-APACHE-2.0.txt).