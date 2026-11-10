// A run's project folders are read, not predicted (martha#179). The probe used to remove one
// computed name, and a host that outlived its killed shell wrote that name again afterwards:
// the next read found it and the last row went red on a tree where nothing was wrong.
//
// These tests plant the folders a run meets -- one that was already there, one the run wrote, one
// that has nothing to do with the probe -- and hold the two halves of the row to account: what it
// takes away, and what it says when something survives.

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  projectFolderFor,
  projectKeyOf,
  takeAwayTheOnesThisRunWrote,
  theLeftoverRow,
  theProjectFoldersThere,
  whatIsStillLeftAtTheEnd,
} from './the_project_folders_a_run_wrote.ts'

const SCRATCH_PREFIX = projectKeyOf(join(tmpdir(), 'martha-probe-'))
/** A folder an earlier run left, with the prefix this run's own folders carry: it must stay. */
const ALREADY_THERE = '-tmp-martha-probe-OldOne1-checkout'
/** The older generation's leftovers, which the prefix does not reach and which stay for the owner. */
const OLDER_GENERATION = '-tmp-martha-probe41-774gdO-checkout'
const THIS_RUN_WROTE = '-tmp-martha-probe-AbC123-checkout'
const NOT_THE_PROBES = '-home-rl-work-github-com-macula-io-martha'

/** A config dir of the test's own, holding the folders named: what the host reads and writes. */
function aConfigDirHolding(...names: readonly string[]): { readonly env: Record<string, string>; readonly root: string; at: (name: string) => string } {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-probe-test-'))
  const config = join(scratch, 'config')
  const root = join(config, 'projects')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(config, 'settings.json'), '{}\n')
  for (const name of names) mkdirSync(join(root, name, 'memory'), { recursive: true })
  return { env: { HOME: scratch, CLAUDE_CONFIG_DIR: config }, root, at: (name) => join(root, name) }
}

test('the project folders a run meets are read from the config dir its host is started with (#179)', (t) => {
  const config = aConfigDirHolding(ALREADY_THERE)
  t.after(() => rmSync(join(config.root, '..', '..'), { recursive: true, force: true }))
  const before = theProjectFoldersThere(config.env)
  assert.deepEqual([...before.names], [ALREADY_THERE])
  // The folder the host keeps one project in is the same one, by the key the host itself uses.
  assert.equal(projectFolderFor(config.env, '/tmp/martha-probe-AbC123/checkout'), config.at(THIS_RUN_WROTE))
})

test('a run takes away every folder it wrote and leaves the ones that were already there (#179)', (t) => {
  const config = aConfigDirHolding(ALREADY_THERE, OLDER_GENERATION)
  t.after(() => rmSync(join(config.root, '..', '..'), { recursive: true, force: true }))
  const before = theProjectFoldersThere(config.env)
  // What the run adds: a scratch checkout's folder, and one that is no probe's business.
  mkdirSync(config.at(THIS_RUN_WROTE), { recursive: true })
  mkdirSync(config.at(NOT_THE_PROBES), { recursive: true })

  assert.deepEqual(takeAwayTheOnesThisRunWrote(before, SCRATCH_PREFIX), [])
  assert.deepEqual(
    readdirSync(config.root).sort(),
    [NOT_THE_PROBES, ALREADY_THERE, OLDER_GENERATION].sort(),
    'a folder that was there before the run, or is not a probe folder, is not this run\'s to take',
  )
})

test('a folder a run wrote and did not take away is named by the row, which fails the run (#179)', (t) => {
  const config = aConfigDirHolding(ALREADY_THERE)
  t.after(() => {
    chmodSync(config.root, 0o755)
    rmSync(join(config.root, '..', '..'), { recursive: true, force: true })
  })
  const before = theProjectFoldersThere(config.env)
  // The host wrote its folder during the run, and the probe cannot take it away: the projects
  // folder is read-only, so the removal is refused. That is the state the row has to report.
  mkdirSync(config.at(THIS_RUN_WROTE), { recursive: true })
  mkdirSync(config.at(NOT_THE_PROBES), { recursive: true })
  chmodSync(config.root, 0o555)

  const left = takeAwayTheOnesThisRunWrote(before, SCRATCH_PREFIX)

  assert.deepEqual(left, [THIS_RUN_WROTE])
  assert.equal(
    theLeftoverRow(left),
    `project folders this run left in the owner's config dir: ${THIS_RUN_WROTE}, CLAIMED none`,
  )
  assert.notEqual(theLeftoverRow(left), theLeftoverRow([]))
})

test('a folder written after a run read back is seen and taken at the end (#179)', (t) => {
  const config = aConfigDirHolding(OLDER_GENERATION)
  t.after(() => rmSync(join(config.root, '..', '..'), { recursive: true, force: true }))
  const startedWith = theProjectFoldersThere(config.env)
  // The late write: it was not there when the run started, and the run's own read-back never saw it.
  mkdirSync(config.at(THIS_RUN_WROTE), { recursive: true })

  const left = whatIsStillLeftAtTheEnd(startedWith, SCRATCH_PREFIX, [])

  assert.deepEqual(left, [], 'the late folder is the one the row has to see, and it was taken')
  assert.deepEqual(readdirSync(config.root), [OLDER_GENERATION])
})
