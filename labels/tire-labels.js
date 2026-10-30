const path = require("path");
const XLSX = require("xlsx");

/**
 * Zebra ZD421 Tire Rack Label Printer
 * Purpose:
 * - Large, easy-to-read tire size for rack / shelf identification
 * - Tire model underneath, color shown as a high-contrast tag
 * - Optional Code 128 barcode in the bottom row
 *
 * Label size: 3 x 1 inch
 * Printer DPI: 203
 * Connection: Ethernet using port 9100
 *
 * Excel columns required:
 * - Tire Size      e.g. 18 X 6 X 12 1/8 SM
 * - Tire Model     e.g. GLOBE STAR
 * - Quantity
 *
 * Excel columns optional:
 * - Color          e.g. Black / White (blank = no color tag)
 * - Barcode 128    printed small in the bottom row when present
 *
 * Layout (dots, 609 x 203):
 *
 *   +-----------------------------------------------------------+
 *   |              18 X 6 X 12 1/8 SM          (auto-fit, big)  |  y 8   - 96
 *   |-----------------------------------------------------------|  y 101 divider
 *   |                   GLOBE STAR             (auto-fit)       |  y 112 - 158
 *   | [ BLACK ]      |||||||||||||||||||               eeeX     |  y 163 - 199
 *   +-----------------------------------------------------------+
 */

const EXCEL_FILE = path.join(__dirname, "..", "data", "tire-labels.xlsx");
const SHEET_NAME = "Sheet1";

// true = only print first valid completed row
// false = print every valid completed row
const PRINT_FIRST_VALID_ROW_ONLY = false;

/**
 * true  = show zone boxes for alignment test prints
 * false = production print
 */
const PRINT_ALIGNMENT_GUIDES = false;

const LABEL_WIDTH_DOTS = 609;
const LABEL_HEIGHT_DOTS = 203;

/**
 * Horizontal margins
 */
const MARGIN_X = 10;
const CONTENT_WIDTH = LABEL_WIDTH_DOTS - MARGIN_X * 2;

/**
 * Tire size line (the most important field)
 * Font auto-fits: keeps full height and condenses width first,
 * then shrinks height only if the text is still too long.
 */
const SIZE_Y = 8;
const SIZE_FONT_MAX_H = 88;
const SIZE_FONT_MIN_H = 48;

/**
 * Divider line between size and model
 */
const DIVIDER_Y = 101;
const DIVIDER_THICKNESS = 3;

/**
 * Tire model line
 */
const MODEL_Y = 112;
const MODEL_FONT_MAX_H = 46;
const MODEL_FONT_MIN_H = 30;

/**
 * Font fitting
 *
 * Font 0 width is estimated per character (see CHAR_WIDTH_RATIOS).
 * MIN_WIDTH_RATIO = narrowest width allowed as a fraction of height
 *   before height is reduced (0.70 = up to 30% condensed).
 * FONT_FIT_SAFETY = adjust only this after printing.
 *   Lower (e.g. 0.92) if long sizes clip at the edges.
 *   Raise (e.g. 1.05) if long sizes leave lots of unused width.
 */
const MIN_WIDTH_RATIO = 0.7;
const FONT_FIT_SAFETY = 0.97;

/**
 * Bottom row
 */
const BOTTOM_ROW_Y = 163;
const BOTTOM_ROW_H = 36;

/**
 * Color tag (bottom left)
 * Black = solid black box with white text
 * Other colors = outlined box with black text
 */
const COLOR_TAG_X = MARGIN_X;
const COLOR_TAG_W = 140;
const COLOR_TAG_BORDER = 3;
const COLOR_TAG_FONT_H = 28;
const COLOR_TAG_FONT_W = 28;
const COLOR_TAG_TEXT_Y_OFFSET = 5;
const FILLED_TAG_COLORS = ["BLACK"];

/**
 * Optional barcode (bottom middle)
 * Centered between the color tag and the logo.
 */
