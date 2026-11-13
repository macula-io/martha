// Which approval a start runs under is the checkout's decision, not the command's (martha#255 r=2 R3).
//
// theApprovalInUse moved out of start_a_member into the slice that decides what a checkout may run, and nothing tested
// it on its own: a version answering `{ approval: undefined }` for a checkout that needs approving starts a member on
// config the owner never approved, and every start test still passed. These cases drive the real reader over real
// checkouts and real git trees, and remove them when they end.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import {
  fingerprintOf,
  LAUNCH_FILES_OF_HOST,
  readLaunchState,
  theApprovalInUse,
  type LaunchPlace,
} from './refuse_launch_of_unapproved_config.ts'

/** The file a checkout uses to start a tool server: config that starts code by itself. */
const [SERVERS] = LAUNCH_FILES_OF_HOST['claude-code']

/** A place to start in, as this machine holds it, and the owner's home it stops at. */
interface Place {
  readonly home: string
  readonly checkout: string
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()

/** A checkout under a home of its own, with one commit, removed when the test ends. */
function aCheckout(t: TestContext): Place {
  const home = mkdtempSync(join(tmpdir(), 'martha-approval-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'work', 'checkout')
  mkdirSync(checkout, { recursive: true })
  git(checkout, 'init', '-q', '.')
  writeFileSync(join(checkout, 'README.md'), 'a checkout\n')
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  return { home, checkout }
}

/** Puts a file in the checkout, making the folders on the way to it, and commits it so the tree pins it. */
function configIn({ checkout }: Place, name: string, content: string): void {
  mkdirSync(dirname(join(checkout, name)), { recursive: true })
  writeFileSync(join(checkout, name), content)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'config')
}

const placeIn = ({ home, checkout }: Place): LaunchPlace => ({ host: 'claude-code', launch_dir: checkout, stop_dir: home })

/** The approval a start on this checkout's own config would be given, once the owner says yes to it. */
function theApprovalOf(place: Place): { readonly tree: string | null; readonly fingerprint: string } {
  const state = readLaunchState(placeIn(place), thisMachine)
  return { tree: state.tree, fingerprint: fingerprintOf(state) }
}

test('a checkout that still needs approving answers the entries to approve, never an approval (martha#255 r=2 R3)', (t) => {
  const place = aCheckout(t)
  configIn(place, SERVERS, JSON.stringify({ mcpServers: { probe: { command: 'echo', args: ['one'] } } }))

  const in_use = theApprovalInUse(placeIn(place), [], thisMachine)
  assert.deepEqual(in_use, { needs_approval: [SERVERS] }, 'a start on config the owner has not approved is told what to approve')
})

test('an approval of another config is not this checkout\'s (martha#255 r=2 R3)', (t) => {
  const place = aCheckout(t)
  configIn(place, SERVERS, JSON.stringify({ mcpServers: { probe: { command: 'echo', args: ['one'] } } }))
  const other = { tree: theApprovalOf(place).tree, fingerprint: 'a-fingerprint-of-some-other-config' }

  assert.deepEqual(theApprovalInUse(placeIn(place), [other], thisMachine), { needs_approval: [SERVERS] }, 'an approval that does not fit this checkout approves nothing')
})

test('a start on an approved checkout runs under that approval (martha#255 r=2 R3)', (t) => {
  const place = aCheckout(t)
  configIn(place, SERVERS, JSON.stringify({ mcpServers: { probe: { command: 'echo', args: ['one'] } } }))
  const approval = theApprovalOf(place)

  assert.deepEqual(theApprovalInUse(placeIn(place), [approval], thisMachine), { approval }, 'the approval the owner gave is the one the start runs under')
})

test('a checkout that asks nothing of the owner runs under no approval (martha#255 r=2 R3)', (t) => {
  const place = aCheckout(t)

  assert.deepEqual(theApprovalInUse(placeIn(place), [], thisMachine), { approval: undefined }, 'a checkout with no such config needs no approval, and is not asked for one')
})
