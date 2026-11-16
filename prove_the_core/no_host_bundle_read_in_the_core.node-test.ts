import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CLAUDE_CODE_ANSWER_FIELDS } from '../src/read_what_claude_code_says_of_an_agent/the_agent_calls_answer.ts'
import { coreSources } from './core_sources.ts'
import { manifestOf, programsAndTheirPartsOf, testSuffixesOf } from './declared_in_package_json.ts'
import { CUTS_A_BUNDLE, hostReadsInTheCore, lineOfAHostRead, READS_AN_ANSWER, type WhatIsNotASlice } from './no_host_bundle_read_in_the_core.ts'
import { declaredHostGlue } from './only_the_launcher_writes_launch_records.ts'

const repository = join(import.meta.dirname, '..')
const manifest = manifestOf(repository)

/** What the tree declares is no slice, and the fields the Claude Code host's answers carry. */
const NOT_A_SLICE: WhatIsNotASlice = {
  host_directories: [...declaredHostGlue(repository), ...declaredHostGlue(repository, 'hostAdapters')],
  test_suffixes: testSuffixesOf(manifest),
  programs: programsAndTheirPartsOf(manifest),
  answer_fields: CLAUDE_CODE_ANSWER_FIELDS,
}

interface Planted {
  readonly caught: Readonly<Record<string, string>>
  readonly quiet: readonly string[]
  readonly not_judged: readonly string[]
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_host_bundle_reads.json'), 'utf8')) as Planted

/** The answer's fields are in the list a planted read is named by, so the planted reads test the list the tree uses. */
const ANSWER_CASE = /^the answer's field/

test('no core slice cuts a host\'s bundle or reads the shape of a host\'s answer (martha#463)', () => {
  const found = hostReadsInTheCore(coreSources(join(repository, 'src')), NOT_A_SLICE)
  assert.deepEqual(found.map(lineOfAHostRead), [])
})

test('every planted read in a core slice is named on its line, for the reason it is the host\'s (martha#463)', () => {
  const cases = Object.entries(planted.caught).map(([kind, text], index) => ({ kind, path: join(`planted_${index}`, 'planted.ts'), text }))
  const found = hostReadsInTheCore(cases, NOT_A_SLICE)
  for (const { kind, path } of cases) {
    const here = found.filter((read) => read.path === path)
    assert.deepEqual([...new Set(here.map((read) => read.line))], [1], kind)
    assert.deepEqual([...new Set(here.map((read) => read.why))], [ANSWER_CASE.test(kind) ? READS_AN_ANSWER : CUTS_A_BUNDLE], kind)
  }
})

test('an identifier\'s own shape, a plain word, a comment and another field are left alone (martha#463)', () => {
  const sources = planted.quiet.map((text, index) => ({ path: join(`quiet_${index}`, 'quiet.ts'), text }))
  assert.deepEqual(hostReadsInTheCore(sources, NOT_A_SLICE).map(lineOfAHostRead), [])
})

test('a host adapter, a program, a test and a coincidence file are not judged, as the core\'s other rules do not judge them (martha#463)', () => {
  const texts = Object.values(planted.caught)
  const sources = planted.not_judged.flatMap((path) => texts.map((text) => ({ path: join(...path.split('/')), text })))
  assert.deepEqual(hostReadsInTheCore(sources, NOT_A_SLICE).map(lineOfAHostRead), [])
})
