// The rule of martha#289 bites, and stays quiet where a word is only a word.
//
// Each case plants its own sources, so nothing here depends on the tree, and the
// five ways a change can introduce a copy are each named: a new literal, a
// constant the change adds, a value it renames, a local redefinition, and an
// exception that no longer matches anything.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  exceptionsNotHeld,
  GONE,
  lineOfAFinding,
  literalSitesJudged,
  pathSegmentsOf,
  restatementsIn,
  type DefinedByTheChange,
  type Exception,
} from './no_literal_restates_a_value.ts'

const source = (path: string, text: string) => ({ path, text })
const place = (path: string, line: number) => `${path}:${line}`

/** Every line of a source as judged, for the cases that judge the whole of it. */
const everyLine = (...sources: readonly { path: string; text: string }[]): Set<string> =>
  new Set(sources.flatMap((one) => one.text.split('\n').map((_line, index) => place(one.path, index + 1))))

const EXPORTER = source('a_tool/a_tool.ts', "export const TOOL = 'the-tool'\n")

test('a literal equal to an exported constant is named where it stands, with the constant to import', () => {
  const user = source('a_user/a_user.ts', "const run = () => call('the-tool')\n")

  const found = restatementsIn([EXPORTER, user], { judged: everyLine(user) })

  assert.deepEqual(found.map(lineOfAFinding), ["a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"])
  assert.equal(found[0]?.rule, 'restates_a_constant')
})

test('a literal on a line the change does not touch is left alone, and one the change adds is named', () => {
  const old = source('a_old/a_old.ts', "const name = 'the-tool'\n")
  const added = source('a_new/a_new.ts', "\nconst name = 'the-tool'\n")

  const found = restatementsIn([EXPORTER, old, added], { judged: everyLine(added) })

  assert.deepEqual(found.map((finding) => finding.path), ['a_new/a_new.ts'])
})

test('a value the change defines is judged over the whole tree, not only on its own lines (R1)', () => {
  const addedConstant = source('a_new/a_new.ts', "export const FRESH = 'a-fresh-value'\n")
  const copyElsewhere = source('a_old/a_old.ts', "const name = 'a-fresh-value'\n")
  const defined: DefinedByTheChange[] = [{ value: 'a-fresh-value', module: 'a_new/a_new.ts', name: 'FRESH' }]

  const found = restatementsIn([addedConstant, copyElsewhere], { judged: everyLine(addedConstant), defined })

  assert.deepEqual(found.map((finding) => finding.path), ['a_old/a_old.ts'])
  assert.equal(found[0]?.rule, 'restates_a_value_the_change_defines')
})

test('a value the change renames is still named where the OLD value was written (R1)', () => {
  const stillOld = source('a_old/a_old.ts', "const name = 'the-old-value'\n")
  const defined: DefinedByTheChange[] = [{ value: 'the-old-value', module: 'a_tool/a_tool.ts', name: 'TOOL' }]

  const found = restatementsIn([stillOld], { judged: new Set<string>(), defined })

  assert.deepEqual(found.map(lineOfAFinding), [`a_old/a_old.ts:1: 'the-old-value' restates a_tool/a_tool.ts TOOL ${GONE}`])
})

test('a definition that restates another module\'s exported value is named (R2)', () => {
  const privateCopy = source('a_copy/a_copy.ts', "const DEPENDENCIES = 'the-tool'\n")

  const found = restatementsIn([EXPORTER, privateCopy], { judged: everyLine(privateCopy) })

  assert.deepEqual(found.map(lineOfAFinding), ["a_copy/a_copy.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"])
  assert.equal(found[0]?.rule, 'defines_an_exported_value')
})

test('a second constant in the same module is not another module\'s copy, and the constant\'s own value is its definition', () => {
  const both = source('a_tool/a_tool.ts', "export const TOOL = 'the-tool'\nexport const AGAIN = 'the-tool'\n")

  assert.deepEqual(restatementsIn([both], { judged: everyLine(both) }), [])
})

