// What `martha gate` prints (martha#321): one line per declared member, or one member's audit lines.
//
// What is proven: the mode reaches the line as the declaration asked for it, an audited member's line carries its
// count, `--member` prints the lines oldest first with the path, the sender, the tool and the refusal's own words, and
// a member the declaration does not know is refused by name rather than printed as absent.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { GATE_AUDIT_PLACE } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import type { GateSetting } from '../read_the_gate_mode/read_the_gate_mode.ts'
import { sayWhatTheGateDoes, type TheGate } from './say_what_the_gate_does.ts'

const MEMBERS: readonly string[] = ['builder', 'reviewer', 'writer']

/** A crew's own folder for this test, removed after it, holding the audit lines given. */
function aCrewsPlace(t: TestContext, lines: Readonly<Record<string, readonly string[]>> = {}): string {
  const crew = mkdtempSync(join(tmpdir(), 'martha-321-gate-'))
  t.after(() => removeTheTree(crew))
  mkdirSync(join(crew, GATE_AUDIT_PLACE), { mode: 0o700 })
  for (const [member, each] of Object.entries(lines)) {
    writeFileSync(join(crew, GATE_AUDIT_PLACE, `${member}.jsonl`), each.map((line) => `${line}\n`).join(''), { mode: 0o600 })
  }
  return crew
}

const aLine = (path: string, tool: string): string =>
  JSON.stringify({ at: '2026-11-13T21:00:00.000Z', path, sender: null, tool, refusal: `Nothing executes in this session: path ${path}.` })

const shown = (gate: TheGate): readonly string[] => {
  assert.equal(gate.shown, true, gate.shown ? '' : gate.refusal)
  return (gate as { readonly lines: readonly string[] }).lines
}

test('#321: every declared member is one line: enforced, audited with its count, or off', (t) => {
  const crew = aCrewsPlace(t, { builder: [aLine('A4', 'Bash'), aLine('A2', 'Bash')] })
  const gate: GateSetting = { kind: 'named', enforced: ['writer'], audited: ['builder'] }
  assert.deepEqual(shown(sayWhatTheGateDoes({ members: MEMBERS, gate, crew })), [
    'builder: audited, 2 would-be refusals',
    'reviewer: off',
    'writer: enforced',
  ])
})

test('#321: a member audited with nothing yet to show says so, rather than staying silent', (t) => {
  const gate: GateSetting = { kind: 'every-member', mode: 'audited' }
  assert.deepEqual(shown(sayWhatTheGateDoes({ members: MEMBERS, gate, crew: aCrewsPlace(t) })), [
    'builder: audited, 0 would-be refusals',
    'reviewer: audited, 0 would-be refusals',
    'writer: audited, 0 would-be refusals',
  ])
})

test('#321: --member prints that member’s lines oldest first, with the path, the sender, the tool and the words', (t) => {
  const crew = aCrewsPlace(t, { builder: [aLine('A4', 'Bash'), aLine('A2', 'Write')] })
  const gate: GateSetting = { kind: 'named', enforced: [], audited: ['builder'] }
  const lines = shown(sayWhatTheGateDoes({ members: MEMBERS, gate, crew, member: 'builder' }))
  assert.equal(lines.length, 2)
  assert.match(lines[0]!, /^2026-11-13T21:00:00\.000Z {2}A4 {2}no sender Martha could attribute {2}Bash: Nothing executes in this session/)
  assert.match(lines[1]!, /A2 .* Write: Nothing executes/)
})

test('#321: --member for a member the declaration does not know is refused by name', (t) => {
  const gate: GateSetting = { kind: 'off' }
  const gate_shown = sayWhatTheGateDoes({ members: MEMBERS, gate, crew: aCrewsPlace(t), member: 'nobody' })
  assert.equal(gate_shown.shown, false)
  assert.match((gate_shown as { refusal: string }).refusal, /does not know nobody/)
})

test('#321: an audit file that cannot be read is a refusal, never a member shown as quiet', (t) => {
  const crew = aCrewsPlace(t)
  writeFileSync(join(crew, GATE_AUDIT_PLACE, 'builder.jsonl'), 'not a line of json\n', { mode: 0o600 })
  const gate: GateSetting = { kind: 'named', enforced: [], audited: ['builder'] }
  const gate_shown = sayWhatTheGateDoes({ members: MEMBERS, gate, crew })
  assert.equal(gate_shown.shown, false)
  assert.match((gate_shown as { refusal: string }).refusal, /not a would-be refusal/)
})
