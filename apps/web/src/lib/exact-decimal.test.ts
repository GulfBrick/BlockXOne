import { describe, expect, it } from 'vitest'

import {
  baseUnitsToExactDecimal,
  compareExactDecimals,
  exactDecimalToBaseUnits,
  formatExactMoney,
  formatExactUnits,
  isPositiveExactDecimal,
  multiplyExactToScale,
  parseExactDecimal,
  sumExactDecimals,
} from './exact-decimal'

describe('exact decimal financial arithmetic', () => {
  it('parses only bounded canonical unsigned decimals', () => {
    expect(parseExactDecimal('12.3400')).toEqual({
      coefficient: 1234n,
      scale: 2,
      canonical: '12.34',
    })
    expect(parseExactDecimal('0')).toEqual({
      coefficient: 0n,
      scale: 0,
      canonical: '0',
    })
    for (const invalid of ['', ' 1', '1 ', '-1', '+1', '01', '.5', '1.', '1e3', 'NaN']) {
      expect(parseExactDecimal(invalid)).toBeNull()
    }
  })

  it('multiplies and rounds to minor units without binary floating point', () => {
    const units = parseExactDecimal('9007199254740993.0001')
    const price = parseExactDecimal('0.1')
    expect(isPositiveExactDecimal(units)).toBe(true)
    expect(isPositiveExactDecimal(price)).toBe(true)
    expect(multiplyExactToScale(units!, price!, 2)).toBe('900719925474099.30')

    expect(
      multiplyExactToScale(
        parseExactDecimal('1.005')!,
        parseExactDecimal('1')!,
        2
      )
    ).toBe('1.01')
  })

  it('formats exact monetary strings without converting them to Number', () => {
    expect(formatExactMoney('12345678901234567890.01', 'ZAR')).toBe(
      'ZAR 12,345,678,901,234,567,890.01'
    )
    expect(formatExactMoney(null, 'ZAR')).toBe('Not priced')
    expect(formatExactMoney('invalid', 'ZAR')).toBe('Not priced')
  })

  it('orders different decimal scales exactly', () => {
    expect(compareExactDecimals('9007199254740993.01', '9007199254740993.001')).toBe(1)
    expect(compareExactDecimals('1.0', '1.0000')).toBe(0)
    expect(compareExactDecimals(null, '0')).toBe(-1)
  })

  it('sums and formats unit balances without precision loss', () => {
    expect(sumExactDecimals(['9007199254740993.0001', '0.0099'])).toBe(
      '9007199254740993.0100'
    )
    expect(formatExactUnits('9007199254740993.0100')).toBe(
      '9,007,199,254,740,993.01'
    )
    expect(sumExactDecimals(['1', 'invalid'])).toBeNull()
  })

  it('converts decimal strings to and from base units without Number coercion', () => {
    expect(exactDecimalToBaseUnits('9007199254740993.01', 2)).toBe('900719925474099301')
    expect(baseUnitsToExactDecimal('900719925474099301', 2)).toBe('9007199254740993.01')
    expect(exactDecimalToBaseUnits('1.001', 2)).toBeNull()
    expect(exactDecimalToBaseUnits('1e3', 2)).toBeNull()
  })
})
