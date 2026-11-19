// What the check answers over a planted tree (martha#741): the entry is spawned with `--root` over a package.json and
// a .github/workflows/ the test plants, and every case holds the exit code AND the exact lines, never the status alone:
// node itself exits 1 on a missing entry.
//
// The mutants, each with the case that kills it (the design's table, r=1 and r=2):
//   - direction 1 dropped (scripts not read against jobs): 2;  direction 2 dropped (jobs not read against scripts): 3;
//   - the `node <entry>` form not recognised: 4, 10;  comment lines read: 5;  no boundary after the name: 6;
//   - the `on:` trigger not read: 7;  only ci.yml read: 3 (the job is in a second file), 7's words;
//   - a stale exception accepted: 8;  exit 0 where a file cannot be read: 9;
//   - any mentioning line counts as a run: 11, 12;  the paths filter not read: 13;
//   - an unparsed `on:` read as no trigger: 14;  zero job headers read as no jobs: 15;
//   - check:posted-text's exception dropped: 10;  the self-test plants nothing: the self-test case;
//   - a run whose exit is swallowed (||, a pipe, a trailing &) counts: 16;
//   - a block on:'s pull_request: with an inline value read as every pull request: 17;
//   - --root with no value read as the checkout: 18.
//
// Every planted package.json also declares the excused scripts, run by no job, as the real tree does, so the cases see
// only what they plant.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { WORKFLOW } from '../../prove_the_core/the_release_is_proven/the_installer_jobs_steps.ts'
import { MANIFEST } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { EXCEPTIONS } from './the_exceptions.ts'

const CHECKOUT = join(import.meta.dirname, '..', '..')
const ENTRY = join(import.meta.dirname, 'main.ts')
const SAID = 'check_every_check_runs_in_a_job: '
const WORKFLOWS = dirname(WORKFLOW)
const inWorkflows = (name: string): string => join(WORKFLOWS, name)

/** A workflow every pull request triggers. */
const ON_EVERY_PULL_REQUEST = 'on:\n  push:\n    branches: [main]\n  pull_request:\n'
/** One job, `id`, whose steps are `steps`, one line each. */
const aJob = (id: string, ...steps: string[]): string => `  ${id}:\n    runs-on: ubuntu-latest\n    steps:\n${steps.map((step) => `      ${step}\n`).join('')}`
/** A workflow: its `on:` and its jobs. */
const aWorkflow = (on: string, ...jobs: string[]): string => `${on}jobs:\n${jobs.join('')}`

interface Planted {
  readonly scripts: Readonly<Record<string, string>>
  readonly workflows: Readonly<Record<string, string>>
  /** Whether package.json declares the excused scripts, as the real tree does. */
  readonly excused?: boolean
}

/** A tree the test owns, removed when it ends. */
function plantedTree(t: TestContext, { scripts, workflows, excused = true }: Planted): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-741-checks-'))
  t.after(() => removeTheTree(root))
  const declared = excused ? Object.fromEntries(EXCEPTIONS.map(({ script }) => [script, 'node an_excused_check.ts'])) : {}
  mkdirSync(join(root, WORKFLOWS), { recursive: true })
  writeFileSync(join(root, MANIFEST), JSON.stringify({ scripts: { ...declared, ...scripts } }))
  for (const [name, text] of Object.entries(workflows)) writeFileSync(join(root, WORKFLOWS, name), text)
  return root
}

/** The command's verdict on `args`: its exit code, and its lines, each without the check's prefix. */
function theCommand(...args: string[]): { readonly status: number | null; readonly out: string[]; readonly err: string[] } {
  const ran = spawnSync(process.execPath, [ENTRY, ...args], { encoding: 'utf8' })
  const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '').map((line) => line.replace(SAID, ''))
  return { status: ran.status, out: lines(ran.stdout), err: lines(ran.stderr) }
}

const CI = inWorkflows('ci.yml')
const unrun = (check: string, elsewhere = ''): string =>
  `${check} (package.json) is run by no job a pull request triggers${elsewhere}: add a job to ${WORKFLOW} that runs npm run --silent ${check}.`
const findings = (...lines: string[]): string[] => [...lines, `${lines.length} finding(s)`]
const passed = (checks: number): string => `${checks + EXCEPTIONS.length} check: script(s) read, each run by a job a pull request triggers or excused`

