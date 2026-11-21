// The crew text a member is handed at its session's start (martha#306).
//
// These cases pin what the design demands of this slice: the parts in its order, the practice only on the crew's
// switch, a role or a mode with no text refused by the file to write, a crew's own text winning over Martha's, the
// ceiling at its edge, and — the join that stops the two drifting — every line the section teaches parsing with the
// reader the crew accepts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CREW_CODE_DECLARATION_DIRECTORY, DeclarationRefused, DECLARATION_DIRECTORY, DECLARATION_FILE, MODE_TEXTS_DIRECTORY, HANDOVER_CEILING_MINUTES_WHEN_UNNAMED, HOLD_REVIEWS, THE_HOST_A_MEMBER_RAN_ON, OFFER_OWNER_ASKS, OWNER, RESTART_MEMBER, ROLE_TEXTS_DIRECTORY, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { ARTIFACT_LINES } from '../read_a_crew_line/crew_lines.ts'
import { CREWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CLAUDE_CODE_MODELS } from '../claude_code_host/claude_code_host.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import {
  CrewTextRefused,
  noCrewTextFor,
  crewTextFilesOf,
  crewTextFilesToApprove,
  crewTextToHand,
  handAMemberItsCrewText,
  PRACTICE_TEXT,
  SHIPPED_TEXTS,
  THE_SECTION_CEILING,
  theTextsAMemberReads,
  type ATextAndItsFile,
  type ReadAText,
  type TheTextsAMemberReads,
} from './hand_a_member_its_crew_text.ts'
import { THRESHOLDS_WHEN_UNNAMED } from '../declare_crew/the_crews_thresholds.ts'
import { GITHUB_WHEN_UNNAMED } from '../declare_crew/the_crews_github.ts'
import { TRANSCRIPTS_WHEN_UNNAMED } from '../declare_crew/the_crews_transcripts.ts'
import { OWNER_NOTICES_WHEN_UNNAMED } from '../declare_crew/the_crews_owner_notices.ts'
import { CLOCK_ZONE_WHEN_UNNAMED } from '../declare_crew/the_crews_clock_zone.ts'
import { WHERE_A_CREW_OPENS_WHEN_UNNAMED } from '../declare_crew/the_crews_workspace.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { TAKE_ASKS } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { SWITCH_YOUR_MODEL } from '../switch_a_members_model/the_switch_tools.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { WORKTREE_FINISH } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { theWorkspaceTheCrewDeclared } from '../guard_workspace/guard_workspace.ts'

const ROOT = `/${CREWS_PLACE}/site`
const CREW = join(ROOT, DECLARATION_DIRECTORY)

const shipped = (name: string): string => readFileSync(join(SHIPPED_TEXTS, name), 'utf8')

/** A declaration with one builder and one reviewer, in the mode named. */
const settingsOf = (overrides: { readonly practice?: boolean; readonly mode?: string; readonly conventions?: string | null } = {}): CrewSettings => {
  const mode = overrides.mode ?? SOLO_MODE
  return {
    paths: { root: ROOT, crew: CREW, declaration: join(CREW, DECLARATION_FILE), conventions: overrides.conventions === undefined || overrides.conventions === null ? null : join(CREW, overrides.conventions) },
    owner: 'Raf',
    host: THE_HOST_A_MEMBER_RAN_ON,
    members: [
      { name: 'builder', role: 'builder', model: null, host: null, parked: false, billing: null },
      { name: 'reviewer', role: 'reviewer', model: null, host: null, parked: false, billing: null },
    ],
    mode: { name: mode, roles: ['builder', 'reviewer'], may: { assign_work: [OWNER], approve_landing: [OWNER], resume_parked_work: [OWNER], [OFFER_OWNER_ASKS]: [OWNER], [RESTART_MEMBER]: [OWNER], [HOLD_REVIEWS]: [OWNER] } },
    house_rules: { owner_items: false, workspace_layout: false, member_work: false, practice: overrides.practice ?? false, strict_gate: false, owner_bell: false, dashboard: false, refresh_between_tasks: false, nudges: false, wake: false, stalled_minutes: null, review_minutes: null, person_minutes: null, wake_after_minutes: null, wake_cap_minutes: null, review_model: null, clones: null, worktrees: null },
    // Off unless the declaration says otherwise (martha#321 reads the gate's mode from it).
    gate: { kind: 'off' },
    channel_read_seconds: 30,
    handover_ceiling_minutes: HANDOVER_CEILING_MINUTES_WHEN_UNNAMED,
    backlog: null,
    volatile_paths: [],
    engine_endpoint: null,
    thresholds: THRESHOLDS_WHEN_UNNAMED,
    github: GITHUB_WHEN_UNNAMED,
    transcripts: TRANSCRIPTS_WHEN_UNNAMED,
    owner_notices: OWNER_NOTICES_WHEN_UNNAMED,
    clock_zone: CLOCK_ZONE_WHEN_UNNAMED,
    opens: WHERE_A_CREW_OPENS_WHEN_UNNAMED,
    friction_repos: [],
    public_emails: [],
  }
}

