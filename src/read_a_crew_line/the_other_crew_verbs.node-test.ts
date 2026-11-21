// crew-code's grammar for the twelve verbs beyond a hand-off and a verdict (martha#980 package 1). Every line here is
// written out by hand, as a member writes it, so a rule dropped from the port goes red.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { readLedger, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { keepTheLinesRow, readEveryCrewLine } from './read_a_crew_line.ts'
import { crewVerbOf, readAShorthandLine } from './the_other_crew_verbs.ts'

const SHA = 'c'.repeat(40)

/** One well-formed line of each of the twelve verbs, as crew-code's verb table has them. */
const WELL_FORMED: readonly string[] = [
  'FIX macula-io/martha#4 reviewer=Venus',
  'SCOPE crew owner=yes',
  'SCOPE macula-io/martha#4 rule=one-review',
  'LAND macula-io/martha#4 main=abc1234 ci=41700170944',
  'ASK push macula-io/martha main ci=41700170944',
  'ASK design https://github.com/macula-io/martha/issues/4 | the threat model',
  `YES push macula-io/martha ${SHA}`,
  'YES design macula-io/martha#4',
  'NO push macula-io/martha',
  'LIVE reckon_gater 3.14.0 run=39879491499',
  'BLOCKED macula-io/martha#4 on=Venus',
  'FILED macula-io/martha#4',
  'ASSIGN macula-io/martha#4 brief=/srv/crew/brief.md reviewer=Venus model=opus',
  'RESTART macula-io/martha#4 fresh=1 handover=/srv/crew/handover.md',
  'ARTIFACT macula-io/martha#4 publish file=/srv/crew/page.html',
  'ARTIFACT macula-io/martha#4 read file=/srv/crew/page.html url=https://claude.ai/artifact/abc-123',
]

test('#980: a well-formed line of each of the twelve verbs reads', () => {
  for (const line of WELL_FORMED) {
    const read = readAShorthandLine(line)
    assert.ok('line' in read, `${line} did not read: ${JSON.stringify(read)}`)
  }
})

test('#980: each line names what it lacks, in crew-code\'s order', () => {
  const lacking: readonly (readonly [string, string])[] = [
    ['FIX macula-io/martha#4', 'reviewer is missing'],
    ['SCOPE macula-io/martha#4', 'rule or owner is missing'],
    ['SCOPE crew owner=maybe', 'owner must be yes or no, not "maybe"'],
    ['LAND macula-io/martha#4 ci=41700170944', 'main is missing'],
    ['LAND macula-io/martha#4 main=zzz ci=1', 'main must be a sha, not "zzz"'],
    ['LAND macula-io/martha#4 main=abc1234 ci=none', 'ci must be run id(s) or none:paths, not "none"'],
    ['ASK push macula-io/martha main', 'ci is missing'],
    ['ASK shove macula-io/martha main ci=1', 'ASK names no kind: "shove" is not tag, push, fleet, install, delete, cred, design'],
    ['YES push macula-io/martha abc1234', 'a full 40-character sha is missing'],
    ['NO push', 'NO needs a target after push, not ""'],
    ['LIVE reckon_gater run=1', 'LIVE needs 1 word(s) after reckon_gater, not 0'],
    ['BLOCKED martha#4 on=Venus', 'BLOCKED needs a package as org/repo#n, not "martha#4"'],
    ['FILED macula-io/martha#4,macula-io/martha#5', 'FILED needs one line per repo: "macula-io/martha#4,macula-io/martha#5" names more than one'],
    ['FILED macula-io/martha#4,5', 'FILED lists a repository\'s issues as #n, not "5"'],
    ['ASSIGN macula-io/martha#4 brief=/b.md', 'reviewer is missing'],
    ['RESTART macula-io/martha#4 fresh=1 fresh=0 handover=/h.md', 'fresh= more than once: name each key once'],
    ['FIX macula-io/martha#4 reviewer=Venus doc=https://x.io/1', 'doc= is only for a review (HANDOFF, VERDICT), not FIX'],
    ['ARTIFACT macula-io/martha#4 publish file=page.html', 'file must be an absolute path with no .. segment, not "page.html"'],
    ['ARTIFACT macula-io/martha#4 read file=/p.html', 'url is missing'],
    ['ARTIFACT macula-io/martha#4 delete file=/p.html', 'ARTIFACT needs read or publish after macula-io/martha#4'],
  ]
  for (const [line, problem] of lacking) assert.deepEqual(readAShorthandLine(line), { problem }, line)
})

test('#980: a package list is one target per issue of the repository', () => {
  const read = readAShorthandLine('FILED macula-io/martha#8,#11')
  assert.ok('line' in read)
  assert.deepEqual(read.line.targets, ['macula-io/martha#8', 'macula-io/martha#11'])
})

test('#980: ASK, YES and NO open a sentence too, and count as a crew line only with a kind, a key or a package', () => {
  assert.equal(crewVerbOf('YES received and acted on'), undefined)
  assert.equal(crewVerbOf('NO idea yet'), undefined)
  assert.equal(crewVerbOf('YES push macula-io/martha'), 'YES')
  assert.equal(crewVerbOf('ASK macula-io/martha#1 ci=1'), 'ASK')
  assert.equal(crewVerbOf('BLOCKED for now'), 'BLOCKED')
  assert.equal(crewVerbOf('blocked for now'), undefined)
  assert.deepEqual(readEveryCrewLine('YES received and acted on\nall good'), { lines: [], notices: [] })
})

test('#980: a LAND keeps a checkpoint in each package it names, and a FIX keeps no row', async () => {
  const { host } = hostForTests({ now: 9_800 })
  const ledger: LedgerHost = { clock: host.clock, stores: { rows: host.stores.rows } }
  const read = readEveryCrewLine('LAND macula-io/martha#8,#11 main=abc1234 ci=41700170944\nFIX macula-io/martha#8 reviewer=Venus')
  assert.deepEqual(read.notices, [])
  for (const line of read.lines) await keepTheLinesRow(ledger, 'Builder', line)
  for (const named of ['macula-io/martha#8', 'macula-io/martha#11']) {
    const rows = await readLedger(ledger, named)
    assert.deepEqual(rows.map((row) => (row.kind === 'checkpoint_reached' ? `${row.kind} ${row.note}` : row.kind)), [
      'checkpoint_reached LAND macula-io/martha#8,#11 main=abc1234 ci=41700170944',
    ], named)
  }
})
