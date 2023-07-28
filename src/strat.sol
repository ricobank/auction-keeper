/// SPDX-License-Identifier: AGPL-3.0-or-later

// copyright (c) 2023 halys

pragma solidity ^0.8.19;
import {Vow} from '../lib/ricobank/src/vow.sol';
import {Vat} from '../lib/ricobank/src/vat.sol';
import {Vox} from '../lib/ricobank/src/vox.sol';
import {File} from '../lib/ricobank/src/file.sol';
import {Ploker} from '../lib/ricobank/lib/feedbase/src/Ploker.sol';

//import { ISwapRouter } from './TEMPinterface.sol';
import {Ward} from '../lib/ricobank/lib/feedbase/src/mixin/ward.sol';
import {Math} from '../lib/ricobank/src/mixin/math.sol';
import {Gem} from '../lib/ricobank/lib/gemfab/src/gem.sol';
import {UniNFTHook} from '../lib/ricobank/src/hook/nfpm/UniV3NFTHook.sol';
import {Feedbase} from '../lib/ricobank/lib/feedbase/src/Feedbase.sol';
import {INonfungiblePositionManager} from './TEMPinterface.sol';

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint deadline) external;
}

interface Permit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

abstract contract UniSwapper is Ward, Math {
    struct Path {
        bytes fore;
        bytes rear;
    }
    enum SwapKind {EXACT_IN, EXACT_OUT}
    // tokIn -> kind -> Path
    mapping(address tokIn => mapping(address tokOut => Path)) public paths;
    address constant public PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    error ErrNoPath();

    IUniversalRouter public router;

    function setPath(address tokIn, address tokOut, bytes calldata fore, bytes calldata rear)
      _ward_ external {
        Path storage path = paths[tokIn][tokOut];
        path.fore = fore;
        path.rear = rear;
    }

    function setSwapRouter(address r)
      _ward_ external {
        router = IUniversalRouter(r);
    }

    function swap(address tokIn, address tokOut, address receiver, uint amt, uint limit)
      public {
        // upper bits 0, lower bits V3_SWAP_EXACT_OUT
        bytes memory commands = abi.encodePacked(bytes1(0x01)); 
        bytes[] memory inputs = new bytes[](1);
        Path memory path = paths[tokIn][tokOut];

        if (path.rear.length == 0) revert ErrNoPath();

        inputs[0] = abi.encode(receiver, amt, limit, path.rear, true);

        try router.execute(commands, inputs, block.timestamp) {}
        catch {
            commands = abi.encodePacked(bytes1(0x00));
            inputs[0] = abi.encode(receiver, limit, 0, path.fore, true);
            try router.execute(commands, inputs, block.timestamp) {}
            catch {}
        }
    }
}


