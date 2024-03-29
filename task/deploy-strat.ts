// copyright (c) 2023 halys

import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-ethers'

const debug = require('debug')('strat:task')
const dpack = require('@etherpacks/dpack')
import { b32, ray, rad, send, wad, BANKYEAR } from 'minihat'

task('deploy-strat', '')
  .addOptionalParam('gasLimit', 'per-tx gas limit')
  .addOptionalParam('tokens', 'file to load tokens from')
  .addOptionalParam('ricopack', 'pack to load rico from')
  .addParam('netname', 'network name to load packs from')
  .setAction(async (args, hre) => {
    debug('network name in task:', hre.network.name)
    const [ali] = await hre.ethers.getSigners()

    let deps
    if (!args.ricopack) {
        deps = await hre.run(
            'deploy-ricobank', { tokens: args.tokens, mock: "true", netname: args.netname }
        )
    } else {
        deps = require(args.ricopack)
    }
    
    const strat_artifact = require('../artifacts/src/strat.sol/Strat.json')
    const strat_type = hre.ethers.ContractFactory.fromSolidity(strat_artifact, ali)
    const strat = await strat_type.deploy(
        deps.objects.bank.address,
        deps.objects.nonfungiblePositionManager.address,
        deps.objects.universalRouter.address
    )

    const pb = new dpack.PackBuilder(hre.network.name)
    await pb.packObject({
        objectname: 'strat',
        address: strat.address,
        typename: 'Strat',
        artifact: strat_artifact
    }, true)

    const pack = (await pb.merge(deps)).build()
    if (args.writepack) {
        const outfile = require('path').join(
            __dirname, `../pack/strat_${hre.network.name}.dpack.json`
        )
        const packstr = JSON.stringify(pack, null, 2)
        require('fs').writeFileSync(outfile, packstr)
    }
    return pack
  })
