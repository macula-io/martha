// The reviewer-model rule, judged on calls as a member makes them (martha#315).
//
// A crew that declares `house_rules.review_model` refuses a subagent that is a review and does not name that model;
// one that declares none refuses nothing. The rule is judged on the call the member made, so the refusal has to say
// what to do — the same call again, with the reviewer model named — and never rewrites the call itself.
//
// Each test names the mutant that must fail it:
//   1 refused shape     the allow-list removed: every subagent call passes
//   2 not-a-review      every subagent call held: a spawn described as anything else is refused
//   3 unset             a reviewer model defaulted in code: a crew that named none refuses a call
//   4 the alias itself  a second spelling invented in code: a full id is read as the alias it resembles

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isAReview, reviewModelRefusal, type ASpawnedAgent, type TheReviewModelRule } from './run_reviews_on_the_review_model.ts'

/** Claude Code's Agent tool, as its own input schema declares it: type, description and model are these fields. */
const CLAUDE_CODE_AGENT: ASpawnedAgent = { tools: ['Agent', 'Task'], type_field: 'subagent_type', description_field: 'description', model_field: 'model' }

/**
 * The rule as a crew that declared a reviewer model is held to. The name is one the host runs, as the declaration
 * refuses any other (../declare_crew); the rule compares the two names as they are written, because the host publishes
 * no mapping from an alias to a full model id and Martha invents no second spelling.
 */
const heldToFable: TheReviewModelRule = { spawn: CLAUDE_CODE_AGENT, review_model: 'fable' }

/** A spawn the member made, with the fields the host's own Agent schema names. */
const aCall = (tool: string, input: Readonly<Record<string, unknown>>) => ({ tool, input })

test('#315: a review spawned on another model is refused, and the refusal names the reviewer model', () => {
  const refused = reviewModelRefusal(aCall('Agent', { subagent_type: 'Explore', description: 'review the patch', prompt: 'p', model: 'opus' }), heldToFable)
  assert.equal(
    refused,
    "Not run: crew reviews run on fable. Call it again with model: 'fable' and the same prompt.",
    'the refusal does not say, in the design\'s own words, what to do',
  )
})

test('#315: a review that names no model at all is refused too, because the host would inherit the member\'s own', () => {
  const refused = reviewModelRefusal(aCall('Agent', { subagent_type: 'claude-code-guide', description: 'a second review of the diff' }), heldToFable)
  assert.ok(refused !== undefined, 'a review that named no model ran on whatever the member runs on, and the rule let it')
  assert.match(refused, /review_model|crew reviews run on fable/, 'the refusal does not name the reviewer model')
})

test('#315: the reviewer model named by its own alias passes (mutant: the alias itself refused)', () => {
  const allowed = reviewModelRefusal(aCall('Agent', { subagent_type: 'Explore', description: 'review the patch', model: 'fable' }), heldToFable)
  assert.equal(allowed, undefined, 'a review naming the reviewer model by the alias the host takes was refused')
})

test('#315: a full model id is not the alias, so the rule refuses it and says which name to use (mutant: a second spelling invented)', () => {
  // The host's own Agent schema takes the aliases alone (`model?: "sonnet" | "opus" | "haiku" | "fable"`), and Martha
  // publishes no mapping from one to a full id: reading `claude-fable-5-1` as `fable` would be a value typed in code
  // that goes stale with the next model. The refusal is what tells the member the name to use.
  const refused = reviewModelRefusal(aCall('Agent', { subagent_type: 'Explore', description: 'review the patch', model: 'claude-fable-5-1' }), heldToFable)
  assert.match(refused ?? '', /crew reviews run on fable/, 'a full model id was read as the alias it resembles, or refused without naming the alias')
})

