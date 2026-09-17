import { handleWalletRequest } from '@/lib/wallets/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = handleWalletRequest
export const POST = handleWalletRequest
export const PUT = handleWalletRequest
export const PATCH = handleWalletRequest
export const DELETE = handleWalletRequest
export const OPTIONS = handleWalletRequest
export const HEAD = handleWalletRequest
