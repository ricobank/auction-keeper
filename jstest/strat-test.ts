const debug = require('debug')('rico:test')
import { expect as want } from 'chai'

import * as hh from 'hardhat'
// @ts-ignore
import { ethers } from 'hardhat'

import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
const { hexZeroPad } = ethers.utils

import { b32, snapshot, revert } from 'minihat'

import { Worker } from 'worker_threads'

const dpack = require('@etherpacks/dpack')

const bn2b32 = (bn) => hexZeroPad(bn.toHexString(), 32)
const i0 = Buffer.alloc(32) // ilk 0 id
const TAG = Buffer.from('feed'.repeat(16), 'hex')
let worker

let fb, bank, strat, keeper, ploker, weth, rico, mdn, dapp, divider
let nfpm, factory, router
let ALI, BOB, CAT

const create_path = (tokens, fees) => {
    want(tokens.length).eql(fees.length + 1)

    let fore = '0x'
    let rear = '0x'
    for (let i = 0; i < tokens.length - 1; i++) {
      fore = ethers.utils.solidityPack(
          ['bytes', 'address', 'uint24'], [fore, tokens[i], fees[i]]
      );
    }
    fore = ethers.utils.solidityPack(
      ['bytes', 'address'], [fore, tokens[tokens.length - 1]]
    );

    rear = ethers.utils.solidityPack(
      ['bytes', 'address'], [rear, tokens[tokens.length - 1]]
    );
    for (let j = tokens.length - 1; j > 0; j--) {
      rear = ethers.utils.solidityPack(
          ['bytes', 'uint24', 'address'], [rear, fees[j - 1], tokens[j - 1]]
      );
    }

    return {fore, rear}
}

const gettime = async () => {
    const blocknum = await ethers.provider.getBlockNumber()
    return (await ethers.provider.getBlock(blocknum)).timestamp
}

const join_pool = async (args) => {
    debug('join_pool')
    if (ethers.BigNumber.from(args.a1.token).gt(ethers.BigNumber.from(args.a2.token))) {
      let a = args.a1;
      args.a1 = args.a2;
      args.a2 = a;
    }

    let spacing = args.tickSpacing;
    let tickmax = 887220
    // full range liquidity
    let tickLower = -tickmax;
    let tickUpper = tickmax;
    let token1 = await ethers.getContractAt('Gem', args.a1.token)
    let token2 = await ethers.getContractAt('Gem', args.a2.token)
    debug('approve tokens ', args.a1.token, args.a2.token)
    await send(token1.approve, nfpm.address, ethers.constants.MaxUint256);
    await send(token2.approve, nfpm.address, ethers.constants.MaxUint256);
    let timestamp = await gettime()
    debug('nfpm mint')
    let [tokenId, liquidity, amount0, amount1] = await nfpm.callStatic.mint([
          args.a1.token, args.a2.token,
          args.fee,
          tickLower, tickUpper,
          args.a1.amountIn, args.a2.amountIn,
          0, 0, ALI, timestamp + 1000
    ]);

    await send(nfpm.mint, [
          args.a1.token, args.a2.token,
          args.fee,
          tickLower, tickUpper,
          args.a1.amountIn, args.a2.amountIn,
          0, 0, ALI, timestamp + 1000
    ]);

    return {tokenId, liquidity, amount0, amount1}
}

describe('keeper', () => {
    let ali, bob, cat
    let amt = wad(10000)
    before(async () => {
        [ali, bob, cat] = await ethers.getSigners();
        [ALI, BOB, CAT] = [ali, bob, cat].map(signer => signer.address)
        const pack = await hh.run(
            'deploy-strat',
            {
                mock: 'true', netname: 'ethereum', writepack: 'true',
                tokens: './tokens.json'
            }
        )
        dapp = await dpack.load(pack, ethers, ali)

        fb = dapp.feedbase
        bank = dapp.bank
        strat = dapp.strat
        ploker = dapp.ploker
        weth = await ethers.getContractAt('WethLike', dapp.weth.address)
        rico = dapp.rico
        mdn = dapp.mdn
        divider = dapp.divider
        nfpm = dapp.nonfungiblePositionManager
        router = dapp.swapRouter

        await hh.run(
          'schedule',
          {
              fliptime: '5000',
              floptime: '5000',
              flaptime: '2500',
              ilks: 'weth',
              tol: ray(0.1),
              minrush: ray(1.2)
          }
        )

        let {fore, rear} = create_path(
          [weth.address, dapp.dai.address, rico.address], [500, 500]
        )


        debug('set strat path and router')
        await send(strat.setPath, weth.address, rico.address, fore, rear)
        await send(strat.setSwapRouter, dapp.swapRouter.address)

        debug('set weth feed')
        await send(bank.filhi, b32('weth'), b32('fsrc'), b32('weth'), ALI + '00'.repeat(12))
        await send(fb.push, b32('weth:rico'), bn2b32(ray(1)), await gettime() * 2)

        debug('mint some weth and rico, pull some dai from bot')
        let dink = ethers.utils.solidityPack(["int256"], [amt])

        const botaddr = "0xA69babEF1cA67A37Ffaf7a485DfFF3382056e78C"
        await hh.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [botaddr]
        });
        const botsigner = await ethers.getSigner("0xA69babEF1cA67A37Ffaf7a485DfFF3382056e78C")
        await send(dapp.dai.connect(botsigner).transfer, ALI, amt)
        await hh.network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [botaddr]
        });


        debug('join pool')
        await send(weth.approve, bank.address, ethers.constants.MaxUint256)
        await send(weth.deposit, {value: amt})
        await send(bank.frob, b32('weth'), ALI, dink, amt)
        await join_pool({
            a1: { token: rico.address, amountIn: amt },
            a2: { token: dapp.dai.address, amountIn: amt },
            fee: 500,
            tickSpacing: 10
        })

        await send(rico.approve, bank.address, ethers.constants.MaxUint256)

        /*
        await send(bank.file, b32("tag"), TAG)
        await send(bank.link, b32("tip"), ALI)

        await send(bank.file, b32("cap"), b32(ray(3)))

        await send(bank.file, b32('par'), b32(wad(7)))
         */

        await snapshot(hh);
    })

    beforeEach(async () => {
        await revert(hh);
    })

    it('fill_flip', async () => {

        await send(weth.deposit, {value: amt})
        await send(weth.approve, bank.address, ethers.constants.MaxUint256)
        await send(ploker.ploke, b32('weth:rico'))

        let dink = ethers.utils.solidityPack(["int256"], [amt])
        await send(bank.frob, b32('weth'), ALI, dink, amt)

        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

        await delay(5000)
        await send(fb.push, b32('weth:rico'), bn2b32(ray(0.5)), await gettime() * 2)
        await delay(5000)

        let art = await bank.urns(b32('weth'), ALI)
        want(art).eql(ethers.constants.Zero)
    })
})
