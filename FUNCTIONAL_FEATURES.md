# BlockXOne Platform - Functional Features Guide

## Overview

The BlockXOne platform is now fully functional with working APIs and connected UIs across all major roles. This guide explains how to test each functional feature.

## Prerequisites

- **API Server**: Running on `http://localhost:8080`
- **Frontend**: Running on `http://localhost:5001`
- **Database**: Migrations applied (run `go run ./cmd/migrate` if needed)

## Authentication

### Admin Login
- **Email**: `admin@blockxone.local`
- **Password**: `Admin123!`
- **URL**: `http://localhost:5001/login`

After login, you'll be redirected to `/admin` dashboard.

## Functional Features

### 1. User Management (Super Admin)

**Location**: Admin → Users → Create New User

**Functionality**:
- View all users with their roles
- Create new users with custom roles
- Assign multiple roles to a single user
- Delete users (except yourself)

**API Endpoints**:
- `GET /v1/admin/users` - List all users
- `POST /v1/admin/users` - Create user
- `DELETE /v1/admin/users/:id` - Delete user
- `GET /v1/admin/stats` - Platform statistics

**Test Steps**:
1. Login as admin
2. Navigate to Admin → Users
3. Click "Create New User"
4. Enter email: `test@example.com`, password: `Test123!`
5. Select roles (e.g., Investor, ComplianceOfficer)
6. Click "Create User"
7. Verify user appears in the users list

### 2. Token Minting (Tokenisation Agent)

**Location**: Tokenisation Agent → Mint Tokens

**Functionality**:
- View eligible subscriptions (PAID or APPROVED status)
- Select subscription to mint tokens for
- Execute on-chain mint transaction
- Update holdings automatically
- Mark subscription as MINTED

**API Endpoints**:
- `GET /v1/debug/subscriptions` - List subscriptions
- `POST /v1/token-batches/mint` - Mint tokens

**Test Steps**:
1. Login as admin or token agent
2. Navigate to Tokenisation Agent → Mint Tokens
3. Review list of eligible subscriptions
4. Select a subscription
5. Click "Mint Tokens"
6. Verify success message with batch ID and TX hash

**Note**: To test minting, you'll need:
- An investor with APPROVED KYC
- An approved wallet on the correct chain
- A PAID subscription
- Wallet whitelisted for the offering

### 3. Compliance Queue (Compliance Officer)

**Location**: Compliance → Case queue

**Functionality**:
- View all pending KYC cases (SUBMITTED status)
- Filter by type (KYC/Wallet)
- Approve cases (grants platform access)
- Reject cases (requires resubmission)
- Real-time queue updates

**API Endpoints**:
- `GET /v1/compliance/queue` - List pending cases
- `POST /v1/compliance/cases/:id/approve` - Approve KYC
- `POST /v1/compliance/cases/:id/reject` - Reject KYC

**Test Steps**:
1. Login as admin or compliance officer
2. Navigate to Compliance → Case queue
3. View pending cases
4. Click "Approve" or "Reject" on a case
5. Verify case is removed from queue
6. Check investor profile is updated (for approved cases)

## API Testing

### Using the Dev Console

Navigate to `http://localhost:8080/console` for an interactive API testing UI with:
- Built-in MetaMask integration
- Request builder
- Response viewer
- Dev headers for testing different users

### Using Postman/curl

Example: Create a user as admin

```bash
curl -X POST http://localhost:8080/v1/admin/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BLOCKXONE_RUNTIME_ACCESS_TOKEN}" \
  -d '{
    "email": "newuser@example.com",
    "password": "Password123!",
    "roles": ["Investor"]
  }'
```

Example: Mint tokens

```bash
curl -X POST http://localhost:8080/v1/token-batches/mint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BLOCKXONE_RUNTIME_ACCESS_TOKEN}" \
  -d '{
    "subscription_id": "SUBSCRIPTION_UUID"
  }'
```

