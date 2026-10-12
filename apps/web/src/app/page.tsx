import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { HomepageExample } from '@/components/public/homepage-example'
import { PublicShell } from '@/components/public/public-shell'
import { BRANDED_ENTRY } from '@/lib/branded-entry'
import { platformRelease } from '@/lib/platform-release'

import styles from './homepage-v4.module.css'

const assetStructures = [
  { index: '01', title: 'Private debt', text: 'Keep economic terms, maturity and authorised issue connected.', crop: styles.debtStudy },
  { index: '02', title: 'Fund interests', text: 'Preserve share classes, dealing terms and distributions.', crop: styles.fundStudy },
  { index: '03', title: 'Real estate SPVs', text: 'Connect the vehicle, property evidence and ownership rights.', crop: styles.propertyStudy },
]

const responsibilities = [
  ['Offering teams', 'Prepare the product and its versioned terms.'],
  ['Compliance', 'Review admission and product-specific eligibility.'],
  ['Finance', 'Match funding, reconcile and post independently.'],
  ['Transfer agents', 'Maintain holder and register continuity.'],
  ['Tokenisation agents', 'Prepare governed network operations.'],
  ['Investors', 'Review terms and instruct eligible investments.'],
]

const lifecycle = [
  ['Model', 'Define the product and its rights.'],
  ['Approve', 'Review the exact terms and appointments.'],
  ['Qualify', 'Check the account, eligibility and mandate.'],
  ['Subscribe', 'Accept terms and record the instruction.'],
  ['Reconcile', 'Match settlement and accounting evidence.'],
  ['Issue', 'Obtain authority and verify finalised execution.'],
  ['Prove', 'Reconcile the holding, register and ledger.'],
]

const evidenceIndex = [
  { title: 'Terms and approvals', text: 'An offering revision fixes the accepted terms. The fictional Atlas example still requires independent issuance approval; it is not an approved investment offer.' },
  { title: 'Settlement evidence', text: 'This illustration assumes a match of 1,000 valueless TST. A payment claim or match alone cannot approve issuance, and no real payment is displayed here.' },
  { title: 'Network receipt', text: 'There is no transaction or finalised network receipt in this example. A successful outer receipt would not, by itself, prove the authorised inner operation.' },
  { title: 'Position and register', text: 'No interests have been issued in this example. A completed holding requires finalised execution and reconciliation with the legal register and accounting.' },
]

function Arrow() {
  return <ArrowRight size={20} aria-hidden="true" />
}

