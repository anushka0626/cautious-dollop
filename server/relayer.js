const { ethers } = require("ethers");
require("dotenv").config();

// Load contract ABI compiled by Hardhat
const registryArtifact = require("../artifacts/contracts/EvidenceRegistry.sol/EvidenceRegistry.json");

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const relayerWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const registryContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, registryArtifact.abi, relayerWallet);

async function anchorEvidenceOnChain(rawFileHash, storageURI, docType, caseId, parentHash) {
  const safeParentHash = parentHash && parentHash.startsWith("0x") && parentHash.length === 66 
    ? parentHash 
    : ethers.ZeroHash;

  const tx = await registryContract.logEvidence(
    rawFileHash,
    storageURI,
    docType,
    caseId,
    safeParentHash
  );

  const receipt = await tx.wait(1);
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
  };
}

module.exports = { registryContract, anchorEvidenceOnChain };