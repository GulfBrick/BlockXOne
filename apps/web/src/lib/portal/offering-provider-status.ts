import 'server-only'
import { platformRelease } from '@/lib/platform-release'
import { createDocusignOfferingProvider, docusignOfferingConfig, DocusignOfferingError } from './docusign-offering-provider'

const authenticationClassifiers = [
  'NOT_CONFIGURED', 'AUTHENTICATION_UNAVAILABLE', 'ACCOUNT_MISMATCH',
  'PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE_INVALID', 'THROTTLED',
] as const
type FailureClassifier = typeof authenticationClassifiers[number]
export type OfferingProviderStatus = {
  status: 'AVAILABLE' | 'UNAVAILABLE'
  classifier: 'AUTHENTICATED' | FailureClassifier
  checkedAt: string
}

/** Authentication only: no envelope, lease, purpose, policy or provider result is created. */
export async function readOfferingProviderStatus(env: Record<string, string | undefined> = process.env): Promise<OfferingProviderStatus> {
  try {
    if (platformRelease(env)?.environment !== 'TESTNET') throw new DocusignOfferingError('NOT_CONFIGURED')
    const deadline = AbortSignal.timeout(20_000)
    const provider = createDocusignOfferingProvider(docusignOfferingConfig(env), {
      fetch: (input, init) => globalThis.fetch(input, { ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline }),
    })
    // The existing adapter validates the sealed RSA JWT, sender, exact sandbox
    // account and base URI. Neither token nor userinfo leaves that adapter.
    await provider.authenticate()
    return { status: 'AVAILABLE', classifier: 'AUTHENTICATED', checkedAt: new Date().toISOString() }
  } catch (error) {
    const classifier = error instanceof DocusignOfferingError
      && authenticationClassifiers.some(value => value === error.code)
      ? error.code as FailureClassifier : 'PROVIDER_UNAVAILABLE'
    return { status: 'UNAVAILABLE', classifier, checkedAt: new Date().toISOString() }
  }
}
