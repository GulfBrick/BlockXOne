import 'server-only'
import { randomUUID } from 'node:crypto'
import { after } from 'next/server'
import { platformRelease } from '@/lib/platform-release'
import { TESTNET_APP_ORIGIN } from '@/lib/testnet-fund/contracts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'
import { offeringSignatureResponseSchema } from './offering-signatures'
import { executeSignatureProcessing } from './offering-signatures-server'

type ConfirmedScope = {
  actorId: string; sessionId: string; aal: 'aal1' | 'aal2'; context: PortalOperatingContext;
  productId: string; revisionId: string;
}
const wakeCommands = new Set(['PREPARE_EXECUTION', 'REQUEST_RECONCILIATION', 'REQUEST_RECOVERY'])
const maxAttempts = 3
const reserveMs = 8_000

function testRuntime(): boolean {
  return platformRelease(process.env)?.environment === 'TESTNET'
    && process.env.BLOCKXONE_APP_ORIGIN === TESTNET_APP_ORIGIN
}

/** Best-effort producer only: durable work, leases and provider checkpoints remain in the existing worker.
 * A later authorised reconciliation/recovery request can wake an interrupted saved operation again.
 * No user token, document, signing view or provider response is passed to the post-response callback.
 */
export function scheduleOfferingSignatureWake(confirmation: unknown, scope: ConfirmedScope, deadline: number): boolean {
  const checked = offeringSignatureResponseSchema.safeParse(confirmation)
  if (!testRuntime() || !checked.success || scope.aal !== 'aal2' || !Number.isFinite(deadline)
    || deadline - Date.now() <= reserveMs) return false
  const { snapshot, command } = checked.data
  if (!wakeCommands.has(command) || snapshot.environment !== 'TESTNET' || !snapshot.admitted
    || snapshot.actor_id !== scope.actorId || snapshot.session_id !== scope.sessionId
    || snapshot.product_id !== scope.productId || snapshot.revision_id !== scope.revisionId
    || !portalContextMatches(snapshot.context, scope.context)) return false

  try {
    after(async () => {
      // Configuration changes never turn this TEST-only producer into a MAIN worker.
      if (!testRuntime()) return
      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (deadline - Date.now() <= reserveMs) return
          const result = await executeSignatureProcessing({ command: 'WAKE', request_id: randomUUID() }, deadline)
          if (!result || typeof result !== 'object' || !('outcome' in result) || result.outcome !== 'PROCESSED') return
        }
      } catch {
        // Never log provider errors, user/session identifiers, request data or credentials.
        console.error('bx1_offering_signature_wake_failed')
      }
    })
    return true
  } catch {
    // The command is already saved. A scheduling failure must not make it look uncommitted.
    console.error('bx1_offering_signature_wake_schedule_failed')
    return false
  }
}
