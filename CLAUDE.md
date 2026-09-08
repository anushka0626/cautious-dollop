# Veritas Ledger

Secure document management for Indian legal and investigation documents (FIRs, forensic
reports, witness statements). Files are AES-256-GCM encrypted into MinIO; their SHA-256
digests are notarized on-chain so tampering is detectable and the chain of custody is
auditable.

SIH 2026 entry — problem statement **26190**, NCRB / Ministry of Home Affairs, theme
"Blockchain & Cybersecurity".

This repository is the merge of two parallel forks — `ArchitBoraste/veritas-ledger` (PWA,
offline capture) and `anushka0626/cautious-dollop` (AI audit, BSA certificate) — which
diverged at `debeb8a`. If something looks like it was written twice, that is why.

## Layout

| Path | What it is |
|---|---|
| `src/` | React 19 + Vite frontend (`App.jsx`, `App.css`) |
| `src/queue.js`, `src/useCaptureQueue.js` | IndexedDB offline capture queue and its drain loop |
| `src/sw.js` | Custom service worker (injectManifest strategy) |
| `server/` | Express API, MinIO storage, ethers relayer |
| `server/ml_engine/` | Older Python PDF analyzer. **Not wired into anything** — the live audit is `ai-service/` |
| `ai-service/vision_service.py` | FastAPI audit service: OCR, Presidio PII masking, MiniLM BNSS 173 semantics |
| `contracts/EvidenceRegistry.sol` | Solidity 0.8.20 evidence registry |
| `scripts/deploy.cjs` | Hardhat deploy script |
| `artifacts/`, `cache/` | Hardhat output — `relayer.js` reads the ABI from here |

Ports: Vite dev **5180** · Vite preview **5181** · Express 5000 · FastAPI audit 8000 ·
Hardhat node 8545 · MinIO 9000 (API) / 9001 (console). The Vite ports are pinned with
`strictPort` — a service worker and its caches belong to one origin, port included, so a
drifting port leaves stale workers registered on old origins. Do not unpin them.

## CRITICAL: two module systems

Root `package.json` is `"type": "module"` (ESM). `server/` has **its own** `package.json`
with no `type` field, so it is CommonJS — `require`/`module.exports` throughout.

- Never add `import` syntax to `server/`, never add `require` to `src/`.
- Root-level Node scripts that must be CJS use the `.cjs` extension (`hardhat.config.cjs`,
  `scripts/deploy.cjs`). Keep that convention.
- Each directory has its own `node_modules` and its own Hardhat version (root v2,
  `server/` v3). Run Hardhat commands from the **repo root**.

## Request flow

`src/App.jsx` is wired to `server/index.js` and drives one workflow: stage → audit → anchor
(or queue, when offline) → verify → certify.

| Route | Purpose |
|---|---|
| `POST /api/evidence/analyze` | Forwards the raw buffer to FastAPI on 8000; returns redacted text, detected sections, procedural flags |
| `POST /api/evidence/upload` | AES-256-GCM into MinIO, then `logEvidence` through the relayer |
| `GET /api/evidence/docket/:caseId` | Chain of custody for a case, oldest first |
| `GET /api/evidence/verify/:hash` | Existence check against the registry |
| `GET /api/evidence/certificate/:hash` | BSA Section 63 PDF with an on-chain QR |

Two invariants worth keeping:

- **The audit is advisory.** If FastAPI on 8000 is down, `stageDocument` catches it, shows
  "Statutory audit unavailable" and still allows anchoring. Integrity does not depend on
  the AI service and the UI must never imply it does.
- **The browser cross-checks the server's digest.** `anchorDocument` compares the hash it
  computed against `data.evidenceHash` and throws on a mismatch. `hashFile` produces
  lowercase, `0x`-prefixed, 66 characters — exactly what `server/storage.js` anchors. Any
  drift there makes every verification fail.

`parentHash` is read from the case docket immediately before anchoring, so each document
links to the last one on that case.

## Local dev

```bash
npm install
```

```bash
cd server && npm install
```

