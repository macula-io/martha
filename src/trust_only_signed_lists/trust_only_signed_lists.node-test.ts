import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { fixtureKey, signLikeAHardwareKey, type FixtureKey } from './sign_like_a_hardware_key.ts'
import { ED25519, verifySshSignature } from './ssh_signature.ts'
import {
  LIST_FIELD,
  MAXIMUM_LIFETIME_DAYS,
  PRETTY_INDENT,
  TRUST_LIST_NAMESPACE,
  openTrustList,
  type EpochStore,
  type OpenedEpoch,
  type TrustListKind,
  type TrustListToOpen,
  trustedPolicy,
  trustedRoomRosters,
  trustedMembers,
  trustedSupervisors,
} from './trust_only_signed_lists.ts'
import { binderOverLaunches, type MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { admitsInCrewRoom } from '../admit_a_room_message/admit_a_room_message.ts'
import { refuseExecutionAfterUngatedText } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { actorFromCallingSession, refuseActionFromAnUnverifiedActor } from '../who_may_act/who_may_act.ts'

// Synthetic node ids and crew names, never real ones: this repository is public.
const member = '1'.repeat(64)
const attacker = '2'.repeat(64)
const crew = 'a-crew'
const now = new Date('2026-11-06T12:00:00Z')
const later = '2026-12-01T00:00:00Z'
const issued = '2026-11-01T00:00:00Z'
const DAY_MS = 24 * 60 * 60 * 1000
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY_MS).toISOString()

const owner = fixtureKey()

// In memory for the tests only: a real store persists across processes.
const epochStore = (): EpochStore => {
  const seen = new Map<string, OpenedEpoch>()
  return {
    newest: (c, k) => seen.get(`${c}/${k}`),
    keep: (c, k, opened) => void seen.set(`${c}/${k}`, opened),
  }
}

const MEMBER_NAME_OF = (node_id: string) => `m-${node_id.slice(0, 8)}`

const entriesFor = (kind: TrustListKind, node_ids: readonly string[]) =>
  kind === 'members' ? node_ids.map((node_id) => ({ member_name: MEMBER_NAME_OF(node_id), node_id })) : node_ids

const documentValue = (kind: TrustListKind, node_ids: readonly string[], overrides: Record<string, unknown> = {}) => ({
  crew,
  kind,
  epoch: 1,
  issued_at: issued,
  expires_at: later,
  body: { [LIST_FIELD[kind]]: entriesFor(kind, node_ids) },
  ...overrides,
})

const documentOf = (kind: TrustListKind, node_ids: readonly string[], overrides: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify(documentValue(kind, node_ids, overrides)))

const signed = (document: Buffer, key: FixtureKey = owner, flags?: number) =>
  signLikeAHardwareKey(key, document, { namespace: TRUST_LIST_NAMESPACE, ...(flags === undefined ? {} : { flags }) })

const open = (overrides: Partial<TrustListToOpen> = {}) => {
  const document = overrides.document ?? documentOf('crew_roster', [member])
  return openTrustList({
    kind: 'crew_roster',
    document,
    signature: signed(document),
    pinned_keys: [owner.line],
    crew,
    now,
    epochs: epochStore(),
    ...overrides,
  })
}

const refusesEveryone = (opened: ReturnType<typeof open>, why: RegExp) => {
  assert.equal(opened.trusted, false)
  assert.deepEqual(opened.node_ids, [])
  if (!opened.trusted) assert.match(opened.why, why)
}

// --- a signed list opens; everything else trusts nobody ------------------------

test('a list the pinned hardware key signed opens to its node ids', () => {
  const opened = open()
  assert.equal(opened.trusted, true)
  assert.deepEqual(opened.node_ids, [member])
})

test('every kind of trust list opens from its own field', () => {
  for (const kind of Object.keys(LIST_FIELD) as TrustListKind[]) {
    const document = documentOf(kind, [member])
    assert.deepEqual(open({ kind, document, signature: signed(document) }).node_ids, [member], kind)
  }
})

test('an unsigned list refuses everyone', () => {
  refusesEveryone(open({ signature: undefined }), /not signed/)
})

test('a missing list refuses everyone', () => {
  refusesEveryone(open({ document: undefined }), /no document/)
})

test('a list edited after signing, with one node id added, refuses everyone', () => {
  const document = documentOf('crew_roster', [member])
  const edited = documentOf('crew_roster', [member, attacker])
  refusesEveryone(open({ document: edited, signature: signed(document) }), /does not verify/)
})

