const {
  validateProductionApiUrl,
  validateServerActionOrigins,
} = require('./scripts/production-url-policy.cjs')

const isProduction = process.env.NODE_ENV === 'production'
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL || (isProduction ? '' : 'http://localhost:8080')

if (isProduction) {
  validateProductionApiUrl(configuredApiUrl)
}

const serverActionAllowedOrigins = isProduction
  ? validateServerActionOrigins(process.env.SERVER_ACTION_ALLOWED_ORIGINS)
  : ['localhost:3000']

const apiOrigin = configuredApiUrl ? new URL(configuredApiUrl).origin : ''

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
            value: `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ${apiOrigin} https://*.firebaseio.com https://*.googleapis.com; frame-src https://accounts.google.com;`
          }
        ]
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${configuredApiUrl}/:path*`
      }
    ]
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
