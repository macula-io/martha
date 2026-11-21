// Ported from crew-code tests/owner_items.test.ts at crew-code 6f353d51 (martha#999 package 2), case for case. The
// owner is a synthetic name, and the incident lines keep their shape with synthetic repositories.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { briefRefusal, bundledPackages, isBriefPath, unmarkedOwnerItems } from './owner_items.ts'

/** crew-code's matchers, over node:assert, so each case reads as it did there. */
const expect = (actual: unknown) => ({
  toBe: (wanted: unknown) => assert.equal(actual, wanted),
  toEqual: (wanted: unknown) => assert.deepEqual(actual, wanted),
  toHaveLength: (wanted: number) => assert.equal((actual as { length: number }).length, wanted),
  toContain: (wanted: string) => assert.ok(String(actual).includes(wanted), `${String(actual)} does not contain ${wanted}`),
  toBeNull: () => assert.equal(actual, null),
  not: { toBe: (wanted: unknown) => assert.notEqual(actual, wanted) },
})

// crew-code: on 2026-10-28 a handover carried an idea of the owner's ("invite-only") as a decided
// register branch, and a member waited on a flip nobody had decided.

test('a line that puts words or a choice in the owner\'s mouth needs a marker', () => {
  const handover = [
    '- Sam wants the register flipped to invite-only.',
    "- Sam's idea: bracketed peering by distance.",
    '- Sam: "one review per package".',
    '- the owner ruled the address is a locator.',
  ].join('\n')

  expect(unmarkedOwnerItems(handover, 'Sam')).toHaveLength(4)
})

// The lines of the 2026-10-27/28 incident itself, verbatim (review r=1): none of them says "Sam wants"; each waits
// on an act of the owner's, or calls a rule-made choice decided while only telling the owner.
const INCIDENT = [
  "- Realm: wipe MEMBERS only → done instead via the invite-only flip (the InviteOnlyFlip) + admin page (decided by rule, Sam informed): see the realm issue's comment.",
  '- 03:10 DECIDED (rule: admission = licence): invite-only realm closes web join for NEW people; existing members, admin admits, crew invites, bound clients of live persons stay; open realms unchanged. Tell Sam in morning (can overrule).',
  '- realm v0.9.0 TAGGED on 6da9536. Vesta watching image sign + canary pin; then tell Sam to open /admin/self-admission (invite-only flip).',
  '- Sam is about to flip the realm to invite-only. Run after he confirms it, so the measurement covers the closed realm.',
  "- NEW synthetic-owner/realm#98: measure on the live realm (after Sam's invite-only flip) that a granted role ...",
]

test('every line of the 10-27/28 incident needs a marker', () => {
  for (const line of INCIDENT) expect(unmarkedOwnerItems(line, 'Sam')).toHaveLength(1)
  const brief = `## Assignment\n${INCIDENT[4]}\n${INCIDENT[3]}\n`
  expect(briefRefusal(brief, 'Sam')).toContain('line 2:')
  expect(briefRefusal(brief, 'Sam')).toContain('line 3:')
})

test('a line that waits on an act of the owner\'s needs a marker', () => {
  expect(unmarkedOwnerItems('- synthetic-owner/repo#1: land it once Sam has looked.', 'Sam')).toHaveLength(1)
  expect(unmarkedOwnerItems('- synthetic-owner/repo#1: blocked until Sam confirms.', 'Sam')).toHaveLength(1)
  expect(unmarkedOwnerItems("- synthetic-owner/repo#1: waits for Sam's go.", 'Sam')).toHaveLength(1)
  expect(unmarkedOwnerItems('- synthetic-owner/repo#1: needs Sam to decide the form.', 'Sam')).toHaveLength(1)
})

test('IDEA marks a line only as a marker, and a bare DECIDED is no marker', () => {
  expect(unmarkedOwnerItems('- not an IDEA, Sam decided it.', 'Sam')).toHaveLength(1)
  expect(unmarkedOwnerItems('- DECIDED: ship the realm.', 'Sam')).toHaveLength(1)
  expect(unmarkedOwnerItems('- IDEA: Sam floated invite-only.', 'Sam')).toEqual([])
})