test('#315: a subagent that is not a review passes whatever model it names (mutant: every spawn held)', () => {
  for (const input of [
    { subagent_type: 'Explore', description: 'find the callers', model: 'opus' },
    { subagent_type: 'general-purpose', description: 'write the notes', model: 'haiku' },
    { description: 'run the suite and report', model: 'sonnet' },
  ]) {
    assert.equal(reviewModelRefusal(aCall('Agent', input), heldToFable), undefined, `a spawn that is not a review was held to the reviewer model: ${JSON.stringify(input)}`)
  }
})

test('#315: a tool that spawns no subagent is never held to the rule', () => {
  assert.equal(reviewModelRefusal(aCall('Bash', { command: 'true', description: 'review everything', model: 'opus' }), heldToFable), undefined, 'a shell call described as a review was held to the reviewer model')
})

test('#315: with no review_model declared, nothing is refused (mutant: a model defaulted in code)', () => {
  const unset: TheReviewModelRule = { ...heldToFable, review_model: null }
  for (const input of [
    { subagent_type: 'Explore', description: 'review the patch', model: 'opus' },
    // A review naming NO model is refused by every default there could be — a crew that declared none cannot refuse it.
    { subagent_type: 'Explore', description: 'review the patch' },
  ]) {
    assert.equal(reviewModelRefusal(aCall('Agent', input), unset), undefined, `a crew that declared no reviewer model refused a review (${JSON.stringify(input)}), so a default was invented in code`)
  }
})

test('#315: a review is what the type or the description says it is, and an adversary counts', () => {
  assert.equal(isAReview({ description: 'a review of the patch' }, CLAUDE_CODE_AGENT), true, 'a description saying review is not a review')
  assert.equal(isAReview({ subagent_type: 'faber-adversary' }, CLAUDE_CODE_AGENT), true, 'an adversary spawn is not held to the rule')
  assert.equal(isAReview({ description: 'review the logs' }, CLAUDE_CODE_AGENT), true, 'the false positive the design accepts is not taken')
  assert.equal(isAReview({ description: 'preview the site' }, CLAUDE_CODE_AGENT), false, 'a word that merely contains the letters was read as a review')
})

// --- package 6b: a reviewer member's own session is a review (martha#541) -------------------------------
//
// A member whose role holds `hold_reviews` spawns nothing to hold: its session IS the review, so it runs on the crew's
// reviewer model or not at all. Each test names the mutant that must fail it:
//   5 the reviewer member's check skipped   a reviewer member starts on any model
//   6 null read as "the host's own, fine"   a reviewer member with no declared model starts
//   7 the reported model not compared       a session the host says runs another model is let run
//   8 the act read as a role name           a role called reviewer without the act is held, or the reverse

import { join } from 'node:path'

