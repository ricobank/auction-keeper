const debug = require('debug')('keeper:test')
import { expect as want } from 'chai'

import * as hh from 'hardhat'
// @ts-ignore
import { ethers, config } from 'hardhat'

import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
const { hexZeroPad } = ethers.utils

import { b32, snapshot, revert } from 'minihat'
import { run_keeper, create_path, join_pool } from '../keeper'

import { Worker } from 'worker_threads'

const dpack = require('@etherpacks/dpack')

const bn2b32 = (bn) => hexZeroPad(bn.toHexString(), 32)
const i0 = Buffer.alloc(32) // ilk 0 id
const TAG = Buffer.from('feed'.repeat(16), 'hex')
const hzp = ethers.utils.hexZeroPad
const rpaddr = a => a + '00'.repeat(12)
let worker

let fb, bank, strat, keeper, ploker, weth, rico, mdn, dapp, divider
let nfpm, factory, router, risk
let ALI, BOB, CAT

const gettime = async () => {
    const blocknum = await ethers.provider.getBlockNumber()
    return (await ethers.provider.getBlock(blocknum)).timestamp
}

describe('keeper', () => {
    let ali, bob, cat
    let amt = wad(10000)
    let DELAY = 1000
    let ricodaitokid
    let dai
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
        risk = dapp.risk
        mdn = dapp.mdn
        divider = dapp.divider
        nfpm = dapp.nonfungiblePositionManager
        router = dapp.swapRouter
        dai = dapp.dai
        debug(`BANK at ${bank.address}`)

        debug('set weth feed', ALI, b32('weth:rico').toString(), mdn.address)
        debug('gem addresses:')
        debug(`    weth:   ${weth.address}`)
        debug(`    dai:    ${dai.address}`)
        debug(`    rico:   ${rico.address}`)
        debug(`    risk:   ${risk.address}`)
        debug(`    wsteth: ${dapp.wsteth.address}`)
        await send(bank.filhi, b32('weth'), b32('fsrc'), b32('weth'), ALI + '00'.repeat(12))
        await send(bank.file, b32('flapsrc'), ALI + '00'.repeat(12))
        await send(bank.file, b32('flopsrc'), ALI + '00'.repeat(12))
        debug('set strat router+path')
        let {fore, rear} = create_path([weth.address, dai.address, rico.address], [500, 500])
        await send(strat.setPath, weth.address, rico.address, fore, rear);
        ({fore, rear} = create_path([dai.address, rico.address], [500]))
        await send(strat.setPath, dai.address, rico.address, fore, rear);
        ({fore, rear} = create_path([rico.address, risk.address], [3000]))
        await send(strat.setPath, rico.address, risk.address, fore, rear);
        ({fore, rear} = create_path([risk.address, rico.address], [3000]))
        await send(strat.setPath, risk.address, rico.address, fore, rear);

        await send(fb.push, b32('risk:rico'), bn2b32(ray(1)), await gettime() * 2)
        await send(fb.push, b32('rico:risk'), bn2b32(ray(1)), await gettime() * 2)
        await send(fb.push, b32('weth:rico'), bn2b32(ray(1)), await gettime() * 2)

        let args = {
          signer: ali,
          netname: hh.network.name,
          fliptime: DELAY,
          floptime: DELAY * 2,
          flaptime: DELAY * 2,
          ilks: 'weth;:uninft',
          tol: ray(0.1),
          minprofit: wad(5),
          expected_rico: wad(10),
          expected_risk: wad(10),
          poketime: '100'
        }

        await run_keeper(args)

        debug('mint some weth and rico, pull some dai from bot')

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


        debug('calling join pool')
        await send(weth.approve, bank.address, ethers.constants.MaxUint256)
        await send(weth.deposit, {value: amt.mul(4)})
        await send(weth.transfer, BOB, amt.mul(4))
        let dink = ethers.utils.solidityPack(["int256"], [amt.mul(2)])
        await weth.connect(bob).callStatic.approve(bank.address, ethers.constants.MaxUint256)
        await send(weth.connect(bob).approve, bank.address, ethers.constants.MaxUint256, {gasLimit: 10000000})
        await send(bank.connect(bob).frob, b32('weth'), BOB, dink, amt.mul(2), {gasLimit: 100000000})
        await send(rico.connect(bob).transfer, ALI, await rico.balanceOf(BOB), {gasLimit: 100000000})

        let joinres = await join_pool({
            nfpm: nfpm, ethers: ethers, ali: ali,
            a1: { token: rico.address, amountIn: amt },
            a2: { token: dai.address, amountIn: amt },
            fee: 500,
            tickSpacing: 10
        })
        ricodaitokid = joinres.tokenId
        dink = ethers.utils.solidityPack(["int256"], [amt])
        await send(risk.mint, ALI, amt)
        await join_pool({
            nfpm: nfpm, ethers: ethers, ali: ali,
            a1: { token: rico.address, amountIn: amt },
            a2: { token: risk.address, amountIn: amt },
            fee: 3000,
            tickSpacing: 60
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
        await revert(hh)
    })

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    it('fill_flip gem', async () => {

        await send(weth.deposit, {value: amt})

        let dink = ethers.utils.solidityPack(["int256"], [amt])
        await send(bank.frob, b32('weth'), ALI, dink, amt)

        await delay(DELAY)
        await send(fb.push, b32('weth:rico'), bn2b32(ray(0.5)), await gettime() * 2)
        // TODO maybe use events?
        await delay(DELAY * 3)

        let art = await bank.urns(b32('weth'), ALI)
        want(art).eql(ethers.constants.Zero)
    })

    it('fill_flop', async () => {


        await send(weth.deposit, {value: amt})

        let dink = ethers.utils.solidityPack(["int256"], [amt])
        let riskbefore = await risk.balanceOf(ALI)
        await send(bank.frob, b32('weth'), ALI, dink, amt)
        await send(fb.push, b32('weth:rico'), bn2b32(ray(0)), await gettime() * 2)
        await send(bank.bail, b32('weth'), ALI)
        await delay(DELAY * 5)

        want((await risk.balanceOf(ALI)).gt(riskbefore)).true
    })

    it('fill_flap_pop', async () => {
        await send(bank.file, b32('flappop'), bn2b32(ray(2)))

        await send(weth.deposit, {value: amt})

        let dink = ethers.utils.solidityPack(["int256"], [amt])
        await send(bank.frob, b32('weth'), ALI, dink, amt)

        await mine(hh, BANKYEAR)
        let ricobefore = await rico.balanceOf(ALI)
        await send(bank.drip, b32('weth'))
        await delay(DELAY * 2)
        want((await rico.balanceOf(ALI)).gt(ricobefore)).true
    })

    it('fill_flap_pep', async () => {
        let pep = ray(20)
        await send(bank.file, b32('flappep'), bn2b32(pep))

        await send(weth.deposit, {value: amt})

        let dink = ethers.utils.solidityPack(["int256"], [amt])
        await send(bank.frob, b32('weth'), ALI, dink, amt)

        await mine(hh, BANKYEAR)
        let ricobefore = await rico.balanceOf(ALI)
        await send(bank.drip, b32('weth'))
        await delay(DELAY * 2)
        want((await rico.balanceOf(ALI)).gt(ricobefore)).true
    })

    it('fill_flip uni', async () => {
        await delay(2000)
        await send(bank.filk, b32(':uninft'), b32('line'), bn2b32(amt.mul(ray(10))))
        await send(bank.filhi2,
            b32(':uninft'), b32('fsrc'), b32(':uninft'), rpaddr(dai.address), rpaddr(ALI)
        )
        await send(bank.filhi2,
            b32(':uninft'), b32('ftag'), b32(':uninft'), rpaddr(dai.address), b32('dai:rico')
        )
        await send(bank.filhi2,
            b32(':uninft'), b32('fsrc'), b32(':uninft'), rpaddr(rico.address), rpaddr(ALI)
        )
        await send(bank.filhi2,
            b32(':uninft'), b32('ftag'), b32(':uninft'), rpaddr(rico.address), b32('ONE')
        )
 
        await send(fb.push, b32('dai:rico'), bn2b32(ray(1)), ethers.constants.MaxUint256)
        await send(fb.push, b32('ONE'), bn2b32(ray(1)), ethers.constants.MaxUint256)
        await delay(DELAY * 2)
 
        await send(nfpm.approve, bank.address, ricodaitokid)
        let dink = ethers.utils.solidityPack(['uint', 'uint'], [1, ricodaitokid])
        await send(bank.frob, b32(':uninft'), ALI, dink, amt.mul(3).div(2))

        await delay(DELAY)
        want(await nfpm.ownerOf(ricodaitokid)).eql(bank.address)
        await send(fb.push, b32('dai:rico'), bn2b32(ray(0.001)), ethers.constants.MaxUint256)
        await delay(DELAY * 5)
        want(await nfpm.ownerOf(ricodaitokid)).eql(ALI)
    })

    /*
    after(async () => {
        await delay(DELAY)
        process.exit()
    })
   */
})
