/**
 * Fetch-level test containment only.
 *
 * This guard does not provide an OS firewall and does not cover node:http,
 * node:https, node:net, DNS, WebSocket, child processes, configuration checks,
 * lint, builds, or the production-containment probe. Test code can also
 * deliberately replace globalThis.fetch after this setup file runs.
 */

const guardedFetchMarker = Symbol.for('blockxone.hermeticFetchGuard')
const redirectStatuses = new Set([301, 302, 303, 307, 308])

type MarkedFetch = typeof fetch & { [key: symbol]: boolean | undefined }

function urlFromFetchInput(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string' || input instanceof URL) return new URL(input)
  return new URL(input.url)
}

export function isNormalizedLoopbackHostname(hostname: string): boolean {
  let normalized = hostname.toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1)

  if (normalized === 'localhost' || normalized === '::1') return true

  const octets = normalized.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every((octet) => {
    return /^\d{1,3}$/.test(octet) && Number(octet) <= 255
  })
}

export function assertHermeticHttpUrlAllowed(url: URL): void {
  if (!['http:', 'https:'].includes(url.protocol)) return
  if (isNormalizedLoopbackHostname(url.hostname)) return

  throw new Error(`Hermetic fetch guard blocked non-loopback HTTP(S) origin: ${url.protocol}//${url.host}`)
}

export function createHermeticFetch(nativeFetch: typeof fetch): typeof fetch {
  const guardedFetch: typeof fetch = async (input, init) => {
    const requestedUrl = urlFromFetchInput(input)
    if (!['http:', 'https:'].includes(requestedUrl.protocol)) {
      return nativeFetch(input, init)
    }

    assertHermeticHttpUrlAllowed(requestedUrl)

    const requestRedirect = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow')
    const guardedInit = requestRedirect === 'follow' ? { ...init, redirect: 'manual' as const } : init
    const response = await nativeFetch(input, guardedInit)

    if (response.url) {
      const responseUrl = new URL(response.url)
      assertHermeticHttpUrlAllowed(responseUrl)
    }

    if (requestRedirect === 'follow' && redirectStatuses.has(response.status)) {
      const location = response.headers.get('location')
      if (location) {
        const redirectUrl = new URL(location, requestedUrl)
        assertHermeticHttpUrlAllowed(redirectUrl)
      }
      throw new Error('Hermetic fetch guard blocks automatic HTTP(S) redirects; request the final loopback URL directly.')
    }

    return response
  }

  Object.defineProperty(guardedFetch, guardedFetchMarker, { value: true })
  return guardedFetch
}

const currentFetch = globalThis.fetch as MarkedFetch | undefined
if (currentFetch && !currentFetch[guardedFetchMarker]) {
  globalThis.fetch = createHermeticFetch(currentFetch.bind(globalThis))
}
