'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { TabContent } from '@/components/motion/tab-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ensureFunds } from '@/lib/demo-funds'
import { addTransaction } from '@/lib/transactions'

type EthereumRequest = {
  method: string
  params?: unknown[] | Record<string, unknown>
}

type EthereumProvider = {
  request(args: EthereumRequest): Promise<unknown>
}

type EthereumProviderError = Error & {
  code?: number
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function formatZAR(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(value)
}

export default function FundDetailPage() {
  const params = useParams()
  const fundId = params.id as string
  const funds = useMemo(() => ensureFunds(), [])
  const fund = useMemo(() => funds.find((f) => f.id === fundId) || null, [fundId, funds])

  const [activeTab, setActiveTab] = useState('overview')
  const [showBuyModal, setShowBuyModal] = useState(false)
  const [buyAmount, setBuyAmount] = useState('')
  const [buySuccess, setBuySuccess] = useState(false)
  const [mmStatus, setMmStatus] = useState('')
  const [txHash, setTxHash] = useState('')

  const navValue = fund?.nav ?? 0
  const terms = {
    minInvestment: formatZAR(fund?.minInvestment ?? 0),
    minInvestmentValue: fund?.minInvestment ?? 0,
    lockup: 'Quarterly liquidity',
    redemptionFreq: 'Monthly',
  }
  const navHistory = useMemo(() => {
    const start = navValue
    return Array.from({ length: 6 }).map((_, idx) => ({
      date: `2025-0${6 + idx}`,
      value: Number((start - idx * 0.18).toFixed(2)),
    }))
  }, [navValue])
  const documents = [
    { name: 'Prospectus', url: '#', size: '2.1 MB' },
    { name: 'Fund Terms', url: '#', size: '940 KB' },
  ]

  const chainHex = useMemo(() => {
    if (fund?.contractChainId) return '0x' + fund.contractChainId.toString(16)
    const map: Record<string, string> = {
      Ethereum: '0x1',
      Sepolia: '0xaa36a7',
      Polygon: '0x89',
      'Polygon Amoy': '0x13882',
      Base: '0x2105',
      'Base Sepolia': '0x14a34',
      'Arbitrum One': '0xa4b1',
    }
    return fund ? map[fund.chain] || '' : ''
  }, [fund])

  const txRecipient =
    fund?.contractAddress && fund.contractAddress !== '0x0000000000000000000000000000000000000000'
      ? fund.contractAddress
      : fund?.depositAddress || fund?.tokenAddress || '0x000000000000000000000000000000000000dEaD'

  const parsedAmount = parseFloat(buyAmount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0
  const normalizedAmount = isValidAmount ? Number(parsedAmount.toFixed(2)) : 0
  const tokensToBuy = navValue > 0 ? normalizedAmount / navValue : 0
  const totalCost = normalizedAmount
  const pricePerTokenEth =
    fund?.pricePerTokenEth && fund.pricePerTokenEth > 0 ? fund.pricePerTokenEth : 0.0001

  const tokenAmountWei = useMemo(() => {
    return Math.max(0, Math.floor(tokensToBuy * 1e18))
  }, [tokensToBuy])

  const paymentWei = useMemo(() => {
    return Math.max(0, Math.floor(tokensToBuy * pricePerTokenEth * 1e18))
  }, [pricePerTokenEth, tokensToBuy])

  if (!fund) {
    return (
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
        <div className="container relative mx-auto px-4 py-12 space-y-4">
          <Link href="/investor/market" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Marketplace
          </Link>
          <div className="glass-surface rounded-2xl p-8">
            <h1 className="text-3xl font-bold mb-2">Fund not found</h1>
            <p className="text-muted-foreground">This fund is not available. Choose another from the marketplace.</p>
          </div>
        </div>
      </div>
    )
  }

  async function requestMetamaskPayment() {
    setMmStatus('')
    setTxHash('')
    const eth =
      (typeof window !== 'undefined'
        ? (window as Window & { ethereum?: EthereumProvider }).ethereum
        : undefined) || null
    if (!eth) {
      setMmStatus('MetaMask not detected. Install MetaMask and retry.')
      return false
    }

    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      const from = accounts?.[0]
      if (!from) throw new Error('No accounts authorized')
      const contractAddress = fund?.contractAddress

      if (chainHex) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] })
        } catch (error: unknown) {
          const switchError = error as EthereumProviderError
          if (switchError.code !== 4902) throw error
          // If chain is unknown in MetaMask, we skip add here to avoid bloating prompts; user can add manually.
        }
      }

      let data: string | undefined
      let valueHex = '0x0'

      if (contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000') {
        // encode purchase(uint256 amount)
        const selector = '0xa6f2ae3a' // keccak256("purchase(uint256)") first 4 bytes
        const amountHex = tokenAmountWei.toString(16).padStart(64, '0')
        data = selector + amountHex
        valueHex = '0x' + paymentWei.toString(16)
      } else {
        valueHex = '0x' + paymentWei.toString(16)
      }

      if (paymentWei <= 0) throw new Error('Amount too small for gas estimation')

      const tx = await eth.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from,
            to: txRecipient,
            value: valueHex,
            data,
          },
        ],
      })

      if (typeof tx === 'string') setTxHash(tx)
      setMmStatus('Submitted to MetaMask; waiting for confirmation in wallet')
      return true
    } catch (error: unknown) {
      setMmStatus(getErrorMessage(error, 'MetaMask transaction failed'))
      return false
    }
  }

  const handleBuy = async () => {
    setMmStatus('')
    setTxHash('')
    if (!isValidAmount || normalizedAmount < terms.minInvestmentValue) return

    const sent = await requestMetamaskPayment()
    if (!sent) return

    addTransaction({
      type: 'buy',
      fundId,
      fundName: fund.name,
      fundSymbol: fund.symbol,
      investorName: 'John Investor',
      investorEmail: 'investor@demo.com',
      quantity: Number(tokensToBuy.toFixed(4)),
      pricePerToken: navValue,
      totalAmount: normalizedAmount,
      status: 'completed',
    })

    setBuySuccess(true)
    setTimeout(() => {
      setBuySuccess(false)
      setShowBuyModal(false)
      setBuyAmount('')
      setMmStatus('')
      setTxHash('')
    }, 2500)
  }

  return (
    <div className="min-h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,188,212,0.08),transparent_50%)]" />
      <div className="container relative mx-auto px-4 py-8 space-y-6">
        <Link href="/investor/market" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Marketplace
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="glass-surface rounded-2xl p-8"
        >
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">{fund.name}</h1>
              <p className="text-muted-foreground">{fund.symbol} • Managed by {fund.manager}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary mb-1">{formatZAR(navValue)}</div>
              <div className="text-sm text-muted-foreground">NAV per Token</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">1Y Performance</div>
              <div className="text-xl font-semibold text-green-400">{`${fund.performance >= 0 ? '+' : ''}${fund.performance.toFixed(1)}%`}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Total AUM</div>
              <div className="text-xl font-semibold">{formatZAR(fund.aum)}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Blockchain</div>
              <div className="text-xl font-semibold">{fund.chain}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Token Address</div>
              <div className="text-sm font-mono">{fund.tokenAddress}</div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={() => setShowBuyModal(true)} className="bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring">
              Subscribe Now
            </Button>
            <Button variant="outline" className="glass-surface hover-elevate press-compress focus-ring">
              Add to Watchlist
            </Button>
          </div>
        </motion.div>

        <div className="glass-surface rounded-2xl p-6">
          <div className="flex gap-4 border-b border-white/10 mb-6">
            {['overview', 'performance', 'documents', 'terms'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 px-2 text-sm font-medium transition-colors relative ${
                  activeTab === tab ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {activeTab === tab && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    transition={{ duration: 0.2 }}
                  />
                )}
              </button>
            ))}
          </div>

          <TabContent activeKey={activeTab}>
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3">Description</h3>
                  <p className="text-muted-foreground leading-relaxed">{fund.strategy}</p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-white/5">
                    <div className="text-sm text-muted-foreground mb-1">Risk</div>
                    <div className="font-semibold">{fund.risk}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-white/5">
                    <div className="text-sm text-muted-foreground mb-1">Minimum Investment</div>
                    <div className="font-semibold">{terms.minInvestment}</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'performance' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">NAV History</h3>
                <div className="space-y-2">
                  {navHistory.map((entry) => (
                    <div key={entry.date} className="flex justify-between items-center p-3 rounded-lg bg-white/5">
                      <span className="text-sm text-muted-foreground">{entry.date}</span>
                      <span className="font-semibold">R{entry.value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold mb-4">Fund Documents</h3>
                {documents.map((doc) => (
                  <div key={doc.name} className="flex justify-between items-center p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div>
                        <div className="font-medium">{doc.name}</div>
                        <div className="text-sm text-muted-foreground">{doc.size}</div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="hover-elevate press-compress">
                      Download
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'terms' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Fund Terms</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-white/5">
                      <div className="text-sm text-muted-foreground mb-1">Minimum Investment</div>
                      <div className="font-semibold">{terms.minInvestment}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5">
                      <div className="text-sm text-muted-foreground mb-1">Lock-up Period</div>
                      <div className="font-semibold">{terms.lockup}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5">
                      <div className="text-sm text-muted-foreground mb-1">Redemption Frequency</div>
                      <div className="font-semibold">{terms.redemptionFreq}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-4">Fee Structure</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {[
                      { label: 'Management Fee', value: fund.managementFee ? `${fund.managementFee}%` : '1.5%' },
                      { label: 'Performance Fee', value: fund.performanceFee ? `${fund.performanceFee}%` : '15%' },
                      { label: 'Mint Fee', value: `${fund.mintFeeBps / 100}%` },
                      { label: 'Burn Fee', value: `${fund.burnFeeBps / 100}%` },
                    ].map((fee) => (
                      <div key={fee.label} className="p-4 rounded-lg bg-white/5">
                        <div className="text-sm text-muted-foreground mb-1">{fee.label}</div>
                        <div className="font-semibold">{fee.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </TabContent>
        </div>
      </div>

      <AnimatePresence>
        {showBuyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowBuyModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-surface rounded-2xl p-6 max-w-md w-full"
            >
              {!buySuccess ? (
                <>
                  <h2 className="text-2xl font-bold mb-4">Subscribe to {fund.symbol}</h2>
                  <p className="text-muted-foreground mb-6">Enter the amount you want to invest in {fund.name}</p>

                  <div className="space-y-4">
                    <div>
                      <Label>Investment Amount (ZAR)</Label>
                      <Input
                        type="number"
                        placeholder="10000"
                        value={buyAmount}
                        onChange={(e) => setBuyAmount(e.target.value)}
                        className="mt-2"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Minimum: {terms.minInvestment}</p>
                    </div>

                    {isValidAmount && normalizedAmount >= terms.minInvestmentValue && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 rounded-lg bg-primary/10 border border-primary/20"
                      >
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-muted-foreground">Tokens to receive</span>
                          <span className="font-semibold">{tokensToBuy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                        </div>
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-muted-foreground">Price per token (ETH)</span>
                          <span className="font-semibold">{pricePerTokenEth} ETH</span>
                        </div>
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-muted-foreground">Est. on-chain send</span>
                          <span className="font-semibold">{Number((pricePerTokenEth * tokensToBuy) || 0).toFixed(6)} ETH</span>
                        </div>
                        <div className="border-t border-white/10 pt-2 mt-2">
                          <div className="flex justify-between">
                            <span className="font-semibold">Total Cost</span>
                            <span className="font-bold text-primary">R{totalCost.toFixed(2)}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    <div className="flex gap-3 pt-4">
                      <Button
                        onClick={handleBuy}
                        disabled={!isValidAmount || normalizedAmount < terms.minInvestmentValue}
                        className="flex-1 bg-primary hover:bg-primary/90 hover-elevate press-compress focus-ring"
                      >
                        Confirm Purchase
                      </Button>
                      <Button
                        onClick={() => setShowBuyModal(false)}
                        variant="outline"
                        className="flex-1 glass-surface hover-elevate press-compress"
                      >
                        Cancel
                      </Button>
                    </div>
                    {mmStatus ? (
                      <div className="text-xs text-muted-foreground">{mmStatus}</div>
                    ) : null}
                  </div>
                </>
              ) : (
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Purchase Successful!</h3>
                  <p className="text-muted-foreground mb-2">
                    You&apos;ve successfully purchased {tokensToBuy.toLocaleString(undefined, { maximumFractionDigits: 4 })} {fund.symbol} tokens
                  </p>
                  <p className="text-sm text-muted-foreground">Total: R{totalCost.toFixed(2)}</p>
                  {txHash ? <p className="text-xs text-muted-foreground break-all mt-2">Transaction: {txHash}</p> : null}
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
