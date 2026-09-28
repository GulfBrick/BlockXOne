import { z } from 'zod'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import type { PortalPath, PortalSnapshot } from './contracts'

export const portalOperatingContextSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ROLE'), organisationId: z.string().uuid(), role: z.enum(BX1_ROLES) }).strict(),
  z.object({ mode: z.literal('APPLICANT') }).strict(),
])
export type PortalOperatingContext = z.infer<typeof portalOperatingContextSchema>
export const APPLICANT_CONTEXT: PortalOperatingContext = { mode: 'APPLICANT' }

/** Context selects existing authority. Neither a URL nor this value grants it. */
export function portalScopeHref(path: PortalPath | string, context?: PortalOperatingContext, id?: string): string {
  if (path !== '/portal' && !path.startsWith('/portal/') && !path.startsWith('/portal?') && !path.startsWith('/api/portal/documents')) return path
  const [base, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.delete('organisation'); params.delete('role'); params.delete('mode')
  if (context?.mode === 'ROLE') { params.set('organisation', context.organisationId); params.set('role', context.role) }
  if (context?.mode === 'APPLICANT') params.set('mode', 'applicant')
  if (id !== undefined) params.set('id', id)
  return params.size ? `${base}?${params}` : base
}
export function portalContextKey(context: PortalOperatingContext): string {
  return context.mode === 'APPLICANT' ? 'applicant' : `${context.organisationId}:${context.role}`
}
export function portalContextMatches(actual: unknown, expected: PortalOperatingContext): boolean {
  const parsed = portalOperatingContextSchema.safeParse(actual)
  return parsed.success && portalContextKey(parsed.data) === portalContextKey(expected)
}
export function portalViewAllowed(view: PortalPath, context: PortalOperatingContext, snapshot: PortalSnapshot): boolean {
  if (view === '/portal' || view === '/portal/onboarding') return true
  if (view.startsWith('/portal/compliance')) return context.mode === 'ROLE' && context.role === 'ComplianceOfficer' && snapshot.actor.can_review
  if (view === '/portal/orders/detail') {
    if (context.mode === 'APPLICANT' || context.role === 'Investor') return true
    return ['OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'].includes(context.role)
      && snapshot.organisations.some(org => org.status === 'ACTIVE' && org.native_organisation_id === context.organisationId && org.roles.includes(context.role))
  }
  if (view.startsWith('/portal/products')) {
    if (context.mode === 'ROLE' && !['OfferingManager', 'IssuerFundManager'].includes(context.role)) return false
    return snapshot.organisations.some(org => org.status === 'ACTIVE' && (context.mode === 'APPLICANT'
      ? org.authority_source === 'LEGACY_OWNER'
      : org.native_organisation_id === context.organisationId && org.roles.includes(context.role)))
  }
  return (context.mode === 'APPLICANT' || context.role === 'Investor') && (view.startsWith('/portal/opportunities') || view === '/portal/portfolio')
}
