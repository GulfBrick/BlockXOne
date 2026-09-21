import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Deliberately hosted and manual: never run a local browser, target MAIN, supply
// credentials, accept terms, or exercise signup. Only an empty invalid POST is sent.
const ORIGIN = 'https://testnet.bx1.co.za'
const REGISTER = `${ORIGIN}/register`
const POST = `${ORIGIN}/auth/register`
const PLAYWRIGHT_VERSION = '1.63.0'
const expectation = process.env.BX1_REGISTRATION_BROWSER_EXPECTATION
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  || process.env.GITHUB_REPOSITORY !== 'GulfBrick/BlockXOne'
  || !['refs/heads/codex/branded-test-entry-20260921', 'refs/heads/codex/testnet-fund-demo-20260920'].includes(process.env.GITHUB_REF)
  || !['null-origin', 'canonical-origin'].includes(expectation)) throw new Error('FIXED_MANUAL_CLOUD_PROOF_REQUIRED')
if (!path.isAbsolute(process.env.RUNNER_TEMP || '')) throw new Error('EPHEMERAL_RUNNER_PATH_REQUIRED')
const runnerTemp = await realpath(process.env.RUNNER_TEMP)
const moduleDirectory = path.join(runnerTemp, 'bx1-registration-playwright', 'node_modules', 'playwright')
assert.equal(await realpath(moduleDirectory), moduleDirectory, 'PLAYWRIGHT_MUST_BE_IN_EXACT_EPHEMERAL_RUNNER_PATH')
const installed = JSON.parse(await readFile(path.join(moduleDirectory, 'package.json'), 'utf8'))
assert.equal(installed.name, 'playwright', 'EXPECTED_PLAYWRIGHT_PACKAGE')
assert.equal(installed.version, PLAYWRIGHT_VERSION, 'PINNED_PLAYWRIGHT_REQUIRED')
const { chromium } = await import(pathToFileURL(path.join(moduleDirectory, 'index.mjs')).href)

