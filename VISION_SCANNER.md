# Vision Scanner — Current Capability

This document describes exactly what the Vision Scanner feature does **right now**, as of this
build. It's meant to be a snapshot you can hand to someone else (or re-read in a month) to know
what's real vs. what's still on the roadmap.

Entry point: `http://localhost:3000/vision.html` (linked from the "Vision Scanner" item in the
main dashboard's left sidebar). It's a standalone page — no build step, no npm dependency, all
vision libraries load from a CDN in the browser.

## What it does today

### Camera + live object detection
- Requests camera access (`getUserMedia`, rear camera preferred) and shows a live video feed
  with a canvas overlay.
- Runs `coco-ssd` (TensorFlow.js) on the video feed, drawing bounding boxes and labels for
  whatever it recognizes — but coco-ssd only knows the ~80 generic COCO classes (person, bottle,
  chair, book, etc.). **It has no concept of your real Part Numbers or equipment yet.** See
  "Known limitations" below.
- Live detections are tallied into a "Live Object Counts" table (class name → count), refreshed
  a few times a second. This only runs when the target is set to Parts Inventory.

### Barcode scanning (Code 128)
- Continuously scans the video feed for Code 128 barcodes using ZXing, with a manual text-entry
  fallback for typing/pasting a code.
- A 3-second cooldown prevents the same code from re-triggering a lookup every frame.

### Parts Inventory flow
- A scanned/typed code is matched against the `Barcode 128` column via `GET /api/parts/rows`.
- **Match found**: shows Part Number, Part Name, Category, Primary Location, Quantity On Hand,
  Status, and a live training-photo count (see below). You can **Add to** or **Set** the
  Quantity On Hand and save via `POST /api/parts/update-row` — this writes straight to
  `data/parts-inventory.xlsx` through the existing REST API (automatic backup included, same as
  the main dashboard).
- **No match**: shows a "No part matches..." message with an **Add as New Part →** button. This
  stashes the code in `sessionStorage` and navigates to `/index.html`, which switches to the
  Parts Inventory page and pre-fills the Barcode 128 field on the Add Part form.

### Yard Inventory flow
- A scanned/typed code is matched against `Unit Number` first, falling back to `Serial Number`,
  via `GET /api/yard/rows`.
- **Match found**: shows Unit Number, Serial Number, Equipment Type, Make/Model, and editable
  fields for Area, Zone, Row, Slot, Availability Status, Condition Status, Customer Hold, Moved
  By, and Notes. Saving calls `POST /api/yard/update-row`. If Area/Zone/Row/Slot changed, the
  server automatically stamps `Last Moved Date` with today's date (existing server behavior,
  unchanged).
- **No match**: same hand-off pattern as Parts, pre-filling the Unit Number field on the Add
  Equipment Placement form instead.

### Snapshot & object counting (Parts only)
- "Capture Snapshot" freezes the current coco-ssd detections into a list (class name + count).
- For each detected class, you type or pick (via autocomplete) a real Part Number, choose
  **Add** or **Set**, and click Apply to update that part's Quantity On Hand.
- This is a manual mapping step by design — generic object detection can never know that "a
  bottle" in frame is actually Part Number `HYD-1001`; a person has to make that connection until
  a custom classifier exists (see Roadmap).

### Vision training data capture (the foundation for custom recognition)
This is the first building block toward the app actually recognizing your real parts instead of
generic COCO classes:
- **Every successful Parts barcode match automatically saves a labeled training photo** — no
  extra click required. The barcode gives a trusted ground-truth label (the Part Number); the
  camera gives the image.
- The captured image is cropped to the largest current coco-ssd detection box (with 15% padding)
  if one exists, so the saved photo is closer to what a future per-object classifier will
  actually be fed. If no detection box is available, it falls back to the full video frame.
- Images are saved to `data/vision-training/<Part Number>/<timestamp>.jpg`, and every capture is
  also logged as one line in `data/vision-training/manifest.jsonl` (partNumber, fileName,
  relativePath, source, capturedAt).
- The match card shows a live "Training Photos" count for the currently matched part, updated
  after every capture.
- This directory is gitignored (`data/vision-training/`), same as `data/backups/` — it stays
  local and isn't meant to be committed.
- Nothing is trained on this data yet. It's pure accumulation — the classifier that will consume
  it doesn't exist yet (Phase 1 below).

### Activity log
- Every successful/failed write (quantity update, placement update, snapshot apply, training
  capture) is logged with a timestamp in the Activity Log panel.

## API endpoints involved

