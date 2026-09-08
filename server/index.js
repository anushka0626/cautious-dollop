const express = require("express");
const cors = require("cors");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const crypto = require("crypto");
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

// 4. Section 63 BSA Admissibility Certificate Generator
app.get("/api/evidence/certificate/:hash", async (req, res) => {
  try {
    const rawHash = req.params.hash.trim();
    const [exists, record] = await registryContract.verifyEvidence(rawHash);

    if (!exists) {
      return res.status(404).json({ error: "Certificate denied: Hash not found on Sepolia registry." });
    }

    // Handle ethers v5 vs v6 contract address resolution safely
    const contractAddr = registryContract.target || registryContract.address || "0x0000000000000000000000000000000000000000";
    const verificationUrl = `https://sepolia.etherscan.io/address/${contractAddr}`;

    // Generate QR code as PNG Buffer
    const qrBuffer = await QRCode.toBuffer(verificationUrl, {
      type: "png",
      width: 140,
      margin: 1
    });

    const doc = new PDFDocument({ size: "A4", margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=BSA_Sec63_${rawHash.slice(0, 10)}.pdf`);

    doc.pipe(res);

    // Document Borders
    doc.rect(20, 20, 555, 802).lineWidth(1.5).strokeColor("#0f172a").stroke();
    doc.rect(24, 24, 547, 794).lineWidth(0.5).strokeColor("#94a3b8").stroke();

    // Title
    doc.fillColor("#0f172a").fontSize(14).font("Helvetica-Bold").text("BHARATIYA SAKSHYA ADHINIYAM (BSA), 2023", { align: "center" });
    doc.fontSize(11).font("Helvetica-Bold").text("CERTIFICATE OF AUTHENTICITY UNDER SECTION 63", { align: "center" });
    doc.fontSize(8).font("Helvetica").text("Admissibility of Electronic Records in Judicial Proceedings", { align: "center" });
    doc.moveDown(0.8);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#0f172a").lineWidth(1).stroke();
    doc.moveDown(0.8);

    // Section 63 Statutory Clause
    doc.fontSize(8.5).font("Helvetica-Oblique").fillColor("#334155")
      .text(
        "I hereby certify that the electronic record detailed below was produced by an automated cryptographic custody system during the ordinary course of lawful official duties. At all material times, hashing (SHA-256) and AES-256-GCM encryption were operating without unauthorized intervention.",
        { align: "justify" }
      );
    doc.moveDown(1);

    // Metadata Table
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 140).fillAndStroke("#f8fafc", "#cbd5e1");
    
    const rows = [
      ["Case Docket ID", String(record.caseId || "N/A")],
      ["Document Class", String(record.docType || "FIR")],
      ["Cryptographic Digest (SHA-256)", String(record.evidenceHash || rawHash)],
      ["Parent Link (Chain of Custody)", String(record.parentHash || "Genesis")],
      ["Storage Node Reference", String(record.storageURI || "MinIO S3")],
      ["Anchoring Officer / Relayer", String(record.loggedBy || "Relayer")],
      ["Notarization Time (UTC)", new Date(Number(record.timestamp || 0) * 1000).toUTCString()]
    ];

    let rowY = tableTop + 8;
    rows.forEach(([label, val]) => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(label + ":", 48, rowY);
      doc.font("Courier").fontSize(7.5).fillColor("#1e293b").text(val, 200, rowY, { width: 345, ellipsis: true });
      rowY += 18;
    });

    // QR Code and Attestation Details
    const qrSectionY = 325;
    doc.image(qrBuffer, 48, qrSectionY, { width: 100 });
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#0f172a").text("ON-CHAIN VERIFICATION", 160, qrSectionY + 6);
    doc.font("Helvetica").fontSize(7.5).fillColor("#475569")
      .text("Scan to inspect smart contract state directly on Ethereum Sepolia. State root guarantees tamper evidence per Section 63(2) of BSA, 2023.", 160, qrSectionY + 20, { width: 380 })
      .text(`Smart Contract: ${contractAddr}`, 160, qrSectionY + 46)
      .text("Network: Sepolia (Chain ID: 11155111)", 160, qrSectionY + 59)
      .text("Cryptographic Proof: Mined & Immutable", 160, qrSectionY + 72);

    // Custodial Signature Box
    const signTop = 640;
    const systemDigest = crypto.createHash("sha1").update(rawHash).digest("hex").toUpperCase();
    doc.rect(40, signTop, 515, 95).strokeColor("#cbd5e1").lineWidth(0.5).stroke();
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#0f172a").text("CUSTODIAL ATTESTATION (BNSS SEC. 173 / BSA SEC. 63)", 48, signTop + 8);
    doc.font("Helvetica").fontSize(8).fillColor("#475569")
      .text("Certified by: System Automated Custody Agent", 48, signTop + 26)
      .text("Designation: Digital Evidence Custodian", 48, signTop + 40)
      .text(`Verification Fingerprint: ${systemDigest}`, 48, signTop + 54);

    doc.moveTo(370, signTop + 70).lineTo(530, signTop + 70).strokeColor("#475569").stroke();
    doc.fontSize(7.5).font("Helvetica").text("Officer Seal & Signature", 370, signTop + 74, { align: "center", width: 160 });

    doc.end();
  } catch (err) {
    console.error("Certificate generation error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Veritas Ledger Server running on http://localhost:${PORT}`));