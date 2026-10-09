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
- PWA: installable, **app shell works offline**; OCR requires cached Tesseract.js and language data.
- Documents and app data stay on this device. No account or cloud storage.
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

SmartScan works in modern browsers that support IndexedDB, the Clipboard API and Tesseract.js.

- **Copy text** uses the Clipboard API when available, with a fallback for older browsers.
- **Share** uses the native share sheet when supported, otherwise it downloads the file.

## Version

1.10.3.

## License

MIT — see [LICENSE](LICENSE).

Tesseract.js is used under the Apache License 2.0 — see
[LICENSES/TESSERACT-JS-APACHE-2.0.txt](LICENSES/TESSERACT-JS-APACHE-2.0.txt).
