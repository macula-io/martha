import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { fixtureKey, signLikeAHardwareKey, type FixtureKey } from './sign_like_a_hardware_key.ts'
import { ED25519, verifySshSignature } from './ssh_signature.ts'
import {
  LIST_FIELD,
  TRUST_LIST_NAMESPACE,
  openTrustList,
  type EpochStore,
  type TrustListKind,
  type TrustListToOpen,
  trustedPolicy,
  trustedRoomRosters,
  trustedSupervisors,
} from './trust_only_signed_lists.ts'
import { admitsInCrewRoom } from '../admit_a_room_message/admit_a_room_message.ts'
import { refuseExecutionAfterUngatedText } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { actorFromCallingSession, refuseActionFromAnUnverifiedActor } from '../who_may_act/who_may_act.ts'

// Synthetic node ids and crew names, never real ones: this repository is public.
const member = '1'.repeat(64)
const attacker = '2'.repeat(64)
const crew = 'a-crew'
const now = new Date('2026-11-06T12:00:00Z')
const later = '2026-12-01T00:00:00Z'

const owner = fixtureKey()

const epochStore = (): EpochStore => {
  const seen = new Map<string, number>()
  return {
    highest: (c, k) => seen.get(`${c}/${k}`),
    raise: (c, k, epoch) => void seen.set(`${c}/${k}`, Math.max(epoch, seen.get(`${c}/${k}`) ?? epoch)),
  }
}

const documentOf = (kind: TrustListKind, node_ids: readonly string[], overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({ crew, kind, epoch: 1, expires_at: later, body: { [LIST_FIELD[kind]]: node_ids }, ...overrides }),
  )

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
  assert.equal(epochs.highest(crew, 'crew_roster'), undefined)
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
    rmSync(dir, { recursive: true, force: true })
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
