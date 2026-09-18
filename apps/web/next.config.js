const {
  resolveProductionWebSurface,
  validateProductionApiUrl,
  validateProductionDemoRequestEndpoint,
  validateProductionDemoRequestConfiguration,
  validateProductionPrivacyNoticeUrl,
  validateServerActionOrigins,
  validateSupabaseAuthConfiguration,
} = require('./scripts/production-url-policy.cjs')

const isProduction = process.env.NODE_ENV === 'production'
const authMode = validateSupabaseAuthConfiguration({
  authMode: process.env.BLOCKXONE_AUTH_MODE,
  publicAuthMode: process.env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE,
  supabaseUrl: process.env.SUPABASE_URL,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  appOrigin: process.env.BLOCKXONE_APP_ORIGIN,
  environment: process.env,
})
// Native identity is never proxied to the legacy Go API.
const configuredApiUrl = authMode === 'supabase' ? '' : process.env.NEXT_PUBLIC_API_URL || (isProduction ? '' : 'http://localhost:8080')
const configuredDemoRequestEndpoint = process.env.NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT || ''
const configuredPrivacyNoticeUrl = process.env.NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL || ''
const demoRequestEnabled = validateProductionDemoRequestConfiguration({
  enabled: process.env.NEXT_PUBLIC_DEMO_REQUEST_ENABLED,
  endpoint: configuredDemoRequestEndpoint,
  privacyNoticeUrl: configuredPrivacyNoticeUrl,
})
const productionUrlPolicy = {
  releaseMode: process.env.BLOCKXONE_RELEASE_MODE,
  publicReleaseMode: process.env.NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE,
}
const productionWebSurface = resolveProductionWebSurface({
  webSurface: process.env.BLOCKXONE_WEB_SURFACE,
  publicWebSurface: process.env.NEXT_PUBLIC_BLOCKXONE_WEB_SURFACE,
})
const isPublicOnlyProduction = isProduction && productionWebSurface === 'public'
const configuredRuntimeScope = String(process.env.NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE || '')
  .trim()
  .toUpperCase()

if (isProduction) {
  if (isPublicOnlyProduction || authMode === 'supabase') {
    // A public showcase may launch without collecting personal information.
    // Enabling enquiries still requires both reviewed endpoint and notice URLs.
    if (demoRequestEnabled) {
      validateProductionDemoRequestEndpoint(configuredDemoRequestEndpoint)
      validateProductionPrivacyNoticeUrl(configuredPrivacyNoticeUrl)
    }
  } else {
    if (configuredRuntimeScope !== 'TESTNET') {
      throw new Error(
        'NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE must be exactly TESTNET for a production platform build'
      )
    }
    validateProductionApiUrl(configuredApiUrl, productionUrlPolicy)
    if (configuredDemoRequestEndpoint) validateProductionDemoRequestEndpoint(configuredDemoRequestEndpoint)
    if (configuredPrivacyNoticeUrl) validateProductionPrivacyNoticeUrl(configuredPrivacyNoticeUrl)
  }
}

const serverActionAllowedOrigins = isProduction
  ? validateServerActionOrigins(process.env.SERVER_ACTION_ALLOWED_ORIGINS, authMode === 'supabase' ? undefined : productionUrlPolicy)
  : ['localhost:3000']

const apiOrigin = configuredApiUrl ? new URL(configuredApiUrl).origin : ''
const demoRequestOrigin = configuredDemoRequestEndpoint
  ? new URL(configuredDemoRequestEndpoint).origin
  : ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  transpilePackages: ['@blockxone/sdk-tokenization'],
  experimental: {
    serverActions: {
      allowedOrigins: serverActionAllowedOrigins
    }
  },
  async headers() {
    // VS Code's Simple Browser renders pages in an embedded webview/frame.
    // Apply these stricter security headers only in production to avoid
    // development preview issues (e.g., blank screen due to frame restrictions).
    if (process.env.NODE_ENV !== 'production') return []

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ${apiOrigin} ${demoRequestOrigin} https://*.firebaseio.com https://*.googleapis.com; frame-src https://accounts.google.com;`
          }
        ]
      },
      ...(authMode === 'supabase' ? ['/login', '/login/mfa', '/auth/:path*', '/workspace/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
          { key: 'Pragma', value: 'no-cache' },
          // Native forms need a non-null Origin. Middleware/metadata narrow
          // token-bearing URLs; Auth handlers retain no-referrer by default.
          { key: 'Referrer-Policy', value: source === '/auth/:path*' ? 'no-referrer' : 'strict-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      })) : []),
    ]
  },
  async rewrites() {
    if (authMode === 'supabase' || !configuredApiUrl) return []
    return [{
      source: '/api/:path*',
      destination: `${configuredApiUrl}/:path*`
    }]
  },
  webpack(config, { dev }) {
    // Dev-only: disable webpack's persistent filesystem cache. Serializing
    // large module arrays triggers a V8 fatal abort ("Lazy deopt after a fast
    // API call with return value is unsupported") on this toolchain. Falling
    // back to in-memory caching keeps HMR fast without the serialization crash.
    if (dev) {
      config.cache = { type: 'memory' }
    }
    return config
  }
}

module.exports = nextConfig
