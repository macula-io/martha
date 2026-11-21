// The friction note, the tool that files it and the sweep that drops it (martha#318).
//
// The note decides nothing of its own: what it may carry is the private-text decision's classes, where it may land is
// the declaration's list, and the issue is the note. Each test names the mutant of the design that it kills, and the
// tool is driven through its own places, with gh a fake that answers what the test hands it.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE, OWNER, soloDeclaration, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { todayOf } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CREW_TOOL_NAMES, crewToolsOver } from '../a_crews_tools/a_crews_tools.ts'
import {
  FRICTION_KINDS,
  FRICTION_LABEL,
  FRICTION_LABEL_COLOUR,
  FRICTION_LABEL_DESCRIPTION,
  MAX_NOTE_TITLE,
  THE_NOTES_FILE,
  theFiledIssueIn,
  theNoteIn,
  theNotesBody,
  theNotesIn,
  theNotesRefusalIn,
  theNotesTitle,
  theNotesWithout,
  theNotesWith,
  type FrictionNote,
} from './friction_note.ts'
import { FILE_A_FRICTION_NOTE, FRICTION_PLACE, fileAFrictionNote } from './the_friction_tool.ts'
import { sweepTheNotes } from './the_friction_sweep.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-friction-note-'))
after(() => removeTheTree(homeOfAll))

const NOW = Date.parse('2026-11-20T12:00:00Z')
const A_REPO = 'macula-io/martha'
/** A repository the crew did not declare: a synthetic owner, so no real repository is named here. */
const AN_UNDECLARED_REPO = 'synthetic-owner-martha-318/friction-notes'
/** The declaration file a refusal names, built as the tool builds it and never typed again. */
const THE_DECLARATION = join(DECLARATION_DIRECTORY, DECLARATION_FILE)
const A_PUBLIC_DOMAIN = 'macula.io'

/** The rules a note is judged against, as a crew that declared one repository and one domain has them. */
const THE_RULES = { repos: [A_REPO], public_emails: [A_PUBLIC_DOMAIN] }

/** What a filing call is, before the filer is known: three answers and a kind. */
const A_NOTE = { repo: A_REPO, kind: 'usability', tried: 'ran the tool', did: 'it refused', need: 'the tool says why' }

/** The filer the tests file as, unless one says otherwise. */
const FILER = { member: 'Ceres', supervisor: false, day: todayOf(NOW) }

let placesSoFar = 0
/** A crew's own store, under a directory no other test shares, with the processes the tool runs gh through. */
function aFilingPlace(run: (request: ProcessRequest) => Promise<ProcessOutcome>, member = 'Ceres'): Parameters<typeof fileAFrictionNote>[0] & { readonly store: ReturnType<typeof keepTheCrewsFilesAsDirectories> } {
  placesSoFar += 1
  const store = keepTheCrewsFilesAsDirectories(join(homeOfAll, `place-${placesSoFar}`, 'crew-files'))
  return {
    member,
    settings: settingsOf(),
    root: join(homeOfAll, `place-${placesSoFar}`, 'checkout'),
    crew: store,
    processes: { run, runNow: () => ({ exit_code: null, stdout: '', stderr: '' }), identityOf: () => null, signalGroup: () => ({ signalled: false, refusal: 'the friction tool signals no process' }) },
    now: NOW,
    store,
  }
}

/** The settings the tool reads: the declared lists and the crew's members, as the declaration hands them. */
function settingsOf(may: Readonly<Record<string, readonly string[]>> = { assign_work: [OWNER, 'lead'] }, members = [{ name: 'Lead', role: 'lead' }, { name: 'Ceres', role: 'builder' }]): CrewSettings {
  return {
    owner: 'an owner',
    members,
    mode: { name: 'team', roles: members.map((member) => member.role), may },
    friction_repos: [A_REPO],
    public_emails: [A_PUBLIC_DOMAIN],
  } as unknown as CrewSettings
}

