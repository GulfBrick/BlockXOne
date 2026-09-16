export const ROLE_HOME_PATHS: Record<string, string> = {
  SuperAdmin: '/admin',
  ComplianceOfficer: '/compliance',
  TokenisationAgent: '/tokenisation-agent',
  TreasuryOperator: '/wm/settlements',
  FinancialController: '/wm/settlements',
  IssuerFundManager: '/wm',
  OfferingManager: '/wm',
  TransferAgent: '/wm',
  Investor: '/investor/portfolio',
}

export const SETTLEMENT_WORKFLOW_ROLES = [
  'TreasuryOperator',
  'FinancialController',
  'SuperAdmin',
] as const

export const SUBSCRIPTION_WORKFLOW_ROLES = [
  'TransferAgent',
  'SuperAdmin',
] as const

export const OFFERING_WORKFLOW_ROLES = [
  'OfferingManager',
  'IssuerFundManager',
  'FinancialController',
  'SuperAdmin',
] as const

export const SETTLEMENT_WORKFLOW_PERMISSIONS = [
  'payment:notify',
  'reconciliation:run',
  'reconciliation:approve',
] as const

const ROLE_PRIORITY = [
  'SuperAdmin',
  'ComplianceOfficer',
  'TokenisationAgent',
  'TreasuryOperator',
  'FinancialController',
  'IssuerFundManager',
  'OfferingManager',
  'TransferAgent',
  'Investor',
]

function roleHomePath(role: string, releaseMode: string | undefined) {
  const normalizedReleaseMode = (releaseMode || '').trim().toLowerCase()
  if (
    role === 'SuperAdmin' &&
    (normalizedReleaseMode === 'pilot' || normalizedReleaseMode === 'pilot-share')
  ) {
    return '/wm'
  }

  return ROLE_HOME_PATHS[role]
}

export function getDefaultRouteForRoles(
  roles?: string[] | null,
  releaseMode: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE
) {
  if (!roles || roles.length === 0) {
    return '/'
  }

  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) {
      return roleHomePath(role, releaseMode)
    }
  }

  const firstKnownRole = roles.find((role) => role in ROLE_HOME_PATHS)
  return firstKnownRole ? roleHomePath(firstKnownRole, releaseMode) : '/'
}

export function hasAnyRole(userRoles: string[] | undefined, allowedRoles: string[]) {
  if (!userRoles || userRoles.length === 0) {
    return false
  }

  return userRoles.some((role) => allowedRoles.includes(role))
}

export function hasAnyPermission(
  userPermissions: Record<string, boolean> | undefined,
  requiredPermissions: readonly string[]
) {
  if (!userPermissions || requiredPermissions.length === 0) {
    return false
  }

  return requiredPermissions.some((permission) => userPermissions[permission] === true)
}
