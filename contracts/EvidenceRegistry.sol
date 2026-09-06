// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EvidenceRegistry
 * @dev Immutable ledger for Indian Legal & Investigation Documents (BSA 2023 Compliant)
 */
contract EvidenceRegistry {
    address public immutable authorityAdmin;

    enum DocumentState { Active, Sealed, Deprecated }

    struct EvidenceRecord {
        bytes32 evidenceHash;   // SHA-256 digest of original plaintext or encrypted payload
        string storageURI;      // MinIO object storage locator
        string docType;         // FIR, Panchnama, SeizureMemo, ForensicReport, Chargesheet
        string caseId;          // Police or Court Case Reference ID
        address loggedBy;       // Address/Key of submitting officer or relayer
        uint256 timestamp;      // Block timestamp
        bytes32 parentHash;     // Hash of preceding document in the docket (0x0 for root FIR)
        DocumentState state;    // Lifecycle state
    }

    // Mapping: evidenceHash => EvidenceRecord
    mapping(bytes32 => EvidenceRecord) public records;

    // Mapping: caseId => array of evidence hashes forming the Chain of Custody
    mapping(string => bytes32[]) private caseDockets;

    // Fast duplicate check
    mapping(bytes32 => bool) public hashExists;

    event EvidenceLogged(
        bytes32 indexed evidenceHash,
        string indexed caseId,
        string docType,
        address indexed loggedBy,
        bytes32 parentHash,
        uint256 timestamp
    );

    event DocumentSealed(bytes32 indexed evidenceHash, address indexed authority);

    modifier onlyAdmin() {
        require(msg.sender == authorityAdmin, "Unauthorized: Admin only");
        _;
    }

    constructor() {
        authorityAdmin = msg.sender;
    }

    /**
     * @notice Log a new investigation document into the custody docket.
     * @param _evidenceHash SHA-256 hash of the evidence file
     * @param _storageURI MinIO retrieval URI
     * @param _docType Document classification
     * @param _caseId Unique case identifier
     * @param _parentHash Preceding document's hash (pass bytes32(0) if this is the initial FIR)
     */
    function logEvidence(
        bytes32 _evidenceHash,
        string calldata _storageURI,
        string calldata _docType,
        string calldata _caseId,
        bytes32 _parentHash
    ) external {
        require(_evidenceHash != bytes32(0), "Invalid hash");
        require(!hashExists[_evidenceHash], "Evidence already notarized");

        // If parentHash is specified, ensure that parent actually exists on-chain
        if (_parentHash != bytes32(0)) {
            require(hashExists[_parentHash], "Parent evidence not found in registry");
        }

        records[_evidenceHash] = EvidenceRecord({
            evidenceHash: _evidenceHash,
            storageURI: _storageURI,
            docType: _docType,
            caseId: _caseId,
            loggedBy: msg.sender,
            timestamp: block.timestamp,
            parentHash: _parentHash,
            state: DocumentState.Active
        });

        hashExists[_evidenceHash] = true;
        caseDockets[_caseId].push(_evidenceHash);

        emit EvidenceLogged(_evidenceHash, _caseId, _docType, msg.sender, _parentHash, block.timestamp);
    }

    /**
     * @notice Fetch the full chronological chain of custody hashes for a case.
     */
    function getCaseDocket(string calldata _caseId) external view returns (bytes32[] memory) {
        return caseDockets[_caseId];
    }

    /**
     * @notice Verify whether an uploaded file hash matches an existing record.
     */
    function verifyEvidence(bytes32 _evidenceHash) external view returns (bool exists, EvidenceRecord memory record) {
        exists = hashExists[_evidenceHash];
        if (exists) {
            record = records[_evidenceHash];
        }
    }

    /**
     * @notice Seal a record to prevent further references or modifications (court order).
     */
    function sealEvidence(bytes32 _evidenceHash) external onlyAdmin {
        require(hashExists[_evidenceHash], "Record does not exist");
        records[_evidenceHash].state = DocumentState.Sealed;
        emit DocumentSealed(_evidenceHash, msg.sender);
    }
}