const BARCODE_ZONE_LEFT = COLOR_TAG_X + COLOR_TAG_W + 12;
const BARCODE_ZONE_RIGHT = 488;
const BARCODE_Y = BOTTOM_ROW_Y + 2;
const BARCODE_HEIGHT = 32;
const BARCODE_MODULE_WIDTH = 2;

// Negative = move barcode left
// Positive = move barcode right
const BARCODE_X_OFFSET = 0;

/**
 * eeeX logo placeholder (bottom right)
 */
const SHOW_LOGO = true;
const LOGO_ZONE_X = 440;
const LOGO_ZONE_W = LABEL_WIDTH_DOTS - LOGO_ZONE_X - MARGIN_X;
const LOGO_Y = BOTTOM_ROW_Y + 1;
const LOGO_FONT_H = 36;
const LOGO_FONT_W = 36;

const GUIDE_LINE_THICKNESS = 2;

const REQUIRED_COLUMNS = ["Tire Size", "Tire Model", "Quantity"];
const OPTIONAL_COLUMNS = ["Color", "Barcode 128"];

/**
 * Approximate Font 0 character advance as a fraction of font width.
 * Used only for auto-fit; tune FONT_FIT_SAFETY rather than these.
 */
const CHAR_WIDTH_RATIOS = {
  " ": 0.28,
  ".": 0.27,
  ",": 0.27,
  "/": 0.32,
  "-": 0.36,
  "(": 0.3,
  ")": 0.3,
  I: 0.28,
  J: 0.45,
  M: 0.78,
  W: 0.85,
  X: 0.58,
};
const DIGIT_WIDTH_RATIO = 0.52;
const UPPER_WIDTH_RATIO = 0.6;
const LOWER_WIDTH_RATIO = 0.5;
const DEFAULT_WIDTH_RATIO = 0.6;

function createClientInputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function readExcelRows(excelFile = EXCEL_FILE, sheetName = SHEET_NAME) {
  const workbook = XLSX.readFile(excelFile);
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
  });

  return rawRows.map((row, index) => {
    const cleanedRow = {
      __excelRowNumber: index + 2,
    };

    for (const key of Object.keys(row)) {
      cleanedRow[key.trim()] = row[key];
    }

    return cleanedRow;
  });
}

function sanitizeZplText(value) {
  return String(value ?? "")
    .replace(/\^/g, "")
    .replace(/~/g, "")
    .trim();
}

/**
 * Tire text cleanup:
 * - en dash / em dash / minus sign -> plain hyphen (Font 0 safe)
 * - collapse repeated spaces
 * - uppercase
 */
