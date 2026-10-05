/**
 * Code128 ZPL emission for Zebra printers.
 * No dependencies, no file I/O — pure string/number functions.
 */

function sanitizeZplText(value) {
  return String(value ?? "")
    .replace(/\^/g, "")
    .replace(/~/g, "")
    .trim();
}

/**
 * Estimates the rendered width (in dots) of a Code128 barcode so it can be
 * centered without asking the printer/renderer to measure it first.
 * Formula matches Zebra's Code128-B module layout: start + one module per
 * character + stop + checksum overhead.
 */
function estimateCode128WidthDots(value, moduleWidth) {
  const length = String(value ?? "").length;
  const estimatedModules = 11 + length * 11 + 11 + 13;
  return estimatedModules * moduleWidth;
}

/**
 * Computes the ^FO x-coordinate that centers a barcode of `value` on
 * `desiredCenterX`, clamped to `minX` so it never prints off the label edge.
 */
function centerBarcodeX(value, options = {}) {
  const {
    moduleWidth = 2,
    desiredCenterX,
    xOffset = 0,
    minX = 10,
  } = options;

  const estimatedWidthDots = estimateCode128WidthDots(value, moduleWidth);
  const calculatedX = Math.round(desiredCenterX - estimatedWidthDots / 2 + xOffset);

  return Math.max(minX, calculatedX);
}

/**
 * Builds the ^BY / ^BCN / ^FD...^FS block for a Code128 barcode.
 * `showInterpretationLine` is an explicit choice (default false): the app
 * this was extracted from prints its own hand-spaced human-readable text
 * separately (see formatHumanReadableText) rather than relying on ZPL's
 * built-in interpretation line, but either is valid — pick one on purpose.
 */
function buildCode128Zpl(options = {}) {
  const {
    x,
    y,
    value,
    moduleWidth = 2,
    height,
    showInterpretationLine = false,
  } = options;

  if (x === undefined || y === undefined) {
    throw new Error("buildCode128Zpl requires x and y.");
  }

  if (!height) {
    throw new Error("buildCode128Zpl requires height.");
  }

  const interpretationFlag = showInterpretationLine ? "Y,N" : "N,N";
  const sanitizedValue = sanitizeZplText(value);

  return (
    `^FO${x},${y}\n` +
    `^BY${moduleWidth},2.5,${height}\n` +
    `^BCN,${height},${interpretationFlag},N\n` +
    `^FD${sanitizedValue}^FS`
  );
}

/**
 * Inserts a space between every character, e.g. "ABC123" -> "A B C 1 2 3".
 * Optional add-on for a manually laid-out human-readable line under a
 * barcode that has showInterpretationLine: false.
 */
function formatHumanReadableText(value) {
  return String(value ?? "").split("").join(" ");
}

module.exports = {
  sanitizeZplText,
  estimateCode128WidthDots,
  centerBarcodeX,
  buildCode128Zpl,
  formatHumanReadableText,
};
