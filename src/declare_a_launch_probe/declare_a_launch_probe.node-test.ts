// The builders every probe:launch row shares (martha#443): where a file is put, the order of a command's words, and
// the turn budget read back from the command a row really builds (martha#223).

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import {
  claude,
  claudeAsTheAgent,
  HEADLESS_CLAUDE,
  NO_PLACE,
  NO_SWITCHES,
  PROMPT,
  put,
  rowsWithoutRoomToFinish,
  ROOM_TO_FINISH,
  turnBudgetsOf,
  type Probe,
} from './declare_a_launch_probe.ts'

const SWITCHES = { ...NO_SWITCHES, args: ['--a-switch', 'its-value'] }

/** A row that starts the model with `turns` turns, or with no budget at all. */
const rowWith = (what: string, turns?: number): Probe => ({
  what,
  host: CLAUDE_CODE,
  command: claude(...(turns === undefined ? [] : ['--max-turns', String(turns)])),
  planted: () => {},
  expected: {},
  planned: false,
})

test('put makes the folders a file needs and writes it (martha#443)', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-probe-test-'))
  t.after(() => removeTheTree(scratch))
  put(scratch, join('one', 'two', 'file.txt'), 'text')
  assert.equal(readFileSync(join(scratch, 'one', 'two', 'file.txt'), 'utf8'), 'text')
  assert.equal(existsSync(join(scratch, 'one')), true)
})

test('a row\'s command puts the launch\'s switches after its own words, since a switch can take every word up to the next option (martha#443)', () => {
  assert.deepEqual(claude(...HEADLESS_CLAUDE, PROMPT)(SWITCHES, NO_PLACE).args, [...HEADLESS_CLAUDE, PROMPT, ...SWITCHES.args])
  const { args } = claudeAsTheAgent('an-agent', ...HEADLESS_CLAUDE)(SWITCHES, NO_PLACE)
  assert.deepEqual(args.slice(-(SWITCHES.args.length + 3)), ['--agent', 'an-agent', PROMPT, ...SWITCHES.args])
})

test('the turn budget is read from the command a row builds, and a row with less room than it needs is named (martha#223, martha#443)', () => {
  const rows = [rowWith('roomy', ROOM_TO_FINISH), rowWith('cramped', ROOM_TO_FINISH - 1), rowWith('unbounded')]
  assert.deepEqual(turnBudgetsOf(rows).map((row) => row.maxTurns), [ROOM_TO_FINISH, ROOM_TO_FINISH - 1, undefined])
  assert.deepEqual(rowsWithoutRoomToFinish(rows).map((row) => row.what), ['cramped'])
})
