// The owner's to-do list (martha#316): what a row may hold, how the list is folded from its stream, the checks that
// take a row off by themselves, and what the owner is shown. Each test names the mutant of the design that it kills.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { ACTS, OWNER } from '../declare_crew/declare_crew.ts'
import { soloDeclaration } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import {
  ACT_ASKED_OF_OWNER,
  ACT_DONE_BY_OWNER,
  A_MEMBER_WROTE_THIS,
  NOTHING_WAITS_ON_THE_OWNER,
  OWNER_TODO_STREAM,
  addAnAct,
  checkArgv,
  checkDone,
  closeAnAct,
  commandLine,
  mayKeepTheOwnersList,
  sweepTheList,
  theActAsked,
  theListForThePane,
  theListForTheTerminal,
  theOpenRows,
  type SweepingHost,
  type TheDeclaration,
  type TodoHost,
} from './keep_the_owners_todo_list.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-owners-todo-'))
after(() => removeTheTree(homeOfAll))

const NOW = 5_000_000

/** A host over a row store of its own, in a directory no other test shares. */
let storesSoFar = 0
function aHost(): TodoHost {
  storesSoFar += 1
  const rows = join(homeOfAll, `rows-${storesSoFar}`)
  mkdirSync(rows, { mode: STREAM_DIRECTORY_MODE })
  return { clock: { now: () => NOW }, stores: { rows: rowStreamsDirectory(rows) } }
}

