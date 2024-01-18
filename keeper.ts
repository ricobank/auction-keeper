import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine, RAY } from 'minihat'
import { b32, snapshot, revert } from 'minihat'
import bn from 'bignumber.js'
import * as ethers from 'ethers'
import { BigNumber } from 'ethers'

const dpack = require('@etherpacks/dpack')
const debug = require('debug')('keeper:run')

let pack, dapp
let bank, strat
let fb, uniwrap
let ali
let ilkinfos : IlkInfos = {}

const constants = ethers.constants
const PALM = [
    'NewPalm0(bytes32,bytes32)',
    'NewPalm1(bytes32,bytes32,bytes32)',
    'NewPalm2(bytes32,bytes32,bytes32,bytes32)',
    'NewPalmBytes2(bytes32,bytes32,bytes32,bytes)'
].map(ethers.utils.id)
const [PALM0, PALM1, PALM2, PALMBYTES2] = PALM
const ANSWERUPDATED = ethers.utils.id('AnswerUpdated(int256,uint256,uint256)')
const auabi = [ 'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)' ]

let par : BigNumber
let way : BigNumber
let tau : BigNumber
let how : BigNumber
let tip : { src: Address, tag: string }

type Ilk = string
type Address = `0x${string}`


type Urn = {
    art : BigNumber;
}
type Urns = {[u: Address]: Urn}

type ERC20Info = {
    gem: Address,
    amt: BigNumber
}

interface Hook {
    ink :{[i: Ilk]: {[u: Address]: any}}

    cut(i :Ilk, u :Address) :BigNumber;
    profitable(
      i :string,
      u :Address,
      cut :BigNumber,
      bill :BigNumber,
      deal :BigNumber
    ) :boolean;
}

type Item = {
    gem: Address
    src: Address
    tag: string
    liqr: BigNumber
}

class ERC20Hook implements Hook {
    public items: {[key: Ilk]: Item} = {}
    public ink :{[i: Ilk]: {[u: Address]: BigNumber}} = {}

    constructor() {}

    cut(i :Ilk, u :Address) :BigNumber {
        let item = this.items[i]
        let feed = feeds[item.src][item.tag]
        if (!this.ink[i]) this.ink[i] = {}
        if (!this.ink[i][u]) this.ink[i][u] = ethers.constants.Zero
        return this.ink[i][u].mul(feed.val).mul(RAY).div(item.liqr)
    }

    profitable(
      i :string,
      u :Address,
      cut :BigNumber,
      bill :BigNumber,
      deal :BigNumber
    ) :boolean {
        return deal.lt(RAY)
    }
}

type UniV3NFTs   = {[key: string]: {token0: ERC20Info, token1: ERC20Info}}
type Amounts     = { t0: Address, t1: Address, a0: BigNumber, a1: BigNumber }
type UniV3Source = { src: Address, tag: string, liqr: BigNumber }

class UniV3NFTHook implements Hook {
    public sources      : { [i: Ilk]: { [gem: Address]: UniV3Source } } = {}
    // tokenId => (token0, token1)
    public nfts         : UniV3NFTs = {}
    public ink          : {[i: Ilk]: {[u: Address]: BigNumber[]}} = {}
    public wrap         : ethers.Contract
    public nfpm         : ethers.Contract
    public hookContract : ethers.Contract
    public bank         : ethers.Contract
    public uniwrap      : ethers.Contract

    constructor(
      bank    : ethers.Contract,
      uniwrap : ethers.Contract,
      nfpm    : ethers.Contract
    ) {
        this.bank = bank
        this.uniwrap = uniwrap
        this.nfpm = nfpm
    }