test('1: every check script run by a job every pull request triggers is a pass, and nothing is said on stderr', (t) => {
  const root = plantedTree(t, {
    scripts: { 'check:a': 'node a.ts', 'check:b': 'node b.ts', lint: 'eslint .' },
    workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('one', '- run: npm run --silent check:a'), aJob('two', '- run: npm run check:b -- --range "$RANGE"')) },
  })
  assert.deepEqual(theCommand('--root', root), { status: 0, out: [passed(2)], err: [] })
})

test('2: a check script no job runs fails by name, and the line says where to add its job', (t) => {
  const root = plantedTree(t, { scripts: { 'check:a': 'node a.ts' }, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm test')) } })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(unrun('check:a')) })
})

test('3: a job in any workflow that names a check script package.json does not declare fails, by file and job', (t) => {
  const root = plantedTree(t, {
    scripts: { 'check:a': 'node a.ts' },
    workflows: {
      'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm run --silent check:a')),
      'release.yml': aWorkflow("on:\n  push:\n    tags: ['v*']\n", aJob('release', '- run: npm run check:gone')),
    },
  })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(`${inWorkflows('release.yml')} job release runs check:gone, which package.json does not declare.`) })
})

test('4: a check run as node <its entry> is run, and an on: written as a list is read', (t) => {
  const root = plantedTree(t, { scripts: { 'check:a': 'node src/a/main.ts' }, workflows: { 'ci.yml': aWorkflow('on: [push, pull_request]\n', aJob('gate', '- run: node ./src/a/main.ts --tree')) } })
  assert.deepEqual(theCommand('--root', root), { status: 0, out: [passed(1)], err: [] })
})

test('5: a comment line is never read: a run in one is not a run, and an undeclared name in one is not named', (t) => {
  const root = plantedTree(t, {
    scripts: { 'check:a': 'node a.ts' },
    workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '# - run: npm run --silent check:a', '# npm run --silent check:an-old-name', '- run: npm test')) },
  })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(unrun('check:a')) })
})

test('6: a run of check:foo-bar runs not check:foo, and check:foo-bar undeclared is named', (t) => {
  const root = plantedTree(t, { scripts: { 'check:foo': 'node foo.ts' }, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm run --silent check:foo-bar')) } })
  assert.deepEqual(theCommand('--root', root), {
    status: 1,
    out: [],
    err: findings(unrun('check:foo'), `${CI} job gate runs check:foo-bar, which package.json does not declare.`),
  })
})

test('7: a check run only in a workflow no pull request triggers fails, with where it does run', (t) => {
  const root = plantedTree(t, {
    scripts: { 'check:a': 'node a.ts' },
    workflows: {
      'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm test')),
      'release.yml': aWorkflow("on:\n  push:\n    tags: ['v*']\n", aJob('release', '- run: npm run check:a')),
    },
  })
  const elsewhere = `; it runs only in ${inWorkflows('release.yml')} (release), which no pull request triggers`
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(unrun('check:a', elsewhere)) })
})