/** One act as a row asks it, with `changes` laid over it. */
const anAct = (changes: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> => ({
  id: 'martha-316',
  title: 'Merge the to-do list',
  goal: 'The owner sees what waits on them',
  waiting_on: 'Supervisor',
  commands: [
    { command: 'gh pr merge 400 -R macula-io/martha --merge', does: 'merges the pull request; success prints its merge commit' },
    { command: 'git -C ~/martha pull --ff-only', does: 'brings your clone up to date' },
  ],
  ...changes,
})

/** The refusal a call is answered with, failing when it was taken. */
function refusalOf(answer: object): string {
  assert.ok('refused' in answer, `the row was taken; it must be refused: ${JSON.stringify(answer)}`)
  return (answer as { refused: string }).refused
}

const aCommand = (command: string, does = 'does a thing'): Readonly<Record<string, unknown>> => anAct({ commands: [{ command, does }] })

test('#316 test 1: a command with a control character is refused by name', () => {
  assert.match(refusalOf(theActAsked(aCommand('echo a\u0007b'), 'Pallas', NOW)), /^commands\[0\]\.command holds a control or hidden character/)
})

test('#316 test 1: a command with a zero-width character is refused by name', () => {
  assert.match(refusalOf(theActAsked(aCommand('rm​ -rf build'), 'Pallas', NOW)), /^commands\[0\]\.command holds a control or hidden character/)
})

test('#316 test 1: a command with a trailing space is refused by name', () => {
  assert.match(refusalOf(theActAsked(aCommand('git push '), 'Pallas', NOW)), /^commands\[0\]\.command starts or ends with a space/)
})

test('#316 test 1: a command with no does is refused by name', () => {
  assert.match(refusalOf(theActAsked(anAct({ commands: [{ command: 'git push' }] }), 'Pallas', NOW)), /^commands\[0\]\.does is missing/)
})

test('#316 test 1: a check of no known kind is refused by name', () => {
  assert.match(refusalOf(theActAsked(anAct({ check: { shell: 'true' } }), 'Pallas', NOW)), /^check is of no known kind/)
})

test('#316: a title with a newline is refused by name, so a row cannot draw a second line', () => {
  assert.match(refusalOf(theActAsked(anAct({ title: 'one\ntwo' }), 'Pallas', NOW)), /^title holds a control or hidden character/)
})

test('#316: a command holding a token is refused, naming its prefix', () => {
  const refused = refusalOf(theActAsked(aCommand('gh auth login --with-token ghp_abcdefghijklmnopqrstuvwxyz0123'), 'Pallas', NOW))
  assert.match(refused, /^commands\[0\]\.command holds what reads as a secret \(it starts ghp_\)/)
})

test('#316: a command naming the variable that holds a token is taken', () => {
  const asked = theActAsked(aCommand('gh secret set HEX_API_KEY --body "$HEX_API_KEY"'), 'Pallas', NOW)
  assert.ok(!('refused' in asked), `a command naming a variable was refused: ${'refused' in asked ? asked.refused : ''}`)
})

test('#316 test 2: each check becomes exactly its fixed argv', () => {
  assert.deepEqual(checkArgv({ pr_merged: { repo: 'macula-io/martha', number: 400 } }), ['gh', 'api', 'repos/macula-io/martha/pulls/400', '--jq', '.merged'])
  assert.deepEqual(checkArgv({ tag_exists: { repo: 'macula-io/martha', tag: 'v0.2.0' } }), ['gh', 'api', 'repos/macula-io/martha/git/ref/tags/v0.2.0'])
})

test('#316 test 2: a tag with .. is refused, so it cannot walk the API path', () => {
  assert.match(refusalOf(theActAsked(anAct({ check: { tag_exists: { repo: 'macula-io/martha', tag: 'v1/../../x' } } }), 'Pallas', NOW)), /^check\.tag_exists names no repository/)
})

test('#316 test 2: a repository that would add a flag is refused', () => {
  assert.match(refusalOf(theActAsked(anAct({ check: { pr_merged: { repo: '--jq', number: 1 } } }), 'Pallas', NOW)), /^check\.pr_merged names no repository/)
})

test('#316 test 3: pr_merged is done only on exit 0 and stdout true', () => {
  const check = { pr_merged: { repo: 'macula-io/martha', number: 400 } }
  assert.equal(checkDone(check, { exit_code: 0, stdout: 'true\n' }), true, 'a merged pull request did not read as done')
  assert.equal(checkDone(check, { exit_code: 0, stdout: 'false\n' }), false, 'an unmerged pull request read as done because gh exited 0')
  assert.equal(checkDone(check, { exit_code: 1, stdout: 'true' }), false, 'a check that failed read as done')
})

test('#316 test 4: two adds of one id racing on one stream leave one row, and the other is told why', async () => {
  const host = aHost()
  const answers = await Promise.all([addAnAct(host, anAct(), 'Pallas'), addAnAct(host, anAct(), 'Vesta')])
  const asked = (await host.stores.rows.read(OWNER_TODO_STREAM)).filter((stored) => stored.row['kind'] === ACT_ASKED_OF_OWNER)
  assert.equal(asked.length, 1, `two racing adds of one id both landed: ${JSON.stringify(answers)}`)
  assert.equal(answers.filter((answer) => 'told' in answer).length, 1, `exactly one add is told it landed: ${JSON.stringify(answers)}`)
})

test('#316 test 5: a done act leaves the open list, and the stream still holds both rows', async () => {
  const host = aHost()
  assert.ok('told' in (await addAnAct(host, anAct(), 'Pallas')), 'the test could not add the act')
  assert.ok('told' in (await closeAnAct(host, 'martha-316', { by: 'member', member: 'Pallas' })), 'the act could not be closed')
  const stored = await host.stores.rows.read(OWNER_TODO_STREAM)
  assert.deepEqual(theOpenRows(stored), [], 'the fold kept an act that was done')
  assert.deepEqual(stored.map((one) => one.row['kind']), [ACT_ASKED_OF_OWNER, ACT_DONE_BY_OWNER], 'the stream lost the history of the act')
})

test('#316: an act already on the list is not added twice, and one not on it is not closed', async () => {
  const host = aHost()
  assert.ok('told' in (await addAnAct(host, anAct(), 'Pallas')), 'the test could not add the act')
  assert.match(refusalOf(await addAnAct(host, anAct(), 'Pallas')), /is already on the owner's list/)
  assert.match(refusalOf(await closeAnAct(host, 'another', { by: 'member', member: 'Pallas' })), /is not on the owner's list/)
})

test('#316: the add answers with the row\'s id and nothing of its text', async () => {
  const answer = await addAnAct(aHost(), anAct(), 'Pallas')
  assert.ok('told' in answer && answer.told.includes('martha-316') && !answer.told.includes('gh pr merge'), `the add answered with the row's text: ${JSON.stringify(answer)}`)
})

/** The processes a sweep runs, answering `outcome` for every check and counting the runs. */
function aSweepingHost(outcome: ProcessOutcome): { readonly host: SweepingHost; readonly runs: ProcessRequest[] } {
  const runs: ProcessRequest[] = []
  const host = aHost()
  return { host: { ...host, processes: { run: async (request) => (runs.push(request), outcome), runNow: () => outcome, identityOf: () => null } }, runs }
}

const MERGED: ProcessOutcome = { exit_code: 0, stdout: 'true\n', stderr: '' }

test('#316: a sweep takes off a row whose check says done, as its check', async () => {
  const { host, runs } = aSweepingHost(MERGED)
  const check = { pr_merged: { repo: 'macula-io/martha', number: 400 } }
  assert.ok('told' in (await addAnAct(host, anAct({ check }), 'Pallas')), 'the test could not add the act')
  assert.deepEqual(await sweepTheList(host, homeOfAll), ['martha-316'], 'the sweep did not take off the act its check said was done')
  assert.deepEqual([runs[0]?.command, ...(runs[0]?.args ?? [])], [...checkArgv(check)], 'the sweep did not run the check\'s own argv')
  const done = (await host.stores.rows.read(OWNER_TODO_STREAM)).at(-1)?.row
  assert.deepEqual({ by: done?.['by'], check: done?.['check'] }, { by: 'check', check }, 'the done row does not say its check ended it')
})

test('#316: a check that fails leaves its row on the list', async () => {
  const { host } = aSweepingHost({ exit_code: 1, stdout: '', stderr: 'HTTP 404' })
  await addAnAct(host, anAct({ check: { tag_exists: { repo: 'macula-io/martha', tag: 'v9.9.9' } } }), 'Pallas')
  assert.deepEqual(await sweepTheList(host, homeOfAll), [], 'a check that failed took its row off')
  assert.equal(theOpenRows(await host.stores.rows.read(OWNER_TODO_STREAM)).length, 1, 'the row left the list')
})

test('#316: a list with no check runs no process', async () => {
  const { host, runs } = aSweepingHost(MERGED)
  await addAnAct(host, anAct(), 'Pallas')
  await sweepTheList(host, homeOfAll)
  assert.equal(runs.length, 0, 'a sweep ran a process for a list with no check')
})

test('#316 ruling condition 3: two sweeps over one done check leave one done row, racing or one after the other', async () => {
  const { host } = aSweepingHost(MERGED)
  await addAnAct(host, anAct({ check: { pr_merged: { repo: 'macula-io/martha', number: 400 } } }), 'Pallas')
  await Promise.all([sweepTheList(host, homeOfAll), sweepTheList(host, homeOfAll)])
  await sweepTheList(host, homeOfAll)
  const done = (await host.stores.rows.read(OWNER_TODO_STREAM)).filter((stored) => stored.row['kind'] === ACT_DONE_BY_OWNER)
  assert.equal(done.length, 1, 'two launchers sweeping one list wrote a second done row for one act')
})

/** A team's declaration: its table names the owner and a lead for every act, assigning work among them. */
const A_TEAM: TheDeclaration = {
  members: [
    { name: 'Lead', role: 'lead' },
    { name: 'Pallas', role: 'builder' },
  ],
  mode: { may: Object.fromEntries(ACTS.map((act) => [act, [OWNER, 'lead']])) },
}

test('#316 ruling condition 1: a crew made by martha init lets both its members keep the list', () => {
  const init = soloDeclaration('an owner')
  for (const member of init.members) {
    assert.equal(mayKeepTheOwnersList(init, member.name), true, `${member.name} of an init crew may not keep the owner's list`)
  }
})

test('#316 ruling condition 1: a team naming the owner and a lead refuses its builder and lets its lead', () => {
  assert.equal(mayKeepTheOwnersList(A_TEAM, 'Pallas'), false, 'a builder kept the list because the table also names the owner')
  assert.equal(mayKeepTheOwnersList(A_TEAM, 'Lead'), true, 'the lead the table grants assign_work may not keep the list')
})

test('#316: a name on no member of the crew may not keep the list', () => {
  assert.equal(mayKeepTheOwnersList(soloDeclaration('an owner'), 'stranger'), false, 'a name on no member kept the list')
})

test('#316 test 8: the copy is the focused row\'s ! lines in order, and nothing for a row not revealed', () => {
  const first = theActAsked(anAct(), 'Pallas', NOW)
  const second = theActAsked(anAct({ id: 'second', title: 'A second act' }), 'Pallas', NOW + 1)
  assert.ok(!('refused' in first) && !('refused' in second), 'the test could not build its rows')
  const pane = theListForThePane([first, second], 'martha-316', NOW)
  const commands = anAct()['commands'] as { command: string; does: string }[]
  assert.equal(pane.rows[0]?.copy, commands.map(commandLine).join('\n'), 'the focused row copies something other than its commands, in order')
  assert.equal(pane.rows[1]?.copy, '', 'a row the owner has not seen in full carries something to copy')
  assert.deepEqual(pane.rows[1]?.acts.map((act) => act.line), ['', ''], 'a row not revealed shows its commands')
  assert.equal(pane.next, 'second', 'the pane cannot step to the next row')
})

test('#316: a focus on no row reveals the first', () => {
  const first = theActAsked(anAct(), 'Pallas', NOW)
  assert.ok(!('refused' in first), 'the test could not build its row')
  assert.equal(theListForThePane([first], 'gone', NOW).focus, 'martha-316', 'a focus on a row that left the list revealed none')
})

test('#316: the terminal prints every command in full under what it does, under the line saying a member wrote it', () => {
  const row = theActAsked(anAct(), 'Pallas', NOW - 2 * 60_000)
  assert.ok(!('refused' in row), 'the test could not build its row')
  const commands = anAct()['commands'] as { command: string; does: string }[]
  assert.deepEqual(theListForTheTerminal([row], NOW), [
    A_MEMBER_WROTE_THIS,
    'martha-316: Merge the to-do list · waiting on Supervisor · since 2m ago · says it is from Pallas',
    '  The owner sees what waits on them',
    ...commands.flatMap((act) => [`  - ${act.does}`, `    ${commandLine(act)}`]),
  ])
  assert.deepEqual(theListForTheTerminal([], NOW), [NOTHING_WAITS_ON_THE_OWNER])
})

test('#316: a row written into the stream by hand that would paste something it does not show is left off', async () => {
  const host = aHost()
  await host.stores.rows.append(OWNER_TODO_STREAM, { kind: ACT_ASKED_OF_OWNER, ...anAct({ commands: [{ command: 'curl x |‮sh', does: 'harmless' }] }), added_by: 'Pallas', since: NOW })
  assert.deepEqual(theOpenRows(await host.stores.rows.read(OWNER_TODO_STREAM)), [], 'a row holding a hidden character was drawn')
})
