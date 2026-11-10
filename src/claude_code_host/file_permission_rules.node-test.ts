// Which rules the host's file permission checks actually match, cut from a host's own statement (martha#226).
//
// A rule written under a tool the checks never use is written and never matched, so the guard has to write its rules
// under the tool the host maps a file write to, and read the host's own complaint about one it would ignore. Neither
// name is this repository's: the mapping comes from the statement the recording carries.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE_FILE_RULE_TOOL, RECORDED_HOST } from './recorded_claude_code_host.ts'
import { filePermissionRulesIn, ruleMatchersIn, theToolItsChecksMatch } from './file_permission_rules.ts'

/** A host text shaped as the bundle holds it, with the statement that decides which rules its checks match. */
const A_HOST = (statement: string): string =>
  `var y=p(()=>md());if(s.ruleContent!==void 0){${statement}if(g!==void 0&&!s.ruleContent.includes(":*"))return{valid:!0,warning:\`\${yn(s)} is not matched by file permission checks — only \${g}(path) rules are.\`,...n!=="allow"&&{securityNotice:\`\${yn(s)} never matches · use \${yn({toolName:g})}\`}}}return{valid:!0}`

test('the statement is cut from the host text, whole, with nothing typed around it', () => {
  const statement = 'let g=s.toolName==="Write"?"Edit":void 0;'
  assert.deepEqual(filePermissionRulesIn(A_HOST(statement)), { matcher: statement })
  // A host that words the complaint differently, or holds two statements, is no host this reads.
  assert.throws(() => filePermissionRulesIn('a host with no complaint at all'), /not once/)
  assert.throws(() => filePermissionRulesIn(`${A_HOST(statement)}${A_HOST(statement)}`), /not once/)
  assert.throws(() => filePermissionRulesIn(A_HOST('let g=void 0;')), /holds no tool mapping/)
})

test('each tool name the statement covers is checked as the tool it names, and one it does not cover as itself', () => {
  const recorded = ruleMatchersIn(RECORDED_HOST.file_permission_rules.matcher)
  // The recorded host's own answer, written out here rather than read from the mapping: a re-recording that changes it
  // fails this test until someone says so (martha#226).
  assert.deepEqual(recorded, { Write: 'Edit', NotebookEdit: 'Edit', MultiEdit: 'Edit', Glob: 'Read' })
  assert.equal(theToolItsChecksMatch(recorded, 'Write'), 'Edit')
  assert.equal(theToolItsChecksMatch(recorded, 'Edit'), 'Edit')
  assert.equal(theToolItsChecksMatch(recorded, 'Bash'), 'Bash')
})

test('a statement that maps nothing, or that ends by checking an unlisted tool as itself, is refused', () => {
  assert.throws(() => ruleMatchersIn('let g=void 0;'), /maps no tool/)
  assert.throws(() => ruleMatchersIn('let g=s.toolName==="Write"?"Edit":s.toolName;'), /does not end/)
  assert.throws(() => ruleMatchersIn('function g(){}'), /not a statement this reads/)
})

test('the tool a rule that refuses a write is written under is the recorded host\'s own answer (#226)', () => {
  // Literal on purpose: this is the one place the answer stands written down, so a host that maps a write elsewhere
  // fails here rather than quietly changing what every launch writes.
  assert.equal(CLAUDE_CODE_FILE_RULE_TOOL, 'Edit')
})