test('a list signed for another crew refuses everyone', () => {
  const document = documentOf('crew_roster', [member], { crew: 'another-crew' })
  refusesEveryone(open({ document, signature: signed(document) }), /another crew/)
})

test('a list signed as another kind refuses everyone', () => {
  const document = documentOf('shared_roster', [member])
  refusesEveryone(open({ document, signature: signed(document) }), /shared_roster/)
})

test('an expired list refuses everyone', () => {
  const document = documentOf('crew_roster', [member], { expires_at: '2026-11-01T00:00:00Z' })
  refusesEveryone(open({ document, signature: signed(document) }), /expired/)
})

test('an older epoch after a newer one refuses everyone, and the same epoch still opens', () => {
  const epochs = epochStore()
  const newer = documentOf('crew_roster', [member], { epoch: 5 })
  assert.equal(open({ document: newer, signature: signed(newer), epochs }).trusted, true)

  const older = documentOf('crew_roster', [member, attacker], { epoch: 4 })
  refusesEveryone(open({ document: older, signature: signed(older), epochs }), /older than epoch 5/)
  assert.equal(open({ document: newer, signature: signed(newer), epochs }).trusted, true)
})

test('a refused list does not raise the epoch', () => {
  const epochs = epochStore()
  const expired = documentOf('crew_roster', [member], { epoch: 9, expires_at: '2026-11-01T00:00:00Z' })
  open({ document: expired, signature: signed(expired), epochs })
  assert.equal(epochs.newest(crew, 'crew_roster'), undefined)
})

test('a list signed by a key that is not pinned refuses everyone, even with its key inside the signature', () => {
  const stranger = fixtureKey()
  const document = documentOf('crew_roster', [attacker])
  refusesEveryone(open({ document, signature: signed(document, stranger) }), /not pinned/)
})

test('a document cannot name its own verifying key', () => {
  const stranger = fixtureKey()
  const document = documentOf('crew_roster', [attacker], { public_key: stranger.line })
  refusesEveryone(open({ document, signature: signed(document, stranger), pinned_keys: [owner.line, stranger.line] }), /fields/)
})

test('a pinned key that is not a hardware key is refused, so a key file cannot be the anchor', () => {
  const file_key = fixtureKey(ED25519)
  const document = documentOf('crew_roster', [member])
  refusesEveryone(open({ document, signature: signed(document, file_key), pinned_keys: [file_key.line] }), /not a hardware key/)
})

test('no pinned key, or one that cannot be read, refuses everyone', () => {
  refusesEveryone(open({ pinned_keys: [] }), /no key is pinned/)
  refusesEveryone(open({ pinned_keys: ['sk-ssh-ed25519@openssh.com not-base64!'] }), /cannot be read/)
})

test('a signature the owner did not touch the key for refuses everyone', () => {
  const document = documentOf('crew_roster', [member])
  refusesEveryone(open({ document, signature: signed(document, owner, 0) }), /not touched/)
})

test('a signature for another namespace refuses everyone', () => {
  const document = documentOf('crew_roster', [member])
  const elsewhere = signLikeAHardwareKey(owner, document, { namespace: 'file' })
  refusesEveryone(open({ document, signature: elsewhere }), /namespace/)
})

test('a body holding anything but node ids, or an extra field, refuses everyone', () => {
  for (const body of [{ member_node_ids: ['not-a-node-id'] }, { member_node_ids: [member], extra: [] }, { member_node_ids: member }]) {
    const document = documentOf('crew_roster', [], { body })
    refusesEveryone(open({ document, signature: signed(document) }), /node id|nothing else|not a list/)
  }
})

test('a signature that is not armored, or a truncated one, refuses everyone', () => {
  refusesEveryone(open({ signature: 'not a signature' }), /armored/)
  const document = documentOf('crew_roster', [member])
  const lines = signed(document).trim().split('\n')
  const truncated = [lines[0], ...lines.slice(1, -1).map((line) => line.slice(0, 20)), lines.at(-1)].join('\n')
  assert.equal(open({ document, signature: truncated }).trusted, false)
})

test('a signature blob with bytes after its last field refuses everyone', () => {
  const document = documentOf('crew_roster', [member])
  const lines = signed(document).trim().split('\n')
  const blob = Buffer.concat([Buffer.from(lines.slice(1, -1).join(''), 'base64'), Buffer.from('trailing')])
  const padded = [lines[0], blob.toString('base64'), lines.at(-1)].join('\n')
  refusesEveryone(open({ document, signature: padded }), /malformed/)
})

