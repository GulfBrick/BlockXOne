import 'server-only'
import { cookies } from 'next/headers'
import { AuthUnavailableError, createRequestSupabaseClient } from './server'

export async function createPageSupabaseClient() {
  const jar = await cookies()
  return createRequestSupabaseClient({
    getAll: () => jar.getAll(),
    // Middleware must persist refreshes first. A race requiring another write
    // denies rendering instead of falsely claiming a persisted session.
    setAll: () => { throw new AuthUnavailableError() },
  })
}