test('DECIDED with its day and the owner\'s words, or IDEA, settles the line', () => {
  const handover = [
    '- DECIDED 2026-10-31 "one review per package": Sam ruled it.',
    '- IDEA (no yes yet): Sam floated invite-only.',
  ].join('\n')

  expect(unmarkedOwnerItems(handover, 'Sam')).toEqual([])
})

test('DECIDED without its day or without the owner\'s words is no marker', () => {
  expect(unmarkedOwnerItems('- DECIDED: Sam wants invite-only.', 'Sam')).toHaveLength(1)
  expect(unmarkedOwnerItems('- DECIDED 2026-10-31: Sam wants invite-only.', 'Sam')).toHaveLength(1)
})

test('a line that only names the owner as the one whose yes a push needs is not the owner\'s item', () => {
  const handover = [
    "- every main push needs Sam's yes on the exact range.",
    '- Public diff = Sam menu via the Supervisor.',
    '- Sam asked for a push yes on 3e1f..9a0b.',
    '- ask Sam in your own menu.',
    '- Samuel wants nothing here: another name is not the owner.',
  ].join('\n')

  expect(unmarkedOwnerItems(handover, 'Sam')).toEqual([])
})

test('a fenced block quotes a file or a command, not the owner', () => {
  const handover = ['```', 'Sam said: "ship it"', '```', '- next land it'].join('\n')
  expect(unmarkedOwnerItems(handover, 'Sam')).toEqual([])
})

// crew-code: on 2026-11-05 the mod cleared Vesta (02:44Z) and Neptunus (04:15Z) as having incomplete
// handovers, each for the one line that restates the crew's own marking rule. The check keeps reading that rule as
// an item — narrowly, nothing an owner's line says may pass unmarked — and the crew's templates carry the rule in a
// fenced block instead, which the scan skips, so the crew's own text never trips its own check.
//
// Every copy of the rule the crew is shipped, as it is worded now, the owner filled in: the member's template, the
// Supervisor's template, the handover prompt and the brief prompt. Each is a line the check reads as an item, so each
// is shipped inside a fence, and the rule's own tail — "or IDEA" — must not clear it either.
const RULE_LINES = [
  'Mark every item that comes from Sam DECIDED <YYYY-MM-DD> "<their words>" or IDEA: an idea copied across a refresh must never read as a decision.',
  'Mark every item from Sam DECIDED <YYYY-MM-DD> "<their words>" or IDEA.',
  'Mark every item that comes from Sam (what they said, wanted, ruled or floated) DECIDED <YYYY-MM-DD> "<Sam\'s words>" or IDEA (no yes yet); a line that quotes Sam with neither is sent back.',
  'Mark every item from Sam DECIDED <YYYY-MM-DD> "<Sam\'s words>" or IDEA, and give an IDEA its own section with no package in it: the mod refuses a brief that does neither.',
]

test('the marking rule is an item unless it is fenced, and the fence closes', () => {
  for (const line of RULE_LINES) expect(unmarkedOwnerItems(line, 'Sam')).toHaveLength(1)
  expect(unmarkedOwnerItems(['```text', ...RULE_LINES, '```'].join('\n'), 'Sam')).toEqual([])
  const after = ['```text', ...RULE_LINES, '```', '- Sam wants the register flipped.'].join('\n')
  expect(unmarkedOwnerItems(after, 'Sam')).toHaveLength(1)
})

// crew-code: the fence's end must not be optional. crew-code tells every member to carry the rule inside a
// fence, so a copy that keeps the opening line and drops the closing one is a likely slip — and while an unclosed
// fence ran to the end of the text, that one missing line switched the check off for everything after it.
test('a fence left open at the end of the text is no fence', () => {
  const open = [
    '## Lane',
    '```text',
    'gh issue view 317 --json body',
    '- Sam wants the register invite-only.',
    '- Sam is about to flip the realm.',
  ].join('\n')
  expect(unmarkedOwnerItems(open, 'Sam')).toEqual([
    'line 4: Sam wants the register invite-only.',
    'line 5: Sam is about to flip the realm.',
  ])

  // The same lines behind a fence that closes are still a quote, and the item after it still counts.
  const closed = ['```text', 'gh issue view 317 --json body', '```', '- Sam wants the register invite-only.'].join('\n')
  expect(unmarkedOwnerItems(closed, 'Sam')).toEqual(['line 4: Sam wants the register invite-only.'])
})