/** What gh answered, as the fake hands it back. */
const ghSays = (outcome: Partial<ProcessOutcome>): ((request: ProcessRequest) => Promise<ProcessOutcome>) => async () => ({ exit_code: 0, stdout: '', stderr: '', ...outcome })

/** The index the crew keeps, as the store holds it. */
const theIndexIn = (place: ReturnType<typeof aFilingPlace>) => {
  const held = place.store.place(FRICTION_PLACE)
  assert.ok(!('refusal' in held), 'the crew store refused its own friction place')
  const text = held.read(THE_NOTES_FILE)
  return text === undefined || 'refusal' in text ? undefined : text.text
}

// --- the note ---------------------------------------------------------------------

test('#318 test 1: a note is its three answers, the kind, the repo, and who filed it — and one blank part is no note', () => {
  const note = theNoteIn(A_NOTE, FILER)
  assert.deepEqual(note, { ...A_NOTE, by: 'Ceres', supervisor: false, day: todayOf(NOW) }, 'the note is not the call it was made from')
  for (const part of ['tried', 'did', 'need'] as const) {
    assert.equal(theNoteIn({ ...A_NOTE, [part]: '   ' }, FILER), null, `a note with a blank ${part} was taken as one`)
  }
  assert.equal(theNoteIn({ ...A_NOTE, repo: '' }, FILER), null, 'a note with no repository was taken as one')
  assert.equal(theNoteIn({ ...A_NOTE, kind: 'annoyance' }, FILER), null, 'a note naming a kind this crew does not know was filed as the default')
  assert.equal(theNoteIn({ ...A_NOTE, kind: '' }, FILER)?.kind, 'usability', 'a note naming no kind did not read as the default')
  for (const kind of FRICTION_KINDS) assert.equal(theNoteIn({ ...A_NOTE, kind }, FILER)?.kind, kind, `${kind} was not taken as a kind`)
})

test('#318 test 2: the issue is the need, cut at a word and never longer than a title readers can scan', () => {
  const short = theNoteIn({ ...A_NOTE, need: 'the tool  says   why' }, FILER) as FrictionNote
  assert.equal(theNotesTitle(short), 'the tool says why', 'the title is not the need on one line')
  const long = theNoteIn({ ...A_NOTE, need: 'the tool refuses every note that names a path and no member can tell which path was refused until the note is read again' }, FILER) as FrictionNote
  const title = theNotesTitle(long)
  assert.ok(title.length <= MAX_NOTE_TITLE, `the title is ${title.length} characters, past the cap`)
  assert.ok(title.endsWith('…'), 'a cut title does not say it was cut')
  assert.ok(!title.slice(0, -1).endsWith(' '), 'the cut title ends on a space')
  assert.ok(long.need.replace(/\s+/g, ' ').startsWith(title.slice(0, -1).trim()), 'the title is not the start of the need')
})

test('#318 test 3: the issue opens with its Purpose line and asks the three questions under their own headings', () => {
  const note = theNoteIn({ ...A_NOTE, kind: 'reliability' }, FILER) as FrictionNote
  const body = theNotesBody(note)
  assert.ok(body.startsWith(`Purpose (reliability): ${note.need}`), 'the body does not open with the Purpose line the workspace rule requires')
  for (const heading of ['### What I tried', '### What the tool did', '### What I needed']) assert.ok(body.includes(heading), `the body has no ${heading}`)
  assert.ok(body.includes('Filed by Ceres (a crew member)'), 'the body does not say who filed it')
  const byTheSupervisor = theNotesBody(noteIn(A_REPO, { supervisor: true }))
  assert.ok(byTheSupervisor.includes('Filed by Ceres (the crew supervisor)'), 'a note from the crew supervisor reads as a builder\'s')
})

/**
 * A note for the tests that read a refusal: the repository, and the text the refusal is about. Its text names the box
 * by a word no class reads, so a test that is about another refusal is not passed by the lab hostname's own.
 */
