/**
 * "Print specific rows by barcode" — request validation and row resolution.
 * Generalizes logic that used to be copy-pasted per label type (equipment,
 * location, product), parameterized by how a type normalizes/reads barcodes.
 */

function createClientInputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * Validates and normalizes a raw `[{barcode, quantity}, ...]` request:
 * rejects empty/malformed input, normalizes + dedupes barcodes, validates
 * quantities are positive integers, and enforces a total-label cap.
 *
 * @param {Array} labels - raw request payload
 * @param {Object} options
 * @param {(value: any) => string} options.normalizeBarcode - e.g. uppercase for location codes, passthrough for others
 * @param {number} [options.maxTotalLabels] - omit to allow any total
 * @param {string} [options.subjectNoun] - used in error messages, e.g. "selected location"
 */
function normalizeSelectedBarcodeRequests(labels, options = {}) {
  const {
    normalizeBarcode = (value) => String(value ?? "").trim(),
    maxTotalLabels,
    subjectNoun = "selected item",
  } = options;

  if (!Array.isArray(labels) || labels.length === 0) {
    throw createClientInputError("labels must be a non-empty array.");
  }

  const seenBarcodes = new Set();
  const selectedLabels = labels.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createClientInputError(`labels[${index}] must be an object.`);
    }

    const barcode = normalizeBarcode(item.barcode);

    if (!barcode) {
      throw createClientInputError(`labels[${index}].barcode must be provided.`);
    }

    if (seenBarcodes.has(barcode)) {
      throw createClientInputError(
        `Duplicate requested barcode ${barcode}. Use one entry with the desired quantity.`
      );
    }

    seenBarcodes.add(barcode);

    const quantity = Number(String(item.quantity ?? "").trim());

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw createClientInputError(
        `Quantity for ${barcode || subjectNoun} must be a positive integer.`
      );
    }

    return { barcode, quantity };
  });

  if (maxTotalLabels !== undefined) {
    const totalLabels = selectedLabels.reduce((sum, item) => sum + item.quantity, 0);

    if (totalLabels > maxTotalLabels) {
      throw createClientInputError(
        `Selected print exceeds the maximum of ${maxTotalLabels} labels.`
      );
    }
  }

  return selectedLabels;
}

/**
 * Indexes rows by barcode value, so lookups by requested barcode are O(1)
 * and rows sharing a duplicate barcode are grouped together (surfaced as an
 * "ambiguous" error later, not silently picked from).
 */
function buildBarcodeRowIndex(rows, getBarcode) {
  const map = new Map();

  rows.forEach((row) => {
    const barcode = getBarcode(row);

    if (!barcode) {
      return;
    }

    if (!map.has(barcode)) {
      map.set(barcode, []);
    }

    map.get(barcode).push(row);
  });

  return map;
}

/**
 * Resolves each normalized selected-barcode request to exactly one row,
 * throwing a client-input error if a barcode isn't found or matches more
 * than one row (ambiguous duplicate data).
 *
 * Returns { resolved: [{barcode, quantity, row}], totalLabels }.
 */
function resolveSelectedRows(selectedRequests, rowIndex) {
  let totalLabels = 0;

  const resolved = selectedRequests.map((request) => {
    const matchingRows = rowIndex.get(request.barcode) || [];

    if (matchingRows.length === 0) {
      throw createClientInputError(`Requested barcode not found: ${request.barcode}.`);
    }

    if (matchingRows.length > 1) {
      throw createClientInputError(
        `Requested barcode ${request.barcode} matches ${matchingRows.length} rows. Remove duplicates before selected printing.`
      );
    }

    totalLabels += request.quantity;

    return { barcode: request.barcode, quantity: request.quantity, row: matchingRows[0] };
  });

  return { resolved, totalLabels };
}

module.exports = {
  createClientInputError,
  normalizeSelectedBarcodeRequests,
  buildBarcodeRowIndex,
  resolveSelectedRows,
};
