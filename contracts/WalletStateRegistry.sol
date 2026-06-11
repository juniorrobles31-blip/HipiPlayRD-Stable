// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WalletStateRegistry
/// @notice Registro mínimo para auditar estados rotativos de wallet.
/// El contrato no guarda saldos ni datos personales; solo hashes e IDs públicos.
contract WalletStateRegistry {
    struct WalletMovement {
        string userRef;
        string previousStateId;
        string newStateId;
        string movementId;
        bytes32 payloadHash;
        bytes32 signatureHash;
        uint256 createdAt;
    }

    address public owner;
    uint256 public totalMovements;
    mapping(string => WalletMovement) public movements;
    mapping(string => bool) public usedStateIds;

    event WalletStateRegistered(
        string indexed movementId,
        string userRef,
        string previousStateId,
        string newStateId,
        bytes32 payloadHash,
        bytes32 signatureHash,
        uint256 createdAt
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function registerWalletMovement(
        string calldata userRef,
        string calldata previousStateId,
        string calldata newStateId,
        string calldata movementId,
        bytes32 payloadHash,
        bytes32 signatureHash
    ) external onlyOwner {
        require(bytes(movementId).length > 0, "MOVEMENT_REQUIRED");
        require(bytes(newStateId).length > 0, "STATE_REQUIRED");
        require(!usedStateIds[newStateId], "STATE_ALREADY_USED");
        require(movements[movementId].createdAt == 0, "MOVEMENT_EXISTS");

        WalletMovement memory movement = WalletMovement({
            userRef: userRef,
            previousStateId: previousStateId,
            newStateId: newStateId,
            movementId: movementId,
            payloadHash: payloadHash,
            signatureHash: signatureHash,
            createdAt: block.timestamp
        });

        movements[movementId] = movement;
        usedStateIds[newStateId] = true;
        totalMovements += 1;

        emit WalletStateRegistered(
            movementId,
            userRef,
            previousStateId,
            newStateId,
            payloadHash,
            signatureHash,
            block.timestamp
        );
    }
}
