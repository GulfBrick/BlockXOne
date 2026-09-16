const net = require('node:net')

const nonGlobalIPv4 = new net.BlockList()
const nonGlobalIPv6 = new net.BlockList()
const loopbackIPv4 = new net.BlockList()

loopbackIPv4.addSubnet('127.0.0.0', 8, 'ipv4')

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

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname)
  if (normalized === 'localhost') return true

  const family = net.isIP(normalized)
  if (family === 4) return loopbackIPv4.check(normalized, 'ipv4')
  if (family === 6) return normalized === '::1'
  return false
}

function resolveProductionUrlPolicy(options = {}) {
  const releaseMode = String(options?.releaseMode || '').trim().toLowerCase()
  const publicReleaseMode = String(options?.publicReleaseMode || '').trim().toLowerCase()
  const serverPilot = releaseMode === 'pilot'
  const publicPilot = publicReleaseMode === 'pilot'
  const serverPilotShare = releaseMode === 'pilot-share'
  const publicPilotShare = publicReleaseMode === 'pilot-share'

  if (serverPilot !== publicPilot || serverPilotShare !== publicPilotShare) {
    throw new Error(
      'BLOCKXONE_RELEASE_MODE and NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE must match to enable a pilot production mode'
    )
  }

  if (serverPilot) return 'loopback-pilot'
  if (serverPilotShare) return 'remote-pilot'
  return 'remote-production'
}

function resolveProductionWebSurface(options = {}) {
  const serverSurface = String(options?.webSurface || '').trim().toLowerCase()
  const publicSurface = String(options?.publicWebSurface || '').trim().toLowerCase()

  if (serverSurface !== publicSurface) {
    throw new Error(
      'BLOCKXONE_WEB_SURFACE and NEXT_PUBLIC_BLOCKXONE_WEB_SURFACE must be set to the same value'
    )
  }

  if (!['', 'platform', 'public'].includes(serverSurface)) {
    throw new Error('BLOCKXONE_WEB_SURFACE must be either platform or public')
  }

  return serverSurface === 'public' ? 'public' : 'platform'
}

function validateProductionRemoteHttpsUrl(raw, variableName) {
  let parsed
  try {
    parsed = new URL(String(raw || '').trim())
  } catch {
    throw new Error(`${variableName} must be an absolute remote HTTPS URL`)
  }

  if (
    parsed.protocol !== 'https:' ||
    isNonGlobalHostname(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${variableName} must be an absolute remote HTTPS URL`)
  }

  return parsed
}

function validateProductionDemoRequestEndpoint(raw) {
  return validateProductionRemoteHttpsUrl(raw, 'NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT')
}

function validateProductionPrivacyNoticeUrl(raw) {
  return validateProductionRemoteHttpsUrl(raw, 'NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL')
}

function validateProductionDemoRequestConfiguration(options = {}) {
  const enabled = String(options.enabled || '').trim()
  if (!['', 'false', 'true'].includes(enabled)) {
    throw new Error('NEXT_PUBLIC_DEMO_REQUEST_ENABLED must be true or false')
  }
  if (enabled !== 'true') return false
  validateProductionDemoRequestEndpoint(options.endpoint)
  validateProductionPrivacyNoticeUrl(options.privacyNoticeUrl)
  return true
}

function validateProductionApiUrl(raw, options) {
  const policy = resolveProductionUrlPolicy(options)
  let parsed
  try {
    parsed = new URL(String(raw || '').trim())
  } catch {
    throw new Error(
      policy === 'loopback-pilot'
        ? 'NEXT_PUBLIC_API_URL must be an absolute loopback HTTP(S) origin for a pilot production build'
        : 'NEXT_PUBLIC_API_URL must be an absolute remote HTTPS origin for a production build'
    )
  }

  const invalidOrigin = (
    parsed.username ||
    parsed.password ||
    (parsed.pathname && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  )

  if (policy === 'loopback-pilot') {
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !isLoopbackHostname(parsed.hostname) ||
      invalidOrigin
    ) {
      throw new Error('NEXT_PUBLIC_API_URL must be an absolute loopback HTTP(S) origin for a pilot production build')
    }
    return parsed
  }

  if (
    parsed.protocol !== 'https:' ||
    isNonGlobalHostname(parsed.hostname) ||
    invalidOrigin
  ) {
    throw new Error('NEXT_PUBLIC_API_URL must be an absolute remote HTTPS origin for a production build')
  }

  return parsed
}

function validateServerActionOrigins(raw, options) {
  const policy = resolveProductionUrlPolicy(options)
  const origins = String(raw || '').split(',').map((origin) => origin.trim()).filter(Boolean)
  if (origins.length === 0) {
    throw new Error(
      policy === 'loopback-pilot'
        ? 'SERVER_ACTION_ALLOWED_ORIGINS must contain at least one explicit loopback host'
        : 'SERVER_ACTION_ALLOWED_ORIGINS must contain at least one explicit remote host'
    )
  }

  for (const origin of origins) {
    let parsed
    try {
      parsed = new URL(`https://${origin}`)
    } catch {
      throw new Error(
        policy === 'loopback-pilot'
          ? 'SERVER_ACTION_ALLOWED_ORIGINS must contain only explicit loopback hosts'
          : 'SERVER_ACTION_ALLOWED_ORIGINS must contain only explicit remote hosts'
      )
    }
    if (
      origin.includes('*') ||
      origin !== parsed.host ||
      (policy === 'loopback-pilot'
        ? !isLoopbackHostname(parsed.hostname)
        : isNonGlobalHostname(parsed.hostname)) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        policy === 'loopback-pilot'
          ? 'SERVER_ACTION_ALLOWED_ORIGINS must contain only explicit loopback hosts'
          : 'SERVER_ACTION_ALLOWED_ORIGINS must contain only explicit remote hosts'
      )
    }
  }

  return origins
}

module.exports = {
  isLoopbackHostname,
  isNonGlobalHostname,
  resolveProductionUrlPolicy,
  resolveProductionWebSurface,
  validateProductionApiUrl,
  validateProductionDemoRequestEndpoint,
  validateProductionDemoRequestConfiguration,
  validateProductionPrivacyNoticeUrl,
  validateServerActionOrigins,
}
