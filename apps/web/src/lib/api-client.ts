// API client used by the Next.js app.
// Prefer JWT Bearer auth; dev headers remain for backward compatibility when AUTH_MODE=dev.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const SESSION_KEY = 'bx_auth_v2';

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
  token?: string;
  skipAuth?: boolean;
};

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && parsed.token.length > 0) return parsed.token;
    // legacy shape: { id, email, roles }
    if (parsed && typeof parsed === 'object' && 'token' in parsed === false) return null;
  } catch {
    /* ignore */
  }
  return null;
}

async function apiCall<T>(endpoint: string, opts: ApiCallOptions = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  const bearer = opts.token || getStoredToken()
  if (!opts.skipAuth && bearer) {
    headers['Authorization'] = `Bearer ${bearer}`
  }

  // Pull roles from opts or, if omitted, from persisted auth (keeps SuperAdmin/dev roles working)
  let roles: string[] | undefined = opts.roles
  if (!roles && typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('bx_auth_v2')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed?.roles)) roles = parsed.roles as string[]
      }
    } catch (_) {
      /* ignore */
    }
  }

  // Legacy dev headers (only honored when backend AUTH_MODE=dev)
  if (opts.userId) headers['X-Dev-User-Id'] = opts.userId
  if (opts.email) headers['X-Dev-Email'] = opts.email
  if (roles && roles.length > 0) headers['X-Dev-Roles'] = roles.join(',')

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
  me: (userId: string, email: string, roles?: string[]) => apiCall('/v1/me', { userId, email, roles }),
  meWithToken: (token: string) => apiCall('/v1/me', { token }),
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
  workflow: () => apiCall('/v1/kyc/workflows/basic-v3', { method: 'GET' }),
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
  connect: (data: { address: string; chainId: number; message: string; signature: string; email?: string }) =>
    apiCall('/v1/wallets/connect', {
      method: 'POST',
      skipAuth: true,
      body: {
        address: data.address,
        chain_id: data.chainId,
        message: data.message,
        signature: data.signature,
        email: data.email,
      },
    }),
  list: () => apiCall('/v1/wallets'),
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
  health: healthApi,
};
