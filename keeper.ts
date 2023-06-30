
import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
import { b32, snapshot, revert } from 'minihat'
const dpack = require('@etherpacks/dpack')
import * as ethers from 'ethers'

let pack, dapp
let bank, strat
let mdn, fb, ploker
let ali
let urns = {}
let lastprice = {}

// listen for frob flog
const frobsig = 'frob(bytes32,address,bytes,int256)'
const FROB_TOPIC = ethers.utils.id(frobsig)
  .slice(0,10) + '00'.repeat(28)
const decodefrob = (flog) => {
    const fdata = ethers.utils.defaultAbiCoder.decode(['bytes'], flog.data)[0]
    return bank.interface.decodeFunctionData('frob', fdata)
}
const processfrob = async (flog) => {
    try {
        let indata = decodefrob(flog)
        const art = await bank.urns(indata.i, indata.u) // TODO PUT BACK
        if (indata.dart > 0) {
            urns[indata.i].add(indata.u)
        }
    } catch (e) { 
        console.error(e)
        throw e 
    }
}

const onfrob = () => {
    bank.on(bank.filters.NewFlog(null, FROB_TOPIC), async (flog) => { 
        await processfrob(flog)
    })
}

// listen for bail flog
const bailsig = 'bail(bytes32,address)'
const BAIL_TOPIC = ethers.utils.id(bailsig)
  .slice(0,10) + '00'.repeat(28)
const decodebail = (flog) => {
    const fdata = ethers.utils.defaultAbiCoder.decode(['bytes'], flog.data)[0]
    return bank.interface.decodeFunctionData('bail', fdata)
}
const processbail = (flog) => {
    try {
        let indata = decodebail(flog)
        urns[indata.i].delete(indata.u)
    } catch (e) {
        console.error(e)
        throw e
    }
}

const onbail = () => {
    bank.on(bank.filters.NewFlog(null, BAIL_TOPIC), async (flog) => {
        processbail(flog)
    })
}

const gettime = async () => {
    return (await ali.provider.getBlock('latest')).timestamp
}

// check if an ilk's price feed has changed beyond some tolerance
// if it has, loop through the tracked urns under said ilk,
// deleting the empty ones, and bailing the sufficiently unsafe ones
const scanilk = async (i, tol, minrush) => {
    if (urns[i].size == 0) return

    // src and tag of feed to pull from
    let fsrc = (await bank.callStatic.gethi(i, b32('fsrc'), i)).slice(0, 42)
    let ftag = await bank.callStatic.gethi(i, b32('ftag'), i)

    let [_curprice, time] = await fb.pull(fsrc, ftag)
    let curprice = ethers.BigNumber.from(_curprice)
    if (time < Math.ceil(Date.now() / 1000)) {
        await ploker.ploke(ftag)
    }

    let diff = lastprice[i].sub(curprice).mul(ray(1)).div(lastprice[i])
    if (diff.abs().gt(tol)) {
        // feed has changed...check all the currently tracked urns
        lastprice[i] = curprice
        if (diff.gt(0)) {
            const us = Array.from(urns[i])
            for (let u of us) {
                let art = await bank.urns(i, u)
                if (art == 0) {
                    urns[i].delete(u)
                } else {
                    let [safe, rush, cut] = await bank.callStatic.safe(i, u)
                    if (!safe && rush > minrush) {
                        debug("send fill_flip")
                        try {
                            await send(strat.fill_flip, i, u)
                            debug("done fill_flip")
                        } catch (e) {
                            debug('failed fill_flip')
                            debug(e)
                        }
                    }
                }
            }
        }
    }
}

const debug = require('debug')('rico:schedule')
const schedule = async (args) => {
    debug('schedule')
    debug('network name:', args.netname)
    ali = args.signer
    if (!ali) {
        const provider = new ethers.providers.JsonRpcProvider(args.url)
        ali = ethers.Wallet.fromMnemonic(args.mnemonic).connect(provider)
    }

    pack = require(`./pack/strat_${args.netname}.dpack.json`)
    dapp = await dpack.load(pack, ethers, ali)
    bank = dapp.bank
    strat = dapp.strat
    mdn = dapp.mdn
    fb = dapp.feedbase
    ploker = dapp.ploker

    await send(dapp.rico.approve, bank.address, ethers.constants.MaxUint256)
    await send(dapp.risk.approve, bank.address, ethers.constants.MaxUint256)

    // initialize sets of urns
    args.ilks.split(';').forEach((ilk) => { 
        urns[ethers.utils.hexlify(b32(ilk))] = new Set()
    })

    for (let ilk in urns) {
        lastprice[ilk] = ethers.constants.MaxUint256
    }

    onfrob()
    onbail()

    const scheduleflip = async () => {
        try {
            for (let ilk in urns) {
                await scanilk(ilk, args.tol, args.minrush)
            }
        } catch (e) {
            debug('doflip failed:')
            debug(e)
        }
        setTimeout(scheduleflip, args.fliptime)
    }

    const scheduleflop = async () => {
        try {
            let [ricogain, riskgain] = await strat.callStatic.fill_flop()
            if (ricogain > args.expected_rico || riskgain > args.expected_risk) {
                debug("calling fill_flop")
                await send(strat.fill_flop)
                debug("done fill_flop")
            }
        } catch (e) {
            debug('doflop failed:')
            debug(e)
        }
        setTimeout(scheduleflop, args.floptime)
    }

    const scheduleflap = async () => {
        try {
            let [ricogain, riskgain] = await strat.callStatic.fill_flap()
            if (ricogain > args.expected_rico || riskgain > args.expected_risk) {
                debug("calling fill_flap")
                await send(strat.fill_flap)
                debug("done fill_flap")
            }
        } catch (e) {
            debug('doflap failed:')
            debug(e)
        }
        setTimeout(scheduleflap, args.flaptime)
    }

    if (args.fliptime) scheduleflip()
    if (args.flaptime) scheduleflop()
    if (args.floptime) scheduleflap()

}

const reseturns = () => {
    for (let i in urns) {
        urns[i] = new Set()
    }
}

const fillurns = async () => {
    let flogs = await bank.queryFilter(bank.filters.NewFlog(null, FROB_TOPIC))
    for (let flog of flogs) await processfrob(flog)

    flogs = await bank.queryFilter(bank.filters.NewFlog(null, BAIL_TOPIC))
    for (let flog of flogs) await processbail(flog)

}

const geturns = () => urns

export { schedule, reseturns, urns, fillurns, geturns }
