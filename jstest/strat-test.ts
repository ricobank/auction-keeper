const debug = require('debug')('keeper:test')
import { expect as want } from 'chai'

import * as hh from 'hardhat'
// @ts-ignore
import { ethers, config } from 'hardhat'

import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
const { hexZeroPad } = ethers.utils
const constants = ethers.constants

import { b32, snapshot, revert } from 'minihat'
import { runKeeper, printStats } from '../keeper'

import { Worker } from 'worker_threads'

const dpack = require('@etherpacks/dpack')
const uni_pack = require('../lib/ricobank/lib/uniswapv3/pack/uniswapv3_ethereum.dpack.json')

const bn2b32 = (bn) => hexZeroPad(bn.toHexString(), 32)
const i0 = Buffer.alloc(32) // ilk 0 id
const TAG = Buffer.from('feed'.repeat(16), 'hex')
const hzp = ethers.utils.hexZeroPad
const rpaddr = a => a + '00'.repeat(12)
let worker

let fb, bank, strat, keeper, ploker, weth, rico, dapp, divider
let nfpm, factory, router, risk
let ALI, BOB, CAT

const gettime = async () => {
    const blocknum = await ethers.provider.getBlockNumber()
    return (await ethers.provider.getBlock(blocknum)).timestamp
}

const create_path = (tokens, fees) => {
    if (!tokens.length == fees.length + 1) throw Error('create_path tokens fees length mismatch')

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

const createAndInitializePoolIfNecessary = async (
    ali, factory, token0, token1, fee, sqrtPriceX96?
  ) => {
    if (token1 < token0) {
      let t1 = token1
      token1 = token0
      token0 = t1
      if (sqrtPriceX96) {
        // invert the price
        sqrtPriceX96 = ethers.BigNumber.from(2).pow(96).pow(2).div(sqrtPriceX96)
      }
    }
    let pooladdr = await factory.getPool(token0, token1, fee)

    if (pooladdr == ethers.constants.AddressZero) {
      await send(factory.createPool, token0, token1, fee)
      pooladdr = await factory.getPool(token0, token1, fee)
      const uni_dapp = await dpack.load(
        uni_pack, ethers, ali
      )
      const pool_artifact = await dpack.getIpfsJson(
        uni_dapp._types.UniswapV3Pool.artifact['/']
      )
      const pool = await ethers.getContractAt(pool_artifact.abi, pooladdr, ali)
      await send(
        pool.initialize, sqrtPriceX96 ? sqrtPriceX96 : '0x1' + '0'.repeat(96/4)
      );
    }

    return pooladdr
}


const join_pool = async (args) => {
    let nfpm = args.nfpm
    let ethers = args.ethers
    let ali = args.ali
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
          0, 0, ali.address, timestamp + 1000
    ]);

    await send(nfpm.mint, [
          args.a1.token, args.a2.token,
          args.fee,
          tickLower, tickUpper,
          args.a1.amountIn, args.a2.amountIn,
          0, 0, ali.address, timestamp + 1000
    ]);

    return {tokenId, liquidity, amount0, amount1}
}






