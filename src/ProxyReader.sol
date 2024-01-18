/// SPDX-License-Identifier: AGPL-3.0

// Copyright (C) 2021-2024 halys

pragma solidity ^0.8.19;

interface IFeedbase {
    function pull(address src, bytes32 tag) external view returns (bytes32, uint);
}

contract AnswerUpdatedEmitter {
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    function emitAnswerUpdated() external {
        emit AnswerUpdated(0, 0, 0);
    }

}

contract ProxyReader {
    address  public immutable src;
    IFeedbase public immutable fb;

    constructor(IFeedbase _fb, address _src) {
        (fb, src) = (_fb, _src);
    }

    function read(bytes32 tag) external view returns (bytes32 val, uint ttl) {
        (val, ttl) = fb.pull(src, tag);
    }

}