let browser, context, phase = 'launch', postCount = 0, blockedRequests = 0, submittedHeaders, routeFailure
const observed = {}
try {
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, viewport: { width: 1280, height: 900 } })
  context.setDefaultTimeout(15000)
  context.setDefaultNavigationTimeout(20000)
  // Fresh browser context: no imported cookies, storage, authentication or bypass.
  assert.equal((await context.cookies()).length, 0, 'FRESH_CONTEXT_REQUIRED')
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== ORIGIN || url.username || url.password) { blockedRequests++; await route.abort('blockedbyclient'); return }
    if (request.method() === 'POST' && url.href === POST && postCount === 0) {
      postCount++
      const original = new URLSearchParams(request.postData() || '')
      if (['email', 'password', 'confirmPassword'].some(key => Boolean(original.get(key))) || original.has('consent')) {
        routeFailure = 'NONEMPTY_OR_CONSENTED_FORM_REFUSED'
        await route.abort('blockedbyclient')
        return
      }
      const headers = await request.allHeaders()
      submittedHeaders = { origin: headers.origin ?? null, fetchSite: headers['sec-fetch-site'] ?? null, contentType: headers['content-type'] ?? null }
      // Change ONLY body bytes. Never set Origin, Referer, Host, cookies or any
      // other browser header. Empty-body validation precedes client.auth.signUp.
      await route.continue({ postData: '' })
      return
    }
    if (request.method() === 'GET' && !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/api/')) {
      // Page/assets only. No cross-origin provider traffic or extra mutations.
      await route.continue()
      return
    }
    blockedRequests++
    await route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  phase = 'load-real-registration-document'
  const documentResponse = await page.goto(REGISTER, { waitUntil: 'domcontentloaded' })
  assert.ok(documentResponse, 'REGISTRATION_RESPONSE_REQUIRED')
  assert.equal(documentResponse.status(), 200, 'PUBLIC_REGISTRATION_DOCUMENT_REQUIRED')
  assert.equal(page.url(), REGISTER, 'NO_SSO_REDIRECT_OR_ALTERNATE_ORIGIN')
  const responseHeaders = await documentResponse.allHeaders()
  const metaPolicies = await page.locator('meta[name="referrer"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('content')))
  observed.headerPolicy = responseHeaders['referrer-policy'] ?? null
  observed.metaPolicies = metaPolicies
  const expectedPolicy = expectation === 'null-origin' ? 'no-referrer' : 'strict-origin'
  assert.equal(responseHeaders['referrer-policy'], expectedPolicy, 'EXPECTED_REAL_DOCUMENT_HEADER_POLICY')
  assert.ok(metaPolicies.length > 0 && metaPolicies.every(policy => policy === expectedPolicy), 'EXPECTED_REAL_DOCUMENT_META_POLICY')
  assert.equal(await page.locator('form[action="/auth/register"][method="post"]').count(), 1, 'EXACT_NATIVE_REGISTRATION_FORM_REQUIRED')

  phase = 'native-empty-form-post'
  const postResponsePromise = page.waitForResponse(response => response.url() === POST && response.request().method() === 'POST')
  await page.evaluate(() => {
    const form = document.querySelector('form[action="/auth/register"][method="post"]')
    if (!(form instanceof HTMLFormElement) || form.action !== 'https://testnet.bx1.co.za/auth/register'
      || (form.target && form.target !== '_self')) throw new Error('UNEXPECTED_NATIVE_FORM')
    for (const name of ['email', 'password', 'confirmPassword']) {
      const field = form.querySelector(`[name="${name}"]`)
      if (!(field instanceof HTMLInputElement) || field.value !== '') throw new Error('FORM_NOT_EMPTY')
    }
    const consent = form.querySelector('[name="consent"]')
    if (!(consent instanceof HTMLInputElement) || consent.checked) throw new Error('CONSENT_MUST_REMAIN_UNCHECKED')
    // Native submission bypasses the required-field and React onSubmit checks,
    // not the server: the actual document's referrer policy still governs Origin.
    HTMLFormElement.prototype.submit.call(form)
  })
  const postResponse = await postResponsePromise
  observed.postStatus = postResponse.status()
  assert.equal(postCount, 1, 'EXACTLY_ONE_INVALID_POST')
  assert.ok(submittedHeaders, 'REAL_BROWSER_POST_HEADERS_REQUIRED')
  assert.equal(submittedHeaders.origin, expectation === 'null-origin' ? 'null' : ORIGIN, 'BROWSER_GENERATED_ORIGIN_MATCHES_EXPECTATION')
  assert.equal(submittedHeaders.fetchSite, 'same-origin', 'NATIVE_SAME_ORIGIN_SUBMISSION_REQUIRED')
  assert.ok(submittedHeaders.contentType?.startsWith('application/x-www-form-urlencoded'), 'NATIVE_FORM_CONTENT_TYPE_REQUIRED')
  const postHeaders = await postResponse.allHeaders()
  if (expectation === 'null-origin') {
    assert.equal(postResponse.status(), 403, 'BASELINE_NULL_ORIGIN_REJECTED')
    assert.equal(postHeaders.location, undefined, 'NO_BASELINE_REDIRECT')
    assert.deepEqual(await postResponse.json(), { ok: false, error: 'Registration request unavailable.' }, 'EXPECTED_BASELINE_SERVER_REJECTION')
  } else {
    assert.equal(postResponse.status(), 303, 'CANONICAL_POST_REACHES_SERVER_VALIDATION')
    assert.equal(postHeaders.location, `${REGISTER}?error=email_invalid`, 'EMPTY_BODY_CANNOT_REACH_SIGNUP')
    await page.waitForURL(`${REGISTER}?error=email_invalid`, { waitUntil: 'domcontentloaded' })
  }
  phase = 'complete'
  console.log(`BX1_REGISTRATION_BROWSER_PASS ${JSON.stringify({
    version: 1, expectation, target: REGISTER, workflowSource: process.env.GITHUB_SHA,
    playwright: PLAYWRIGHT_VERSION, chromium: browser.version(),
    headerPolicy: responseHeaders['referrer-policy'], metaPolicies,
    browserOrigin: submittedHeaders.origin, fetchSite: submittedHeaders.fetchSite,
    postStatus: postResponse.status(), location: postHeaders.location ?? null,
    postCount, sentBodyBytes: 0, consentAccepted: false, credentialsSupplied: false,
    accountCreationExercised: false, emailDeliveryProven: false, blockedRequests,
    hostedRequestId: responseHeaders['x-vercel-id'] ?? null, hostedSourceIdentityProven: false,
  })}`)
} catch (error) {
  console.error(`BX1_REGISTRATION_BROWSER_FAILED ${JSON.stringify({
    phase, expectation, postCount, ...observed,
    browserOrigin: submittedHeaders?.origin ?? null, fetchSite: submittedHeaders?.fetchSite ?? null,
    code: routeFailure ?? (error instanceof Error ? error.message.slice(0, 140) : 'UNKNOWN_FAILURE'),
  })}`)
  process.exitCode = 1
} finally {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
}
