import { describe, expect, it } from 'vitest'
import { BX1_ROLES } from '../supabase/contracts'
import type { PortalSnapshot } from './contracts'
import { APPLICANT_CONTEXT, portalContextKey, portalContextMatches, portalOperatingContextSchema, portalScopeHref, portalViewAllowed, type PortalOperatingContext } from './operating-context'

const organisation = '33333333-3333-4333-8333-333333333333'
const otherOrganisation = '44444444-4444-4444-8444-444444444444'
const investor: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'Investor' }
const snapshot: PortalSnapshot = { actor: { id: 'actor', email: 'actor@example.invalid', display_name: null, can_review: false }, organisations: [], applications: [], products: [], subscriptions: [], events: [] }

describe('strict personal and operational context', () => {
  it.each(BX1_ROLES)('accepts the exact %s context shape without granting authority', role => {
    expect(portalOperatingContextSchema.parse({ mode: 'ROLE', organisationId: organisation, role })).toEqual({ mode: 'ROLE', organisationId: organisation, role })
  })
  it.each([undefined, null, [], {}, { mode: 'applicant' }, { mode: 'ROLE' }, { mode: 'ROLE', organisationId: 'invalid', role: 'Investor' }, { mode: 'ROLE', organisationId: organisation, role: 'WealthManager' }, { ...investor, actor_id: 'another' }, { mode: 'APPLICANT', role: 'SuperAdmin' }, { mode: 'APPLICANT', organisationId: organisation }])('denies malformed or extra context authority %#', context => {
    expect(portalOperatingContextSchema.safeParse(context).success).toBe(false)
  })
  it('separates personal, organisation and role context identities', () => {
    expect(portalContextKey(APPLICANT_CONTEXT)).toBe('applicant')
    expect(portalContextKey(investor)).not.toBe(portalContextKey(APPLICANT_CONTEXT))
    expect(portalContextMatches(investor, investor)).toBe(true)
    expect(portalContextMatches({ ...investor, organisationId: otherOrganisation }, investor)).toBe(false)
    expect(portalContextMatches({ ...investor, role: 'SuperAdmin' }, investor)).toBe(false)
    expect(portalContextMatches(APPLICANT_CONTEXT, investor)).toBe(false)
    expect(portalContextMatches({ ...investor, extra: true }, investor)).toBe(false)
    expect(portalContextMatches(undefined, investor)).toBe(false)
  })
})

describe('context-preserving navigation', () => {
  it.each(['/portal', '/portal/products', '/portal/products/detail', '/portal/compliance/detail', '/api/portal/documents'])('preserves the acting scope and selected record for %s', path => {
    const target = new URL(portalScopeHref(path, investor, 'record & 1'), 'https://example.invalid')
    expect(target.pathname).toBe(path)
    expect(target.searchParams.get('organisation')).toBe(organisation)
    expect(target.searchParams.get('role')).toBe('Investor')
    expect(target.searchParams.get('id')).toBe('record & 1')
    expect(target.searchParams.get('mode')).toBeNull()
  })
  it('replaces old role selection when entering personal onboarding', () => {
    const target = new URL(portalScopeHref(`/portal/onboarding?organisation=${organisation}&role=SuperAdmin&mode=invalid&status=draft`, APPLICANT_CONTEXT), 'https://example.invalid')
    expect(target.searchParams.get('mode')).toBe('applicant')
    expect(target.searchParams.get('organisation')).toBeNull()
    expect(target.searchParams.get('role')).toBeNull()
    expect(target.searchParams.get('status')).toBe('draft')
  })
  it('does not attach portal scope to account-security or unrelated destinations', () => {
    expect(portalScopeHref('/workspace/security', investor)).toBe('/workspace/security')
    expect(portalScopeHref('/login', investor)).toBe('/login')
  })
})

describe('view permissions do not substitute for backend authority', () => {
  it('keeps personal onboarding available but prevents applicant access to reviewer or mapped staff screens', () => {
    const data: PortalSnapshot = { ...snapshot, actor: { ...snapshot.actor, can_review: true }, organisations: [{ id: 'portal-org', name: 'A', status: 'ACTIVE', roles: ['OfferingManager'], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' }] }
    expect(portalViewAllowed('/portal/onboarding', APPLICANT_CONTEXT, data)).toBe(true)
    expect(portalViewAllowed('/portal/compliance', APPLICANT_CONTEXT, data)).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', APPLICANT_CONTEXT, data)).toBe(false)
    expect(portalViewAllowed('/portal/products', APPLICANT_CONTEXT, data)).toBe(false)
  })
  it('permits only the explicitly unbound legacy-owner product path in applicant context', () => {
    const data: PortalSnapshot = { ...snapshot, organisations: [{ id: 'legacy-org', name: 'Legacy A', status: 'ACTIVE', roles: ['OfferingManager'], authority_source: 'LEGACY_OWNER' }] }
    expect(portalViewAllowed('/portal/products', APPLICANT_CONTEXT, data)).toBe(true)
    expect(portalViewAllowed('/portal/products', APPLICANT_CONTEXT, { ...data, organisations: [{ ...data.organisations[0], status: 'SUSPENDED' }] })).toBe(false)
  })
  it('requires matching native organisation and role for a product workspace', () => {
    const manager: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'OfferingManager' }
    const data: PortalSnapshot = { ...snapshot, organisations: [{ id: 'bound-org', name: 'A', status: 'ACTIVE', roles: ['OfferingManager'], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' }] }
    expect(portalViewAllowed('/portal/products/new', manager, data)).toBe(true)
    expect(portalViewAllowed('/portal/products/new', { ...manager, organisationId: otherOrganisation }, data)).toBe(false)
    expect(portalViewAllowed('/portal/products', investor, data)).toBe(false)
    expect(portalViewAllowed('/portal/products', manager, { ...data, organisations: [{ ...data.organisations[0], status: 'REVOKED' }] })).toBe(false)
  })
  it('does not make an account-wide reviewer flag sufficient outside the selected compliance role', () => {
    const data = { ...snapshot, actor: { ...snapshot.actor, can_review: true } }
    expect(portalViewAllowed('/portal/compliance', investor, data)).toBe(false)
    expect(portalViewAllowed('/portal/compliance', { ...investor, role: 'ComplianceOfficer' }, data)).toBe(true)
    expect(portalViewAllowed('/portal/compliance', { ...investor, role: 'ComplianceOfficer' }, snapshot)).toBe(false)
  })
  it.each(['OfferingManager', 'IssuerFundManager', 'TransferAgent', 'TokenisationAgent', 'TreasuryOperator', 'FinancialController', 'SuperAdmin'] as const)('does not use %s as an investor instruction role', role => {
    expect(portalViewAllowed('/portal/portfolio', { ...investor, role }, snapshot)).toBe(false)
    expect(portalViewAllowed('/portal/opportunities/detail', { ...investor, role }, snapshot)).toBe(false)
  })
})
