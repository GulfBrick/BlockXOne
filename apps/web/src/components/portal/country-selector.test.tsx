// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountrySelector } from './country-selector'
import { countries, countryName } from '@/lib/portal/countries'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('named country selection', () => {
  it('keeps all 249 distinct country identifiers and names', () => {
    expect(countries).toHaveLength(249); expect(new Set(countries.map(value => value.code)).size).toBe(249)
    expect(countryName('ZA')).toBe('South Africa')
  })
  it('displays a name, searches and emits the existing code', () => {
    const onChange = vi.fn()
    render(<label htmlFor="country">Country of residence<CountrySelector id="country" value="ZA" onChange={onChange} /></label>)
    const input = screen.getByRole('combobox', { name: 'Country of residence' })
    expect((input as HTMLInputElement).value).toBe('South Africa')
    fireEvent.change(input, { target: { value: 'Zimb' } }); expect(onChange).toHaveBeenLastCalledWith('')
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onChange).toHaveBeenLastCalledWith('ZW')
    expect((input as HTMLInputElement).value).toBe('Zimbabwe')
  })
  it('preserves an unfamiliar historical code visibly rather than silently choosing another country', () => {
    const onChange = vi.fn(); render(<CountrySelector value="XX" onChange={onChange} />)
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Previously entered country (XX)')
    expect(onChange).not.toHaveBeenCalled()
  })
  it('keeps unmatched search text invalid and supports Escape', () => {
    const onChange = vi.fn(); render(<CountrySelector value="ZA" onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Not a country' } })
    expect(onChange).toHaveBeenLastCalledWith(''); expect(screen.getByRole('status').textContent).toContain('No matching country')
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' }); expect(screen.queryByRole('listbox')).toBeNull()
  })
  it('keeps keyboard-active results visible beyond the initial popup height', () => {
    const scroll = vi.fn()
    const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    try {
      render(<><label htmlFor="country">Country of residence</label><CountrySelector id="country" value="" onChange={vi.fn()} /></>)
      const input = screen.getByRole('combobox', { name: 'Country of residence' })
      fireEvent.focus(input)
      expect(screen.getAllByRole('option').length).toBeGreaterThan(6)
      for (let count = 0; count < 8; count++) fireEvent.keyDown(input, { key: 'ArrowDown' })
      const active = screen.getAllByRole('option')[8]
      expect(input.getAttribute('aria-activedescendant')).toBe(active.id)
      expect(scroll.mock.contexts.at(-1)).toBe(active)
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
      expect(screen.getByRole('combobox', { name: 'Country of residence' })).toBe(input)
    } finally { if (previous) Object.defineProperty(Element.prototype, 'scrollIntoView', previous); else Reflect.deleteProperty(Element.prototype, 'scrollIntoView') }
  })
})
