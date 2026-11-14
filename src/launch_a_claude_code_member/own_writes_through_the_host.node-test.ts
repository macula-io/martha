// The decision that a call wrote a file reads the disk through the host contract, never node:fs
// (martha#158), so its tests run on a host in memory with no real directory anywhere.
//
// The tree here records every read it is asked for, so these tests also say what the decision asked:
// a path resolved, the kind at that path, and its bytes. A tree that refuses every read must leave
// nothing kept and must not throw out of the relay's answer.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileKind, FileTree, ProcessOutcome } from '../host_contract/host_contract.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import type { ApprovedLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { OWN_WRITE_MODES, type OwnWrite } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { ownWriteOfCall, rememberOwnWriteOfCall, type CallThatRan } from './remember_own_write_of_a_call.ts'
import { WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import { CLAUDE_CODE } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

const HOME = '/the-owners-home'
const TOP = `${HOME}/checkout`
const WRITTEN = `${TOP}/hello.txt`
const MEMBER = 'builder'
const SESSION = 'session-1'
const LAUNCH = 'launch-1'
const BLOB = 'b'.repeat(40)
const [REGULAR, EXECUTABLE] = OWN_WRITE_MODES

/**
 * A path the in-memory tree holds: a plain file's bytes and whether its owner may execute it,
 * or, for a path that is not a plain file, the kind it is (a pipe or socket, a link).
 */
interface HeldFile {
  readonly kind?: 'file' | 'other' | 'symlink'
  readonly bytes?: string
  readonly ownerExecutes?: boolean
}

interface Asked {
  readonly what: string
  readonly path: string
}

/** A tree over named paths, recording every read, and refusing any path it does not hold. */
function treeOf(files: Readonly<Record<string, HeldFile>>, asked: Asked[]): FileTree {
  const held = (path: string): HeldFile => files[path] ?? { bytes: '' }
  const kindAt = (path: string): FileKind => {
    if (path === TOP || path === HOME) return { kind: 'directory' }
    const file = files[path]
    if (file === undefined) return { kind: 'absent' }
    if (file.kind === 'other') return { kind: 'other' }
    if (file.kind === 'symlink') return { kind: 'symlink', target: path }
    return { kind: 'file', ownerExecutes: file.ownerExecutes ?? false }
  }
  return {
    kindOf: (path) => {
      asked.push({ what: 'kind', path })
      return kindAt(path)
    },
    bytesOf: (path) => {
      asked.push({ what: 'bytes', path })
      return Buffer.from(held(path).bytes ?? '')
    },
    childrenOf: (path) => {
      asked.push({ what: 'children', path })
      return []
    },
    realPathOf: (path) => {
      asked.push({ what: 'real path', path })
      return kindAt(path).kind === 'absent' ? null : path
    },
  }
}

/** A tree that refuses every read, as one that holds nothing this member may see does. */
const REFUSING: FileTree = {
  kindOf: (path) => refuse(path),
  bytesOf: (path) => refuse(path),
  childrenOf: (path) => refuse(path),
  realPathOf: (path) => refuse(path),
}

function refuse(what: string): never {
  throw Object.assign(new Error(`EACCES: the test's tree refuses ${what}`), { code: 'EACCES' })
}

/** Git, answered in memory: the checkout's top, and the blob `git add` would give the file. */
const gitInMemory = (request: { readonly args: readonly string[] }): ProcessOutcome => {
  const answer = (stdout: string): ProcessOutcome => ({ exit_code: 0, stdout: `${stdout}\n`, stderr: '' })
  if (request.args.includes('rev-parse')) return answer(TOP)
  if (request.args.includes('hash-object')) return answer(BLOB)
  return { exit_code: 1, stdout: '', stderr: `the test host runs no git like ${request.args.join(' ')}` }
}

/** A host in memory: this test tree, this git, and no scratch place at all. */
const hostWith = (files: FileTree): HostForTests => hostForTests({ files, runNow: gitInMemory })

/** A launch started on an owner's approval, and the writes it keeps. */
function launchKeeping(kept: OwnWrite[]): ApprovedLaunch {
  return {
    host: CLAUDE_CODE,
    launch_dir: TOP,
    stop_dir: HOME,
    approved_fingerprints: [],
    since_approval: {
      approved: { entries: [], tree: null },
      member: MEMBER,
      launch_id: LAUNCH,
      own_writes: { append: (write) => void kept.push(write), all: () => ({ writes: kept, unread: [] }) },
    },
  }
}

/** A Write of the file at `path`, as Claude Code's file tools name it. */
const writeOf = (path: string, content: string): CallThatRan => ({
  tool: WHOLE_FILE_TOOL,
  input: { file_path: path, content, tool_use_id: 'toolu_Write' },
  session: SESSION,
  home: HOME,
})

const NOW = new Date('2026-11-11T12:00:00.000Z')

test('a Write of a file under the checkout is kept, read only through the host: its real path, its blob and its mode', () => {
  const asked: Asked[] = []
  const host = hostWith(treeOf({ [WRITTEN]: { bytes: 'hello\n' } }, asked))

  const write = ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, 'hello\n'), host.host, NOW)

  assert.deepEqual(write, {
    path: WRITTEN,
    blob: BLOB,
    mode: REGULAR,
    tool: WHOLE_FILE_TOOL,
    tool_use_id: 'toolu_Write',
    session: SESSION,
    launch: LAUNCH,
    recorded_at: NOW.toISOString(),
  })
  assert.deepEqual(
    asked.filter(({ what }) => what !== 'real path'),
    [{ what: 'kind', path: WRITTEN }, { what: 'bytes', path: WRITTEN }],
  )
})

