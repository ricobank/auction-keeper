
import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine, RAY } from 'minihat'
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
const PALM = [
    'NewPalm0(bytes32,bytes32)',
    'NewPalm1(bytes32,bytes32,bytes32)',
    'NewPalm2(bytes32,bytes32,bytes32,bytes32)',
    'NewPalmBytes2(bytes32,bytes32,bytes32,bytes)'
].map(ethers.utils.id)
const [PALM0, PALM1, PALM2, PALMBYTES2] = PALM
const FLOG = ethers.utils.id('NewFlog(address,bytes4,bytes)')



let par : BigNumber
let way : BigNumber
let tau : BigNumber
let how : BigNumber
let tip : Address
let tag : string

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
    urns: Urns;

    // to quickly calculate expected profit
    rack: BigNumber;
    liqr: BigNumber;
    fee: BigNumber;
    chop: BigNumber;
}


type Feed = {val: BigNumber, ttl: BigNumber, dip: boolean }
type Feeds = {[src: Address]: {[tag: string]: Feed}}
let feeds : Feeds = {};

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


const processpalm = (_palm) => {
    const id = _palm.topics[0]
    if (id == PALM0) {
        const palm = bank.interface.decodeEventLog('NewPalm0', _palm.data, _palm.topics)
        const key = xtos(palm.key)
        const val = palm.val
        if (key == 'par') {
            par = BigNumber.from(val)
        } else if (key == 'way') {
            way = BigNumber.from(val)
        } else if (key == 'tau') {
            tau = BigNumber.from(val)
        } else if (key == 'how') {
            how = BigNumber.from(val)
        } else if (key == 'tip') {
            tip = val.slice(0, 42)
        } else if (key == 'tag') {
            tag = xtos(val)
        } else {
            debug(`palm0: ${key} not handled`)
        }
    } else if (id == PALM1) {
        const palm = bank.interface.decodeEventLog('NewPalm1', _palm.data, _palm.topics)
        const key = xtos(palm.key)
        const val = palm.val
        const idx0 = xtos(palm.idx0)
        if (!ilkinfos[idx0]) return
        const info : IlkInfo = ilkinfos[idx0]
        if (key == 'rack') {
            info.rack = BigNumber.from(val)
        } else if (key == 'liqr') {
            info.liqr = BigNumber.from(val)
        } else if (key == 'fee') {
            info.fee = BigNumber.from(val)
        } else if (key == 'chop') {
            info.chop = BigNumber.from(val)
        } else {
            debug(`palm1: ${key} not handled`)
        }
    } else if (id == PALM2) {
        const palm = bank.interface.decodeEventLog('NewPalm2', _palm.data, _palm.topics)
        const key = xtos(palm.key)
        const val = palm.val
        const idx0 = palm.idx0
        const idx1 = palm.idx1
        const i = xtos(idx0)
        const u = idx1.slice(0, 42)
        if (key == 'art') {
            if (!ilkinfos[i].urns[u]) ilkinfos[i].urns[u] = {art: ethers.constants.Zero, ink: ethers.constants.Zero}
            ilkinfos[i].urns[u].art = BigNumber.from(val)
        } else {
            debug(`palm2: ${key} not handled`)
        }
    } else if (id == PALMBYTES2) {
        const palm = bank.interface.decodeEventLog('NewPalmBytes2', _palm.data, _palm.topics)
        const key = xtos(palm.key)
        const val = palm.val
        const idx0 = palm.idx0
        const idx1 = palm.idx1
        const i = xtos(idx0)
        const u = idx1.slice(0, 42)
        if (key == 'ink') {
            if (!ilkinfos[i].urns[u]) ilkinfos[i].urns[u] = {art: ethers.constants.Zero, ink: ethers.constants.Zero}
            ilkinfos[i].urns[u].ink = BigNumber.from(val)
        } else {
            debug(`palmbytes2: ${key} not handled`)
        }
    } else {
        debug(`palm: ${id} unrecognized (palms are ${PALM})`)
    }
}