function noteIn(repo: string, filer: Partial<typeof FILER> = {}, changes: Partial<FrictionNote> = {}): FrictionNote {
  return {
    repo,
    kind: 'usability',
    tried: 'ran the tool from rack12',
    did: 'it refused',
    need: 'the tool says why',
    by: filer.member ?? 'Ceres',
    supervisor: filer.supervisor ?? false,
    day: todayOf(NOW),
    ...changes,
  }
}

test('#318 test 4: a note is refused for a repository the crew did not declare, and the refusal names the file', () => {
  const refused = theNotesRefusalIn(noteIn(AN_UNDECLARED_REPO), THE_RULES, THE_DECLARATION)
  assert.ok(refused.startsWith(`Not filed: ${AN_UNDECLARED_REPO} is not a repository this crew files notes in (it declares ${A_REPO})`), 'the refusal does not name the declared repositories')
  assert.match(refused, /Change friction_repos in \.martha\/martha\.json/, 'the refusal does not name the file')
  assert.equal(theNotesRefusalIn(noteIn(A_REPO), THE_RULES, THE_DECLARATION), '', 'a note for a declared repository was refused')
  const none = theNotesRefusalIn(noteIn(A_REPO), { repos: [], public_emails: [] }, THE_DECLARATION)
  assert.match(none, /declares no repository for friction notes/, 'a crew that declares no repository files a note without being told')
  assert.match(none, /"friction_repos": \["<org>\/<repo>"\]/, 'the refusal does not say which field to add')
})

test('#318 test 5: a need that is not one line is refused before gh runs, and says nothing was sent', () => {
  const refused = theNotesRefusalIn(noteIn(A_REPO, {}, { need: 'one line\nand another' }), THE_RULES, THE_DECLARATION)
  assert.match(refused, /the need is the issue title and its Purpose line, so it is one line/, 'a need with a line break was taken')
  assert.match(refused, /Nothing was sent\./, 'the refusal does not say nothing was sent')
})

/**
 * The private values the class cases carry: each must be refused, and none may be printed in the refusal. They are the
 * scan's own synthetic forms, which the tree scan passes and a note does not: a note refuses every one of them, since
 * its rules never allow a synthetic form (./friction_note's theTextRules).
 */
const PRIVATE_VALUES = ['/home/synthetic', '192.168.255.7', 'someone@synthetic.invalid', 'a'.repeat(64), 'ghs_syntheticabcdefghij0123'] as const

test('#318 test 6: the note refuses each private class by name, never by value, and a lab hostname is one of them', () => {
  const cases: readonly { readonly text: string; readonly what: RegExp }[] = [
    { text: 'read /home/synthetic/the-file', what: /a home directory/ },
    { text: 'the box at 192.168.255.7', what: /a private address/ },
    { text: 'mail me at someone@synthetic.invalid', what: /an email address/ },
    { text: `the id ${'a'.repeat(64)}`, what: /a 64-hex id/ },
    { text: 'the token ghs_syntheticabcdefghij0123', what: /a GitHub token/ },
  ]
  for (const one of cases) {
    const refused = theNotesRefusalIn(noteIn(A_REPO, {}, { tried: one.text }), THE_RULES, THE_DECLARATION)
    assert.match(refused, one.what, `the note did not refuse ${one.what} in ${one.text}`)
    // The class is said, and nothing of the value: an issue is read by anyone (martha#855).
    for (const value of PRIVATE_VALUES) assert.ok(!one.text.includes(value) || !refused.includes(value), `the refusal printed the value ${value}`)
  }
  const lab = theNotesRefusalIn(noteIn(A_REPO, {}, { tried: 'the box probe-synthetic.lab answered' }), THE_RULES, THE_DECLARATION)
  assert.match(lab, /a lab hostname/, 'a lab hostname was not refused, so a note could turn the posted-text report red')
  assert.ok(!lab.includes('probe-synthetic.lab'), 'the refusal printed the lab hostname')
  const allowed = theNotesRefusalIn(noteIn(A_REPO, {}, { tried: `mail me at someone@${A_PUBLIC_DOMAIN}` }), THE_RULES, THE_DECLARATION)
  assert.equal(allowed, '', 'a declared public domain was refused')
})