test('a module specifier, a property name, a word below the minimum and a word used as data are not restatements', () => {
  const named = source('a_tool/a_tool.ts', "export const TOOL = 'the-tool'\nexport const SHORT = 'env'\n")
  const quiet = source(
    'a_user/a_user.ts',
    [
      "import { TOOL } from './a_tool/a_tool.ts'",
      "import { other } from 'the-tool'",
      "const settings = { 'the-tool': 1 }",
      "const id = 'env'",
    ].join('\n'),
  )

  assert.deepEqual(restatementsIn([named, quiet], { judged: everyLine(quiet) }), [])
})

test('a declared coincidence is left alone in its own file, and stays named in any other file', () => {
  const gitSubcommand = source('a_git/a_git.ts', "git(['config', 'user.email'])\n")
  const coincidence: Exception = { value: 'config', file: 'a_git/a_git.ts', reason: 'a git subcommand, not the owner-memory slice\'s file name' }
  const config = source('a_config/a_config.ts', "export const CONFIG = 'config'\n")

  assert.deepEqual(restatementsIn([config, gitSubcommand], { judged: everyLine(gitSubcommand), exceptions: [coincidence] }), [])
  assert.equal(restatementsIn([config, source('other/other.ts', "const name = 'config'\n")], { judged: everyLine(source('other/other.ts', "const name = 'config'\n")), exceptions: [coincidence] }).length, 1)
})

test('an exception that matches nothing, carries no reason, or repeats another is an error itself', () => {
  const gitSubcommand = source('a_git/a_git.ts', "git(['config', 'user.email'])\n")
  const config = source('a_config/a_config.ts', "export const CONFIG = 'config'\n")
  const live: Exception = { value: 'config', file: 'a_git/a_git.ts', reason: 'a git subcommand' }

  assert.deepEqual(exceptionsNotHeld([config, gitSubcommand], [live]), [])
  assert.deepEqual(
    exceptionsNotHeld([config, gitSubcommand], [
      { ...live, value: 'a-value-that-left-the-file' },
      { ...live, file: 'a_git/a_git.ts', reason: '  ' },
      { ...live, value: 'config', file: 'another/file.ts' },
    ]).length,
    3,
  )
  assert.deepEqual(exceptionsNotHeld([config, gitSubcommand], [live, live]).length, 1, 'the second entry repeats the first')
})

test('the number of sites judged is the literals on those lines, so a gate can say what it looked at', () => {
  const two = source('a_user/a_user.ts', "const one = 'the-tool'\nconst two = 'another'\n")

  assert.equal(literalSitesJudged([two], everyLine(two)), 2)
  assert.equal(literalSitesJudged([two], new Set([place(two.path, 1)])), 1)
  assert.equal(literalSitesJudged([two], new Set([place(two.path, 9)])), 0)
})

test('the whole tree, judged everywhere, names every copy and nothing else', () => {
  const tree = [
    EXPORTER,
    source('a_user/a_user.ts', "const name = 'the-tool'\n"),
    source('a_copy/a_copy.ts', "const private_name = 'the-tool'\n"),
  ]

  const found = restatementsIn(tree, { judged: null })

  assert.deepEqual(found.map((finding) => `${finding.path}:${finding.line}`), ['a_copy/a_copy.ts:1', 'a_user/a_user.ts:1'])
})

test('a literal in a type position names a type, not a value, and a value beside it is still named (rule 1 of part b)', () => {
  const typed = source('a_user/a_user.ts', "type T = 'the-tool' | 'other-word'\nconst k: { readonly kind: 'the-tool' } = make()\ncall('the-tool')\n")

  assert.deepEqual(restatementsIn([EXPORTER, typed], { judged: null }).map(lineOfAFinding), ["a_user/a_user.ts:3: 'the-tool' restates a_tool/a_tool.ts TOOL"])
})

test('a literal that names a property at the use site is skipped like a declared name (rule 2 of part b)', () => {
  const used = source('a_user/a_user.ts', "const has = 'the-tool' in record\nconst got = record['the-tool']\ncall('the-tool')\nconst odd = key in 'the-tool'\n")

  assert.deepEqual(restatementsIn([EXPORTER, used], { judged: null }).map(lineOfAFinding), [
    "a_user/a_user.ts:3: 'the-tool' restates a_tool/a_tool.ts TOOL",
    "a_user/a_user.ts:4: 'the-tool' restates a_tool/a_tool.ts TOOL",
  ], 'only the left side of `in` names a property')
})