const fastpow = (n :BigNumber, dt :BigNumber) => {
    if (dt.eq(0)) return RAY
    if (dt.mod(2).eq(1)) return fastpow(n, dt.div(2)).mul(n).div(RAY)
    else return fastpow(n, dt.div(2))
}

const processpush = (_push, tol) => {
    const push = fb.interface.decodeEventLog('Push', _push.data, _push.topics)
    const src = push.src.toLowerCase()
    const tag = xtos(push.tag)
    if (!feeds[src]) {
        feeds[src] = {}
    }
    if (!feeds[src][tag]) {
        feeds[src][tag] = {
            val: ethers.constants.Zero,
            ttl: ethers.constants.MaxUint256,
            dip: false,
        }
    }
    let nextval = BigNumber.from(push.val)
    let nextttl = BigNumber.from(push.ttl)
    let feed = feeds[src][tag]
    if (tol.gt(0) && feed.val.gt(0)) {
        let dipamt = feed.val.sub(nextval).mul(RAY).div(feed.val)
        if (!way.lt(RAY)) {
            let now = BigNumber.from(Math.ceil(Date.now() / 1000))
            let parjump = fastpow(way, now.sub(tau))
            dipamt = dipamt.mul(parjump).div(RAY)
        }
        feed.dip = dipamt.gt(tol)
    }
    feed.val = nextval
    feed.ttl = nextttl
}

const gettime = async () => {
    return (await ali.provider.getBlock('latest')).timestamp
}

const DISCOUNT = ray(0.999999)
const profitable = (i :string, sell :BigNumber, earn :BigNumber) => {
    // TODO expand
    let info : IlkInfo = ilkinfos[i]
    let feed : Feed = feeds[info.fsrc][info.ftag]
    let ask = earn.mul(RAY).div(sell)
    let mark = feed.val
    debug(`    profitable ? ask=${ask} market=${mark} discount=${DISCOUNT}`)
    if (ask.mul(RAY).div(mark).lt(DISCOUNT)) {
        debug(`        ...yes`)
        return true
    }
    return false
}

// check if an ilk's price feed has changed beyond some tolerance
// if it has, loop through the tracked urns under said ilk,
// deleting the empty ones, and bailing the sufficiently unsafe ones
const scanilk = async (i :string, tol, minrush, poketime) => {
    let info :IlkInfo = ilkinfos[i]
    if (Object.keys(info.urns).length == 0) return []
    let fsrc = info.fsrc
    let ftag = info.ftag

    if (!feeds[info.fsrc] || !feeds[info.fsrc][info.ftag]) {
        throw Error(`no feed for ${i}`)
    }
    let feed : Feed = feeds[info.fsrc][info.ftag]
    let proms = []
    if (feed.dip) {
        // feed has changed...check all the currently tracked urns
        feed.dip = false
        for (let u in info.urns) {
            let urn = info.urns[u]
            //let [safe, rush, cut] = await bank.callStatic.safe(b32(i), u)
            let rush
            // div by ray once for each rmul in vat safe
            debug(`checking urn (${i},${u}): ink=${urn.ink}, art=${urn.art}`)
            debug(`    par=${par}, rack=${info.rack}, liqr=${info.liqr}`)
            let tab = urn.art.mul(par).mul(info.rack).mul(info.liqr).div(ray(1).pow(2))
            let cut = urn.ink.mul(feed.val)
            debug(`    tab=${tab}, cut=${cut}, so it's ${tab.gt(cut) ? 'not ': ''}safe`)
            if (tab.gt(cut)) {
                // unsafe
                rush = tab.div(cut.eq(0) ? 1 : cut).mul(ray(1))
                debug(`    rush=${rush}, minrush=${minrush}`)
                if (rush.gt(minrush)) {
                    // check expected profit
                    let bill = info.chop.mul(urn.art).mul(info.rack).div(ray(1).pow(2))
                    let earn = cut.div(rush.eq(0) ? 1 : rush)
                    let sell = urn.ink
                    if (earn.gt(bill)) {
                        sell = bill.mul(sell).div(earn == 0 ? 1 : earn);
                        earn = bill
                    }

                    if (profitable(i, sell, earn)) {
                        proms.push(new Promise(async (resolve, reject) => {
                            let res
                            try {
                                await send(strat.fill_flip, b32(i), u, info.fsrc, b32(info.ftag))
                                debug(`fill_flip success on urn (${i},${u})`)
                            } catch (e) {
                                debug(`failed to flip urn (${i}, ${u})`)
                                //debug(e)
                            }
                            resolve(null)
                        }))
                        debug('    pushed fill_flip')
                    }
                }
            }
        }
    }

    return proms
}

