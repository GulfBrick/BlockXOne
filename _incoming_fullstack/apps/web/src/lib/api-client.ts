// API client used by the Next.js app.
// Dev auth is implemented via request headers:
//   X-Dev-User-Id, X-Dev-Email, X-Dev-Roles

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export type ApiError = {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
};

type ApiCallOptions = {
  userId?: string;
  email?: string;
  roles?: string[];
  method?: string;
  body?: unknown;
};

async function apiCall<T>(endpoint: string, opts: ApiCallOptions = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (opts.userId) headers['X-Dev-User-Id'] = opts.userId;
  if (opts.email) headers['X-Dev-Email'] = opts.email;
  if (opts.roles && opts.roles.length > 0) headers['X-Dev-Roles'] = opts.roles.join(',');

  const method = (opts.method || 'GET').toUpperCase();
  const hasBody = opts.body !== undefined && method !== 'GET';
  if (hasBody) headers['Content-Type'] = 'application/json';

  const resp = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });

  const contentType = resp.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await resp.json().catch(() => null) : await resp.text().catch(() => '');

  if (!resp.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as any).error === 'string'
        ? (payload as any).error
        : payload &&
            typeof payload === 'object' &&
            payload !== null &&
            'message' in payload &&
            typeof (payload as any).message === 'string'
          ? (payload as any).message
          : `HTTP ${resp.status}`;

    const err: ApiError = {
      code: 'API_ERROR',
      message,
      status: resp.status,
      details: payload,
    };
    throw err;
  }

  return payload as T;
}

export const authApi = {
  me: (userId: string, email: string) => apiCall('/v1/me', { userId, email }),
};

export const offeringApi = {
  list: (userId: string, email: string) => apiCall('/v1/offerings', { userId, email }),
  get: (userId: string, email: string, offeringId: string) =>
    apiCall(`/v1/offerings/${offeringId}`, { userId, email }),
};

export const subscriptionApi = {
  create: (
    userId: string,
    email: string,
    offeringId: string,
    data: { units: string | number; amount: string | number }
  ) =>
    apiCall(`/v1/offerings/${offeringId}/subscribe`, {
      userId,
      email,
      method: 'POST',
      body: { units: String(data.units), amount: String(data.amount) },
    }),
  get: (userId: string, email: string, subscriptionId: string) =>
    apiCall(`/v1/subscriptions/${subscriptionId}`, { userId, email }),
};

export const portfolioApi = {
  get: (userId: string, email: string) => apiCall('/v1/portfolio', { userId, email }),
};

export const kycApi = {
  createCase: (userId: string, email: string, caseType: 'KYC' | 'AML' | 'FATCA') => {
    // Backend supports KYC|KYB. Map other demo options to KYC.
    const type = caseType === 'KYC' ? 'KYC' : 'KYC';
    return apiCall('/v1/kyc/cases', { userId, email, method: 'POST', body: { type } });
  },
  submitCase: (userId: string, email: string, caseId: string) =>
    apiCall(`/v1/kyc/cases/${caseId}/submit`, { userId, email, method: 'POST', body: {} }),
  getCase: (userId: string, email: string, caseId: string) =>
    apiCall(`/v1/kyc/cases/${caseId}`, { userId, email }),
};

export const walletApi = {
  connect: (
    userId: string,
    email: string,
    data: { address: string; chainId: number; message: string; signature: string }
  ) =>
    apiCall('/v1/wallets/connect', {
      userId,
      email,
      method: 'POST',
      body: { address: data.address, chain_id: data.chainId, message: data.message, signature: data.signature },
    }),
  list: (userId: string, email: string) => apiCall('/v1/wallets', { userId, email }),
};

