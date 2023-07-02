/// SPDX-License-Identifier: AGPL-3.0-or-later

// copyright (c) 2023 halys

pragma solidity ^0.8.19;
import {Vow} from '../lib/ricobank/src/vow.sol';
import {Vat} from '../lib/ricobank/src/vow.sol';
import {File} from '../lib/ricobank/src/file.sol';
import {Vat} from '../lib/ricobank/src/vat.sol';
import {Vow} from '../lib/ricobank/src/vow.sol';

import { ISwapRouter } from './TEMPinterface.sol';
import {Ward} from '../lib/ricobank/lib/feedbase/src/mixin/ward.sol';
import {Math} from '../lib/ricobank/src/mixin/math.sol';
import {Gem} from '../lib/ricobank/lib/gemfab/src/gem.sol';
import {Feedbase} from '../lib/ricobank/lib/feedbase/src/Feedbase.sol';

abstract contract UniSwapper is Ward, Math {
    struct Path {
        bytes fore;
        bytes rear;
    }
    enum SwapKind {EXACT_IN, EXACT_OUT}
    // tokIn -> kind -> Path
    mapping(address tokIn => mapping(address tokOut => Path)) public paths;

    ISwapRouter public router;

    function setPath(address tokIn, address tokOut, bytes calldata fore, bytes calldata rear)
      _ward_ external {
        Path storage path = paths[tokIn][tokOut];
        path.fore = fore;
        path.rear = rear;
    }

    function setSwapRouter(address r)
      _ward_ external {
        router = ISwapRouter(r);
    }

    function _swap(address tokIn, address tokOut, address receiver, uint amt, uint limit)
      internal returns (uint256 result) {
        ISwapRouter.ExactOutputParams memory params =
            ISwapRouter.ExactOutputParams({
                path: paths[tokIn][tokOut].rear,
                recipient: receiver,
                deadline: block.timestamp,
                amountOut: amt,
                amountInMaximum: limit
            });
        return router.exactOutput(params);
    }
}


contract Strat is UniSwapper {
    address payable public bank;
    Gem public rico;
    Gem public risk;
    Feedbase public fb;
    error ErrSwap();
    error ErrBail();
    error ErrFlap();
    error ErrFlop();

    constructor(address payable _bank) {
        bank = _bank;
        rico = File(bank).rico();
        risk = Vow(bank).RISK();
        rico.approve(bank, type(uint).max);
        risk.approve(bank, type(uint).max);
        fb = File(bank).fb();
    }

    function grant() external {
        rico.approve(address(router), type(uint).max);
        risk.approve(address(router), type(uint).max);
    }

    function fill_flip(bytes32 i, address u) external {
        Vat(bank).flash(address(this), abi.encodeWithSelector(
            Strat.flip.selector, i, u, msg.sender
        ));

    }

    function fill_flop() external returns (uint ricogain, uint riskgain) {
        bytes memory data = Vat(bank).flash(address(this), abi.encodeWithSelector(
            Strat.flop.selector, msg.sender
        ));
        (ricogain, riskgain) = abi.decode(data, (uint, uint));
    }

    function fill_flap() external returns (uint ricogain, uint riskgain) {
        bytes memory data = Vat(bank).flash(address(this), abi.encodeWithSelector(
            Strat.flap.selector, msg.sender
        ));
        (ricogain, riskgain) = abi.decode(data, (uint, uint));
    }

    function flip(bytes32 i, address u, address usr) external {
        Vat(bank).drip(i);
        address gem = address(bytes20(Vat(bank).gethi(i, 'gem', i)));
        uint ricobefore = rico.balanceOf(address(this));
        // UPDATE ONCE BAIL IS UPDATED TO DECODE
        uint ink = uint(bytes32(abi.decode(Vat(bank).bail(i, u), (bytes))));

        // swap to replenish what was paid for the flip
        uint ricospent = ricobefore - rico.balanceOf(address(this));
        Gem(gem).approve(address(router), type(uint).max);
        ricobefore = rico.balanceOf(address(this));
        _swap(gem, address(rico), address(this), ricospent, ink);

        // give back the extra funds to caller
        uint ricobal = rico.balanceOf(address(this));
        uint MINT = Vat(bank).MINT();
        if (ricobal < MINT) revert ErrBail();
        rico.transfer(usr, ricobal - MINT);
        Gem(gem).transfer(usr, Gem(gem).balanceOf(address(this)));
    }

    function flap(address usr) external returns (uint ricogain, uint riskgain) {
        uint ricobefore = rico.balanceOf(address(this));
        uint flaprico = rico.balanceOf(address(bank)) - Vat(bank).sin() / RAY;
        uint rush;  uint price;
        {
            uint debt = Vat(bank).debt();
            (uint pep, uint pop) = Vow(bank).flapplot();
            rush = (debt * pop + flaprico * pep) / debt;
            (address flapsrc, bytes32 flaptag) = Vow(bank).flapfeed();
            (bytes32 val,) = fb.pull(flapsrc, flaptag);
            price = uint(val);
        }

        _swap(
            address(rico), address(risk), address(this),
            flaprico * price / rush, rico.balanceOf(address(this))
        );

        bytes32[] memory ilks = new bytes32[](0);
        ricobefore = rico.balanceOf(address(this));
        Vow(bank).keep(ilks);

        uint MINT = Vat(bank).MINT();
        if (rico.balanceOf(address(this)) < MINT) {
            _swap(
                address(risk), address(rico), address(this),
                MINT - rico.balanceOf(address(this)), risk.balanceOf(address(this))
            );
        }

        uint ricobal = rico.balanceOf(address(this));
        if (ricobal < MINT) revert ErrFlap();
        ricogain = ricobal - MINT;
        riskgain = risk.balanceOf(address(this));
        rico.transfer(usr, ricogain);
        risk.transfer(usr, riskgain);
    }

    function flop(address usr) external returns (uint ricogain, uint riskgain) {
        bytes32[] memory ilks = new bytes32[](0);
        uint ricobefore = rico.balanceOf(address(this));
        uint riskbefore = risk.balanceOf(address(this));
        Vow(bank).keep(ilks);
        if (risk.balanceOf(address(this)) == riskbefore) {
            return (0, 0);
        }
        uint ricospent = ricobefore - rico.balanceOf(address(this));

        _swap(
            address(risk), address(rico), address(this),
            ricospent, risk.balanceOf(address(this))
        );

        uint ricobal = rico.balanceOf(address(this));
        uint MINT = Vat(bank).MINT();
        if (ricobal < MINT) revert ErrFlop();

        ricogain = ricobal - MINT;
        riskgain = risk.balanceOf(address(this));
        rico.transfer(usr, ricogain);
        risk.transfer(usr, riskgain);
    }
}


