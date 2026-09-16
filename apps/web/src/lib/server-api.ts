const DEFAULT_API_BASE = 'http://localhost:8080'

export function getServerApiBase() {
  return (
    process.env.BLOCKXONE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_API_BASE
  ).replace(/\/$/, '')
}

export async function proxyJsonToApi(path: string, init: RequestInit = {}) {
  const response = await fetch(`${getServerApiBase()}${path}`, {
    ...init,
    cache: 'no-store',
  })

  const contentType = response.headers.get('content-type') || 'application/json'
  const body = await response.text()

  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': contentType,
    },
  })
}
