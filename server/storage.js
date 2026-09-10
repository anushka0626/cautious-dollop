const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || "http://127.0.0.1:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER || "admin",
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
  },
  forcePathStyle: true,
});

const BUCKET_NAME = "court-records";
const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = crypto.scryptSync(process.env.STORAGE_SECRET || "veritas-secret-salt-2026", "salt", 32);

async function uploadEncryptedFile(fileBuffer, originalFilename, caseId) {
  // 1. Calculate SHA-256 hash of original file (for blockchain attestation & BSA Section 63)
  const rawFileHash = "0x" + crypto.createHash("sha256").update(fileBuffer).digest("hex");

  // 2. Encrypt buffer with AES-256-GCM
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Package: [16B IV][16B AuthTag][Encrypted Data]
  const payload = Buffer.concat([iv, authTag, encrypted]);
  const storageKey = `cases/${caseId}/${Date.now()}-${originalFilename}.enc`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storageKey,
      Body: payload,
      ContentType: "application/octet-stream",
    })
  );

  return {
    rawFileHash,
    storageURI: `minio://${BUCKET_NAME}/${storageKey}`,
  };
}

module.exports = { s3, uploadEncryptedFile };