test('#318 test 7: the issue is the one gh named, and anything else is no issue', () => {
  const url = 'https://github.com/macula-io/martha/issues/1234\n'
  assert.equal(theFiledIssueIn(url), 1234, 'the URL gh prints was not read as the issue')
  assert.equal(theFiledIssueIn(`warning: something\n${url}`), 1234, 'a warning before the URL hid the issue')
  assert.equal(theFiledIssueIn(''), null, 'an empty answer was read as an issue')
  assert.equal(theFiledIssueIn('https://github.com/macula-io/martha/pull/12'), null, 'a pull request was read as the issue a note became')
})

// --- the crew's index -------------------------------------------------------------

test('#318 test 8: the index keeps every note it can read, and drops an entry it cannot', () => {
  const filed = { ...noteIn(A_REPO), issue: 12 }
  const withIt = theNotesWith({}, filed)
  assert.deepEqual(theNotesIn(JSON.stringify(withIt)), withIt, 'the index did not read back what it kept')
  const mixed = JSON.stringify({ good: filed, noIssue: { repo: A_REPO }, noRepo: { issue: 14 }, other: { ...filed, issue: 13 } })
  assert.deepEqual(Object.keys(theNotesIn(mixed)).sort(), ['good', 'other'], 'an entry the index could not read was kept as something it is not')
  assert.deepEqual(theNotesIn('not json'), {}, 'an index that is not JSON was read as notes')
  assert.deepEqual(theNotesWithout(withIt, [A_REPO + '#12']), {}, 'a dropped note stayed in the index')
})

// --- the tool ---------------------------------------------------------------------

test('#318 test 9: the tool files the note through gh, keeps it, and answers with the issue it became', async () => {
  const runs: ProcessRequest[] = []
  const place = aFilingPlace(async (request) => {
    runs.push(request)
    return { exit_code: 0, stdout: `https://github.com/${A_REPO}/issues/77\n`, stderr: '' }
  })
  const answered = await fileAFrictionNote(place, A_NOTE)
  assert.deepEqual(answered, { answer: `Filed ${A_REPO}#77: ${A_NOTE.need}.` }, 'the tool did not answer with the issue it became')
  assert.equal(runs.length, 1, 'the tool ran gh more than once for one note')
  const [run] = runs
  assert.equal(run?.command, 'gh', 'the note is not filed through gh')
  assert.deepEqual(run?.args, ['issue', 'create', '-R', A_REPO, '-l', FRICTION_LABEL, '-t', A_NOTE.need, '--body', theNotesBody(theNoteIn(A_NOTE, FILER) as FrictionNote)], 'gh was not asked to make the issue the note is')
  assert.deepEqual(theNotesIn(theIndexIn(place)), theNotesWith({}, { ...(theNoteIn(A_NOTE, FILER) as FrictionNote), issue: 77 }), 'the note the tool filed is not in the crew\'s index')
})

