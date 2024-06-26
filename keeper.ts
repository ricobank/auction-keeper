import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
import { WAD, RAY, RAD } from 'minihat'
import { b32, snapshot, revert } from 'minihat'
import bn from 'bignumber.js'
import * as ethers from 'ethers'
import { BigNumber } from 'ethers'

const dpack = require('@etherpacks/dpack')
const debug = require('debug')('keeper:run')

let pack, dapp
let bank
let ali

const constants = ethers.constants
const ZERO = constants.Zero
const PALM = [
    'NewPalm0(bytes32,bytes32)',
    'NewPalm1(bytes32,bytes32,bytes32)',
].map(ethers.utils.id)
const [PALM0, PALM1] = PALM

type Address = `0x${string}`
type Urn = {
    art : BigNumber;
    ink : BigNumber;
}
type Urns = {[u: Address]: Urn}

let joy : BigNumber = ZERO
let sin : BigNumber = ZERO
let rest : BigNumber = ZERO
let par : BigNumber = ZERO
let tart: BigNumber = ZERO
let rack: BigNumber = ZERO
let rho : BigNumber = ZERO
let fee : BigNumber = ZERO
let dust: BigNumber = ZERO
let chop: BigNumber = ZERO
let liqr: BigNumber = ZERO
let pep: BigNumber = ZERO
let pop: BigNumber = ZERO
let pup: BigNumber = ZERO

let bel: BigNumber = ZERO
let gif: BigNumber = ZERO
let chi: BigNumber = ZERO
let wal: BigNumber = ZERO
let pex: BigNumber = ZERO
let wel: BigNumber = ZERO
let dam: BigNumber = ZERO
let mop: BigNumber = ZERO
let lax: BigNumber = ZERO

let way : BigNumber = ZERO
let how : BigNumber = ZERO
let cap : BigNumber = ZERO
let urns: Urns

const raybn = bn(RAY.toString())
const radbn = bn(RAD.toString())
const wadbn = bn(WAD.toString())


// convert hex string to a human-readable string
// helpful for debugging
const xtos = (_ilk) : string => {
    let ilk = _ilk
    if (typeof(_ilk) == 'string') {
        ilk = Buffer.from(_ilk.slice(2), 'hex')
    } else if (_ilk.length == 0) {
        ilk = ethers.constants.HashZero
    }
    let last = ilk.indexOf(0)
    let sliced = last == -1 ? ilk : ilk.slice(0, last)
    return sliced.toString('utf8')
}

// save data from a Palm event
const savePalm = async (_palm) => {

    const id = _palm.topics[0]
    if (id == PALM0) {

        const palm = bank.interface.decodeEventLog(
            'NewPalm0', _palm.data, _palm.topics
        )

        const key = xtos(palm.key)
        const val = palm.val

        if (key == 'joy') {
            joy = BigNumber.from(val)
        } else if (key == 'sin') {
            sin = BigNumber.from(val)
        } else if (key == 'rest') {
            rest = BigNumber.from(val)
        } else if (key == 'par') {
            par = BigNumber.from(val)
        } else if (key == 'tart') {
            tart = BigNumber.from(val)
        } else if (key == 'rack') {
            rack = BigNumber.from(val)
        } else if (key == 'rho') {
            rho = BigNumber.from(val)
        } else if (key == 'bel') {
            bel = BigNumber.from(val)
        } else if (key == 'gif') {
            gif = BigNumber.from(val)
        } else if (key == 'chi') {
            chi = BigNumber.from(val)
        } else if (key == 'wal') {
            wal = BigNumber.from(val)
        } else if (key == 'way') {
            way = BigNumber.from(val)
        } else {
            debug(`palm0: ${key} not handled`)
        }

    } else if (id == PALM1) {
        const palm = bank.interface.decodeEventLog('NewPalm1', _palm.data, _palm.topics)
        const key  = xtos(palm.key)
        const val  = palm.val
        const u    = palm.idx0.slice(0, 42)

        // initialize ink, art if undefined
        if (!urns[u]) urns[u] = {art: ethers.constants.Zero, ink: ethers.constants.Zero}

        if (key == 'art') {
            // save art
            urns[u].art = BigNumber.from(val)
        } else if (key == 'ink') {
            urns[u].ink = BigNumber.from(val)
        } else {
            debug(`palm1: ${key} not handled`)
        }
    } else {
        debug(`palm: ${id} unrecognized (palms are ${PALM})`)
    }
}

let stats = {}