    cut(i :Ilk, u :Address) :BigNumber {
        let res = ethers.constants.Zero

        for (let tokenId of this.ink[i][u]) {
            let {token0, token1} = this.nfts[tokenId.toString()]
            let source0 = this.sources[i][token0.gem]
            let source1 = this.sources[i][token1.gem]
            let feed0 = feeds[source0.src][source0.tag]
            let feed1 = feeds[source1.src][source1.tag]
            res = res.add(feed0.val.mul(token0.amt).mul(RAY).div(source0.liqr))
            res = res.add(feed1.val.mul(token1.amt).mul(RAY).div(source1.liqr))
        }
        return res
    }

    profitable(
      i :string,
      u :Address,
      cut :BigNumber,
      bill :BigNumber,
      deal :BigNumber
    ) :boolean {
        return deal.lt(RAY)
    }

    // (ilk, tokenId) -> [token0, token1, amount0, amount1]
    async amounts(i :Ilk, tokenId :BigNumber) {
        const [,,t0, t1,,,,,,,,] = await this.nfpm.positions(tokenId)
        const src0 = this.sources[i][t0.toLowerCase()]
        const src1 = this.sources[i][t1.toLowerCase()]

        const feed0 = feeds[src0.src][src0.tag]
        const feed1 = feeds[src1.src][src1.tag]
        const p0    = feed0.val
        const p1    = feed1.val

        const x96 = BigNumber.from(2).pow(96)
        const ratioX96 = p0.mul(x96).div(p1)
        const sqrtRatioX96 = BigNumber.from(bn(ratioX96.mul(x96).toString())
          .sqrt().integerValue().toFixed().toString()
        )

        const [a0, a1] = await this.uniwrap.total(
            this.nfpm.address, tokenId, sqrtRatioX96
        )

        return [t0, t1, a0, a1]

    }
}

// storage section name (e.g. ricobank.0) -> Hook
let hooks : {[hookname: string]: Hook} = {}

// mirrors Vat.Ilk
type IlkInfo = {
    hook: string,
    urns: Urns,
    rack: BigNumber,
    fee : BigNumber,
    chop: BigNumber
}

type Feed    = {val: BigNumber, ttl: BigNumber }
type Feeds   = {[src: Address]: {[tag: string]: Feed}}
type FeedPtr = {src: Address, tag: string}

let feeds : Feeds = {};

type IlkInfos = {[key: Ilk]: IlkInfo}

// convert hex string to a human-readable string
// helpful for debugging, so we have readable feeds and ilk IDs
const xtos = (_ilk) : string => {
    let ilk = _ilk
    if (typeof(_ilk) == 'string') {
        ilk = Buffer.from(_ilk.slice(2), 'hex')
    }
    let last = ilk.indexOf(0)
    let sliced = last == -1 ? ilk : ilk.slice(0, last)
    return sliced.toString('utf8')
}