contract Strat is UniSwapper {
    address payable public bank;
    Gem public rico;
    Gem public risk;
    Feedbase public fb;
    Ploker ploker;
    error ErrSwap();
    error ErrBail();
    error ErrFlap();
    error ErrFlop();
    error ErrSrcsTagsLength();
    event FlipFailed(bytes data);
    event Flip(bytes32 i, address u);

    enum FlipType { FLIP_GEM, FLIP_UNI_NFT }
    
    constructor(address payable _bank, Ploker _ploker, address _router) {
        bank = _bank;
        rico = File(bank).rico();
        risk = Vow(bank).RISK();
        rico.approve(bank, type(uint).max);
        risk.approve(bank, type(uint).max);
        fb = File(bank).fb();
        ploker = _ploker;
        router = IUniversalRouter(_router);
        rico.approve(address(router), type(uint).max);
        risk.approve(address(router), type(uint).max);
    }

    function fill_flip(
      bytes32 i,
      address u,
      address[] calldata srcs,
      bytes32[] calldata tags,
      FlipType fliptype
    ) external {
        if (srcs.length != tags.length) revert ErrSrcsTagsLength();
        if (Vox(bank).way() > RAY) { Vox(bank).poke(); }
        for (uint j = 0; j < srcs.length; j++) {
            (,uint ttl) = fb.pull(srcs[j], tags[j]);
            if (ttl < block.timestamp) ploker.ploke(tags[j]);
        }
        bytes memory flipdata = abi.encodeWithSelector(
            Strat.flip.selector, i, u, msg.sender, fliptype
        );
        Vat(bank).flash(address(this), flipdata);
    }

    function fill_flop() external returns (uint ricogain, uint riskgain) {
        bytes memory data = Vat(bank).flash(address(this), abi.encodeWithSelector(
            Strat.flop.selector, msg.sender
        ));
        (ricogain, riskgain) = abi.decode(data, (uint, uint));
    }

    function fill_flap(bytes32[] calldata ilks) external returns (uint ricogain, uint riskgain) {
        bytes memory data = Vat(bank).flash(address(this), abi.encodeWithSelector(
            Strat.flap.selector, msg.sender, ilks
        ));
        (ricogain, riskgain) = abi.decode(data, (uint, uint));
    }

    function _swap_gem(address gem, address usr, uint MINT, bytes memory ink) internal {
        // swap to replenish what was paid for the flip
        uint ricobal = rico.balanceOf(address(this));
        if (ricobal < MINT) {
            Gem(gem).approve(address(PERMIT2), type(uint).max);
            Permit2(PERMIT2).approve(
                gem, address(router), type(uint160).max, uint48(block.timestamp)
            );
            uint need = MINT - ricobal;
            swap(gem, address(rico), address(this), need, uint(bytes32(ink)));
        }

        // give back the extra funds to caller
        ricobal = rico.balanceOf(address(this));
        if (ricobal < MINT) revert ErrBail();

        rico.transfer(usr, ricobal - MINT);
        Gem(gem).transfer(usr, Gem(gem).balanceOf(address(this)));
    }


    function _swap_uni(
      INonfungiblePositionManager nfpm,
      address usr,
      uint MINT,
      bytes memory ink
    ) internal {
        uint[] memory tokenIds = new uint[](ink.length / 32);
        for (uint i = 0; i < ink.length; i += 32) {
            uint tokenId;
            for (uint j = 0; j < 32; j++) {
               tokenId = tokenId + (uint(uint8(ink[i+j])) << ((31 - j) * 8));
            }

            tokenIds[i / 32] = tokenId;

            uint ricobal = rico.balanceOf(address(this));
            if (ricobal < MINT) {
                (,,address t0,address t1,,,,uint128 liquidity,,,,) = nfpm.positions(tokenId);
                nfpm.decreaseLiquidity(
                    INonfungiblePositionManager.DecreaseLiquidityParams(
                        tokenId, liquidity, 0, 0, block.timestamp
                    )
                );
                nfpm.collect(INonfungiblePositionManager.CollectParams(
                    tokenId, address(this), type(uint128).max, type(uint128).max
                ));
 
                Gem(t0).approve(address(PERMIT2), type(uint).max);
                Permit2(PERMIT2).approve(
                    t0, address(router), type(uint160).max, uint48(block.timestamp)
                );
                uint need = MINT - ricobal;
                swap(t0, address(rico), address(this), need, Gem(t0).balanceOf(address(this)));
                ricobal = rico.balanceOf(address(this));
                if (ricobal < MINT) {
                    Gem(t1).approve(address(PERMIT2), type(uint).max);
                    Permit2(PERMIT2).approve(
                        t1, address(router), type(uint160).max, uint48(block.timestamp)
                    );
                    need = MINT - ricobal;
                    swap(t1, address(rico), address(this), need, uint(bytes32(ink)));
                }
                if (t0 != address(rico)) Gem(t0).transfer(usr, Gem(t0).balanceOf(address(this)));
                if (t1 != address(rico)) Gem(t1).transfer(usr, Gem(t1).balanceOf(address(this)));
            }

            nfpm.transferFrom(address(this), usr, tokenId);
        }
    }


    function flip(
        bytes32 i,
        address u,
        address usr,
        FlipType fliptype
    ) external {
        // UPDATE ONCE BAIL IS UPDATED TO DECODE
        bytes memory ink = abi.decode(Vat(bank).bail(i, u), (bytes));
        uint MINT = Vat(bank).MINT();
        if (fliptype == FlipType.FLIP_GEM) {
            address gem = address(bytes20(Vat(bank).gethi(i, 'gem', i)));
            _swap_gem(gem, usr, MINT, ink);
        } else if (fliptype == FlipType.FLIP_UNI_NFT) {
            INonfungiblePositionManager nfpm = INonfungiblePositionManager(
                address(bytes20(Vat(bank).geth(i, 'nfpm')))
            );
            _swap_uni(nfpm, usr, MINT, ink);
        }
        uint ricobal = rico.balanceOf(address(this));
        if (ricobal > MINT) rico.transfer(usr, ricobal - MINT);
    }

    function flap(address usr, bytes32[] calldata ilks) external returns (uint ricogain, uint riskgain) {
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

        rico.approve(address(PERMIT2), type(uint).max);
        Permit2(PERMIT2).approve(address(rico), address(router), type(uint160).max, uint48(block.timestamp));
        swap(
            address(rico), address(risk), address(this),
            flaprico * price / rush, rico.balanceOf(address(this))
        );

        ricobefore = rico.balanceOf(address(this));
        Vow(bank).keep(ilks);

        uint MINT = Vat(bank).MINT();
        if (rico.balanceOf(address(this)) < MINT) {
            risk.approve(address(PERMIT2), type(uint).max);
            Permit2(PERMIT2).approve(address(risk), address(router), type(uint160).max, uint48(block.timestamp));
            swap(
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

        risk.approve(address(PERMIT2), type(uint).max);
        Permit2(PERMIT2).approve(address(risk), address(router), type(uint160).max, uint48(block.timestamp));
        swap(
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



