/*
 * SmartScan — ZIP integrity suite.
 *
 * Verifies the hand-rolled store-only ZIP writer (buildStoreOnlyZip)
 * and its self-test parser (readStoreOnlyZipForTest) agree, and that
 * CRC-32, UTF-8 filenames and byte-for-byte integrity hold.
 */

"use strict";

const { ctx, assert, assertEqual, assertDeepEqual } = require("./harness");

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

suite("ZIP integrity", () => {
  const { buildStoreOnlyZip, readStoreOnlyZipForTest, crc32, assertZipSelfTest, bytesEqual } = ctx();

  run("empty input throws", () => {
    let threw = false;
    try { buildStoreOnlyZip([]); } catch { threw = true; }
    assert(threw, "buildStoreOnlyZip([]) should throw");
  });

  run("single file round-trips", () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
    const zip = buildStoreOnlyZip([{ name: "page-1.jpg", data }]);
    assert(ArrayBuffer.isView(zip), "returns a typed array");
    assert(zip.length > 0, "zip is not empty");

    const extracted = readStoreOnlyZipForTest(zip);
    assertEqual(extracted.length, 1, "one entry extracted");
    assertEqual(extracted[0].name, "page-1.jpg", "filename preserved");
    assert(bytesEqual(extracted[0].data, data), "bytes preserved");
    assertEqual(extracted[0].checksum, crc32(data), "CRC matches");
  });

  run("multiple files preserve order and names", () => {
    const files = [
      { name: "document-1.jpg", data: new Uint8Array([1, 2, 3]) },
      { name: "document-2.jpg", data: new Uint8Array([4, 5, 6, 7]) },
      { name: "document-3.jpg", data: new Uint8Array([8]) }
    ];
    const zip = buildStoreOnlyZip(files);
    const extracted = readStoreOnlyZipForTest(zip);
    assertEqual(extracted.length, files.length, "entry count");
    for (let i = 0; i < files.length; i++) {
      assertEqual(extracted[i].name, files[i].name, `name ${i}`);
      assert(bytesEqual(extracted[i].data, files[i].data), `bytes ${i}`);
    }
  });

  run("UTF-8 filenames survive", () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x7f, 0x80, 0xfe, 0xff]);
    const zip = buildStoreOnlyZip([{ name: "unicode-ășț.png", data }]);
    const extracted = readStoreOnlyZipForTest(zip);
    assertEqual(extracted[0].name, "unicode-ășț.png", "unicode filename");
    assert(bytesEqual(extracted[0].data, data), "unicode bytes");
  });

  run("empty file is valid", () => {
    const zip = buildStoreOnlyZip([{ name: "empty.jpg", data: new Uint8Array([]) }]);
    const extracted = readStoreOnlyZipForTest(zip);
    assertEqual(extracted.length, 1, "one entry");
    assertEqual(extracted[0].data.length, 0, "zero-length data");
    assertEqual(extracted[0].checksum, crc32(new Uint8Array([])), "empty CRC");
  });

  run("end-of-central-directory record present", () => {
    const zip = buildStoreOnlyZip([{ name: "x.jpg", data: new Uint8Array([0xaa]) }]);
    let found = false;
    for (let i = 0; i + 4 <= zip.length; i++) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        found = true;
        break;
      }
    }
    assert(found, "EOCD signature present");
  });

  run("large-ish payload round-trips", () => {
    const data = new Uint8Array(5000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;
    const zip = buildStoreOnlyZip([{ name: "big.jpg", data }]);
    const extracted = readStoreOnlyZipForTest(zip);
    assert(bytesEqual(extracted[0].data, data), "large payload intact");
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);