export const marketplaceApi = {
  listListings: (userId: string, email: string) => apiCall('/v1/marketplace/listings', { userId, email }),
  createListing: (
    userId: string,
    email: string,
    roles: string[],
    data: { offeringId: string; walletId: string; units: string | number; pricePerUnit: string | number }
  ) =>
    apiCall('/v1/marketplace/listings', {
      userId,
      email,
      roles,
      method: 'POST',
      body: {
        offering_id: data.offeringId,
        wallet_id: data.walletId,
        units: String(data.units),
        price: String(data.pricePerUnit),
        currency: 'USD',
      },
    }),
  listRfq: (userId: string, email: string) => apiCall('/v1/marketplace/rfq', { userId, email }),
  createRfq: (userId: string, email: string, data: { offeringId: string; units: string | number; maxPrice: string | number }) =>
    apiCall('/v1/marketplace/rfq', {
      userId,
      email,
      method: 'POST',
      body: {
        offering_id: data.offeringId,
        wallet_id: '',
        units: String(data.units),
        max_price: String(data.maxPrice),
        currency: 'USD',
      },
    }),
};

export const tokenApi = {
  mint: (userId: string, email: string, roles: string[], subscriptionId: string) =>
    apiCall('/v1/token-batches/mint', {
      userId,
      email,
      roles,
      method: 'POST',
      body: { subscription_id: subscriptionId },
    }),
  getNAV: (userId: string, email: string, offeringId: string) => apiCall(`/v1/offerings/${offeringId}/nav`, { userId, email }),
};

export const redemptionApi = {
  request: (
    userId: string,
    email: string,
    data: { offeringId: string; amountTokens: string | number; amountCash: string | number }
  ) =>
    apiCall('/v1/redemptions/request', {
      userId,
      email,
      method: 'POST',
      body: {
        offering_id: data.offeringId,
        amount_tokens: String(data.amountTokens),
        amount_cash: String(data.amountCash),
      },
    }),
  get: (userId: string, email: string, redemptionId: string) => apiCall(`/v1/redemptions/${redemptionId}`, { userId, email }),
};

export const paymentApi = {
  notify: (
    userId: string,
    email: string,
    roles: string[],
    data: { subscriptionId: string; method: string; amount: number; reference: string; timestamp?: string }
  ) =>
    apiCall('/v1/payments/notify', {
      userId,
      email,
      roles,
      method: 'POST',
      body: {
        subscription_id: data.subscriptionId,
        method: data.method,
        amount: String(data.amount),
        reference: data.reference,
      },
    }),
};

export const transactionApi = {
  list: (userId: string, email: string, roles?: string[]) => apiCall('/v1/transactions', { userId, email, roles }),
  listSubscriptions: (userId: string, email: string, roles: string[]) =>
    apiCall('/v1/debug/subscriptions', { userId, email, roles }),
};


export const chainsApi = {
  list: () => apiCall('/v1/chains'),
};

export const onrampApi = {
  quote: (userId: string, email: string, data: { provider: string; fiat_currency: string; crypto_currency: string; fiat_amount: string; chain_id: number }) =>
    apiCall('/v1/onramp/quote', { userId, email, method: 'POST', body: data }),
  session: (userId: string, email: string, data: { provider: string; chain_id: number }) =>
    apiCall('/v1/onramp/session', { userId, email, method: 'POST', body: data }),
};

export const offrampApi = {
  quote: (userId: string, email: string, data: { provider: string; fiat_currency: string; crypto_currency: string; crypto_amount: string; chain_id: number }) =>
    apiCall('/v1/offramp/quote', { userId, email, method: 'POST', body: data }),
  payout: (userId: string, email: string, data: { provider: string; amount: string; currency: string; method: string }) =>
    apiCall('/v1/offramp/payout', { userId, email, method: 'POST', body: data }),
};
export const healthApi = {
  check: () => apiCall('/healthz'),
};

export const blockXOneApi = {
  auth: authApi,
  offering: offeringApi,
  subscription: subscriptionApi,
  portfolio: portfolioApi,
  kyc: kycApi,
  wallet: walletApi,
  marketplace: marketplaceApi,
  token: tokenApi,
  redemption: redemptionApi,
  payment: paymentApi,
  transaction: transactionApi,
  chains: chainsApi,
  onramp: onrampApi,
  offramp: offrampApi,
  health: healthApi,
};
