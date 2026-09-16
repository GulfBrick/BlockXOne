import assert from 'node:assert/strict'
import test from 'node:test'

import policy from './production-url-policy.cjs'

const {
  resolveProductionWebSurface,
  validateProductionApiUrl,
  validateProductionDemoRequestEndpoint,
  validateProductionDemoRequestConfiguration,
  validateProductionPrivacyNoticeUrl,
  validateServerActionOrigins,
} = policy
const pairedPilot = { releaseMode: 'pilot', publicReleaseMode: 'pilot' }
const pairedPilotShare = { releaseMode: 'pilot-share', publicReleaseMode: 'pilot-share' }

test('demo requests are disabled by default and can omit intake configuration', () => {
  assert.equal(validateProductionDemoRequestConfiguration(), false)
  assert.equal(validateProductionDemoRequestConfiguration({ enabled: 'false' }), false)
  assert.throws(
    () => validateProductionDemoRequestConfiguration({ enabled: 'TRUE' }),
    /must be true or false/
  )
})

test('enabling demo requests fails closed without both endpoint and privacy notice', () => {
  assert.throws(
    () => validateProductionDemoRequestConfiguration({ enabled: 'true' }),
    /NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT/
  )
  assert.throws(
    () => validateProductionDemoRequestConfiguration({
      enabled: 'true', endpoint: 'https://forms.example.com/demo-request',
    }),
    /NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL/
  )
  assert.equal(validateProductionDemoRequestConfiguration({
    enabled: 'true',
    endpoint: 'https://forms.example.com/demo-request',
    privacyNoticeUrl: 'https://legal.example.com/privacy',
  }), true)
})

test('accepts only remote HTTPS API origins', () => {
  for (const value of [
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com:8443',
    'https://8.8.8.8',
    'https://[2001:4860:4860::8888]',
  ]) {
    assert.doesNotThrow(() => validateProductionApiUrl(value), value)
  }
})

test('accepts explicit remote server-action hosts', () => {
  assert.deepEqual(
    validateServerActionOrigins('app.example.com,admin.example.com:8443'),
    ['app.example.com', 'admin.example.com:8443']
  )
})

test('accepts remote HTTPS origins in explicit paired pilot-share mode', () => {
  assert.doesNotThrow(() => validateProductionApiUrl('https://pilot.example.com', pairedPilotShare))
  assert.deepEqual(
    validateServerActionOrigins('pilot.example.com', pairedPilotShare),
    ['pilot.example.com']
  )
  assert.throws(
    () => validateProductionApiUrl('http://127.0.0.1:23201', pairedPilotShare),
    /remote HTTPS origin/
  )
})

test('requires a paired explicit public-only web surface', () => {
  assert.equal(resolveProductionWebSurface(), 'platform')
  assert.equal(
    resolveProductionWebSurface({ webSurface: 'public', publicWebSurface: 'public' }),
    'public'
  )
  assert.throws(
    () => resolveProductionWebSurface({ webSurface: 'public', publicWebSurface: '' }),
    /must be set to the same value/
  )
  assert.throws(
    () => resolveProductionWebSurface({ webSurface: 'marketing', publicWebSurface: 'marketing' }),
    /either platform or public/
  )
})

test('accepts only remote HTTPS demo-request endpoints', () => {
  for (const value of [
    'https://example.supabase.co/functions/v1/demo-request',
    'https://forms.example.com/demo-request',
  ]) {
    assert.doesNotThrow(() => validateProductionDemoRequestEndpoint(value), value)
  }

  for (const value of [
    '',
    'http://forms.example.com/demo-request',
    'https://localhost/demo-request',
    'https://127.0.0.1/demo-request',
    'https://user:password@forms.example.com/demo-request',
    'https://forms.example.com/demo-request?secret=value',
    'https://forms.example.com/demo-request#fragment',
  ]) {
    assert.throws(
      () => validateProductionDemoRequestEndpoint(value),
      /absolute remote HTTPS URL/,
      value
    )
  }
})

test('accepts only remote HTTPS privacy-notice URLs', () => {
  assert.doesNotThrow(() => validateProductionPrivacyNoticeUrl('https://legal.example.com/privacy'))
  assert.throws(
    () => validateProductionPrivacyNoticeUrl('http://legal.example.com/privacy'),
    /NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL must be an absolute remote HTTPS URL/
  )
})

