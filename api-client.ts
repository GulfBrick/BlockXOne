/**
 * BlockXOne API Client
 * Type-safe client for all Go backend endpoints
 * Auto-injects auth headers: X-Dev-User-Id, X-Dev-Email, X-Dev-Roles
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface ApiOptions {
  userId?: string;
  email?: string;
  roles?: string[];
}

interface ApiError {
  code: string;
  message: string;
}

/**
 * Generic API call handler
 * Injects auth headers automatically
 */
async function apiCall<T>(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  options?: ApiOptions
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Inject auth headers
  if (options?.userId) {
    headers['X-Dev-User-Id'] = options.userId;
  }
  if (options?.email) {
    headers['X-Dev-Email'] = options.email;
  }
  if (options?.roles && options.roles.length > 0) {
    headers['X-Dev-Roles'] = options.roles.join(',');
  }

  const url = `${API_BASE}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw {
        code: data.code || 'API_ERROR',
        message: data.message || `API Error: ${response.status}`,
      } as ApiError;
    }

    return data as T;
  } catch (error: any) {
    if (error.code) throw error;
    throw {
      code: 'NETWORK_ERROR',
      message: error.message || 'Network error',
    } as ApiError;
  }
}

// ============================================================================
// AUTH API
// ============================================================================

export const authApi = {
  /**
   * GET /v1/me
   * Verify current user (dev auth)
   */
  me: async (userId: string, email: string) =>
    apiCall('/v1/me', 'GET', undefined, { userId, email }),
};

// ============================================================================
// KYC API
// ============================================================================

export const kycApi = {
  /**
   * POST /v1/kyc/cases
   * Create a new KYC case
   */
  createCase: async (
    userId: string,
    email: string,
    caseType: 'KYC' | 'AML' | 'FATCA'
  ) =>
    apiCall(
      '/v1/kyc/cases',
      'POST',
      { case_type: caseType },
      { userId, email }
    ),

  /**
   * POST /v1/kyc/cases/:id/submit
   * Submit KYC case for review
   */
  submitCase: async (userId: string, email: string, caseId: string) =>
    apiCall(`/v1/kyc/cases/${caseId}/submit`, 'POST', {}, { userId, email }),

  /**
   * GET /v1/kyc/cases/:id
   * Get KYC case details
   */
  getCase: async (userId: string, email: string, caseId: string) =>
    apiCall(`/v1/kyc/cases/${caseId}`, 'GET', undefined, { userId, email }),

  /**
   * POST /v1/kyc/cases/:id/approve
   * Approve KYC (compliance officer only)
   */
  approveCase: async (userId: string, email: string, roles: string[], caseId: string) =>
    apiCall(`/v1/kyc/cases/${caseId}/approve`, 'POST', {}, { userId, email, roles }),

  /**
   * POST /v1/kyc/cases/:id/reject
   * Reject KYC (compliance officer only)
   */
  rejectCase: async (userId: string, email: string, roles: string[], caseId: string, reason: string) =>
    apiCall(`/v1/kyc/cases/${caseId}/reject`, 'POST', { reason }, { userId, email, roles }),
};

// ============================================================================
// WALLET API
// ============================================================================

export const walletApi = {
  /**
   * POST /v1/wallets/connect
   * Connect/register an investor wallet
   */
  connect: async (
    userId: string,
    email: string,
    data: {
      address: string;
      chainId: number;
      message: string;
      signature: string;
    }
  ) =>
    apiCall('/v1/wallets/connect', 'POST', data, { userId, email }),

  /**
   * GET /v1/wallets
   * List investor's wallets
   */
  list: async (userId: string, email: string) =>
    apiCall('/v1/wallets', 'GET', undefined, { userId, email }),

  /**
   * POST /v1/wallets/:id/approve
   * Approve wallet for trading (compliance)
   */
  approve: async (userId: string, email: string, roles: string[], walletId: string) =>
    apiCall(`/v1/wallets/${walletId}/approve`, 'POST', {}, { userId, email, roles }),
};

// ============================================================================
// OFFERING API
// ============================================================================

export const offeringApi = {
  /**
   * GET /v1/offerings
   * List all live offerings
   */
  list: async (userId: string, email: string) =>
    apiCall('/v1/offerings', 'GET', undefined, { userId, email }),

  /**
   * GET /v1/offerings/:id
   * Get offering details
   */
  get: async (userId: string, email: string, offeringId: string) =>
    apiCall(`/v1/offerings/${offeringId}`, 'GET', undefined, { userId, email }),

  /**
   * POST /v1/offerings
   * Create a new offering (wealth manager)
   */
  create: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      name: string;
      description: string;
      price: number;
      chainId: number;
      currencyCode: string;
    }
  ) =>
    apiCall('/v1/offerings', 'POST', data, { userId, email, roles }),

  /**
   * PUT /v1/offerings/:id
   * Update offering details
   */
  update: async (
    userId: string,
    email: string,
    roles: string[],
    offeringId: string,
    data: any
  ) =>
    apiCall(`/v1/offerings/${offeringId}`, 'PUT', data, { userId, email, roles }),

  /**
   * POST /v1/offerings/:id/publish
   * Publish offering (make it live)
   */
  publish: async (userId: string, email: string, roles: string[], offeringId: string) =>
    apiCall(`/v1/offerings/${offeringId}/publish`, 'POST', {}, { userId, email, roles }),
};

// ============================================================================
// SUBSCRIPTION API (Token Purchase)
// ============================================================================

export const subscriptionApi = {
  /**
   * POST /v1/offerings/:id/subscribe
   * Create a subscription (invest in offering)
   */
  create: async (
    userId: string,
    email: string,
    offeringId: string,
    data: {
      units: string | number;
      amount: string | number;
    }
  ) =>
    apiCall(
      `/v1/offerings/${offeringId}/subscribe`,
      'POST',
      data,
      { userId, email }
    ),

  /**
   * GET /v1/subscriptions/:id
   * Get subscription details
   */
  get: async (userId: string, email: string, subscriptionId: string) =>
    apiCall(`/v1/subscriptions/${subscriptionId}`, 'GET', undefined, {
      userId,
      email,
    }),

  /**
   * POST /v1/subscriptions/:id/approve
   * Approve subscription (wealth manager/compliance)
   */
  approve: async (
    userId: string,
    email: string,
    roles: string[],
    subscriptionId: string
  ) =>
    apiCall(
      `/v1/subscriptions/${subscriptionId}/approve`,
      'POST',
      {},
      { userId, email, roles }
    ),

  /**
   * POST /v1/subscriptions/:id/reject
   * Reject subscription
   */
  reject: async (
    userId: string,
    email: string,
    roles: string[],
    subscriptionId: string,
    reason: string
  ) =>
    apiCall(
      `/v1/subscriptions/${subscriptionId}/reject`,
      'POST',
      { reason },
      { userId, email, roles }
    ),
};

// ============================================================================
// PORTFOLIO API
// ============================================================================

export const portfolioApi = {
  /**
   * GET /v1/portfolio
   * Get investor's portfolio holdings
   */
  get: async (userId: string, email: string) =>
    apiCall('/v1/portfolio', 'GET', undefined, { userId, email }),

  /**
   * GET /v1/portfolio/cap-table/:offeringId
   * Get cap table for offering
   */
  capTable: async (
    userId: string,
    email: string,
    roles: string[],
    offeringId: string
  ) =>
    apiCall(
      `/v1/portfolio/cap-table/${offeringId}`,
      'GET',
      undefined,
      { userId, email, roles }
    ),
};

// ============================================================================
// PAYMENT API
// ============================================================================

export const paymentApi = {
  /**
   * POST /v1/payments/notify
   * Notify system of payment receipt
   */
  notify: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      subscriptionId: string;
      method: 'bank_transfer' | 'card' | 'crypto';
      amount: number;
      reference: string;
      timestamp?: string;
    }
  ) =>
    apiCall('/v1/payments/notify', 'POST', data, { userId, email, roles }),
};

// ============================================================================
// MARKETPLACE API (P2P Trading)
// ============================================================================

export const marketplaceApi = {
  /**
   * POST /v1/marketplace/listings
   * Create a sell order (list tokens for sale)
   */
  createListing: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      offeringId: string;
      walletId: string;
      units: string | number;
      pricePerUnit: string | number;
    }
  ) =>
    apiCall('/v1/marketplace/listings', 'POST', data, { userId, email, roles }),

  /**
   * GET /v1/marketplace/listings
   * Get active listings
   */
  listListings: async (userId: string, email: string) =>
    apiCall('/v1/marketplace/listings', 'GET', undefined, { userId, email }),

  /**
   * POST /v1/marketplace/rfq
   * Create a request for quote (buy order)
   */
  createRfq: async (
    userId: string,
    email: string,
    data: {
      offeringId: string;
      units: string | number;
      maxPrice: string | number;
    }
  ) =>
    apiCall('/v1/marketplace/rfq', 'POST', data, { userId, email }),

  /**
   * GET /v1/marketplace/rfq
   * Get active RFQs
   */
  listRfq: async (userId: string, email: string) =>
    apiCall('/v1/marketplace/rfq', 'GET', undefined, { userId, email }),

  /**
   * POST /v1/marketplace/match
   * Match (settle) a trade
   */
  match: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      listingId: string;
      rfqId: string;
    }
  ) =>
    apiCall('/v1/marketplace/match', 'POST', data, { userId, email, roles }),
};

// ============================================================================
// TOKEN OPERATIONS API
// ============================================================================

export const tokenApi = {
  /**
   * POST /v1/token-batches/mint
   * Mint tokens for approved subscription
   */
  mint: async (
    userId: string,
    email: string,
    roles: string[],
    subscriptionId: string
  ) =>
    apiCall(
      '/v1/token-batches/mint',
      'POST',
      { subscription_id: subscriptionId },
      { userId, email, roles }
    ),

  /**
   * POST /v1/token-batches/burn
   * Burn tokens for redemption
   */
  burn: async (
    userId: string,
    email: string,
    roles: string[],
    redemptionId: string
  ) =>
    apiCall(
      '/v1/token-batches/burn',
      'POST',
      { redemption_id: redemptionId },
      { userId, email, roles }
    ),

  /**
   * POST /v1/tokens/freeze
   * Freeze tokens (restrict transfer)
   */
  freeze: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      fromAddress: string;
      amount: string;
      reason: string;
    }
  ) =>
    apiCall('/v1/tokens/freeze', 'POST', data, { userId, email, roles }),

  /**
   * POST /v1/tokens/unfreeze
   * Unfreeze frozen tokens
   */
  unfreeze: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      fromAddress: string;
      amount: string;
    }
  ) =>
    apiCall('/v1/tokens/unfreeze', 'POST', data, { userId, email, roles }),

  /**
   * POST /v1/tokens/force-transfer
   * Admin force transfer of tokens
   */
  forceTransfer: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      fromAddress: string;
      toAddress: string;
      amount: string;
      reason: string;
    }
  ) =>
    apiCall('/v1/tokens/force-transfer', 'POST', data, { userId, email, roles }),

  /**
   * GET /v1/offerings/:id/nav
   * Get current Net Asset Value for offering
   */
  getNAV: async (userId: string, email: string, offeringId: string) =>
    apiCall(`/v1/offerings/${offeringId}/nav`, 'GET', undefined, {
      userId,
      email,
    }),

  /**
   * PUT /v1/offerings/:id/nav
   * Update NAV (wealth manager)
   */
  updateNAV: async (
    userId: string,
    email: string,
    roles: string[],
    offeringId: string,
    navPrice: number
  ) =>
    apiCall(
      `/v1/offerings/${offeringId}/nav`,
      'PUT',
      { nav: navPrice },
      { userId, email, roles }
    ),
};

// ============================================================================
// WHITELIST API
// ============================================================================

export const whitelistApi = {
  /**
   * POST /v1/whitelist/add
   * Add address to whitelist
   */
  add: async (
    userId: string,
    email: string,
    roles: string[],
    data: {
      address: string;
      offeringId?: string;
    }
  ) =>
    apiCall('/v1/whitelist/add', 'POST', data, { userId, email, roles }),

  /**
   * POST /v1/whitelist/remove
   * Remove address from whitelist
   */
  remove: async (
    userId: string,
    email: string,
    roles: string[],
    address: string
  ) =>
    apiCall(
      '/v1/whitelist/remove',
      'POST',
      { address },
      { userId, email, roles }
    ),

  /**
   * GET /v1/whitelist
   * Get whitelist entries
   */
  list: async (userId: string, email: string, roles: string[]) =>
    apiCall('/v1/whitelist', 'GET', undefined, { userId, email, roles }),
};

// ============================================================================
// REDEMPTION API
// ============================================================================

export const redemptionApi = {
  /**
   * POST /v1/redemptions/request
   * Request redemption of tokens
   */
  request: async (
    userId: string,
    email: string,
    data: {
      offeringId: string;
      amountTokens: string | number;
      amountCash: string | number;
    }
  ) =>
    apiCall('/v1/redemptions/request', 'POST', data, { userId, email }),

  /**
   * GET /v1/redemptions/:id
   * Get redemption details
   */
  get: async (userId: string, email: string, redemptionId: string) =>
    apiCall(`/v1/redemptions/${redemptionId}`, 'GET', undefined, {
      userId,
      email,
    }),

  /**
   * POST /v1/redemptions/:id/approve
   * Approve redemption request
   */
  approve: async (
    userId: string,
    email: string,
    roles: string[],
    redemptionId: string
  ) =>
    apiCall(
      `/v1/redemptions/${redemptionId}/approve`,
      'POST',
      {},
      { userId, email, roles }
    ),

  /**
   * POST /v1/redemptions/:id/reject
   * Reject redemption request
   */
  reject: async (
    userId: string,
    email: string,
    roles: string[],
    redemptionId: string,
    reason: string
  ) =>
    apiCall(
      `/v1/redemptions/${redemptionId}/reject`,
      'POST',
      { reason },
      { userId, email, roles }
    ),
};

// ============================================================================
// PAYOUT API
// ============================================================================

export const payoutApi = {
  /**
   * POST /v1/payouts/execute
   * Execute payouts for approved redemptions
   */
  execute: async (userId: string, email: string, roles: string[]) =>
    apiCall('/v1/payouts/execute', 'POST', {}, { userId, email, roles }),
};

// ============================================================================
// TRANSACTION/AUDIT API
// ============================================================================

export const transactionApi = {
  /**
   * GET /v1/transactions
   * List transactions
   */
  list: async (userId: string, email: string, roles?: string[]) =>
    apiCall('/v1/transactions', 'GET', undefined, { userId, email, roles }),

  /**
   * GET /v1/debug/subscriptions
   * Get all subscriptions (debug/admin)
   */
  listSubscriptions: async (userId: string, email: string, roles: string[]) =>
    apiCall('/v1/debug/subscriptions', 'GET', undefined, {
      userId,
      email,
      roles,
    }),
};

// ============================================================================
// HEALTH API
// ============================================================================

export const healthApi = {
  /**
   * GET /v1/health
   * Check API health
   */
  check: async () => apiCall('/v1/health', 'GET'),
};

// Export all APIs as namespace
export const blockXOneApi = {
  auth: authApi,
  kyc: kycApi,
  wallet: walletApi,
  offering: offeringApi,
  subscription: subscriptionApi,
  portfolio: portfolioApi,
  payment: paymentApi,
  marketplace: marketplaceApi,
  token: tokenApi,
  whitelist: whitelistApi,
  redemption: redemptionApi,
  payout: payoutApi,
  transaction: transactionApi,
  health: healthApi,
};
