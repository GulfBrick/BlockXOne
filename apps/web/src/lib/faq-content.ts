/** Public guidance only. Workspace state, not this copy, determines availability. */
export const FAQ_TOPICS = [
  {
    id: 'getting-started', title: 'Getting started', questions: [
      { question: 'Should I start as an investor or a wealth manager?', answer: 'Choose investor for your own investment relationship or an entity you represent. Choose wealth manager when applying to structure or manage offerings for your organisation. Registration creates a personal login; it does not approve either capacity, appoint you to a product or give authority over client accounts.' },
      { question: 'Can one person work in more than one capacity?', answer: 'Yes. Use the same personal account to apply for an additional capacity, then switch to the relevant application or assigned workspace. Access is scoped to your organisation and role. A capacity in one organisation does not give access to another.' },
    ],
  },
  {
    id: 'applications', title: 'Applications and review', questions: [
      { question: 'Can I save an application and return later?', answer: 'Save your draft in My applications and check the saved state before leaving. Sign back into the same environment and account to resume. Saving is not submission: use Submit when the required information and supporting documents are ready for review.' },
      { question: 'What happens after I submit?', answer: 'The submitted revision becomes the review record. An independent reviewer can request changes or make a review decision. Submission alone does not approve your application, assign a role or make you eligible to invest.' },
      { question: 'What is a request for information (RFI)?', answer: 'An RFI asks you to correct or provide information. Read the reviewer’s request in your application, make the requested changes, save and resubmit for review. Check the application status rather than assuming an upload or provider result closes the request.' },
    ],
  },
  {
    id: 'products-and-investing', title: 'Products and investing', questions: [
      { question: 'How does a wealth manager set up a fund or property offering?', answer: 'The intended workflow starts with a product draft: record the issuer, fund or property terms, ownership classes, pricing and dealing rights, then add the private supporting documents. The appointed issuer and compliance reviewer have separate responsibilities, including review of the exact documents and required e-signature evidence. Publication requires the relevant readiness checks; technical readiness alone is not legal clearance or permission to accept funds. Your workspace shows which steps are enabled.' },
      { question: 'How does an investor go from an offering to a holding?', answer: 'The intended sequence is to discover eligible published offerings, review the terms and disclosures, then submit a subscription or reservation. Where enabled, funding instructions follow; funds must be independently verified and reconciled before authorised issuance and a recorded holding. A reservation, payment instruction or submitted subscription does not automatically complete those later steps. Check the status and evidence in your workspace.' },
      { question: 'How should I read portfolio value and returns?', answer: 'Portfolio value should use reviewed, dated valuations and recorded holdings. Distributions and fees must be distinguished from changes in valuation; a displayed value is not necessarily the price available on exit. Returns are not guaranteed. Where valuation or transaction history is missing, no growth or return should be inferred or invented. Check the source date and available evidence before relying on a figure.' },
      { question: 'Can I redeem or sell whenever I want?', answer: 'Exit depends on the approved product terms and enabled workflow. A fund may have dealing windows, notice periods and redemption restrictions. A property interest may require a permitted transfer or an eventual asset sale and liquidation, rather than fund-style redemption. Each route needs its own approvals, settlement and ownership updates; tokenisation does not promise instant cash-out or a buyer.' },
      { question: 'Can I tokenise a different asset class?', answer: 'An additional asset class needs defined legal and ownership rights, valuation rules, settlement arrangements and a supported lifecycle, followed by the required admission and review. A label or uploaded document is not enough. Fund and property workflows are not proof that any asset can be tokenised immediately; discuss the proposed structure through the Contact / walkthrough page.' },
      { question: 'What fees apply?', answer: 'Check the approved offering disclosures for the applicable platform and product fees before accepting. These should explain the fee basis, when charges apply and their effect on the investment. This FAQ does not set a rate or imply a step is free. If the fee information is absent or unclear, seek clarification before proceeding.' },
    ],
  },
  {
    id: 'verification-and-signing', title: 'Verification and signing', questions: [
      { question: 'How does Sumsub verification relate to application review?', answer: 'Where enabled for a submitted personal application in TEST, the workspace offers an optional Sumsub sandbox step. Availability depends on the environment, subject and configuration shown in that workspace. Manual TEST review remains available independently. A provider result is evidence for review, not application approval, a role grant or investment eligibility.' },
      { question: 'What if a provider step is unavailable?', answer: 'Read the availability message in your current workspace. Do not assume that personal and company verification, or TEST and MAIN, have the same provider setup. Follow the application actions that are actually available; a missing sandbox step does not by itself prevent manual TEST review.' },
      { question: 'Does a DocuSign connection mean my documents are signed?', answer: 'No. Configuration, a prepared document or a signing link is not a completed signature. Check the specific document revision, authorised signers and recorded completion evidence in the relevant workflow. Provider availability and completion must be established for that environment; signing does not replace independent review or production admission.' },
    ],
  },
  {
    id: 'wallets-and-authority', title: 'Wallets and authority', questions: [
      { question: 'What is MetaMask used for?', answer: 'MetaMask is the human wallet and signing experience when a wallet step is required. Connecting a wallet or signing a proof does not grant an organisation role, approve an investment or establish ownership of an asset. Signing authority, custody arrangements and ownership evidence are separate records.' },
      { question: 'Does dashboard access let me move funds or issue tokens?', answer: 'No. A login or assigned dashboard is not transaction authority. Sensitive actions require the relevant scope, mandates, independent approvals and evidence. An investment instruction is not proof of payment, settlement, token issuance or a recorded holding.' },
    ],
  },
  {
    id: 'environments-and-help', title: 'Environments and help', questions: [
      { question: 'What is the difference between TEST and MAIN?', answer: 'TEST is for fictional applications, synthetic settlement and test tokens with no investment value. MAIN requires its own approved admission and operational controls. Accounts, provider configuration, review decisions and evidence are environment-specific: a successful TEST journey does not establish MAIN readiness.' },
      { question: 'Are the examples investment offers or guarantees?', answer: 'No. Public examples explain the platform; they are not investment offers, guaranteed returns or legal clearance. Any actual offering requires its own terms, disclosures, eligibility review and approvals. Use the status and evidence in the relevant workspace to distinguish available steps from work still needing setup.' },
      { question: 'Where can I ask about the platform?', answer: 'Use the existing Contact / walkthrough page for platform enquiries and to see the contact options currently available. For an application in progress, first read its status and reviewer requests in My applications. Do not send passwords, recovery codes or wallet seed phrases.' },
    ],
  },
] as const
