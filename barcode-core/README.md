# barcode-core

A small, dependency-free library for Code128 barcode value generation and
ZPL emission. Extracted from the label-printer pilot app so it can be
integrated into the main product (and reused in a future phone-facing app)
without pulling in Excel, Express, or printer-client code.

No npm dependencies. Every function takes plain objects/strings and returns
plain values — nothing here talks to a file, a network, or a printer.

## The three barcode-value strategies

Not every label type gets its barcode value the same way. This library makes
that explicit instead of leaving it as an implicit difference between
near-identical-looking functions:

| Strategy | What it means | Use it via |
|---|---|---|
| **Stored** | The barcode is just a column already on the row (it might mirror another field, like a unit number, or hold a value generated earlier) | `createStoredBarcodeReader(columnName)` |
| **Computed** | The barcode is derived from other fields every time (e.g. a warehouse location code from Aisle/Bay/Level/Bin) | `computeLocationBarcode({ aisle, bay, level, bin })` |
| **Random** | The barcode is freshly generated and must be unique against whatever's already in use | `createRandomNumericBarcodeGenerator({ length, isReserved })` |

Pick the strategy per label/entity type up front, rather than writing a new
barcode-value function that looks like the others but quietly does something
different.

## API

### `zpl.js`
- `sanitizeZplText(value)` — strips ZPL control characters (`^`, `~`) from
  any value headed into an `^FD` field, and trims it.
- `estimateCode128WidthDots(value, moduleWidth)` — estimates the rendered
  width of a Code128 barcode in dots, for layout purposes.
- `centerBarcodeX(value, { moduleWidth, desiredCenterX, xOffset, minX })` —
  the `^FO` x-coordinate that centers the barcode on `desiredCenterX`.
- `buildCode128Zpl({ x, y, value, moduleWidth, height, showInterpretationLine })`
  — the `^BY` / `^BCN` / `^FD...^FS` block for one barcode.
- `formatHumanReadableText(value)` — optional character-spaced text
  (`"ABC123"` → `"A B C 1 2 3"`) if you want to print your own human-readable
  line instead of ZPL's built-in interpretation line.

### `strategies.js`
- `createStoredBarcodeReader(columnName)`
- `computeLocationBarcode({ aisle, bay, level, bin })` / `padTwoDigits(value)`
- `createRandomNumericBarcodeGenerator({ length, isReserved, maxAttempts })`
  → `.generate()`
- `createFixedLengthNumericValidator(length)` → `(value) => boolean`

### `selection.js`
For "print these specific barcodes" flows (a user picks rows by barcode and
a quantity each):
- `normalizeSelectedBarcodeRequests(labels, { normalizeBarcode, maxTotalLabels, subjectNoun })`
  — validates shape, dedupes, validates quantities, enforces a cap.
- `buildBarcodeRowIndex(rows, getBarcode)` — indexes rows by barcode value.
- `resolveSelectedRows(selectedRequests, rowIndex)` — resolves each request
  to exactly one row, throwing (with `.statusCode = 400`) on not-found or
  ambiguous-duplicate matches.

ZPL construction and result summaries are intentionally left to the caller —
those are per-label-type/business-specific and don't belong in a shared
barcode library.

## Two decisions worth making on purpose

The source app had these as silent inconsistencies between its three label
types. This library makes each one an explicit option instead:

1. **Interpretation line.** `buildCode128Zpl`'s `showInterpretationLine`
   defaults to `false` — pair it with `formatHumanReadableText` if you want
   your own styled human-readable line, or set it to `true` to let ZPL print
   its native one. Don't do both.
2. **Single source of truth for computed barcodes.** If a barcode value is
   computed from other fields (like `computeLocationBarcode`), call this
   library's function everywhere that value is needed — server-side
   generation, client-side live preview, print-time lookup — instead of
   re-implementing the formula per call site. Formula drift between
   independent copies is the easiest way for a "barcode not found" bug to
   show up.

## Try it

```
node barcode-core/demo.js
```

Runs a self-contained smoke test (no Excel, no server) exercising every
function above, including an assertion that `computeLocationBarcode` matches
known output from the source app's location-label logic.