// save data from a Palm event
const savepalm = async (_palm) => {

    const id = _palm.topics[0]
    if (id == PALM0) {

        const palm = bank.interface.decodeEventLog(
            'NewPalm0', _palm.data, _palm.topics
        )

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
        } else if (key == 'tip.src') {
            tip.src = val.slice(0, 42)
        } else if (key == 'tip.tag') {
            tip.tag = xtos(val)
        } else {
            debug(`palm0: ${key} not handled`)
        }

    } else if (id == PALM1) {

        const palm = bank.interface.decodeEventLog('NewPalm1', _palm.data, _palm.topics)
        const key  = xtos(palm.key)
        const val  = palm.val
        const idx0 = xtos(palm.idx0)

        if (!ilkinfos[idx0]) return

        const info : IlkInfo = ilkinfos[idx0]
        if (key == 'rack') {
            info.rack = BigNumber.from(val)
        } else if (key == 'fee') {
            info.fee = BigNumber.from(val)
        } else if (key == 'chop') {
            info.chop = BigNumber.from(val)
        } else if (idx0 == 'weth') {

            let erc20hook :ERC20Hook = hooks['erc20hook.0'] as ERC20Hook

            // initialize hook (gem,src,tag,liqr) if undefined
            if (!erc20hook.items[idx0]) {
                erc20hook.items[idx0] = {
                    gem:  ethers.constants.AddressZero,
                    src:  ethers.constants.AddressZero,
                    tag:  ethers.constants.HashZero,
                    liqr: ethers.constants.Zero
                }
            }

            let item = erc20hook.items[idx0]
            if (key == 'gem') {
                item.gem = val.slice(0, 42)
            } else if (key == 'src') {
                item.src = val.slice(0, 42)
            } else if (key == 'tag') {
                item.tag = xtos(val)
            } else if (key == 'liqr') {
                item.liqr = BigNumber.from(val)
            } else {
                debug(`palm1: ${key} not handled for idx ${idx0}`)
            }

        } else {
            debug(`palm1: ${key} not handled`)
        }
    } else if (id == PALM2) {

        const palm = bank.interface.decodeEventLog('NewPalm2', _palm.data, _palm.topics)
        const key  = xtos(palm.key)
        const val  = palm.val
        const idx0 = palm.idx0
        const idx1 = palm.idx1
        const i    = xtos(idx0)
        const u    = idx1.slice(0, 42)

        if (key == 'art') {

            // initialize art if undefined
            if (!ilkinfos[i].urns) ilkinfos[i].urns = {}
            if (!ilkinfos[i].urns[u]) ilkinfos[i].urns[u] = {art: ethers.constants.Zero}

            // save art
            ilkinfos[i].urns[u].art = BigNumber.from(val)

        } else if (xtos(idx0) == ':uninft') {

            let uninfthook :UniV3NFTHook = hooks['uninfthook.0'] as UniV3NFTHook
            let gem = u

            // initialize (src, tag, liqr) if undefined
            if (!uninfthook.sources[i]) uninfthook.sources[i] = {}
            if (!uninfthook.sources[i][gem]) {
                uninfthook.sources[i][gem] = {
                    src: constants.AddressZero,
                    tag: constants.HashZero,
                    liqr: constants.Zero
                }
            }

            let source = uninfthook.sources[i][gem]
            if (key == 'src') {
                source.src = val.slice(0, 42)
            } else if (key == 'tag') {
                source.tag = xtos(val)
            } else if (key == 'liqr') {
                source.liqr = BigNumber.from(val)
            } else {
                debug(`palm2: ${key} not handled for idx ${xtos(idx0)},${idx1}`)
            }
        } else {
            debug(`palm2: ${key} not handled`)
        }

    } else if (id == PALMBYTES2) {

        const palm = bank.interface.decodeEventLog(
            'NewPalmBytes2', _palm.data, _palm.topics
        )

        const key  = xtos(palm.key)
        const val  = palm.val
        const idx0 = palm.idx0
        const idx1 = palm.idx1
        const i    = xtos(idx0)
        const u    = idx1.slice(0, 42)

        const info :IlkInfo = ilkinfos[i]

        if (key == 'ink') {

            if (i === 'weth') {

                const hook :ERC20Hook = hooks[info.hook] as ERC20Hook
                if (!hook.ink) hook.ink = {}
                if (!hook.ink[i]) hook.ink[i] = {}
                hook.ink[i][u] = BigNumber.from(val)

            } else if (i === ':uninft') {

                // initialize ink if empty
                const hook :UniV3NFTHook= hooks[info.hook] as UniV3NFTHook
                if (!hook.ink) hook.ink = {}
                if (!hook.ink[i]) hook.ink[i] = {}

                // decode new set of tokenIds
                let tokenIds = ethers.utils.defaultAbiCoder.decode(['uint[]'], val)[0]

                // get the t0/t1 amounts for each nft
                // save it for later so scanilk doesn't need to await,
                // along with tokenIds
                let proms = tokenIds.map(
                    tokenId => new Promise(async (resolve, reject) => {
                        try {
                            let [t0, t1, a0, a1] = await hook.amounts(i, tokenId)
                            hook.nfts[tokenId.toString()] = {
                                token0: {gem: t0.toLowerCase(), amt: a0},
                                token1: {gem: t1.toLowerCase(), amt: a1}
                            }
                            resolve(null)
                        } catch (e) {
                            debug("palm uni ink fail")
                            debug(e)
                        }
                    })
                )
                await Promise.all(proms)

                hook.ink[i][u] = tokenIds

            } else {
                debug(`palmbytes2: ${key} not handled for ilk ${i}`)
            }
        } else {
            debug(`palmbytes2: ${key} not handled`)
        }

    } else {
        debug(`palm: ${id} unrecognized (palms are ${PALM})`)
    }
}

