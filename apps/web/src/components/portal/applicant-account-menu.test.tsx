// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApplicantAccountMenu } from './applicant-account-menu'

afterEach(cleanup)
describe('applicant account controls', () => {
  it('uses a labelled button, preserves account links/logout and has no native disclosure', () => {
    const view = render(createElement(ApplicantAccountMenu, { email: 'actor@example.invalid' }))
    const trigger = screen.getByRole('button', { name: /^Account$/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('details, summary')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Account options' })).toBeNull()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'Account options' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Account security' }).getAttribute('href')).toBe('/workspace/security')
    expect(screen.getByRole('link', { name: 'Account workspace' }).getAttribute('href')).toBe('/workspace')
    expect(screen.getByRole('link', { name: 'Account options' }).getAttribute('href')).toBe('/register')
    const logout = screen.getByRole('button', { name: 'Sign out' })
    expect(logout.getAttribute('type')).toBe('submit')
    expect(logout.closest('form')?.getAttribute('action')).toBe('/auth/logout')
    expect(logout.closest('form')?.getAttribute('method')).toBe('post')
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Account security' }))
  })
  it('closes on Escape or its close control and restores trigger focus', () => {
    render(createElement(ApplicantAccountMenu, { email: 'actor@example.invalid' }))
    const trigger = screen.getByRole('button', { name: /^Account$/ })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }))
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
  it('closes outside without taking focus or invoking a form', () => {
    const view = render(createElement(ApplicantAccountMenu, { email: 'actor@example.invalid' }))
    fireEvent.click(screen.getByRole('button', { name: /^Account$/ }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('region', { name: 'Account options' })).toBeNull()
    expect(view.container.querySelector('details, summary')).toBeNull()
  })
})
