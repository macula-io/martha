import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theDirectoriesAToolCallReaches, theHintsAReplayReaches, type ASubdirectoryHint } from './find_the_hints_a_tool_call_reaches.ts'
import { theWordsACommandIsSplitInto } from './the_words_a_command_is_split_into.ts'

// Every test reads a real checkout made new for it, and removes it when it ends.

const machine = thisMachine.stores.files

/** The names the engine's own list holds when no setting replaces it, as its recording spells them. */
const HINT_NAMES = RECORDED_GOOSE_ENGINE.hint_files.when_unset

/** The engine's own hints file, as its recording spells it. */
const GOOSE_HINTS = RECORDED_GOOSE_ENGINE.hint_files.goose_hints

/** A hint file's path inside a directory of the checkout. */
const hintIn = (...parts: readonly string[]): string => join(...parts, GOOSE_HINTS)

/** A checkout made new for one test: a directory holding `.git` and these files, every path already resolved. */
function aCheckout(t: TestContext, files: Readonly<Record<string, string>>): string {
  const home = mkdtempSync(join(tmpdir(), 'martha-subdir-hints-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout, { recursive: true })
  writeAFileIn(checkout, '.git/HEAD', 'ref: refs/heads/main\n')
  for (const [name, content] of Object.entries(files)) writeAFileIn(checkout, name, content)
  return realpathSync(checkout)
}

/** One file of a checkout, the directories above it made first. */
function writeAFileIn(checkout: string, name: string, content: string): void {
  mkdirSync(dirname(join(checkout, name)), { recursive: true })
  writeFileSync(join(checkout, name), content)
}

/** The files one replay's hints were read from, in the order they were read. */
const theFilesOf = (hints: readonly ASubdirectoryHint[]): readonly string[] => hints.map((hint) => hint.at)

// --- which directories a call reaches -------------------------------------------------

test('a tool call naming a file under a subdirectory loads that directory and each one above it, never the top (martha#801)', (t) => {
  const checkout = aCheckout(t, { [GOOSE_HINTS]: 'top', [hintIn('sub')]: 'sub', [hintIn('sub', 'deep')]: 'deep', 'sub/deep/file.ts': '' })
  const replayed = theHintsAReplayReaches([{ path: 'sub/deep/file.ts' }], checkout, HINT_NAMES, machine)
  assert.deepEqual(replayed.directories, [join(checkout, 'sub/deep')])
  assert.deepEqual(theFilesOf(replayed.hints), [join(checkout, 'sub', GOOSE_HINTS), join(checkout, 'sub/deep', GOOSE_HINTS)], 'the hints run root first, and never the working directory\'s own')
  assert.deepEqual(replayed.hints.map((hint) => hint.reached), [join(checkout, 'sub/deep'), join(checkout, 'sub/deep')])
  assert.equal(replayed.hints[1]?.expanded.text, 'deep')
})

test('the working directory itself is never loaded, and a reach above it loads nothing (martha#801)', (t) => {
  const checkout = aCheckout(t, { [GOOSE_HINTS]: 'top' })
  assert.deepEqual(theHintsAReplayReaches([{ path: 'top.ts' }, { path: '../outside/x.ts' }], checkout, HINT_NAMES, machine).directories, [])
})

test('a call that reaches the same directory twice loads it once in one replay (martha#801)', (t) => {
  const checkout = aCheckout(t, { [hintIn('sub')]: 'sub', 'sub/x.ts': '', 'sub/y.ts': '' })
  const replayed = theHintsAReplayReaches([{ path: 'sub/x.ts' }, { path: 'sub/y.ts' }], checkout, HINT_NAMES, machine)
  assert.deepEqual(replayed.directories, [join(checkout, 'sub')])
  assert.deepEqual(theFilesOf(replayed.hints), [join(checkout, 'sub', GOOSE_HINTS)])
})

test('a tool call made with no arguments, or arguments that are not an object, reaches nothing (martha#801)', (t) => {
  const checkout = aCheckout(t, {})
  assert.deepEqual(theDirectoriesAToolCallReaches(undefined, checkout), [])
  assert.deepEqual(theDirectoriesAToolCallReaches('ls', checkout), [])
  assert.deepEqual(theDirectoriesAToolCallReaches({}, checkout), [])
})

// --- what the command's words reach ---------------------------------------------------

test('a command word holding a slash or a dot reaches its directory; a bare word and an option do not (martha#801)', (t) => {
  const checkout = aCheckout(t, { [hintIn('src', 'deep')]: 'deep', 'src/deep/a.ts': '' })
  const words = theDirectoriesAToolCallReaches({ command: 'ls -la src/deep/a.ts plainword' }, checkout)
  assert.deepEqual(words, [join(checkout, 'src/deep')])
  assert.deepEqual(theHintsAReplayReaches([{ command: 'ls -la src/deep/a.ts plainword' }], checkout, HINT_NAMES, machine).directories, [join(checkout, 'src/deep')])
})

test('a command word naming a directory reaches the directory above it, as a path word always resolves to its parent (martha#801)', (t) => {
  const checkout = aCheckout(t, { [hintIn('src', 'deep')]: 'deep' })
  assert.deepEqual(theDirectoriesAToolCallReaches({ command: 'cd src/deep' }, checkout), [join(checkout, 'src')])
})

test('a command that does not parse as a shell would split it reaches nothing, and a quoted word reaches its directory (martha#801)', (t) => {
  const checkout = aCheckout(t, { [hintIn('my dir')]: 'spaced', 'my dir/a.txt': '' })
  assert.deepEqual(theHintsAReplayReaches([{ command: 'cat "my dir/a.txt"' }], checkout, HINT_NAMES, machine).directories, [join(checkout, 'my dir')])
  assert.deepEqual(theHintsAReplayReaches([{ command: "cat 'my dir/a.txt" }], checkout, HINT_NAMES, machine).directories, [])
})

// --- the shell splitter ---------------------------------------------------------------

test('a command is split into words one rule per case (martha#801)', () => {
  assert.deepEqual(theWordsACommandIsSplitInto('a b'), ['a', 'b'])
  assert.deepEqual(theWordsACommandIsSplitInto("'a b' c"), ['a b', 'c'])
  assert.deepEqual(theWordsACommandIsSplitInto('"a b"'), ['a b'])
  assert.deepEqual(theWordsACommandIsSplitInto('a\\ b'), ['a b'])
  assert.deepEqual(theWordsACommandIsSplitInto('a # b'), ['a'], 'a comment takes the rest of the line')
  assert.deepEqual(theWordsACommandIsSplitInto(''), [])
  assert.deepEqual(theWordsACommandIsSplitInto("'' x"), ['', 'x'])
  assert.deepEqual(theWordsACommandIsSplitInto('"a\\$b"'), ['a$b'])
  assert.deepEqual(theWordsACommandIsSplitInto('"a\\qb"'), ['a\\qb'], 'a backslash before any other character stays')
  assert.deepEqual(theWordsACommandIsSplitInto('a\\'), ['a\\'], 'a trailing backslash is part of the word')
  assert.deepEqual(theWordsACommandIsSplitInto("'a"), [], 'an open quote splits nothing at all')
})

// --- taken again, and what the hint's own text reaches --------------------------------

test('a hint changed between two replays is read again, so the second replay holds the new text (martha#801)', (t) => {
  const checkout = aCheckout(t, { [hintIn('sub')]: 'first', 'sub/a.ts': '' })
  assert.equal(theHintsAReplayReaches([{ path: 'sub/a.ts' }], checkout, HINT_NAMES, machine).hints[0]?.expanded.text, 'first')
  writeAFileIn(checkout, hintIn('sub'), 'second')
  assert.equal(theHintsAReplayReaches([{ path: 'sub/a.ts' }], checkout, HINT_NAMES, machine).hints[0]?.expanded.text, 'second')
})

test('a subdirectory hint\'s references reach the git root and are never judged by the checkout\'s gitignore (martha#801)', (t) => {
  const checkout = aCheckout(t, { '.gitignore': 'secret.md\n', [hintIn('sub')]: 'see @secret.md and @../root.md\n', 'sub/secret.md': 'secret', 'root.md': 'root', 'sub/a.ts': '' })
  const hints = theHintsAReplayReaches([{ path: 'sub/a.ts' }], checkout, HINT_NAMES, machine).hints
  assert.deepEqual(hints[0]?.expanded.files.map((file) => file.asWritten), ['secret.md', '../root.md'], 'the checkout\'s gitignore is not the chain a subdirectory hint is judged by, and the git root is its reach')
  assert.equal(hints[0]?.expanded.files[1]?.at, join(checkout, 'root.md'))
})

test('a directory with no hint file of its own still loads the hints of the directories above it (martha#801)', (t) => {
  const checkout = aCheckout(t, { [hintIn('sub')]: 'sub', 'sub/deep/.keep': '' })
  const replayed = theHintsAReplayReaches([{ path: 'sub/deep/x.ts' }], checkout, HINT_NAMES, machine)
  assert.deepEqual(replayed.directories, [join(checkout, 'sub/deep')])
  assert.deepEqual(theFilesOf(replayed.hints), [join(checkout, 'sub', GOOSE_HINTS)])
})
