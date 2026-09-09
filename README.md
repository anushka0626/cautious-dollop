# Veritas Ledger

Tamper-evident evidence and chain-of-custody management for Indian legal and investigation
documents, built to Section 63 of the Bharatiya Sakshya Adhiniyam (BSA), 2023.

Documents are hashed in the browser, masked for PII and audited against the BNSS 173
statutory pillars, encrypted with AES-256-GCM into MinIO, and anchored on-chain as a
32-byte SHA-256 digest through a server-side relayer — so a constable never sees a wallet,
a seed phrase or a gas fee. A single altered character breaks the digest and the ledger
stops recognising the file.

SIH 2026 · Problem statement **26190** · Team **HYPERLOOP HACKERS** (22918A)

---

## Repository history

This repository is the merge of the two halves the team developed in parallel:

| Source | What it contributed |
|---|---|
| `ArchitBoraste/veritas-ledger` | Installable PWA shell and service worker, IndexedDB offline capture queue, client-side SHA-256 with a browser/server digest cross-check, API-probing connectivity hook |
| `anushka0626/cautious-dollop` | FastAPI audit service (OCR, Presidio PII masking, MiniLM BNSS 173 semantics), the `/analyze` and `/certificate` routes, the BSA Section 63 certificate PDF with on-chain QR |

They diverged at commit `debeb8a`; the merge commit brings both onto one branch.

---

## 1. Services and ports

| Service | Port | Command |
|---|---|---|
| React PWA (Vite dev) | **5180** | `npm run dev` |
| React PWA (preview build) | **5181** | `npm run build && npm run preview` |
| Express evidence API | **5000** | `cd server && node index.js` |
| FastAPI statutory audit | **8000** | `ai-service/.venv/Scripts/python vision_service.py` |
| MinIO object storage | 9000 / 9001 | see §3 |
| Local chain (optional) | 8545 | `npx hardhat node` |

The Vite ports are pinned with `strictPort`. A service worker and its caches belong to one
origin, port included, so a drifting port would leave stale workers registered on old
origins. Do not unpin them.

---

## 2. Prerequisites

- Node.js 18+ (developed on v24)
- Python 3.13 (3.10+; **not** 3.14 — several audit dependencies have no wheels for it yet)
- Docker Desktop or Podman, for MinIO
- Optional: Tesseract, only needed to read photographed or scanned paper dockets. Without
  it the audit service still handles PDFs through `pypdf`; image uploads return
  "Illegible Docket".

---

## 3. Storage (MinIO)

```bash
docker run -d --name minio-veritas --restart always -p 9000:9000 -p 9001:9001 -e "MINIO_ROOT_USER=admin" -e "MINIO_ROOT_PASSWORD=<your-minio-password>" -v veritas-storage:/data quay.io/minio/minio server /data --console-address ":9001"
```

Choose your own password and use the same value in both places above. Open
<http://localhost:9001>, sign in with `admin` and that password, and create a bucket named
exactly **`court-records`** — the name is hardcoded as `BUCKET_NAME` in
`server/storage.js`.

Whatever you pick must also go in `MINIO_ROOT_PASSWORD` in `server/.env` (§4).
`storage.js` has no fallback for it, so the server will fail to reach storage if the two
do not match.

---

## 4. Environment

`server/.env` is gitignored. Copy `server/.env.example` and fill it in:

```bash
cp server/.env.example server/.env
```

To run against the **deployed Sepolia contract**, set `SEPOLIA_RPC_URL`, `PRIVATE_KEY` and
`CONTRACT_ADDRESS` to the team's values.

To run **entirely offline on a local chain** — no testnet, no funded key — start a Hardhat
node, deploy to it, and point the same three variables at it:

```bash
npx hardhat compile
npx hardhat node
```

```bash
npx hardhat run scripts/deploy.cjs --network localhost
```

Then set `SEPOLIA_RPC_URL=http://127.0.0.1:8545`, `PRIVATE_KEY` to Hardhat account #0, and
`CONTRACT_ADDRESS` to the address the deploy prints. `relayer.js` builds its provider from
`SEPOLIA_RPC_URL` whatever the network is, which is what makes this work unchanged.

---

## 5. Install and run

```bash
npm install
```

```bash
cd server && npm install
```

```bash
py -3.13 -m venv ai-service/.venv && ai-service/.venv/Scripts/python -m pip install -r ai-service/requirements.txt && ai-service/.venv/Scripts/python -m spacy download en_core_web_lg
```

Presidio's default NLP engine is spaCy `en_core_web_lg`; without that model the audit
service fails on startup. On Linux or macOS the venv binaries are under `.venv/bin`
instead of `.venv/Scripts`.

Then, one terminal each:

```bash
cd ai-service && .venv/Scripts/python vision_service.py
```

```bash
cd server && node index.js
```

```bash
npm run dev
```

Open <http://localhost:5180>.

Sample documents for a dry run: `sample_fir.pdf`, `sample_fir_tampered.pdf`,
`sample_forensic.pdf`, `panchnama_104.pdf`, `seizure_memo_104.pdf`, and
`server/sample_docs/`.

---

## 6. What the app does

1. **Intake and audit.** The document is hashed in the browser with SHA-256, then posted to
   the audit service, which extracts text (pypdf for PDFs, Tesseract OCR for scans), masks
   victim and witness PII with Presidio, scores the docket against the five mandatory
   BNSS 173 pillars using `all-MiniLM-L6-v2` embeddings, and checks the ingredients of each
   penal section it detects. The audit is advisory — if it is down the record can still be
   anchored, because integrity does not depend on it.

2. **Encrypt and anchor.** The server encrypts the file with AES-256-GCM into MinIO and
   anchors only the digest on-chain via the relayer. The browser then cross-checks that the
   digest the server recorded is the one it computed; a mismatch is reported as a rejected
   record rather than a success.

3. **Chain of custody.** Each new document links to the digest of the last one anchored
   against the same case, so a docket reads as a verifiable chain rather than a pile of
   files.

4. **Offline field capture.** The PWA hashes and queues evidence in IndexedDB with no
   network at all, and drains the queue automatically on reconnect. Captures are anchored
   sequentially — the relayer signs with one wallet, so parallel posts would race on the
   nonce.

5. **Tamper check and certificate.** Any file can be re-hashed locally and checked against
   the ledger; the file itself never leaves the machine. A match produces the BSA Section 63
   admissibility certificate as a PDF, carrying the custody metadata and a QR code that
   resolves to the contract on-chain.

---

## 7. Offline demo

Run the offline demo against a production build, not the dev server:

```bash
npm run build && npm run preview
```

In production the boot graph is fully precached, so an offline reload is deterministic. In
dev the precache holds only `index.html` and modules are served on demand under `?v=`
hashes that change whenever Vite re-optimizes deps.

To test: DevTools → Network → Offline, then reload with **Ctrl+R**. Never Ctrl+Shift+R — a
hard reload bypasses the service worker by design and will always fail, however correct the
worker is.

---

## 8. Status

Working end to end: browser hashing, offline queue and drain, AES-256-GCM into MinIO,
relayer anchoring with no officer wallet, `parentHash` custody chaining, docket query,
Presidio redaction, the BNSS 173 semantic audit, penal-section ingredient checks, tamper
verification, and the Section 63 certificate with QR.

Not yet built: Jan Parichay SSO, Aadhaar eSign, an Indic VLM for handwritten and bilingual
FIRs, a Besu consortium on NIC MeghRaj in place of Sepolia, role-based access for
police / forensic / court, CCTNS and ICJS middleware adapters, and load testing at
district-archive scale.
