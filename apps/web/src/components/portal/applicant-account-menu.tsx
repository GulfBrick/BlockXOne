'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { CircleUserRound, ShieldCheck } from 'lucide-react'
import styles from './portal.module.css'

/** Account controls only; opening this menu grants no application or role access. */
export function ApplicantAccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)
  function close(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    body.current?.querySelector<HTMLAnchorElement>('a')?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', escape)
    document.addEventListener('mousedown', outside)
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('mousedown', outside) }
  }, [open])
  return <div ref={container} className={styles.accountMenu}>
    <button ref={trigger} type="button" className={styles.accountMenuTrigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><CircleUserRound aria-hidden="true" />Account</button>
    <div ref={body} id={id} className={styles.accountMenuBody} role="region" aria-label="Account options" hidden={!open}>
      <div className={styles.actions}><p className={styles.accountEmail}>{email}</p><button type="button" className={styles.textLink} onClick={() => close(true)}>Close</button></div>
      <nav aria-label="Account navigation" className={styles.nav}><a href="/workspace/security" className={styles.navLink}><ShieldCheck aria-hidden="true" />Account security</a><a href="/workspace" className={styles.navLink}>Account workspace</a><Link href="/register" className={styles.navLink}>Account options</Link></nav>
      <form action="/auth/logout" method="post"><button className={styles.buttonSecondary} type="submit">Sign out</button></form>
    </div>
  </div>
}