// save data from a feedbase Push event
const savepush = (_push, tol) => {
    const push = fb.interface.decodeEventLog('Push', _push.data, _push.topics)
    const src = push.src.toLowerCase()
    const tag = xtos(push.tag)

    // initialize if empty
    if (!feeds[src]) {
        feeds[src] = {}
    }
    if (!feeds[src][tag]) {
        feeds[src][tag] = {
            val: ethers.constants.Zero,
            ttl: ethers.constants.MaxUint256,
        }
    }

    // save the price
    let feed = feeds[src][tag]
    feed.val = BigNumber.from(push.val)
    feed.ttl = BigNumber.from(push.ttl)
}

// scan all urns and flip the flippable ones
// delete the empty urns
const scanilk = (i :string) => {
    let info :IlkInfo = ilkinfos[i]
    let hook :Hook = hooks[info.hook]
    if (Object.keys(info.urns).length == 0) return []

    let proms = []
    for (let _u in info.urns) {

        let u   = _u as Address
        let urn = info.urns[u]

        // calc tab and cut without directly calling bank
        debug(`checking urn (${i},${u}): ink=${hook.ink[i][u]}, art=${urn.art}`)
        debug(`    par=${par}, rack=${info.rack}`)
        let tab = urn.art.mul(par).mul(info.rack).div(ray(1))
        let cut = hook.cut(i, u)
        debug(`    tab=${tab}, cut=${cut}, so it's ${tab.gt(cut) ? 'not ': ''}safe`)

        if (tab.gt(cut)) {
            // urn is unsafe...bail it if profitable
            let deal = RAY
            if (tab.gt(RAY)) {
                deal = cut.div(tab.div(RAY))
            }
            debug(`    deal=${deal}`)

            // check expected profit
            let bill = info.chop.mul(urn.art).mul(info.rack).div(ray(1).pow(2))
            if (hook.profitable(i, u, cut, bill, deal)) {


                // bail is profitable, so push a promise to bail
                proms.push(new Promise(async (resolve, reject) => {
                    let res
                    try {
                        let fliptype = 0
                        if (i.startsWith(':uninft')) fliptype = 1
                        let tx = await send(
                            strat.fill_flip,
                            b32(i), u, fliptype, {gasLimit: 10000000}
                        )
                        delete info.urns[u]
                        debug(`fill_flip success on urn (${i},${u})`)
                    } catch (e) {
                        debug(`failed to flip urn (${i}, ${u})`)
                        debug(e)
                    }
                    resolve(null)
                }))

                debug('    pushed fill_flip')
            }
        }
    }

    return proms
}

