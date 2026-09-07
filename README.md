# Veritas Ledger

Veritas Ledger is a tamper-proof digital evidence and investigation document management middleware compliant with Section 63 of the Bharatiya Sakshya Adhiniyam (BSA), 2023.

It automates PII anonymization, checks BNS/BNSS statutory benchmarks, stores AES-256-GCM encrypted records in self-hosted MinIO object storage, and anchors immutable SHA-256 fingerprints to Sepolia via a zero-gas Web3 relayer.

---

## 1. Prerequisites

- **Node.js**: v18+ (LTS v20 recommended)
- **Python**: 3.10+
- **Container Engine**: Podman (default on Fedora) or Docker
- **System Packages** (Fedora):
  ```bash
  sudo dnf install -y tesseract tesseract-langpack-hin
  ```


---
## 2. Storage Setup (MinIO)

Start the local MinIO object store using Podman:
```bash

mkdir -p ~/veritas-storage/data

podman run -d \
  --name minio-veritas \
  --restart always \
  -p 9000:9000 \
  -p 9001:9001 \
  -e "MINIO_ROOT_USER=admin" \
  -e "MINIO_ROOT_PASSWORD=VeritasAdmin2026!" \
  -v ~/veritas-storage/data:/data:Z \
  quay.io/minio/minio server /data --console-address ":9001"
  ```


   Open http://localhost:9001 in your browser.

  Sign in with admin / VeritasAdmin2026!

   Create a bucket named court-records.

  
----

## 3. Environment Variables

Create server/.env with the following variables:
```TOML

PORT=5000
SEPOLIA_RPC_URL=[https://ethereum-sepolia-rpc.publicnode.com](https://ethereum-sepolia-rpc.publicnode.com)
PRIVATE_KEY=0xyour_private_key_here
CONTRACT_ADDRESS=0x_deployed_contract_address_here

MINIO_ENDPOINT=[http://127.0.0.1:9000](http://127.0.0.1:9000)
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=VeritasAdmin2026!
STORAGE_SECRET=veritas-secret-salt-2026
```
---
## 4. Installation & Running
####  Terminal 1: AI Microservice (FastAPI + OCR + Presidio)
```bash

cd ai-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python vision_service.py
```

Service starts on http://127.0.0.1:8000.

#### Terminal 2: Node.js Backend & Relayer
```bash

cd server
npm install
node index.js
```

Service starts on http://localhost:5000.

#### Terminal 3: React Frontend (Vite)
```bash
npm install
npm run dev
```

Frontend runs on http://localhost:5173.

----
## 5. Core Architecture & Workflow

    1. Ingest & Redact: Upload an FIR or seizure docket (image/PDF). The AI engine extracts text, masks sensitive victim/witness PII, and verifies BNS requirements.

    2. Encrypt & Anchor: The backend encrypts the file with AES-256-GCM, pushes it to MinIO, and relays its SHA-256 fingerprint onto the Sepolia smart contract.

    3. Chain of Custody: Chronological parent-child dockets are linked by caseId and parentHash.

    4. Judicial Tamper Verification: Real-time hash comparison confirms document authenticity or detects bit-level tampering.