```bash
py -3.13 -m venv ai-service/.venv && ai-service/.venv/Scripts/python -m pip install -r ai-service/requirements.txt && ai-service/.venv/Scripts/python -m spacy download en_core_web_lg
```

Use **Python 3.13, not 3.14** — torch and several Presidio dependencies have no 3.14
wheels. Presidio's default NLP engine is spaCy `en_core_web_lg`; the service fails at
startup without that model.

1. Compile the contract (populates `artifacts/`, which `relayer.js` requires):
   ```bash
   npx hardhat compile
   ```
2. Terminal 1 — local chain:
   ```bash
   npx hardhat node
   ```
3. Terminal 2 — deploy, and copy the printed address into `server/.env`:
   ```bash
   npx hardhat run scripts/deploy.cjs --network localhost
   ```
4. MinIO in Docker on ports 9000/9001, with a bucket named exactly **`court-records`**
   (hardcoded as `BUCKET_NAME` in `server/storage.js`; uploads fail without it).
5. `server/.env` — copy `server/.env.example`. It is gitignored; never commit a real key.
   `relayer.js` builds its provider from `SEPOLIA_RPC_URL` regardless of network, so to run
   against the local node point that variable at `http://127.0.0.1:8545` and use a Hardhat
   account key. That is the whole trick to running with no testnet and no funded wallet.
6. `cd ai-service && .venv/Scripts/python vision_service.py`, `cd server && node index.js`,
   and `npm run dev` at the root.

Sample PDFs for testing: `sample_fir.pdf`, `sample_fir_tampered.pdf`, `sample_forensic.pdf`,
`panchnama_104.pdf`, `seizure_memo_104.pdf`, and `server/sample_docs/`.

## PWA / offline shell

`vite-plugin-pwa` with the **injectManifest** strategy and a custom worker in `src/sw.js`
(NetworkFirst for navigations, StaleWhileRevalidate for same-origin GETs). Nothing under
`/api/` is ever cached — a stale custody docket would be actively wrong — and the worker
enforces that twice: the API is cross-origin, plus an explicit pathname guard.

**Run the offline demo against a production build, not the dev server:**

```bash
npm run build && npm run preview   # http://localhost:5181
```

In production the boot graph is precached in full, so offline boot is deterministic. In dev
the precache holds only `index.html`; the app's modules are served on demand under `?v=`
hashes that change whenever Vite re-optimizes deps, so anything cached against an old hash
is dead weight. Dev offline is best-effort by decision — do not sink time into it.

To test offline: DevTools → Network → Offline, then reload with **`Ctrl+R`**. Never
`Ctrl+Shift+R` — a hard reload bypasses the service worker by design and will always fail,
however correct the worker is. While iterating, tick Application → Service Workers →
"Update on reload" so the newest worker takes over.

`src/useOnlineStatus.js` drives the header indicator. It does not trust `navigator.onLine`
(true whenever any interface is up, wrong on a station LAN with no route to the server); it
confirms with a `HEAD` of the API root every 30s, treating any response — 404 included — as
online and only a network-level throw as offline.

`useCaptureQueue` syncs sequentially on purpose: each upload is a chain transaction and the
relayer signs with one wallet, so parallel posts would race on the nonce. A document already
on the ledger reverts `logEvidence`; that is surfaced as `duplicate`, not as a fresh anchor.

## Conventions

- **Plain JavaScript only. Never TypeScript.** `@types/*` packages are leftovers; ignore them.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
- `src/App.css` is a **light** record-office theme: paper ground, ink text, hairline rules,
  2–3px radii, no gradients, no glass, no glow. Colour carries meaning — green verified,
  amber flagged, red broken — so do not use it decoratively. Reuse the existing class names
  (`app-shell`, `workflow-tabs`, `dropzone`, `report-panel`, `side-column`, `certificate`,
  `timeline-view`, `checklist`, `notice`, …) rather than inventing new ones or swapping in a
  utility framework. Palette tokens live in `:root`; the old dark-theme names are aliased to
  the light ones so nothing dangles.
- `npm run lint` at the root runs ESLint over the frontend and `server/`; `dist` and
  `dev-dist` (the worker generated in dev) are ignored as build output.
