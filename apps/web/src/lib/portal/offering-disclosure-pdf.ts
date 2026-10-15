import type { PortalProduct } from './contracts'
import type { z } from 'zod'
import { offeringFileKindSchema } from './offering-files'

type Kind = z.infer<typeof offeringFileKindSchema>
const categories = {
  MEMORANDUM: { field: 'memorandum', title: 'Offering memorandum' },
  RISKS: { field: 'risks', title: 'Risk disclosures' },
  SUBSCRIPTION_TERMS: { field: 'subscription_terms', title: 'Subscription agreement' },
} as const
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = /^[0-9a-f]{64}$/
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

/** No substitutions, truncation or inferred terms. Non-ASCII needs a supplied,
 * font-embedded PDF through the existing upload path, not lossy conversion. */
function lines(text: string): string[] {
  if (!/^[\x20-\x7e\r\n\t]*$/.test(text)) throw new Error('These terms need an embedded-font PDF. Upload the original PDF; no characters have been replaced.')
  const result: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const expanded = paragraph.replace(/\t/g, '    ')
    if (!expanded.length) { result.push(''); continue }
    // Fixed-width Courier makes every character fit. Preserve all source
    // characters, including spaces and long identifiers, across visual lines.
    for (let offset = 0; offset < expanded.length; offset += 88) result.push(expanded.slice(offset, offset + 88))
  }
  return result
}

export async function createOfferingDisclosurePdf(product: PortalProduct, kind: Kind): Promise<{ bytes: Uint8Array; title: string; filename: string }> {
  const category = categories[offeringFileKindSchema.parse(kind)]
  const revision = product.offering_package
  if (product.status !== 'IN_REVIEW' || !revision || revision.origin !== 'SUBMITTED'
    || !id.test(product.id) || !id.test(revision.id) || !hash.test(revision.terms_hash)
    || revision.terms_hash !== product.terms_hash || !hash.test(revision.document_hashes[category.field])) {
    throw new Error('Refresh the current submitted offering before creating its PDF.')
  }
  const source = product.terms.documents[category.field]
  if (typeof source !== 'string' || source.length < 50 || Array.from(source).length > 12000) {
    throw new Error('The submitted disclosure text is unavailable. No PDF was created.')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (actual !== revision.document_hashes[category.field]) throw new Error('The disclosure text does not match its saved revision. Refresh before creating a PDF.')
  const content = [
    'BlockXOne - Submitted offering disclosure', category.title, ...lines(product.terms.name), '',
    `Product: ${product.id}`, `Offering revision: ${revision.id}`,
    `Terms SHA-256: ${revision.terms_hash}`, `Text SHA-256: ${revision.document_hashes[category.field]}`,
    '', 'BEGIN SUBMITTED TEXT', ...lines(source), 'END SUBMITTED TEXT', '',
    'This document reproduces saved disclosure text. It is not proof of',
    'legal approval, malware scanning, a signature or investment eligibility.',
  ]
  const pages: string[][] = []
  for (let offset = 0; offset < content.length; offset += 56) pages.push(content.slice(offset, offset + 56))
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']
  const kids: string[] = []
  pages.forEach((page, index) => {
    const pageId = objects.length + 1, streamId = pageId + 1
    kids.push(`${pageId} 0 R`)
    const stream = `BT /F1 9 Tf 12 TL 36 800 Td\n${page.map(line => `(${escape(line)}) Tj T*`).join('\n')}\n(${index + 1} / ${pages.length}) Tj\nET\n`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
  })
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return { bytes: new TextEncoder().encode(pdf), title: category.title,
    filename: `bx1-${revision.id}-${category.field}.pdf` }
}
