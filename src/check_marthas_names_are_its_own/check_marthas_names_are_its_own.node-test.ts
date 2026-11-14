// What the check's bite rests on (martha#468): a planted tree holding one name of every kind the inventory lists, judged
// by the same path the run CI makes uses, and four mutants killed on the assertion rather than on the output.
//
// The mutants, each named in its test's title:
//   - the table emptied: the planted names must stop being found, so it is the table that catches them;
//   - a file kind dropped from the read: the name planted in a JSON or a shell script must go missing;
//   - the anchored family read against a comment, which is not code: it must stay silent;
//   - a template piece read as its head alone: the anchored family must let it through, and a RUNS ON row must catch
//     it, which is the case `crew_channel_taken` showed (design r=4).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { findingsIn, isAFileTheCheckReads } from './findings_in.ts'
import { judgeTree } from './judge_a_tree.ts'
import { CREW_CODE_NAMES } from './the_crew_code_names.ts'
import { EXCEPTIONS, type DeclaredException } from './the_exceptions.ts'

/** A tree a test owns, holding `files` by their path under it, removed when the test ends. */
const plantedTree = (t: TestContext, files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), 'martha-468-names-'))
  t.after(() => removeTheTree(root))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

// One name of every kind the inventory lists, each planted where a file of that kind is read: a path and a tool in a
// source, a marker in a shell script, a variable in a JSON document, and a server prefix in a source again.
const A_NAME_OF_EVERY_KIND: Readonly<Record<string, string>> = {
  'src/planted.ts': [
    "export const declaration = '.crew'",
    "export const tool = 'report_progress'",
    "export const call = 'mcp__crew__probe'",
  ].join('\n'),
  'scripts/planted.sh': "git add .crew/crew.json # CREW-HANDOVER-WRITTEN\n",
  'fixtures/planted.json': '{"limit": "CREW_DIR"}\n',
}

test('every kind of name the inventory lists is a finding at its own file and line', (t) => {
  const root = plantedTree(t, A_NAME_OF_EVERY_KIND)
  // No exceptions: the shipped list belongs to Martha's own tree and would only go stale against this one.
  const judged = judgeTree(root, [])
  assert.deepEqual(
    judged.findings.map((finding) => `${finding.path}:${finding.line}:${finding.text}`).sort(),
    [
      // A source is read as the parser reads it, so its names are the ones the code holds; a shell script and a JSON
      // document have no parser, so each name there is found where it stands whole — one shell line holding three.
      'fixtures/planted.json:1:CREW_DIR',
      'scripts/planted.sh:1:.crew',
      'scripts/planted.sh:1:CREW-HANDOVER-WRITTEN',
      'scripts/planted.sh:1:crew.json',
      'src/planted.ts:1:.crew',
      'src/planted.ts:2:report_progress',
      'src/planted.ts:3:mcp__crew__probe',
    ].sort(),
  )
})

test('a tree that spells none of them is clean, and its files are counted', (t) => {
  const root = plantedTree(t, { 'src/quiet.ts': "export const own = 'martha.json'\n", 'docs/quiet.md': '.crew\n' })
  const judged = judgeTree(root, [])
  assert.deepEqual(judged.findings, [])
  assert.deepEqual(judged.stale, [])
  // The prose and the pictures are not read, so only the source counts.
  assert.equal(judged.files, 1)
})

test('a tree the check could not look in reads no file at all, which is never a pass', (t) => {
  const root = plantedTree(t, { 'docs/only-prose.md': '.crew\n' })
  assert.equal(judgeTree(root, []).files, 0)
})

test('the table is what catches the names (mutant: the table emptied)', (t) => {
  const root = plantedTree(t, A_NAME_OF_EVERY_KIND)
  assert.deepEqual(judgeTree(root, [], []).findings, [], 'the planted names were found without a table to hold them')
})

