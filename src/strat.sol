/// SPDX-License-Identifier: AGPL-3.0

pragma solidity 0.8.20;
import {Vow} from './lib/ricobank/src/vow.sol';
import {Vat} from './lib/ricobank/src/vow.sol';
import {File} from './lib/ricobank/src/file.sol';
import {Vat} from './lib/ricobank/src/vat.sol';
import {Vow} from './lib/ricobank/src/vow.sol';

// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.8.19;

import { ISwapRouter } from './TEMPinterface.sol';
import './mixin/ward.sol';

abstract contract UniSwapper is Ward {
    struct Path {
        bytes fore;
        bytes rear;
    }
    enum SwapKind {EXACT_IN, EXACT_OUT}
    // tokIn -> kind -> Path
    mapping(address tokIn => mapping(address tokOut => Path)) public paths;

    uint256 public constant SWAP_ERR = type(uint256).max;

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

    function _swap(address tokIn, address tokOut, address receiver, SwapKind kind, uint amt, uint limit)
            internal returns (uint256 result) {
        if (kind == SwapKind.EXACT_IN) {
            ISwapRouter.ExactInputParams memory params =
                ISwapRouter.ExactInputParams({
                    path : paths[tokIn][tokOut].fore,
                    recipient : receiver,
                    deadline : block.timestamp,
                    amountIn : amt,
                    amountOutMinimum : limit
                });
            try router.exactInput(params) returns (uint res) {
                result = res;
            } catch {
                result = SWAP_ERR;
            }
        } else {
            ISwapRouter.ExactOutputParams memory params =
                ISwapRouter.ExactOutputParams({
                    path: paths[tokIn][tokOut].rear,
                    recipient: receiver,
                    deadline: block.timestamp,
                    amountOut: amt,
                    amountInMaximum: limit
                });

            try router.exactOutput(params) returns (uint res) {
                result = res;
            } catch {
                result = SWAP_ERR;
            }
        }
    }
}


contract Strat is UniSwapper, Math {
    address payable public bank;
    address rico;
    error ErrSwap();
    error ErrBail();

    constructor(address payable bank, address risk) {
        rico = File(bank).rico();
        rico.approve(bank, type(uint).max);
        Gem(risk).approve(bank, type(uint).max);
    }

    function fill_flip(bytes32 i, address u) external {
        return Vat(bank).flash(address(this), abi.encodeWithSelector(
            Strat.bail.selector, i, u, Vat(bank).MINT(), msg.sender
        );
    }

    function fill_flop(bytes32[] calldata ilks) external {
        Vat(bank).flash(address(this), abi.encodeWithSelector(
            Strat.flop.selector, ilks
        );
    }

    function bail(bytes32 i, address u, uint amt, uint usr) external {
        Vat(bank).drip(i);
        address gem = abi.decode(Vat(bank).gethi('gem', i), (address));
        uint ricobefore = Gem(rico).balanceOf(address(this);
        Vow(bank).bail(i, u);

        // swap to replenish what was paid for the flip
        uint ricospent = Gem(rico).balanceOf(address(this)) - ricobefore;;
        uint ink = abi.decode(Vat(bank).ink(i, u), (uint));
        uint res = _swap(gem, rico, SwapKind.EXACT_OUT, ricospent, ink);
        if (res == SWAP_ERR) revert ErrSwap();

        // give back the extra funds to caller
        uint ricobal = rico.balanceOf(address(this));
        if (ricobal < amt) revert ErrBail();
        Gem(rico).transfer(usr, amt - ricobal);
        Gem(gem).transfer(usr, Gem(gem).balanceOf(address(this)));
    }

}


