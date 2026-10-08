# SmartScan

SmartScan is a small, fast, mobile-first document scanner. It turns paper
documents into clean, shareable PDFs, JPGs and PNGs — entirely on your device.

## Features

- Scan multiple pages into one document.
- Crop, rotate and apply filters (Original, Grayscale, Black & White, Enhance).
- Lossless re-editing: the original image is preserved, so edits never compound.
- OCR (English) on saved pages — runs locally via Tesseract.js.
- Organize documents into folders.
- Export as PDF, JPG or PNG. Multi-page JPG/PNG exports bundle into a ZIP.
- Share through the native share sheet when supported, otherwise download.
- Light / dark / system theme.
- All data stays on this device. No account, no cloud, no upload.

## Architecture

- Vanilla JavaScript, HTML and CSS.
- Zero build step, zero runtime dependencies.
- State in `localStorage`; images in `IndexedDB` with an in-memory LRU cache.
- Hand-rolled store-only ZIP writer and PDF generator.

## Running locally

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080/`.

## Version

V1.2.0.

## License

MIT — see [LICENSE](LICENSE).

Tesseract.js is used under the Apache License 2.0 — see
[LICENSES/TESSERACT-JS-APACHE-2.0.txt](LICENSES/TESSERACT-JS-APACHE-2.0.txt).