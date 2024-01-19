import { run_keeper } from './keeper'

let args = {
  url:      undefined,  // your RPC url
  mnemonic: undefined,
  pack:     undefined,  // path to dpack packfile
  fliptime: 2000,       // period between scans for unsafe urns
  ilks: 'weth;:uninft', // list of ilks
  aggs: {}              // (aggregator address) => [{ src, tag } objects]
                        // when aggregator emits AnswerUpdated keeper will pull new
                        // values from (src, tag) pairs
}


run_keeper(args)
