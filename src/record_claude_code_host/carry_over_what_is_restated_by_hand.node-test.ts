import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { CARRIED, MEMORY_OFF, NOTE, recordingFrom, type Committed, type Derived } from './carry_over_what_is_restated_by_hand.ts'

const RECORDING = new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url)

test('a re-recording keeps memory_off and the note as committed, whatever the binary says, and takes the new version (#136 r=2)', () => {
  const committed = JSON.parse(readFileSync(RECORDING, 'utf8')) as Committed
  const { [NOTE]: _note, host_version: _version, [MEMORY_OFF]: _memoryOff, ...derived } = committed
  const recorded = recordingFrom(committed, '9.9.9', derived as Derived)
  assert.deepEqual(recorded[MEMORY_OFF], committed[MEMORY_OFF], 'memory_off is carried over')
  assert.equal(recorded[NOTE], committed[NOTE], 'the note is carried over')
  assert.equal(recorded.host_version, '9.9.9')
  assert.deepEqual(Object.keys(recorded).sort(), Object.keys(committed).sort(), 'no field is lost')
  assert.deepEqual([...CARRIED].sort(), [MEMORY_OFF, NOTE].sort(), '--check leaves out exactly the carried fields')
})
