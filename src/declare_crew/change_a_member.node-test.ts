// The owner's change to one member of the declaration (martha#307): the text a verb would write, read back through the
// reader before it is handed out, and a refusal with nothing changed when the reader refuses it.
//
// Nothing here touches a disk: the declaration is a text in a map, read through a DocumentStore.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { CLOSED_VOCABULARY, type ModelVocabulary } from './a_hosts_model_vocabulary.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, HOST, soloDeclaration, SOLO_MEMBERS, THE_ENGINES_HOST, THE_HOST_A_MEMBER_RAN_ON, type TheVocabulariesOfHost } from './declare_crew.ts'
import { ADD, aChangedDeclaration, CREW_DEFAULT, HOST_DEFAULT, HOST_SWITCH, MODEL_SWITCH, REMOVE, SET_HOST, SET_MODEL, theChangeTold, theCrewChangeAsked, type CrewChange } from './change_a_member.ts'

const ROOT = '/project'
const DECLARATION = join(ROOT, DECLARATION_DIRECTORY, DECLARATION_FILE)
const SOME_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['some-model', 'other-model'] }
const VOCABULARIES: TheVocabulariesOfHost = new Map([[THE_HOST_A_MEMBER_RAN_ON, SOME_MODELS], [THE_ENGINES_HOST, SOME_MODELS]])
const [BUILDER, REVIEWER] = SOLO_MEMBERS

/** A store that holds one declaration, as text. */
const holding = (text: string) => ({ read: async (path: string) => (path === DECLARATION ? text : Promise.reject(Object.assign(new Error(path), { code: 'ENOENT' }))) })

const solo = (): string => `${JSON.stringify(soloDeclaration('Ada Owner'), null, 2)}\n`

async function changed(text: string, change: CrewChange) {
  return aChangedDeclaration(holding(text), ROOT, VOCABULARIES, change)
}

/** The members the changed text declares, as the file holds them. */
function membersIn(text: string): readonly Record<string, unknown>[] {
  return (JSON.parse(text) as { members: Record<string, unknown>[] }).members
}

test('#307: add puts a member on the crew in a role of the mode, with its model and host, and the reader reads it', async () => {
  const outcome = await changed(solo(), { kind: ADD, member: 'scout', role: REVIEWER.role, model: 'other-model', host: THE_ENGINES_HOST })
  assert.ok('after' in outcome, 'refusal' in outcome ? outcome.refusal : '')
  assert.deepEqual(membersIn(outcome.after).at(-1), { name: 'scout', role: REVIEWER.role, model: 'other-model', [HOST]: THE_ENGINES_HOST })
  const scout = outcome.settings.members.find((member) => member.name === 'scout')
  assert.deepEqual(scout, { name: 'scout', role: REVIEWER.role, model: 'other-model', host: THE_ENGINES_HOST })
  assert.equal(outcome.before, solo())
})

test('#307: add with no model or host writes neither key, so the crew\'s own apply', async () => {
  const outcome = await changed(solo(), { kind: ADD, member: 'scout', role: BUILDER.role, model: null, host: null })
  assert.ok('after' in outcome)
  assert.deepEqual(membersIn(outcome.after).at(-1), { name: 'scout', role: BUILDER.role })
})

test('#307: add of a role the mode does not have is refused with the reader\'s own words, and nothing is handed out', async () => {
  const outcome = await changed(solo(), { kind: ADD, member: 'scout', role: 'astronaut', model: null, host: null })
  assert.ok('refusal' in outcome)
  assert.match(outcome.refusal, /members\[2\]\.role/)
  assert.match(outcome.refusal, /is not a role of this mode/)
})

test('#307: add of a name already on the crew, in another case, is refused by the reader', async () => {
  const outcome = await changed(solo(), { kind: ADD, member: BUILDER.name.toUpperCase(), role: BUILDER.role, model: null, host: null })
  assert.ok('refusal' in outcome)
  assert.match(outcome.refusal, /is on the crew twice/)
})

test('#307: add of a host Martha does not know is refused by the reader', async () => {
  const outcome = await changed(solo(), { kind: ADD, member: 'scout', role: BUILDER.role, model: null, host: 'no-such-host' })
  assert.ok('refusal' in outcome)
  assert.match(outcome.refusal, /is not a host Martha knows/)
})

test('#307: remove takes the one member off, matched by the crew\'s name rule, and keeps every other field as it was', async () => {
  const outcome = await changed(solo(), { kind: REMOVE, member: REVIEWER.name.toUpperCase() })
  assert.ok('after' in outcome, 'refusal' in outcome ? outcome.refusal : '')
  assert.deepEqual(membersIn(outcome.after), [{ ...BUILDER }])
  const { members: _was, ...rest_before } = JSON.parse(solo()) as Record<string, unknown>
  const { members: _now, ...rest_after } = JSON.parse(outcome.after) as Record<string, unknown>
  assert.deepEqual(rest_after, rest_before)
  assert.deepEqual(Object.keys(JSON.parse(outcome.after) as object), Object.keys(JSON.parse(solo()) as object))
})