function normalizeTireText(value) {
  return sanitizeZplText(value)
    .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseQuantity(value) {
  const quantity = Number(String(value ?? "").trim());

  if (!Number.isInteger(quantity) || quantity < 1) {
    return 0;
  }

  return quantity;
}

/**
 * Key used for selected printing.
 * Uses Barcode 128 when present, otherwise SIZE|MODEL|COLOR.
 */
function normalizeTireKey(value) {
  return normalizeTireText(value);
}

function buildTireKey(row) {
  const barcode = sanitizeZplText(row["Barcode 128"]);

  if (barcode) {
    return normalizeTireKey(barcode);
  }

  const size = normalizeTireText(row["Tire Size"]);
  const model = normalizeTireText(row["Tire Model"]);
  const color = normalizeTireText(row["Color"]);

  if (!size || !model) {
    return "";
  }

  return normalizeTireKey(`${size}|${model}|${color}`);
}

function hasRequiredData(row) {
  return REQUIRED_COLUMNS.every((columnName) => {
    if (columnName === "Quantity") {
      return parseQuantity(row[columnName]) > 0;
    }

    return sanitizeZplText(row[columnName]) !== "";
  });
}

function getMissingColumns(row) {
  return REQUIRED_COLUMNS.filter((columnName) => {
    if (columnName === "Quantity") {
      return parseQuantity(row[columnName]) < 1;
    }

    return sanitizeZplText(row[columnName]) === "";
  });
}

function charWidthRatio(char) {
  if (CHAR_WIDTH_RATIOS[char] !== undefined) {
    return CHAR_WIDTH_RATIOS[char];
  }

  if (/[0-9]/.test(char)) {
    return DIGIT_WIDTH_RATIO;
  }

  if (/[A-Z]/.test(char)) {
    return UPPER_WIDTH_RATIO;
  }

  if (/[a-z]/.test(char)) {
    return LOWER_WIDTH_RATIO;
  }

  return DEFAULT_WIDTH_RATIO;
}

function estimateTextWidthUnits(text) {
  return String(text)
    .split("")
    .reduce((total, char) => total + charWidthRatio(char), 0);
}

/**
 * Returns the largest Font 0 size that fits text on one line.
 * Priority: keep max height -> condense width -> reduce height.
 */
function fitFont(text, maxWidthDots, maxH, minH) {
  const units = estimateTextWidthUnits(text);

  if (units === 0) {
    return { h: maxH, w: maxH, overflow: false };
  }

  const widthThatFits = Math.floor((maxWidthDots / units) * FONT_FIT_SAFETY);

  if (widthThatFits >= maxH) {
    return { h: maxH, w: maxH, overflow: false };
  }

  if (widthThatFits >= Math.round(maxH * MIN_WIDTH_RATIO)) {
    return { h: maxH, w: widthThatFits, overflow: false };
  }

  const h = Math.max(minH, Math.floor(widthThatFits / MIN_WIDTH_RATIO));
  const overflow = widthThatFits < Math.round(minH * MIN_WIDTH_RATIO);

  return { h, w: Math.max(10, widthThatFits), overflow };
}

function estimateBarcodeWidthDots(barcodeValue, moduleWidth) {
  const value = String(barcodeValue);
  const estimatedModules = 11 + value.length * 11 + 11 + 13;
  return estimatedModules * moduleWidth;
}

/**
 * Picks module width 2, falls back to 1 if the barcode
 * would not fit between the color tag and the logo.
 */
function calculateBarcodeLayout(barcodeValue) {
  const zoneWidth = BARCODE_ZONE_RIGHT - BARCODE_ZONE_LEFT;
  let moduleWidth = BARCODE_MODULE_WIDTH;
  let widthDots = estimateBarcodeWidthDots(barcodeValue, moduleWidth);

  if (widthDots > zoneWidth && moduleWidth > 1) {
    moduleWidth = 1;
    widthDots = estimateBarcodeWidthDots(barcodeValue, moduleWidth);
  }

  const centerX = BARCODE_ZONE_LEFT + zoneWidth / 2;
  const x = Math.round(centerX - widthDots / 2 + BARCODE_X_OFFSET);

  return {
    x: Math.max(BARCODE_ZONE_LEFT, x),
    moduleWidth,
    widthDots,
    fits: widthDots <= zoneWidth,
  };
}

function buildColorTag(color) {
  if (!color) {
    return "";
  }

  const isFilled = FILLED_TAG_COLORS.includes(color);
  const boxThickness = isFilled ? BOTTOM_ROW_H : COLOR_TAG_BORDER;
  const reverse = isFilled ? "^FR" : "";

  return `
^FX Color tag box
^FO${COLOR_TAG_X},${BOTTOM_ROW_Y}
^GB${COLOR_TAG_W},${BOTTOM_ROW_H},${boxThickness}^FS

^FX Color tag text
^FO${COLOR_TAG_X},${BOTTOM_ROW_Y + COLOR_TAG_TEXT_Y_OFFSET}
^FB${COLOR_TAG_W},1,0,C,0
^A0N,${COLOR_TAG_FONT_H},${COLOR_TAG_FONT_W}
${reverse}^FD${color}^FS
`;
}

function buildBarcode(barcodeValue) {
  if (!barcodeValue) {
    return "";
  }

  const layout = calculateBarcodeLayout(barcodeValue);

  return `
^FX Optional Code 128 barcode - no readable text below
^FO${layout.x},${BARCODE_Y}
^BY${layout.moduleWidth},2.5,${BARCODE_HEIGHT}
^BCN,${BARCODE_HEIGHT},N,N,N
^FD${barcodeValue}^FS
`;
}

function buildLogo() {
  if (!SHOW_LOGO) {
    return "";
  }

  return `
^FX eeeX logo placeholder bottom right
^FO${LOGO_ZONE_X},${LOGO_Y}
^FB${LOGO_ZONE_W},1,0,R,0
^A0N,${LOGO_FONT_H},${LOGO_FONT_W}
^FDeeeX^FS
`;
}

function buildAlignmentGuides(sizeFont, modelFont) {
  if (!PRINT_ALIGNMENT_GUIDES) {
    return "";
  }

  return `
^FX Guide: tire size zone
^FO${MARGIN_X},${SIZE_Y}
^GB${CONTENT_WIDTH},${sizeFont.h},${GUIDE_LINE_THICKNESS}^FS

^FX Guide: model zone
^FO${MARGIN_X},${MODEL_Y}
^GB${CONTENT_WIDTH},${modelFont.h},${GUIDE_LINE_THICKNESS}^FS

^FX Guide: barcode zone
^FO${BARCODE_ZONE_LEFT},${BOTTOM_ROW_Y}
^GB${BARCODE_ZONE_RIGHT - BARCODE_ZONE_LEFT},${BOTTOM_ROW_H},${GUIDE_LINE_THICKNESS}^FS

^FX Guide: logo zone
^FO${LOGO_ZONE_X},${BOTTOM_ROW_Y}
^GB${LOGO_ZONE_W},${BOTTOM_ROW_H},${GUIDE_LINE_THICKNESS}^FS

^FX Guide: label center line
^FO${Math.round(LABEL_WIDTH_DOTS / 2)},0
^GB${GUIDE_LINE_THICKNESS},${LABEL_HEIGHT_DOTS},${GUIDE_LINE_THICKNESS}^FS
`;
}

/**
 * Font sizes and warnings for one row, without building ZPL.
 * Used by buildLabel and by the job summaries.
 */
function getLabelLayout(row) {
  const tireSize = normalizeTireText(row["Tire Size"]);
  const tireModel = normalizeTireText(row["Tire Model"]);
  const color = normalizeTireText(row["Color"]);
  const barcodeValue = sanitizeZplText(row["Barcode 128"]);

  const sizeFont = fitFont(
    tireSize,
    CONTENT_WIDTH,
    SIZE_FONT_MAX_H,
    SIZE_FONT_MIN_H
  );
  const modelFont = fitFont(
    tireModel,
    CONTENT_WIDTH,
    MODEL_FONT_MAX_H,
    MODEL_FONT_MIN_H
  );

  const warnings = [];

  if (sizeFont.overflow) {
    warnings.push(`Tire Size "${tireSize}" may be too long for one line.`);
  }

  if (modelFont.overflow) {
    warnings.push(`Tire Model "${tireModel}" may be too long for one line.`);
  }

  if (barcodeValue && !calculateBarcodeLayout(barcodeValue).fits) {
    warnings.push(`Barcode "${barcodeValue}" may be too wide for the bottom row.`);
  }

  return {
    tireSize,
    tireModel,
    color,
    barcodeValue,
    sizeFont,
    modelFont,
    warnings,
  };
}

function buildLabel(row) {
  const layout = getLabelLayout(row);
  const { tireSize, tireModel, color, barcodeValue, sizeFont, modelFont } =
    layout;

  // Center the size text vertically inside its max-height zone
  // when it had to shrink.
  const sizeY = SIZE_Y + Math.round((SIZE_FONT_MAX_H - sizeFont.h) / 2);
  const modelY = MODEL_Y + Math.round((MODEL_FONT_MAX_H - modelFont.h) / 2);

  return `
^XA
^CI28
^PW${LABEL_WIDTH_DOTS}
^LL${LABEL_HEIGHT_DOTS}
^LH0,0
^PON
^MTD
^MNY
^PR2
^MD10

${buildAlignmentGuides(sizeFont, modelFont)}

^FX Tire size - large, centered, auto-fit
^FO${MARGIN_X},${sizeY}
^FB${CONTENT_WIDTH},1,0,C,0
^A0N,${sizeFont.h},${sizeFont.w}
^FD${tireSize}^FS

^FX Divider line
^FO${MARGIN_X},${DIVIDER_Y}
^GB${CONTENT_WIDTH},${DIVIDER_THICKNESS},${DIVIDER_THICKNESS}^FS

^FX Tire model - centered, auto-fit
^FO${MARGIN_X},${modelY}
^FB${CONTENT_WIDTH},1,0,C,0
^A0N,${modelFont.h},${modelFont.w}
^FD${tireModel}^FS
${buildColorTag(color)}
${buildBarcode(barcodeValue)}
${buildLogo()}
^XZ
`;
}

function collectRows(rows) {
  const validRows = [];
  const skippedRows = [];

  for (const row of rows) {
    if (hasRequiredData(row)) {
      validRows.push(row);
    } else {
      skippedRows.push({
        excelRowNumber: row.__excelRowNumber,
        missingColumns: getMissingColumns(row),
      });
    }
  }

  return { validRows, skippedRows };
}

function getRowsForMode(validRows, mode) {
  if (["test", "preview", "first"].includes(mode)) {
    return validRows.slice(0, 1);
  }

  if (mode === "all") {
    return validRows;
  }

  throw new Error(`Unknown mode: ${mode}. Use preview, test, first, or all.`);
}

function parseSelectedQuantity(value, barcode) {
  const quantity = Number(String(value ?? "").trim());

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw createClientInputError(
      `Quantity for ${barcode || "selected tire"} must be a positive integer.`
    );
  }

  return quantity;
}

