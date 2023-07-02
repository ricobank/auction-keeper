
import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
import { b32, snapshot, revert } from 'minihat'
const dpack = require('@etherpacks/dpack')
import * as ethers from 'ethers'

let pack, dapp
let bank, strat
let mdn, fb, ploker
let ali
let ilkinfos : IlkInfos = {}
type BigNumber = ethers.BigNumber
const BigNumber = ethers.BigNumber

let par : BigNumber

type Ilk = string
type Address = `0x${string}`

type Urn = {
    ink : BigNumber;
    art : BigNumber;
}
type Urns = {[key: Address]: Urn}

type IlkInfo = {
    fsrc: Address;
    ftag: string;
    price: BigNumber;
    urns: Urns;

    // to quickly calculate expected profit
    rack: BigNumber;
    liqr: BigNumber;
    fee: BigNumber;
    chop: BigNumber;
}

type IlkInfos = {[key: Ilk]: IlkInfo}

const xtos = (_ilk) : string => {
    let ilk = _ilk
    if (typeof(_ilk) == 'string') {
        ilk = Buffer.from(_ilk.slice(2), 'hex')
    }
    let last = ilk.indexOf(0)
    let sliced = last == -1 ? ilk : ilk.slice(0, last)
    return sliced.toString('utf8')
}

// listen for frob flog
const sigs = {
    frob: 'frob(bytes32,address,bytes,int256)',
    bail: 'bail(bytes32,address)',
    file: 'file(bytes32,bytes32)',
    filk: 'filk(bytes32,bytes32,uint256)',
    init: 'init(bytes32,address)'
}
const topic = (name) => ethers.utils.id(sigs[name]).slice(0,10) + '00'.repeat(28)


const processflog = (flog) => {
    const sig = flog.topics[1]
    const fdata = ethers.utils.defaultAbiCoder.decode(['bytes'], flog.data)[0]
    if (sig == topic('frob')) {
        const indata = bank.interface.decodeFunctionData('frob', fdata)
        const i = xtos(indata.i)
        const u = indata.u
        const dink = ethers.utils.defaultAbiCoder.decode(['int'], indata.dink)[0]
        const dart = BigNumber.from(indata.dart)
        let info = ilkinfos[i]
        if (dink.eq(0) && dart.eq(0)) return

        if (info.urns[u] == undefined) {
            info.urns[u] = {
                ink: ethers.constants.Zero,
                art: ethers.constants.Zero
            }
        }
        let urn = info.urns[u]
        urn.ink = urn.ink.add(dink)
        urn.art = urn.ink.add(dart)
    } else if (sig == topic('bail')) {
        const indata = bank.interface.decodeFunctionData('bail', fdata)
        const ilk = xtos(indata.i)
        ilkinfos[ilk].urns[indata.u] = {
            ink: ethers.constants.Zero,
            art: ethers.constants.Zero
        }
    } else if (sig == topic('file')) {
        const indata = bank.interface.decodeFunctionData('file', fdata)
        const key = xtos(indata.key)
        if (key == 'par') {
            par = BigNumber.from(indata.val)
        }
    } else if (sig == topic('filk')) {
        const indata = bank.interface.decodeFunctionData('filk', fdata)
        const key = xtos(indata.key)
        const i = xtos(indata.ilk)
        let info = ilkinfos[i]
        if (!info) return
        const val = indata.val
        switch (key) {
            case 'line':
            case 'rack':
            case 'fee':
            case 'chop': {
                info[key] = BigNumber.from(val)
                break
            }
            default: break
        }
    } else if (sig == topic('init')) {
        const indata = bank.interface.decodeFunctionData('init', fdata)
        const i = xtos(indata.ilk)
        let info = ilkinfos[i]
        if (!info) return
        info.rack = ray(1)
        info.liqr = ray(1)
        info.fee = ray(1)
        info.chop = ethers.constants.Zero
    }
}

const processinit = (flog) => {
    const fdata = ethers.utils.defaultAbiCoder.decode(['bytes'], flog.data)[0]
    const indata = bank.interface.decodeFunctionData('init', fdata)
    const i = xtos(indata.ilk)
    let info = ilkinfos[i]
    if (!info) return
    info.rack = ray(1)
    info.liqr = ray(1)
    info.fee = ray(1)
    info.chop = ethers.constants.Zero
}

const gettime = async () => {
    return (await ali.provider.getBlock('latest')).timestamp
}

const profitable = (i :string, sell :BigNumber, earn :BigNumber) => {
    // TODO expand
    return sell.gt(0)
}

