/// SPDX-License-Identifier: AGPL-3.0-or-later

// Copyright (C) 2024 halys

pragma solidity ^0.8.19;

interface WethLike {
    function approve(address,uint) external;
    function transfer(address,uint) external;
    function transferFrom(address,address,uint) external;
    function deposit() payable external;
    function balanceOf(address) external view returns (uint);
}