/** A reader that answers Martha's shipped texts as they are on disk. */
const shippedReader = (extra: Readonly<Record<string, string>> = {}): ReadAText => (path) => {
  if (path.startsWith(SHIPPED_TEXTS)) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }
  return extra[path] ?? null
}

const sectionFor = (settings: CrewSettings, member: string, read: ReadAText): TheTextsAMemberReads => theTextsAMemberReads(settings, member, read)

const textAt = (file: string, text: string): ATextAndItsFile => ({ file, text })

/** A member the ported rules hand only the progress part: no layout, no review model, no grant. */
const NOTHING_PORTED: TheTextsAMemberReads['ported'] = { layout: null, review_model: null, assigns_work: false, offers_owner_asks: false }

/** Everything a composer needs, which each case changes one field of. */
const textsOf = (change: Partial<TheTextsAMemberReads> = {}): TheTextsAMemberReads => ({
  member: 'builder',
  role: 'builder',
  mode: SOLO_MODE,
  owner: 'Raf',
  practice: textAt(join(SHIPPED_TEXTS, PRACTICE_TEXT), shipped(PRACTICE_TEXT)),
  role_text: textAt(join(SHIPPED_TEXTS, ROLE_TEXTS_DIRECTORY, 'builder.md'), shipped(join(ROLE_TEXTS_DIRECTORY, 'builder.md'))),
  mode_text: textAt(join(SHIPPED_TEXTS, MODE_TEXTS_DIRECTORY, 'solo.md'), shipped(join(MODE_TEXTS_DIRECTORY, 'solo.md'))),
  conventions: null,
  ported: NOTHING_PORTED,
  ...change,
})

