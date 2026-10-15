import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const directory = resolve(process.cwd(), '../../supabase/features')
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_offering_signature_roleplay_view.sql')
const original = read('bx1_offering_signatures.sql').match(/create function bx1_private\.read_offering_signature_action\([\s\S]*?as \$\$([\s\S]*?)\$\$;/)![1]
const oldFragment = sql.match(/\$old\$([\s\S]*?)\$old\$/)![1]
const newFragment = sql.match(/\$new\$([\s\S]*?)\$new\$/)![1]
const corrected = original.replace(oldFragment, newFragment)
const hash = (value: string) => createHash('sha256').update(value.trim(), 'utf8').digest('hex')
const commands = read('bx1_fund_roleplay_commands.sql')
const person = commands.match(/create function bx1_private\.fund_roleplay_document_person\([\s\S]*?as \$\$([\s\S]*?)\$\$;/)![1]

describe('the existing DocuSign VIEW uses the saved TEST purpose person binding', () => {
  it('replaces one exact native person check, not a lease, session or purpose decision', () => {
    expect(hash(original)).toBe('eeec411558c60d88335d456eb6aa3e3e9b5a5e3bd1ab94d7a996dc437885bdaa')
    expect(sql).toContain("is distinct from 'eeec411558c60d88335d456eb6aa3e3e9b5a5e3bd1ab94d7a996dc437885bdaa'")
    expect(original.split(oldFragment)).toHaveLength(2)
    expect(corrected.replace(newFragment, oldFragment)).toBe(original)
    expect(newFragment).toContain('a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id')
    expect(newFragment).toContain("o.originating_actor_id,a.signer_person_id,o.originating_context,'REQUEST_SIGNING_VIEW'")
    expect(sql).toContain('replace(next_body,new_fragment,old_fragment) is distinct from original')
  })

  it('retains the exact production TRUSTED helper for ordinary purposes and fails closed for changed TEST bindings', () => {
    expect(person).toContain('when policy is null then bx1_private.document_governance_trusted_person(actor,person)')
    expect(person).toContain('fund_roleplay_record_current(policy,epoch,product,offering,actor,c,action)')
    expect(person).toContain('p.actual_operator_person_id=person')
    expect(person).toContain('then person else null end')
    expect(hash(person)).toBe('a128ca42a6afa2430a0f5945c81c480b56807a8b96cfce7bb1f2352a10356f34')
    expect(sql).toContain(hash(person))
  })

  it.each([
    ['worker', 'policy.worker_id is distinct from p_worker'],
    ['lease', 'o.lease_id is distinct from p_lease'],
    ['generation', 'o.generation is distinct from p_generation'],
    ['authority epoch', 't.authority_epoch<>policy.authority_epoch'],
    ['current purpose', 'offering_signature_authorisation_current(a.id) and o.authority_epoch=policy.authority_epoch'],
    ['expired-after-wait lease', 'offering_signature_lease_expired_after_wait'],
    ['named actor', 'o.originating_actor_id is distinct from a.signer_id'],
    ['live originating session', 's.id=o.originating_session_id and s.user_id=a.signer_id'],
    ['verified signer', "u.email_confirmed_at is not null and u.deleted_at is null"],
    ['same provider recipient', "email is distinct from o.create_request->'recipients'->'signers'->0->>'email'"],
  ])('keeps the unchanged %s guard', (_label, fragment) => expect(corrected).toContain(fragment))

  it('pins OID, worker-only ACL, all non-body metadata and unchanged authority dependencies', () => {
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      "where singleton and environment='TESTNET'", 'target is distinct from 30729::oid',
      '["postgres=X/postgres","bx1_offering_signature_worker=X/postgres"]',
      "after_row-'prosrc' is distinct from before_row-'prosrc'", 'signature_roleplay_view_dependency_mutated',
    ]) expect(sql).toContain(fragment)
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|grant|revoke|insert into|delete from|alter table|alter role|set_config)\s/i)
    expect(sql).not.toContain('update bx1_')
    expect(sql).not.toContain('fund_roleplay_enter(')
    expect(sql).not.toContain('fund_roleplay_finish(')
  })
})
