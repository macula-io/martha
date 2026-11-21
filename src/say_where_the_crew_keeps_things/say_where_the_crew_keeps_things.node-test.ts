// `martha where`: where this crew keeps everything, one `KEY=path` a line (martha#985, gap 20 of #957).
//
// The command test runs the real `martha init` in a checkout of its own and reads the lines back against the places
// the launcher itself writes into, so a path that drifted from the one the other verbs use fails here by name. The
// empty-value rule is held on the slice, where a crew with no clones and no worktrees is asked.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { CLONES, DECLARATION_DIRECTORY, DECLARATION_FILE, SOLO_MODE, WORKTREES } from '../declare_crew/declare_crew.ts'
import { CREWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { EXIT_DONE, EXIT_USAGE } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { HANDOVERS_PLACE } from '../write_my_handover/write_my_handover.ts'
import { ROSTER_FILE, WHERE_KEYS, whereLinesOf, type ThePlacesShown } from './say_where_the_crew_keeps_things.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')

interface Place {
  readonly home: string
  readonly root: string
}

function aPlace(t: TestContext): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-where-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Ada Owner\n')
  return { home, root }
}

function martha(place: Place, ...args: string[]) {
  const run = spawnSync(process.execPath, [MARTHA, ...args], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH ?? '', HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1' },
  })
  return { status: run.status, out: run.stdout, err: run.stderr, said: `${run.stdout}${run.stderr}` }
}

/** A crew's places, built from the names the slices that keep them define, so no test spells one again. */
function aSample(names: { readonly clones: string | null; readonly worktrees: string | null }): ThePlacesShown {
  const crew = join('/', CREWS_PLACE, 'the-crews-key')
  return {
    declaration: join('/', DECLARATION_DIRECTORY, DECLARATION_FILE),
    state: join('/', 'project-state'),
    crew,
    handovers: join(crew, HANDOVERS_PLACE),
    clones: names.clones,
    worktrees: names.worktrees,
    roster: join(crew, ROSTER_FILE),
    mode: SOLO_MODE,
  }
}

/** The lines `martha where` printed, as a key to value each. */
function asked(place: Place): Readonly<Record<string, string>> {
  const run = martha(place, 'where')
  assert.equal(run.status, EXIT_DONE, run.said)
  return Object.fromEntries(run.out.split('\n').filter((line) => line !== '').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
}

test('martha where names every place the launcher itself writes into, one line each in the declared order', (t) => {
  const place = aPlace(t)
  assert.equal(martha(place, 'init').status, EXIT_DONE)
  const run = martha(place, 'where')
  assert.equal(run.status, EXIT_DONE, run.said)
  const keys = run.out.split('\n').filter((line) => line !== '').map((line) => line.slice(0, line.indexOf('=')))
  assert.deepEqual(keys, Object.values(WHERE_KEYS), 'every key, in order, and no other line')
  const shown = asked(place)
  assert.ok(existsSync(shown['DECLARATION']!), `the declaration is there: ${shown['DECLARATION']}`)
  assert.ok(existsSync(shown['STATE']!), `the project's state directory is there: ${shown['STATE']}`)
  assert.ok(existsSync(shown['CREW']!), `the crew's own directory is there: ${shown['CREW']}`)
  assert.ok(shown['CREW']!.startsWith(shown['STATE']!.replace(/[^/]+$/, '')), 'the crew sits under the state root')
  assert.equal(shown['HANDOVERS'], join(shown['CREW']!, HANDOVERS_PLACE))
  assert.equal(shown['ROSTER'], '', 'a crew with no roster yet prints the line empty')
  assert.equal(shown['MODE'], SOLO_MODE)
})

test('a crew that names no clones and no worktrees prints those keys empty, not a line missing', () => {
  const lines = whereLinesOf(aSample({ clones: null, worktrees: null }))
  assert.equal(lines.length, Object.values(WHERE_KEYS).length)
  for (const key of [WHERE_KEYS.clones, WHERE_KEYS.worktrees]) {
    assert.ok(lines.includes(`${key}=`), `${key} is a line with an empty value`)
  }
})

test('a crew that names clones and worktrees prints the places the declaration named', () => {
  const clones = join('/', CLONES)
  const worktrees = join('/', WORKTREES)
  const lines = whereLinesOf(aSample({ clones, worktrees }))
  assert.ok(lines.includes(`${WHERE_KEYS.clones}=${clones}`))
  assert.ok(lines.includes(`${WHERE_KEYS.worktrees}=${worktrees}`))
})

test('martha where takes no arguments, and a word after it is a way the command is not used', (t) => {
  const run = martha(aPlace(t), 'where', 'extra')
  assert.equal(run.status, EXIT_USAGE, run.said)
  assert.match(run.said, /usage:/)
})
