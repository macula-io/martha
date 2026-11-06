// The structural floor bites (martha#87). eslint.config.mjs names the caps once: how deep a function may nest,
// how many ways it may branch, how many lines it may run. This reads them back from eslint's own resolved config
// for a source file, never restating a number, and plants a function at each cap and one step over it. The one
// at the cap passes; the one over fails, naming its rule. A function over a cap with an eslint-disable comment
// still fails: the floor has no exception carried in the code. CI runs the floor over the whole tree
// (`npm run lint`); this proves that run is not vacuous.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { ESLint, type Linter } from 'eslint'

const repository = join(import.meta.dirname, '..')
const eslint = new ESLint({ cwd: repository })
// A path inside the core, so the planted code is judged by the config the core is judged by.
const PLANTED = 'src/planted_by_the_floor_test/planted.ts'

const DEPTH = 'max-depth'
const COMPLEXITY = 'complexity'
const LENGTH = 'max-lines-per-function'
const ERROR = 2

interface Cap {
  readonly max: number
  readonly skipBlankLines?: boolean
  readonly skipComments?: boolean
}

const capOf = (rules: Partial<Linter.RulesRecord>, rule: string): Cap => {
  const entry = rules[rule]
  assert.ok(Array.isArray(entry), `${rule} is not configured with a cap`)
  assert.equal(entry[0], ERROR, `${rule} is not an error`)
  const options = entry[1] as Cap | undefined
  assert.equal(typeof options?.max, 'number', `${rule} names no maximum`)
  return options!
}

const capsOf = async () => {
  const config = (await eslint.calculateConfigForFile(join(repository, PLANTED))) as Linter.Config
  const rules = config.rules ?? {}
  return { depth: capOf(rules, DEPTH), complexity: capOf(rules, COMPLEXITY), length: capOf(rules, LENGTH) }
}

const rulesBrokenBy = async (code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: join(repository, PLANTED) })
  return result!.messages.filter((message) => message.severity === ERROR).map((message) => message.ruleId ?? message.message)
}

// `levels` ifs, each inside the one before.
const nested = (levels: number) =>
  `export function planted(a: boolean): number {\n${'  if (a) {\n'.repeat(levels)}  return 1\n${'  }\n'.repeat(levels)}  return 0\n}\n`

// A function whose cyclomatic complexity is `complexity`: one path plus one per if, side by side.
const branching = (complexity: number) =>
  `export function planted(a: number): number {\n${Array.from({ length: complexity - 1 }, (_, at) => `  if (a === ${at}) return ${at}\n`).join('')}  return -1\n}\n`

// A function `lines` lines long, header and closing brace included, with blank and comment lines between that the
// cap does not count.
const long = (lines: number) =>
  `export function planted(): number {\n  let total = 0\n${'\n  // not counted\n  total += 1\n'.repeat(lines - 4)}  return total\n}\n`

test('eslint.config.mjs caps nesting, complexity and length at error, each with a maximum', async () => {
  const caps = await capsOf()
  assert.equal(caps.length.skipBlankLines, true, 'the length cap counts blank lines')
  assert.equal(caps.length.skipComments, true, 'the length cap counts comments')
})

test('a function nested one level past the cap fails by name; one at the cap passes', async () => {
  const { depth } = await capsOf()
  assert.deepEqual(await rulesBrokenBy(nested(depth.max)), [])
  assert.deepEqual(await rulesBrokenBy(nested(depth.max + 1)), [DEPTH])
})

test('a function one branch past the complexity cap fails by name; one at the cap passes', async () => {
  const { complexity } = await capsOf()
  assert.deepEqual(await rulesBrokenBy(branching(complexity.max)), [])
  assert.deepEqual(await rulesBrokenBy(branching(complexity.max + 1)), [COMPLEXITY])
})

test('a function one line past the length cap fails by name; one at the cap passes, blank lines and comments aside', async () => {
  const { length } = await capsOf()
  assert.deepEqual(await rulesBrokenBy(long(length.max)), [])
  assert.deepEqual(await rulesBrokenBy(long(length.max + 1)), [LENGTH])
})

test('an eslint-disable comment does not lift a cap: the floor has no exception in the code', async () => {
  const { complexity } = await capsOf()
  const disabled = `/* eslint-disable */\n// eslint-disable-next-line ${COMPLEXITY}\n${branching(complexity.max + 1)}`
  assert.deepEqual(await rulesBrokenBy(disabled), [COMPLEXITY])
})
