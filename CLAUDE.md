# Veritas Ledger

Secure document management for Indian legal and investigation documents (FIRs, forensic
reports, witness statements). Files are AES-256-GCM encrypted into MinIO; their SHA-256
digests are notarized on-chain so tampering is detectable and the chain of custody is
auditable.

SIH 2026 entry — problem statement **26190**, NCRB / Ministry of Home Affairs, theme
"Blockchain & Cybersecurity".

## Layout

| Path | What it is |
|---|---|
| `src/` | React 19 + Vite frontend (`App.jsx`, `App.css`) |
| `server/` | Express API, MinIO storage, ethers relayer |
| `server/ml_engine/` | Python PDF analyzer (classification + statutory checklist) |
| `contracts/EvidenceRegistry.sol` | Solidity 0.8.20 evidence registry |
| `scripts/deploy.cjs` | Hardhat deploy script |
| `artifacts/`, `cache/` | Hardhat output, gitignored — `relayer.js` reads the ABI from here |

Ports: Vite dev **5180** · Vite preview **5181** · Express 5000 · Hardhat node 8545 ·
MinIO 9000 (API) / 9001 (console). The Vite ports are pinned with `strictPort` — a service
worker and its caches belong to one origin, port included, so a drifting port leaves stale
workers registered on old origins. Do not unpin them.

## CRITICAL: two module systems

Root `package.json` is `"type": "module"` (ESM). `server/` has **its own** `package.json`
with no `type` field, so it is CommonJS — `require`/`module.exports` throughout.

- Never add `import` syntax to `server/`, never add `require` to `src/`.
- Root-level Node scripts that must be CJS use the `.cjs` extension (`hardhat.config.cjs`,
  `scripts/deploy.cjs`). Keep that convention.
- Each directory has its own `node_modules` and its own Hardhat version (root v2,
  `server/` v3). Run Hardhat commands from the **repo root**.

## CRITICAL: current state — frontend is not wired to the backend

`src/App.jsx` predates `server/index.js` and does not talk to it:

- It POSTs to `http://localhost:3001/analyze`. That endpoint does not exist; the server
  listens on 5000 and exposes `/api/evidence/upload`, `/api/evidence/docket/:caseId`,
  `/api/evidence/verify/:hash`.
- It hardcodes `CONTRACT_ADDRESS` and a `CONTRACT_ABI` with `registerDocument(string,string)`
  / `verifyDocument(string)`. That is an **older contract**. `EvidenceRegistry.sol` has
  `logEvidence(bytes32,string,string,string,bytes32)`, `getCaseDocket`, `verifyEvidence`,
  `sealEvidence`. The interfaces do not match — calls from the UI will revert.
- The "Chain of Custody Timeline" tab renders `custodyStops`, a hardcoded array in
  `App.jsx`. It is a mock; real data would come from `/api/evidence/docket/:caseId`.
- `server/ml_engine/analyzer.py` is not invoked by `server/index.js` at all.

Assume nothing in the UI is connected until you have verified it. Wiring these up is the
main outstanding work.

## Local dev

```bash
npm install
cd server && npm install && pip install -r requirements.txt
```

1. Compile the contract (populates `artifacts/`, which `relayer.js` requires):
   ```bash
   npx hardhat compile
   ```
2. Terminal 1 — local chain:
   ```bash
   npx hardhat node
   ```
3. Terminal 2 — deploy and copy the printed address into `server/.env`:
   ```bash
   npx hardhat run scripts/deploy.cjs --network localhost
   ```
4. MinIO in Docker on ports 9000/9001, with a bucket named exactly **`court-records`**
   (hardcoded as `BUCKET_NAME` in `server/storage.js`; uploads fail silently-ish without it).
5. `server/.env` (gitignored, never commit it):
   `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS`, `MINIO_ENDPOINT`,
   `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `STORAGE_SECRET`, `PORT`.
   `relayer.js` builds its provider from `SEPOLIA_RPC_URL` regardless of network — to run
   against the local node, point it at `http://127.0.0.1:8545` and use a Hardhat account key.
6. `cd server && node index.js` (or `npm run dev` for nodemon), and `npm run dev` at the
   root for Vite.

Sample PDFs for testing: `sample_fir.pdf`, `sample_fir_tampered.pdf`, `sample_forensic.pdf`,
and `server/sample_docs/`.

## PWA / offline shell

`vite-plugin-pwa` with the **injectManifest** strategy and a custom worker in `src/sw.js`
(NetworkFirst for navigations, StaleWhileRevalidate for same-origin GETs). Nothing under
`/api/` is ever cached — a stale custody docket would be actively wrong — and the worker
enforces that twice: the API is cross-origin, plus an explicit pathname guard.

**Run the offline demo against a production build, not the dev server:**

```bash
npm run build && npm run preview   # http://localhost:5181
```

In production the boot graph is six files and all of them are precached, so offline boot is
deterministic. In dev the precache holds only `index.html`; the app's modules are served on
demand under `?v=` hashes that change whenever Vite re-optimizes deps, so anything cached
against an old hash is dead weight. Dev offline is best-effort by decision — do not sink
time into it.

To test offline: DevTools → Network → Offline, then reload with **`Ctrl+R`**. Never
`Ctrl+Shift+R` — a hard reload bypasses the service worker by design and will always fail,
however correct the worker is. While iterating, tick Application → Service Workers →
"Update on reload" so the newest worker takes over.

`src/useOnlineStatus.js` drives the header indicator. It does not trust `navigator.onLine`
(true whenever any interface is up, wrong on a station LAN with no route to the server); it
confirms with a `HEAD` of the API root every 30s, treating any response — 404 included — as
online and only a network-level throw as offline.

## Conventions

- **Plain JavaScript only. Never TypeScript.** `@types/*` packages are leftovers; ignore them.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
- **Do not rewrite `src/App.css`.** The styling is good. Reuse the existing class names
  (`app-shell`, `workflow-tabs`, `dropzone`, `report-panel`, `side-column`, `certificate`,
  `timeline-view`, …) rather than inventing new ones or swapping in a utility framework.
- `npm run lint` at the root runs ESLint over the frontend and `server/`; `dist` and
  `dev-dist` (the worker generated in dev) are ignored as build output.