const debug = require('debug')('keeper')

const run_keeper = async (args) => {

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
        const ftag = xtos(await bank.callStatic.gethi(b32(i), b32('ftag'), b32(i)))
        ilkinfos[i] = {
            // src and tag of feed to pull from
            fsrc,
            ftag,
            urns: {},
            rack: bankilk.rack,
            liqr: bankilk.liqr,
            fee: bankilk.fee,
            chop: bankilk.chop
        }
    }
 

    par = await bank.par()
    way = await bank.way()
    tau = await bank.tau()
    how = await bank.how()
    tip = await bank.tip()
    tag = xtos(await bank.tag())

    ilks.forEach(i => ilkinfos[i].urns = {})

    const bankfilter = {
        address: bank.address,
        topics: [PALM.concat([FLOG])]
    }
    let events = await bank.queryFilter(bankfilter)
    for (let event of events) {
        try {
            if (event.topics[0] == FLOG) {
                //processflog(event)
            } else {
                processpalm(event)
            }
        } catch (e) {
            debug('run_keeper: failed to process event')
            //debug(e)
        }
    }

    bank.on(bankfilter, async (event) => { 
        try {
            if (event.topics[0] == FLOG) {
                //processflog(event)
            } else {
                processpalm(event)
            }
        } catch (e) {
            debug('bank.on: failed to process event')
            //debug(e)
        }
    })

    let ftags = ilks.map(i => ethers.utils.hexlify(b32(ilkinfos[i].ftag)))
    let fsrcs = ilks.map(i => ethers.utils.hexZeroPad(ilkinfos[i].fsrc, 32))
    const fbfilter = {
        address: fb.address,
        topics: [null,fsrcs,ftags]
    }
    events = await fb.queryFilter(fbfilter)
    for (let event of events) {
        try {
            processpush(event, args.tol)
        } catch (e) {
            debug('run_keeper: failed to process push')
            //debug(e)
        }
    }


    fb.on(fbfilter, async (push) => {
        try {
            processpush(push, args.tol)
        } catch (e) {
            debug('fb.on: failed to process push (2)')
            debug(e)
        }
        
    })



    const scheduleflip = async () => {
        try {
            let proms = []
            for (let i in ilkinfos) {
                proms = proms.concat(await scanilk(i, args.tol, args.minrush, args.poketime))
            }
            await Promise.all(proms)
        } catch (e) {
            debug('scanilk failed:')
            //debug(e)
        }
        setTimeout(scheduleflip, args.fliptime)
    }

    const scheduleflop = async () => {
        try {
            let [ricogain, riskgain] = await strat.callStatic.fill_flop()
            if (ricogain > args.expected_rico || riskgain > args.expected_risk) {
                await send(strat.fill_flop)
            }
        } catch (e) {
            //debug('doflop failed:')
            //debug(e)
        }
        setTimeout(scheduleflop, args.floptime)
    }

    const scheduleflap = async () => {
        try {
            let [ricogain, riskgain] = await strat.callStatic.fill_flap()
            if (ricogain > args.expected_rico || riskgain > args.expected_risk) {
                await send(strat.fill_flap)
            }
        } catch (e) {
            //debug('doflap failed:')
            //debug(e)
        }
        setTimeout(scheduleflap, args.flaptime)
    }

    if (args.fliptime) scheduleflip()
    if (args.flaptime) scheduleflop()
    if (args.floptime) scheduleflap()
}

export { run_keeper }