describe('keeper', () => {
    let ali, bob, cat
    let amt = wad(10000)
    let DELAY = 1000
    let ricodaitokid
    let dai
    let aue
    let pr
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
        weth = dapp.weth
        rico = dapp.rico
        risk = dapp.risk
        divider = dapp.divider
        nfpm = dapp.nonfungiblePositionManager
        router = dapp.swapRouter
        dai = dapp.dai
        debug(`BANK at ${bank.address}`)

        debug('set weth feed', ALI, b32('weth:ref').toString())
        debug('gem addresses:')
        debug(`    weth:   ${weth.address}`)
        debug(`    dai:    ${dai.address}`)
        debug(`    rico:   ${rico.address}`)
        debug(`    risk:   ${risk.address}`)
        debug(`    wsteth: ${dapp.wsteth.address}`)
        await send(bank.filh, b32('weth'), b32('src'), [], ALI + '00'.repeat(12))
        await send(bank.filh, b32('weth'), b32('tag'), [], b32('weth:ref'))
        await send(bank.filh, b32('weth'), b32('liqr'), [], bn2b32(ray(1)))
        await send(bank.file, b32('rudd.src'), ALI + '00'.repeat(12))
        debug('set strat router+path')
        let {fore, rear} = create_path([weth.address, dai.address, rico.address], [500, 500])
        await send(strat.setPath, weth.address, rico.address, fore, rear);
        ({fore, rear} = create_path([dai.address, rico.address], [500]))
        await send(strat.setPath, dai.address, rico.address, fore, rear);
        ({fore, rear} = create_path([rico.address, risk.address], [3000]))
        await send(strat.setPath, rico.address, risk.address, fore, rear);
        ({fore, rear} = create_path([risk.address, rico.address], [3000]))
        await send(strat.setPath, risk.address, rico.address, fore, rear);

        await send(fb.push, b32('risk:rico'), bn2b32(ray(1)), constants.MaxUint256)
        await send(fb.push, b32('weth:ref'), bn2b32(ray(1)), constants.MaxUint256)

        // answerupdatedemitter
        const aue_artifact = require('../artifacts/src/ProxyReader.sol/AnswerUpdatedEmitter.json')
        const aue_type = ethers.ContractFactory.fromSolidity(aue_artifact, ali)
        aue = await aue_type.deploy()

        const pr_artifact = require('../artifacts/src/ProxyReader.sol/ProxyReader.json')
        const pr_type = ethers.ContractFactory.fromSolidity(pr_artifact, ali)
        pr = await pr_type.deploy(fb.address, ali.address)

        let args = {
          signer: ali,
          pack: './pack/strat_hardhat.dpack.json',
          fliptime: DELAY * 2,
          ilks: 'weth;:uninft',
          aggs: {},
          flip: true
        }

        // map aggregator to (src, tag) pairs
        args.aggs[aue.address] = [{ src: pr.address, tag: 'weth:ref' }]

        await runKeeper(args)

        debug('mint some weth, dai, frob some rico')
        await send(dapp.dai.mint, ALI, amt.mul(10000000))
        await send(weth.approve, bank.address, ethers.constants.MaxUint256)
        await send(weth.mint, BOB, amt.mul(10000000))
        await send(weth.mint, ALI, amt.mul(10000000))
        let dink = ethers.utils.defaultAbiCoder.encode(['int'], [amt.mul(3)])
        await weth.connect(bob).callStatic.approve(bank.address, ethers.constants.MaxUint256)
        await send(weth.connect(bob).approve, bank.address, ethers.constants.MaxUint256, {gasLimit: 10000000})
        await send(bank.connect(bob).frob, b32('weth'), BOB, dink, amt.mul(2), {gasLimit: 100000000})
        await send(rico.connect(bob).transfer, ALI, await rico.balanceOf(BOB), {gasLimit: 100000000})

        debug('calling join pool')
        let joinres = await join_pool({
            nfpm: nfpm, ethers: ethers, ali: ali,
            a1: { token: rico.address, amountIn: amt },
            a2: { token: dai.address, amountIn: amt.mul(2000) },
            fee: 500,
            tickSpacing: 10
        })
        ricodaitokid = joinres.tokenId

        await createAndInitializePoolIfNecessary(
            ali, dapp.uniswapV3Factory, weth.address, dai.address, 500
        )
        await join_pool({
            nfpm: nfpm, ethers: ethers, ali: ali,
            a1: { token: weth.address, amountIn: amt },
            a2: { token: dai.address, amountIn: amt.mul(2000) },
            fee: 500,
            tickSpacing: 10
        })

        dink = ethers.utils.solidityPack(["int256"], [amt])
        await send(rico.approve, bank.address, ethers.constants.MaxUint256)

        await snapshot(hh);
    })

    beforeEach(async () => {
        await revert(hh)
    })

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    it('fill_flip gem', async () => {
        let dink = ethers.utils.defaultAbiCoder.encode(['int'], [amt.mul(2)])
        await send(bank.frob, b32('weth'), ALI, dink, amt)

        await delay(DELAY)
        await send(fb.push, b32('weth:ref'), bn2b32(ray(0.01)), constants.MaxUint256)
        await delay(DELAY * 3)

        let art = await bank.urns(b32('weth'), ALI)
        want(art).eql(ethers.constants.Zero)
    })

    it('fill_flip uni', async () => {
        await delay(3000)
        await send(bank.filk, b32(':uninft'), b32('line'), bn2b32(amt.mul(ray(10))))
        await send(bank.filk, b32(':uninft'), b32('line'), bn2b32(amt.mul(ray(10))))

        await send(bank.filh,
            b32(':uninft'), b32('src'), [rpaddr(dai.address)], rpaddr(ALI)
        )
        await send(bank.filh,
            b32(':uninft'), b32('tag'), [rpaddr(dai.address)], b32('dai:ref')
        )
        await send(bank.filh,
            b32(':uninft'), b32('liqr'), [rpaddr(dai.address)], bn2b32(ray(1))
        )
 
        await send(bank.filh,
            b32(':uninft'), b32('src'), [rpaddr(rico.address)], rpaddr(ALI)
        )
        await send(bank.filh,
            b32(':uninft'), b32('tag'), [rpaddr(rico.address)], b32('ONE')
        )
        await send(bank.filh,
            b32(':uninft'), b32('liqr'), [rpaddr(rico.address)], bn2b32(ray(1))
        )
 
 
        await send(fb.push, b32('dai:ref'), bn2b32(ray(1)), ethers.constants.MaxUint256)
        await send(fb.push, b32('ONE'), bn2b32(ray(1)), ethers.constants.MaxUint256)
        await delay(DELAY * 3)
 
        await send(nfpm.approve, bank.address, ricodaitokid)
        let dink = ethers.utils.defaultAbiCoder.encode(['uint[]'], [[1, ricodaitokid]])
        await send(bank.frob, b32(':uninft'), ALI, dink, amt, {gasLimit: 10000000000})

        await delay(DELAY)
        want(await nfpm.ownerOf(ricodaitokid)).eql(bank.address)
        await send(fb.push, b32('dai:ref'), bn2b32(ray(0.0001)), ethers.constants.MaxUint256)
        await delay(DELAY * 5)
        want(await nfpm.ownerOf(ricodaitokid)).eql(ALI)

    })

    it('fill_flip chainlink gem', async () => {
        await send(bank.filh, b32('weth'), b32('src'), [], rpaddr(pr.address))

        await send(weth.mint, ALI, amt.mul(2))

        let dink = ethers.utils.defaultAbiCoder.encode(['int'], [amt.mul(2)])
        await send(bank.frob, b32('weth'), ALI, dink, amt)

        await delay(DELAY)
        await send(fb.push, b32('weth:ref'), bn2b32(ray(0.01)), constants.MaxUint256)
        await delay(DELAY * 3)

        let art = await bank.urns(b32('weth'), ALI)
        want(art.gt(ethers.constants.Zero)).true

        // only reads the result when answerupdated event emitted
        await send(aue.emitAnswerUpdated)
        await delay(DELAY * 3)
        want(await bank.urns(b32('weth'), ALI)).eql(ethers.constants.Zero)
    })

})
