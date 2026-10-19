// Shared, pure query admission. No authentication or authority is conferred.
export type AdministrationQuery = { organisationId?: string; proposalId?: string }
export type AdministrationSearchParams = URLSearchParams | Record<string, string | string[] | undefined>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseAdministrationQuery(input: AdministrationSearchParams): AdministrationQuery | null {
  try {
    const entries: Array<[string, unknown]> = input instanceof URLSearchParams ? [...input.entries()] : (() => {
      if (!input || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) throw new Error()
      return Reflect.ownKeys(input).map(key => {
        if (typeof key !== 'string') throw new Error()
        const descriptor = Object.getOwnPropertyDescriptor(input, key)
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error()
        return [key, descriptor.value] as [string, unknown]
      })
    })()
    const result: AdministrationQuery = {}
    const seen = new Set<string>()
    for (const [key, value] of entries) {
      if ((key !== 'organisation' && key !== 'proposal') || seen.has(key)) return null
      seen.add(key)
      if (value === undefined && !(input instanceof URLSearchParams)) continue
      if (typeof value !== 'string' || value.length !== 36 || !uuid.test(value) || value === '00000000-0000-0000-0000-000000000000') return null
      if (key === 'organisation') result.organisationId = value.toLowerCase()
      else result.proposalId = value.toLowerCase()
    }
    return result
  } catch { return null }
}
