
import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine, RAY } from 'minihat'
import { b32, snapshot, revert } from 'minihat'
const dpack = require('@etherpacks/dpack')
import * as ethers from 'ethers'
const debug = require('debug')('keeper')

let pack, dapp
let bank, strat
let mdn, fb, ploker
let uniwrap
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
const FLIP_FAILED = ethers.utils.id('FlipFailed(bytes)')



let par : BigNumber
let way : BigNumber
let tau : BigNumber
let how : BigNumber
let tip : Address
let tag : string

type Ilk = string
type Address = `0x${string}`


type Urn = {
    ink : BigNumber | BigNumber[];
    art : BigNumber;
}
type Urns = {[u: Address]: Urn}

type ERC20Info = {
    gem: Address,
    name: string,
    fsrc: Address,
    ftag: string
}

interface Hook {
    getFeeds() :FeedPtr[];
    getIlkFeeds(i :Ilk) :FeedPtr[];
    getUrnFeeds(i :Ilk, u :Address) :FeedPtr[];
    cut(i :Ilk, u :Address) :Promise<BigNumber>;
    dipIlk(i :Ilk) :boolean
    dipUrn(i :Ilk, u :Address) :boolean
}

type Item = {
    gem: Address
    fsrc: Address
    ftag: string
}

class ERC20Hook implements Hook {
    public items: {[key: Ilk]: Item} = {}
    public ink :{[i: Ilk]: {[u: Address]: BigNumber}} = {}

    getFeeds() {
        return [].concat(...Object.keys(this.items).map(i => this.getIlkFeeds(i)))
    }

    getIlkFeeds(i :Ilk) :FeedPtr[] {
        return [{src: this.items[i].fsrc, tag: this.items[i].ftag}]
    }

    getUrnFeeds(i :Ilk, u :Address) :FeedPtr[] {
        return this.getIlkFeeds(i)
    }

    async cut(i :Ilk, u :Address) :Promise<BigNumber> {
        let item = this.items[i]
        let feed = feeds[item.fsrc][item.ftag]
        if (!this.ink[i]) this.ink[i] = {}
        if (!this.ink[i][u]) this.ink[i][u] = ethers.constants.Zero
        return this.ink[i][u].mul(feed.val)
    }
    dipIlk(i :Ilk) :boolean {
        let item = this.items[i]
        let feed = feeds[item.fsrc][item.ftag]
        return feed.dip
    }
    dipUrn(i :Ilk, u :Address) :boolean {
        throw Error('unimplemented dipUrn')
    }
}

type UniV3NFTs = {[key: string]: {token0: ERC20Info, token1: ERC20Info}}

class UniV3NFTHook implements Hook {
    public sources: {[i: Ilk]: {[u: Address]: FeedPtr}} = {}
    // tokenId => (token0, token1)
    public nfts :UniV3NFTs = {}
    public ink :{[i: Ilk]: {[u: Address]: [BigNumber]}} = {}
    public wrap : ethers.Contract

    getFeeds(): FeedPtr[] {
        return [].concat(Object.keys(this.sources).map(i => this.getIlkFeeds(i)))
    }

    getIlkFeeds(i :Ilk) :FeedPtr[] {
        return Object.values(this.sources[i])
    }

    getUrnFeeds(i :Ilk, u :Address) :FeedPtr[] {
        return [].concat(this.ink[i][u].map(tokenId => {
            let token0 = this.nfts[tokenId.toString()].token0
            let token1 = this.nfts[tokenId.toString()].token1
            return [
                {src: token0.fsrc, tag: token0.ftag},
                {src: token1.fsrc, tag: token1.ftag}
            ]
        }))
    }
    async cut(i :Ilk, u :Address) :Promise<BigNumber> {
        let source = this.sources[i][u]
        let res = ethers.constants.Zero
        for (let tokenId in this.ink[i][u]) {
            let {token0, token1} = this.nfts[tokenId]
            let feed0 = feeds[token0.fsrc][token0.ftag]
            let feed1 = feeds[token1.fsrc][token1.ftag]
        }
        throw Error('ERC20 cut : unimplemented')
    }

    dipIlk(i :Ilk) :boolean {
        throw Error('unimplemented dipIlk')
    }
    dipUrn(i :Ilk, u :Address) :boolean {
        throw Error('unimplemented dipUrn')
    }
}

let hooks : {[hookname: string]: Hook} = {}
type IlkInfo = {
    hook: string,
    urns: Urns,
    rack: BigNumber,
    liqr: BigNumber,
    fee: BigNumber,
    chop: BigNumber
}

