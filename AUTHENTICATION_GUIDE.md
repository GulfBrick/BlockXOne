# Authentication Guide

BlockXOne Platform supports two authentication methods:

## 1. Email/Password Authentication

### Investor Signup
New investors can self-register:

**Endpoint:** `POST /v1/auth/signup`
```json
{
  "email": "investor@example.com",
  "password": "SecurePass123!"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user_id": "uuid-here",
  "email": "investor@example.com",
  "org_id": "investor-org-id",
  "role": "Investor"
}
```

New signups are automatically assigned the **Investor** role and redirected to KYC onboarding.

### Login
Existing users can log in:

**Endpoint:** `POST /v1/auth/login`
```json
{
  "email": "user@example.com",
  "password": "YourPassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user_id": "uuid-here",
  "email": "user@example.com",
  "org_id": "org-id",
  "role": "Investor"
}
```

### Super Admin Access
The platform includes a pre-configured super admin account:

**Email:** `admin@blockxone.local`  
**Password:** `Admin123!`

Super admins have full access to:
- User management
- Role assignment
- Tokenization agent management
- Issuer management
- Compliance oversight

## 2. Wallet Authentication

Users can also authenticate using MetaMask or other web3 wallets:

1. Connect wallet
2. Sign a message proving ownership
3. Link wallet to email address
4. Receive JWT token

**Endpoint:** `POST /v1/wallets/connect`

### Role-Aware Wallet Mapping
When connecting a wallet, the platform maps email addresses to specific roles:

- `investor@*` → Investor role
- `token.agent@*` → TokenisationAgent role
- `issuer@*` → IssuerFundManager role
- `transfer.agent@*` → TransferAgent role
- `compliance@*` → ComplianceOfficer role
- `admin@*` → SuperAdmin role

## Frontend Usage

The login page (`/login`) provides a unified interface with tabs for both methods:

```tsx
import { EmailLoginForm } from "@/components/auth/EmailLoginForm";
import { WalletWidget } from "@/components/wallet/WalletWidget";

// Email login
<EmailLoginForm />

// Wallet login
<WalletWidget />
```

## Token Management

All authentication methods return a JWT token that must be included in subsequent API requests:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Tokens are automatically stored in localStorage (`bx_auth_v2`) and included in all API calls via the auth context.

## Role-Based Routing

After successful authentication, users are automatically routed based on their role:

- **Investor** → `/investor/kyc` (if first login) or `/investor`
- **SuperAdmin** → `/admin`
- **TokenisationAgent** → `/tokenisation-agent`
- **IssuerFundManager** → `/issuer`
- **ComplianceOfficer** → `/compliance`

## Security Notes

- Passwords are hashed using bcrypt with default cost (10 rounds)
- JWT tokens expire after 24 hours
- API requires `AUTH_MODE=jwt` and `JWT_SECRET` environment variables
- Super admin credentials should be changed immediately in production
