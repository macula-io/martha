// The record of a member's own write and its rules, with no file under them (martha#132, #129).
//
// Real git for the blob ids, in temporary repositories removed after each test.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  GIT_OBJECT_FORMATS,
  gitBlobIdOf,
  latestOfLaunch,
  lineOfOwnWrite,
  OWN_WRITE_MODES,
  ownWriteOfLine,
  ownWritesOfLaunch,
  type OwnWrite,
  type OwnWritesStore,
} from './remember_a_members_own_writes.ts'

function ownWrite(fields: Partial<OwnWrite> = {}): OwnWrite {
  return {
    path: '/project/hello.txt',
    blob: 'ce013625030ba8dba906f756967f9e9ca394464a',
    mode: OWN_WRITE_MODES[0],
    tool: 'Write',
    tool_use_id: 'toolu_1',
    session: 'session-1',
    launch: 'launch-1',
    recorded_at: new Date(0).toISOString(),
    ...fields,
  }
}

test('a record read back from its own line is the same record, its fields in the order a line keeps them', () => {
  const write = ownWrite()
  const line = lineOfOwnWrite({ ...write })
  assert.deepEqual(ownWriteOfLine(line), write)
  assert.deepEqual(Object.keys(JSON.parse(line)), ['path', 'blob', 'mode', 'tool', 'tool_use_id', 'session', 'launch', 'recorded_at'])
})

test("at one path the launch's last own write is the one that counts, and another launch's never does", () => {
  const first = ownWrite()
  const other = ownWrite({ launch: 'launch-2', tool_use_id: 'toolu_2' })
  const later = ownWrite({ blob: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', tool_use_id: 'toolu_3' })
  assert.deepEqual(latestOfLaunch([first, other, later], 'launch-1'), [later])
  assert.deepEqual(latestOfLaunch([first, other, later], 'launch-2'), [other])
})

test("a store's refusal is the launch's refusal: nothing is read from a store that cannot be trusted", () => {
  const refusing: OwnWritesStore = { append: () => undefined, all: () => ({ refusal: 'not trusted' }) }
  assert.deepEqual(ownWritesOfLaunch(refusing, 'launch-1'), { refusal: 'not trusted' })
})

function gitHashObject(t: TestContext, format: string, bytes: Buffer): string {
  const repository = mkdtempSync(join(tmpdir(), 'martha-blob-'))
  t.after(() => rmSync(repository, { recursive: true, force: true }))
  execFileSync('git', ['init', '--quiet', `--object-format=${format}`, repository])
  return execFileSync('git', ['-C', repository, 'hash-object', '--stdin'], { input: bytes, encoding: 'utf8' }).trim()
}

const CONTENTS: readonly Buffer[] = [
  Buffer.alloc(0),
  Buffer.from('hello\n'),
  Buffer.from('a line\r\nanother\r\n'),
  Buffer.from([0, 1, 2, 255, 254, 10, 0]),
]

for (const format of GIT_OBJECT_FORMATS) {
  test(`a blob id is the one git names for the same bytes in a ${format} checkout`, (t) => {
    for (const bytes of CONTENTS) assert.equal(gitBlobIdOf(bytes, format), gitHashObject(t, format, bytes))
  })
}
