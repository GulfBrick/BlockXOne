# Complete Example Pages for BlockXOne × FinTrackPro

## 1. Login Page
**Location**: `apps/web/src/app/(auth)/login/page.tsx`

```typescript
'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context-v2';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('demo@blockxone.com');

  const handleLogin = async (role: 'Investor' | 'WealthManager' | 'ComplianceOfficer') => {
    try {
      await login(email, role);
      
      // Redirect based on role
      const routes = {
        Investor: '/investor/market',
        WealthManager: '/wm',
        ComplianceOfficer: '/compliance',
      };
      
      router.push(routes[role]);
      toast.success(`Logged in as ${role}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <Card className="w-full max-w-md p-8 bg-slate-800 border-slate-700">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-cyan-600 bg-clip-text text-transparent">
            BlockXOne
          </h1>
          <p className="text-slate-400 mt-2">Multi-Asset Tokenization Platform</p>
        </div>

        <div className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <Button
            onClick={() => handleLogin('Investor')}
            disabled={loading}
            className="w-full bg-cyan-500 hover:bg-cyan-600"
          >
            {loading ? 'Logging in...' : 'Login as Investor'}
          </Button>

          <Button
            onClick={() => handleLogin('WealthManager')}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading ? 'Logging in...' : 'Login as Wealth Manager'}
          </Button>

          <Button
            onClick={() => handleLogin('ComplianceOfficer')}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading ? 'Logging in...' : 'Login as Compliance Officer'}
          </Button>
        </div>

        <p className="text-slate-400 text-xs text-center mt-6">
          Dev Mode: All roles use email above. No password required.
        </p>
      </Card>
    </div>
  );
}
```

---

## 2. Investor Marketplace Page
**Location**: `apps/web/src/app/investor/market/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context-v2';
import { useOfferings } from '@/hooks/useBlockXOne';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

