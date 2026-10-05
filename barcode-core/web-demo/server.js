/**
 * Local test harness for barcode-core — a tiny Express server so the
 * library's functions can be exercised from a browser instead of only
 * the console (see ../demo.js for the non-web smoke test).
 *
 * Run:  node barcode-core/web-demo/server.js
 * Open: http://localhost:4300  (override with PORT=xxxx)
 *
 * This server (and its express/fetch usage) is test scaffolding, not part
 * of the barcode-core library — the library itself stays dependency-free.
 */

const path = require("path");
const express = require("express");

const {
  sanitizeZplText,
  centerBarcodeX,
  buildCode128Zpl,
  createStoredBarcodeReader,
  computeLocationBarcode,
  createRandomNumericBarcodeGenerator,
  createFixedLengthNumericValidator,
  normalizeSelectedBarcodeRequests,
  buildBarcodeRowIndex,
  resolveSelectedRows,
} = require("../index");

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 4300;
const DOTS_PER_INCH = 203;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory reserved set for the "generate a unique barcode" demo, so
// repeated clicks in the browser actually demonstrate collision-avoidance.
const reservedGeneratedBarcodes = new Set();
const productBarcodeGenerator = createRandomNumericBarcodeGenerator({
  length: 12,
  isReserved: (value) => reservedGeneratedBarcodes.has(value),
});
const isValidProductBarcode = createFixedLengthNumericValidator(12);

// Fixed sample rows for the "resolve selected barcodes" demo.
const SAMPLE_ROWS = [
  { barcode: "111111111111", label: "Widget A" },
  { barcode: "222222222222", label: "Widget B" },
  { barcode: "333333333333", label: "Widget C" },
];
const sampleRowIndex = buildBarcodeRowIndex(SAMPLE_ROWS, createStoredBarcodeReader("barcode"));

function handleClientError(res, error) {
  if (error && error.statusCode) {
    res.status(error.statusCode).json({ error: error.message });
    return true;
  }
  return false;
}

app.get("/api/sample-rows", (req, res) => {
  res.json({ rows: SAMPLE_ROWS });
});

app.post("/api/stored", (req, res) => {
  const value = sanitizeZplText(req.body.value);
  res.json({ value, isValidProductBarcode: isValidProductBarcode(value) });
});

app.post("/api/location", (req, res) => {
  const { aisle, bay, level, bin } = req.body || {};
  const value = computeLocationBarcode({ aisle, bay, level, bin });
  res.json({ value });
});

app.post("/api/random", (req, res) => {
  try {
    const value = productBarcodeGenerator.generate();
    reservedGeneratedBarcodes.add(value);
    res.json({ value, reservedCount: reservedGeneratedBarcodes.size });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/selection/resolve", (req, res) => {
  try {
    const requests = normalizeSelectedBarcodeRequests(req.body.labels, {
      maxTotalLabels: 10,
      subjectNoun: "selected item",
    });
    const { resolved, totalLabels } = resolveSelectedRows(requests, sampleRowIndex);

    res.json({
      totalLabels,
      resolved: resolved.map((entry) => ({
        barcode: entry.barcode,
        quantity: entry.quantity,
        label: entry.row.label,
      })),
    });
  } catch (error) {
    if (!handleClientError(res, error)) {
      res.status(500).json({ error: error.message });
    }
  }
});

app.post("/api/preview", async (req, res) => {
  try {
    const {
      value,
      moduleWidth = 2,
      barcodeHeightDots = 80,
      labelWidthInches = 3,
      labelHeightInches = 1,
    } = req.body || {};

    const sanitizedValue = sanitizeZplText(value);

    if (!sanitizedValue) {
      res.status(400).json({ error: "value is required." });
      return;
    }

    const widthDots = Math.round(labelWidthInches * DOTS_PER_INCH);
    const heightDots = Math.round(labelHeightInches * DOTS_PER_INCH);
    const x = centerBarcodeX(sanitizedValue, {
      moduleWidth,
      desiredCenterX: widthDots / 2,
      minX: 10,
    });
    const y = Math.max(10, Math.round((heightDots - barcodeHeightDots) / 2));

    const barcodeBlock = buildCode128Zpl({
      x,
      y,
      value: sanitizedValue,
      moduleWidth,
      height: barcodeHeightDots,
    });

    const zpl = `^XA\n^PW${widthDots}\n^LL${heightDots}\n^LH0,0\n${barcodeBlock}\n^XZ`;

    const url = `http://api.labelary.com/v1/printers/8dpmm/labels/${labelWidthInches}x${labelHeightInches}/0/`;
    const labelaryResponse = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "image/png",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: zpl,
    });

    if (!labelaryResponse.ok) {
      const errorText = await labelaryResponse.text();
      throw new Error(`Labelary render failed: ${labelaryResponse.status} ${errorText}`);
    }

    const imageBuffer = Buffer.from(await labelaryResponse.arrayBuffer());

    res.json({
      zpl,
      imageDataUrl: `data:image/png;base64,${imageBuffer.toString("base64")}`,
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`barcode-core web demo running at http://localhost:${PORT}`);
});