test('a file its owner may execute is kept at mode 100755, as the contract says of the file', () => {
  const host = hostWith(treeOf({ [WRITTEN]: { bytes: '#!/bin/sh\n', ownerExecutes: true } }, []))

  const write = ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, '#!/bin/sh\n'), host.host, NOW)

  assert.equal(write?.mode, EXECUTABLE)
})

test('a Write whose bytes on disk are not the call content is not kept, and nothing is asked for its blob', () => {
  const host = hostWith(treeOf({ [WRITTEN]: { bytes: 'what someone else left\n' } }, []))

  assert.equal(ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, 'hello\n'), host.host, NOW), undefined)
})

test('a Write whose bytes on disk have the same length as the call content and differ in one of them is not kept (review r=1)', () => {
  const host = hostWith(treeOf({ [WRITTEN]: { bytes: 'hellO\n' } }, []))

  assert.equal(ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, 'hello\n'), host.host, NOW), undefined)
})

test('a path that is not a regular file under the checkout is not kept, and its bytes are never read', () => {
  const asked: Asked[] = []
  const host = hostWith(treeOf({ [TOP]: { bytes: '' } }, asked))

  assert.equal(ownWriteOfCall(launchKeeping([]), writeOf(TOP, 'hello\n'), host.host, NOW), undefined)
  assert.deepEqual(asked.filter(({ what }) => what === 'bytes'), [])
})

test('a path that is a pipe or a socket, holding the call content, is not kept and its bytes are never read (review r=1)', () => {
  const asked: Asked[] = []
  const host = hostWith(treeOf({ [WRITTEN]: { kind: 'other', bytes: 'hello\n' } }, asked))

  assert.equal(ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, 'hello\n'), host.host, NOW), undefined)
  assert.deepEqual(asked.filter(({ what }) => what === 'bytes'), [])
})

test('a path that is a link, resolved to itself under the checkout, is not kept and its bytes are never read (review r=1)', () => {
  const asked: Asked[] = []
  const host = hostWith(treeOf({ [WRITTEN]: { kind: 'symlink', bytes: 'hello\n' } }, asked))

  assert.equal(ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, 'hello\n'), host.host, NOW), undefined)
  assert.deepEqual(asked.filter(({ what }) => what === 'bytes'), [])
})

test('a path outside the checkout is not kept, and its kind is never read', () => {
  const asked: Asked[] = []
  const elsewhere = `${HOME}/notes.txt`
  const host = hostWith(treeOf({ [elsewhere]: { bytes: 'hello\n' } }, asked))

  assert.equal(ownWriteOfCall(launchKeeping([]), writeOf(elsewhere, 'hello\n'), host.host, NOW), undefined)
  assert.deepEqual(asked.filter(({ what }) => what === 'kind'), [])
})

test('a tree that refuses every read leaves nothing kept, and does not throw out of the relay answer', () => {
  const host = hostWith(REFUSING)

  assert.equal(ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, 'hello\n'), host.host, NOW), undefined)
})

test('a read that fails with a bug of our own, carrying no code, is thrown rather than read as someone else’s change (review r=1)', () => {
  const buggy: FileTree = {
    kindOf: () => {
      throw new TypeError('the kind was read as a file without being asked')
    },
    bytesOf: (path) => refuse(path),
    childrenOf: (path) => refuse(path),
    realPathOf: (path) => path,
  }

  assert.throws(() => ownWriteOfCall(launchKeeping([]), writeOf(WRITTEN, 'hello\n'), hostWith(buggy).host, NOW), TypeError)
})

test('a call that made an own write has it kept on the launch; a call that made none keeps nothing', () => {
  const kept: OwnWrite[] = []
  const host = hostWith(treeOf({ [WRITTEN]: { bytes: 'hello\n' } }, []))
  const launch = launchKeeping(kept)

  assert.equal(rememberOwnWriteOfCall(launch, writeOf(WRITTEN, 'hello\n'), host.host), undefined)
  assert.deepEqual(kept.map(({ path, mode }) => ({ path, mode })), [{ path: WRITTEN, mode: REGULAR }])
  assert.equal(rememberOwnWriteOfCall(launch, writeOf(`${TOP}/other.txt`, 'gone\n'), host.host), undefined)
  assert.equal(kept.length, 1)
})
