export const ROLE_HOME_PATHS: Record<string, string> = {
  SuperAdmin: '/admin',
  ComplianceOfficer: '/compliance',
  TokenisationAgent: '/tokenisation-agent',
  IssuerFundManager: '/issuer',
  OfferingManager: '/wm',
  TransferAgent: '/wm/ledger',
  Investor: '/investor/portfolio',
}

const ROLE_PRIORITY = [
  'SuperAdmin',
  'ComplianceOfficer',
  'TokenisationAgent',
  'IssuerFundManager',
  'OfferingManager',
  'TransferAgent',
  'Investor',
]

export function getDefaultRouteForRoles(roles?: string[] | null) {
  if (!roles || roles.length === 0) {
    return '/'
  }

  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) {
      return ROLE_HOME_PATHS[role]
    }
  }

  const firstKnownRole = roles.find((role) => role in ROLE_HOME_PATHS)
  return firstKnownRole ? ROLE_HOME_PATHS[firstKnownRole] : '/'
}

export function hasAnyRole(userRoles: string[] | undefined, allowedRoles: string[]) {
  if (!userRoles || userRoles.length === 0) {
    return false
  }

  return userRoles.some((role) => allowedRoles.includes(role))
}
