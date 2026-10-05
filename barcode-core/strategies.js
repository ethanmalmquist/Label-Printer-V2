/**
 * Barcode value strategies.
 *
 * Not every label type gets its barcode value the same way — that
 * difference is easy to miss unless it's made explicit:
 *   - "stored":  the barcode is just a column on the row, populated
 *                elsewhere (it might mirror another field, or hold a
 *                previously-generated value — the reader doesn't care).
 *   - "computed": the barcode is derived from other fields on the row
 *                 every time (e.g. a location code from Aisle/Bay/Level/Bin).
 *   - "random":   the barcode is a freshly generated value, unique against
 *                 whatever's already in use.
 * Pick the strategy per label type rather than writing a new near-identical
 * function for each one.
 */

const { sanitizeZplText } = require("./zpl");

/**
 * "stored" strategy: read an already-populated column off the row.
 */
function createStoredBarcodeReader(columnName) {
  if (!columnName) {
    throw new Error("createStoredBarcodeReader requires a columnName.");
  }

  return function readStoredBarcode(row) {
    return sanitizeZplText(row ? row[columnName] : "");
  };
}

function padTwoDigits(value) {
  const trimmedValue = String(value ?? "").trim();

  if (trimmedValue === "") {
    return "";
  }

  const numberValue = Number(trimmedValue);

  if (!Number.isFinite(numberValue)) {
    return sanitizeZplText(trimmedValue).toUpperCase();
  }

  return String(numberValue).padStart(2, "0");
}

/**
 * "computed" strategy for location-style barcodes: Aisle + Bay + Level + Bin,
 * uppercased, each numeric segment zero-padded to 2 digits. Returns ""
 * if any segment is missing.
 *
 * This is the single source of truth for the formula — call it from every
 * place that needs to compute or preview a location barcode instead of
 * re-implementing the concatenation.
 */
function computeLocationBarcode({ aisle, bay, level, bin } = {}) {
  const aisleValue = sanitizeZplText(aisle).toUpperCase();
  const bayValue = sanitizeZplText(bay);
  const levelValue = sanitizeZplText(level);
  const binValue = sanitizeZplText(bin);

  if (!aisleValue || !bayValue || !levelValue || !binValue) {
    return "";
  }

  return `${aisleValue}${padTwoDigits(bayValue)}${padTwoDigits(levelValue)}${padTwoDigits(binValue)}`;
}

function generateRandomNumericValue(length) {
  let value = "";

  for (let i = 0; i < length; i++) {
    value += String(Math.floor(Math.random() * 10));
  }

  return value;
}

/**
 * "random" strategy: generate a fresh numeric barcode of a fixed length,
 * retrying until `isReserved` says it's not already in use.
 *
 * `isReserved(value)` is caller-supplied so this stays storage-agnostic —
 * back it with a Set of existing values, a DB lookup, whatever.
 */
function createRandomNumericBarcodeGenerator(options = {}) {
  const { length = 12, isReserved = () => false, maxAttempts = 10000 } = options;

  return {
    generate() {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const value = generateRandomNumericValue(length);

        if (!isReserved(value)) {
          return value;
        }
      }

      throw new Error(
        `Unable to generate a unique ${length}-digit barcode after ${maxAttempts} attempts.`
      );
    },
  };
}

/**
 * Validator for fixed-length numeric barcodes (e.g. the 12-digit random
 * Product barcode). Returns a predicate, not a boolean, so it can be reused
 * across many values.
 */
function createFixedLengthNumericValidator(length) {
  const pattern = new RegExp(`^\\d{${length}}$`);
  return (value) => pattern.test(String(value ?? "").trim());
}

module.exports = {
  createStoredBarcodeReader,
  padTwoDigits,
  computeLocationBarcode,
  createRandomNumericBarcodeGenerator,
  createFixedLengthNumericValidator,
};
