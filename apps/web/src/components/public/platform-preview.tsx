import {
  BadgeCheck,
  CircleDollarSign,
  FileKey2,
  Fingerprint,
  Landmark,
  Network,
  ReceiptText,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'

import { BrandMark } from '@/components/brand/brand-mark'

const workspaceNavigation = [
  { label: 'Instrument', icon: Landmark, active: true },
  { label: 'Investors', icon: UsersRound },
  { label: 'Settlement', icon: CircleDollarSign },
  { label: 'Issuance', icon: Network },
  { label: 'Register', icon: FileKey2 },
]

const operatingSequence = [
  { index: '01', label: 'Terms', detail: 'Instrument and vehicle', icon: ReceiptText },
  { index: '02', label: 'Eligibility', detail: 'Identity and policy', icon: Fingerprint },
  { index: '03', label: 'Subscription', detail: 'Exact obligation', icon: UsersRound },
  { index: '04', label: 'Settlement', detail: 'Payment evidence', icon: CircleDollarSign },
  { index: '05', label: 'Issuance', detail: 'Network execution', icon: Network },
  { index: '06', label: 'Ownership', detail: 'Position and register', icon: ShieldCheck },
]

const evidence = [
  ['Decision history', 'Role, actor and approval provenance'],
  ['Settlement record', 'Obligation, allocation and payment evidence'],
  ['Network receipt', 'Transaction reference, confirmations and finality'],
  ['Ownership record', 'Position, supply and legal register'],
]

export function PlatformPreview() {
  return (
    <section className="bxo-product-surface" aria-label="BlockXOne institutional platform interface" data-bxo-product-surface>
      <header className="bxo-product-surface__bar" data-bxo-product-bar>
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark size="sm" className="bxo-product-surface__brand" />
          <div className="min-w-0">
            <div className="bxo-product-surface__overline">BlockXOne</div>
            <div className="truncate text-sm font-semibold text-bxo-text-primary">Primary issuance</div>
          </div>
        </div>
        <div className="bxo-product-surface__context" data-bxo-product-context>
          <span className="bxo-product-surface__context-dot" data-bxo-product-status aria-hidden="true" />
          Connected record
        </div>
      </header>

      <div className="bxo-product-surface__layout">
        <nav className="bxo-product-surface__nav" aria-label="Preview workspace navigation" data-bxo-product-nav>
          <div className="bxo-product-surface__nav-label">Workspace</div>
          <div className="bxo-product-surface__nav-items">
            {workspaceNavigation.map(({ label, icon: Icon, active }) => (
              <div
                key={label}
                className={`bxo-product-surface__nav-item ${active ? 'bxo-product-surface__nav-item--active' : ''}`}
                data-bxo-product-nav-item
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="bxo-product-surface__nav-footer">
            <BadgeCheck className="h-4 w-4 text-bxo-accent-primary" aria-hidden="true" />
            Role separated
          </div>
        </nav>

        <div className="bxo-product-surface__main">
          <div className="bxo-product-surface__heading" data-bxo-product-heading>
            <div>
              <div className="bxo-product-surface__overline text-bxo-accent-primary">Instrument workspace</div>
              <h2 className="mt-2 font-ui text-xl font-semibold tracking-[-0.025em] text-bxo-text-primary sm:text-2xl">
                One record from terms to ownership
              </h2>
            </div>
            <div className="bxo-product-surface__reference">
              <span>Reference</span>
              <strong>BXO / PRIMARY</strong>
            </div>
          </div>

          <ol className="bxo-product-surface__sequence" aria-label="Primary issuance sequence">
            {operatingSequence.map(({ index, label, detail, icon: Icon }) => (
              <li key={label} className="bxo-product-surface__step" data-bxo-product-step>
                <div className="bxo-product-surface__step-index">{index}</div>
                <div className="bxo-product-surface__step-icon" data-bxo-product-icon>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-bxo-text-primary">{label}</div>
                  <div className="mt-1 text-xs leading-5 text-bxo-text-tertiary">{detail}</div>
                </div>
              </li>
            ))}
          </ol>

          <div className="bxo-product-surface__continuity">
            <span data-bxo-product-continuity-label>Terms</span>
            <span className="bxo-product-surface__continuity-line" data-bxo-product-line aria-hidden="true" />
            <span data-bxo-product-continuity-label>Controlled execution</span>
            <span className="bxo-product-surface__continuity-line" data-bxo-product-line aria-hidden="true" />
            <span data-bxo-product-continuity-label>Ownership</span>
          </div>
        </div>

        <aside className="bxo-product-surface__evidence" aria-label="Evidence linked to the issuance record">
          <div className="bxo-product-surface__overline">Evidence ledger</div>
          <div className="mt-5">
            {evidence.map(([label, detail], index) => (
              <div key={label} className="bxo-product-surface__evidence-row" data-bxo-product-evidence>
                <span className="bxo-product-surface__evidence-index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <div className="text-sm font-semibold text-bxo-text-primary">{label}</div>
                  <div className="mt-1 text-xs leading-5 text-bxo-text-tertiary">{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
