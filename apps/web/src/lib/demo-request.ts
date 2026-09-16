export const DEMO_REQUEST_CONSENT_VERSION = '2026-08-02' as const
export const DEMO_REQUEST_SOURCE = 'website' as const

export function isDemoRequestEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_DEMO_REQUEST_ENABLED,
): boolean {
  return value?.trim() === 'true'
}

export const INSTRUMENT_INTEREST_OPTIONS = [
  { value: 'real_estate', label: 'Real estate' },
  { value: 'private_funds', label: 'Private funds' },
  { value: 'private_credit', label: 'Private credit' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'structured_products', label: 'Structured products' },
  { value: 'other', label: 'Other' },
] as const

export const VEHICLE_STAGE_OPTIONS = [
  { value: 'exploring', label: 'Exploring the model' },
  { value: 'structuring', label: 'Structuring the vehicle' },
  { value: 'fundraising', label: 'Fundraising' },
  { value: 'live', label: 'Live and operating' },
  { value: 'migrating', label: 'Migrating an existing vehicle' },
] as const

export const INVESTOR_CLASS_OPTIONS = [
  { value: 'retail', label: 'Retail' },
  { value: 'professional', label: 'Professional' },
  { value: 'institutional', label: 'Institutional' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'undecided', label: 'Not decided yet' },
] as const

export const TIMING_OPTIONS = [
  { value: 'under_30_days', label: 'Within 30 days' },
  { value: 'one_to_three_months', label: '1 to 3 months' },
  { value: 'three_to_six_months', label: '3 to 6 months' },
  { value: 'six_plus_months', label: 'More than 6 months' },
  { value: 'exploring', label: 'Exploring, no fixed date' },
] as const

export type InstrumentInterest = (typeof INSTRUMENT_INTEREST_OPTIONS)[number]['value']
export type VehicleStage = (typeof VEHICLE_STAGE_OPTIONS)[number]['value']
export type InvestorClass = (typeof INVESTOR_CLASS_OPTIONS)[number]['value']
export type DemoTiming = (typeof TIMING_OPTIONS)[number]['value']

export type DemoRequestFormValues = {
  fullName: string
  workEmail: string
  organization: string
  roleTitle: string
  jurisdiction: string
  instrumentInterests: InstrumentInterest[]
  vehicleStage: VehicleStage | ''
  investorClass: InvestorClass | ''
  currentSystems: string
  timing: DemoTiming | ''
  message: string
  consent: boolean
  website: string
}

export type DemoRequestField = keyof DemoRequestFormValues
export type DemoRequestFieldErrors = Partial<Record<DemoRequestField, string>>

export type DemoRequestValidationResult = {
  valid: boolean
  errors: DemoRequestFieldErrors
}

export type DemoRequestSubmissionIdentity = {
  idempotencyKey: string
  formStartedAt: string
}

export type DemoRequestPayload = {
  idempotencyKey: string
  fullName: string
  workEmail: string
  organization: string
  roleTitle: string
  jurisdiction: string
  instrumentInterests: InstrumentInterest[]
  vehicleStage: VehicleStage
  investorClass: InvestorClass
  currentSystems: string
  timing: DemoTiming
  message: string
  consentVersion: typeof DEMO_REQUEST_CONSENT_VERSION
  consent: true
  website: string
  formStartedAt: string
  source: typeof DEMO_REQUEST_SOURCE
}

export type DemoRequestResponse = {
  requestId: string
  status: 'received'
  replayed: boolean
}

export type DemoRequestFailureKind = 'invalid_request' | 'rate_limited' | 'unavailable'

export class DemoRequestSubmissionError extends Error {
  readonly kind: DemoRequestFailureKind
  readonly fields: DemoRequestFieldErrors

  constructor(kind: DemoRequestFailureKind, fields: DemoRequestFieldErrors = {}) {
    super(kind)
    this.name = 'DemoRequestSubmissionError'
    this.kind = kind
    this.fields = fields
  }
}

