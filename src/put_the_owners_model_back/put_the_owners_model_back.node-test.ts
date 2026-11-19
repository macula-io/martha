// The wait for the host's save is one bound of wall clock, never a count of looks (martha#836). A look costs what a
// read costs, and on a loaded machine that is many times what it is on an idle one: a wait that counts looks multiplies
// that cost, so the row ends up telling the owner the file "showed no save ... within 10000 ms" about a wait that took
// half a minute, and a test that makes two of those waits is cancelled by the suite's own per-test limit. These looks
// are slow on purpose, so the bound is held on an idle machine too.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { ASwitchLock, TheOwnersSettingsRead, TheOwnersSettingsStore } from '../host_contract/host_contract.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { theSaveInTheFile, THE_SAVE_STEP_MS, THE_SAVE_WAIT_MS, type AGuardedSwitch, type OwnersDefaultPlace } from './put_the_owners_model_back.ts'
import { snapshotOf } from './the_owners_settings_file.ts'

/** What one look at the owner's file costs on a loaded machine: a read that is slow, and that never shows a save. */
const A_SLOW_LOOK_MS = 30

const THE_OWNERS_SETTINGS = { env: { MARTHA_TEST: '1' }, model: 'sonnet' }
const THE_BYTES = new TextEncoder().encode(`${JSON.stringify(THE_OWNERS_SETTINGS, null, 2)}\n`)

/** The owner's config folder, and their settings file in it: a place of the test's own, spelled by the host's own name. */
const THE_OWNERS_CONFIG = '/the/owner'
const THE_OWNERS_FILE = join(THE_OWNERS_CONFIG, USER_SETTINGS_FILE)

/** One look at the owner's file, as slow as a loaded machine makes it, answering the same bytes every time. */
const aSlowLook = (): TheOwnersSettingsRead => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, A_SLOW_LOOK_MS)
  return { kind: 'file', bytes: THE_BYTES, mode: 0o600 }
}

/** The owner's file through that look: no save ever shows, so the wait runs to its bound. */
const theOwnersFile: TheOwnersSettingsStore = {
  read: aSlowLook,
  writeBack: () => undefined,
  remove: () => undefined,
  takeTheLock: async (): Promise<ASwitchLock> => ({ file: '/nowhere', release: () => undefined }),
}

test('the wait for the host\'s save ends within its bound, however slow a look at the file is (martha#836)', async () => {
  const place: OwnersDefaultPlace = { store: theOwnersFile, file: THE_OWNERS_FILE, config_dir: THE_OWNERS_CONFIG }
  const read = snapshotOf(aSlowLook())
  if ('refusal' in read) assert.fail(read.refusal)
  const guarded: AGuardedSwitch = {
    record: {
      config_dir: place.config_dir,
      // The hash of the bytes every look answers, so each look says the host's save has not shown and the wait runs on.
      before: read.before,
      after: null,
      without_model: read.without_model,
      had_file: true,
      had_model: true,
      owner_model: 'sonnet',
      wrote: null,
      why: '',
    },
    snapshot: read,
    lock: { file: '/nowhere', release: () => undefined },
    asked: 'fable',
  }
  const started = Date.now()
  await theSaveInTheFile(place, guarded)
  const took = Date.now() - started
  // The last look may begin just inside the bound, and one step may be in flight when it ends: both are the loop's own
  // and both are read from the file's constants here, so no number is typed that the module does not define.
  const theBound = THE_SAVE_WAIT_MS + A_SLOW_LOOK_MS + THE_SAVE_STEP_MS
  assert.ok(took <= theBound, `the wait took ${String(took)} ms past its own bound of ${String(theBound)} ms: it counted looks, so a slow look stretched it`)
})