| Endpoint | Method | Purpose | New or existing |
|---|---|---|---|
| `/api/parts/rows` | GET | Load all Parts rows for barcode matching | Existing (bug fixed — see below) |
| `/api/parts/update-row` | POST | Save quantity changes | Existing |
| `/api/yard/rows` | GET | Load all Yard rows for barcode matching | Existing |
| `/api/yard/update-row` | POST | Save placement edits | Existing |
| `/api/vision/capture` | POST | Save a labeled training photo | **New** |
| `/api/vision/training-counts` | GET | Get photo counts per part (all, or `?partNumber=X`) | **New** |
| `/certs/vision-cert.cer` | GET | Serve the public half of the HTTPS cert for phone install | **New** |

No new npm dependencies were added for any of this — the new endpoints use only `fs`/`path`/`https`,
already required (or now required) at the top of `server.js`.

## Bug fixed along the way
`getPartsRowsAsObjects()` and `readPartsInventoryWorkbook()` in `server.js` were building the
Parts row/column shape from `YARD_HEADERS` instead of `PARTS_HEADERS` — a pre-existing bug,
unrelated to this feature, that silently returned yard-shaped columns from `/api/parts/rows`.
Fixed by swapping in the correct constant in both spots.

## Stability improvements (this pass)

- **Libraries are vendored locally**, not loaded from a CDN. `public/vendor/tf.min.js`,
  `coco-ssd.min.js`, and `zxing.min.js` are the exact same pinned versions that were previously
  `<script src="https://cdn.jsdelivr.net/...">` — now served by this app instead. A flaky
  connection or any network policy blocking jsdelivr used to take down the entire page before the
  camera ever started; now only the initial `npm`-free download (already done, checked into
  `public/vendor/`) matters. coco-ssd's *model weights* (as opposed to the library code) still
  fetch from Google's CDN the first time `cocoSsd.load()` runs — vendoring those too would be a
  much bigger lift (multiple binary shard files) and wasn't done here.
- **Insecure-context detection up front.** Loading this page over plain `http://<lan-ip>` (as a
  phone would) used to fail confusingly the moment you clicked Start Camera — `navigator.mediaDevices`
  is `undefined` entirely on an insecure origin, not just the call, so the old error was a raw
  `getUserMedia is not a function`. Now it's detected on page load: the Start Camera button is
  disabled and the status line explains why (needs HTTPS or localhost) before you ever click it.
- **Camera resolution is now constrained** (`width`/`height` ideal 1280×720) instead of accepting
  whatever a phone's camera defaults to (often much higher). Keeps coco-ssd inference fast and
  battery draw down without hurting barcode-read distance.
- **Camera-loss recovery.** If the browser/OS pulls the camera out from under the page mid-session
  (screen lock, another app grabbing exclusive access, permission revoked, hardware unplugged),
  the video track's `ended` event is now handled — the UI resets to the stopped state with a clear
  "Camera disconnected unexpectedly... click Start Camera to reconnect" message, instead of being
  left showing a frozen frame with dead, disabled buttons.
- **`requestJson()` no longer trusts the response shape.** A network failure (offline, DNS,
  connection refused), a non-2xx HTTP status with no JSON body, and a non-JSON response (e.g. a
  proxy error page) each now surface a specific, readable message instead of either a raw
  `SyntaxError` or — worse — silently treating a failed request as successful (the old code only
  threw when `data.error` was present; a non-2xx response with no error field in the body used to
  fall through as if it had succeeded).

## Phone access: built, but not usable from this machine right now

Camera access requires a secure context (`localhost` or real HTTPS) — a phone on the same Wi-Fi
loading `http://<lan-ip>:3000` will never get camera permission no matter what. The fix for that
part is done:

- `scripts/generate-cert.js` generates a self-signed cert (via `openssl`, no new tool install)
  covering `localhost` + every LAN IPv4 address this machine has. Re-run it if your LAN IP changes.
- `server.js` starts a second, HTTPS listener on port 3443 (alongside the existing HTTP one on
  3000) whenever `certs/key.pem` + `certs/cert.pem` exist — skips silently if they don't, so this
  never breaks the app for anyone not using it.
- `GET /certs/vision-cert.cer` serves the cert (public half only, no private key) with the
  content-type that makes a phone's browser offer to install it as a trusted profile.

**What's blocking actual phone use**: this machine's active network is on Windows' **Public**
firewall profile, which blocks all inbound LAN connections by default, and this is a work laptop
where changing that isn't something to do unilaterally — so the phone can't reach either port
right now regardless of the HTTPS work above. Options if you want to revisit this:

1. Run the server on a personal/unmanaged machine on the same Wi-Fi instead — the HTTPS setup
   above would just work there with no firewall changes, since most home/personal machines either
   default to the Private profile or don't block LAN traffic the same way.
2. A tunneling service (ngrok or similar) — works around the firewall entirely since it's an
   outbound-only connection (no inbound port ever opens on this machine), but briefly exposes this
   dev server to the public internet while it's running, and may itself be worth checking against
   whatever policy governs this laptop before installing/running it.

## Known limitations at this stage

- **No custom recognition yet.** coco-ssd only knows generic COCO classes. It cannot identify a
  specific SKU, forklift model, or part by sight — only barcodes provide reliable identification
  today.
- **Object counting only applies to Parts**, not Yard — Yard tracks unique equipment units, not
  bulk quantities, so a detected "count" doesn't map to it the way it does for Parts.
- **Small/similar-looking parts (bolts, washers, generic filters) are a poor fit for vision
  recognition in general** — even once a custom classifier exists, visually near-identical
  hardware will likely remain barcode-only. Vision recognition will earn its keep most on yard
  equipment (distinct shapes/colors/decals) and visually distinctive parts categories.
- **coco-ssd's model weights still need internet on first use** (see "Stability improvements"
  above — the library code itself is vendored, the model isn't). Cached by the browser after
  that first load.
- **No training pipeline yet.** Photos are being collected (Phase 0), but nothing consumes them
  yet — there's no classifier, no per-box recognition, no correction/active-learning loop. See
  Roadmap.
- **Phone camera testing is blocked on this machine specifically** — see "Phone access" above for
  what's built vs. what's still missing (a firewall exception this laptop shouldn't have changed
  unilaterally).
- **No physical-setup guidance built into the UI.** Isolating a part with a plain background,
  even lighting, and multiple angles substantially improves both coco-ssd's ability to draw a
  box at all and the quality of captured training photos — but the app doesn't yet prompt or
  guide you through that during a capture session.

## Roadmap (not yet built)

The end goal — reliably identifying multiple different real parts in one shelf/bin scene — is
being staged as:

- ✅ **Phase 0 — done.** Auto-capture labeled training photos from barcode-confirmed scans.
- ⬜ **Phase 1 — next.** An in-browser classifier (MobileNet embeddings + a `knn-classifier`, or
  a model trained via Teachable Machine) trained on Phase 0's photos, so a single part held up
  to the camera can be recognized without a barcode.
- ⬜ **Phase 2.** Hybrid detection: keep coco-ssd for generic "there's an object here" boxes in a
  multi-item scene, then run the Phase 1 classifier on each cropped box to assign a real SKU —
  this is what makes bin/shelf scanning with multiple different parts possible, without ever
  needing hand-labeled bounding boxes.
- ⬜ **Phase 3.** A correction loop — when the classifier is wrong or unsure, a quick "actually
  this is Part Y" correction feeds back into the training set automatically.
- ⬜ **Phase 4 (optional, bigger lift).** A fully custom-trained object detector (e.g. YOLO/SSD)
  if Phase 2's hybrid approach isn't precise enough on its own — this would require an offline
  Python training step (a departure from the current Python-free stack) with the trained model
  converted to TensorFlow.js for in-browser inference.

**Open question blocking Phase 2's design**: does coco-ssd draw *any* bounding box (even
mislabeled) when pointed at a real bin of mixed parts? If yes, the hybrid plan above works as
designed. If no, Phase 2 needs a different localization step (a generic "objectness" detector, or
a workflow change like scanning one part at a time on a marked tray instead of true bin scanning).

## File map

| File | Role |
|---|---|
| `public/vision.html` | The Vision Scanner page — camera, detection, scanning, all UI/logic |
| `public/vendor/` | Vendored `tf.min.js`, `coco-ssd.min.js`, `zxing.min.js` — same pinned versions, no longer CDN-loaded |
| `public/index.html` | Added "Vision Scanner" nav link + `applyVisionHandoff()` for the no-match hand-off |
| `server.js` | Added `/api/vision/capture`, `/api/vision/training-counts`, `/certs/vision-cert.cer`, and an HTTPS listener on port 3443 (conditional on `certs/` existing); fixed the `PARTS_HEADERS`/`YARD_HEADERS` bug |
| `scripts/generate-cert.js` | Generates the self-signed cert for phone/LAN HTTPS access (re-run if your LAN IP changes) |
| `certs/` | Generated cert/key (gitignored) — run `node scripts/generate-cert.js` to create |
| `data/vision-training/` | Captured training photos + `manifest.jsonl` (gitignored) |
| `.gitignore` | Added `data/vision-training/` and `certs/` |