test('a file kind the read drops takes its name with it (mutant: only sources read)', (t) => {
  const root = plantedTree(t, A_NAME_OF_EVERY_KIND)
  const sourcesOnly = (path: string): boolean => path.endsWith('.ts')
  const found = judgeTree(root, [], CREW_CODE_NAMES, sourcesOnly).findings.map((finding) => finding.path)
  assert.ok(!found.includes('fixtures/planted.json'), 'the JSON name was found with the JSON no longer read')
  assert.ok(!found.includes('scripts/planted.sh'), 'the shell name was found with the shell no longer read')
  assert.ok(found.includes('src/planted.ts'), 'the source name went missing too, so this proves nothing about the drop')
})

test('a name in a comment is not a name in code, and stays silent (mutant: the family read against a comment)', () => {
  // A comment has no node, so the parser never offers it: this is the difference between a name spelled in code and a
  // name a person writes about one, which the inventory must be free to do.
  assert.deepEqual(findingsIn('src/a_comment.ts', '// crew_roster is crew-code\'s tool\nconst own = 1\n'), [])
})

test('a string literal naming one trips, and the anchored family lets a template piece through to a RUNS ON row', () => {
  assert.deepEqual(
    findingsIn('src/a_literal.ts', "const name = 'crew_roster'\n").map((finding) => finding.text),
    ['crew_roster'],
  )
  // The anchored family sees `crew_roster/`, not `crew_roster`, so a template is caught only where the table names the
  // piece it runs on from — which is why the inventory holds `crew_channel_taken` as a RUNS ON row.
  assert.deepEqual(findingsIn('src/a_template.ts', 'const path = `crew_roster/${member}`\n'), [])
  assert.deepEqual(
    findingsIn('src/a_template.ts', 'const path = `crew_channel_taken/${member}`\n').map((finding) => finding.text),
    ['crew_channel_taken/'],
  )
})

test('an exception excuses one file and one name, and one that excuses nothing is a finding', (t) => {
  const root = plantedTree(t, { 'src/planted.ts': "export const tool = 'report_progress'\n" })
  const elsewhere: readonly DeclaredException[] = [{ path: 'src/elsewhere.ts', text: 'report_progress', reason: 'a test', removed_by: 'a test' }]
  const anotherName: readonly DeclaredException[] = [{ path: 'src/planted.ts', text: 'crew_other', reason: 'a test', removed_by: 'a test' }]
  const held: readonly DeclaredException[] = [{ path: 'src/planted.ts', text: 'report_progress', reason: 'a test', removed_by: 'a test' }]
  assert.deepEqual(judgeTree(root, held).findings, [])
  assert.deepEqual(judgeTree(root, held).stale, [])
  // The same exception against another file, or for another name, matches nothing: it is reported, and the plant stands.
  assert.equal(judgeTree(root, elsewhere).stale.length, 1)
  assert.equal(judgeTree(root, elsewhere).findings.length, 1)
  assert.equal(judgeTree(root, anotherName).stale.length, 1)
  assert.equal(judgeTree(root, anotherName).findings.length, 1)
})

test('the run exits 1 when a stale exception is the only fault (mutant: count findings alone)', (t) => {
  // The stale rule is judged by ./judge_a_tree.ts, but the exit code is decided in ./main.ts, and a test that only reads
  // the verdict would say nothing about the command CI runs. A tree spelling no name of crew-code's still has the
  // shipped exception list to answer for: every entry of it excuses nothing here, so the run must be red all the same.
  const root = plantedTree(t, { 'src/quiet.ts': 'export const own = 1\n' })
  const run = spawnSync(process.execPath, [join(import.meta.dirname, 'main.ts'), '--root', root], { encoding: 'utf8' })
  assert.equal(run.stderr.match(/is excused by nothing/g)?.length, EXCEPTIONS.length, `every shipped exception should be named as stale:\n${run.stderr}`)
  assert.equal(run.status, 1, `the run answered ${String(run.status)} on a stale exception alone:\n${run.stderr}`)
})

test('the kinds of file the run reads are the sources, the JSON, the JSONL and the shell scripts', () => {
  for (const path of ['src/a.ts', 'src/a.tsx', 'a.json', 'a.jsonl', 'a.sh']) assert.equal(isAFileTheCheckReads(path), true, path)
  for (const path of ['README.md', 'assets/a.svg', 'a.txt', 'a.yaml']) assert.equal(isAFileTheCheckReads(path), false, path)
})