// --- the format is OpenSSH's, proved against the real ssh-keygen ---------------

const scratch = (run: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-trust-list-'))
  try {
    run(dir)
  } finally {
    removeTheTree(dir)
  }
}

test('ssh-keygen -Y verify accepts the hardware key signature the fixtures write', () => {
  scratch((dir) => {
    const document = documentOf('crew_roster', [member])
    writeFileSync(join(dir, 'allowed_signers'), `owner ${owner.line}\n`)
    writeFileSync(join(dir, 'roster.json.sig'), signed(document))
    const out = execFileSync(
      'ssh-keygen',
      ['-Y', 'verify', '-f', join(dir, 'allowed_signers'), '-I', 'owner', '-n', TRUST_LIST_NAMESPACE, '-s', join(dir, 'roster.json.sig')],
      { input: document, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    assert.ok(out.includes(`Good "${TRUST_LIST_NAMESPACE}" signature for owner`), out)
  })
})

test('a signature ssh-keygen -Y sign writes verifies here, and a plain key is still not an anchor', () => {
  scratch((dir) => {
    const key = join(dir, 'id_ed25519')
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'fixture', '-f', key])
    const document = documentOf('crew_roster', [member])
    writeFileSync(join(dir, 'roster.json'), document)
    execFileSync('ssh-keygen', ['-q', '-Y', 'sign', '-f', key, '-n', TRUST_LIST_NAMESPACE, join(dir, 'roster.json')])

    const signature = readFileSync(join(dir, 'roster.json.sig'), 'utf8')
    assert.equal(verifySshSignature(signature, document, TRUST_LIST_NAMESPACE).valid, true)
    const pinned = readFileSync(`${key}.pub`, 'utf8')
    refusesEveryone(open({ document, signature, pinned_keys: [pinned] }), /not a hardware key/)
  })
})

// --- nothing here signs -------------------------------------------------------

test('no private key is tracked in this repository', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const armor = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  const found = files.filter((file) => armor.test(readFileSync(file, 'utf8')))
  assert.deepEqual(found, [])
})