const run_keeper = async (args) => {

    debug('schedule')
    debug('network name:', args.netname)

    // setup wallet
    ali = args.signer
    if (!ali) {
        const provider = new ethers.providers.JsonRpcProvider(args.url)
        ali = ethers.Wallet.fromMnemonic(args.mnemonic).connect(provider)
    }

    // load contracts from pack
    pack    = require(`./pack/strat_${args.netname}.dpack.json`)
    dapp    = await dpack.load(pack, ethers, ali)
    bank    = dapp.bank
    strat   = dapp.strat
    fb      = dapp.feedbase
    uniwrap = dapp.uniswapV3Wrapper

    // setup hooks
    // these update on palm
    let erc20hook = new ERC20Hook()
    let nfpm      = dapp._types.NonfungiblePositionManager.attach(
        dapp.nonfungiblePositionManager.address
    );
    let nfthook   = new UniV3NFTHook(bank.address, dapp.uniwrapper, nfpm)

    hooks['erc20hook.0']  = erc20hook
    hooks['uninfthook.0'] = nfthook

    // approve infinite rico to bank
    await send(dapp.rico.approve, bank.address, ethers.constants.MaxUint256)

    // setup ilks...each one is connected to a hook
    let ilks = args.ilks.split(';')
    for (let i of ilks) {
        const bankilk = await bank.ilks(b32(i))
        ilkinfos[i] = {
            // src and tag of feed to pull from
            urns: {},
            hook: i.startsWith(':uninft') ? 'uninfthook.0' : 'erc20hook.0',
            rack: bankilk.rack,
            fee:  bankilk.fee,
            chop: bankilk.chop
        }
    }

    // query event history for palm events and initialize state
    const palmfilter = {
        address: bank.address,
        topics:  [PALM]
    }
    let events = await bank.queryFilter(palmfilter)
    for (let event of events) {
        try {
            savepalm(event)
        } catch (e) {
            debug('run_keeper: failed to process event')
            //debug(e)
        }
    }

    // start palm listener
    bank.on(palmfilter, async (event) => { 
        try {
            savepalm(event)
        } catch (e) {
            debug('bank.on: failed to process event')
            //debug(e)
        }
    })

    // process backlogged feed pushes
    // TODO make more specific filter
    let fbfilter = {
        address: fb.address,
        topics: [null,null,null]
    }
    events = await fb.queryFilter(fbfilter)
    for (let event of events) {
        try {
            savepush(event, args.tol)
        } catch (e) {
            debug('run_keeper: failed to process push')
            //debug(e)
        }
    }

    const saveRead = async (_src, tag) => {
        const src = _src.toLowerCase()
        if (!feeds[src]) feeds[src] = {}
        if (!feeds[src][tag]) feeds[src][tag] = {val: undefined, ttl: undefined}
        let feed = feeds[src][tag]
        let [val, ttl] = await fb.pull(src, b32(tag))
        feed.val = BigNumber.from(val)
        feed.ttl = ttl
    }

    for (let agg of Object.keys(args.aggs)) {
        let clfilter = {
            address: agg,
            topics: [ANSWERUPDATED]
        }
        events = await bank.queryFilter(clfilter)

        if (events.length > 0) {
            const readers = args.aggs[agg]
            for (let reader of readers) {
                try {
                    await saveRead(reader.src, reader.tag)
                } catch (e) {
                    debug('run_keeper: failed to saveRead')
                }
            }
 
        }
    }

    for (let agg of Object.keys(args.aggs)) {
        let contract = new ethers.Contract(agg, auabi, ali)
        let clfilter = contract.filters.AnswerUpdated(null,null,null);
        contract.on(clfilter, async (_) => {
            const readers = args.aggs[agg]
            for (let reader of readers) {
                try {
                    await saveRead(reader.src, reader.tag)
                } catch (e) {
                    debug('run_keeper: failed to saveRead')
                    debug(e)
                }
 
            }
        })
    }
 

    // listen to future feed pushes
    fb.on(fbfilter, async (push) => {
        try {
            savepush(push, args.tol)
        } catch (e) {
            debug('fb.on: failed to process push (2)')
            //debug(e)
        }
        
    })

    const scheduleflip = async () => {
        try {
            // check all urns under all ilks, flip if possible
            let proms = Object.keys(ilkinfos).map(scanilk)
            await Promise.all(proms)
        } catch (e) {
            debug('scanilk failed:')
            debug(e)
        }
        setTimeout(scheduleflip, args.fliptime)
    }

    scheduleflip()
}

export { run_keeper }
