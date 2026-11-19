// The owner's follow script, run for real (macula-io/martha#639): follow_the_night_as_the_owner.cases.sh gives it a
// run folder and a terminal of its own, and proves whether a command ran. Night 1 found two ways it ran one it must
// not: from a night that had already ended, and unconfirmed, with no terminal to read Enter from. Review found a third
// (the threat model on #639): proof.log carries the members' text, so a member could print a line the script took for
// the owner's command. Each fix has its cases, and each case here is also run against a copy of the script with that
// fix taken out: the copy must fail exactly that case, so a case that could pass without its fix goes red.
//
// No word of the script is spelled here or in the cases: they read them from the script. Each mutant names a line by
// text found on it alone, and a mutant whose line is not in the script exactly once fails rather than passing
// unmutated. Every copy is
// written under one temp folder, removed after each test.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'follow_the_night_as_the_owner.sh')
const CASES = join(HERE, 'follow_the_night_as_the_owner.cases.sh')
const SCRIPT_TEXT = readFileSync(SCRIPT, 'utf8')
/** The proof the script reads its words from, two folders up from it, as a mutant's copy must find it too. */
const PROOF_DIR = join(HERE, '..', '..', 'prove_a_clean_install_in_a_throwaway_container')
/** The cases' own bound is 30 s per case; the whole run stays inside this. */
const RUN_WITHIN_MS = 170_000

/** Runs the cases on `script`, all of them or the one named. @param {string} script @param {string[]} only */
const runTheCases = (script, only = []) =>
  spawnSync('bash', [CASES, script, ...only], { encoding: 'utf8', timeout: RUN_WITHIN_MS })

// Every case in one run outlasts the suite's 60 s per test, so this test names its own bound, just above the run's.
test('every case holds on the owner\'s follow script', { timeout: RUN_WITHIN_MS + 5_000 }, () => {
  const run = runTheCases(SCRIPT)
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
  assert.match(run.stdout, /^cases: 25 of 25 held$/m)
})

/**
 * Each mutant takes one fix out of the script: the one line holding `line` becomes `to` (nothing, when `to` is empty).
 * `killedBy` is the case that must then fail.
 */