// check if an ilk's price feed has changed beyond some tolerance
// if it has, loop through the tracked urns under said ilk,
// deleting the empty ones, and bailing the sufficiently unsafe ones
const scanilk = async (i :string, tol, minrush, poketime) => {
    let info :IlkInfo = ilkinfos[i]
    if (Object.keys(info.urns).length == 0) return []
    let fsrc = info.fsrc
    let ftag = info.ftag

    let [_curprice, feedtime] = await fb.pull(fsrc, ftag)
    let curprice = BigNumber.from(_curprice)
    let curtime = Math.ceil(Date.now() / 1000)
    /*
    if (feedtime < curtime) {
        await send(ploker.ploke, ftag)
    }

    if (curtime - await bank.tau() > poketime) {
        try {
            await ploker.ploke(ftag)
        } catch (e) {
            console.error(e)
        }
        await send(bank.poke, {gasLimit: 100000000})
    }
   */

    let diff = info.price.sub(curprice).mul(ray(1)).div(info.price)
    let proms = []
    if (diff.abs().gt(tol)) {
        // feed has changed...check all the currently tracked urns
        info.price = curprice
        if (diff.gt(0)) {
            for (let u in info.urns) {
                let urn = info.urns[u]
                //let [safe, rush, cut] = await bank.callStatic.safe(b32(i), u)
                let rush
                // div by ray once for each rmul in vat safe
                debug(`checking urn (${i},${u}): ink=${urn.ink}, art=${urn.art}`)
                debug(`    par=${par}, rack=${info.rack}, liqr=${info.liqr}`)
                let tab = urn.art.mul(par).mul(info.rack).mul(info.liqr).div(ray(1).pow(2))
                let cut = urn.ink.mul(info.price)
                debug(`    tab=${tab}, cut=${cut}, so it's ${tab.gt(cut) ? 'not ': ''}safe`)
                if (tab.gt(cut)) {
                    // unsafe
                    rush = tab.div(cut).mul(ray(1))
                    debug(`    rush=${rush}, minrush=${minrush}`)
                    if (rush.gt(minrush)) {
                        // check expected profit
                        let bill = info.chop.mul(urn.art).mul(info.rack).div(ray(1).pow(2))
                        let earn = cut.div(rush)
                        let sell = urn.ink
                        if (earn.gt(bill)) {
                            sell = bill.mul(sell).div(earn);
                            earn = bill
                        }

                        if (profitable(i, sell, earn)) {
                            proms.push(new Promise(async (resolve, reject) => {
                                let res
                                try {
                                    res = await strat.fill_flip(b32(i), u)
                                    debug(`fill_flip success on urn (${i},${u})`)
                                } catch (e) {
                                    debug(`failed to flip urn (${i}, ${u})`)
                                }
                                resolve(res)
                            }))
                            debug('    pushed fill_flip')
                        }
                    }
                }
            }
        }
    }

    return proms
}

const debug = require('debug')('keeper')
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

    let ilks = args.ilks.split(';')
    for (let i of ilks) {
        const bankilk = bank.ilks(b32(i))
        const fsrc = (await bank.callStatic.gethi(b32(i), b32('fsrc'), b32(i))).slice(0, 42)
        const ftag = await bank.callStatic.gethi(b32(i), b32('ftag'), b32(i))
        ilkinfos[i] = {
            // src and tag of feed to pull from
            fsrc,
            ftag,
            // last pulled price
            price: BigNumber.from((await fb.pull(fsrc, ftag))[0]),
            urns: {},
            rack: bankilk.rack,
            liqr: bankilk.liqr,
            fee: bankilk.fee,
            chop: bankilk.chop
        }
    }

    bank.on(bank.filters.NewFlog(null), async (flog) => { 
        processflog(flog)
    })

    const scheduleflip = async () => {
        try {
            let proms = []
            for (let i in ilkinfos) {
                proms = proms.concat(await scanilk(i, args.tol, args.minrush, args.poketime))
            }
            await Promise.all(proms)
        } catch (e) {
            debug('doflip failed:')
            //debug(e)
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
            //debug(e)
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
            //debug(e)
        }
        setTimeout(scheduleflap, args.flaptime)
    }

    if (args.fliptime) scheduleflip()
    if (args.flaptime) scheduleflop()
    if (args.floptime) scheduleflap()

}

const reseturns = (ilks) => ilks.forEach(i => { ilkinfos[i].urns = {} })

const fillurns = async (ilks) => {
    reseturns(ilks)
    ilks.forEach(i => ilkinfos[i].urns = {})

    const flogs = await bank.queryFilter(
        bank.filters.NewFlog(
            null, [topic('frob'), topic('bail'), topic('file'), topic('filk'), topic('init')]
        )
    )
    for (let flog of flogs) {
        try {
            processflog(flog)
        } catch (e) {
            debug('fillurns: failed to process flog')
            //debug(e)
        }
    }
}

export { schedule, reseturns, fillurns }