test('accepts loopback API origins and server-action hosts only with paired pilot flags', () => {
  for (const value of [
    'http://localhost:23201',
    'https://localhost:23201/',
    'http://127.0.0.1:23201',
    'http://127.42.0.9:23201',
    'https://[::1]:23201',
  ]) {
    assert.doesNotThrow(() => validateProductionApiUrl(value, pairedPilot), value)
  }

  assert.deepEqual(
    validateServerActionOrigins('localhost:23200,127.0.0.1:23200,[::1]:23200', pairedPilot),
    ['localhost:23200', '127.0.0.1:23200', '[::1]:23200']
  )
})

test('rejects a loopback policy when only one release flag is pilot', () => {
  for (const options of [
    { releaseMode: 'pilot', publicReleaseMode: '' },
    { releaseMode: '', publicReleaseMode: 'pilot' },
    { releaseMode: 'pilot', publicReleaseMode: 'production' },
    { releaseMode: 'production', publicReleaseMode: 'pilot' },
    { releaseMode: 'pilot-share', publicReleaseMode: '' },
    { releaseMode: '', publicReleaseMode: 'pilot-share' },
    { releaseMode: 'pilot-share', publicReleaseMode: 'pilot' },
  ]) {
    assert.throws(
      () => validateProductionApiUrl('http://127.0.0.1:23201', options),
      /must match to enable a pilot production mode/
    )
    assert.throws(
      () => validateServerActionOrigins('127.0.0.1:23200', options),
      /must match to enable a pilot production mode/
    )
  }
})

test('pilot policy rejects remote, LAN, private, wildcard, path, and credentialed values', () => {
  for (const value of [
    'https://api.example.com',
    'http://0.0.0.0:23201',
    'http://10.0.0.1:23201',
    'http://172.16.0.1:23201',
    'http://192.168.1.1:23201',
    'http://169.254.169.254:23201',
    'http://[fd00::1]:23201',
    'http://[fe80::1]:23201',
    'http://[::ffff:127.0.0.1]:23201',
    'http://*.localhost:23201',
    'http://user:password@localhost:23201',
    'http://localhost:23201/v1',
    'http://localhost:23201?tenant=one',
    'http://localhost:23201#fragment',
  ]) {
    assert.throws(
      () => validateProductionApiUrl(value, pairedPilot),
      /absolute loopback HTTP\(S\) origin/,
      value
    )
  }

  for (const value of [
    '*',
    '*.localhost:23200',
    'app.example.com',
    '0.0.0.0:23200',
    '10.0.0.1:23200',
    '172.16.0.1:23200',
    '192.168.1.1:23200',
    '169.254.169.254:23200',
    '[fd00::1]:23200',
    '[fe80::1]:23200',
    '[::ffff:127.0.0.1]:23200',
    'user@localhost:23200',
    'localhost:23200/path',
    'http://localhost:23200',
  ]) {
    assert.throws(
      () => validateServerActionOrigins(value, pairedPilot),
      /explicit loopback host/,
      value
    )
  }
})

test('rejects missing, wildcard, URL-shaped, local, and non-global server-action hosts', () => {
  for (const value of [
    '',
    '*',
    'https://app.example.com',
    'user@app.example.com',
    'app.example.com/path',
    'localhost.',
    '127.0.0.1',
    '10.0.0.1',
    '[::1]',
    '[fd00::1]',
  ]) {
    assert.throws(() => validateServerActionOrigins(value), /explicit remote host/, value)
  }
})

test('rejects malformed, non-HTTPS, credentialed, and non-origin API values', () => {
  for (const value of [
    '',
    'api.example.com',
    'http://api.example.com',
    'wss://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com/v1',
    'https://api.example.com?tenant=one',
    'https://api.example.com#fragment',
  ]) {
    assert.throws(() => validateProductionApiUrl(value), /remote HTTPS origin/, value)
  }
})

test('rejects local, private, link-local, unspecified, multicast, and mapped addresses', () => {
  for (const value of [
    'https://localhost.',
    'https://api.localhost.',
    'https://127.0.0.1',
    'https://0.0.0.0',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://192.168.1.1',
    'https://169.254.169.254',
    'https://224.0.0.1',
    'https://[::1]',
    'https://[fd00::1]',
    'https://[fe80::1]',
    'https://[ff02::1]',
    'https://[::ffff:127.0.0.1]',
  ]) {
    assert.throws(() => validateProductionApiUrl(value), /remote HTTPS origin/, value)
  }
})
