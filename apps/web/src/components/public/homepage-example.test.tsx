import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HomepageExample } from './homepage-example'

describe('read-only Homepage V4 product illustration', () => {
  it('labels the fictional product and valueless denomination without manufacturing a holding', () => {
    const html = renderToStaticMarkup(<HomepageExample />)
    expect(html).toContain('Illustrative testnet example')
    expect(html).toContain('Atlas Property SPV')
    expect(html).toContain('Fictional example')
    expect(html).toContain('Harbour Capital (fictional)')
    expect(html).toContain('10 interests × 100 TST')
    expect(html).toContain('Total: 1,000 TST')
    expect(html).toContain('Issuance approval required')
    expect(html).toContain('Required independent approval remains outstanding.')
    expect(html).toContain('Position: not issued')
    expect(html).toContain('TST is valueless test settlement')
    expect(html).toContain('not observed transactions')
    expect(html).not.toContain('100 TEST')
  })

  it('provides three initially closed native disclosures with honest terms, settlement and position content', () => {
    const html = renderToStaticMarkup(<HomepageExample />)
    const records = html.match(/<details\b[\s\S]*?<\/details>/g) ?? []
    expect(records).toHaveLength(3)
    for (const [index, id] of ['example-terms', 'example-settlement', 'example-position'].entries()) {
      expect(records[index]).toContain(`id="${id}"`)
      expect(records[index]).toMatch(/<summary\b/)
      expect(records[index]).toMatch(/<p>/)
      expect(records[index]).not.toMatch(/^<details\b[^>]*\bopen(?:=|\s|>)/)
    }
    expect(html).toContain('This is not an offering, signed agreement or approved allocation.')
    expect(html).toContain('No transfer, provider evidence or accounting posting has occurred')
    expect(html).toContain('Matched settlement does not grant issuance authority.')
    expect(html).toContain('No holding or legal-register entry exists')
    expect(html).toContain('finality and register/accounting reconciliation')
  })

  it('does not present decorative workspace areas as fake navigation or invoke business operations', () => {
    const html = renderToStaticMarkup(<HomepageExample />)
    expect(html).toContain('Illustrative workspace areas, not navigation')
    expect(html).toContain('blockxone-mark.png')
    expect(html).not.toMatch(/<form\b|<button\b|href=|role="button"|role="tab"/)
    const source = readFileSync(new URL('./homepage-example.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/['"]use client['"]|fetch\s*\(|useEffect\s*\(|onClick=|\/api\/|\.rpc\s*\(/)
  })
})
