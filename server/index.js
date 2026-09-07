const express = require("express");
const cors = require("cors");
const multer = require("multer");
require("dotenv").config();

const { uploadEncryptedFile } = require("./storage");
const { anchorEvidenceOnChain, registryContract } = require("./relayer");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// 1. Upload -> Encrypt -> MinIO -> Sepolia Relayer
app.post("/api/evidence/upload", upload.single("file"), async (req, res) => {
  try {
    const { caseId, docType, parentHash } = req.body;
    if (!req.file || !caseId) {
      return res.status(400).json({ error: "File and caseId are mandatory" });
    }

    // Step A: AES-256-GCM Encrypt & Store in MinIO
    const { rawFileHash, storageURI } = await uploadEncryptedFile(
      req.file.buffer,
      req.file.originalname,
      caseId
    );

    // Step B: Notarize hash on Sepolia
    const onChainReceipt = await anchorEvidenceOnChain(
      rawFileHash,
      storageURI,
      docType || "FIR",
      caseId,
      parentHash
    );

    res.json({
      success: true,
      caseId,
      docType: docType || "FIR",
      evidenceHash: rawFileHash,
      storageURI,
      txHash: onChainReceipt.txHash,
      blockNumber: onChainReceipt.blockNumber,
    });
  } catch (err) {
    console.error("Evidence upload failed:", err);
    res.status(500).json({ error: err.message || "Failed to process evidence" });
  }
});

// 2. Query Chain-of-Custody Docket by Case ID
app.get("/api/evidence/docket/:caseId", async (req, res) => {
  try {
    const hashes = await registryContract.getCaseDocket(req.params.caseId);
    const records = await Promise.all(
      hashes.map(async (h) => {
        const [, record] = await registryContract.verifyEvidence(h);
        return {
          evidenceHash: record.evidenceHash,
          storageURI: record.storageURI,
          docType: record.docType,
          caseId: record.caseId,
          timestamp: Number(record.timestamp),
          parentHash: record.parentHash,
        };
      })
    );
    res.json({ caseId: req.params.caseId, docket: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Verify Document Hash Against Sepolia
app.get("/api/evidence/verify/:hash", async (req, res) => {
  try {
    const [exists, record] = await registryContract.verifyEvidence(req.params.hash);
    if (!exists) {
      return res.json({ authentic: false, message: "Tamper Detected: Hash not on ledger" });
    }
    res.json({
      authentic: true,
      record: {
        evidenceHash: record.evidenceHash,
        storageURI: record.storageURI,
        docType: record.docType,
        caseId: record.caseId,
        timestamp: Number(record.timestamp),
        loggedBy: record.loggedBy,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const FormData = require("form-data");
// Use global fetch (Node 18+) or require('node-fetch')

// Add an endpoint to run AI processing prior to on-chain notarization
app.post("/api/evidence/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    // Forward raw buffer directly
    const aiResponse = await fetch("http://127.0.0.1:8000/process-document", {
      method: "POST",
      body: req.file.buffer,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      return res.status(aiResponse.status).json({ error: errText });
    }

    const aiData = await aiResponse.json();
    res.json(aiData);
  } catch (err) {
    res.status(500).json({ error: "AI service offline: " + err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Veritas Ledger Server running on http://localhost:${PORT}`));