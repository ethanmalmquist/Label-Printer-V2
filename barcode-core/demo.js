/**
 * Runnable smoke test / usage demo for barcode-core.
 * No file I/O, no Excel — everything uses small in-memory fake rows.
 *
 *   node barcode-core/demo.js
 */

const assert = require("assert");
const path = require("path");

const {
  sanitizeZplText,
  centerBarcodeX,
  buildCode128Zpl,
  formatHumanReadableText,
  createStoredBarcodeReader,
  computeLocationBarcode,
  createRandomNumericBarcodeGenerator,
  createFixedLengthNumericValidator,
  normalizeSelectedBarcodeRequests,
  buildBarcodeRowIndex,
  resolveSelectedRows,
} = require("./index");

let stepNumber = 0;
function step(title, fn) {
  stepNumber += 1;
  fn();
  console.log(`[ok] ${stepNumber}. ${title}`);
}

// 1. Computed strategy: location barcode, checked against the source app's
//    own implementation so the extraction is proven behavior-preserving.
step("computeLocationBarcode matches labels/location.js for the same input", () => {
  const fields = { aisle: "a", bay: "1", level: "2", bin: "3" };
  const value = computeLocationBarcode(fields);
  assert.strictEqual(value, "A010203");

  const locationModulePath = path.join(__dirname, "..", "labels", "location.js");
  const locationModule = require(locationModulePath);
  const originalValue = locationModule.buildLocationBarcode({
    Aisle: fields.aisle,
    Bay: fields.bay,
    Level: fields.level,
    Bin: fields.bin,
  });
  assert.strictEqual(value, originalValue);
});

// 2. Stored strategy: read an already-populated column (Equipment/Product style).
let storedBarcode;
step("createStoredBarcodeReader reads an existing column", () => {
  const readBarcode = createStoredBarcodeReader("Barcode 128");
  storedBarcode = readBarcode({ "Barcode 128": " 123456789012 " });
  assert.strictEqual(storedBarcode, "123456789012");
});

// 3. Random strategy: unique numeric generator, avoiding a reserved set.
let generatedBarcode;
step("createRandomNumericBarcodeGenerator avoids reserved values", () => {
  const reserved = new Set(["000000000000"]);
  const validate = createFixedLengthNumericValidator(12);
  const generator = createRandomNumericBarcodeGenerator({
    length: 12,
    isReserved: (value) => reserved.has(value),
  });

  generatedBarcode = generator.generate();
  assert.ok(validate(generatedBarcode));
  assert.ok(!reserved.has(generatedBarcode));
});

// 4. ZPL emission: build one example label per strategy, and cross-check the
//    barcode block against the source app's product label output.
step("buildCode128Zpl output matches labels/product.js centering/emission", () => {
  const productModulePath = path.join(__dirname, "..", "labels", "product.js");
  const productModule = require(productModulePath);

  const row = {
    "Product Name": "Demo Widget",
    "Part Number": "PN-1",
    "Barcode 128": storedBarcode,
    "Company Name": "Acme",
    Quantity: 1,
  };

  const originalZpl = productModule.buildLabel(row);

  const x = centerBarcodeX(storedBarcode, {
    moduleWidth: 2,
    desiredCenterX: 609 / 2,
    xOffset: 0,
    minX: 20,
  });

  const expectedBlock = buildCode128Zpl({
    x,
    y: 82,
    value: storedBarcode,
    moduleWidth: 2,
    height: 58,
  });

  assert.ok(
    originalZpl.includes(expectedBlock),
    "expected barcode-core's ZPL block to appear verbatim in labels/product.js output"
  );
});

// 5. Example label ZPL for all three strategies, printed for inspection.
step("emit one example label per label type", () => {
  const locationValue = computeLocationBarcode({ aisle: "B", bay: "2", level: "1", bin: "5" });
  console.log("  location barcode value:", locationValue);
  console.log(
    "  location ZPL block:\n" +
      buildCode128Zpl({ x: 150, y: 18, value: locationValue, moduleWidth: 2, height: 48 })
        .split("\n")
        .map((line) => "    " + line)
        .join("\n")
  );

  console.log("  equipment/product barcode value:", storedBarcode);
  console.log("  human-readable line:", formatHumanReadableText(storedBarcode));

  console.log("  generated product barcode value:", generatedBarcode);
});

// 6. Selection flow: normalize a request, index fake rows, resolve matches.
step("selection flow resolves requested barcodes to rows", () => {
  const rows = [
    { "Barcode 128": "111111111111", "Product Name": "Widget A" },
    { "Barcode 128": "222222222222", "Product Name": "Widget B" },
    { "Barcode 128": "333333333333", "Product Name": "Widget C" },
  ];

  const readBarcode = createStoredBarcodeReader("Barcode 128");
  const rowIndex = buildBarcodeRowIndex(rows, readBarcode);

  const requests = normalizeSelectedBarcodeRequests(
    [
      { barcode: "111111111111", quantity: 2 },
      { barcode: "333333333333", quantity: 1 },
    ],
    { maxTotalLabels: 10, subjectNoun: "selected product" }
  );

  const { resolved, totalLabels } = resolveSelectedRows(requests, rowIndex);

  assert.strictEqual(totalLabels, 3);
  assert.strictEqual(resolved.length, 2);
  assert.strictEqual(resolved[0].row["Product Name"], "Widget A");
  assert.strictEqual(resolved[1].row["Product Name"], "Widget C");

  console.log(
    "  resolved:",
    resolved.map((entry) => `${entry.row["Product Name"]} x${entry.quantity}`).join(", ")
  );
});

step("sanitizeZplText strips ZPL control characters", () => {
  assert.strictEqual(sanitizeZplText("  A^B~C  "), "ABC");
});

console.log(`\nAll ${stepNumber} checks passed.`);