export default function HomePage() {
  const environment = platformRelease(process.env)?.environment
  const testnetHref = environment === 'TESTNET' ? '/register' : BRANDED_ENTRY.testnetRegister

  return (
    <PublicShell variant="homepage">
      <main id="main-content" className={styles.page}>
        <section className={styles.hero} aria-labelledby="home-heading">
          <div className={styles.container}>
            <div className={styles.heroCopy}>
              <p className={styles.overline}>Private-market infrastructure</p>
              <h1 id="home-heading" className={styles.heroHeading}>
                <span>Bring private assets</span>
                <span>into <em>one working system.</em></span>
              </h1>
              <p className={styles.heroDescription}>Coordinate your teams, investor instructions and asset records - from approved terms to ownership.</p>
              <div className={styles.actions}>
                <Link href="/request-demo" className={styles.primaryAction}>Book a walkthrough <Arrow /></Link>
                <Link href="/how-it-works" className={styles.textAction}>See the platform <Arrow /></Link>
              </div>
              <p className={styles.audience}>For wealth managers, asset managers and private-market teams.</p>
            </div>
            <figure className={styles.heroArt}>
              <Image src="/editorial/homepage-sculpture-v4.png" alt="An abstract private-asset study in ivory paper, limestone, dark metal and a translucent turquoise plane" width={1536} height={1024} sizes="(max-width: 767px) 100vw, (max-width: 1535px) 66vw, 1050px" priority className={styles.sculpture} />
              <div className={styles.artScrim} aria-hidden="true" />
              <svg className={styles.heroConnector} viewBox="0 0 420 120" fill="none" aria-hidden="true"><path d="M0 110H230C265 110 240 35 285 35H418" /></svg>
              <figcaption className={styles.relationship}>
                <span className={styles.relationshipLabel}>Illustrative relationship</span>
                <span>Instrument</span><span className={styles.relationshipArrow} aria-hidden="true">↓</span>
                <span>Decision</span><span className={styles.relationshipArrow} aria-hidden="true">↓</span>
                <span>Position</span>
              </figcaption>
            </figure>
            <ul className={styles.outcomes} aria-label="The coordination model"><li>Align the work.</li><li>Make responsibility clear.</li><li>Keep the records connected.</li></ul>
          </div>
        </section>

        <div className={styles.lightChapter}>
          <section id="workspace-example" className={`${styles.container} ${styles.workspace}`} aria-labelledby="workspace-heading">
            <div className={styles.sectionIntroduction}>
              <div><p className={styles.overline}>01 / The workspace</p><h2 id="workspace-heading" className={styles.displayHeading}>A clear view of the work.<br />A record of <em>how it happened.</em></h2></div>
              <p className={styles.sectionDescription}>Bring instrument setup, investor onboarding, settlement and issuance into a shared workflow, with distinct responsibilities.</p>
            </div>
            <HomepageExample />
            <a href="#example-records" className={styles.lightTextAction}>Explore the worked example <Arrow /></a>
          </section>
          <section className={`${styles.container} ${styles.assets}`} aria-labelledby="assets-heading">
            <p className={styles.overline}>02 / Asset structures</p>
            <h2 id="assets-heading" className={styles.displayHeading}>Start with the asset.<br />Preserve what makes it different.</h2>
            <div className={styles.assetGrid}>
              {assetStructures.map(({ index, title, text, crop }) => (
                <article key={title} className={styles.assetStructure}>
                  <div className={`${styles.materialStudy} ${crop}`} aria-hidden="true"><Image src="/editorial/homepage-sculpture-v4.png" alt="" fill sizes="(max-width: 767px) 100vw, 33vw" /></div>
                  <span className={styles.assetNumber}>{index}</span><h3>{title}</h3><p>{text}</p>
                  <Link href="/asset-classes" className={styles.lightTextAction}>Explore {title.toLowerCase()} <Arrow /></Link>
                </article>
              ))}
            </div>
            <p className={styles.modelBoundary}>Product operating models, not available investment offers. Each product and jurisdiction requires its own appointments and admission.</p>
          </section>
          <section className={`${styles.container} ${styles.responsibility}`} aria-labelledby="responsibility-heading">
            <div>
              <p className={styles.overline}>03 / Responsibility</p><h2 id="responsibility-heading" className={styles.displayHeading}>Work together.<br />Keep authority distinct.</h2>
              <p className={styles.sectionDescription}>Access and signing authority follow the relevant mandate. A shared record is not a shared wallet or universal permission.</p>
              <div className={styles.participantLinks}><Link href="/for-operators" className={styles.lightTextAction}>For institutions <Arrow /></Link><Link href="/for-investors" className={styles.lightTextAction}>For investors <Arrow /></Link></div>
            </div>
            <div className={styles.responsibilityMap}>
              <p className={styles.sharedRecord}>Shared record<span>Distinct responsibilities</span></p>
              <ul>{responsibilities.map(([title, text]) => <li key={title}><h3>{title}</h3><p>{text}</p></li>)}</ul>
            </div>
          </section>
        </div>

        <section className={styles.evidenceChapter} aria-labelledby="evidence-heading">
          <div className={styles.container}>
            <div className={styles.evidenceLayout}>
              <div><p className={styles.overline}>04 / Evidence</p><h2 id="evidence-heading" className={styles.displayHeading}>Understand the position.<br />Trace the decisions.</h2><p className={styles.sectionDescription}>Follow the terms, approvals, settlement evidence and network records behind a position.</p></div>
              <div className={styles.evidenceIndex}>
                <p className={styles.overline}>Illustrative record index</p>
                {evidenceIndex.map(({ title, text }) => <details key={title}><summary>{title}<span>View <Arrow /></span></summary><p>{text}</p></details>)}
              </div>
            </div>
            <ol className={styles.lifecycle} aria-label="The seven business workflow stages">{lifecycle.map(([title, text]) => <li key={title}><span className={styles.lifecycleDot} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></li>)}</ol>
            <div className={styles.lifecycleFoot}><p>Each stage retains its own checks and accountable decisions.</p><Link href="/security-and-compliance" className={styles.textAction}>Security and operating controls <Arrow /></Link></div>
          </div>
        </section>
        <section className={styles.invitation} aria-labelledby="invitation-heading">
          <div className={styles.container}>
            <h2 id="invitation-heading" className={styles.displayHeading}>See how your team<br />could work on BlockXOne.</h2>
            <p>Walk through your operating model, the responsibilities and the records.</p>
            <div className={styles.actions}><Link href="/request-demo" className={styles.primaryAction}>Book a walkthrough <Arrow /></Link>{environment ? <a href={testnetHref} className={styles.textAction}>Explore testnet <Arrow /></a> : null}</div>
            <span className={styles.lineEnd} aria-hidden="true" />
          </div>
        </section>
      </main>
    </PublicShell>
  )
}
