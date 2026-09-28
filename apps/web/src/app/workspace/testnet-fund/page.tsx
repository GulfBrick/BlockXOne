import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { TestnetFundDemo } from '@/components/testnet-fund/testnet-fund-demo'
import { DemoError, loadTestnetFundPage } from '@/lib/testnet-fund/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata = { title: 'Fund lifecycle | Amoy demonstration', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }
export default async function TestnetFundPage() {
  let data: Awaited<ReturnType<typeof loadTestnetFundPage>> | null = null
  let status = 503
  try { data = await loadTestnetFundPage() } catch (error) { if (error instanceof DemoError) status = error.status }
  if (!data && status === 404) notFound()
  if (!data && status === 401) redirect('/login')
  return <PublicShell>{data ? <TestnetFundDemo initial={data.snapshot} workspace={data.workspace} artifactAvailable={data.configuration.contractArtifactAvailable} chainReady={data.configuration.receiptVerifierConfigured} /> : <main className="mx-auto max-w-4xl px-6 py-16"><h1 className="text-3xl">Fund demo unavailable</h1><p className="mt-4">The hosted demo is not ready for this session. Your existing workspace has not changed.</p><a href="/workspace" className="mt-6 inline-block underline">Return to workspace</a></main>}</PublicShell>
}
