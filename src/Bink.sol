/// SPDX-License-Identifier: AGPL-2.0

// Copyright (C) 2024 halys

pragma solidity ^0.8.25;

import { Bank, Math, Gem } from "../lib/ricobank/src/bank.sol";

contract Bink is Math {
    Bank immutable public bank;
    constructor(Bank _bank) {
        bank  = _bank;
    }

    function bink() public view returns (uint earn, uint flap) {
        uint price = type(uint).max;
        uint dt    = block.timestamp - bank.bel();

        uint joy = bank.joy();
        uint sin = bank.sin() / RAY;

        if (joy <= sin) {
            return (0, 0);
        }

        if (sin > 1) {
            (joy, sin) = heal(sin - 1);
        }

        price = rmul(bank.par() * bank.pex(), rpow(bank.dam(), dt));
        if (price < bank.par() / bank.pex()) price = 0;

        flap = rmul(joy - 1, bank.wel());
        earn = rmul(flap, price);
    }

    function heal(uint wad) internal view returns (uint joy, uint sin)  {
        sin = (bank.sin() - (wad * RAY)) / RAY;
        joy = bank.joy() - wad;
    }

    function bonk(uint allowance, uint maxPrice) external {
        Gem rico = bank.rico();
        Gem risk = bank.risk();

        risk.transferFrom(msg.sender, address(this), allowance);

        uint preRico = rico.balanceOf(address(this));
        uint preRisk = risk.balanceOf(address(this));
        bank.keep();
        uint postRico = rico.balanceOf(address(this));
        uint postRisk = risk.balanceOf(address(this));

        require(postRico - preRico > 0, 'bonk: nothing flapped');
        require(
            rdiv(preRisk - postRisk, postRico - preRico) <= maxPrice,
            'bonk: wrong price'
        );

        rico.transfer(msg.sender, rico.balanceOf(address(this)));
        risk.transfer(msg.sender, risk.balanceOf(address(this)));
    }
}
