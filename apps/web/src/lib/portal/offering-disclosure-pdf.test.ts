import { webcrypto, createHash } from 'node:crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { PortalProduct } from './contracts'
import { createOfferingDisclosurePdf } from './offering-disclosure-pdf'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
function product(text = 'Actual saved disclosure (with parentheses) and \\ paths. '.repeat(100)): PortalProduct {
  const documents = { memorandum: text, risks: `${text} RISK END`, subscription_terms: `${text} TERMS END` }
  return { id: '33333333-3333-4333-8333-333333333333', status: 'IN_REVIEW', revision: 2,
    terms_hash: 'a'.repeat(64), terms: { name: 'Saved fund', documents },
    offering_package: { id: '44444444-4444-4444-8444-444444444444', origin: 'SUBMITTED', terms_hash: 'a'.repeat(64),
      document_hashes: { memorandum: sha(documents.memorandum), risks: sha(documents.risks), subscription_terms: sha(documents.subscription_terms) } } } as PortalProduct
}
afterEach(() => vi.unstubAllGlobals())
describe('offering disclosure PDF generation (not scanner or signature proof)', () => {
  it('renders every category from exact saved text with valid byte offsets and multiple pages', async () => {
    vi.stubGlobal('crypto', webcrypto)
    for (const kind of ['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'] as const) {
      const p = product(), a = await createOfferingDisclosurePdf(p, kind), b = await createOfferingDisclosurePdf(p, kind)
      expect(a.bytes).toEqual(b.bytes)
      const pdf = new TextDecoder().decode(a.bytes)
      expect(pdf.startsWith('%PDF-1.4')).toBe(true)
      expect(pdf.endsWith('%%EOF\n')).toBe(true)
      expect(pdf).toContain('/Count 2')
      expect(pdf).toContain('BEGIN SUBMITTED TEXT')
      expect(pdf).toContain('END SUBMITTED TEXT')
      expect(pdf).toContain('\\(with parentheses\\)')
      expect(pdf).toContain(p.offering_package!.id)
      const offset = Number(pdf.match(/startxref\n(\d+)/)![1])
      expect(pdf.slice(offset, offset + 4)).toBe('xref')
      const entries = pdf.slice(offset).split('\n').filter(line => /^\d{10} 00000 n /.test(line))
      entries.forEach((line, index) => expect(pdf.slice(Number(line.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj`)))
    }
  })
  it('rejects changed text, non-current package and unsupported characters without loss', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const changed = product(); changed.terms.documents.risks += ' tampered'
    await expect(createOfferingDisclosurePdf(changed, 'RISKS')).rejects.toThrow('does not match')
    await expect(createOfferingDisclosurePdf({ ...product(), status: 'DRAFT' }, 'RISKS')).rejects.toThrow('current submitted')
    const legacy = product(); legacy.offering_package!.origin = 'LEGACY_PRODUCT_SNAPSHOT'
    await expect(createOfferingDisclosurePdf(legacy, 'RISKS')).rejects.toThrow('current submitted')
    await expect(createOfferingDisclosurePdf(product('Preserve every character: résumé. '.repeat(3)), 'RISKS')).rejects.toThrow('embedded-font PDF')
  })
})
