// An act that lands several packages is recovered by one rule across their ledgers (martha#512 slice 2).
//
// These pin Mercurius's ruling on the multi-package form: a pause decided on the act itself pauses every package it
// lands; a retry is sent only when every ledger kept the decision to send it; a pause is claimed only for the packages
// whose ledger kept it, and every other package is named and its member told to stop and report.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { HostContract } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { ledgerStreamOf, readLedger, thePauseOn, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { RecoveryDecided, sendAnActOnEveryPackageAndRecover, type AnInspection } from './recover_a_failed_act.ts'

// Synthetic names, never a real one: this repository is public.
const PACKAGES = ['synthetic-owner/repo#1', 'synthetic-owner/repo#2', 'synthetic-owner/repo#3'] as const
const push = { kind: 'push', what: 'origin the-batch' } as const
const act = { packages: PACKAGES, member: 'member-one', act: push }

const nowhere = async (): Promise<AnInspection> => ({ state: 'it_did_not_happen', read: 'origin', found: 'no the-batch' })

/** A row store that refuses, once each, the rows a rule names: by the package's stream and the row's kind. */
function aStoreThatRefuses(refused: readonly { readonly package: string; readonly kind: string }[]): HostContract['stores']['rows'] {
  const { host } = hostForTests()
  const waiting = [...refused]
  return {
    append: async (stream, row) => {
      const at = waiting.findIndex((one) => ledgerStreamOf(one.package) === stream && one.kind === row['kind'])
      if (at >= 0) {
        waiting.splice(at, 1)
        throw new Error(`the store kept no ${String(row['kind'])} row`)
      }
      return host.stores.rows.append(stream, row)
    },
    read: (stream) => host.stores.rows.read(stream),
  }
}

/** A failure kept as it was thrown: what a caller would have caught. */
async function caught(sending: () => Promise<string>): Promise<unknown> {
  try {
    await sending()
  } catch (failure) {
    return failure
  }
  return assert.fail('the send was expected to fail')
}

const pausesOn = async (host: LedgerHost): Promise<readonly boolean[]> =>
  Promise.all(PACKAGES.map(async (one) => thePauseOn(await readLedger(host, one)) !== undefined))

test('#512 slice 2: a batch push that fails as unknown pauses every package it lands', async () => {
  const { host } = hostForTests()
  const failure = await caught(() =>
    sendAnActOnEveryPackageAndRecover(host, act, async () => {
      throw {}
    }, nowhere),
  )
  assert.ok(failure instanceof RecoveryDecided && failure.decision === 'paused', `the batch was expected to pause: ${String(failure)}`)
  assert.deepEqual(await pausesOn(host), [true, true, true], 'a package the push may have landed was not paused')
  assert.match(failure.told, /^synthetic-owner\/repo#1, synthetic-owner\/repo#2, synthetic-owner\/repo#3: the push/)
  assert.match(failure.told, / synthetic-owner\/repo#1, synthetic-owner\/repo#2, synthetic-owner\/repo#3 are paused: the Supervisor is nudged about each/)
  assert.doesNotMatch(failure.told, /could not be recorded/)
})

test('#512 slice 2: a retry one ledger did not keep the decision for is never sent, and no pause is claimed', async () => {
  // The first package's announcement is refused, so nothing ran and a retry is decided; the second package's ledger then
  // refuses that decision, so no successor of that package could read the attempt.
  const { host } = hostForTests({
    rows: aStoreThatRefuses([
      { package: PACKAGES[0], kind: 'act_announced' },
      { package: PACKAGES[1], kind: 'recovery_decided' },
    ]),
  })
  let sends = 0
  const failure = await caught(() =>
    sendAnActOnEveryPackageAndRecover(host, act, async () => {
      sends += 1
      return 'pushed'
    }, nowhere),
  )
  assert.ok(failure instanceof RecoveryDecided && failure.decision === 'paused', `the batch was expected to stop: ${String(failure)}`)
  assert.equal(sends, 0, 'the retry was sent although one ledger did not keep the decision')
  assert.match(failure.told, /The decision for synthetic-owner\/repo#2 was not recorded \(the store kept no recovery_decided row\)/)
  assert.match(failure.told, /The pause could not be recorded on synthetic-owner\/repo#1, synthetic-owner\/repo#2, synthetic-owner\/repo#3, so nothing holds them/)
  assert.deepEqual(await pausesOn(host), [false, false, false])
})

test('#512 slice 2: a pause one ledger did not keep is claimed for the others only, and that package is told to stop and report', async () => {
  const { host } = hostForTests({ rows: aStoreThatRefuses([{ package: PACKAGES[1], kind: 'recovery_decided' }]) })
  const failure = await caught(() =>
    sendAnActOnEveryPackageAndRecover(host, act, async () => {
      throw {}
    }, nowhere),
  )
  assert.ok(failure instanceof RecoveryDecided && failure.decision === 'paused')
  assert.deepEqual(await pausesOn(host), [true, false, true])
  assert.match(failure.told, / synthetic-owner\/repo#1, synthetic-owner\/repo#3 are paused: the Supervisor is nudged about each/)
  assert.match(
    failure.told,
    /The pause could not be recorded on synthetic-owner\/repo#2, so nothing holds it and the Supervisor is not nudged: do not go on with it, and tell the Supervisor yourself\.$/,
  )
})

test('#512 slice 2: an act that lands several packages, sent cleanly, is announced and concluded in every ledger', async () => {
  const { host } = hostForTests()
  assert.equal(await sendAnActOnEveryPackageAndRecover(host, act, async () => 'pushed', nowhere), 'pushed')
  for (const one of PACKAGES) assert.deepEqual((await readLedger(host, one)).map((row) => row.kind), ['act_announced', 'act_concluded'])
})