test('a constant annotated with a named type is an alias of that type\'s member, not a value to import (rule 3 of part b)', () => {
  const alias = source('a_tool/a_tool.ts', "export const THE_TAG: Tag = 'the-tag'\n")
  const plain = source('a_tool/a_tool.ts', "export const THE_TAG = 'the-tag'\n")
  const user = source('a_user/a_user.ts', "send({ tag: 'the-tag' })\n")

  assert.deepEqual(restatementsIn([alias, user], { judged: null }), [])
  assert.deepEqual(restatementsIn([plain, user], { judged: null }).map(lineOfAFinding), ["a_user/a_user.ts:1: 'the-tag' restates a_tool/a_tool.ts THE_TAG"])
  const keyword = source('a_tool/a_tool.ts', "export const THE_TAG: string = 'the-tag'\n")
  assert.deepEqual(restatementsIn([keyword, user], { judged: null }).map(lineOfAFinding), ["a_user/a_user.ts:1: 'the-tag' restates a_tool/a_tool.ts THE_TAG"], 'a keyword type names no member, so the constant still holds the value')
})

test('an alias that copies another module\'s exported value is still a copy (rule 3 keeps R2)', () => {
  const alias = source('a_alias/a_alias.ts', "export const COPY: Tag = 'the-tool'\n")

  assert.deepEqual(restatementsIn([EXPORTER, alias], { judged: null }).map(lineOfAFinding), ["a_alias/a_alias.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"])
})

test('an exception whose literal is no finding any more matches nothing, and is an error itself', () => {
  const config = source('a_config/a_config.ts', "export const CONFIG = 'config'\n")
  const typeOnly = source('a_git/a_git.ts', "type Sub = 'config' | 'push'\n")
  const entry: Exception = { value: 'config', file: 'a_git/a_git.ts', reason: 'a git subcommand' }

  assert.deepEqual(exceptionsNotHeld([config, typeOnly], [entry]), [entry])
  assert.deepEqual(exceptionsNotHeld([typeOnly], [entry]), [entry], 'no constant holds the value, so nothing needs excusing')
})

// A change that adds an exported constant a holder in another module already holds made a second copy, and the
// copy is the NEW line: before, the change's own definition was never judged, so the finding fell on the old
// holder, where that file's exception excused it (martha#289 part b, stage 2).
const A_SECOND_HOLDER = source('a_new/a_new.ts', "export const AGAIN = 'the-tool'\n")
const ADDS_A_SECOND_HOLDER: DefinedByTheChange[] = [{ value: 'the-tool', module: 'a_new/a_new.ts', name: 'AGAIN' }]

test('a new exported definition of a value another module still holds is named on the NEW line, and the old file\'s exception does not excuse it', () => {
  const oldFileExcused: Exception = { value: 'the-tool', file: 'a_tool/a_tool.ts', reason: 'a word of its own in the old file' }

  const found = restatementsIn([EXPORTER, A_SECOND_HOLDER], { judged: everyLine(A_SECOND_HOLDER), defined: ADDS_A_SECOND_HOLDER, exceptions: [oldFileExcused] })

  assert.deepEqual(found.map(lineOfAFinding), ["a_new/a_new.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"])
  assert.equal(found[0]?.rule, 'defines_an_exported_value')
})

test('a planted coincidence: only an exception in the NEW file excuses a second holder, and the old holder is never named for it', () => {
  const newFileExcused: Exception = { value: 'the-tool', file: 'a_new/a_new.ts', reason: 'the same word, meaning something else here' }

  assert.deepEqual(restatementsIn([EXPORTER, A_SECOND_HOLDER], { judged: everyLine(A_SECOND_HOLDER), defined: ADDS_A_SECOND_HOLDER, exceptions: [newFileExcused] }), [])
})

test('a move is unchanged: the constant leaves one module for another, and nothing is named', () => {
  const movedTo = source('a_new/a_new.ts', "export const TOOL = 'the-tool'\n")
  const defined: DefinedByTheChange[] = [{ value: 'the-tool', module: 'a_new/a_new.ts', name: 'TOOL' }, { value: 'the-tool', module: 'a_tool/a_tool.ts', name: 'TOOL' }]

  assert.deepEqual(restatementsIn([movedTo], { judged: everyLine(movedTo), defined }), [])
})