// crew-code: the closing fence is the bare one. A fence line carrying an info string ("```sh") opens
// a block, it does not close one, so a dropped closing line is not covered by the next block's opening line — the
// block before it was never closed, and its lines are read as prose.
test('a dropped closing fence is not closed by a later fence in the file', () => {
  const dropped = [
    '## Rule',
    '```text',
    'rule',
    '- Sam said ship the flip on Monday',
    '## Commands',
    '```sh',
    'gh pr view 1',
    '```',
    '- Sam wants the register invite-only.',
  ].join('\n')

  expect(unmarkedOwnerItems(dropped, 'Sam')).toEqual([
    'line 4: Sam said ship the flip on Monday',
    'line 9: Sam wants the register invite-only.',
  ])
})

test('a brief whose fence is never closed still shows the IDEA and the DECIDED item it holds', () => {
  const brief = [
    '## Register',
    '```text',
    '- synthetic-owner/macula-architecture#31: DECIDED 2026-10-28 "reword the publish-authority row".',
    '- IDEA: invite-only register branch.',
  ].join('\n')

  expect(bundledPackages(brief)).toEqual(['synthetic-owner/macula-architecture#31'])
  expect(briefRefusal(brief, 'Sam')).not.toBe('')
})

test('a brief that drops one closing fence before another fence still shows what it holds', () => {
  const brief = [
    '## Register',
    '```text',
    '- synthetic-owner/macula-architecture#31: DECIDED 2026-10-28 "reword the publish-authority row".',
    '- IDEA: invite-only register branch.',
    '## Commands',
    '```sh',
    'gh pr view 1',
    '```',
  ].join('\n')

  expect(bundledPackages(brief)).toEqual(['synthetic-owner/macula-architecture#31'])
  expect(briefRefusal(brief, 'Sam')).not.toBe('')
})

// crew-code: the marker's name at the end of a sentence is a word in that sentence, not a marker. Terra's
// An r=2 probe in crew-code: "- Sam's flip: DECIDED <YYYY-MM-DD> pending, or IDEA" is the owner's flip, pending as one marker
// or the other, and the check cleared it on the base too. Only a word that carries the sentence on — 'or', 'and', a
// comma — and the negation guard stop it; a full stop, an '=' or a possessive end what came before and leave the
// marker a marker, which is how the crew's own handovers write it (Terra's r=1 corpus diff over ~/.claude/sessions).
test('a marker counts only where a marker can start', () => {
  const ITEMS = [
    "- Sam's flip: DECIDED <YYYY-MM-DD> pending, or IDEA",
    "- Sam's flip: DECIDED <YYYY-MM-DD> pending and IDEA",
    "- Sam's flip: DECIDED <YYYY-MM-DD> pending, IDEA",
    "- Sam's flip: DECIDED <YYYY-MM-DD> pending or IDEA",
    "- Sam's flip: DECIDED <YYYY-MM-DD> pending; Sam calls it an IDEA",
    "- not an IDEA, Sam decided it.",
  ]
  for (const line of ITEMS) expect(unmarkedOwnerItems(line, 'Sam')).toHaveLength(1)

  // The forms that do mark: the start of the line's text, after a bullet, after ':', '—', '–', '-' or '(', and after
  // anything else that ends what came before it. The last three are handovers the crew actually wrote, which a check
  // that only accepted a fixed set of separators flagged and would have sent back correct text.
  const MARKED = [
    '- IDEA: Sam floated invite-only.',
    '- IDEA (no yes yet): Sam floated invite-only.',
    '* IDEA: Sam floated invite-only.',
    '1. IDEA: Sam floated invite-only.',
    "- Sam's flip: IDEA",
    "- Sam's flip — IDEA",
    "- Sam's flip – IDEA",
    "- Sam's flip - IDEA",
    "- Sam's flip (IDEA: no yes yet)",
    "- Peering topology: Sam's IDEA (30 Oct, not decided): bracketed peering by distance quotas.",
    'macula-io/martha#18 = IDEA (proposal): fold lazymesh into Martha; Sam said "forget the sheepdog".',
    '3. **the fleet alarm** — a whole-box outage stops every dispatch and the alarm. IDEA (no yes yet): Sam must name an off-box alarm.',
  ]
  for (const line of MARKED) expect(unmarkedOwnerItems(line, 'Sam')).toEqual([])
})

