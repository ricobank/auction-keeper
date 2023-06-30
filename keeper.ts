
import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
import { b32, snapshot, revert } from 'minihat'
const dpack = require('@etherpacks/dpack')

//import * as ethers from 'ethers'

const debug = require('debug')('rico:schedule')
const schedule = async (args) => {
    debug('schedule')
    debug('network name:', args.netname)
    const ali = args.signer
    const ethers = args.ethers
    const pack = require(`./pack/strat_${args.netname}.dpack.json`)
    const dapp = await dpack.load(pack, ethers, ali)
    const bank = dapp.bank
    const strat = dapp.strat
    const mdn = dapp.mdn
    const fb = dapp.feedbase

    await send(dapp.rico.approve, bank.address, ethers.constants.MaxUint256)
    await send(dapp.risk.approve, bank.address, ethers.constants.MaxUint256)

    // initialize sets of urns
    const urns = {}
    args.ilks.split(';').forEach((ilk) => { 
        urns[ethers.utils.hexlify(b32(ilk))] = new Set()
    })

    // listen for frob flog
    const frobsig = 'frob(bytes32,address,bytes,int256)'
    const FLOG_FROB_TOPIC = ethers.utils.id(frobsig)
      .slice(0,10) + '00'.repeat(28)
    const decodeflog = (flog) => {
        const fdata = ethers.utils.defaultAbiCoder.decode(['bytes'], flog.data)[0]
        return bank.interface.decodeFunctionData('frob', fdata)
    }
    bank.on(bank.filters.NewFlog(null, FLOG_FROB_TOPIC), async (flog) => { try {
        let indata = decodeflog(flog)
        const art = await bank.urns(indata.i, indata.u) // TODO PUT BACK
        if (indata.dart > 0) {
            urns[indata.i].add(indata.u)
        }
    } catch (e) { console.error(e); throw e }})


    // check if an ilk's price feed has changed beyond some tolerance
    // if it has, loop through the tracked urns under said ilk,
    // deleting the empty ones, and bailing the sufficiently unsafe ones
    let lastprice = {}
    for (let ilk in urns) {
        lastprice[ilk] = ethers.constants.MaxUint256
    }
    const doilk = async (i) => {
        if (urns[i].size == 0) return
        let fsrc = (await bank.callStatic.gethi(i, b32('fsrc'), i)).slice(0, 42)
        let ftag = await bank.callStatic.gethi(i, b32('ftag'), i)
        let [_curprice, time] = await fb.pull(fsrc, ftag)
        let curprice = ethers.BigNumber.from(_curprice)
        let diff = lastprice[i].sub(curprice).mul(ray(1)).div(lastprice[i])
        if (diff.gt(args.tol)) {
            // feed has changed...check all the currently tracked urns
            lastprice[i] = curprice
            const us = Array.from(urns[i])
            for (let u of us) {
                let art = await bank.urns(i, u)
                if (art == 0) {
                    urns[i].delete(u)
                } else {
                    let [safe, rush, cut] = await bank.callStatic.safe(i, u)
                    if (!safe && rush > args.minrush) {
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

    const doflip = async () => {
        for (let ilk in urns) {
            await doilk(ilk)
        }
    }

    const scheduleflip = async () => {
        try {
            await doflip()
        } catch (e) {
            debug('doflip failed:')
            debug(e)
        }
        setTimeout(scheduleflip, args.fliptime)
    }

    const doflop = async () => {
        let [ricogain, riskgain] = await strat.callStatic.fill_flop()
        if (ricogain > args.expected_rico || riskgain > args.expected_risk) {
            debug("calling fill_flop")
            await send(strat.fill_flop)
            debug("done fill_flop")
        }
    }

    const scheduleflop = async () => {
        try {
            await doflop()
        } catch (e) {
            debug('doflop failed:')
            debug(e)
        }
        setTimeout(scheduleflop, args.floptime)
    }

    const doflap = async () => {
        let [ricogain, riskgain] = await strat.callStatic.fill_flap()
        if (ricogain > args.expected_rico || riskgain > args.expected_risk) {
            debug("calling fill_flap")
            await send(strat.fill_flap)
            debug("done fill_flap")
        }
    }

    const scheduleflap = async () => {
        try {
            await doflap()
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

export { schedule }
