export function PilotEnvironmentBanner() {
  const releaseMode = (process.env.NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE || '').trim().toLowerCase()

  if (releaseMode !== 'pilot' && releaseMode !== 'pilot-share') return null

  return (
    <aside
      aria-label="Test environment notice"
      className="relative z-[60] border-b border-bxo-warning-border bg-bxo-bg-primary px-4 py-2 text-center text-xs font-semibold tracking-wide text-bxo-warning"
      role="status"
    >
      Test environment. Test payments only. Do not submit real funds or sensitive identity documents.
    </aside>
  )
}