// The rule restated in the Supervisor's reworded form carries no possessive and no upper-case marker, so the check
// already reads it as prose. Kept so a later change does not start flagging it.
test('the rule restated without the owner\'s words is prose', () => {
  const line = '- Briefs and handovers: every line that quotes Sam or waits on him gets the decided marker (date plus his quoted words) or the idea marker.'
  expect(unmarkedOwnerItems(line, 'Sam')).toEqual([])
})

// Every owner item a reviewer probed while this package was being shaped (Terra, r=1 to r=3): each was an item on
// the base check and must stay one, so no later exemption or template change can quietly clear it.
const PROBED_ITEMS = [
  "- after Sam's invite-only flip the register goes invite-only (not DECIDED, not an IDEA yet)",
  "- Sam's words on the flip: it was DECIDED, not an IDEA.",
  '- once Sam confirms? no: once Sam is back, flip invite-only (DECIDED or IDEA unclear)',
  '- tell Sam the invite-only register is waiting (neither DECIDED nor IDEA)',
  "- Sam's idea: invite-only register. Not DECIDED, no IDEA marker yet",
  '- Sam wants the DECIDED marker on the flip, not IDEA.',
  "- Sam's words on the flip: the DECIDED marker, not the IDEA marker.",
  "- Sam's words: invite-only flip gets the DECIDED marker, not the IDEA marker",
  '- waits on Sam: invite-only flip; DECIDED marker or IDEA marker once he answers',
  '- the invite-only flip waits on Sam (DECIDED marker or IDEA marker unclear)',
  '- this comes from Sam: flip invite-only, the DECIDED marker, not the IDEA marker',
  "- Sam's words on the flip: every item gets the DECIDED marker, not the IDEA marker.",
  '- waits on Sam: every line about the invite-only flip, DECIDED marker or IDEA marker',
  '- this comes from Sam: each entry for the flip carries the DECIDED marker, not the IDEA marker',
  "- Sam's words: invite-only flip for every item, the DECIDED marker not the IDEA marker",
]

test('no probed owner item is cleared', () => {
  for (const line of PROBED_ITEMS) expect(unmarkedOwnerItems(line, 'Sam')).toHaveLength(1)
})

// The mutation the r=1 round was argued over: the owner's words are the owner's, in any case of the markers.
test('a claim in the owner\'s mouth that names both markers is still an item', () => {
  expect(unmarkedOwnerItems("- Sam's words on the flip: it was decided, not an idea.", 'Sam')).toHaveLength(1)
})

test('a brief section that holds a package, an IDEA and a DECIDED item is a bundle', () => {
  const brief = [
    '## Register',
    '- synthetic-owner/macula-architecture#31: DECIDED 2026-10-28 "reword the publish-authority row".',
    '- IDEA: invite-only register branch.',
    '## Other',
    '- synthetic-owner/repo#95: DECIDED 2026-11-04 "mark every item".',
  ].join('\n')

  expect(bundledPackages(brief)).toEqual(['synthetic-owner/macula-architecture#31'])
})

test('an IDEA in its own section, with no package in it, bundles nothing', () => {
  const brief = [
    '## Register',
    '- synthetic-owner/macula-architecture#31: DECIDED 2026-10-28 "reword the publish-authority row".',
    '## Ideas, not assigned',
    '- IDEA: invite-only register branch.',
  ].join('\n')

  expect(bundledPackages(brief)).toEqual([])
  expect(briefRefusal(brief, 'Sam')).toBe('')
})

test('the refusal names each reason and what to do about it', () => {
  const brief = ['- synthetic-owner/repo#1: DECIDED 2026-11-04 "go".', '- IDEA: something else.', '- Sam wants it fast.'].join('\n')
  const refusal = briefRefusal(brief, 'Sam')

  expect(refusal).toContain('brief not written')
  expect(refusal).toContain('Sam wants it fast')
  expect(refusal).toContain('synthetic-owner/repo#1')
  expect(refusal).toContain('own section')
})

test('a brief is the BRIEF_<date>_<name>.md file, nothing else', () => {
  expect(isBriefPath('/home/x/sessions/BRIEF_2026-11-04_Saturnus.md')).toBe(true)
  expect(isBriefPath('/home/x/sessions/HANDOVER_2026-11-04_Saturnus.md')).toBe(false)
  expect(isBriefPath('/home/x/BRIEF_notes.md')).toBe(false)
})