test('#307: a member not on the crew is refused, naming the members it has', async () => {
  for (const change of [{ kind: REMOVE, member: 'nobody' }, { kind: SET_MODEL, member: 'nobody', model: 'some-model' }, { kind: SET_HOST, member: 'nobody', host: null }] as const) {
    const outcome = await changed(solo(), change)
    assert.ok('refusal' in outcome, change.kind)
    assert.equal(outcome.refusal, `nobody is not on this crew (its members are ${SOLO_MEMBERS.map((member) => member.name).join(', ')}).`)
  }
})

test('#307: set-model writes the member\'s model, and null, the host\'s own, as null', async () => {
  const set = await changed(solo(), { kind: SET_MODEL, member: BUILDER.name, model: 'other-model' })
  assert.ok('after' in set)
  assert.deepEqual(membersIn(set.after)[0], { ...BUILDER, model: 'other-model' })
  const cleared = await changed(set.after, { kind: SET_MODEL, member: BUILDER.name, model: null })
  assert.ok('after' in cleared)
  assert.deepEqual(membersIn(cleared.after)[0], { ...BUILDER, model: null })
  assert.equal(cleared.settings.members[0]!.model, null)
})

test('#307: set-host writes the member\'s host, and the crew default takes the key away', async () => {
  const set = await changed(solo(), { kind: SET_HOST, member: BUILDER.name, host: THE_ENGINES_HOST })
  assert.ok('after' in set)
  assert.deepEqual(membersIn(set.after)[0], { ...BUILDER, [HOST]: THE_ENGINES_HOST })
  const cleared = await changed(set.after, { kind: SET_HOST, member: BUILDER.name, host: null })
  assert.ok('after' in cleared)
  assert.deepEqual(membersIn(cleared.after)[0], { ...BUILDER })
  assert.equal(cleared.settings.members[0]!.host, null)
})

test('#307: a declaration the reader already refuses is refused before any change, with the reader\'s words', async () => {
  const broken = solo().replace('"members"', '"memberz"')
  const outcome = await changed(broken, { kind: REMOVE, member: BUILDER.name })
  assert.ok('refusal' in outcome)
  assert.match(outcome.refusal, /memberz/)
})

test('#307: a change the reader refuses is never handed out, even when the change itself is well formed', async () => {
  // The reviewer model is held to the reviewer's host: moving the reviewer to a host that runs none of it is refused.
  const vocabularies: TheVocabulariesOfHost = new Map([[THE_HOST_A_MEMBER_RAN_ON, SOME_MODELS], [THE_ENGINES_HOST, { kind: CLOSED_VOCABULARY, names: ['engine-only'] }]])
  const with_review_model = JSON.stringify({ ...JSON.parse(solo()) as object, house_rules: { review_model: 'some-model' } })
  const outcome = await aChangedDeclaration(holding(with_review_model), ROOT, vocabularies, { kind: SET_HOST, member: REVIEWER.name, host: THE_ENGINES_HOST })
  assert.ok('refusal' in outcome)
  assert.match(outcome.refusal, /review_model/)
})

test('#307: the changed text is written in init\'s format, and says when the file it read was not', async () => {
  const same = await changed(solo(), { kind: SET_MODEL, member: BUILDER.name, model: 'some-model' })
  assert.ok('after' in same)
  assert.equal(same.reformatted, false)
  assert.equal(same.after, `${JSON.stringify(JSON.parse(same.after), null, 2)}\n`)
  const compact = await changed(JSON.stringify(JSON.parse(solo())), { kind: SET_MODEL, member: BUILDER.name, model: 'some-model' })
  assert.ok('after' in compact)
  assert.equal(compact.reformatted, true)
})

test('#307 R1: a change that leaves a reviewer member off the crew\'s review model is refused with the start\'s own rule', async () => {
  // With review_model set, a member whose role holds reviews starts only on that model (martha#541 6b); a change the
  // reader accepts is still refused here when the start would refuse it, so the owner learns it at the change.
  const held = `${JSON.stringify({ ...JSON.parse(solo()) as object, members: [{ ...BUILDER }, { ...REVIEWER, model: 'some-model' }], house_rules: { review_model: 'some-model' } }, null, 2)}\n`
  for (const change of [
    { kind: SET_MODEL, member: REVIEWER.name, model: 'other-model' },
    { kind: SET_MODEL, member: REVIEWER.name, model: null },
    { kind: ADD, member: 'second-reviewer', role: REVIEWER.role, model: null, host: null },
  ] as const) {
    const outcome = await changed(held, change)
    assert.ok('refusal' in outcome, `${change.kind} ${change.member}`)
    assert.match(outcome.refusal, /holds reviews \(role reviewer\), and this crew holds reviews to some-model/)
  }
  // The same crew takes the change that keeps the reviewer on its model, and a builder's model is not held to it.
  assert.ok('after' in await changed(held, { kind: ADD, member: 'second-reviewer', role: REVIEWER.role, model: 'some-model', host: null }))
  assert.ok('after' in await changed(held, { kind: SET_MODEL, member: BUILDER.name, model: 'other-model' }))
})

