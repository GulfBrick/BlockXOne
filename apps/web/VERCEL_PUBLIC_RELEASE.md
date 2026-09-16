# BlockXOne public website release

This existing Vercel project hosts the public website only. It does not host the
Go API, accept platform logins, or execute blockchain transactions.

The preparation branch `codex/bx1-public-site-20260916` has automatic Vercel
deployment explicitly disabled. This commercial website is held until the
existing team is on an eligible plan. After that is verified, remove the branch
hold, validate a hosted preview, and then merge/promote. The hold applies only
to this branch; it does not change the existing `main` branch behavior.

Project settings:

- Root Directory: `apps/web`
- Framework: Next.js
- Node.js: `22.x`
- Install and build commands: use `vercel.json`, which runs pinned Node `22.23.1`
  and npm `10.9.8` through npx without weakening the preflight gate.

Required public production environment:

| Variable | Value |
| --- | --- |
| `BLOCKXONE_WEB_SURFACE` | `public` |
| `NEXT_PUBLIC_BLOCKXONE_WEB_SURFACE` | `public` |
| `BLOCKXONE_RELEASE_MODE` | `production` |
| `NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE` | `production` |
| `NEXT_PUBLIC_DEMO_REQUEST_ENABLED` | `false` |
| `SERVER_ACTION_ALLOWED_ORIGINS` | `bx1.co.za,www.bx1.co.za,block-x-one.vercel.app` |

Leave `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT`, and
`NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL` unset for this public showcase release.
No database credentials, signer keys, platform JWT secrets, or Supabase secret
keys belong in this project.

Demo intake is off by default, even when stale endpoint or notice values exist.
The request-demo page displays an unavailable message without a form or input
controls. Enable intake only after publishing an approved privacy notice with
the real controller and privacy contact, reviewing the endpoint configuration,
and verifying submission handling. An enabled production build fails unless
both intake URLs are valid remote HTTPS URLs.

The existing platform-route containment is unchanged: protected application and
API routes return 404 in this public production release. A separately hosted
platform deployment needs its own reviewed runtime configuration and backend.
