# BlockXOne public website release

This existing Vercel project hosts the public website only. It does not host the
Go API, accept platform logins, or execute blockchain transactions.

The user requested deployment on the existing plan without a purchase. Vercel
Hobby can technically deploy this website, but its published usage rules permit
personal, non-commercial use. Deployment does not establish that a commercial
BlockXOne website complies with those rules. Review the plan before commercial
operation: https://vercel.com/docs/plans/hobby

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
| `NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT` | `https://oqkevkjbkpugjotihtda.supabase.co/functions/v1/demo-request` |
| `SERVER_ACTION_ALLOWED_ORIGINS` | `bx1.co.za,www.bx1.co.za,block-x-one.vercel.app` |

Leave `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL` unset for
this public showcase release. The actual Supabase endpoint is configured but
intake is disabled, so this website does not submit enquiries to it. This is
not a connection between the core platform database or login system and Supabase.
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
