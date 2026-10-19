import 'server-only'
import { createAuthenticatedFundingRpc, FundingVerificationError } from './funding-verifier'

/** One operation captures its TEST credentials; nothing is read at import time. */
export function createFundServerRpc(fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  if (process.env.BLOCKXONE_ENVIRONMENT !== 'TESTNET') throw new FundingVerificationError('RPC_AUTH_NOT_ADMITTED', 409)
  return createAuthenticatedFundingRpc(process.env.BLOCKXONE_AMOY_RPC_CLIENT_ID,
    process.env.BLOCKXONE_AMOY_RPC_SECRET_KEY, fetcher, signal, process.env.BLOCKXONE_AMOY_ALCHEMY_RPC_SECRET_KEY)
}