const MUTANTS = [
  { name: 'the end is not read before a command is offered', line: 'a command from a night that has ended is never offered', next: true, to: '', killedBy: 'ended_offers_no_command' },
  { name: 'no terminal is not refused', line: 'if ! { [ -t 0 ] && [ -t 1 ]; }; then', to: 'if false; then', killedBy: 'no_terminal' },
  { name: 'a failed read still runs the command', line: 'if ! read -r -p "${PROMPT}" _; then', to: '    read -r -p "${PROMPT}" _; if false; then', killedBy: 'read_fails_runs_nothing' },
  { name: 'the end is not read again after Enter', line: 'The night may have ended while the prompt waited.', next: true, to: '', killedBy: 'ended_while_the_prompt_waited' },
  {
    name: 'the commands are taken from proof.log, as the script before the threat model took them',
    line: 'COMMANDS="$(from_run_txt owner_commands)"',
    to: 'COMMANDS="${LOG}.as-commands"; sed -n \'s/^  \\(ssh -t .*\\)$/\\1/p\' "${LOG}" > "${COMMANDS}"',
    killedBy: 'a_members_line_is_never_offered',
  },
  { name: 'a control character is not refused', line: "echo 'it holds a control character'", to: '', killedBy: 'a_control_character_is_refused' },
  { name: 'what runs on the host is not held to one quoted word', line: "echo 'what it runs on the host is not one quoted word'", to: '', killedBy: 'more_than_one_word_is_refused' },
  { name: 'the host is taken from run.txt, not from the owner', line: '[ "${RUN_HOST}" = "${HOST}" ]', to: 'HOST="${RUN_HOST}"', killedBy: 'run_txt_names_another_host' },
  { name: 'a host may start with -, as the pattern before r=2 let it', line: 'HOST_NAME=$', to: "HOST_NAME=$'^[A-Za-z0-9._@-]+$'", killedBy: 'a_host_starting_with_a_dash_is_refused' },
  { name: 'any command of four words is taken for podman exec -it in the night\'s container', line: "in the night's container\"; return 1; }", to: '  [[ "${inner}" =~ ^[^\\ ]*\\ [^\\ ]*\\ [^\\ ]*\\ [^\\ ]*\\ (.*)$ ]] || return 1', killedBy: 'another_container_is_refused' },
  { name: 'anything is run in the container', line: 'is not the sign-in or the attach', to: '  return 0', killedBy: 'not_the_sign_in_or_the_attach_is_refused' },
  { name: 'the sign-in is not one of the shapes', line: "=~ ^\\'sh\\'", to: '', killedBy: 'live_night_runs_the_command' },
  { name: "the attach is not one of the shapes", line: "'attach' '-t' '${BUILDER}'\" ] && { echo", to: "", killedBy: "the_attach_runs" },
  { name: "the watch is not one of the shapes", line: "'${WATCH_FLAG}' '-t' '${BUILDER}'\" ] && return 0", to: "", killedBy: "the_watch_runs" },
  { name: "the watch takes any member", line: "'${WATCH_FLAG}' '-t' '${BUILDER}'\" ] && return 0", to: "  [[ \"${rest}\" == \"'tmux' '-L' '${NIGHT_TMUX_SOCKET}' 'attach' '${WATCH_FLAG}' '-t' '\"*\"'\" ]] && return 0", killedBy: "an_attach_option_is_refused" },
  { name: "the attach takes any member", line: "'attach' '-t' '${BUILDER}'\" ] && { echo", to: "  [[ \"${rest}\" == \"'tmux' '-L' '${NIGHT_TMUX_SOCKET}' 'attach' '-t' '\"*\"'\" ]] && return 0", killedBy: "an_attach_option_is_refused" },
  { name: "the watch flag may carry more letters", line: "'${WATCH_FLAG}' '-t' '${BUILDER}'\" ] && return 0", to: "  [[ \"${rest}\" == \"'tmux' '-L' '${NIGHT_TMUX_SOCKET}' 'attach' '${WATCH_FLAG}\"*\"' '-t' '${BUILDER}'\" ]] && return 0", killedBy: "an_attach_option_is_refused" },
  { name: "any option of the attach is taken for the watch", line: "'${WATCH_FLAG}' '-t' '${BUILDER}'\" ] && return 0", to: "  [[ \"${rest}\" == \"'tmux' '-L' '${NIGHT_TMUX_SOCKET}' 'attach' \"*\"'-t' '${BUILDER}'\" ]] && return 0", killedBy: "an_attach_option_is_refused" },
  { name: 'the yes is not said to be a speed bump', line: 'printf \'   %s\\n\' "${SPEED_BUMP}"', to: '', killedBy: 'the_yes_says_it_is_a_speed_bump' },
  { name: 'the speed bump is said before every command', line: 'printf \'   %s\\n\' "${SPEED_BUMP}"', to: '    printf \'   %s\\n\' "${SPEED_BUMP}"', killedBy: 'the_yes_says_it_is_a_speed_bump' },
  { name: 'the count of whole lines says a missing file aloud, as before r=2', line: 'complete="$(', to: '  complete="$(wc -l < "${COMMANDS}" 2> /dev/null || echo 0)"', killedBy: 'the_commands_file_not_there_yet' },
  { name: 'every ended night says it passed', line: 'if [ -z "${why}" ]', to: '  if true; then', killedBy: 'a_failed_night_says_it_did_not_pass' },
  { name: 'no ended night says it passed', line: 'if [ -z "${why}" ]', to: '  if false; then', killedBy: 'a_dry_pass_says_it_passed' },
  { name: 'an interrupted night with a dry pass code passes', line: 'if [ -z "${why}" ]', to: '  if [ "${proof_exit}" = "${dry_passed}" ]; then', killedBy: 'an_interrupted_night_did_not_pass' },
]

/**
 * The script with the one line holding `line` replaced by `to`: with `next`, the line after it (the code a comment
 * names) is the one replaced. It throws unless exactly one line holds `line`.
 * @param {{ line: string, next?: boolean, to: string }} mutant
 */
const mutated = ({ line, next = false, to }) => {
  const lines = SCRIPT_TEXT.split('\n')
  const at = lines.flatMap((one, index) => (one.includes(line) ? [index] : []))
  assert.equal(at.length, 1, `the script holds the mutant's line exactly once: ${line}`)
  const target = (at[0] ?? 0) + (next ? 1 : 0)
  return [...lines.slice(0, target), ...(to === '' ? [] : [to]), ...lines.slice(target + 1)].join('\n')
}

for (const mutant of MUTANTS) {
  test(`mutant: ${mutant.name}, killed by ${mutant.killedBy}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'follow-mutant-'))
    try {
      // Laid out as the checkout is, so the copy finds the proof two folders up, as the script does.
      const folder = join(dir, basename(dirname(HERE)), basename(HERE))
      mkdirSync(folder, { recursive: true })
      symlinkSync(PROOF_DIR, join(dir, basename(PROOF_DIR)))
      const copy = join(folder, 'follow_the_night_as_the_owner.sh')
      writeFileSync(copy, mutated(mutant))
      const run = runTheCases(copy, [mutant.killedBy])
      assert.equal(run.status, 1, `${run.stdout}${run.stderr}`)
      assert.match(run.stdout, new RegExp(`^FAIL ${mutant.killedBy}: `, 'm'))
    } finally {
      removeTheTree(dir)
    }
  })
}