test('8: an exception the tree no longer bears out is a finding: one a pull request runs, and one not declared', (t) => {
  const [excused] = EXCEPTIONS
  assert.ok(excused !== undefined, 'the list names the exception this case reads')
  const said = `${excused.script} is excused (${excused.reason}), but`
  const run = plantedTree(t, { scripts: {}, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', `- run: npm run --silent ${excused.script}`)) } })
  assert.deepEqual(theCommand('--root', run), { status: 1, out: [], err: findings(`${said} ${CI} (gate) runs it on every pull request: drop its exception.`) })
  const gone = plantedTree(t, { scripts: {}, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm test')) }, excused: false })
  const stale = EXCEPTIONS.map(({ script, reason }) => `${script} is excused (${reason}), but package.json does not declare it: drop its exception.`)
  assert.deepEqual(theCommand('--root', gone), { status: 1, out: [], err: findings(...stale) })
})

test('9: a package.json or a workflow that cannot be read is a check that could not be made, exit 2', (t) => {
  const manifest = plantedTree(t, { scripts: {}, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm test')) } })
  writeFileSync(join(manifest, MANIFEST), '{ not json')
  const first = theCommand('--root', manifest)
  assert.equal(first.status, 2, first.err.join('\n'))
  assert.match(first.err.join('\n'), /^the check could not be made: /)
  const workflow = plantedTree(t, { scripts: {}, workflows: {} })
  mkdirSync(join(workflow, WORKFLOWS, 'ci.yml'))
  const second = theCommand('--root', workflow)
  assert.equal(second.status, 2, second.err.join('\n'))
  assert.match(second.err.join('\n'), /^the check could not be made: .*EISDIR/)
})

test('10: the real tree passes: every check script of this repository is run by a job every pull request triggers', () => {
  const { status, out, err } = theCommand('--root', CHECKOUT)
  assert.equal(status, 0, err.join('\n'))
  assert.equal(out.length, 1, out.join('\n'))
})

test('11: a check whose only mention is a line inside a run: | block is not run', (t) => {
  const root = plantedTree(t, {
    scripts: { 'check:a': 'node a.ts' },
    workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: |', '    npm run --silent check:a -- --root "$planted" || status=$?')) },
  })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(unrun('check:a')) })
})

test('12: a check whose only run is its --self-test is not run', (t) => {
  const root = plantedTree(t, { scripts: { 'check:a': 'node a.ts' }, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm run --silent check:a -- --self-test')) } })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(unrun('check:a')) })
})

test('13: a check run only in a workflow whose pull_request trigger is filtered by paths: is not run on every change', (t) => {
  const root = plantedTree(t, {
    scripts: { 'check:a': 'node a.ts' },
    workflows: {
      'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm test')),
      'docs.yml': aWorkflow("on:\n  pull_request:\n    paths: ['docs/**']\n", aJob('docs', '- run: npm run --silent check:a')),
    },
  })
  const elsewhere = `; it runs only in ${inWorkflows('docs.yml')} (docs), whose pull_request trigger is filtered by paths:`
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(unrun('check:a', elsewhere)) })
})

test('14: an on: the reader cannot read is never read as no trigger: exit 2, naming the file', (t) => {
  const root = plantedTree(t, { scripts: {}, workflows: { 'ci.yml': aWorkflow('on: { pull_request: {} }\n', aJob('gate', '- run: npm test')) } })
  assert.deepEqual(theCommand('--root', root), { status: 2, out: [], err: [`the check could not be made: ${CI}: its on: cannot be read`] })
})

test('15: a jobs: whose jobs the reader cannot see is never read as no jobs: exit 2, naming the file', (t) => {
  const root = plantedTree(t, { scripts: {}, workflows: { 'ci.yml': `${ON_EVERY_PULL_REQUEST}jobs:\n    gate:\n      steps:\n        - run: npm test\n` } })
  assert.deepEqual(theCommand('--root', root), { status: 2, out: [], err: [`the check could not be made: ${CI}: jobs: holds no job this reader can see`] })
})

test('the self-test plants a check no job runs and requires it named', () => {
  assert.deepEqual(theCommand('--self-test'), { status: 0, out: ['the check bites, check:planted named'], err: [] })
})

test('16: a one-line run whose exit the step swallows is not a run: ||, a pipe, a trailing &; && still is', (t) => {
  const swallowed = ['- run: npm run --silent check:a || true', '- run: npm run --silent check:a | tee out.txt', '- run: node a.ts &']
  for (const step of swallowed) {
    const root = plantedTree(t, { scripts: { 'check:a': 'node a.ts' }, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', step)) } })
    assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(unrun('check:a')) }, step)
  }
  const kept = plantedTree(t, { scripts: { 'check:a': 'node a.ts' }, workflows: { 'ci.yml': aWorkflow(ON_EVERY_PULL_REQUEST, aJob('gate', '- run: npm run --silent check:a && echo done')) } })
  assert.deepEqual(theCommand('--root', kept), { status: 0, out: [passed(1)], err: [] })
})

test('17: a block on: whose pull_request: carries an inline value is never read as every pull request: exit 2', (t) => {
  const root = plantedTree(t, {
    scripts: { 'check:a': 'node a.ts' },
    workflows: { 'ci.yml': aWorkflow('on:\n  pull_request: { paths: [docs/**] }\n', aJob('gate', '- run: npm run --silent check:a')) },
  })
  assert.deepEqual(theCommand('--root', root), { status: 2, out: [], err: [`the check could not be made: ${CI}: its on: cannot be read`] })
})

test('18: --root with no value is never read as the checkout: exit 2, naming it', () => {
  assert.deepEqual(theCommand('--root'), { status: 2, out: [], err: ['the check could not be made: --root names no directory'] })
})
