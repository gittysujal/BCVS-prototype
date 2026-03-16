// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
// You can keep MerkleProof if you plan to verify proofs on-chain later.
// For now it's unused, which is fine (just a warning, not an error).
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract CredentialRegistry is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    enum Status {
        None,
        Active,
        Revoked
    }

    struct Credential {
        address issuer;
        address subject;
        bytes32 merkleRoot;
        string cid;
        uint64 issuedAt;
        uint64 revokedAt;
    }

    // Core credential store: id → full credential
    mapping(bytes32 => Credential) private credentials;

    // Index: subject (holder) → list of credential IDs
    mapping(address => bytes32[]) private credentialsIdBySubject;

    event Issued(
        bytes32 indexed id,
        address indexed issuer,
        address indexed subject,
        bytes32 merkleRoot,
        string cid
    );

    event Revoked(
        bytes32 indexed id,
        address indexed issuer,
        uint64 revokedAt
    );

    event Reactivated(
        bytes32 indexed id,
        address indexed issuer
    );

    // Custom Errors for clear revert reasons
    error CallerNotIssuer(address caller);
    error CredentialAlreadyExists(bytes32 id);
    error InvalidSubjectAddress();
    error EmptyMerkleRoot();
    error EmptyCID();

    // Errors for revoke/activate flows
    error CredentialNotFound(bytes32 id);
    error NotAuthorized(address caller);
    error AlreadyRevoked(bytes32 id);
    error NotRevoked(bytes32 id);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
    }

    // ---------------------------
    // ISSUE CREDENTIAL
    // ---------------------------
    function issueCredential(
        bytes32 id,
        address subject,
        bytes32 merkleRoot,
        string memory cid
    ) external {
        // 1. Explicit AccessControl check
        if (!hasRole(ISSUER_ROLE, msg.sender)) {
            revert CallerNotIssuer(msg.sender);
        }

        // 2. Explicit validation checks
        if (credentials[id].issuer != address(0)) {
            revert CredentialAlreadyExists(id);
        }
        if (subject == address(0)) {
            revert InvalidSubjectAddress();
        }
        if (merkleRoot == bytes32(0)) {
            revert EmptyMerkleRoot();
        }
        if (bytes(cid).length == 0) {
            revert EmptyCID();
        }

        credentials[id] = Credential({
            issuer: msg.sender,
            subject: subject,
            merkleRoot: merkleRoot,
            cid: cid,
            issuedAt: uint64(block.timestamp),
            revokedAt: 0
        });

        // Track this credential under the holder's address
        credentialsIdBySubject[subject].push(id);

        emit Issued(id, msg.sender, subject, merkleRoot, cid);
    }

    // ---------------------------
    // REVOKE CREDENTIAL
    // ---------------------------
   function revokeCredential(bytes32 id) external {
    Credential storage c = credentials[id];

    if (c.issuer == address(0)) revert CredentialNotFound(id);

    if (!(c.issuer == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender))) {
        revert NotAuthorized(msg.sender);
    }

    if (c.revokedAt != 0) revert AlreadyRevoked(id);

    c.revokedAt = uint64(block.timestamp);
    emit Revoked(id, c.issuer, c.revokedAt);
}
    // ---------------------------
    // REACTIVATE CREDENTIAL
    // ---------------------------
   function activateCredential(bytes32 id) external {
    Credential storage c = credentials[id];

    if (c.issuer == address(0)) revert CredentialNotFound(id);

    if (!(c.issuer == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender))) {
        revert NotAuthorized(msg.sender);
    }

    if (c.revokedAt == 0) revert NotRevoked(id);

    c.revokedAt = 0;
    emit Reactivated(id, c.issuer);
}
    // ---------------------------
    // STATUS CHECK
    // ---------------------------
    function statusOf(bytes32 id) external view returns (Status) {
        Credential storage c = credentials[id];
        if (c.issuer == address(0)) return Status.None;
        if (c.revokedAt > 0) return Status.Revoked;
        return Status.Active;
    }

    // ---------------------------
    // GETTERS (for UI / frontend)
    // ---------------------------

    // Full credential by ID
    function getCredential(bytes32 id)
        external
        view
        returns (Credential memory)
    {
        return credentials[id];
    }

    // All credential IDs belonging to a given subject (holder)
    function getCredentialIdsBySubject(address subject)
        external
        view
        returns (bytes32[] memory)
    {
        return credentialsIdBySubject[subject];
    }
}