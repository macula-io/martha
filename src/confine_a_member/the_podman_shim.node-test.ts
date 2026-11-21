// The podman a member runs (martha#989, C3): a `run` or `create` that places nothing gets `--cgroups=split`, so the
// container joins the member's own scope; every other call is handed to the real podman as it came. Each case runs the
// shim the launch writes, against a stand-in podman that prints the words it was handed.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { JOB_SHELL } from '../start_the_member_on_the_owners_terminal/member_on_the_owners_terminal.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { NO_PODMAN, THE_CGROUP_FLAG, THE_SHIM_DIRECTORY_NAME, THE_SHIM_NAME, putThePodmanShimIn, thePodmanShimFor, theRealPodmanOnThisMachine } from './the_podman_shim.ts'

/** A stand-in podman that prints each word it was handed, one per line. */
const A_STAND_IN_PODMAN = ['#!/bin/sh', `printf '%s\\n' "$@"`, ''].join('\n')

/** A place to put the shim and the stand-in, removed when the test ends however it ends. */
function aPlace(t: { after: (fn: () => void) => void }): { readonly place: string; readonly stand_in: string } {
  const place = mkdtempSync(join(tmpdir(), 'martha-989-podman-'))
  t.after(() => removeTheTree(place))
  const before = join(place, 'usr-bin')
  mkdirSync(before)
  const stand_in = join(before, THE_SHIM_NAME)
  writeFileSync(stand_in, A_STAND_IN_PODMAN)
  chmodSync(stand_in, 0o755)
  return { place, stand_in }
}

/**
 * What the shim handed the stand-in, and how it ended. The shim is placed once, and every run's PATH is the stand-in's
 * directory and nothing else, with a runtime directory of the test's own: a machine that has a real podman, or a
 * container runtime's own folders, is never reached by these tests.
 */
function handed(shim: string, place: string, args: readonly string[]): { readonly words: readonly string[]; readonly status: number } {
  const runtime = join(place, 'runtime')
  mkdirSync(runtime, { recursive: true })
  try {
    const out = execFileSync(JOB_SHELL, [shim, ...args], { encoding: 'utf8', env: { PATH: join(place, 'usr-bin'), XDG_RUNTIME_DIR: runtime } })
    return { words: out.split('\n').filter((line) => line !== ''), status: 0 }
  } catch (failure) {
    const ended = failure as { readonly status?: number; readonly stderr?: string }
    return { words: [], status: ended.status ?? -1 }
  }
}

/** A shim placed for the stand-in in `place`, once per test. */
const theShimIn = (place: string): string => join(putThePodmanShimIn(place, join(place, 'usr-bin')), THE_SHIM_NAME)

test('#989 C3: a bare run and create are given the member\'s own scope, and a container one is too', (t) => {
  const { place, stand_in } = aPlace(t)
  const path = join(place, 'usr-bin')
  const shim = theShimIn(place)
  assert.deepEqual(handed(shim, place, ['run', 'alpine']).words, ['run', THE_CGROUP_FLAG, 'alpine'])
  assert.deepEqual(handed(shim, place, ['create', 'alpine']).words, ['create', THE_CGROUP_FLAG, 'alpine'])
  assert.deepEqual(handed(shim, place, ['container', 'run', 'alpine']).words, ['container', 'run', THE_CGROUP_FLAG, 'alpine'])
  assert.equal(theRealPodmanOnThisMachine(path, join(place, THE_SHIM_DIRECTORY_NAME)), stand_in, 'the stand-in on the PATH was not the real podman')
})

test('#989 C3: a call that places its own container, and a call that starts nothing, pass through as they came', (t) => {
  const { place } = aPlace(t)
  const shim = theShimIn(place)
  for (const args of [
    ['--cgroup-parent=ci-runners.slice', 'run', 'alpine'],
    [THE_CGROUP_FLAG, 'run', 'alpine'],
    ['--cgroup-parent', 'ci-runners.slice', 'create', 'alpine'],
    ['ps'],
    ['--log-level', 'debug', 'run', 'alpine'],
  ]) {
    assert.deepEqual(handed(shim, place, args).words, args, `the shim changed a call it does not place: ${JSON.stringify(args)}`)
  }
})

test('#989 C3: a launch that found no podman still places the shim, which names the folder and ends 127', (t) => {
  const place = mkdtempSync(join(tmpdir(), 'martha-989-podman-none-'))
  t.after(() => removeTheTree(place))
  // A PATH holding nothing, so a machine that does have a podman is never reached by this test.
  const nothing = join(place, 'nothing-on-this-path')
  mkdirSync(nothing, { recursive: true })
  const directory = putThePodmanShimIn(place, nothing)
  const shim = join(directory, THE_SHIM_NAME)
  let stderr = ''
  let status = 0
  try {
    execFileSync('/bin/sh', [shim, 'run', 'alpine'], { encoding: 'utf8', stdio: 'pipe', env: { PATH: nothing, XDG_RUNTIME_DIR: join(place, 'runtime') } })
  } catch (failure) {
    const ended = failure as { readonly status?: number; readonly stderr?: string }
    status = ended.status ?? -1
    stderr = ended.stderr ?? ''
  }
  assert.equal(status, 127, 'a member calling podman with none installed was not ended by a shell\'s own code')
  assert.match(stderr, new RegExp(`${NO_PODMAN} `), 'the shim did not say where it looked for a podman')
})

test('#989 C3: the shim the launch writes names the real podman by its own path, never one a member\'s PATH leads to', (t) => {
  const { place, stand_in } = aPlace(t)
  const text = thePodmanShimFor(stand_in, join(place, THE_SHIM_DIRECTORY_NAME))
  assert.match(text, new RegExp(`^real='${stand_in.replaceAll('/', '\\/')}'$`, 'm'))
  assert.doesNotMatch(text, /which podman/, 'the shim looks podman up again at run time, where a member\'s PATH could lead it elsewhere')
})
