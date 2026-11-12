// The page's denials are held to the code (martha#323). The page says what runs and, more
// often, what does not. c4_diagrams.node-test.ts holds the pictures and the directories they
// leave out; this holds the words around them, so a sentence that denies something runs fails
// by name the day the code says otherwise. The test only reads, and writes nothing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'

const HERE = import.meta.dirname
const README = readFileSync(join(HERE, 'README.md'), 'utf8')
const SRC = join(HERE, '..', 'src')

// Every directory under src/ a module of this process loads, by the resolve hook below. The hook
// has to be registered before the walk, and the walk before any other import of src/: a module
// already loaded resolves no hook again, so a slice imported above would be missing from the set
// and would read as one a launch does not load.
const loadedFromSrc = new Set<string>()
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context)
    const slice = /\/src\/([^/]+)\//.exec(resolved.url)?.[1]
    if (slice !== undefined) loadedFromSrc.add(slice)
    return resolved
  },
})

/** What `martha` itself loads, read once, before any other slice is imported for its names. */
const LAUNCH_LOADS: ReadonlySet<string> = await (async () => {
  await import('../src/run_the_martha_command/run_the_martha_command.ts')
  return new Set(loadedFromSrc)
})()

// The names are read from the code, never spelled here: the day a tool is registered, or a
// denied slice is loaded by a launch, it is the page's own sentence that has to change. The list
// is widened to strings so the check reads a count the compiler has not already fixed: a page
// held to the number a tuple happens to have today would pass a package that never re-read it.
const { CREW_TOOL_NAMES } = await import('../src/a_crews_tools/a_crews_tools.ts')
const REGISTERED: readonly string[] = CREW_TOOL_NAMES

const slicesInSrc = (): readonly string[] =>
  readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

const BACKTICKED = /`([^`]+)`/g
const namedOn = (line: string): readonly string[] =>
  [...line.matchAll(BACKTICKED)].flatMap((found) => (found[1] === undefined ? [] : [found[1]]))

/**
 * A sentence is the unit of a claim, so the names a denial covers are the ones in its own sentence:
 * a table row may name the glue it does load beside a part it does not. Split on the full stop that
 * ends a sentence, and on lines, which end one just as well.
 */
const sentencesOf = (page: string): readonly string[] =>
  page.split('\n').flatMap((line) => line.split(/(?<=\.)\s+/))

/**
 * The wordings the page uses to deny that something runs. A line carrying one makes a claim about
 * every name it puts in backticks, and this list is the check's bound: a denial worded in a way it
 * does not know is a reviewer's to catch, not the test's.
 */
const DENIES_RUNNING: readonly RegExp[] = [
  /registers no (?:worktree )?tool/,
  /cannot call (?:them|it) yet/,
  /no launch loads/,
  /never loads it/,
  /nothing that runs loads/,
]

/** A claim that the launcher registers no tool at all, which any registered name makes false. */
const REGISTERS_NO_TOOL = /registers no tool\b/

/** The status block: the blockquote lines under the page's title, up to the first line that is not one. */
const statusBlock = (): readonly string[] => {
  const lines = README.split('\n')
  const start = lines.findIndex((line) => line.startsWith('>'))
  const end = lines.findIndex((line, at) => at > start && !line.startsWith('>'))
  return start === -1 ? [] : lines.slice(start + 1, end === -1 ? lines.length : end)
}

test('the page does not say the launcher registers no tool while the launcher registers some', () => {
  const denied = README.split('\n').filter((line) => REGISTERS_NO_TOOL.test(line))
  const wrong = REGISTERED.length === 0
    ? []
    : denied.map((line) => `the page says "${line.trim()}", and CREW_TOOL_NAMES registers ${REGISTERED.length} (${REGISTERED.join(', ')})`)
  assert.deepEqual(wrong, [],
    `the page denies a tool is registered that the launcher answers; bring the words and the code back together:\n${wrong.join('\n')}`)
})

test('the status block names what runs, and every slice it names is one a launch loads', () => {
  const slices = new Set(slicesInSrc())
  const named = statusBlock().flatMap((line) => namedOn(line)).filter((name) => slices.has(name))
  assert.notDeepEqual(named, [],
    'the status block names no directory in src/, so nothing holds it to what a launch loads: name the slices that run')
  const notLoaded = named.filter((name) => !LAUNCH_LOADS.has(name))
  assert.deepEqual(notLoaded, [],
    `the status block says ${notLoaded.join(', ')} runs, and no launch loads it: bring the page and the code back together`)
})

test('everything the page says does not run, does not run', () => {
  const slices = new Set(slicesInSrc())
  const registered = new Set<string>(REGISTERED)
  const wrong = sentencesOf(README)
    .filter((sentence) => DENIES_RUNNING.some((denial) => denial.test(sentence)))
    .flatMap((sentence) => namedOn(sentence))
    .flatMap((name) => {
      if (registered.has(name)) return [`the page says ${name} cannot be called, and the launcher registers it (they are ${REGISTERED.join(', ')})`]
      if (slices.has(name) && LAUNCH_LOADS.has(name)) return [`the page says a launch does not load ${name}, and it loads it`]
      return []
    })
  assert.deepEqual(wrong, [],
    `the page denies something runs that the code runs; bring the words and the code back together:\n${wrong.join('\n')}`)
})