test('#307: the words after `martha crew` read as one change, and words no verb takes read as none', () => {
  assert.deepEqual(theCrewChangeAsked([ADD, 'scout', 'builder']), { kind: ADD, member: 'scout', role: 'builder', model: null, host: null })
  assert.deepEqual(theCrewChangeAsked([ADD, 'scout', 'builder', HOST_SWITCH, THE_ENGINES_HOST, MODEL_SWITCH, 'm1']), { kind: ADD, member: 'scout', role: 'builder', model: 'm1', host: THE_ENGINES_HOST })
  assert.deepEqual(theCrewChangeAsked([REMOVE, 'scout']), { kind: REMOVE, member: 'scout' })
  assert.deepEqual(theCrewChangeAsked([SET_MODEL, 'scout', 'm1']), { kind: SET_MODEL, member: 'scout', model: 'm1' })
  assert.deepEqual(theCrewChangeAsked([SET_MODEL, 'scout', HOST_DEFAULT]), { kind: SET_MODEL, member: 'scout', model: null })
  assert.deepEqual(theCrewChangeAsked([SET_HOST, 'scout', THE_ENGINES_HOST]), { kind: SET_HOST, member: 'scout', host: THE_ENGINES_HOST })
  assert.deepEqual(theCrewChangeAsked([SET_HOST, 'scout', CREW_DEFAULT]), { kind: SET_HOST, member: 'scout', host: null })
  for (const words of [
    [], ['rename', 'scout'], [ADD, 'scout'], [ADD, '-scout', 'builder'], [ADD, 'scout', '--role'], [ADD, 'scout', 'builder', MODEL_SWITCH],
    [ADD, 'scout', 'builder', MODEL_SWITCH, 'a', MODEL_SWITCH, 'b'], [ADD, 'scout', 'builder', '--focus', 'x'], [REMOVE], [REMOVE, 'scout', 'extra'],
    [SET_MODEL, 'scout'], [SET_MODEL, 'scout', CREW_DEFAULT], [SET_MODEL, 'scout', 'a', 'b'], [SET_HOST, 'scout', HOST_DEFAULT], [SET_HOST, 'scout', ''],
  ]) assert.equal(theCrewChangeAsked(words), undefined, words.join(' '))
})

test('#307: the owner is told the change, that the file is theirs to commit, and when a running member takes it', async () => {
  const set = await changed(solo(), { kind: SET_MODEL, member: BUILDER.name, model: 'not-a-model' })
  assert.ok('after' in set)
  const told = theChangeTold({ kind: SET_MODEL, member: BUILDER.name, model: 'not-a-model' }, set, VOCABULARIES)
  assert.ok(told.includes(`${BUILDER.name}'s model is not-a-model now.`), told.join('\n'))
  // No new check (DECIDED 2026-11-19): a model the host does not run is written, and the owner is told what it runs.
  assert.ok(told.includes(`${THE_HOST_A_MEMBER_RAN_ON} runs some-model, other-model, and not-a-model is not one of them, so ${BUILDER.name} may not start on it.`), told.join('\n'))
  assert.ok(told.includes(`A running ${BUILDER.name} takes it at its next restart.`), told.join('\n'))
  assert.ok(told.includes(`${DECLARATION} is a file of the checkout: commit it when you are ready.`), told.join('\n'))
  const known = await changed(solo(), { kind: SET_MODEL, member: BUILDER.name, model: 'some-model' })
  assert.ok('after' in known)
  assert.ok(!theChangeTold({ kind: SET_MODEL, member: BUILDER.name, model: 'some-model' }, known, VOCABULARIES).some((line) => line.includes('is not one of them')))
  const compact = await changed(JSON.stringify(JSON.parse(solo())), { kind: REMOVE, member: REVIEWER.name })
  assert.ok('after' in compact)
  const removed = theChangeTold({ kind: REMOVE, member: REVIEWER.name }, compact, VOCABULARIES)
  assert.ok(removed.includes(`${DECLARATION} was not in the format martha init writes, and is written in it now.`), removed.join('\n'))
  assert.ok(!removed.some((line) => line.includes('restart')))
})

test('#307: the declaration is read once, so the text checked is the text changed, whatever a later read would see', async () => {
  // The first read sees the crew; every later read sees a file the reader refuses. A slice that read it twice would
  // check one text and change another.
  let reads = 0
  const changing = { read: async (path: string) => (path === DECLARATION ? (reads++ === 0 ? solo() : 'not json') : Promise.reject(new Error(path))) }
  const outcome = await aChangedDeclaration(changing, ROOT, VOCABULARIES, { kind: REMOVE, member: REVIEWER.name })
  assert.ok('after' in outcome, 'refusal' in outcome ? outcome.refusal : '')
  assert.equal(outcome.before, solo())
  assert.equal(reads, 1)
})