test('#318 test 10: the first note in a repository makes the label once, and asks gh again; any other refusal is reported', async () => {
  const runs: ProcessRequest[] = []
  const place = aFilingPlace(async (request) => {
    runs.push(request)
    if (request.args[0] === 'label') return { exit_code: 0, stdout: '', stderr: '' }
    if (runs.filter((one) => one.args[0] === 'issue').length === 1) return { exit_code: 1, stdout: '', stderr: 'could not add label: friction not found\n' }
    return { exit_code: 0, stdout: `https://github.com/${A_REPO}/issues/8\n`, stderr: '' }
  })
  const answered = await fileAFrictionNote(place, A_NOTE)
  assert.ok('answer' in answered, `the first note in a repository was not filed: ${'refused' in answered ? answered.refused : ''}`)
  assert.deepEqual(runs.map((run) => run.args[0]), ['issue', 'label', 'issue'], 'the tool did not make the label and ask gh again')
  assert.deepEqual(runs[1]?.args, ['label', 'create', FRICTION_LABEL, '-R', A_REPO, '-c', FRICTION_LABEL_COLOUR, '-d', FRICTION_LABEL_DESCRIPTION], 'the label was not made as the note names it')

  const brokenRuns: ProcessRequest[] = []
  const broken = aFilingPlace(async (request) => {
    brokenRuns.push(request)
    return { exit_code: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration\n' }
  })
  const refused = await fileAFrictionNote(broken, A_NOTE)
  assert.ok('refused' in refused, 'a note gh refused was answered as filed')
  assert.match(refused.refused, /HTTP 403: Resource not accessible by integration/, 'the refusal does not carry gh\'s own line')
  assert.deepEqual(brokenRuns.map((run) => run.args[0]), ['issue'], 'gh was asked for a label for a refusal that did not say the label was missing')
  assert.equal(theIndexIn(broken), undefined, 'a refused note was kept in the index')
})

test('#318 test 11: a note for a repository the crew did not declare runs no gh, and a launch without processes files nothing', async () => {
  const runs: ProcessRequest[] = []
  const place = aFilingPlace(async (request) => {
    runs.push(request)
    return { exit_code: 0, stdout: `https://github.com/${AN_UNDECLARED_REPO}/issues/1\n`, stderr: '' }
  })
  const refused = await fileAFrictionNote(place, { ...A_NOTE, repo: AN_UNDECLARED_REPO })
  assert.ok('refused' in refused, 'a note for an undeclared repository was filed')
  assert.equal(runs.length, 0, 'gh ran for a note refused before it')

  const filing = aFilingPlace(ghSays({}))
  const noPlace = await fileAFrictionNote({ member: filing.member, settings: filing.settings, root: filing.root, crew: filing.crew, now: filing.now }, A_NOTE)
  assert.ok('refused' in noPlace, 'a launch without processes filed a note')
  assert.match(noPlace.refused, /holds no processes, so gh cannot run/, 'the refusal does not say why nothing was sent')
})

test('#318 test 12: a gh that names no issue is answered honestly, and nothing is kept', async () => {
  const place = aFilingPlace(ghSays({ exit_code: 0, stdout: 'nothing here\n' }))
  const refused = await fileAFrictionNote(place, A_NOTE)
  assert.ok('refused' in refused, 'an answer naming no issue was taken as a filed note')
  assert.match(refused.refused, /check that repository's issues before calling again/, 'the refusal does not say the note may have landed')
  assert.equal(theIndexIn(place), undefined, 'a note the tool could not name was kept')
})

test('#318 test 13: the tool is registered, and filed through the launch when the declaration lets it', async () => {
  assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(FILE_A_FRICTION_NOTE), `${FILE_A_FRICTION_NOTE} is not a tool the crew registers`)
  const root = join(homeOfAll, 'a-launch')
  const declaration = { ...soloDeclaration('an owner'), friction_repos: [A_REPO], public_emails: [A_PUBLIC_DOMAIN] }
  const documents = { read: async (path: string) => (path.endsWith(THE_DECLARATION) ? JSON.stringify(declaration) : Promise.reject(new Error(`no document at ${path}`))) }
  const store = keepTheCrewsFilesAsDirectories(join(root, 'crew-files'))
  const tools = crewToolsOver({
    member: 'builder',
    ledger: { clock: { now: () => NOW }, stores: { rows: { read: async () => [] } } } as never,
    beats: { read: () => undefined, all: () => [] } as never,
    root,
    documents,
    stores: { crew: store },
    processes: { run: ghSays({ stdout: `https://github.com/${A_REPO}/issues/9\n` }), runNow: () => ({ exit_code: null, stdout: '', stderr: '' }), identityOf: () => null, signalGroup: () => ({ signalled: false, refusal: 'the friction tool signals no process' }) },
  })
  const answered = await tools.answer(FILE_A_FRICTION_NOTE, A_NOTE, 'a-session')
  assert.deepEqual(answered, { answer: `Filed ${A_REPO}#9: ${A_NOTE.need}.` }, 'the launch did not file the note through its own declaration')
  assert.ok(theIndexIn({ ...aFilingPlace(ghSays({})), store }) !== undefined, 'the note filed through the launch is not in the crew\'s index')
})

// --- the sweep --------------------------------------------------------------------

/** A sweep's places, over a crew store the test reads and a gh the test answers. */
function aSweep(run: (request: ProcessRequest) => Promise<ProcessOutcome>, member = 'Lead', settings = settingsOf()) {
  placesSoFar += 1
  const store = keepTheCrewsFilesAsDirectories(join(homeOfAll, `sweep-${placesSoFar}`, 'crew-files'))
  return {
    crew: store,
    root: join(homeOfAll, `sweep-${placesSoFar}`, 'checkout'),
    member,
    processes: { run, runNow: () => ({ exit_code: null, stdout: '', stderr: '' }), identityOf: () => null, signalGroup: () => ({ signalled: false, refusal: 'the sweep signals no process' }) },
    settings: async () => settings,
    store,
  }
}

/** The index as the sweep left it, by key. */
const theIndexOf = (swept: ReturnType<typeof aSweep>) => {
  const held = swept.store.place(FRICTION_PLACE)
  assert.ok(!('refusal' in held), 'the crew store refused its own friction place')
  const text = held.read(THE_NOTES_FILE)
  return text === undefined || 'refusal' in text ? {} : theNotesIn(text.text)
}

/** A crew store holding the index a test hands it. */
async function aCrewHolding(store: ReturnType<typeof keepTheCrewsFilesAsDirectories>, notes: Record<string, unknown>): Promise<void> {
  const place = store.place(FRICTION_PLACE)
  assert.ok(!('refusal' in place), 'the crew store refused its own friction place')
  place.keep(THE_NOTES_FILE, JSON.stringify(notes))
}

test('#318 test 14: the sweep drops the notes whose issue has closed, and keeps the rest', async () => {
  const swept = aSweep(async (request) => (request.args[2] === '12' ? { exit_code: 0, stdout: '{"state":"CLOSED"}\n', stderr: '' } : { exit_code: 0, stdout: '{"state":"OPEN"}\n', stderr: '' }))
  const closed = { ...noteIn(A_REPO), issue: 12 }
  const open = { ...noteIn(A_REPO), issue: 13 }
  await aCrewHolding(swept.store, { [`${A_REPO}#12`]: closed, [`${A_REPO}#13`]: open })
  assert.deepEqual(await sweepTheNotes(swept), [`${A_REPO}#12`], 'the sweep did not drop the note whose issue closed')
  assert.deepEqual(Object.keys(theIndexOf(swept)), [`${A_REPO}#13`], 'the index kept a closed note, or dropped an open one')
})

test('#318 test 15: a gh that fails, or an issue it cannot read, removes nothing — and only the routed member sweeps', async () => {
  const swept = aSweep(ghSays({ exit_code: 1, stderr: 'gh: something went wrong' }))
  const note = { ...noteIn(A_REPO), issue: 12 }
  await aCrewHolding(swept.store, { [`${A_REPO}#12`]: note })
  assert.deepEqual(await sweepTheNotes(swept), [], 'a sweep whose gh failed dropped a note')
  assert.deepEqual(Object.keys(theIndexOf(swept)), [`${A_REPO}#12`], 'a sweep whose gh failed rewrote the index')

  const unreadable = aSweep(ghSays({ stdout: 'not json' }))
  await aCrewHolding(unreadable.store, { [`${A_REPO}#12`]: note })
  assert.deepEqual(await sweepTheNotes(unreadable), [], 'a sweep that could not read an issue state dropped its note')

  const runs: ProcessRequest[] = []
  const notRouted = aSweep(async (request) => {
    runs.push(request)
    return { exit_code: 0, stdout: '{"state":"CLOSED"}\n', stderr: '' }
  }, 'Ceres')
  await aCrewHolding(notRouted.store, { [`${A_REPO}#12`]: note })
  assert.deepEqual(await sweepTheNotes(notRouted), [], 'a member the crew\'s work is not routed to swept the notes')
  assert.equal(runs.length, 0, 'a member the crew\'s work is not routed to asked GitHub about a note')
})
