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
  const refused = reviewModelRefusal(aCall('Agent', { subagent_type: 'Explore', description: 'review the patch', model: 'opus' }), unset)
  assert.equal(refused, undefined, 'a crew that declared no reviewer model refused a review, so a default was invented in code')
})

test('#315: a review is what the type or the description says it is, and an adversary counts', () => {
  assert.equal(isAReview({ description: 'a review of the patch' }, CLAUDE_CODE_AGENT), true, 'a description saying review is not a review')
  assert.equal(isAReview({ subagent_type: 'faber-adversary' }, CLAUDE_CODE_AGENT), true, 'an adversary spawn is not held to the rule')
  assert.equal(isAReview({ description: 'review the logs' }, CLAUDE_CODE_AGENT), true, 'the false positive the design accepts is not taken')
  assert.equal(isAReview({ description: 'preview the site' }, CLAUDE_CODE_AGENT), false, 'a word that merely contains the letters was read as a review')
})
