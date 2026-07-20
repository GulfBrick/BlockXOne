import assert from 'node:assert/strict'
import test from 'node:test'

import policy from './production-url-policy.cjs'

const { validateProductionApiUrl, validateServerActionOrigins } = policy

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
