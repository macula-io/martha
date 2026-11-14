// Two probe:launch runs can share one owner's config dir -- two members on one machine, each
// with its own scratch. The last row of one run used to remove every folder that appeared
// during it and started with the generic `<tmpdir>/martha-probe-`, which takes the other run's
// folders with it, silently and including the memory folder that run planted (martha#179 r=2).
//
// These tests hold the end read to the scratches this run registered: what it wrote is taken,
// what another run wrote, and what the owner keeps, is left where it is.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { projectKeyOf, theProjectFoldersThere } from './the_project_folders_a_run_wrote.ts'
import { aScratchThisRunMade, whatThisRunLeftAtTheEnd } from './probe_hosts.ts'

// Made-up scratch paths, keyed by the host's own rule rather than read from this machine's
// TMPDIR: the CI runs under a link (a long path reached through a symlink), which would key
// every name differently there.
const A_SCRATCH_OF_THIS_RUN = '/tmp/martha-probe-MiNe12'
const ANOTHER_RUNS_SCRATCH = '/tmp/martha-probe-OTH456'
/** An owner's own working tree: no probe's business, and a made-up path, so no real one is named. */
const THE_OWNERS_OWN = '/srv/git/martha/checkout'

/** A config dir of the test's own: the projects folder the host writes its folders into. */
function aConfigDir(): { readonly env: Record<string, string>; readonly root: string; at: (name: string) => string; readonly scratch: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-probe-test-'))
  const config = join(scratch, 'conf-dir')
  const root = join(config, 'projects')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(config, 'settings.json'), '{}\n')
  return { env: { HOME: scratch, CLAUDE_CONFIG_DIR: config }, root, at: (name) => join(root, name), scratch }
}

test('another probe:launch keeps its project folders when this run reads the end (#179 r=2)', (t) => {
  const config = aConfigDir()
  t.after(() => removeTheTree(config.scratch))
  const startedWith = theProjectFoldersThere(config.env)
  aScratchThisRunMade(A_SCRATCH_OF_THIS_RUN)

  // What appeared after this run started: its own checkout's folder, and another run's
  // checkout, its worktree, and the folder it plants a codeword in, plus the owner's own.
  const mine = projectKeyOf(join(A_SCRATCH_OF_THIS_RUN, 'checkout'))
  const theirsCheckout = projectKeyOf(join(ANOTHER_RUNS_SCRATCH, 'checkout'))
  const theirsWorktree = projectKeyOf(join(ANOTHER_RUNS_SCRATCH, 'worktree'))
  const owners = projectKeyOf(THE_OWNERS_OWN)
  for (const name of [mine, theirsCheckout, theirsWorktree, owners]) mkdirSync(config.at(name), { recursive: true })

  const left = whatThisRunLeftAtTheEnd(startedWith)

  assert.deepEqual(left, [], 'the row names this run\'s leftovers, not another run\'s folder')
  assert.deepEqual(
    readdirSync(config.root).sort(),
    [theirsCheckout, theirsWorktree, owners].sort(),
    'only the folder this run\'s own scratch produced is taken',
  )
  assert.ok(!readdirSync(config.root).includes(mine), 'this run\'s own folder is gone')
})
