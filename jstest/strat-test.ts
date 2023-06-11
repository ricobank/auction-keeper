const debug = require('debug')('rico:test')
import { expect as want } from 'chai'

import * as hh from 'hardhat'
// @ts-ignore
import { ethers } from 'hardhat'

import { send, N, wad, ray, rad, BANKYEAR, wait, warp, mine } from 'minihat'
const { hexZeroPad } = ethers.utils

import { b32, snapshot, revert } from 'minihat'
const dpack = require('@etherpacks/dpack')

const bn2b32 = (bn) => hexZeroPad(bn.toHexString(), 32)
const i0 = Buffer.alloc(32) // ilk 0 id
const TAG = Buffer.from('feed'.repeat(16), 'hex')

describe('Vox', () => {
  let ali, bob, cat
  let ALI, BOB, CAT
  let fb
  let bank
  let strat

  before(async () => {
    [ali, bob, cat] = await ethers.getSigners();
    [ALI, BOB, CAT] = [ali, bob, cat].map(signer => signer.address)
    const pack = await hh.run('deploy-strat', { mock: 'true', netname: 'ethereum' })
    const dapp = await dpack.load(pack, ethers, ali)

    fb = dapp.feedbase
    bank = dapp.bank
    strat = dapp.strat
    await snapshot(hh);
  })

  beforeEach(async () => {
    await revert(hh);
  })

  const gettime = async () => {
    const blocknum = await ethers.provider.getBlockNumber()
    return (await ethers.provider.getBlock(blocknum)).timestamp
  }

  it('strat deployed', async () => {
  })
})
