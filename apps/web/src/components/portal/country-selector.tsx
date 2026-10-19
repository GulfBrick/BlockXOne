'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { countryCode, countryName, searchCountries } from '@/lib/portal/countries'
import styles from './onboarding-flow.module.css'

export function CountrySelector({ id, value, onChange, onPendingChange, disabled, 'aria-describedby': describedBy, 'aria-invalid': invalid }: {
  id?: string; value: string; onChange: (code: string) => void; disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  'aria-describedby'?: string; 'aria-invalid'?: boolean;
}) {
  const generatedId = useId()
  const listId = `${id ?? generatedId}-countries`
  const [query, setQuery] = useState(() => countryName(value))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const previousValue = useRef(value)
  const options = useRef<HTMLSpanElement>(null)
  const choices = searchCountries(query).slice(0, 40)
  useEffect(() => {
    if (open) options.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active, query])
  useEffect(() => {
    if (value !== previousValue.current) { setQuery(countryName(value)); previousValue.current = value; setOpen(false); onPendingChange?.(false) }
  }, [value, onPendingChange])
  function choose(code: string) {
    previousValue.current = code; setQuery(countryName(code)); setOpen(false); onPendingChange?.(false); onChange(code)
  }
  return <span className={styles.country}>
    <input id={id} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-expanded={open}
      aria-activedescendant={open && choices[active] ? `${listId}-${choices[active].code}` : undefined}
      aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" required disabled={disabled}
      value={query} placeholder="Search for a country" onFocus={() => { setOpen(true); setActive(0) }}
      onBlur={() => setOpen(false)}
      onChange={event => {
        const next = event.target.value; const code = countryCode(next) ?? ''
        previousValue.current = code; setQuery(code ? countryName(code) : next); setActive(0); setOpen(true); onPendingChange?.(Boolean(next) && !code); onChange(code)
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true); setActive(current => choices.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length : 0)
        } else if (event.key === 'Enter' && open && choices[active]) { event.preventDefault(); choose(choices[active].code) }
        else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      }} />
    {open ? <span ref={options} id={listId} role="listbox" className={styles.countryOptions} aria-label="Countries">
      {choices.length ? choices.map((country, index) => <button type="button" tabIndex={-1} key={country.code} id={`${listId}-${country.code}`} role="option" aria-selected={index === active}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(country.code)}>{country.name}</button>)
        : <span role="status">No matching country. Enter a name and select a result.</span>}
    </span> : null}
  </span>
}
