export const PASSWORD_RECOVERY_ERRORS = ['email-invalid', 'invalid-request', 'unavailable', 'rate-limited'] as const
export type PasswordRecoveryError = typeof PASSWORD_RECOVERY_ERRORS[number]

export function isPasswordRecoveryError(value: unknown): value is PasswordRecoveryError {
  return typeof value === 'string' && PASSWORD_RECOVERY_ERRORS.some(error => error === value)
}

export const PASSWORD_RECOVERY_ERROR_COPY: Record<PasswordRecoveryError, string> = {
  'email-invalid': 'Enter a valid email address.',
  'invalid-request': 'That request could not be read. Please try again.',
  unavailable: 'We could not confirm the reset request. Check your inbox before trying again.',
  'rate-limited': 'Too many reset requests. Wait a few minutes and check your inbox before trying again.',
}

export const PASSWORD_RECOVERY_CHECK_EMAIL_COPY = 'If an account exists for that address, a password-reset email has been requested. Check your inbox and spam folder.'
