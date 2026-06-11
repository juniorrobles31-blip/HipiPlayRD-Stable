// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract LocalFirstWalletRegistry {
    event LocalWalletMovementRegistered(
        bytes32 indexed userHash,
        bytes32 indexed movementId,
        bytes32 previousWalletStateId,
        bytes32 newWalletStateId,
        bytes32 payloadHash,
        bytes32 signatureHash,
        uint256 timestamp
    );

    mapping(bytes32 => bytes32) public latestWalletState;
    mapping(bytes32 => bool) public movementExists;

    function registerMovement(
        bytes32 userHash,
        bytes32 movementId,
        bytes32 previousWalletStateId,
        bytes32 newWalletStateId,
        bytes32 payloadHash,
        bytes32 signatureHash
    ) external {
        require(!movementExists[movementId], "movement already registered");
        bytes32 current = latestWalletState[userHash];
        if (current != bytes32(0)) {
            require(current == previousWalletStateId, "invalid previous wallet state");
        }
        movementExists[movementId] = true;
        latestWalletState[userHash] = newWalletStateId;
        emit LocalWalletMovementRegistered(
            userHash,
            movementId,
            previousWalletStateId,
            newWalletStateId,
            payloadHash,
            signatureHash,
            block.timestamp
        );
    }
}