Example: Approve KYC case

```bash
curl -X POST http://localhost:8080/v1/compliance/cases/CASE_UUID/approve \
  -H "Authorization: Bearer ${BLOCKXONE_RUNTIME_ACCESS_TOKEN}"
```

## Database Queries

To inspect data directly:

```sql
-- View all users and their roles
SELECT u.email, r.name as role
FROM users u
JOIN user_org_roles uor ON uor.user_id = u.id
JOIN roles r ON r.id = uor.role_id
ORDER BY u.email;

-- View pending KYC cases
SELECT id, user_id, type, status, submitted_at
FROM kyc_cases
WHERE status = 'SUBMITTED'
ORDER BY submitted_at DESC;

-- View subscriptions ready for minting
SELECT id, offering_id, user_id, units, status
FROM subscriptions
WHERE status IN ('PAID', 'APPROVED')
ORDER BY created_at DESC;

-- View minted tokens
SELECT u.email, o.id as offering, h.balance
FROM holdings h
JOIN users u ON u.id = h.user_id
JOIN offerings o ON o.id = h.offering_id
WHERE h.balance > 0;
```

## Permissions

The platform uses role-based access control (RBAC):

### SuperAdmin
- Full platform access
- Can create/delete users
- View all statistics
- Access all dashboards

### TokenisationAgent
- `tokenops:whitelist` - Manage whitelist
- `tokenops:mint` - Mint tokens
- `tokenops:burn` - Burn tokens
- `offering:view` - View offerings

### ComplianceOfficer
- `compliance:queue:view` - View KYC queue
- `compliance:case:approve` - Approve/reject cases
- `wallet:approve` - Approve wallets
- `offering:view` - View offerings

### Investor
- `offering:view` - Browse marketplace
- `ledger:portfolio:view` - View holdings
- `marketplace:listing:create` - Sell tokens
- `marketplace:rfq:create` - Buy tokens

## Known Limitations

1. **Mock Chain Operations**: Token operations return simulated transaction hashes. Integration with real EVM chains requires additional configuration.

2. **Dev Mode Only**: The platform is currently configured for development. Production deployment requires:
   - Environment variables configuration
   - HTTPS setup
   - Database security hardening
   - Chain RPC configuration

3. **Minimal Validation**: Some endpoints have minimal validation for demo purposes. Production requires additional checks.

## Troubleshooting

### "Not authenticated" errors
- Ensure you're logged in
- Check JWT token in browser localStorage
- Token expires after 24 hours

### "Permission denied" errors
- Verify your role has the required permission
- Check role assignments in database
- Re-login if roles were changed

### Server not responding
- Check if API is running on port 8080
- Check if frontend is running on port 5001
- Restart servers if needed:
  ```powershell
  cd "C:\Users\danie\OneDrive\Documents\BlockXOne Test"
  # Kill existing processes
  Get-Process | Where-Object {$_.Path -like "*BlockXOne*"} | Stop-Process -Force
  # Start API
  $env:AUTH_MODE="jwt"; $env:JWT_SECRET="${BLOCKXONE_RUNTIME_API_KEY}"; go run ./cmd/api
  # In another terminal, start frontend
  cd apps/web; $env:PORT="5001"; npm run dev
  ```

## Next Steps

To make the platform production-ready:

1. **Complete Investor Flow**: Build KYC submission form, subscription workflow, wallet connection
2. **Issuer Portal**: NAV updates, subscription queue, distribution management
3. **Blockchain Integration**: Connect to real EVM networks, deploy smart contracts
4. **Testing**: Unit tests, integration tests, E2E tests
5. **Security**: Input validation, rate limiting, audit logging
6. **Documentation**: API docs, admin guides, user tutorials

## Support

For issues or questions:
- Check the API console at `http://localhost:8080/console`
- Review audit logs in the database
- Check browser console for frontend errors
- Review API server logs
