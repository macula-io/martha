// The gate's audit never becomes a turn (martha#321).
//
// The audit holds, per audited call, which path text arrived on and who sent it, and the gate's own refusal. Nothing in
// it is safe to put back in front of a model: a file that reached a session's record through a reader would be the very
// text the gate stopped. So this holds the other direction of the design's promise — the audit is not an inbound path —
// mechanically: only the five places below may name the audit at all, and none of them takes anything into a turn.
//
//   - the audit's own slice, which writes and reads its lines;
//   - ../say_what_the_gate_does, which reads them for the owner and for nobody else;
//   - ../start_a_member, which makes the crew's folder for it beside the dashboard's own;
//   - ../answer_a_tool_call, which writes the line before an audited call runs;
//   - ../launch_a_claude_code_member, which hands that folder from the launch to the relay as a place.
//
// A sixth file naming the audit fails here by name, before anybody has to notice it in review.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { moduleReferencesOf } from '../../prove_the_core/parse_a_source.ts'

/** The repository, from this file: src/audit_the_gate_for_a_member/<this file>. */
const REPOSITORY = join(import.meta.dirname, '..', '..')

/** The audit's own directory name, as another file would write it in a specifier. */
const THE_AUDIT = 'audit_the_gate_for_a_member'

/** The directories that may name the audit, relative to the repository. */
const MAY_NAME_THE_AUDIT: readonly string[] = [
  'src/audit_the_gate_for_a_member/',
  'src/say_what_the_gate_does/',
  'src/start_a_member/',
  'src/answer_a_tool_call/',
  'src/launch_a_claude_code_member/',
]

/** The lines of one source's imports that name the audit, each as `<path>:<line>`. */
function auditReferencesIn(path: string): readonly string[] {
  return moduleReferencesOf(readFileSync(path, 'utf8'), path)
    .filter((reference) => reference.specifier !== null && reference.specifier.includes(THE_AUDIT))
    .map((reference) => `${path.slice(REPOSITORY.length + 1)}:${String(reference.line)}`)
}

/** The sources under src/ that are code rather than a test. */
function sourcePaths(): readonly string[] {
  return readdirSync(join(REPOSITORY, 'src'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.node-test.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

/** Every source under src/ that names the audit, with the line it does. */
function sourcesThatNameTheAudit(): readonly string[] {
  return sourcePaths().flatMap(auditReferencesIn)
}

test('#321: only the audit, the reading of it and the places that make its folder name the audit', () => {
  const naming = sourcesThatNameTheAudit()
  assert.ok(naming.length > 0, 'nothing names the audit, so this check would pass on a tree with no audit at all')
  const outside = naming.filter((where) => !MAY_NAME_THE_AUDIT.some((directory) => where.startsWith(directory)))
  assert.deepEqual(outside, [], 'a source that may not read the audit names it')
})
