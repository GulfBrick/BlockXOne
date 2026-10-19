import { describe, expect, it } from 'vitest'
import { applicantSection, applicantSectionHref, applicantSections } from './applicant-presentation'

describe('applicant presentation sections, not operating authority', () => {
  it.each(applicantSections)('uses the existing explicit applicant boundary for %s', section => {
    expect(applicantSection(section)).toBe(section)
    expect(applicantSectionHref(section)).toBe(`/portal?mode=applicant&section=${section}`)
    expect(applicantSectionHref(section)).not.toContain('organisation=')
    expect(applicantSectionHref(section)).not.toContain('role=')
  })
  it('does not interpret malformed or role-like sections', () => {
    for (const value of [undefined, null, ['applications'], 'compliance', 'Investor', 'applications&role=SuperAdmin']) expect(applicantSection(value)).toBeUndefined()
  })
})
