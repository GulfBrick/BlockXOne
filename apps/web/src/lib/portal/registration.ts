import { validateSetupPassword } from '@/lib/supabase/password-setup'

export const REGISTRATION_INTENTS = ['investor', 'wealth-manager'] as const
export type RegistrationIntent = (typeof REGISTRATION_INTENTS)[number]
export const REGISTRATION_TERMS_VERSION = 'testnet-2026-09-21'
export const REGISTRATION_CHECK_EMAIL = 'If this address can be registered, a confirmation email will arrive shortly. Open it to verify your email, then continue your application. If you already have an account, sign in instead.'
export const REGISTRATION_ERRORS = {
  invalid_request: 'The registration request could not be read. Please complete the form again.',
  email_invalid: 'Enter a valid email address you can access.',
  intent_required: 'Choose investor or wealth manager to start your application.',
  password_length: 'Use a password between 12 and 1,024 characters.',
  password_mismatch: 'The passwords do not match. Enter exactly the same password in both fields.',
  consent_required: 'Read and accept the account terms and registration privacy notice to continue.',
  password_rejected: 'That password could not be accepted. Choose a different unique passphrase and try again.',
  rate_limited: 'Registration requests are temporarily limited. Wait a few minutes, then try again or check your inbox.',
  unavailable: 'Registration is temporarily unavailable. Check your inbox before trying again; an earlier request may have completed.',
} as const
export type RegistrationError = keyof typeof REGISTRATION_ERRORS
export type RegistrationInput = { email: string; password: string; intent: RegistrationIntent }
export type RegistrationValidation = { ok: true; value: RegistrationInput } | { ok: false; error: RegistrationError }

export function isRegistrationError(value: unknown): value is RegistrationError {
  return typeof value === 'string' && Object.hasOwn(REGISTRATION_ERRORS, value)
}

export function isRegistrationIntent(value: unknown): value is RegistrationIntent {
  return typeof value === 'string' && REGISTRATION_INTENTS.includes(value as RegistrationIntent)
}

/** Shared validation only. The selected path is an application preference, never an assigned role. */
export function validateRegistrationForm(form: URLSearchParams): RegistrationValidation {
  const allowed = new Set(['email', 'password', 'confirmPassword', 'intent', 'consent'])
  for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1) return { ok: false, error: 'invalid_request' }
  const email = form.get('email')?.trim() ?? ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'email_invalid' }
  const intent = form.get('intent')
  if (!isRegistrationIntent(intent)) return { ok: false, error: 'intent_required' }
  const password = form.get('password') ?? ''
  const passwordError = validateSetupPassword(password, form.get('confirmPassword') ?? '')
  if (passwordError === 'password_length' || passwordError === 'password_mismatch') return { ok: false, error: passwordError }
  if (passwordError) return { ok: false, error: 'password_rejected' }
  if (form.get('consent') !== 'accepted') return { ok: false, error: 'consent_required' }
  return { ok: true, value: { email, password, intent } }
}

/** User-editable descriptive metadata. Authorization must use reviewed database assignments. */
export function registrationMetadata(intent: RegistrationIntent, environment: 'TESTNET' | 'MAINNET' = 'TESTNET') {
  return { portal_intent: intent, registration_terms_version: environment === 'TESTNET' ? REGISTRATION_TERMS_VERSION : 'identity-2026-09-21' }
}

export function registrationProviderOutcome(error: { code?: string; status?: number } | null): 'check-email' | RegistrationError {
  if (!error || ['user_already_exists', 'email_exists'].includes(error.code ?? '')) return 'check-email'
  if (error.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code ?? '')) return 'rate_limited'
  if (error.code === 'weak_password') return 'password_rejected'
  return 'unavailable'
}
