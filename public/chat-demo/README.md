# chat-demo — drop-in folder for Label-Printer-V2

This is the FleeetX rental-desk chat agent demo, packaged to drop straight into this
app's existing `public/` folder.

## Install

Copy this whole `chat-demo/` folder into `public/`, so you end up with:

```
Label-Printer-V2/
└── public/
    ├── index.html          ← your existing dashboard, untouched
    └── chat-demo/          ← this folder
        ├── index.html
        ├── scripted-demo.html
        ├── claude-agent.html
        └── xai-agent.html
```

That's the entire install. **No changes to `server.js`, `package.json`, or any other
existing file.** Your app already serves everything under `public/` via
`express.static(path.join(__dirname, "public"))` with no catch-all route intercepting
it, so this subfolder is served automatically the moment it exists.

Start the app the normal way (`npm start`), then open:

```
http://localhost:3000/chat-demo/
```

Tested against this exact repo before delivery — the existing dashboard (`/`,
`/api/status`) and every page in this folder returned `200` side by side, no conflicts.

## What's inside

| File | Works when opened this way? |
|---|---|
| `chat-bubble.html` | **The bottom-right floating bubble launcher.** Click it, pick a demo, it loads in an iframe inside the expanded panel. Lazy-loads on pick, so nothing (including any API-backed agent) starts running before someone actually opens it. Doesn't modify the three files below in any way — they're loaded exactly as-is inside an iframe. |
| `index.html` | Plain landing page listing the three demos as full-page links (the original, non-bubble entry point) |
| `scripted-demo.html` | **Yes.** Deterministic, no external calls, no key needed |
| `xai-agent.html` | **Yes**, once you paste in your own xAI API key on the page |
| `claude-agent.html` | **No.** Serves fine (loads, no error) but the chat itself won't function — it depends on Claude.ai's artifact API proxy, which doesn't exist here. It carries an on-page warning banner explaining this. Kept in for reference/version-control convenience, not because it runs standalone. To actually use the Claude version, open it as an artifact inside a Claude.ai conversation instead. |

## Remove it

Delete the `chat-demo/` folder. Nothing else references it — this doesn't touch
`server.js`, doesn't add any npm dependency, doesn't modify any of your existing
`data/*.xlsx`, printer, or label routes.

## Data note

Fleet data (79 units — forklifts, scissor lifts, piggyback forklifts) is embedded
directly in each HTML file as a static snapshot, generated from
`equipment_catalog_cleaned.csv`. It is **not** the same dataset as this app's
`data/yard-inventory.xlsx` — that tracks physical yard placement for label printing,
this tracks rental status/rates for the chat agent. They aren't wired together.
If you ever want the chat agent hitting live data instead of this snapshot, that's a
separate integration — this repo already has a working `/api/yard/*` CRUD surface that
could be a starting point, but the schemas would need to be reconciled first.
