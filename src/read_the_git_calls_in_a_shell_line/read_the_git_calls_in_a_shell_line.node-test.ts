// The git calls a shell line makes, and the directory each of them runs in (martha#562).
//
// The claims this file pins are the slice's: a call is read from the line's own words wherever git appears, a quoted
// run is not a call, a call's arguments stop where its command does, and a call's directory is the shell's own — moved
// by `cd`, put back by `)`, moved for one call by `-C`, and null rather than guessed when nothing says which one it is.
// The last claim is what lets the shim and the relay agree: the same words read as a line and as arguments are the same
// calls.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readTheGitCallsInAShellLine, theGitCallsInArgv, theWordsOfACommand } from './read_the_git_calls_in_a_shell_line.ts'

/** A call as the reader hands it back: only what a rule reads, named here so a test says what it is holding. */
const asAPlainCall = (call: { readonly command: string | undefined; readonly args: readonly string[]; readonly directory: string | null }) => ({
  command: call.command,
  args: call.args,
  directory: call.directory,
})

// --- the words a command is made of -------------------------------------------------

test('a command is read as its own words, a quoted run being one word', () => {
  assert.deepEqual(theWordsOfACommand('git push origin main'), ['git', 'push', 'origin', 'main'])
  assert.deepEqual(theWordsOfACommand('echo "git push"'), ['echo', 'git push'])
  assert.deepEqual(theWordsOfACommand("cd /tmp && git push"), ['cd', '/tmp', '&&', 'git', 'push'])
})

// --- which words are a call ---------------------------------------------------------

test('a call is read wherever git appears, and a quoted run is never one', () => {
  assert.deepEqual(readTheGitCallsInAShellLine('npm test\ngit push origin main').map(asAPlainCall), [
    { command: 'push', args: ['origin', 'main'], directory: null },
  ])
  assert.deepEqual(readTheGitCallsInAShellLine('echo "git push"'), [])
  assert.deepEqual(readTheGitCallsInAShellLine('sh -c "git push"'), [])
  assert.deepEqual(readTheGitCallsInAShellLine('npm test'), [])
})

test('a path to git runs git, and two calls on one line are both read', () => {
  assert.deepEqual(readTheGitCallsInAShellLine('/usr/bin/git status').map(asAPlainCall), [{ command: 'status', args: [], directory: null }])
  assert.deepEqual(readTheGitCallsInAShellLine('./git status').map(asAPlainCall), [{ command: 'status', args: [], directory: null }])
  assert.deepEqual(readTheGitCallsInAShellLine('git fetch && git push').map((call) => call.command), ['fetch', 'push'])
})

// --- git's own options, and where its command sits behind them -----------------------

test("a call's options are handed back as they were written, and its command word sits past them", () => {
  const [call] = readTheGitCallsInAShellLine('git -c core.pager=cat --git-dir /r push --tags')
  assert.deepEqual(call?.options, ['-c', 'core.pager=cat', '--git-dir', '/r'])
  assert.deepEqual(asAPlainCall(call!), { command: 'push', args: ['--tags'], directory: null })
})

test("git's own -C moves where that one call runs, and only that one", () => {
  const calls = readTheGitCallsInAShellLine('git -C /place/one/repo checkout -b mine && git status')
  assert.deepEqual(asAPlainCall(calls[0]!), { command: 'checkout', args: ['-b', 'mine'], directory: '/place/one/repo' })
  // The next call is not in the directory the first one moved to: -C is git's own, and a shell keeps none of it.
  assert.deepEqual(asAPlainCall(calls[1]!), { command: 'status', args: [], directory: null })
})

// --- a call's arguments stop where its command does ---------------------------------

test("a call's arguments stop at the separator that ends its command", () => {
  const calls = readTheGitCallsInAShellLine('git push origin main; git tag v1')
  assert.deepEqual(asAPlainCall(calls[0]!), { command: 'push', args: ['origin', 'main'], directory: null })
  assert.deepEqual(asAPlainCall(calls[1]!), { command: 'tag', args: ['v1'], directory: null })
})

