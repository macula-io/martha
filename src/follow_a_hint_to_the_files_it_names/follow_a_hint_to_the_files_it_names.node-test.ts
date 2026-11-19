import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { aGitignoreLine } from './a_gitignore_pattern.ts'
import { theExpansionOfAHint, THE_MOST_EXPANDED_BYTES, THE_MOST_LEVELS_FOLLOWED, THE_MOST_REFERENCES_FOLLOWED, type AFileAHintNames, type TheFilesAHintNames } from './the_expansion_of_a_hint.ts'
import { NO_GITIGNORE, theGitignoreChainOf, theGitRootOf, type TheGitignoreChainRead } from './the_gitignore_chain.ts'
import { THE_MOST_A_HINT_SCANS } from './the_references_a_hint_names.ts'

// Every test reads a real checkout made new for it, and removes it when it ends.

const machine = thisMachine.stores.files

/** The engine's own hints file, as its recording spells it. */
const HINT = RECORDED_GOOSE_ENGINE.hint_files.goose_hints

/** A checkout made new for one test: a directory holding these files, every path already resolved. */
function aCheckout(t: TestContext, files: Readonly<Record<string, string | Uint8Array>>): string {
  const home = mkdtempSync(join(tmpdir(), 'martha-hints-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeAFileIn(checkout, name, content)
  return realpathSync(checkout)
}

/** One file of a checkout, the directories above it made first. */
function writeAFileIn(checkout: string, name: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(checkout, name)), { recursive: true })
  writeFileSync(join(checkout, name), content)
}

/** The checkout's git root, which is where a reference may reach: the checkout when it holds `.git`. */
function theRootOf(checkout: string): string {
  return theGitRootOf(checkout, machine) ?? checkout
}

/** The expansion of a checkout's `.goosehints`, through the checkout's own gitignore chain. */
function expandedIn(checkout: string, hint = HINT): TheFilesAHintNames {
  const read: TheGitignoreChainRead = theGitignoreChainOf(theRootOf(checkout), machine)
  assert.ok('chain' in read, `the gitignore chain was refused: ${'refusal' in read ? read.refusal : ''}`)
  return theExpansionOfAHint(join(checkout, hint), theRootOf(checkout), read.chain, machine)
}

/** The names of the files an expansion read, as they were written. */
const namesRead = (expanded: TheFilesAHintNames): readonly string[] => expanded.files.map((file: AFileAHintNames) => file.asWritten)

// --- the reference is followed and the file is named ---------------------------------

test('a hint that names a file in its checkout has that file spliced in, and the file is named as written (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: 'read @docs/guide.md before you start\n', 'docs/guide.md': 'the guide\n' })
  const expanded = expandedIn(checkout)
  assert.deepEqual(namesRead(expanded), ['docs/guide.md'])
  assert.match(expanded.text, /--- Content from docs\/guide\.md ---\nthe guide\n\n--- End of docs\/guide\.md ---/)
  const [read] = expanded.files
  assert.equal(read?.at, join(checkout, 'docs/guide.md'), 'the file read must be the one the reference resolves to')
  assert.equal(read?.from, join(checkout, HINT), 'the file that named it must be the hint')
  assert.equal(Buffer.from(read?.bytes ?? []).toString('utf8'), 'the guide\n')
})

test('a reference is resolved against the directory of the file that wrote it, not the hint (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: '@docs/guide.md\n', 'docs/guide.md': 'see @parts/two.md\n', 'docs/parts/two.md': 'part two\n' })
  const expanded = expandedIn(checkout)
  assert.deepEqual(namesRead(expanded), ['docs/guide.md', 'parts/two.md'])
  assert.equal(expanded.files[1]?.at, join(checkout, 'docs/parts/two.md'))
  assert.equal(expanded.files[1]?.from, join(checkout, 'docs/guide.md'), 'the nested file must say which file named it')
})

test('a file with no reference in it is read whole and changes nothing but its place in the text (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: 'before @plain.md after\n', 'plain.md': 'plain' })
  const expanded = expandedIn(checkout)
  assert.equal(expanded.text, 'before --- Content from plain.md ---\nplain\n--- End of plain.md --- after\n')
})

// --- the caps ------------------------------------------------------------------------