import { APPROVE_LANDING, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, declareCrewOnHosts, HOLD_REVIEWS, OFFER_OWNER_ASKS, OWNER, RESTART_MEMBER, THE_HOST_A_MEMBER_RAN_ON, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { OPEN_VOCABULARY, vocabularyOf, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { aReviewerMembersModelRefusal } from './run_reviews_on_the_review_model.ts'

/** A project root that needs no files on disk: the declaration arrives through the host's document store. */
const ROOT = '/a-crew-project'

/** A host that takes any model name, as the engine's delegate tool does: nothing here is refused for its spelling. */
const ANY_MODEL: ModelVocabulary = vocabularyOf(OPEN_VOCABULARY, [])

/** The declaration as a crew writes it, with the reviewer's model and the act's grant set by the test. */
const aDeclaredCrew = async (options: { readonly review_model?: string; readonly reviewer_model?: string | null; readonly grants?: readonly string[]; readonly members?: readonly { name: string; role: string; model: string | null }[] } = {}): Promise<CrewSettings> => {
  // A member names no host here, so each runs on the crew's own: a declaration writes a host only where it differs.
  const declaration = {
    version: DECLARATION_VERSION,
    owner: 'Ann',
    members: options.members ?? [
      { name: 'Builder', role: 'builder', model: null },
      { name: 'Reviewer', role: 'reviewer', model: options.reviewer_model ?? null },
    ],
    mode: {
      name: 'team',
      roles: ['builder', 'reviewer'],
      may: {
        assign_work: [OWNER],
        [APPROVE_LANDING]: [OWNER],
        resume_parked_work: [OWNER],
        [OFFER_OWNER_ASKS]: [OWNER],
        [RESTART_MEMBER]: [OWNER],
        [HOLD_REVIEWS]: options.grants ?? ['reviewer'],
      },
    },
    ...(options.review_model === undefined ? {} : { house_rules: { review_model: options.review_model } }),
  }
  const path = join(ROOT, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const { host } = hostForTests({ documents: { [path]: JSON.stringify(declaration) } })
  return declareCrewOnHosts(host.stores.documents, ROOT, new Map([[THE_HOST_A_MEMBER_RAN_ON, ANY_MODEL]]))
}

const memberNamed = (settings: CrewSettings, name: string) => settings.members.find((one) => one.name === name)!

test('#541 6b: a reviewer member whose declared model is not the reviewer model is refused, by name', async () => {
  const settings = await aDeclaredCrew({ review_model: 'fable', reviewer_model: 'opus' })
  const refused = aReviewerMembersModelRefusal(memberNamed(settings, 'Reviewer'), settings)
  assert.equal(
    refused,
    'Reviewer holds reviews (role reviewer), and this crew holds reviews to fable; its model is opus.',
    'the refusal does not name the member, its role, the crew\'s reviewer model and the model it declares',
  )
})

test('#541 6b: a reviewer member that declares no model of its own is refused too (mutant: null read as fine)', async () => {
  const settings = await aDeclaredCrew({ review_model: 'fable' })
  const refused = aReviewerMembersModelRefusal(memberNamed(settings, 'Reviewer'), settings)
  assert.match(refused ?? '', /holds reviews .* holds reviews to fable; its model is the host's own\./, 'a reviewer member with no declared model was let start')
})

test('#541 6b: a reviewer member on the reviewer model starts, and a member without the act is held to nothing', async () => {
  const settings = await aDeclaredCrew({ review_model: 'fable', reviewer_model: 'fable' })
  assert.equal(aReviewerMembersModelRefusal(memberNamed(settings, 'Reviewer'), settings), undefined, 'a reviewer member on the crew\'s reviewer model was refused')
  assert.equal(aReviewerMembersModelRefusal(memberNamed(settings, 'Builder'), settings), undefined, 'a member whose role holds no reviews was held to the reviewer model (mutant: the act read as a role name)')
})

test('#541 6b: a crew that grants hold_reviews to no role holds no reviewer member to anything', async () => {
  const settings = await aDeclaredCrew({ review_model: 'fable', reviewer_model: 'opus', grants: [OWNER] })
  assert.equal(aReviewerMembersModelRefusal(memberNamed(settings, 'Reviewer'), settings), undefined, 'a crew that granted the act to no role still held its reviewer to the reviewer model')
})

test('#541 6b: a crew that names no reviewer model starts its reviewer as it did before the act existed', async () => {
  const settings = await aDeclaredCrew({ reviewer_model: 'opus' })
  assert.equal(aReviewerMembersModelRefusal(memberNamed(settings, 'Reviewer'), settings), undefined, 'a crew with no reviewer model held its reviewer to a rule it never declared')
})

test('#541 6b: a session the host says runs another model is stopped, naming what it ran (mutant: the reported model not compared)', async () => {
  const settings = await aDeclaredCrew({ review_model: 'fable', reviewer_model: 'fable' })
  const stopped = aReviewerMembersModelRefusal(memberNamed(settings, 'Reviewer'), settings, 'opus')
  assert.match(stopped ?? '', /Reviewer holds reviews .* the host reported this session runs opus\./, 'the model the host reported was not compared with the crew\'s reviewer model')
  assert.equal(aReviewerMembersModelRefusal(memberNamed(settings, 'Reviewer'), settings, 'fable'), undefined, 'a session the host reports on the reviewer model was stopped')
})
