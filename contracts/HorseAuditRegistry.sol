// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract HorseAuditRegistry {
    address public owner;

    struct AuditRecord {
        string eventType;
        string eventId;
        bytes32 payloadHash;
        bytes32 previousHash;
        bytes32 chainHash;
        uint256 timestamp;
    }

    AuditRecord[] public records;
    mapping(bytes32 => bool) public exists;

    event AuditStored(uint256 indexed index, string eventType, string eventId, bytes32 chainHash);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function storeAudit(
        string calldata eventType,
        string calldata eventId,
        bytes32 payloadHash,
        bytes32 previousHash,
        bytes32 chainHash
    ) external onlyOwner {
        require(!exists[chainHash], "audit exists");
        records.push(AuditRecord(eventType, eventId, payloadHash, previousHash, chainHash, block.timestamp));
        exists[chainHash] = true;
        emit AuditStored(records.length - 1, eventType, eventId, chainHash);
    }

    function totalRecords() external view returns (uint256) {
        return records.length;
    }
}