test(`a reference four levels down is not followed, and three levels are (martha#801)`, (t) => {
  const levels: Record<string, string> = { [HINT]: '@one.md\n' }
  for (let at = 1; at <= THE_MOST_LEVELS_FOLLOWED + 1; at += 1) levels[`${nameOfLevel(at)}.md`] = at <= THE_MOST_LEVELS_FOLLOWED ? `@${nameOfLevel(at + 1)}.md\n` : 'the bottom\n'
  const expanded = expandedIn(aCheckout(t, levels))
  const followed = Array.from({ length: THE_MOST_LEVELS_FOLLOWED }, (_, below) => `${nameOfLevel(below + 1)}.md`)
  assert.deepEqual(namesRead(expanded), followed, 'only three references may be followed below the hint')
  assert.match(expanded.text, new RegExp(`@${nameOfLevel(THE_MOST_LEVELS_FOLLOWED + 1)}\\.md`), 'the reference that was not followed must stay as it was written')
})

const nameOfLevel = (at: number): string => ['zero', 'one', 'two', 'three', 'four'][at] ?? `level${String(at)}`

test(`the ${String(THE_MOST_REFERENCES_FOLLOWED)}th reference is the last one followed (martha#801)`, (t) => {
  const many: Record<string, string> = { [HINT]: Array.from({ length: THE_MOST_REFERENCES_FOLLOWED + 1 }, (_, at) => `@f${String(at)}.md`).join('\n') }
  for (let at = 0; at <= THE_MOST_REFERENCES_FOLLOWED; at += 1) many[`f${String(at)}.md`] = `file ${String(at)}`
  const expanded = expandedIn(aCheckout(t, many))
  assert.equal(expanded.files.length, THE_MOST_REFERENCES_FOLLOWED)
  assert.match(expanded.text, new RegExp(`@f${String(THE_MOST_REFERENCES_FOLLOWED)}\\.md`), 'the reference past the budget must stay as written')
})

test('a reference that would take the output past its budget attaches nothing (martha#801)', (t) => {
  const half = Math.ceil(THE_MOST_EXPANDED_BYTES / 2) + 1
  const hints = ['@first.md', '@second.md'].join('\n')
  const checkout = aCheckout(t, { [HINT]: hints, 'first.md': 'a'.repeat(half), 'second.md': 'b'.repeat(half) })
  const expanded = expandedIn(checkout)
  assert.deepEqual(namesRead(expanded), ['first.md'])
  assert.match(expanded.text, /@second\.md/)
})

test('the output budget counts the wrapper one byte larger than the text it splices (martha#801)', (t) => {
  // The engine costs a reference `--- Content from X ---\n\n--- End of X ---`, while the text it produces carries one
  // newline between; a file sized to fit only the shorter wrapper must attach nothing.
  const wrapper = `--- Content from sized.md ---\n\n--- End of sized.md ---`
  const checkout = aCheckout(t, { [HINT]: '@sized.md\n', 'sized.md': 'a'.repeat(THE_MOST_EXPANDED_BYTES - Buffer.byteLength(wrapper) + 1) })
  assert.deepEqual(namesRead(expandedIn(checkout)), [])
})

test('a hint over 128 KiB is not scanned at all, so no reference in it is followed (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: `@plain.md\n${'a'.repeat(THE_MOST_A_HINT_SCANS)}`, 'plain.md': 'plain' })
  const expanded = expandedIn(checkout)
  assert.deepEqual(namesRead(expanded), [])
  assert.match(expanded.text, /@plain\.md/)
})

// --- what a reference may not name ---------------------------------------------------

test('a reference that is absolute, names .git, or reaches outside the checkout attaches nothing (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: '@/etc/passwd\n@.git/config\n@../outside.md\n@sub/.git/x\n', '.git/config': 'planted', 'sub/.git/x': 'planted' })
  const expanded = expandedIn(checkout)
  assert.deepEqual(namesRead(expanded), [])
  assert.equal(expanded.text, '@/etc/passwd\n@.git/config\n@../outside.md\n@sub/.git/x\n')
})

test('a reference into a git directory the checkout points at attaches nothing (martha#801)', (t) => {
  // `.git` as a FILE names the git directory through `gitdir:`, which is not itself named `.git`; only reading the
  // pointer keeps such a reference out.
  const checkout = aCheckout(t, { [HINT]: '@the-git-dir/config\n', 'the-git-dir/config': 'planted' })
  writeAFileIn(checkout, '.git', 'gitdir: ./the-git-dir\n')
  assert.deepEqual(namesRead(expandedIn(checkout)), [])
})

