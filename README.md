
## auction keeper

Flash liquidation bot and stats printer for Rico Credit System 0.

On liquidation, `keeper` calls `strat.fill_flip`, which flash borrows Rico to fill the liquidation.  `fill_flip` then:

(a) if the ilk is erc20, trades the tokens through UniswapV3 for Rico to pay down the loan, or

(b) if the ilk is univ3, collects the tokens from the Uniswap positions and trades them through UniswapV3 to pay down the loan.  It stops collecting tokens from Uniswap positions when it has enough Rico, so the user ends up with some ERC20 tokens and some UniswapV3 positions containing ERC20 tokens.

## getting started

You need ipfs daemon running.

- `npm run initialize`

## deploying a new strat

- `npx hardhat --network <network> console`

In hardhat console:

- `dpack = require('@etherpacks/dpack')`
- `ali = await ethers.getSigner()`
- `pack = await hre.run('deploy-strat', { netname: <name of packfile's network>, writepack: 'true', tokens: <tokens_path> }`
- `dapp = await dpack.load(pack, ethers, ali)`

## running the keeper bot

In hardhat console:

- `{run_keeper, printStats} = require('./keeper')`
- `await run_keeper(args)`


`args` is an object composed of:

`signer`: the signer
`pack`: the dpack pack object containing `strat`
`fliptime`: Time between ilk scans
`aggs`: Object mapping aggregator address -> array of {src, tag} objects containing the feedbase feeds to read from when the aggregator emits AnswerUpdated
`flip`: true if bailing urns

To display urn stats:

- `getStats()`
