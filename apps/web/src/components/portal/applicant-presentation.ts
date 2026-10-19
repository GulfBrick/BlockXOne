/** Presentation only: these sections never select a role or grant authority. */
export const applicantSections = ['overview', 'applications', 'workspaces', 'help'] as const
export type ApplicantSection = typeof applicantSections[number]

export function applicantSection(value: unknown): ApplicantSection | undefined {
  return typeof value === 'string' && applicantSections.some(section => section === value) ? value as ApplicantSection : undefined
}

export function applicantSectionHref(section: ApplicantSection): string {
  return `/portal?mode=applicant&section=${section}`
}
