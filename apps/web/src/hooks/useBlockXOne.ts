'use client';

import { useState } from 'react';
import { blockXOneApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context-v2';

// ============================================================================
// Offering Hooks
// ============================================================================

export function useOfferings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = async () => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.offering.list(user.id, user.email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch offerings';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const get = async (offeringId: string) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.offering.get(user.id, user.email, offeringId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch offering';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { list, get, loading, error };
}

// ============================================================================
// Subscription (Token Purchase) Hooks
// ============================================================================

export function useSubscription() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (
    offeringId: string,
    data: { units: string | number; amount: string | number }
  ) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.subscription.create(
        user.id,
        user.email,
        offeringId,
        data
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create subscription';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const get = async (subscriptionId: string) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.subscription.get(user.id, user.email, subscriptionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch subscription';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { create, get, loading, error };
}

// ============================================================================
// Portfolio Hooks
// ============================================================================

export function usePortfolio() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const get = async () => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.portfolio.get(user.id, user.email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch portfolio';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { get, loading, error };
}

// ============================================================================
// KYC Hooks
// ============================================================================

export function useKyc() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCase = async (caseType: 'KYC' | 'AML' | 'FATCA') => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.kyc.createCase(user.id, user.email, caseType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create KYC case';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const submitCase = async (caseId: string) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.kyc.submitCase(user.id, user.email, caseId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit KYC case';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getCase = async (caseId: string) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.kyc.getCase(user.id, user.email, caseId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch KYC case';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { createCase, submitCase, getCase, loading, error };
}

// ============================================================================
// Wallet Hooks
// ============================================================================

export function useWallet() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (data: {
    address: string;
    chainId: number;
    message: string;
    signature: string;
  }) => {
    // Wallet connect is the login path; allow without an existing session.
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.wallet.connect(data as any);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const list = async () => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.wallet.list();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch wallets';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { connect, list, loading, error };
}

// ============================================================================
// Marketplace Hooks
// ============================================================================

export function useMarketplace() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listListings = async () => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.marketplace.listListings(user.id, user.email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch listings';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const createListing = async (data: {
    offeringId: string;
    walletId: string;
    units: string | number;
    pricePerUnit: string | number;
  }) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.marketplace.createListing(
        user.id,
        user.email,
        user.roles,
        data
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create listing';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const listRfq = async () => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.marketplace.listRfq(user.id, user.email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch RFQs';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const createRfq = async (data: {
    offeringId: string;
    units: string | number;
    maxPrice: string | number;
  }) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.marketplace.createRfq(user.id, user.email, data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create RFQ';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { listListings, createListing, listRfq, createRfq, loading, error };
}

// ============================================================================
// Token Operations Hooks
// ============================================================================

export function useTokenOps() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mint = async (subscriptionId: string) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.token.mint(user.id, user.email, user.roles, subscriptionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to mint tokens';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getNAV = async (offeringId: string) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.token.getNAV(user.id, user.email, offeringId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch NAV';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { mint, getNAV, loading, error };
}

// ============================================================================
// Redemption Hooks
// ============================================================================

export function useRedemption() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async (data: {
    offeringId: string;
    amountTokens: string | number;
    amountCash: string | number;
  }) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.redemption.request(user.id, user.email, data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to request redemption';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const get = async (redemptionId: string) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.redemption.get(user.id, user.email, redemptionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch redemption';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { request, get, loading, error };
}

// ============================================================================
// Payment Hooks
// ============================================================================

export function usePayment() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notify = async (data: {
    subscriptionId: string;
    method: 'bank_transfer' | 'card' | 'crypto';
    amount: number;
    reference: string;
    timestamp?: string;
  }) => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.payment.notify(
        user.id,
        user.email,
        user.roles,
        data
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to notify payment';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { notify, loading, error };
}

// ============================================================================
// Transaction/Audit Hooks
// ============================================================================

export function useTransactions() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = async () => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.transaction.list(user.id, user.email, user.roles);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch transactions';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const listSubscriptions = async () => {
    if (!user) throw new Error('Not authenticated');
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.transaction.listSubscriptions(
        user.id,
        user.email,
        user.roles
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch subscriptions';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { list, listSubscriptions, loading, error };
}

// ============================================================================
// Health Check Hook
// ============================================================================

export function useHealthCheck() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setLoading(true);
    setError(null);
    try {
      return await blockXOneApi.health.check();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Health check failed';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { check, loading, error };
}