type Feed = {val: BigNumber, ttl: BigNumber, dip: boolean }
type Feeds = {[src: Address]: {[tag: string]: Feed}}
type FeedPtr = {src: Address, tag: string}
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
        } else if (key.startsWith('erc20hook.0')) {
            let erc20hook :ERC20Hook = hooks['erc20hook.0'] as ERC20Hook
            if (!erc20hook.items[idx0]) {
                erc20hook.items[idx0] = {
                    gem: ethers.constants.AddressZero,
                    fsrc: ethers.constants.AddressZero,
                    ftag: ethers.constants.HashZero
                }
            }
            let item = erc20hook.items[idx0]
            let subkey = key.replace('erc20hook.0.', '')
            if (subkey == 'gem') {
                item.gem = val.slice(0, 42)
            } else if (subkey == 'fsrc') {
                item.fsrc = val.slice(0, 42)
            } else if (subkey == 'ftag') {
                item.ftag = xtos(val)
            } else {
                debug(`palm1: ${key} not handled`)
            }
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
        if (key.startsWith('erc20hook.0.')) {
            const subkey = key.replace('erc20hook.0.', '')
            if (subkey == 'ink') {
                if (!ilkinfos[i].urns[u]) ilkinfos[i].urns[u] = {art: ethers.constants.Zero, ink: ethers.constants.Zero}
                ilkinfos[i].urns[u].ink = BigNumber.from(val)
            } else {
                debug(`palmbytes2: ${key} not handled`)
            }
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
    return sell.gt(0)
    /*
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
   */
}

// check if an ilk's price feed has changed beyond some tolerance
// if it has, loop through the tracked urns under said ilk,
// deleting the empty ones, and bailing the sufficiently unsafe ones
const scanilk = async (i :string, tol, minrush) => {
    let info :IlkInfo = ilkinfos[i]
    let hook :Hook = hooks[info.hook]
    if (Object.keys(info.urns).length == 0) return []
    let proms = []
    if (hook.dipIlk(i)) {
        // TODO figure out when to unset dip
        for (let u in info.urns) {
            let urn = info.urns[u]
            //let [safe, rush, cut] = await bank.callStatic.safe(b32(i), u)
            let rush
            // div by ray once for each rmul in vat safe
            debug(`checking urn (${i},${u}): ink=${urn.ink}, art=${urn.art}`)
            debug(`    par=${par}, rack=${info.rack}, liqr=${info.liqr}`)
            let tab = urn.art.mul(par).mul(info.rack).mul(info.liqr).div(ray(1).pow(2))
            let cut = await hook.cut(i, u as Address)
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
                        sell = bill.mul(sell).div(earn.eq(0) ? 1 : earn);
                        earn = bill
                    }

                    if (profitable(i, sell, earn)) {
                        proms.push(new Promise(async (resolve, reject) => {
                            let res
                            try {
                                let urnfeeds :FeedPtr[] = hook.getUrnFeeds(i, u as Address)
                                let srcs = urnfeeds.map(f => f.src)
                                let tags = urnfeeds.map(f => ethers.utils.hexlify(b32(f.tag)))
                                // seems like gas estimator doesn't do well with raw calls that
                                // don't bubble up errors...
                                let tx = await send(
                                    strat.fill_flip, b32(i), u, [], [], {gasLimit: 1000000000}
                                )
                                for (let event of tx.events) {
                                    if (event.topics[0] == FLIP_FAILED) {
                                        throw Error(event.data)
                                    }
                                }
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
        }
    }

    return proms
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

    let erc20hook = new ERC20Hook()
    let nfthook   = new UniV3NFTHook()
    hooks['erc20hook.0'] = erc20hook
    hooks['univ3nfthook.0'] = nfthook
    nfthook.wrap = dapp.uniswapV3Wrapper


    await send(dapp.rico.approve, bank.address, ethers.constants.MaxUint256)
    await send(dapp.risk.approve, bank.address, ethers.constants.MaxUint256)

    let ilks = args.ilks.split(';')
    for (let i of ilks) {
        const bankilk = bank.ilks(b32(i))
        const fsrc = (await bank.callStatic.gethi(b32(i), b32('fsrc'), b32(i))).slice(0, 42)
        const ftag = xtos(await bank.callStatic.gethi(b32(i), b32('ftag'), b32(i)))
        ilkinfos[i] = {
            // src and tag of feed to pull from
            urns: {},
            hook: i.startsWith(':uninft') ? 'univ3nfthook.0' : 'erc20hook.0',
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

    let feedptrs = hooks['erc20hook.0'].getFeeds().concat(
        hooks['univ3nfthook.0'].getFeeds()
    )

    let fsrcs = feedptrs.map(f => ethers.utils.hexZeroPad(f.src, 32))
    let ftags = feedptrs.map(f => ethers.utils.hexlify(b32(f.tag)))
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
                proms = proms.concat(await scanilk(i, args.tol, args.minrush))
            }
            await Promise.all(proms)
        } catch (e) {
            debug('scanilk failed:')
            debug(e)
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
            let [ricogain, riskgain] = await strat.callStatic.fill_flap([])
            if (ricogain > args.expected_rico || riskgain > args.expected_risk) {
                await send(strat.fill_flap, [])
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

export { run_keeper, create_path, join_pool }
