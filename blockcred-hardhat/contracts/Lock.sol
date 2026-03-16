// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Lock {
    uint public timestamp;
    constructor() { timestamp = block.timestamp; }
}