// scan all urns and collect data
// delete the empty urns
const scan = () => {
    if (Object.keys(urns).length == 0) return []

    stats['urns'] = {}

    let proms = []
    for (let _u in urns) {

        let u   = _u as Address
        let urn = urns[u]

        if (urn.ink.eq(0) && urn.art.eq(0)) {
            delete urns[u]
            continue
        }

        if (urn.art.eq(0) || urn.ink.eq(0)) continue;

        // calc tab and cut without directly calling bank
        debug(`checking ${u}'s urn: ink=${urn.ink}, art=${urn.art}`)
        debug(`    par=${par}, rack=${rack}`)
        let tab = urn.art.mul(par).mul(rack).div(RAY)
        let cut = urn.ink.mul(RAY).div(liqr).mul(RAY)
        debug(`    tab=${tab}, cut=${cut}, so it's ${tab.gt(cut) ? 'not ': ''}safe`)

        stats['urns'][u] = {
            safe: !tab.gt(cut),
            ink: bn(urn.ink.toString()).div(wadbn),
            art: bn(urn.art.toString()).div(wadbn),
            tab: bn(tab.toString()).div(radbn),
            cut: bn(cut.toString()).div(radbn)
        }

    }

    return proms
}

// all of the src addresses are the same right now
// do this to reduce duplicate entries in args.json
const makeArgs = async (path, ali) => {
    let args = require(path)
    let dapp = await dpack.load(args.ricopack, ethers, ali)
    args.signer = ali
    args.ricodapp = dapp
    return args
}

const runKeeper = async (args, signer?) => {

    debug('schedule')
    debug('network name:', args.netname)

    if (typeof(args) == 'string') {
        if (!signer) {
            throw new Error('args provided as JSON file, but no signer provided')
        }
        args = await makeArgs(args, signer)
    }

    // setup wallet
    ali = args.signer
    if (!ali) {
        const provider = new ethers.providers.JsonRpcProvider(args.url)
        ali = ethers.Wallet.fromMnemonic(args.mnemonic).connect(provider)
    }

    // load contracts from pack
    dapp = args.ricodapp
    if (!dapp) {
        dapp = await dpack.load(args.ricopack, ethers, ali)
    }
    bank     = dapp.bank
    debug(`bank @ ${bank.address}`)

    urns = {}

    // query event history for palm events and initialize state
    const palmfilter = {
        address: bank.address,
        topics:  [PALM]
    }
    let events = await bank.queryFilter(palmfilter)
    for (let event of events) {
        try {
            savePalm(event)
        } catch (e) {
            debug('runKeeper: failed to process event')
            //debug(e)
        }
    }

    fee = await bank.fee()
    dust = await bank.dust()
    chop = await bank.chop()
    liqr = await bank.liqr()
    pep = await bank.pep()
    pop = await bank.pop()
    pup = await bank.pup()
    pex = await bank.pex()
    wel = await bank.wel()
    dam = await bank.dam()
    mop = await bank.mop()
    lax = await bank.lax()
    how = await bank.how()
    cap = await bank.cap()

    // start palm listener
    bank.on(palmfilter, async (event) => { 
        try {
            savePalm(event)
        } catch (e) {
            debug('bank.on: failed to process event')
            //debug(e)
        }
    })

    const schedulesearch = async () => {
        try {
            // collect stats on all urns
            await scan()

            stats['joy'] = bn(joy.toString()).div(wadbn)
            stats['sin'] = bn(sin.toString()).div(radbn)
            stats['rest'] = bn(rest.toString()).div(raybn)
            stats['par'] = bn(par.toString()).div(raybn)
            stats['tart'] = bn(tart.toString()).div(wadbn)
            stats['rack'] = bn(rack.toString()).div(raybn)
            stats['rho'] = bn(rho.toString())
            stats['fee']  = bn(fee.toString()).div(raybn)
            stats['dust'] = bn(dust.toString()).div(raybn)
            stats['chop'] = bn(chop.toString()).div(raybn)
            stats['liqr'] = bn(liqr.toString()).div(raybn)
            stats['pep'] = bn(pep.toString())
            stats['pop'] = bn(pop.toString()).div(raybn)
            stats['pup'] = bn(pup.toString()).div(raybn)

            stats['bel'] = bn(bel.toString())
            stats['gif'] = bn(gif.toString()).div(wadbn)
            stats['chi'] = bn(chi.toString())
            stats['wal'] = bn(wal.toString()).div(wadbn)
            stats['pex'] = bn(pex.toString())
            stats['wel'] = bn(wel.toString()).div(raybn)
            stats['dam'] = bn(dam.toString()).div(raybn)
            stats['mop'] = bn(mop.toString()).div(raybn)
            stats['lax'] = bn(lax.toString()).div(raybn)
         
            stats['way'] = bn(way.toString()).div(raybn)
            stats['how'] = bn(how.toString()).div(raybn)
            stats['cap'] = bn(cap.toString()).div(raybn)

        } catch (e) {
            debug('scan failed:')
            debug(e)
        }
        setTimeout(schedulesearch, args.searchtime)
    }

    schedulesearch()
}

const printStats = () => { console.log(JSON.stringify(stats, null, 2)) }

const getStats = () => { return stats }

export { runKeeper, printStats, getStats, makeArgs }
