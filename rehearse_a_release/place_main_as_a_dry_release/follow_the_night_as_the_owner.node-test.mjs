// The owner's follow script, run for real (macula-io/martha#639): follow_the_night_as_the_owner.cases.sh gives it a
// night folder and a terminal of its own, and proves whether the owner's command ran. Night 1 found two ways it ran
// one it must not: from a night that had already ended, and unconfirmed, with no terminal to read Enter from. Each
// fix has its cases, and each case here is also run against a copy of the script with that fix taken out: the copy
// must fail exactly that case, so a case that could pass without its fix goes red.
//
// No word of the script is spelled here or in the cases: they read them from the script. Each mutant names the exact
// text it takes out, and a mutant whose text is not in the script fails rather than passing unmutated. Every copy is
// written under one temp folder, removed after each test.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'follow_the_night_as_the_owner.sh')
const CASES = join(HERE, 'follow_the_night_as_the_owner.cases.sh')
const SCRIPT_TEXT = readFileSync(SCRIPT, 'utf8')
/** The cases' own bound is 30 s per case; the whole run of six stays well inside this. */
const RUN_WITHIN_MS = 55_000

/** Runs the cases on `script`, all of them or the one named. @param {string} script @param {string[]} only */
const runTheCases = (script, only = []) =>
  spawnSync('bash', [CASES, script, ...only], { encoding: 'utf8', timeout: RUN_WITHIN_MS })

test('every case holds on the owner\'s follow script', () => {
  const run = runTheCases(SCRIPT)
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
  assert.match(run.stdout, /^cases: 6 of 6 held$/m)
})

/** Each mutant takes one fix out of the script; `killedBy` is the case that must then fail. */
const MUTANTS = [
  {
    name: 'the end is not read before a command is offered',
    from: '  # The end is read before any command: a command from a night that has ended is never offered.\n  if night_ended; then the_night_ended; fi\n',
    to: '',
    killedBy: 'ended_offers_no_command',
  },
  {
    name: 'no terminal is not refused',
    from: 'if ! { [ -t 0 ] && [ -t 1 ]; }; then',
    to: 'if false; then',
    killedBy: 'no_terminal',
  },
  {
    name: 'a failed read still runs the command',
    from: 'if ! read -r -p "${PROMPT}" _; then',
    to: 'read -r -p "${PROMPT}" _; if false; then',
    killedBy: 'read_fails_runs_nothing',
  },
  {
    name: 'the end is not read again after Enter',
    from: '    # The night may have ended while the prompt waited.\n    if night_ended; then the_night_ended; fi\n',
    to: '',
    killedBy: 'ended_while_the_prompt_waited',
  },
]

for (const mutant of MUTANTS) {
  test(`mutant: ${mutant.name}, killed by ${mutant.killedBy}`, () => {
    assert.equal(SCRIPT_TEXT.split(mutant.from).length, 2, `the script holds the mutant's text exactly once: ${mutant.from}`)
    const dir = mkdtempSync(join(tmpdir(), 'follow-mutant-'))
    try {
      const copy = join(dir, 'follow_the_night_as_the_owner.sh')
      writeFileSync(copy, SCRIPT_TEXT.replace(mutant.from, mutant.to))
      const run = runTheCases(copy, [mutant.killedBy])
      assert.equal(run.status, 1, `${run.stdout}${run.stderr}`)
      assert.match(run.stdout, new RegExp(`^FAIL ${mutant.killedBy}: `, 'm'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