// A value written out inside a longer path literal restates it as surely as the bare value (martha#437): the
// recorded-host test of #390 wrote `'.git/config'` and the check found nothing.
const CONFIG_HOLDER = source('a_config/a_config.ts', "export const CONFIG = 'config'\n")

test('a constant written as a whole segment of a path literal is named, with the constant and its source (martha#437)', () => {
  const user = source('a_user/a_user.ts', "const at = join(checkout, '.git/config')\n")

  const found = restatementsIn([CONFIG_HOLDER, user], { judged: everyLine(user) })

  assert.deepEqual(found.map(lineOfAFinding), ["a_user/a_user.ts:1: 'config' (a path segment) restates a_config/a_config.ts CONFIG"])
  assert.equal(found[0]?.rule, 'restates_a_constant')
  assert.equal(found[0]?.segment, true)
})

test('only a path separator splits a literal: a constant inside prose, or inside a longer segment, stays a word (martha#437)', () => {
  const prose = source('a_user/a_user.ts', "say('read the config before the run')\nsay('a_config_file/other')\nsay('.git/configs')\n")

  assert.deepEqual(restatementsIn([CONFIG_HOLDER, prose], { judged: null }), [])
})

test('the segments of a literal: split on the separator only, each distinct, never the literal itself, never shorter than a value', () => {
  assert.deepEqual(pathSegmentsOf('.git/config'), ['.git', 'config'])
  assert.deepEqual(pathSegmentsOf('node_modules/.bin/one && node_modules/.bin/two'), ['node_modules', '.bin', 'one && node_modules'], 'each segment once, the short ones dropped')
  assert.deepEqual(pathSegmentsOf('read the config'), [], 'no separator, no segment')
  assert.deepEqual(pathSegmentsOf('a/b/id'), [], 'every segment shorter than a value')
})

test('a definition holding another module\'s constant as a path segment is named too, and a declared coincidence excuses it in its own file (martha#437)', () => {
  const definer = source('a_git/a_git.ts', "export const GIT_CONFIG = '.git/config'\n")
  const coincidence: Exception = { value: 'config', file: 'a_git/a_git.ts', reason: 'git\'s own file, named by git' }

  assert.deepEqual(restatementsIn([CONFIG_HOLDER, definer], { judged: null }).map(lineOfAFinding), ["a_git/a_git.ts:1: 'config' (a path segment) restates a_config/a_config.ts CONFIG"])
  assert.deepEqual(restatementsIn([CONFIG_HOLDER, definer], { judged: null, exceptions: [coincidence] }), [])
})

test('a value the change takes away is judged over the whole tree inside path literals too (R1, martha#437)', () => {
  const old = source('a_old/a_old.ts', "const at = '.git/config'\n")
  const defined: DefinedByTheChange[] = [{ value: 'config', module: 'a_config/a_config.ts', name: 'CONFIG' }]

  assert.deepEqual(restatementsIn([old], { judged: new Set(), defined }).map(lineOfAFinding), [`a_old/a_old.ts:1: 'config' (a path segment) restates a_config/a_config.ts CONFIG ${GONE}`])
})

test('a literal that is exactly the path of a source the check reads names that file, so its segments are not judged, and any other path still is (martha#437, r=1)', () => {
  const tool = source('a_crews_tools/a_crews_tools.ts', "export const WAKE_IT = 'wake_it'\n")
  const slice = source('wake_it/wake_it.ts', "export const run = () => 0\n")
  const coincidences = source('wake_it/coincidences.ts', "export const COINCIDENCES = [{ value: 'x', file: 'wake_it/wake_it.ts', reason: 'r' }]\nconst notes = 'wake_it/notes.md'\n")

  assert.deepEqual(restatementsIn([tool, slice, coincidences], { judged: null }).map(lineOfAFinding), [
    "wake_it/coincidences.ts:2: 'wake_it' (a path segment) restates a_crews_tools/a_crews_tools.ts WAKE_IT",
  ])
})
