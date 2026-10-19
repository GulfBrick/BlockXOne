import { ArrowRight, CircleAlert } from 'lucide-react'

import { BrandMark } from '@/components/brand/brand-mark'
import styles from '@/app/homepage-v4.module.css'

const exampleRecords = [
  { id: 'example-terms', title: 'Terms record', text: 'Illustrative property-SPV interest: 10 interests at 100 TST each, total 1,000 TST. This is not an offering, signed agreement or approved allocation.' },
  { id: 'example-settlement', title: 'Settlement evidence', text: 'The illustration assumes that 1,000 TST has been matched for the subscription. No transfer, provider evidence or accounting posting has occurred in this example. Matched settlement does not grant issuance authority.' },
  { id: 'example-position', title: 'Position record - not issued', text: 'No holding or legal-register entry exists in this illustration. Independent approval, authorised network execution, finality and register/accounting reconciliation remain necessary before showing complete ownership.' },
]

/** Editorial illustration only. It deliberately has no API, account or transaction authority. */
export function HomepageExample() {
  return (
    <div className={styles.productExample} aria-labelledby="example-heading">
      <aside className={styles.exampleRail} aria-label="Illustrative workspace areas, not navigation">
        <BrandMark /><span className={styles.railActive}>Workspace</span><span>Product</span><span>Investors</span><span>Records</span><span className={styles.railLabel}>Illustration only</span>
      </aside>
      <div className={styles.exampleBody}>
        <p className={styles.exampleOverline}>Illustrative testnet example</p>
        <h3 id="example-heading">Atlas Property SPV <span>Fictional example</span></h3>
        <dl className={styles.exampleOverview}>
          <div><dt>Terms</dt><dd>Rights and conditions</dd></div><div><dt>Investors</dt><dd>Eligibility and mandates</dd></div><div><dt>Settlement</dt><dd>Instructions and evidence</dd></div><div><dt>Ownership</dt><dd>Register and positions</dd></div>
        </dl>
        <div className={styles.exampleDecisionGrid}>
          <section aria-labelledby="example-subscription-heading">
            <h4 id="example-subscription-heading">Subscription instruction</h4><p className={styles.exampleEquation}>10 interests × 100 TST</p><p className={styles.exampleTotal}>Total: 1,000 TST</p>
            <dl className={styles.subscriptionFacts}><div><dt>Investor</dt><dd>Harbour Capital (fictional)</dd></div><div><dt>Product</dt><dd>Atlas Property SPV</dd></div><div><dt>Instruction</dt><dd>Primary subscription</dd></div></dl>
          </section>
          <section aria-labelledby="example-decision-heading">
            <h4 id="example-decision-heading">Next decision</h4><p className={styles.approvalRequired}><CircleAlert size={20} aria-hidden="true" />Issuance approval required</p><p>Required independent approval remains outstanding.</p><p className={styles.pendingPosition}>Position: not issued</p>
          </section>
        </div>
        <div id="example-records" className={styles.exampleRecords}>{exampleRecords.map(({ id, title, text }) => <details key={id} id={id}><summary>{title}<ArrowRight size={18} aria-hidden="true" /></summary><p>{text}</p></details>)}</div>
        <p className={styles.exampleBoundary}>Matched settlement does not grant issuance authority. TST is valueless test settlement; all values and states here are fictional, not observed transactions.</p>
      </div>
    </div>
  )
}
