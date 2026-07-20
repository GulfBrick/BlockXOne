const net = require('node:net')

const nonGlobalIPv4 = new net.BlockList()
const nonGlobalIPv6 = new net.BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  nonGlobalIPv4.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  nonGlobalIPv6.addSubnet(network, prefix, 'ipv6')
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
}

function isNonGlobalHostname(hostname) {
  const normalized = normalizeHostname(hostname)
  if (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'localdomain' ||
    normalized.endsWith('.localdomain') ||
    normalized.endsWith('.local') ||
    normalized.includes('%')
  ) {
    return true
  }

  const family = net.isIP(normalized)
  if (family === 4) return nonGlobalIPv4.check(normalized, 'ipv4')
  if (family === 6) return nonGlobalIPv6.check(normalized, 'ipv6')
  return false
}

function validateProductionApiUrl(raw) {
  let parsed
  try {
    parsed = new URL(String(raw || '').trim())
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL must be an absolute remote HTTPS origin for a production build')
  }

  if (
    parsed.protocol !== 'https:' ||
    isNonGlobalHostname(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('NEXT_PUBLIC_API_URL must be an absolute remote HTTPS origin for a production build')
  }

  return parsed
}

function validateServerActionOrigins(raw) {
  const origins = String(raw || '').split(',').map((origin) => origin.trim()).filter(Boolean)
  if (origins.length === 0) {
    throw new Error('SERVER_ACTION_ALLOWED_ORIGINS must contain at least one explicit remote host')
  }

  for (const origin of origins) {
    let parsed
    try {
      parsed = new URL(`https://${origin}`)
    } catch {
      throw new Error('SERVER_ACTION_ALLOWED_ORIGINS must contain only explicit remote hosts')
    }
    if (
      origin.includes('*') ||
      origin !== parsed.host ||
      isNonGlobalHostname(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('SERVER_ACTION_ALLOWED_ORIGINS must contain only explicit remote hosts')
    }
  }

  return origins
}

module.exports = { isNonGlobalHostname, validateProductionApiUrl, validateServerActionOrigins }
