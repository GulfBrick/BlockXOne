export interface Transaction {
  id: string
  type: 'buy' | 'sell' | 'mint' | 'burn' | 'nav_update'
  fundId: string
  fundName: string
  fundSymbol: string
  investorName: string
  investorEmail: string
  quantity: number
  pricePerToken: number
  totalAmount: number
  timestamp: string
  status: 'completed' | 'pending' | 'failed'
}

const STORAGE_KEY = 'blockxone_transactions'

export function getTransactions(): Transaction[] {
  if (typeof window === 'undefined') return []
  const data = localStorage.getItem(STORAGE_KEY)
  return data ? JSON.parse(data) : []
}

export function addTransaction(transaction: Omit<Transaction, 'id' | 'timestamp'>): Transaction {
  const newTransaction: Transaction = {
    ...transaction,
    id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
  }
  
  const transactions = getTransactions()
  transactions.unshift(newTransaction)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions))
  
  return newTransaction
}

export function getTransactionsByFund(fundId: string): Transaction[] {
  return getTransactions().filter(t => t.fundId === fundId)
}

export function getTransactionsByInvestor(email: string): Transaction[] {
  return getTransactions().filter(t => t.investorEmail === email)
}

export function getTotalVolume(): number {
  return getTransactions().reduce((sum, t) => sum + t.totalAmount, 0)
}

export function getTotalTransactions(): number {
  return getTransactions().length
}
