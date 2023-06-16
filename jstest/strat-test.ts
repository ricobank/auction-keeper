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

describe('keeper', () => {
  let ali, bob, cat
  let ALI, BOB, CAT
  let fb
  let bank
  let strat
  let keeper
  let ploker
  let weth
  let rico
  let mdn
  let dapp
  let divider

  before(async () => {
    [ali, bob, cat] = await ethers.getSigners();
    [ALI, BOB, CAT] = [ali, bob, cat].map(signer => signer.address)
    const pack = await hh.run('deploy-strat', { mock: 'true', netname: 'ethereum', writepack: 'true', tokens: './tokens.json'})
    dapp = await dpack.load(pack, ethers, ali)

    fb = dapp.feedbase
    bank = dapp.bank
    strat = dapp.strat
    ploker = dapp.ploker
    weth = await ethers.getContractAt('WethLike', dapp.weth.address)
    rico = dapp.rico
    mdn = dapp.mdn
    divider = dapp.divider

    await hh.run('schedule', { fliptime: '2000', floptime: '1000', flaptime: '500' })

    await send(bank.file, b32("tag"), TAG)
    /*
    await send(bank.link, b32("tip"), ALI)

    await send(bank.file, b32("cap"), b32(ray(3)))

    await send(bank.file, b32('par'), b32(wad(7)))
   */

    await snapshot(hh);
  })

  beforeEach(async () => {
    await revert(hh);
  })

  const gettime = async () => {
    const blocknum = await ethers.provider.getBlockNumber()
    return (await ethers.provider.getBlock(blocknum)).timestamp
  }

  it('fill_flip', async () => {
      await send(bank.filhi, b32('weth'), b32('fsrc'), b32('weth'), ALI + '00'.repeat(12))
      await send(fb.push, b32('weth:rico'), bn2b32(ray(1)), await gettime() * 2)


      let amt = ethers.BigNumber.from('10000000000000000000000')
      await send(weth.deposit, {value: amt})
      await send(weth.approve, bank.address, ethers.constants.MaxUint256)
      await send(ploker.ploke, b32('weth:rico'))

      let dink = ethers.utils.solidityPack(["int256"], [amt])
      await send(bank.frob, b32('weth'), ALI, dink, amt, {gasLimit: 10000000000})

      await send(fb.push, b32('weth:rico'), bn2b32(ray(0.5)), await gettime() * 2)
      await send(rico.approve, bank.address, ethers.constants.MaxUint256)
      await send(bank.bail, b32('weth'), ALI)

  })
})