/**
 * Selected labels use the same request shape as the other label types:
 * [{ barcode: "<tire key>", quantity: 2 }]
 * where the tire key is Barcode 128, or SIZE|MODEL|COLOR when no barcode.
 */
function normalizeSelectedLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw createClientInputError("labels must be a non-empty array.");
  }

  const seenBarcodes = new Set();
  const selectedLabels = labels.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createClientInputError(`labels[${index}] must be an object.`);
    }

    const barcode = normalizeTireKey(item.barcode);

    if (!barcode) {
      throw createClientInputError(`labels[${index}].barcode must be provided.`);
    }

    if (seenBarcodes.has(barcode)) {
      throw createClientInputError(
        `Duplicate requested tire ${barcode}. Use one entry with the desired quantity.`
      );
    }

    seenBarcodes.add(barcode);

    return {
      barcode,
      quantity: parseSelectedQuantity(item.quantity, barcode),
    };
  });

  return selectedLabels;
}

function buildValidRowMap(validRows) {
  const map = new Map();

  validRows.forEach((row) => {
    const key = buildTireKey(row);

    if (!key) {
      return;
    }

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(row);
  });

  return map;
}

function buildSelectedPrintJob(options = {}) {
  const mode = "selected";
  const excelFile = options.excelFile || EXCEL_FILE;
  const sheetName = options.sheetName || SHEET_NAME;
  const selectedLabels = normalizeSelectedLabels(options.labels);

  const rows = readExcelRows(excelFile, sheetName);
  const { validRows, skippedRows } = collectRows(rows);
  const validRowMap = buildValidRowMap(validRows);
  const rowDetails = [];
  let totalLabels = 0;

  const zpl = selectedLabels
    .flatMap((selectedLabel) => {
      const matchingRows = validRowMap.get(selectedLabel.barcode) || [];

      if (matchingRows.length === 0) {
        throw createClientInputError(
          `Requested tire not found: ${selectedLabel.barcode}.`
        );
      }

      if (matchingRows.length > 1) {
        throw createClientInputError(
          `Requested tire ${selectedLabel.barcode} matches ${matchingRows.length} valid Excel rows. Remove duplicates before selected printing.`
        );
      }

      const row = matchingRows[0];
      const layout = getLabelLayout(row);
      totalLabels += selectedLabel.quantity;

      rowDetails.push({
        excelRowNumber: row.__excelRowNumber,
        barcode: selectedLabel.barcode,
        tireSize: layout.tireSize,
        tireModel: layout.tireModel,
        color: layout.color,
        quantityUsed: selectedLabel.quantity,
        sizeFont: layout.sizeFont,
        warnings: layout.warnings,
      });

      return Array.from({ length: selectedLabel.quantity }, () =>
        buildLabel(row)
      );
    })
    .join("");

  return {
    type: "tire",
    mode,
    zpl,
    summary: {
      type: "tire",
      mode,
      excelFile,
      sheetName,
      validRows: validRows.length,
      skippedRows: skippedRows.length,
      printedRows: rowDetails.length,
      totalLabels,
      selectedLabelCount: rowDetails.length,
      skippedDetails: skippedRows,
      rowDetails,
    },
  };
}