test('#306: the section carries who the member is, its practice, its role, its mode, the lines it sends, and its crew conventions, in that order', () => {
  const section = handAMemberItsCrewText(textsOf({ conventions: textAt(join(CREW, 'CONVENTIONS.md'), 'Write the issue before the code.') }))
  const headings = section.split('\n').filter((line) => line.startsWith('## '))
  assert.deepEqual(headings, ['## You are builder, the crew\'s builder', '## Crew practice', '## Your role: builder', '## How this crew works: solo', '## The lines you send', '## Progress', '## Conventions'])
  assert.match(section, /its owner is Raf/, 'the section does not name the crew\'s owner')
  assert.match(section, /Write the issue before the code\./, 'the conventions the crew declared are not in the section')
  assert.doesNotMatch(section, /\{\{/, 'a placeholder was left in the section, reading as a rule')
})

test('#306: the practice is in the section only when the crew switched it on, and then it is Martha\'s six rules, numbered', () => {
  const off = handAMemberItsCrewText(textsOf({ practice: null }))
  assert.doesNotMatch(off, /## Crew practice/, 'the practice reached a crew that did not switch it on')
  const on = handAMemberItsCrewText(textsOf())
  const practice = on.slice(on.indexOf('## Crew practice'), on.indexOf('## Your role'))
  assert.match(practice, /\(1\) Reviews go by direct message\./, 'the first rule is not numbered as the crew numbers its rules')
  assert.equal((practice.match(/^\(\d+\) /gm) ?? []).length, 6, 'the practice is not the six rules')
})

test('#306: the practice the composer hands is the declaration\'s switch, and Martha\'s own text when it is on', () => {
  const off = sectionFor(settingsOf({ practice: false }), 'builder', shippedReader())
  assert.equal(off.practice, null, 'a crew that did not switch the practice on was handed one all the same')
  const on = sectionFor(settingsOf({ practice: true }), 'builder', shippedReader())
  assert.equal(on.practice?.text, shipped(PRACTICE_TEXT), 'the practice a crew switched on is not Martha\'s own')
})

test('#306: a role with no text refuses the launch, naming the file to write', () => {
  assert.throws(
    () => handAMemberItsCrewText(textsOf({ role_text: null })),
    (error: unknown) =>
      error instanceof CrewTextRefused && error.file === join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, 'builder.md') && error.message === `${join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, 'builder.md')}: Martha ships no role text for "builder", and this crew has written none. Write one at that path.`,
    'a role with no text did not refuse by the path the owner would write',
  )
})

test('#306: a mode with no text refuses the launch too, naming its file', () => {
  const file = join(DECLARATION_DIRECTORY, MODE_TEXTS_DIRECTORY, SOLO_MODE + '.md')
  assert.throws(
    () => handAMemberItsCrewText(textsOf({ mode_text: null })),
    (error: unknown) => error instanceof CrewTextRefused && error.file === file && error.message === `${file}: Martha ships no mode text for "${SOLO_MODE}", and this crew has written none. Write one at that path.`,
  )
})

test('a member refused its crew text is named first, then what to write: the words the owner reads, exactly', () => {
  const refusal = `${join(DECLARATION_DIRECTORY, MODE_TEXTS_DIRECTORY, 'proof.md')}: Martha ships no mode text for "proof", and this crew has written none. Write one at that path.`
  assert.equal(noCrewTextFor('Probe-a', refusal), `Probe-a would be handed no crew text. ${refusal}`)
})

test('#306: a crew\'s own role text wins over the one Martha ships, and its own mode text too', () => {
  const settings = settingsOf()
  const ours = { [join(CREW, ROLE_TEXTS_DIRECTORY, 'builder.md')]: 'Our builder text.', [join(CREW, MODE_TEXTS_DIRECTORY, SOLO_MODE + '.md')]: 'Our mode text.' }
  const texts = sectionFor(settings, 'builder', shippedReader(ours))
  assert.equal(texts.role_text?.text, 'Our builder text.')
  assert.equal(texts.mode_text?.text, 'Our mode text.')
  const section = handAMemberItsCrewText(texts)
  assert.match(section, /Our builder text\./)
  assert.doesNotMatch(section, /You build and test one work package at a time/, 'the shipped text reached a crew that wrote its own')
})

test('#468: the crew\'s texts are Martha\'s folder\'s alone, so a crew that leaves its own under crew-code\'s is handed the shipped text', () => {
  // The move takes the declaration and every text beside it (design §3): a crew whose roles stayed behind loses them
  // without an error, so this case says plainly which folder a member\'s text is read from.
  const settings = settingsOf()
  const leftBehind = { [join(ROOT, CREW_CODE_DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, 'builder.md')]: 'Our builder text, left behind.' }
  const texts = sectionFor(settings, 'builder', shippedReader(leftBehind))
  assert.doesNotMatch(texts.role_text?.text ?? '', /left behind/, 'a text under crew-code\'s folder reached a member of a crew whose declaration is Martha\'s')
  assert.match(texts.role_text?.text ?? '', /You build and test one work package at a time/)
})

test('#306: a declaration names the conventions file, and a file that is not there is a refusal, not a crew with none', () => {
  const settings = settingsOf({ conventions: 'CONVENTIONS.md' })
  assert.throws(
    () => sectionFor(settings, 'builder', shippedReader()),
    (error: unknown) => error instanceof CrewTextRefused && error.file === join(CREW, 'CONVENTIONS.md') && /no such file/.test(error.message),
  )
  const there = sectionFor(settings, 'builder', shippedReader({ [join(CREW, 'CONVENTIONS.md')]: 'Read the register first.' }))
  assert.match(handAMemberItsCrewText(there), /Read the register first\./)
})

test('#306: a crew text naming a placeholder Martha does not fill refuses, naming the file and the placeholder', () => {
  const settings = settingsOf()
  const texts = sectionFor(settings, 'builder', shippedReader({ [join(CREW, ROLE_TEXTS_DIRECTORY, 'builder.md')]: 'Ask {{nobody}} about this.' }))
  assert.throws(
    () => handAMemberItsCrewText(texts),
    (error: unknown) => error instanceof CrewTextRefused && error.file === join(CREW, ROLE_TEXTS_DIRECTORY, 'builder.md') && /\{\{nobody\}\}/.test(error.message),
  )
})

test('#306: a section over the ceiling refuses at the constant\'s edge, naming the file and the size, and one at it passes', () => {
  const padded = (size: number): string => 'x'.repeat(size)
  const base = handAMemberItsCrewText(textsOf()).length
  // The conventions text takes the section to exactly the ceiling, and then one character past it.
  const fits = textAt(join(CREW, 'CONVENTIONS.md'), padded(THE_SECTION_CEILING - base - '## Conventions\n\n\n\n'.length))
  assert.equal(handAMemberItsCrewText(textsOf({ conventions: fits })).length, THE_SECTION_CEILING, 'a section exactly at the ceiling was not taken whole')
  const roleText = join(SHIPPED_TEXTS, ROLE_TEXTS_DIRECTORY, 'builder.md')
  const over = textAt(fits.file, `${fits.text}x`)
  assert.throws(
    () => handAMemberItsCrewText(textsOf({ conventions: over })),
    (error: unknown) =>
      error instanceof CrewTextRefused &&
      error.file === fits.file &&
      error.message.includes(String(THE_SECTION_CEILING + 1)) &&
      /over Martha's limit/.test(error.message) &&
      // Every file is named with its size, so the owner can find the one that grew: the longest may not be it.
      error.message.includes(`${fits.file} is ${over.text.length}`) &&
      error.message.includes(`${roleText} is ${shipped(join(ROLE_TEXTS_DIRECTORY, 'builder.md')).length}`),
  )
})

test('#306: every line the section teaches parses with the reader the crew accepts, so what is taught is what is read', () => {
  const section = handAMemberItsCrewText(textsOf())
  const taught = section.split('\n').filter((line) => line.startsWith('- `')).map((line) => line.slice(3, line.indexOf('`', 3)))
  assert.equal(taught.length, 4, `the section teaches ${taught.length} lines, not the four shapes of two verbs`)
  // A taught line is a shape with placeholders in it; the values below are what the crew really sends, so a taught
  // shape that the reader would refuse fails here rather than in a member's session.
  const withValues = (line: string): string =>
    line
      .replaceAll('<org/repo#n>', 'macula-io/martha#306')
      .replaceAll('<base40>', 'a'.repeat(40))
      .replaceAll('<tip40>', 'b'.repeat(40))
      .replaceAll('<run ids>', '41700170944')
      .replaceAll('<url>', 'https://github.com/macula-io/martha/issues/306#issuecomment-1')
      .replaceAll('PASS|FAIL', 'PASS')
      .replaceAll('<N>', '1')
  for (const line of taught) {
    const reading = readACrewLine(withValues(line))
    assert.ok('line' in reading && reading.line !== null, `the section teaches a line the crew refuses: ${line}`)
  }
})

test('#957 gap 13: the Supervisor\'s role text names both lines that hand it an Artifact, filled in, and no placeholder is left (mutant: a line left unfilled)', () => {
  const role_text = textAt(join(SHIPPED_TEXTS, ROLE_TEXTS_DIRECTORY, `${SUPERVISOR}.md`), shipped(join(ROLE_TEXTS_DIRECTORY, `${SUPERVISOR}.md`)))
  const section = handAMemberItsCrewText(textsOf({ member: SUPERVISOR, role: SUPERVISOR, role_text }))
  assert.ok(section.includes(`\`${ARTIFACT_LINES.read}\``), 'the read line is not in the Supervisor\'s text')
  assert.ok(section.includes(`\`${ARTIFACT_LINES.publish}\``), 'the publish line is not in the Supervisor\'s text')
  assert.ok(!section.includes('{{'), 'a placeholder is left in the Supervisor\'s text')
})

test('#306: the files a crew must approve are its roles\' texts, its mode\'s text and the conventions it names', () => {
  const files = crewTextFilesOf(settingsOf({ conventions: 'CONVENTIONS.md' }))
  assert.deepEqual(files, [join(CREW, ROLE_TEXTS_DIRECTORY, 'builder.md'), join(CREW, ROLE_TEXTS_DIRECTORY, 'reviewer.md'), join(CREW, MODE_TEXTS_DIRECTORY, SOLO_MODE + '.md'), join(CREW, 'CONVENTIONS.md')])
  assert.deepEqual(crewTextFilesOf(settingsOf()), crewTextFilesOf(settingsOf()).slice(0, 3), 'a crew naming no conventions is asked for a file it does not have')
  assert.equal(crewTextFilesOf(settingsOf()).length, 3)
})

test('#306: Martha\'s own texts compose for every role it ships, in both modes, with no placeholder left and nothing refused', () => {
  for (const [mode, member] of [[SOLO_MODE, 'builder'], [SOLO_MODE, 'reviewer'], ['team', 'builder'], ['team', 'reviewer'], ['team', 'sup']] as const) {
    const settings = settingsOf({ mode })
    const texts = sectionFor({ ...settings, members: [...settings.members, { name: 'sup', role: SUPERVISOR, model: null, host: null, parked: false, billing: null }] }, member, shippedReader())
    const section = handAMemberItsCrewText({ ...texts, practice: textAt(join(SHIPPED_TEXTS, PRACTICE_TEXT), shipped(PRACTICE_TEXT)) })
    assert.doesNotMatch(section, /\{\{/, `the ${member} text in ${mode} leaves a placeholder: ${section.slice(section.indexOf('## Your role'))}`)
  }
})

test('#306: the crew\'s own text is the bytes the launch carried, and a file on disk that it did not carry is never read', () => {
  const settings = settingsOf({ conventions: 'CONVENTIONS.md' })
  const carried = {
    [join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, 'builder.md')]: Buffer.from('The role text the owner approved.\n'),
    [join(DECLARATION_DIRECTORY, MODE_TEXTS_DIRECTORY, `${SOLO_MODE}.md`)]: Buffer.from('The mode text the owner approved.\n'),
    [join(DECLARATION_DIRECTORY, 'CONVENTIONS.md')]: Buffer.from('Read the register first.\n'),
  }
  const handed = crewTextToHand(settings, 'builder', carried, thisMachine.stores.files)

  assert.ok('text' in handed, 'refusal' in handed ? handed.refusal : '')
  if (!('text' in handed)) return
  assert.ok(handed.text.includes('The role text the owner approved.'), 'the role text handed is not the one the launch carried')
  assert.ok(handed.text.includes('The mode text the owner approved.'))
  assert.ok(handed.text.includes('Read the register first.'), 'the conventions the crew declared are not handed')
})

test('#306: a crew text the launch did not carry is never read off the disk, even when the disk would answer', () => {
  const written = 'Written after the approval.\n'
  // A disk that answers every crew path with a text no approval saw: the reader is never asked, because the crew's own
  // texts are answered from the carried bytes alone (design test 6, a write during the launch).
  const disk = {
    kindOf: (path: string): { readonly kind: 'file'; readonly ownerExecutes: boolean } => (void path, { kind: 'file' as const, ownerExecutes: false }),
    bytesOf: (path: string): Uint8Array => (path.startsWith(SHIPPED_TEXTS) ? thisMachine.stores.files.bytesOf(path) : Buffer.from(written)),
  }
  const handed = crewTextToHand(settingsOf(), 'builder', {}, disk)

  assert.ok('text' in handed, 'refusal' in handed ? handed.refusal : '')
  if (!('text' in handed)) return
  assert.doesNotMatch(handed.text, /Written after the approval/, 'a crew text the launch did not carry was read off the disk')
  // What it does hand is what the approval saw: the role text absent, so Martha's own stands in.
  assert.ok(handed.text.includes('You build and test one work package at a time'), handed.text.slice(0, 400))
})

test('#306: a shipped text that is a directory is refused, naming it, rather than read as absent', () => {
  const aDirectory = { kindOf: () => ({ kind: 'directory' as const }), bytesOf: () => new Uint8Array() }
  const handed = crewTextToHand(settingsOf(), 'builder', {}, aDirectory)

  assert.ok('refusal' in handed, 'a directory where a shipped text should be was read as absent')
  if (!('refusal' in handed)) return
  assert.ok(handed.refusal.includes(join(SHIPPED_TEXTS, ROLE_TEXTS_DIRECTORY, 'builder.md')), handed.refusal)
  assert.match(handed.refusal, /is a directory/)
})

test('#306: a project with no declaration approves no crew text, and a declaration that is refused is told to the owner', async () => {
  const nothing = { read: async (): Promise<string> => { throw Object.assign(new Error('no such file'), { code: 'ENOENT' }) } }
  assert.deepEqual(await crewTextFilesToApprove(nothing, ROOT, CLAUDE_CODE_MODELS), [], 'a project with no crew declared was asked for crew texts')

  const declaration = join(ROOT, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const refused = { read: async (): Promise<string> => JSON.stringify({ version: 1, owner: 'Raf' }) }
  await assert.rejects(
    crewTextFilesToApprove(refused, ROOT, CLAUDE_CODE_MODELS),
    (error: unknown) => error instanceof DeclarationRefused && error.message.startsWith(`${declaration}: `),
    'a declaration that is there and is refused was approved as a project with no crew text',
  )
})

/** A declaration whose house rules turn every ported part on, its table granting the builder both acts (martha#971). */
const settingsWithEveryPortedRule = (): CrewSettings => {
  const base = settingsOf()
  return {
    ...base,
    mode: { ...base.mode, may: { ...base.mode.may, assign_work: ['builder'], [OFFER_OWNER_ASKS]: ['builder'] } },
    house_rules: { ...base.house_rules, workspace_layout: true, clones: '/a/place/for/copies', worktrees: '/a/place/for/branches', review_model: 'a-review-model' },
  }
}

/** The headings of the ported parts a composed section carries, in its order. */
const thePortedHeadings = (section: string): readonly string[] =>
  [...section.matchAll(/^## (Progress|Briefs|Rhythm|Workspace rules|The ask queue|Reviews|Models)$/gm)].map((found) => found[1] ?? '')

test("martha#971: a member granted assign_work and offer_owner_asks, in a crew that turns every rule on, is handed every ported part, in crew-code's order, in Martha's tool names (mutants: each part dropped; each switch or grant read as off)", () => {
  const section = handAMemberItsCrewText(sectionFor(settingsWithEveryPortedRule(), 'builder', shippedReader()))
  assert.deepEqual(thePortedHeadings(section), ['Progress', 'Briefs', 'Rhythm', 'Workspace rules', 'The ask queue', 'Reviews', 'Models'])
  assert.ok(section.includes(`Call ${REPORT_WHERE_THE_WORK_STANDS} when you start an assigned task`), 'the progress part names another tool')
  assert.ok(section.includes(`Run ${VERIFY_RANGE} on the range`), 'the rhythm part names another tool')
  assert.ok(section.includes('A clone in /a/place/for/copies/<org>/<repo> stays on its default branch'), 'the workspace part names another clones place')
  assert.ok(section.includes('a worktree at /a/place/for/branches/<repo>-<slug>'), 'the workspace part names another worktrees place')
  assert.ok(section.includes(`(4) A worktree or branch whose name starts with another member's is theirs: only they remove it, through ${WORKTREE_FINISH}.`), 'the member-work rule is not the fourth')
  assert.ok(section.includes(`call ${TAKE_ASKS} and offer what it returns to Raf as ONE multi-select menu`), 'the ask-queue part names another tool or owner')
  assert.ok(section.includes("Reviews run on a-review-model. When you spawn a subagent to review or attack work, pass model: 'a-review-model'"), 'the reviews part names another model')
  assert.ok(section.includes(`the member switches with ${SWITCH_YOUR_MODEL}`), 'the models part names another tool')
  assert.ok(!section.includes('Held messages'), 'a held-note was handed, and Martha holds no message yet (gap 15)')
})

test("martha#971: a member with neither grant is handed the parts every member reads, and none of the ones for whoever assigns work or offers the asks (mutant: a grant read from another role)", () => {
  const section = handAMemberItsCrewText(sectionFor(settingsWithEveryPortedRule(), 'reviewer', shippedReader()))
  assert.deepEqual(thePortedHeadings(section), ['Progress', 'Workspace rules', 'Reviews'])
})

test("martha#971: a crew that turns no ported rule on hands the progress part alone, and the workspace part follows the git guard's own reading, never member_work (mutants: the progress part dropped; the layout read when it is off; review r=1: rule (4) on member_work)", () => {
  assert.deepEqual(thePortedHeadings(handAMemberItsCrewText(sectionFor(settingsOf(), 'builder', shippedReader()))), ['Progress'])
  const base = settingsOf()
  // member_work is read by no guard: with no layout the guard refuses nothing, so no workspace rule is handed.
  const memberWorkOnly = { ...base, house_rules: { ...base.house_rules, member_work: true } }
  assert.deepEqual(thePortedHeadings(handAMemberItsCrewText(sectionFor(memberWorkOnly, 'builder', shippedReader()))), ['Progress'], 'a rule the guard does not hold was handed as Martha\'s')
  // The guard refuses another member's worktree wherever it holds the places, so that rule is handed with the others.
  const layoutOnly = { ...base, house_rules: { ...base.house_rules, workspace_layout: true, member_work: false, clones: '/a/place/for/copies', worktrees: '/a/place/for/branches' } }
  const guarded = handAMemberItsCrewText(sectionFor(layoutOnly, 'builder', shippedReader()))
  assert.ok(guarded.includes(`(4) A worktree or branch whose name starts with another member's is theirs: only they remove it, through ${WORKTREE_FINISH}.`), 'the rule the guard refuses by was not taught')
  // Places named with the switch off: the part is handed exactly when the guard reads a workspace from the declaration.
  const placesNamedLayoutOff = { ...base, house_rules: { ...base.house_rules, clones: '/a/place/for/copies', worktrees: '/a/place/for/branches' } }
  const handed = thePortedHeadings(handAMemberItsCrewText(sectionFor(placesNamedLayoutOff, 'builder', shippedReader()))).includes('Workspace rules')
  assert.equal(handed, theWorkspaceTheCrewDeclared(placesNamedLayoutOff) !== undefined, 'the workspace part and the guard read the places differently')
})