test('a reference under a directory that is a repository of its own, named no .git, attaches nothing (martha#801)', (t) => {
  // A git directory need not be called `.git`; the engine refuses a file under one by its shape — a `HEAD` beside the
  // objects and refs — which is the only rule that keeps such a reference out.
  const checkout = aCheckout(t, { [HINT]: '@a-repository/config\n', 'a-repository/config': 'planted', 'a-repository/HEAD': 'ref: refs/heads/main\n' })
  mkdirSync(join(checkout, 'a-repository/objects'), { recursive: true })
  mkdirSync(join(checkout, 'a-repository/refs'), { recursive: true })
  assert.deepEqual(namesRead(expandedIn(checkout)), [])
})

test('a checkout whose `.git` link points nowhere is not a git root, and one holding `.git` is (martha#801)', (t) => {
  const dangling = aCheckout(t, { [HINT]: '' })
  symlinkSync(join(dangling, 'nowhere'), join(dangling, '.git'))
  const held = aCheckout(t, { [HINT]: '', '.git/HEAD': 'ref: refs/heads/main\n' })
  assert.notEqual(theGitRootOf(dangling, machine), dangling, 'a link pointing nowhere is not a .git the engine finds')
  assert.equal(theGitRootOf(held, machine), held)
})

// --- the gitignore chain -------------------------------------------------------------

test('a gitignored file attaches nothing, and a later ! line takes it back (martha#801)', (t) => {
  const ignored = aCheckout(t, { [HINT]: '@secret.md\n', 'secret.md': 'secret', '.gitignore': 'secret.md\n' })
  const kept = aCheckout(t, { [HINT]: '@secret.md\n', 'secret.md': 'secret', '.gitignore': 'secret.md\n!secret.md\n' })
  assert.deepEqual(namesRead(expandedIn(ignored)), [])
  assert.deepEqual(namesRead(expandedIn(kept)), ['secret.md'])
})

test('the checkout has one matcher rooted at its top, never git\'s chain of one per directory (martha#801)', (t) => {
  // `/inner.md` written in `sub/.gitignore` is git's `sub/inner.md`; the engine's single matcher rooted at the checkout
  // reads it as the top-level `inner.md` and leaves the reference alone.
  const checkout = aCheckout(t, { [HINT]: '@sub/inner.md\n', 'sub/inner.md': 'inner', 'sub/.gitignore': '/inner.md\n' })
  assert.deepEqual(namesRead(expandedIn(checkout)), ['sub/inner.md'])
})

test('an unreadable gitignore line is dropped and the lines after it still apply (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: '@secret.md\n', 'secret.md': 'secret', '.gitignore': 'secret.md\n{broken\n' })
  assert.deepEqual(namesRead(expandedIn(checkout)), [])
})

test('a gitignore line this port cannot reproduce refuses the chain by name (martha#801)', (t) => {
  const line = `na${String.fromCharCode(0xef)}ve.md`
  const checkout = aCheckout(t, { [HINT]: '@plain.md\n', 'plain.md': 'plain', '.gitignore': `${line}\n` })
  const read = theGitignoreChainOf(checkout, machine)
  assert.ok('refusal' in read, 'a non-ASCII line must be refused, not skipped')
  assert.match(read.refusal, new RegExp(escapeForARegex(line)))
})

// --- one file, two spellings ---------------------------------------------------------

test('the stack of references being expanded compares them as written, so ./a and a are two (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: '@a.md\n@./a.md\n', 'a.md': 'same\n' })
  assert.deepEqual(namesRead(expandedIn(checkout)), ['a.md', './a.md'])
})

test('a cycle of references ends where the engine\'s stack ends it, each file named once per spelling (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: '@a.md\n', 'a.md': 'a names @b.md\n', 'b.md': 'b names @a.md\n' })
  const expanded = expandedIn(checkout)
  assert.deepEqual(namesRead(expanded), ['a.md', 'b.md'])
  assert.match(expanded.text, /b names @a\.md/)
})

// --- the whitespace class, and a file that is not text -------------------------------

test('the scanner reads Rust\'s whitespace: U+0085 separates a reference and U+FEFF does not (martha#801)', (t) => {
  const separated = aCheckout(t, { [HINT]: `read${String.fromCharCode(0x85)}@plain.md\n`, 'plain.md': 'plain' })
  const joined = aCheckout(t, { [HINT]: `read${String.fromCharCode(0xfeff)}@plain.md\n`, 'plain.md': 'plain' })
  assert.deepEqual(namesRead(expandedIn(separated)), ['plain.md'])
  assert.deepEqual(namesRead(expandedIn(joined)), [])
})