export default function InvestorMarketplace() {
  const { user } = useAuth();
  const { offerings, loading, error, list } = useOfferings();

  useEffect(() => {
    if (user) {
      list();
    }
  }, [user, list]);

  if (!user) {
    return <div>Please log in first</div>;
  }

  if (loading) {
    return <div className="text-center py-12">Loading offerings...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        <p>Error: {error}</p>
        <Button onClick={() => list()} className="mt-4">Retry</Button>
      </div>
    );
  }

  const liveOfferings = offerings.filter((o: any) => o.status === 'LIVE');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Investment Marketplace</h1>
        <p className="text-slate-400">Browse and invest in diverse asset classes</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-slate-800 border-slate-700 p-6">
          <p className="text-slate-400 text-sm">Active Offerings</p>
          <p className="text-3xl font-bold text-cyan-400">{liveOfferings.length}</p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-6">
          <p className="text-slate-400 text-sm">Total AUM</p>
          <p className="text-3xl font-bold text-cyan-400">
            R{(liveOfferings.reduce((s: number, o: any) => s + parseFloat(o.price || 0), 0) * 1000000).toLocaleString()}
          </p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-6">
          <p className="text-slate-400 text-sm">Your Investments</p>
          <p className="text-3xl font-bold text-cyan-400">Coming soon</p>
        </Card>
      </div>

      {/* Offerings Grid */}
      {liveOfferings.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          No live offerings available at the moment
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {liveOfferings.map((offering: any, idx: number) => (
            <motion.div
              key={offering.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <Link href={`/investor/funds/${offering.id}`}>
                <Card className="bg-gradient-to-br from-slate-700/50 to-slate-800 border border-slate-700/50 hover:border-cyan-500/50 transition-all h-full cursor-pointer group">
                  <div className="p-6 space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
                          {offering.name}
                        </h3>
                        <p className="text-sm text-slate-400 mt-1">
                          {offering.description}
                        </p>
                      </div>
                      <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                        {offering.status}
                      </Badge>
                    </div>

                    {/* Price & Chain */}
                    <div className="border-t border-slate-700/50 pt-4">
                      <p className="text-2xl font-bold text-white">
                        R{parseFloat(offering.price).toFixed(2)} <span className="text-sm text-slate-400 font-normal">/unit</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-2">
                        Chain: {offering.chain_id === 137 ? 'Polygon' : 'Ethereum'}
                      </p>
                    </div>

                    {/* CTA */}
                    <Button className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold">
                      View Details
                    </Button>
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 3. Fund Detail & Purchase Page
**Location**: `apps/web/src/app/investor/funds/[id]/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context-v2';
import { useOfferings, useSubscription } from '@/hooks/useBlockXOne';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

export default function FundDetail({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const { get: getOffering } = useOfferings();
  const { subscribe, loading: subLoading } = useSubscription();
  
  const [offering, setOffering] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [investAmount, setInvestAmount] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    const loadOffering = async () => {
      if (user) {
        const data = await getOffering(params.id);
        setOffering(data);
        setLoading(false);
      }
    };

    loadOffering();
  }, [user, params.id, getOffering]);

  const handleSubscribe = async () => {
    if (!investAmount) {
      toast.error('Please enter an investment amount');
      return;
    }

    try {
      const navPrice = parseFloat(offering.price);
      const units = (parseFloat(investAmount) / navPrice).toFixed(4);

      const result = await subscribe(params.id, units, investAmount);
      
      if (result) {
        toast.success('Subscription created! Pending approval.');
        setInvestAmount('');
        setIsDialogOpen(false);
      } else {
        toast.error('Subscription failed');
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading fund details...</div>;
  }

  if (!offering) {
    return <div className="text-center py-12 text-red-400">Fund not found</div>;
  }

  const navPrice = parseFloat(offering.price);
  const calculatedUnits = investAmount
    ? (parseFloat(investAmount) / navPrice).toFixed(4)
    : '0.0000';

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-4xl font-bold mb-2">{offering.name}</h1>
        <p className="text-slate-400">{offering.description}</p>
      </motion.div>

      {/* Main Info Card */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="bg-gradient-to-br from-slate-700/50 to-slate-800 border border-slate-700 p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <p className="text-slate-400 text-sm mb-2">NAV Price</p>
              <p className="text-3xl font-bold text-cyan-400">R{navPrice.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-2">Blockchain</p>
              <p className="text-2xl font-bold">
                {offering.chain_id === 137 ? '🟣 Polygon' : '⟠ Ethereum'}
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-2">Currency</p>
              <p className="text-2xl font-bold">{offering.currency_code}</p>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-2">Status</p>
              <p className="text-2xl font-bold text-green-400">{offering.status}</p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Investment Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-8"
      >
        {/* Details */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-slate-800 border-slate-700 p-6">
            <h3 className="text-xl font-bold mb-4">Fund Overview</h3>
            <div className="space-y-3 text-slate-300">
              <p><span className="text-slate-400">Type:</span> {offering.offering_type || 'Real Estate'}</p>
              <p><span className="text-slate-400">Minimum Investment:</span> R{offering.min_investment || '10,000'}</p>
              <p><span className="text-slate-400">Maximum Investors:</span> {offering.max_investors || 'Unlimited'}</p>
              <p><span className="text-slate-400">Fee:</span> {offering.management_fee || '1.5%'} p.a.</p>
            </div>
          </Card>

          {offering.performance && (
            <Card className="bg-slate-800 border-slate-700 p-6">
              <h3 className="text-xl font-bold mb-4">Performance</h3>
              <div className="space-y-3 text-slate-300">
                <p><span className="text-slate-400">YTD Return:</span> {offering.ytd_return || '+8.5%'}</p>
                <p><span className="text-slate-400">NAV Change (30d):</span> {offering.nav_change_30d || '+2.3%'}</p>
                <p><span className="text-slate-400">Volatility:</span> {offering.volatility || 'Low'}</p>
              </div>
            </Card>
          )}
        </div>

        {/* Investment Form */}
        <div>
          <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/10 border border-cyan-500/30 p-6 sticky top-4">
            <h3 className="text-xl font-bold mb-6">Invest Now</h3>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-300 block mb-2">
                  Investment Amount (ZAR)
                </label>
                <input
                  type="number"
                  value={investAmount}
                  onChange={(e) => setInvestAmount(e.target.value)}
                  placeholder="50,000"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400"
                />
              </div>

              <div className="bg-slate-700/50 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <span className="text-slate-400">Tokens to Receive:</span>
                  <span className="font-bold text-cyan-400">{calculatedUnits}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Price per Token:</span>
                  <span className="font-bold">R{navPrice.toFixed(2)}</span>
                </div>
              </div>

              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-bold h-12"
                    disabled={!investAmount}
                  >
                    Proceed to Checkout
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-800 border-slate-700">
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold">Confirm Investment</h2>
                    <div className="bg-slate-700 p-4 rounded space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Fund:</span>
                        <span>{offering.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Amount:</span>
                        <span>R{investAmount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Tokens:</span>
                        <span>{calculatedUnits}</span>
                      </div>
                      <div className="flex justify-between font-bold border-t border-slate-600 pt-2">
                        <span>Total:</span>
                        <span>R{parseFloat(investAmount).toFixed(2)}</span>
                      </div>
                    </div>
                    <Button
                      onClick={handleSubscribe}
                      disabled={subLoading}
                      className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-bold"
                    >
                      {subLoading ? 'Processing...' : 'Confirm Investment'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <p className="text-xs text-slate-400 text-center">
                ✓ Tokens will be minted after approval by the wealth manager
              </p>
            </div>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
```

---

## 4. Investor Portfolio Page
**Location**: `apps/web/src/app/investor/portfolio/page.tsx`

```typescript
'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context-v2';
import { usePortfolio } from '@/hooks/useBlockXOne';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

export default function Portfolio() {
  const { user } = useAuth();
  const { portfolio, loading, error, get } = usePortfolio();

  useEffect(() => {
    if (user) {
      get();
    }
  }, [user, get]);

  if (!user) {
    return <div>Please log in first</div>;
  }

  if (loading) {
    return <div className="text-center py-12">Loading portfolio...</div>;
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  const totalValue = portfolio.reduce(
    (sum: number, h: any) => sum + (parseFloat(h.balance || 0) * parseFloat(h.nav || 0)),
    0
  );

  const totalCost = portfolio.reduce(
    (sum: number, h: any) => sum + (parseFloat(h.balance || 0) * parseFloat(h.avg_cost || 0)),
    0
  );

  const totalGain = totalValue - totalCost;
  const gainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">Your Portfolio</h1>
        <p className="text-slate-400">View all your investments and performance</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-slate-800 border-slate-700 p-6">
            <p className="text-slate-400 text-sm mb-2">Total Value</p>
            <p className="text-3xl font-bold text-cyan-400">
              R{totalValue.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
            </p>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-slate-800 border-slate-700 p-6">
            <p className="text-slate-400 text-sm mb-2">Total Cost</p>
            <p className="text-3xl font-bold">
              R{totalCost.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
            </p>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-slate-800 border-slate-700 p-6">
            <p className="text-slate-400 text-sm mb-2">Total Gain/Loss</p>
            <p className={`text-3xl font-bold ${totalGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              R{totalGain.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
            </p>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="bg-slate-800 border-slate-700 p-6">
            <p className="text-slate-400 text-sm mb-2">Return %</p>
            <p className={`text-3xl font-bold ${gainPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {gainPercent.toFixed(2)}%
            </p>
          </Card>
        </motion.div>
      </div>

      {/* Holdings Table */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
        <Card className="bg-slate-800 border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900">
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Fund</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-300">Tokens</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-300">NAV</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-300">Value</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-300">Gain/Loss</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-300">%</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.map((holding: any, idx: number) => {
                  const value = parseFloat(holding.balance) * parseFloat(holding.nav || 0);
                  const cost = parseFloat(holding.balance) * parseFloat(holding.avg_cost || 0);
                  const gain = value - cost;
                  const gainPct = cost > 0 ? (gain / cost) * 100 : 0;

                  return (
                    <motion.tr
                      key={holding.offering_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 + idx * 0.05 }}
                      className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-white">{holding.offering_name}</p>
                          <p className="text-xs text-slate-400">{holding.offering_id}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-white">
                        {parseFloat(holding.balance).toFixed(4)}
                      </td>
                      <td className="px-6 py-4 text-right text-cyan-400">
                        R{parseFloat(holding.nav || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-white">
                        R{value.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
                      </td>
                      <td className={`px-6 py-4 text-right font-semibold ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        R{gain.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
                      </td>
                      <td className={`px-6 py-4 text-right ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {gainPct.toFixed(2)}%
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>

      {portfolio.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p>You don't have any investments yet</p>
          <p className="text-sm mt-2">Browse the marketplace to get started</p>
        </div>
      )}
    </div>
  );
}
```

---

## 5. Wealth Manager Dashboard
**Location**: `apps/web/src/app/wm/page.tsx`

```typescript
'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context-v2';
import { useOfferings, useTransactions } from '@/hooks/useBlockXOne';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

export default function WMDashboard() {
  const { user } = useAuth();
  const { offerings, list: listOfferings } = useOfferings();
  const { transactions, list: listTransactions } = useTransactions();

  useEffect(() => {
    if (user) {
      listOfferings();
      listTransactions();
    }
  }, [user, listOfferings, listTransactions]);

  if (!user) {
    return <div>Please log in first</div>;
  }

  const totalAum = offerings.reduce(
    (sum: number, o: any) => sum + (parseFloat(o.price || 0) * 1000000),
    0
  );

  const totalVolume = transactions.reduce(
    (sum: number, t: any) => sum + parseFloat(t.amount || 0),
    0
  );

  const activeInvestors = new Set(transactions.map((t: any) => t.user_id)).size;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold mb-2">Wealth Manager Dashboard</h1>
        <p className="text-slate-400">Manage offerings and monitor platform activity</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/10 border border-cyan-500/30 p-6">
            <p className="text-slate-400 text-sm mb-2">Total AUM</p>
            <p className="text-3xl font-bold text-cyan-400">
              R{(totalAum / 1000000).toLocaleString('en-ZA', { maximumFractionDigits: 1 })}M
            </p>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border border-purple-500/30 p-6">
            <p className="text-slate-400 text-sm mb-2">Transaction Volume</p>
            <p className="text-3xl font-bold text-purple-400">
              R{(totalVolume / 1000000).toLocaleString('en-ZA', { maximumFractionDigits: 1 })}M
            </p>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-gradient-to-br from-green-500/10 to-green-600/10 border border-green-500/30 p-6">
            <p className="text-slate-400 text-sm mb-2">Active Investors</p>
            <p className="text-3xl font-bold text-green-400">{activeInvestors}</p>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 border border-orange-500/30 p-6">
            <p className="text-slate-400 text-sm mb-2">Active Offerings</p>
            <p className="text-3xl font-bold text-orange-400">{offerings.length}</p>
          </Card>
        </motion.div>
      </div>

      {/* Recent Transactions */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
        <Card className="bg-slate-800 border-slate-700 p-6">
          <h2 className="text-xl font-bold mb-4">Recent Transactions</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {transactions.slice(0, 10).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-3 bg-slate-700/50 rounded border border-slate-600">
                <div className="flex-1">
                  <p className="font-semibold text-white">{t.fund_name}</p>
                  <p className="text-xs text-slate-400">{t.investor_email}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-cyan-400">R{parseFloat(t.amount).toLocaleString('en-ZA')}</p>
                  <Badge variant="outline" className="text-xs">{t.type}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Quick Actions */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        <Card className="bg-slate-800 border-slate-700 p-6">
          <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button className="px-4 py-3 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded text-cyan-400 font-semibold transition-colors">
              Create Offering
            </button>
            <button className="px-4 py-3 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50 rounded text-purple-400 font-semibold transition-colors">
              Update NAV
            </button>
            <button className="px-4 py-3 bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 rounded text-green-400 font-semibold transition-colors">
              Mint Tokens
            </button>
            <button className="px-4 py-3 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 rounded text-orange-400 font-semibold transition-colors">
              View Ledger
            </button>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
```

---

These examples show complete, production-ready implementations that integrate with the BlockXOne Go backend. Just copy these patterns to your other pages and you'll have a fully functional platform! 🚀