test('only tests import the signing fixtures', () => {
  const files = execFileSync('git', ['ls-files', '-z', 'src', 'architecture'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.node-test.ts'))
  const importers = files.filter((file) => readFileSync(file, 'utf8').includes('sign_like_a_hardware_key'))
  assert.deepEqual(importers, [])
})

// --- the gates read what was opened, and a refused list admits nobody --------

test('a refused roster makes the crew room admit nobody, a rostered member included', () => {
  const self = '0'.repeat(64)
  const message = { attested: true, from_node_id: member, to_node_ids: [self], kind: 'message' }
  const rosters = (opened: ReturnType<typeof open>) => trustedRoomRosters(opened, opened)

  assert.equal(admitsInCrewRoom({ message, rosters: rosters(open()), self_node_id: self }), true)
  assert.equal(admitsInCrewRoom({ message, rosters: rosters(open({ signature: undefined })), self_node_id: self }), false)
})

test('a refused policy lets no sender text reach the shell', () => {
  const session = { ingested: [{ path: 'A1', from_node_id: member }] }
  const policy = (opened: ReturnType<typeof open>) => trustedPolicy(opened)
  const document = documentOf('policy', [member])

  const signed_policy = open({ kind: 'policy', document, signature: signed(document) })
  assert.equal(refuseExecutionAfterUngatedText({ tool: 'Bash', session, policy: policy(signed_policy) }).allow, true)
  const unsigned = open({ kind: 'policy', document, signature: undefined })
  assert.equal(refuseExecutionAfterUngatedText({ tool: 'Bash', session, policy: policy(unsigned) }).allow, false)
})

test('a refused supervisor list lets nobody act as supervisor', () => {
  const document = documentOf('supervisors', [member])
  const actor = actorFromCallingSession({ node_id: member, display_name: null })
  const decide = (opened: ReturnType<typeof open>) =>
    refuseActionFromAnUnverifiedActor({ action: 'restart_member', actor, roster: trustedSupervisors(opened) }).allow

  assert.equal(decide(open({ kind: 'supervisors', document, signature: signed(document) })), true)
  assert.equal(decide(open({ kind: 'supervisors', document, signature: undefined })), false)
})

// --- round 2: one epoch, one list; one byte string, one reading ---------------

test('a different list signed at the epoch already opened refuses everyone', () => {
  const epochs = epochStore()
  const first = documentOf('crew_roster', [member], { epoch: 5 })
  assert.equal(open({ document: first, signature: signed(first), epochs }).trusted, true)

  const other = documentOf('crew_roster', [member, attacker], { epoch: 5 })
  refusesEveryone(open({ document: other, signature: signed(other), epochs }), /epoch 5 .*another list/)
})

test('a duplicate key at any depth refuses everyone: the owner signed one reading, not two', () => {
  const approved = `"body":{"member_node_ids":["${member}"]}`
  const shadow = `"body":{"member_node_ids":["${attacker}"]}`
  const top = Buffer.from(`{"crew":"${crew}","kind":"crew_roster","epoch":1,"issued_at":"${issued}","expires_at":"${later}",${approved},${shadow}}`)
  const inner = Buffer.from(
    `{"crew":"${crew}","kind":"crew_roster","epoch":1,"issued_at":"${issued}","expires_at":"${later}","body":{"member_node_ids":["${member}"],"member_node_ids":["${attacker}"]}}`,
  )
  for (const document of [top, inner]) {
    const opened = open({ document, signature: signed(document) })
    assert.equal(opened.trusted, false)
    assert.deepEqual(opened.node_ids, [])
  }
})

test('the same list at the same epoch, in the other layout, opens again: one list, not another', () => {
  const epochs = epochStore()
  const value = documentValue('crew_roster', [member], { epoch: 5 })
  const compact = Buffer.from(JSON.stringify(value))
  const pretty = Buffer.from(`${JSON.stringify(value, null, PRETTY_INDENT)}\n`)
  assert.equal(open({ document: compact, signature: signed(compact), epochs }).trusted, true)
  assert.equal(open({ document: pretty, signature: signed(pretty), epochs }).trusted, true)
})

test('a key spelled with escapes, or any other layout, refuses everyone', () => {
  const value = documentValue('crew_roster', [member])
  const escaped = Buffer.from(JSON.stringify(value).replace('"crew":', '"\\u0063rew":'))
  const spaced = Buffer.from(JSON.stringify(value, null, PRETTY_INDENT + 1))
  const two_newlines = Buffer.from(`${JSON.stringify(value)}\n\n`)
  for (const document of [escaped, spaced, two_newlines]) {
    refusesEveryone(open({ document, signature: signed(document) }), /one reading/)
  }
})

// --- round 3: the lifetime counts from signing, not from now -----------------

test(`a list signed to live more than ${MAXIMUM_LIFETIME_DAYS} days refuses everyone, even in its final days`, () => {
  const ten_years = 10 * 365
  const last_days = 100
  const document = documentOf('crew_roster', [member], {
    issued_at: daysFromNow(last_days - ten_years),
    expires_at: daysFromNow(last_days),
  })
  refusesEveryone(open({ document, signature: signed(document) }), new RegExp(`lives more than ${MAXIMUM_LIFETIME_DAYS} days`))
})

test(`a list signed to live exactly ${MAXIMUM_LIFETIME_DAYS} days opens, and one second more refuses everyone`, () => {
  const issued_at = daysFromNow(-1)
  const end = Date.parse(issued_at) + MAXIMUM_LIFETIME_DAYS * DAY_MS
  const limit = documentOf('crew_roster', [member], { issued_at, expires_at: new Date(end).toISOString() })
  assert.equal(open({ document: limit, signature: signed(limit) }).trusted, true)
  const over = documentOf('crew_roster', [member], { issued_at, expires_at: new Date(end + 1000).toISOString() })
  refusesEveryone(open({ document: over, signature: signed(over) }), new RegExp(`lives more than ${MAXIMUM_LIFETIME_DAYS} days`))
})

test('a list issued in the future refuses everyone', () => {
  const document = documentOf('crew_roster', [member], { issued_at: daysFromNow(1), expires_at: daysFromNow(2) })
  refusesEveryone(open({ document, signature: signed(document) }), /issued in the future/)
})

test('a list with no issued_at, or one that cannot be read, refuses everyone', () => {
  const { issued_at: _, ...without } = documentValue('crew_roster', [member])
  const missing = Buffer.from(JSON.stringify(without))
  refusesEveryone(open({ document: missing, signature: signed(missing) }), /fields are/)
  const unreadable = documentOf('crew_roster', [member], { issued_at: 'yesterday' })
  refusesEveryone(open({ document: unreadable, signature: signed(unreadable) }), /issue date cannot be read/)
})

// --- round 4: one signed instant, one reading, in every timezone -------------

// A zone far from UTC: Date.parse reads an instant without an offset as local time.
const FAR_ZONE = 'Pacific/Kiritimati'
const INSTANT_TESTS = 'an instant that is not RFC 3339 UTC'

test(`${INSTANT_TESTS} refuses everyone: no offset, a free form, an impossible date`, () => {
  const issued_forms = ['2026-11-01T00:00:00', 'Nov 1 2026', '2026-11-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-11-01T24:00:00Z']
  for (const issued_at of issued_forms) {
    const document = documentOf('crew_roster', [member], { issued_at })
    refusesEveryone(open({ document, signature: signed(document) }), /issue date cannot be read/)
  }
  const expires_forms = ['2026-12-01T00:00:00', 'Dec 1 2026', '2026-11-31T00:00:00Z', '2026-12-01T00:00:00+00:00']
  for (const expires_at of expires_forms) {
    const document = documentOf('crew_roster', [member], { expires_at })
    refusesEveryone(open({ document, signature: signed(document) }), /expiry cannot be read/)
  }
})

test(`${INSTANT_TESTS}: an RFC 3339 UTC instant opens, with or without milliseconds`, () => {
  for (const issued_at of ['2026-11-01T00:00:00Z', '2026-11-01T00:00:00.5Z', '2026-11-01T00:00:00.250Z']) {
    const document = documentOf('crew_roster', [member], { issued_at })
    assert.equal(open({ document, signature: signed(document) }).trusted, true)
  }
})

test(`${INSTANT_TESTS}: the same tests hold with the verifier in ${FAR_ZONE}`, { skip: process.env.TZ === FAR_ZONE }, () => {
  const file = new URL(import.meta.url).pathname
  // Without this the child reports to this runner instead of printing its own report.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env
  // A failing child exits non-zero, and execFileSync throws.
  const report = execFileSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${INSTANT_TESTS}`, file], {
    env: { ...env, TZ: FAR_ZONE },
    encoding: 'utf8',
  })
  assert.match(report, /^# fail 0$/m)
  assert.doesNotMatch(report, /^# pass 0$/m)
})

test(`${INSTANT_TESTS}: the far zone is really not UTC`, () => {
  const zoned = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(new Date(0).getTimezoneOffset()))'], {
    env: { ...process.env, TZ: FAR_ZONE },
    encoding: 'utf8',
  })
  assert.notEqual(Number(zoned), 0)
})

test('an upper-case node id in a signed policy matches the same sender in lower case', () => {
  const document = documentOf('policy', [member.replace(/1/g, 'A')])
  const sender = 'a'.repeat(64)
  const opened = open({ kind: 'policy', document, signature: signed(document) })
  assert.deepEqual(opened.node_ids, [sender])
  const session = { ingested: [{ path: 'A1', from_node_id: sender }] }
  assert.equal(refuseExecutionAfterUngatedText({ tool: 'Bash', session, policy: trustedPolicy(opened) }).allow, true)
})

test('a signed members list binds a launched member, and a refused one binds nobody', () => {
  // The launcher's record as the launcher would have kept it: only the launcher
  // writes records (#42), so this slice's test starts with one rather than writing it.
  const launch: MemberLaunch = { member_name: MEMBER_NAME_OF(member), node_id: member, pid: 4201, process_started_at: 'started' }
  const { stores, processes } = hostForTests({
    launches: [{ key: launch.member_name, row: launch }],
    identityOf: (pid) => (pid === launch.pid ? launch.process_started_at : null),
  }).host

  const document = documentOf('members', [member])
  const opened = open({ kind: 'members', document, signature: signed(document) })
  assert.deepEqual(trustedMembers(opened), [{ member_name: launch.member_name, node_id: member }])
  assert.equal(binderOverLaunches(stores.launches, processes, () => trustedMembers(opened))({ sending_pid: launch.pid }), member)

  const unsigned = open({ kind: 'members', document, signature: undefined })
  assert.equal(binderOverLaunches(stores.launches, processes, () => trustedMembers(unsigned))({ sending_pid: launch.pid }), null)
})

test('a members entry with another field, or a name a record cannot carry, refuses everyone', () => {
  for (const entry of [{ member_name: 'Pluto', node_id: member, pid: 1 }, { member_name: 'no spaces allowed', node_id: member }, member]) {
    const document = documentOf('members', [], { body: { members: [entry] } })
    refusesEveryone(open({ kind: 'members', document, signature: signed(document) }), /not a member/)
  }
})
