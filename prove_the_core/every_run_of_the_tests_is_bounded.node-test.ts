// Every run of the tests that ships is bounded (martha#683).
//
// The rule is every_run_of_the_tests_is_bounded.ts. This reads every way the repository ships a run — every tracked shell
// script and workflow, every package folder's scripts, and every page's code blocks — and fails by file and line for a
// run missing one of the three things that bound it. It then plants a file missing each of the three, one at a time, so
// a check that stopped looking for one fails here by name rather than passing every run.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { UNREADABLE, unboundedRunsIn, type AShippedFile } from './every_run_of_the_tests_is_bounded.ts'

/** The repository this check reads. */
const repository = join(import.meta.dirname, '..')

/** Every tracked file of the repository, by its path from the top. */
function theTrackedFiles(): string[] {
  return execFileSync('git', ['-C', repository, 'ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => path !== '')
}

/** A tracked file's text. */
const textOf = (path: string): string => readFileSync(join(repository, path), 'utf8')

/** The scripts a package's manifest carries, each as one line, named by the package and the script it is. */
function thePackageScripts(path: string): AShippedFile[] {
  const manifest: unknown = JSON.parse(textOf(path))
  const scripts = (manifest as { readonly scripts?: Readonly<Record<string, string>> }).scripts ?? {}
  return Object.entries(scripts).map(([name, script]) => ({ path: `${path}#scripts.${name}`, text: script, kind: 'a package script' }))
}

/**
 * Every file the repository ships that can start a run: its shell scripts and its workflows, its package folders'
 * scripts, and its pages of prose, which are read inside their code blocks only.
 */
function theShippedRuns(): AShippedFile[] {
  const tracked = theTrackedFiles()
  const scripts = tracked
    .filter((path) => path.endsWith('.sh'))
    .map((path) => ({ path, text: textOf(path), kind: 'a shell script' as const }))
  const workflows = tracked
    .filter((path) => /^\.github\/workflows\/.*\.ya?ml$/.test(path))
    .map((path) => ({ path, text: textOf(path), kind: 'a workflow' as const }))
  const packages = tracked.filter((path) => path.endsWith('package.json')).flatMap(thePackageScripts)
  const pages = tracked
    .filter((path) => path.endsWith('.md'))
    .map((path) => ({ path, text: textOf(path), kind: 'a page of prose' as const }))
  return [...scripts, ...workflows, ...packages, ...pages]
}

/** The line a planted run of a script is: the repository's own bound flags, each of which a plant may drop. */
const A_RUN = (keep: readonly string[]): string => {
  const words = [
    'node --test',
    keep.includes('timeout') ? '--test-timeout=60000' : '',
    keep.includes('force-exit') ? '--test-force-exit' : '',
    keep.includes('guard') ? '--import=./prove_the_core/fail_a_test_file_that_leaves_something_running.ts' : '',
    "'src/**/*.node-test.ts'",
  ]
  return words.filter((word) => word !== '').join(' ')
}

const ALL_THREE = ['timeout', 'force-exit', 'guard'] as const

test('every shell script, workflow, package script and code block that starts a run of the tests bounds it (martha#683)', () => {
  const unbounded = unboundedRunsIn(theShippedRuns())
  assert.deepEqual(
    unbounded.map((run) => `${run.path}:${run.line}: ${run.problems.join('; ')} — ${run.text}`),
    [],
    'a shipped run of the tests does not bound it: it would leave a file waiting forever in a child process of its own',
  )
})

test('a run is named for each of the three things it may be missing, one at a time (martha#683)', () => {
  for (const dropped of ALL_THREE) {
    const kept = ALL_THREE.filter((one) => one !== dropped)
    const found = unboundedRunsIn([{ path: 'a_script.sh', text: `#!/usr/bin/env bash\n${A_RUN(kept)}\n` }])
    assert.equal(found.length, 1, `a run without ${dropped} was not named`)
    assert.equal(found[0]?.path, 'a_script.sh')
    assert.equal(found[0]?.line, 2, 'the run is named by its own line')
    assert.equal(found[0]?.problems.length, 1, `a run missing only ${dropped} was blamed for something else: ${found[0]?.problems.join('; ')}`)
  }
})

test('a flag variable bounds a run only as an argument of the run, never as a word printed elsewhere on the line (martha#683)', () => {
  const printed = `echo "\${GUARD_FLAG}"\n${A_RUN(['timeout', 'force-exit'])}`
  const found = unboundedRunsIn([{ path: 'a_script.sh', text: printed }])
  assert.equal(found.length, 1, 'a guard flag printed before the run was counted as the run stating it')
  assert.deepEqual(found[0]?.problems.length, 1, `the run was blamed for something else: ${found[0]?.problems.join('; ')}`)

  const passed = [
    '#!/usr/bin/env bash',
    'node --test --test-timeout="${RUN_TIMEOUT_MS}" "${FORCE_EXIT_FLAG}" "${GUARD_FLAG}" a_file.node-test.ts',
  ].join('\n')
  assert.deepEqual(unboundedRunsIn([{ path: 'a_script.sh', text: passed }]), [], 'a run passing the three as variables was named')
})

test('a run continued onto the next line is read as one run, named by the line it starts on (martha#683)', () => {
  const text = [
    '#!/usr/bin/env bash',
    'node --test --test-timeout=60000 \\',
    "  'src/**/*.node-test.ts'",
  ].join('\n')
  const found = unboundedRunsIn([{ path: 'a_script.sh', text }])
  assert.equal(found.length, 1, 'a run split over two lines was not named')
  assert.equal(found[0]?.line, 2, 'the run is named by the line it starts on')
})

test("a page of prose is read inside its code blocks, and a sentence that names the runner is not a run (martha#683)", () => {
  const text = [
    '# A page',
    '',
    'The suite runs it: node --test is what runs every file, as this sentence says.',
    '',
    '```bash',
    A_RUN(['timeout']),
    '```',
    '',
    '```text',
    'nothing runs here either',
    '```',
  ].join('\n')
  const found = unboundedRunsIn([{ path: 'a_page.md', text, kind: 'a page of prose' }])
  assert.equal(found.length, 1, 'the run in the code block was not named, or the sentence was')
  assert.equal(found[0]?.line, 6, 'the run is named by its line in the page')
  assert.equal(found[0]?.problems.length, 2, `the run was blamed for something else: ${found[0]?.problems.join('; ')}`)
})

test('a package script is one line, and a page outside a code block runs nothing (martha#683)', () => {
  const manifest = 'node prove_the_core/no_test_output_carries_the_environment.ts node --test --test-timeout=60000 --test-force-exit --import=./prove_the_core/fail_a_test_file_that_leaves_something_running.ts "src/**/*.node-test.ts"'
  assert.deepEqual(unboundedRunsIn([{ path: 'package.json#scripts.test', text: manifest, kind: 'a package script' }]), [])
  const bare = 'node --test "src/**/*.node-test.ts"'
  assert.equal(unboundedRunsIn([{ path: 'package.json#scripts.test', text: bare, kind: 'a package script' }]).length, 1)
})

test('a run that states all three is not named, and neither is a comment or a planted manifest (martha#683)', () => {
  const text = [
    '#!/usr/bin/env bash',
    `# ${A_RUN([])} is what an unbounded run looks like, on this line only as prose`,
    `printf '%s\\n' "{\\"scripts\\":{\\"test\\":\\"node --test 'src/**/*.node-test.ts'\\"}}" > "$repo/package.json"`,
    A_RUN(ALL_THREE),
    'node --test --test-timeout="${RUN_TIMEOUT_MS}" "${FORCE_EXIT_FLAG}" "${GUARD_FLAG}" a_file.node-test.ts',
  ].join('\n')
  assert.deepEqual(unboundedRunsIn([{ path: 'a_script.sh', text }]), [])
})

// The shell reader (martha#727): the runner's words are a run where they are words of a command, and data where they
// are text inside one quoted word, unless something the shell hands that word to runs it. Each case below is planted
// in a script of its own and fails by its own name.

/** A planted script's unbounded runs, as `line: text`. */
const theRunsNamedIn = (script: string): string[] =>
  unboundedRunsIn([{ path: 'a_script.sh', text: script }]).map((run) => `${run.line}: ${run.text}`)

/** The bound run's own flags, so a case can plant a run that states all three. */
const BOUNDED = '--test-timeout=60000 --test-force-exit --import=./prove_the_core/fail_a_test_file_that_leaves_something_running.ts'

/** Scripts the shell runs the runner in, each with the line it is named by (martha#727's design, r=1, r=2 and A-C). */
const RUNS: ReadonlyArray<{ readonly name: string; readonly script: string; readonly line: number; readonly text?: string }> = [
  { name: '"`…`" runs: inside double quotes the shell still runs backticks', script: 'echo "a `node --test x` b"', line: 1 },
  { name: '"$(…)" runs: inside double quotes the shell still runs a substitution', script: 'echo "$(node --test x)"', line: 1 },
  { name: "bash -c '…' runs its command string", script: "bash -c 'node --test x'", line: 1 },
  { name: 'eval "…" runs its words', script: 'eval "node --test x"', line: 1 },
  { name: "ssh host '…' runs its remote command", script: "ssh host 'node --test x'", line: 1 },
  { name: 'a quoted heredoc body is a script of its own', script: "cat > f <<'EOF'\nnode --test x\nEOF", line: 2 },
  { name: 'a heredoc a shell reads is a script of its own', script: 'bash <<EOF\nnode --test x\nEOF', line: 2 },
  { name: "$'…' closes where the shell closes it, at its unescaped quote", script: "echo $'it\\'s node --test'\nnode --test y", line: 2 },
  { name: "bash <<< '…' runs the here-string", script: "bash <<< 'node --test x'", line: 1 },
  { name: "timeout 60 sh -c '…': a shell after a wrapper", script: "timeout 60 sh -c 'node --test x'", line: 1 },
  { name: "podman exec C sh -lc '…': c inside a flag cluster", script: "podman exec C sh -lc 'node --test x'", line: 1 },
  { name: "bash -euc '…': c last in a cluster", script: "bash -euc 'node --test x'", line: 1 },
  { name: "ssh -n h '…': a flag with no value", script: "ssh -n h 'node --test x'", line: 1 },
  { name: "ssh -tt h '…': a cluster with no value", script: "ssh -tt h 'node --test x'", line: 1 },
  { name: "ssh -o BatchMode=yes -p 22 h '…': values apart", script: "ssh -o BatchMode=yes -p 22 h 'node --test x'", line: 1 },
  { name: "ssh -p22 h '…': a value attached", script: "ssh -p22 h 'node --test x'", line: 1 },
  { name: 'RUN=(…) then "${RUN[@]}": an array of quoted words run', script: "RUN=('node' '--test' x)\n\"${RUN[@]}\"", line: 1, text: 'RUN=(node --test x)' },
  { name: 'RUN=(…) then ${RUN[*]}', script: "RUN=('node' '--test' x)\n${RUN[*]}", line: 1, text: 'RUN=(node --test x)' },
  { name: 'local RUN=… then $RUN, in a function', script: "f() {\n  local RUN='node --test x'\n  $RUN\n}", line: 2 },
  { name: 'export RUN=… then eval "$RUN"', script: "export RUN='node --test x'\neval \"$RUN\"", line: 1 },
  { name: 'declare -a RUN=(…) then timeout 9 "${RUN[@]}"', script: 'declare -a RUN=(node --test x)\ntimeout 9 "${RUN[@]}"', line: 1, text: 'RUN=(node --test x)' },
  { name: "RUN='…' then \"$RUN\" alone: a name run as a command", script: "RUN='node --test x'\n\"$RUN\"", line: 1 },
  { name: "RUN='…' then timeout 9 \"${RUN[@]}\": a name run after a wrapper", script: "RUN='node --test x'\ntimeout 9 \"${RUN[@]}\"", line: 1 },
  { name: "printf '…' | sh: a pipe into a shell that reads its input", script: "printf '%s\\n' 'node --test x' | sh", line: 1 },
  { name: 'a function forwarding "$@" to ssh runs what it is handed', script: "f() { ssh -n h \"$@\"; }\nf 'node --test x'", line: 2 },
  { name: 'a chain of forwarding functions', script: "f() { ssh -n h \"$@\"; }\ng() { f \"$1\"; }\ng 'node --test x'", line: 3 },
  { name: "bash -o pipefail -c '…': -o takes its value", script: "bash -o pipefail -c 'node --test x'", line: 1 },
  { name: "printf '…' | bash -o pipefail: -o's value is no script file", script: "printf '%s\\n' 'node --test x' | bash -o pipefail", line: 1 },
  { name: "env -S '…' runs its value", script: "env -S 'node --test x'", line: 1 },
  { name: 'a run ends at its own command: flags after a ; bound nothing', script: `node --test x; echo ${BOUNDED}`, line: 1 },
  { name: 'a pipe into a shell, continued on the next line', script: "printf '%s\\n' 'node --test x' |\n  sh", line: 1 },
  { name: 'a function written `function f { … }` forwards too', script: "function f { ssh -n h \"$@\"; }\nf 'node --test x'", line: 2 },
  { name: 'RUN+=(…) appends to what RUN holds', script: 'RUN=(node)\nRUN+=(--test x)\n"${RUN[@]}"', line: 2, text: 'RUN+=(--test x)' },
  { name: 'a substitution in an array element runs', script: 'RUN=($(node --test x))', line: 1, text: 'node --test x' },
  { name: '<(…) runs: a process substitution the command reads', script: 'diff <(node --test x) /dev/null', line: 1, text: 'node --test x' },
  { name: '>(…) runs: a process substitution the command writes to', script: 'echo y > >(node --test x)', line: 1, text: 'node --test x' },
  { name: 'done < <(…): a process substitution a redirection reads', script: 'while read -r l; do echo "$l"; done < <(node --test x)', line: 1, text: 'node --test x' },
  // The programs whose own option hands its value to a shell (martha#759).
  { name: "su -c '…' runs its command string in the target user's shell", script: "su -c 'node --test x' u", line: 1 },
  { name: "su - u -c '…': the option after a positional word is still found", script: "su - u -c 'node --test x'", line: 1 },
  { name: "su --command='…' runs its value", script: "su --command='node --test x' u", line: 1 },
  { name: "runuser -c '…' runs its command string", script: "runuser -c 'node --test x' u", line: 1 },
  { name: "flock … -c '…' runs its command string", script: "flock -x l -c 'node --test x'", line: 1 },
  { name: "script -qc '…': c last in a cluster", script: "script -qc 'node --test x' /dev/null", line: 1 },
  { name: "script --command '…' runs its value", script: "script --command 'node --test x'", line: 1 },
  { name: 'a flock behind a wrapper is still found', script: "sudo flock l -c 'node --test x'", line: 1 },
  { name: 'watch joins its words and hands them to a shell', script: "watch 'node --test x'", line: 1, text: 'node --test x' },
  { name: "watch -n 5 '…': a value joins the string, and the run is still found", script: "watch -n 5 'node --test x'", line: 1, text: '5 node --test x' },
  // A here-document body read as a script, then line by line when its quoting does not close (martha#759).
  { name: 'a written script whose body holds an apostrophe still names its run', script: "cat > f <<EOF\nit's\nnode --test x\nEOF", line: 3 },
  { name: 'a substitution in an unquoted body after an apostrophe is still found', script: "cat <<EOF\nit's\n$(node --test x)\nEOF", line: 3 },
  // npm hands its -c value to a shell, under a two-word program (martha#759's r=2).
  { name: "npm exec -c '…' runs its value through script-shell", script: "npm exec -c 'node --test x'", line: 1 },
  { name: "npm exec --call='…' runs its value", script: "npm exec --call='node --test x'", line: 1 },
  { name: "npm x -c '…': npm's own short name", script: "npm x -c 'node --test x'", line: 1 },
  { name: "npx -c '…' runs its value", script: "npx -c 'node --test x'", line: 1 },
  { name: "ksh -c '…' runs its command string", script: "ksh -c 'node --test x'", line: 1 },
  { name: "mksh -c '…' runs its command string", script: "mksh -c 'node --test x'", line: 1 },
  { name: "fish -c '…' runs its command string", script: "fish -c 'node --test x'", line: 1 },
  // GNU parallel runs its arguments as shell command lines (martha#759's r=2).
  { name: 'parallel ::: runs each argument as a command line', script: "parallel ::: 'node --test x'", line: 1 },
  { name: 'parallel runs its command template through a shell', script: "parallel 'node --test x {}' ::: x", line: 1, text: 'node --test x {}' },
  { name: 'parallel -j2: an option before its template', script: "parallel -j2 'node --test x {}' ::: x", line: 1, text: 'node --test x {}' },
  { name: 'a pipe into parallel is a pipe into a program that runs its input', script: "printf '%s\\n' 'node --test x' | parallel", line: 1 },
]

for (const { name, script, line, text } of RUNS) {
  test(`the shell runs this, so it is named: ${name} (martha#727)`, () => {
    const named = theRunsNamedIn(script)
    assert.equal(named.length, 1, `named ${named.length} time(s), not once: ${named.join(' | ')}`)
    assert.ok(named[0]?.startsWith(`${line}: `), `named by the wrong line: ${named[0]}`)
    if (text !== undefined) assert.equal(named[0], `${line}: ${text}`)
  })
}

/** Scripts where the runner's words are only data, or a run the shell runs is bounded. */
const DATA: ReadonlyArray<{ readonly name: string; readonly script: string }> = [
  { name: "'…`…`…': inside single quotes backticks are text", script: "echo 'a `node --test x` b'" },
  { name: "RUN='…' alone is a value, not a run", script: "RUN='node --test x'" },
  { name: 'a here-string fed to grep is data, and opens no heredoc', script: 'grep -Fq -- x <<<"${y}"\necho done' },
  { name: "ssh -i '…' h true: the quoted word is -i's value", script: "ssh -i 'node --test x' h true" },
  { name: "ssh -P '…' h true: the quoted word is -P's value", script: "ssh -P 'node --test x' h true" },
  { name: "ssh -p 22 '…': the word after -p's value is the host, and nothing runs remotely", script: "ssh -p 22 'node --test x'" },
  { name: "RUN='…' then printf '%s' \"${RUN}\": a name printed", script: "RUN='node --test x'\nprintf '%s\\n' \"${RUN}\"" },
  { name: "RUN='…'; jq --arg b \"$RUN\": a name handed to a program as data", script: "RUN='node --test x'; jq -n --arg b \"$RUN\" '$b'" },
  { name: 'a function that prints "$@" forwards nothing', script: "f() { printf '%s\\n' \"$@\"; }\nf 'node --test x'" },
  { name: 'a manifest written by printf, its runner in one quoted word', script: `printf '%s' '{"scripts":{"test":"node --test x"}}' > package.json` },
  { name: "bash -c '…' with a bounded run", script: `bash -c 'node --test ${BOUNDED} x'` },
  { name: 'a held run that is bounded', script: `RUN=(node --test ${BOUNDED} x)\n"\${RUN[@]}"` },
  { name: "an escaped quote outside quotes opens nothing", script: "echo don\\'t; printf '%s' 'node --test x'" },
  { name: 'an escaped double quote inside double quotes closes nothing', script: 'echo "say \\"node --test x\\" here"' },
  { name: 'a name expanded in a heredoc body is text written to a file', script: "RUN='node --test x'\ncat > f <<EOF\n$RUN\nEOF" },
  { name: 'a <<- heredoc closes at its tab-indented delimiter', script: 'cat <<-EOF\n\tx\n\tEOF\necho done' },
  { name: "a function's body ends at its closing brace", script: "f() { echo; }\nssh -n h \"$1\"\nf 'node --test x'" },
  { name: 'a shell given a script file reads no script on its input', script: "printf '%s\\n' 'node --test x' | bash ./a.sh" },
  { name: 'a comment is prose', script: '# node --test x is what a run looks like' },
  { name: "'<(…)' inside single quotes is text", script: "echo '<(node --test x)'" },
  // A here-document's body is text: an apostrophe in it is a plain character, not a quote (martha#759).
  { name: 'an apostrophe in an unquoted heredoc body is prose', script: "cat <<EOF\nit's prose\nEOF" },
  { name: "an apostrophe in a quoted heredoc body is prose", script: "cat <<'EOF'\nit's prose\nEOF" },
  { name: 'an apostrophe in a <<- heredoc body is prose', script: "cat <<-EOF\n\tit's prose\n\tEOF" },
  // The programs whose option hands a string to a shell, when that string runs nothing unbounded (martha#759).
  { name: "su -c '…' with a command that runs nothing unbounded", script: "su -c 'echo hi' u" },
  { name: 'flock with no -c runs its own argv', script: 'flock l true' },
  { name: 'watch -x runs a command line, not a shell string', script: 'watch -x ls' },
  { name: "npx -c '…' with a command that runs nothing unbounded", script: "npx -c 'echo hi'" },
  { name: 'npx without -c runs a package binary', script: 'npx eslint .' },
  { name: 'parallel with a template runs nothing unbounded', script: 'parallel echo ::: a' },
  { name: "parallel :::: names files, and a file name that holds the runner is a file name", script: "parallel :::: 'node --test x'" },
  { name: 'a pipe into parallel that is given a template is not run line by line', script: "printf '%s\\n' 'node --test x' | parallel echo" },
  { name: "watch -x '…' runs a command line of its own, not a shell string", script: "watch -x 'node --test x'" },
  { name: "npm's other commands do not run -c: only npm exec and npm x do", script: "npm view -c 'node --test x'" },
]

for (const { name, script } of DATA) {
  test(`this runs nothing unbounded, so it passes: ${name} (martha#727)`, () => {
    assert.deepEqual(theRunsNamedIn(script), [])
  })
}

/** Scripts whose quoting does not close: refused by name, at the line it opened on (martha#727, #759's B, D and E). */
const UNREADABLE_SCRIPTS: ReadonlyArray<{ readonly name: string; readonly script: string; readonly line: number }> = [
  { name: 'a here-document body a shell reads is a script, and an apostrophe still refuses it', script: "bash <<EOF\nit's\nEOF", line: 2 },
  { name: 'a body piped into a shell is read by a shell, so its apostrophe still refuses it', script: "cat <<'EOF' | bash\nit's\nEOF", line: 2 },
  { name: 'a shell reading its input takes the body, and ksh is one', script: "ksh <<EOF\nit's\nEOF", line: 2 },
  { name: "fish's own quoting is not sh's, so its -c string is refused rather than read as what fish runs", script: 'fish -c "echo \'it\\\'s\'"', line: 1 },
]

for (const { name, script, line } of UNREADABLE_SCRIPTS) {
  test(`this is refused, and said by name: ${name} (martha#759)`, () => {
    const found = unboundedRunsIn([{ path: 'a_script.sh', text: script }])
    assert.deepEqual(
      found.map((run) => [run.line, run.problems]),
      [[line, [UNREADABLE]]],
      `named ${JSON.stringify(found.map((run) => [run.line, run.problems]))}, not one UNREADABLE at line ${line}`,
    )
  })
}

test('the Done-when case: a two-line quoted value holding the runner is data, the command after it is named by its own line (martha#727)', () => {
  const script = ['#!/usr/bin/env bash', "X='a fixture, node --test", "  over two lines'", 'node --test x'].join('\n')
  assert.deepEqual(theRunsNamedIn(script), ['4: node --test x'])
})

test('a name holding the runner is named by the line that gave it, once it is run (martha#727)', () => {
  assert.deepEqual(theRunsNamedIn("RUN='node --test x'\necho one\n$RUN"), ["1: RUN=node --test x"])
  assert.deepEqual(theRunsNamedIn("RUN='node --test x'\necho one\neval \"$RUN\""), ["1: RUN=node --test x"])
})

test('a quote that never closes is named at the line it opened on, and the script never passes (martha#727)', () => {
  const found = unboundedRunsIn([{ path: 'a_script.sh', text: "echo ok\necho 'it does not close\nnode --test x\n" }])
  assert.deepEqual(found.map((run) => [run.line, run.problems]), [[2, [UNREADABLE]]])
})

test('a page reads each shell block with a fresh reader, and its other blocks line by line (martha#727)', () => {
  const page = ['# A page', '```bash', "echo 'opens", '```', '```sh', 'node --test x', '```', '```text', "don't", 'node --test y', '```'].join('\n')
  const found = unboundedRunsIn([{ path: 'a_page.md', text: page, kind: 'a page of prose' }])
  assert.deepEqual(found.map((run) => `${run.line}: ${run.problems.length === 1 && run.problems[0] === UNREADABLE ? 'unreadable' : run.text}`).sort(), [
    '10: node --test y',
    '3: unreadable',
    '6: node --test x',
  ])
})