export function createEmptyDemoRequestFormValues(): DemoRequestFormValues {
  return {
    fullName: '',
    workEmail: '',
    organization: '',
    roleTitle: '',
    jurisdiction: '',
    instrumentInterests: [],
    vehicleStage: '',
    investorClass: '',
    currentSystems: '',
    timing: '',
    message: '',
    consent: false,
    website: '',
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const instrumentInterests = new Set<string>(INSTRUMENT_INTEREST_OPTIONS.map((option) => option.value))
const vehicleStages = new Set<string>(VEHICLE_STAGE_OPTIONS.map((option) => option.value))
const investorClasses = new Set<string>(INVESTOR_CLASS_OPTIONS.map((option) => option.value))
const timings = new Set<string>(TIMING_OPTIONS.map((option) => option.value))

function requiredTextError(value: string, label: string, maximumLength: number): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return `Enter ${label}.`
  if (trimmed.length > maximumLength) return `Use ${maximumLength} characters or fewer.`
  return undefined
}

export function validateDemoRequestForm(values: DemoRequestFormValues): DemoRequestValidationResult {
  const errors: DemoRequestFieldErrors = {}

  errors.fullName = requiredTextError(values.fullName, 'your full name', 120)
  errors.organization = requiredTextError(values.organization, 'your organization', 160)
  errors.roleTitle = requiredTextError(values.roleTitle, 'your role or title', 120)
  errors.jurisdiction = requiredTextError(values.jurisdiction, 'the primary jurisdiction', 120)

  const normalizedEmail = values.workEmail.trim()
  if (!normalizedEmail) {
    errors.workEmail = 'Enter your work email.'
  } else if (normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
    errors.workEmail = 'Enter a valid work email address.'
  }

  const uniqueInterests = new Set(values.instrumentInterests)
  if (values.instrumentInterests.length < 1) {
    errors.instrumentInterests = 'Select at least one instrument interest.'
  } else if (
    values.instrumentInterests.length > 3 ||
    uniqueInterests.size !== values.instrumentInterests.length ||
    values.instrumentInterests.some((value) => !instrumentInterests.has(value))
  ) {
    errors.instrumentInterests = 'Select up to three valid instrument interests.'
  }

  if (!vehicleStages.has(values.vehicleStage)) {
    errors.vehicleStage = 'Select the current vehicle stage.'
  }
  if (!investorClasses.has(values.investorClass)) {
    errors.investorClass = 'Select the intended investor class.'
  }
  if (!timings.has(values.timing)) {
    errors.timing = 'Select an intended timing.'
  }

  if (values.currentSystems.trim().length > 500) {
    errors.currentSystems = 'Use 500 characters or fewer.'
  }
  if (values.message.trim().length > 1000) {
    errors.message = 'Use 1,000 characters or fewer.'
  }
  if (!values.consent) {
    errors.consent = 'Consent is required before we can contact you.'
  }

  for (const field of Object.keys(errors) as DemoRequestField[]) {
    if (!errors[field]) delete errors[field]
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export function buildDemoRequestPayload(
  values: DemoRequestFormValues,
  identity: DemoRequestSubmissionIdentity,
): DemoRequestPayload {
  return {
    idempotencyKey: identity.idempotencyKey,
    fullName: values.fullName.trim(),
    workEmail: values.workEmail.trim(),
    organization: values.organization.trim(),
    roleTitle: values.roleTitle.trim(),
    jurisdiction: values.jurisdiction.trim(),
    instrumentInterests: [...values.instrumentInterests],
    vehicleStage: values.vehicleStage as VehicleStage,
    investorClass: values.investorClass as InvestorClass,
    currentSystems: values.currentSystems.trim(),
    timing: values.timing as DemoTiming,
    message: values.message.trim(),
    consentVersion: DEMO_REQUEST_CONSENT_VERSION,
    consent: true,
    website: values.website.trim(),
    formStartedAt: identity.formStartedAt,
    source: DEMO_REQUEST_SOURCE,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const formFields = new Set<DemoRequestField>([
  'fullName',
  'workEmail',
  'organization',
  'roleTitle',
  'jurisdiction',
  'instrumentInterests',
  'vehicleStage',
  'investorClass',
  'currentSystems',
  'timing',
  'message',
  'consent',
  'website',
])

function parseFieldErrors(value: unknown): DemoRequestFieldErrors {
  if (!isRecord(value)) return {}
  const result: DemoRequestFieldErrors = {}
  for (const [field, message] of Object.entries(value)) {
    if (formFields.has(field as DemoRequestField) && typeof message === 'string' && message.trim()) {
      result[field as DemoRequestField] = message.trim()
    }
  }
  return result
}

function parseSuccessResponse(value: unknown): DemoRequestResponse | null {
  if (!isRecord(value)) return null
  if (
    typeof value.requestId !== 'string' ||
    !value.requestId.trim() ||
    value.status !== 'received' ||
    typeof value.replayed !== 'boolean'
  ) {
    return null
  }
  return {
    requestId: value.requestId.trim(),
    status: 'received',
    replayed: value.replayed,
  }
}

type SubmitDemoRequestOptions = {
  endpoint?: string
  signal?: AbortSignal
}

export function resolveDemoRequestEndpoint(
  value: string | undefined = process.env.NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT,
): string | null {
  const endpoint = (value ?? '').trim()
  return endpoint || null
}

export function resolveDemoRequestPrivacyNoticeUrl(
  value: string | undefined = process.env.NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL,
): string | null {
  let parsed: URL
  try {
    parsed = new URL((value ?? '').trim())
  } catch {
    return null
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '')
  const isIpLiteral = /^[\d.]+$/.test(hostname) || hostname.includes(':')
  if (
    parsed.protocol !== 'https:' ||
    !hostname.includes('.') ||
    isIpLiteral ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.localdomain') ||
    hostname.endsWith('.local') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null
  }

  return parsed.toString()
}

export async function submitDemoRequest(
  payload: DemoRequestPayload,
  options: SubmitDemoRequestOptions = {},
): Promise<DemoRequestResponse> {
  const endpoint = resolveDemoRequestEndpoint(options.endpoint)
  if (!endpoint) throw new DemoRequestSubmissionError('unavailable')

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      signal: options.signal,
    })
  } catch {
    throw new DemoRequestSubmissionError('unavailable')
  }

  const body: unknown = await response.json().catch(() => null)
  if (response.status === 202) {
    const parsed = parseSuccessResponse(body)
    if (parsed) return parsed
    throw new DemoRequestSubmissionError('unavailable')
  }
  if (response.status === 400 && isRecord(body) && body.error === 'invalid_request') {
    throw new DemoRequestSubmissionError('invalid_request', parseFieldErrors(body.fields))
  }
  if (response.status === 429) {
    throw new DemoRequestSubmissionError('rate_limited')
  }
  throw new DemoRequestSubmissionError('unavailable')
}
