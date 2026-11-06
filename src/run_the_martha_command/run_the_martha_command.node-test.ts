// `bin/martha`, run as a stranger runs it: a Node program with no dependency, in a checkout of theirs (martha#98).
//
// Each test runs the real bin/martha in a git checkout under a temporary home, with that home's own state, and
// reads what it says and how it ends. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { NOT_A_TERMINAL } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { NOT_A_TERMINAL as START_NOT_ON_A_TERMINAL } from '../start_a_member/start_a_member.ts'
import { SOLO_MEMBERS } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { shortRelayRoot } from '../launch_a_claude_code_member/short_relay_root.ts'
import { EXIT_REFUSED, EXIT_USAGE, SAID_BY, USAGE } from './run_the_martha_command.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')

interface Place {
  readonly home: string
  readonly root: string
}

function placeFor(t: TestContext, { checkout = true } = {}): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-command-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = join(home, 'project')
  mkdirSync(root)
  if (checkout) {
    execFileSync('git', ['init', '-q', '.'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Ada Owner'], { cwd: root })
  }
  return { home, root }
}

/** bin/martha run in the place's checkout, with its standard input a pipe, never a terminal. */
function martha(place: Place, ...args: string[]) {
  return marthaWith(place, {}, ...args)
}

function marthaWith(place: Place, env: Readonly<Record<string, string>>, ...args: string[]) {
  const run = spawnSync(process.execPath, [MARTHA, ...args], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1', ...env },
  })
  return { status: run.status, out: run.stdout, err: run.stderr, said: `${run.stdout}${run.stderr}` }
}

/** Every line on stderr is Martha's, prefixed as martha-install prefixes its own. */
const allSaidByMartha = (err: string): void => {
  for (const line of err.split('\n').filter((said) => said !== '')) assert.ok(line.startsWith(`${SAID_BY} `), line)
}

test('bin/martha is in the tree, executable, and starts with a node line', () => {
  assert.ok(existsSync(MARTHA))
  assert.match(readFileSync(MARTHA, 'utf8'), /^#!\/usr\/bin\/env node\n/)
  execFileSync('test', ['-x', MARTHA])
})

test('martha with no act shows how it is used, and ends as a usage error', (t) => {
  const run = martha(placeFor(t))
  assert.equal(run.status, EXIT_USAGE)
  assert.ok(run.said.includes(USAGE), run.said)
})

test('martha outside any git checkout refuses, saying so', (t) => {
  const run = martha(placeFor(t, { checkout: false }), 'init')
  assert.equal(run.status, EXIT_REFUSED)
  assert.match(run.said, /git checkout/)
})

test('martha init writes the declaration once and refuses the second time', (t) => {
  const place = placeFor(t)
  const first = martha(place, 'init')
  assert.equal(first.status, 0, first.said)
  for (const member of SOLO_MEMBERS) assert.ok(first.out.includes(member.name), first.out)
  const file = join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const written = readFileSync(file, 'utf8')
  assert.match(written, /Ada Owner/)

  const second = martha(place, 'init')
  assert.equal(second.status, EXIT_REFUSED)
  assert.ok(second.err.includes(file), second.err)
  allSaidByMartha(second.err)
  assert.equal(readFileSync(file, 'utf8'), written)
})

test('martha start on a terminal with no declaration refuses, naming martha init', (t) => {
  const run = marthaOnATerminal(placeFor(t), {}, 'start', 'builder')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /martha init/)
  allSaidByMartha(run.said)
})

test('martha start with no member named shows how it is used', (t) => {
  const run = martha(placeFor(t), 'start')
  assert.equal(run.status, EXIT_USAGE)
  assert.ok(run.said.includes(USAGE), run.said)
})

test('martha approve whose input is no terminal refuses, so a member\'s shell cannot approve', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, '.mcp.json'), '{"mcpServers":{}}')
  const run = martha(place, 'approve')
  assert.equal(run.status, EXIT_REFUSED)
  assert.ok(run.err.includes(NOT_A_TERMINAL), run.err)
  allSaidByMartha(run.err)
})

test('martha --version prints the version package.json carries, and nothing else', (t) => {
  const run = martha(placeFor(t, { checkout: false }), '--version')
  assert.equal(run.status, 0)
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }
  assert.equal(run.out, `${manifest.version}\n`)
})

/** bin/martha run on a terminal of its own, as the owner runs it: util-linux script gives it one. */
function marthaOnATerminal(place: Place, env: Readonly<Record<string, string>>, ...args: string[]) {
  const words = [process.execPath, MARTHA, ...args].map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(' ')
  const run = spawnSync('script', ['--quiet', '--return', '--command', words, '/dev/null'], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1', ...env },
  })
  return { status: run.status, said: `${run.stdout}${run.stderr}`.replaceAll('\r\n', '\n') }
}

/** A fake claude on the place's PATH that notes it ran, then ends with status 7. */
function claudeThatEnds(place: Place, t: TestContext): { readonly ran: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'bin')
  mkdirSync(bin)
  const ran = join(place.home, 'ran')
  writeFileSync(join(bin, 'claude'), ['#!/bin/sh', `: > '${ran}'`, 'exit 7', ''].join('\n'), { mode: 0o700 })
  return { ran, env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: shortRelayRoot(t) } }
}

test('martha init then martha start on a terminal runs the owner\'s claude, names the member and its pid, and ends as it did', (t) => {
  const place = placeFor(t)
  const claude = claudeThatEnds(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0)
  const [builder] = SOLO_MEMBERS
  const run = marthaOnATerminal(place, claude.env, 'start', builder!.name)
  assert.equal(run.status, 7, run.said)
  assert.match(run.said, new RegExp(`^${builder!.name} started, pid [0-9]+$`, 'm'))
  assert.ok(existsSync(claude.ran), 'the owner\'s claude ran')
})

test('martha start whose input is no terminal refuses, so a member\'s shell cannot start a sibling', (t) => {
  const place = placeFor(t)
  const claude = claudeThatEnds(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0)
  const [builder] = SOLO_MEMBERS
  const run = marthaWith(place, claude.env, 'start', builder!.name)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.err.includes(START_NOT_ON_A_TERMINAL), run.err)
  allSaidByMartha(run.err)
  assert.equal(existsSync(claude.ran), false)
})

test('what martha shows the owner carries no terminal control: it is written out as an escape', (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-command-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = join(home, 'erase\u001b[2K\u009bline\u202e')
  mkdirSync(root)
  const run = martha({ home, root }, 'init')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.doesNotMatch(run.said, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u)
  assert.ok(run.err.includes('erase\\x1b[2K\\x9bline\\u202e'), run.err)
  allSaidByMartha(run.err)
})
