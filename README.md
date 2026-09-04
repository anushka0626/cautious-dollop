# Veritas Ledger

Veritas Ledger is a digital evidence tool for analysing PDF records and anchoring their SHA-256 fingerprints on the Sepolia testnet.

## Setup

Install the frontend and server dependencies:

```bash
npm install
cd server
npm install
pip install -r requirements.txt
```

## Run

Start the server in one terminal:

```bash
cd server
node index.js
```

Start the frontend in another terminal:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. Upload a PDF to analyse it, then connect MetaMask to Sepolia to register or verify its fingerprint on-chain.
