const decimalPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/
const maximumIntegerDigits = 60
const maximumFractionDigits = 18

export interface ExactDecimal {
  coefficient: bigint
  scale: number
  canonical: string
}

export function parseExactDecimal(value: string): ExactDecimal | null {
  if (value !== value.trim()) return null

  const match = decimalPattern.exec(value)
  if (!match) return null

  const integer = match[1]
  const fraction = match[2] ?? ''
  if (integer.length > maximumIntegerDigits || fraction.length > maximumFractionDigits) {
    return null
  }

  const trimmedFraction = fraction.replace(/0+$/, '')
  const canonical = trimmedFraction ? `${integer}.${trimmedFraction}` : integer
  return {
    coefficient: BigInt(`${integer}${trimmedFraction}`),
    scale: trimmedFraction.length,
    canonical,
  }
}

export function isPositiveExactDecimal(value: ExactDecimal | null): value is ExactDecimal {
  return value !== null && value.coefficient > 0n
}

export function compareExactDecimals(leftValue: string | null, rightValue: string | null): number {
  const left = leftValue === null ? null : parseExactDecimal(leftValue)
  const right = rightValue === null ? null : parseExactDecimal(rightValue)
  if (left === null) return right === null ? 0 : -1
  if (right === null) return 1

  const commonScale = Math.max(left.scale, right.scale)
  const scaledLeft = left.coefficient * 10n ** BigInt(commonScale - left.scale)
  const scaledRight = right.coefficient * 10n ** BigInt(commonScale - right.scale)
  if (scaledLeft < scaledRight) return -1
  if (scaledLeft > scaledRight) return 1
  return 0
}

export function sumExactDecimals(values: string[]): string | null {
  const parsed = values.map(parseExactDecimal)
  if (parsed.some((value) => value === null)) return null
  if (parsed.length === 0) return '0'

  const decimals = parsed as ExactDecimal[]
  const commonScale = Math.max(...decimals.map((value) => value.scale))
  const coefficient = decimals.reduce(
    (sum, value) =>
      sum + value.coefficient * 10n ** BigInt(commonScale - value.scale),
    0n
  )
  return formatCoefficient(coefficient, commonScale)
}

export function formatExactUnits(value: string | null): string {
  if (value === null) return 'Not available'
  const parsed = parseExactDecimal(value)
  if (!parsed) return 'Not available'

  const [integer, fraction = ''] = parsed.canonical.split('.')
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${groupedInteger}.${fraction}` : groupedInteger
}

// multiplyExactToScale calculates a financial amount without binary
// floating-point. When product precision exceeds the target currency scale,
// the result uses explicit round-half-up semantics.
export function multiplyExactToScale(
  left: ExactDecimal,
  right: ExactDecimal,
  targetScale: number
): string {
  if (!Number.isSafeInteger(targetScale) || targetScale < 0 || targetScale > maximumFractionDigits) {
    throw new Error('target scale must be a safe integer from 0 through 18')
  }

  let coefficient = left.coefficient * right.coefficient
  const productScale = left.scale + right.scale
  if (productScale > targetScale) {
    const divisor = 10n ** BigInt(productScale - targetScale)
    const quotient = coefficient / divisor
    const remainder = coefficient % divisor
    coefficient = quotient + (remainder * 2n >= divisor ? 1n : 0n)
  } else if (productScale < targetScale) {
    coefficient *= 10n ** BigInt(targetScale - productScale)
  }

  return formatCoefficient(coefficient, targetScale)
}

export function formatExactMoney(value: string | null, currency: string): string {
  if (value === null) return 'Not priced'

  const parsed = parseExactDecimal(value)
  if (!parsed) return 'Not priced'

  const normalizedCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'ZAR'
  const [integer, fraction = ''] = parsed.canonical.split('.')
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const displayFraction = fraction.padEnd(2, '0').slice(0, Math.max(2, fraction.length))
  return `${normalizedCurrency} ${groupedInteger}.${displayFraction}`
}

export function exactDecimalToBaseUnits(value: string, targetScale: number): string | null {
  if (!Number.isSafeInteger(targetScale) || targetScale < 0 || targetScale > maximumFractionDigits) {
    return null
  }

  const parsed = parseExactDecimal(value)
  if (!parsed || parsed.scale > targetScale) return null

  return (
    parsed.coefficient *
    10n ** BigInt(targetScale - parsed.scale)
  ).toString()
}

export function baseUnitsToExactDecimal(value: string, scale: number): string | null {
  if (
    !/^(0|[1-9]\d*)$/.test(value) ||
    !Number.isSafeInteger(scale) ||
    scale < 0 ||
    scale > maximumFractionDigits
  ) {
    return null
  }

  return formatCoefficient(BigInt(value), scale)
}

function formatCoefficient(coefficient: bigint, scale: number): string {
  const digits = coefficient.toString()
  if (scale === 0) return digits

  const padded = digits.padStart(scale + 1, '0')
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`
}