// --- the directory a call runs in ---------------------------------------------------

test('a cd before a call moves the directory the call runs in', () => {
  const calls = readTheGitCallsInAShellLine('cd /place/one/repo && git checkout -b mine')
  assert.deepEqual(asAPlainCall(calls[0]!), { command: 'checkout', args: ['-b', 'mine'], directory: '/place/one/repo' })
})

test('a relative cd is read past the directory the line started in, and is unknown without one', () => {
  const from = readTheGitCallsInAShellLine('cd repo && git status', { directory: '/place/one' })
  assert.deepEqual(asAPlainCall(from[0]!), { command: 'status', args: [], directory: '/place/one/repo' })
  // A line whose starting directory nobody can name gives no directory rather than half a path.
  const unknown = readTheGitCallsInAShellLine('cd repo && git status')
  assert.deepEqual(asAPlainCall(unknown[0]!), { command: 'status', args: [], directory: null })
})

test('a cd the reader cannot follow leaves the directory unknown rather than guessing one', () => {
  for (const line of ['cd - && git status', 'cd ~/place && git status', 'cd $PLACE && git status', 'cd ../* && git status']) {
    assert.deepEqual(asAPlainCall(readTheGitCallsInAShellLine(line, { directory: '/place/one' })[0]!), { command: 'status', args: [], directory: null }, line)
  }
})

test('a newline ends a command as a semicolon does, so the cd after it is the one in force', () => {
  const calls = readTheGitCallsInAShellLine('cd /place/one/repo\ncd /place/two/repo\ngit status', { directory: '/place' })
  assert.deepEqual(asAPlainCall(calls[0]!), { command: 'status', args: [], directory: '/place/two/repo' })
})

test('a cd with no path of its own, with an option, or behind a word that is no command, leaves the directory unknown', () => {
  // A bare `cd` goes home, a `cd -P /x` names a directory this reader does not read, and a `cd` past `then`, `do`,
  // `else` or `!` sits where the reader cannot see a command begin: none of them leaves the earlier directory in force.
  for (const line of ['cd; git status', 'cd -P /place/two && git status', 'cd -L /place/two && git status']) {
    assert.deepEqual(asAPlainCall(readTheGitCallsInAShellLine(line, { directory: '/place/one' })[0]!), { command: 'status', args: [], directory: null }, line)
  }
  for (const line of ['if true; then cd /place/two; fi; git status', '! cd /place/two; git status', 'while true; do cd /place/two; done; git status']) {
    assert.deepEqual(asAPlainCall(readTheGitCallsInAShellLine(line, { directory: '/place/one' })[0]!), { command: 'status', args: [], directory: null }, line)
  }
})

test("a cd inside a subshell stays inside it, and the shell's own directory comes back at the )", () => {
  const calls = readTheGitCallsInAShellLine('(cd /place/one/repo; git checkout -b mine); git status', { directory: '/place' })
  assert.deepEqual(asAPlainCall(calls[0]!), { command: 'checkout', args: ['-b', 'mine'], directory: '/place/one/repo' })
  assert.deepEqual(asAPlainCall(calls[1]!), { command: 'status', args: [], directory: '/place' })
})

// --- the line and the shim's arguments are read the same way -------------------------

test('the same words read as a line and as arguments are the same calls', () => {
  const line = 'cd /place/one/repo && git -C . checkout -b mine && git push origin main'
  assert.deepEqual(readTheGitCallsInAShellLine(line, { directory: '/place' }), theGitCallsInArgv(
    ['cd', '/place/one/repo', '&&', 'git', '-C', '.', 'checkout', '-b', 'mine', '&&', 'git', 'push', 'origin', 'main'],
    { directory: '/place' },
  ))
})
