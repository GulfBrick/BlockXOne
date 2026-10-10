import { describe, expect, it } from 'vitest'
import { parseAdministrationQuery } from './query'
const id = '10000000-0000-4000-8000-000000000001'
describe('exact administration query admission', () => {
  it('accepts empty and exact scoped queries in page and URL representations', () => {
    expect(parseAdministrationQuery({})).toEqual({})
    expect(parseAdministrationQuery(new URLSearchParams())).toEqual({})
    expect(parseAdministrationQuery({ organisation: id, proposal: id })).toEqual({ organisationId: id, proposalId: id })
    expect(parseAdministrationQuery(new URLSearchParams({ organisation: id }))).toEqual({ organisationId: id })
  })
  it.each(['', '0', `${id}/`, `${id}\n`, '00000000-0000-0000-0000-000000000000'])('rejects malformed IDs %j', value => {
    expect(parseAdministrationQuery({ organisation: value })).toBeNull()
    expect(parseAdministrationQuery({ proposal: value })).toBeNull()
  })
  it('rejects duplicate, unknown, token, array and getter inputs without evaluating accessors', () => {
    for (const query of [`organisation=${id}&organisation=${id}`, `proposal=${id}&proposal=${id}`, 'token_hash=x', 'x=']) expect(parseAdministrationQuery(new URLSearchParams(query))).toBeNull()
    expect(parseAdministrationQuery({ organisation: [id] })).toBeNull()
    expect(parseAdministrationQuery({ unknown: undefined })).toBeNull()
    const getter = { get organisation(): string { throw new Error('must not run') } }
    expect(parseAdministrationQuery(getter)).toBeNull()
  })
})