test('a referenced file that is not valid UTF-8 attaches nothing (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: '@bad.md\n', 'bad.md': Uint8Array.from([0xff, 0xfe]) })
  const expanded = expandedIn(checkout)
  assert.deepEqual(namesRead(expanded), [])
  assert.match(expanded.text, /@bad\.md/)
})

// --- an empty chain reads everything -------------------------------------------------

test('an empty chain never ignores a reference, as the engine\'s subdirectory and global hints see it (martha#801)', (t) => {
  const checkout = aCheckout(t, { [HINT]: '@secret.md\n', 'secret.md': 'secret', '.gitignore': 'secret.md\n' })
  const expanded = theExpansionOfAHint(join(checkout, HINT), checkout, NO_GITIGNORE, machine)
  assert.deepEqual(namesRead(expanded), ['secret.md'])
})

// --- one line of a gitignore, and the glob it compiles to ----------------------------

test('a gitignore line means what globset makes of it, one rule per case (martha#801)', () => {
  assert.equal(matches('*.log', 'a.log'), true)
  assert.equal(matches('*.log', 'x/y/a.log'), true, 'a line with no slash matches at any depth')
  assert.equal(matches('*.log', 'a.logx'), false)
  assert.equal(matches('/docs/x.md', 'docs/x.md'), true)
  assert.equal(matches('/docs/x.md', 'sub/docs/x.md'), false, 'a leading slash anchors the line at the root')
  assert.equal(matches('docs/**', 'docs/deep/x.md'), true)
  assert.equal(matches('docs/**', 'docs'), false, 'a trailing /** is everything inside, never the directory')
  assert.equal(matches('[!a].md', 'b.md'), true)
  assert.equal(matches('[!a].md', 'a.md'), false)
  assert.equal(matches('a{1,2}.md', 'a2.md'), true)
  assert.equal(matches('a{1,2}.md', 'a3.md'), false)
  assert.equal(matches('\\#hash', '#hash'), true, 'an escaped # is a literal')
  assert.equal(matches('**', 'anything/at/all'), true)
})

test('a glob this port cannot compile, or globset refuses, is answered as each of them answers (martha#801)', () => {
  assert.equal(aGitignoreLine('{broken').kind, 'dropped', 'globset refuses an unclosed alternation, and the engine drops the line')
  assert.equal(aGitignoreLine('[z-a]').kind, 'dropped', 'globset refuses a range that ends before it starts')
  const refused = aGitignoreLine(`na${String.fromCharCode(0xef)}ve.md`)
  assert.equal(refused.kind, 'refused', 'a non-ASCII line is refused by this port, never guessed at')
})

test('an unclosed class is a literal bracket, as globset allows, and a trailing space is trimmed unless escaped (martha#801)', () => {
  assert.equal(matches('[abc', '[abc'), true)
  assert.equal(matches('name ', 'name'), true, 'a trailing space is not part of the line')
  assert.equal(matches('name\\ ', 'name '), true, 'an escaped trailing space is part of the line')
  const onlyDirectory = aGitignoreLine('dir/')
  assert.equal(onlyDirectory.kind === 'pattern' ? onlyDirectory.pattern.isOnlyDirectory : false, true)
})

test('? matches one byte of the path, as globset\'s non-Unicode regex does (martha#801)', () => {
  const pattern = aGitignoreLine('?.md')
  assert.equal(pattern.kind, 'pattern')
  const matchesBytes = pattern.kind === 'pattern' ? pattern.pattern.matchesBytes : () => false
  assert.equal(matchesBytes('a.md'), true)
  assert.equal(matchesBytes('ab.md'), false)
  assert.equal(matchesBytes(asBytesOf('é.md')), false, 'a two-byte character is two bytes, never one')
})

/** Whether one line of a `.gitignore` matches a path, with the path's bytes as the matcher sees them. */
function matches(line: string, path: string): boolean {
  const pattern = aGitignoreLine(line)
  assert.equal(pattern.kind, 'pattern', `"${line}" is not a pattern`)
  return pattern.kind === 'pattern' ? pattern.pattern.matchesBytes(asBytesOf(path)) : false
}

/** A path's UTF-8 bytes held in a latin1 string, which is what the byte matcher reads. */
const asBytesOf = (path: string): string => Buffer.from(path, 'utf8').toString('latin1')

/** A string with its regex metacharacters escaped, for a pattern that holds a text rather than a regex. */
const escapeForARegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