function buildPrintJob(options = {}) {
  const mode = options.mode || "test";

  if (mode === "selected") {
    return buildSelectedPrintJob(options);
  }

  const excelFile = options.excelFile || EXCEL_FILE;
  const sheetName = options.sheetName || SHEET_NAME;
  const forceQuantityOne =
    options.forceQuantityOne ?? ["test", "preview"].includes(mode);

  const rows = readExcelRows(excelFile, sheetName);
  const { validRows, skippedRows } = collectRows(rows);

  if (validRows.length === 0) {
    return {
      type: "tire",
      mode,
      zpl: "",
      summary: {
        type: "tire",
        mode,
        excelFile,
        sheetName,
        validRows: 0,
        skippedRows: skippedRows.length,
        printedRows: 0,
        totalLabels: 0,
        skippedDetails: skippedRows,
        rowDetails: [],
        message: "No valid completed tire rows found.",
      },
    };
  }

  const rowsToPrint = getRowsForMode(validRows, mode);
  const rowDetails = [];
  let totalLabels = 0;

  const zpl = rowsToPrint
    .flatMap((row) => {
      const excelQuantity = parseQuantity(row["Quantity"]);
      const quantity = forceQuantityOne ? 1 : excelQuantity;
      const layout = getLabelLayout(row);
      totalLabels += quantity;

      rowDetails.push({
        excelRowNumber: row.__excelRowNumber,
        excelQuantity,
        quantityUsed: quantity,
        tireKey: buildTireKey(row),
        sizeFont: layout.sizeFont,
        warnings: layout.warnings,
      });

      return Array.from({ length: quantity }, () => buildLabel(row));
    })
    .join("");

  return {
    type: "tire",
    mode,
    zpl,
    summary: {
      type: "tire",
      mode,
      excelFile,
      sheetName,
      validRows: validRows.length,
      skippedRows: skippedRows.length,
      printedRows: rowsToPrint.length,
      totalLabels,
      forceQuantityOne,
      skippedDetails: skippedRows,
      rowDetails,
    },
  };
}

module.exports = {
  type: "tire",
  requiredColumns: REQUIRED_COLUMNS,
  optionalColumns: OPTIONAL_COLUMNS,
  readExcelRows,
  sanitizeZplText,
  normalizeTireText,
  parseQuantity,
  normalizeTireKey,
  buildTireKey,
  hasRequiredData,
  getMissingColumns,
  fitFont,
  getLabelLayout,
  buildLabel,
  buildSelectedPrintJob,
  buildPrintJob,
};
