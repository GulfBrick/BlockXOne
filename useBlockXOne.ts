/**
 * BlockXOne Custom Hooks
 * Ready-to-use React hooks for all platform features
 * Each hook handles state, loading, error, and provides business logic methods
 */

'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/auth-context-v2';
import {
  offeringApi,
  subscriptionApi,
  portfolioApi,
  kycApi,
  walletApi,
  marketplaceApi,
  tokenApi,
  redemptionApi,
  paymentApi,
  transactionApi,
} from '@/lib/api-client';

// ============================================================================
// useOfferings Hook
// ============================================================================

export const useOfferings = () => {
  const { user } = useAuth();
  const [offerings, setOfferings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const data = await offeringApi.list(user.id, user.email);
      setOfferings(Array.isArray(data) ? data : data.offerings || []);
    } catch (err: any) {
      setError(err.message);
      console.error('useOfferings.list error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const get = useCallback(
    async (offeringId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await offeringApi.get(user.id, user.email, offeringId);
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useOfferings.get error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const create = useCallback(
    async (offeringData: any) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await offeringApi.create(
          user.id,
          user.email,
          [user.role],
          offeringData
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useOfferings.create error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const publish = useCallback(
    async (offeringId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await offeringApi.publish(user.id, user.email, [user.role], offeringId);
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useOfferings.publish error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { offerings, loading, error, list, get, create, publish };
};

// ============================================================================
// useSubscription Hook (Token Purchase)
// ============================================================================

export const useSubscription = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscribe = useCallback(
    async (offeringId: string, units: string | number, amount: string | number) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await subscriptionApi.create(user.id, user.email, offeringId, {
          units,
          amount,
        });
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useSubscription.subscribe error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const approve = useCallback(
    async (subscriptionId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await subscriptionApi.approve(
          user.id,
          user.email,
          [user.role],
          subscriptionId
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useSubscription.approve error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const reject = useCallback(
    async (subscriptionId: string, reason: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await subscriptionApi.reject(
          user.id,
          user.email,
          [user.role],
          subscriptionId,
          reason
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useSubscription.reject error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { loading, error, subscribe, approve, reject };
};

// ============================================================================
// usePortfolio Hook
// ============================================================================

export const usePortfolio = () => {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const get = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const data = await portfolioApi.get(user.id, user.email);
      setPortfolio(Array.isArray(data) ? data : data.holdings || []);
    } catch (err: any) {
      setError(err.message);
      console.error('usePortfolio.get error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  return { portfolio, loading, error, get };
};

// ============================================================================
// useKyc Hook
// ============================================================================

export const useKyc = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCase = useCallback(
    async (caseType: 'KYC' | 'AML' | 'FATCA' = 'KYC') => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await kycApi.createCase(user.id, user.email, caseType);
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useKyc.createCase error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const submitCase = useCallback(
    async (caseId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await kycApi.submitCase(user.id, user.email, caseId);
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useKyc.submitCase error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const approveCase = useCallback(
    async (caseId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await kycApi.approveCase(user.id, user.email, [user.role], caseId);
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useKyc.approveCase error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { loading, error, createCase, submitCase, approveCase };
};

// ============================================================================
// useWallet Hook
// ============================================================================

export const useWallet = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (
      address: string,
      chainId: number,
      message: string = 'BlockXOne wallet connect',
      signature: string = 'devskip'
    ) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await walletApi.connect(user.id, user.email, {
          address,
          chainId,
          message,
          signature,
        });
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useWallet.connect error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const approve = useCallback(
    async (walletId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await walletApi.approve(user.id, user.email, [user.role], walletId);
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useWallet.approve error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { loading, error, connect, approve };
};

// ============================================================================
// useMarketplace Hook (P2P Trading)
// ============================================================================

export const useMarketplace = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createListing = useCallback(
    async (
      offeringId: string,
      walletId: string,
      units: string | number,
      pricePerUnit: string | number
    ) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await marketplaceApi.createListing(
          user.id,
          user.email,
          [user.role],
          {
            offeringId,
            walletId,
            units,
            pricePerUnit,
          }
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useMarketplace.createListing error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const createRfq = useCallback(
    async (offeringId: string, units: string | number, maxPrice: string | number) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await marketplaceApi.createRfq(user.id, user.email, {
          offeringId,
          units,
          maxPrice,
        });
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useMarketplace.createRfq error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const match = useCallback(
    async (listingId: string, rfqId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await marketplaceApi.match(user.id, user.email, [user.role], {
          listingId,
          rfqId,
        });
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useMarketplace.match error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { loading, error, createListing, createRfq, match };
};

// ============================================================================
// useTokenOps Hook (Mint/Burn)
// ============================================================================

export const useTokenOps = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mint = useCallback(
    async (subscriptionId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await tokenApi.mint(
          user.id,
          user.email,
          [user.role],
          subscriptionId
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useTokenOps.mint error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const burn = useCallback(
    async (redemptionId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await tokenApi.burn(
          user.id,
          user.email,
          [user.role],
          redemptionId
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useTokenOps.burn error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const updateNAV = useCallback(
    async (offeringId: string, navPrice: number) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await tokenApi.updateNAV(
          user.id,
          user.email,
          [user.role],
          offeringId,
          navPrice
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useTokenOps.updateNAV error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { loading, error, mint, burn, updateNAV };
};

// ============================================================================
// useRedemption Hook
// ============================================================================

export const useRedemption = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (offeringId: string, amountTokens: string | number, amountCash: string | number) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await redemptionApi.request(user.id, user.email, {
          offeringId,
          amountTokens,
          amountCash,
        });
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useRedemption.request error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const approve = useCallback(
    async (redemptionId: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await redemptionApi.approve(
          user.id,
          user.email,
          [user.role],
          redemptionId
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('useRedemption.approve error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { loading, error, request, approve };
};

// ============================================================================
// usePayment Hook
// ============================================================================

export const usePayment = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notify = useCallback(
    async (subscriptionId: string, method: string, amount: number, reference: string) => {
      if (!user) return null;
      setLoading(true);
      setError(null);

      try {
        const data = await paymentApi.notify(user.id, user.email, [user.role], {
          subscriptionId,
          method: method as any,
          amount,
          reference,
        });
        return data;
      } catch (err: any) {
        setError(err.message);
        console.error('usePayment.notify error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { loading, error, notify };
};

// ============================================================================
// useTransactions Hook (Audit Trail)
// ============================================================================

export const useTransactions = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // Try to use admin endpoint if user has privileged role
      const isAdmin = ['WealthManager', 'ComplianceOfficer', 'SuperAdmin'].includes(
        user.role
      );
      const data = isAdmin
        ? await transactionApi.listSubscriptions(user.id, user.email, [user.role])
        : await transactionApi.list(user.id, user.email);

      setTransactions(Array.isArray(data) ? data : data.subscriptions || []);
    } catch (err: any) {
      setError(err.message);
      console.error('useTransactions.list error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  return { transactions, loading, error, list };
};
