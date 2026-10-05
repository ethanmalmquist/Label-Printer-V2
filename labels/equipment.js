const path = require("path");
const XLSX = require("xlsx");

/**
 * Zebra ZD421 Equipment Label Printer
 * Label size: 3 x 1 inch
 * Printer DPI: 203
 * Connection: Ethernet using port 9100
 *
 * Excel columns required:
 * - Unit Number
 * - Unit type
 * - Barcode 128
 * - Company Name
 * - Quantity
 */

const EXCEL_FILE = path.join(__dirname, "..", "data", "equipment-labels.xlsx");
const SHEET_NAME = "Sheet1";

// true = only print first valid completed row
// false = print every valid completed row
const PRINT_FIRST_VALID_ROW_ONLY = false;

const LABEL_WIDTH_DOTS = 609;
const LABEL_HEIGHT_DOTS = 203;

const BARCODE_Y = 72;
const BARCODE_MODULE_WIDTH = 2;
const BARCODE_HEIGHT = 54;

/**
 * Adjust only this value after printing.
 * Negative = move barcode bars left
 * Positive = move barcode bars right
 */
const BARCODE_X_OFFSET = 0;

const REQUIRED_COLUMNS = [
  "Unit Number",
  "Unit type",
  "Barcode 128",
  "Company Name",
  "Quantity",
];
const PILOT_MAX_SELECTED_LABELS = 10;

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

function parseQuantity(value) {
  const quantity = Number(String(value ?? "").trim());

  if (!Number.isInteger(quantity) || quantity < 1) {
    return 0;
  }

  return quantity;
}

function normalizeEquipmentBarcode(value) {
  return sanitizeZplText(value);
}

function buildEquipmentBarcode(row) {
  return normalizeEquipmentBarcode(row["Barcode 128"]);
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

function formatBarcodeText(value) {
  return String(value).split("").join(" ");
}

function calculateCenteredBarcodeX(barcodeValue) {
  const value = String(barcodeValue);

  const estimatedModules = 11 + value.length * 11 + 11 + 13;
  const estimatedWidthDots = estimatedModules * BARCODE_MODULE_WIDTH;

  const calculatedX = Math.round((LABEL_WIDTH_DOTS - estimatedWidthDots) / 2);
  const adjustedX = calculatedX + BARCODE_X_OFFSET;

  return Math.max(20, adjustedX);
}

function buildLabel(row) {
  const unitNumber = sanitizeZplText(row["Unit Number"]);
  const unitType = sanitizeZplText(row["Unit type"]);
  const barcodeValue = sanitizeZplText(row["Barcode 128"]);
  const companyName = sanitizeZplText(row["Company Name"]);

  const barcodeX = calculateCenteredBarcodeX(barcodeValue);

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

^FX Top left unit number
^FO23,22
^A0N,42,42
^FD${unitNumber}^FS

^FX Top right unit type
^FO458,22
^A0N,38,38
^FD${unitType}^FS

^FX Code 128 barcode bars centered
^FO${barcodeX},${BARCODE_Y}
^BY${BARCODE_MODULE_WIDTH},2.5,${BARCODE_HEIGHT}
^BCN,${BARCODE_HEIGHT},N,N,N
^FD${barcodeValue}^FS

^FX Human-readable barcode value centered
^FO0,132
^FB609,1,0,C,0
^A0N,38,38
^FD${formatBarcodeText(barcodeValue)}^FS

^FX Company name bottom left
^FO19,171
^A0N,31,31
^FD${companyName}^FS

^FX Logo placeholder bottom right
^FO500,162
^A0N,52,52
^FDeeeX^FS

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
      `Quantity for ${barcode || "selected equipment"} must be a positive integer.`
    );
  }

  return quantity;
}

function normalizeSelectedLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw createClientInputError("labels must be a non-empty array.");
  }

  const seenBarcodes = new Set();
  const selectedLabels = labels.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createClientInputError(`labels[${index}] must be an object.`);
    }

    const barcode = normalizeEquipmentBarcode(item.barcode);

    if (!barcode) {
      throw createClientInputError(`labels[${index}].barcode must be provided.`);
    }

    if (seenBarcodes.has(barcode)) {
      throw createClientInputError(
        `Duplicate requested barcode ${barcode}. Use one entry with the desired quantity.`
      );
    }

    seenBarcodes.add(barcode);

    return {
      barcode,
      quantity: parseSelectedQuantity(item.quantity, barcode),
    };
  });

  const totalLabels = selectedLabels.reduce((sum, item) => {
    return sum + item.quantity;
  }, 0);

  if (totalLabels > PILOT_MAX_SELECTED_LABELS) {
    throw createClientInputError(
      `Selected equipment print exceeds the pilot maximum of ${PILOT_MAX_SELECTED_LABELS} labels.`
    );
  }

  return selectedLabels;
}

function buildValidRowMap(validRows) {
  const map = new Map();

  validRows.forEach((row) => {
    const barcode = buildEquipmentBarcode(row);

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
          `Requested equipment barcode not found: ${selectedLabel.barcode}.`
        );
      }

      if (matchingRows.length > 1) {
        throw createClientInputError(
          `Requested equipment barcode ${selectedLabel.barcode} matches ${matchingRows.length} valid Excel rows. Remove duplicates before selected printing.`
        );
      }

      const row = matchingRows[0];
      totalLabels += selectedLabel.quantity;

      rowDetails.push({
        excelRowNumber: row.__excelRowNumber,
        barcode: selectedLabel.barcode,
        unitNumber: sanitizeZplText(row["Unit Number"]),
        unitType: sanitizeZplText(row["Unit type"]),
        quantityUsed: selectedLabel.quantity,
      });

      return Array.from({ length: selectedLabel.quantity }, () =>
        buildLabel(row)
      );
    })
    .join("");

  return {
    type: "equipment",
    mode,
    zpl,
    summary: {
      type: "equipment",
      mode,
      excelFile,
      sheetName,
      validRows: validRows.length,
      skippedRows: skippedRows.length,
      printedRows: rowDetails.length,
      totalLabels,
      pilotMaxLabels: PILOT_MAX_SELECTED_LABELS,
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
  const forceQuantityOne = options.forceQuantityOne ?? ["test", "preview"].includes(mode);

  const rows = readExcelRows(excelFile, sheetName);
  const { validRows, skippedRows } = collectRows(rows);

  if (validRows.length === 0) {
    return {
      type: "equipment",
      mode,
      zpl: "",
      summary: {
        type: "equipment",
        mode,
        excelFile,
        sheetName,
        validRows: 0,
        skippedRows: skippedRows.length,
        printedRows: 0,
        totalLabels: 0,
        skippedDetails: skippedRows,
        rowDetails: [],
        message: "No valid completed equipment rows found.",
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
      totalLabels += quantity;

      rowDetails.push({
        excelRowNumber: row.__excelRowNumber,
        excelQuantity,
        quantityUsed: quantity,
      });

      return Array.from({ length: quantity }, () => buildLabel(row));
    })
    .join("");

  return {
    type: "equipment",
    mode,
    zpl,
    summary: {
      type: "equipment",
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
  type: "equipment",
  requiredColumns: REQUIRED_COLUMNS,
  readExcelRows,
  sanitizeZplText,
  parseQuantity,
  normalizeEquipmentBarcode,
  buildEquipmentBarcode,
  pilotMaxSelectedLabels: PILOT_MAX_SELECTED_LABELS,
  hasRequiredData,
  getMissingColumns,
  buildLabel,
  buildSelectedPrintJob,
  buildPrintJob,
};
