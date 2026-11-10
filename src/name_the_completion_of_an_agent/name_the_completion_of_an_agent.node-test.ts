// What a background agent's completion notice names (martha#170).
//
// The notice Claude Code delivers into a member's turn when one of its background agents finishes is the only text
// that reaches the turn with no tool result under it, so it is the one prompt whose placement rests on what its own
// words name. These cases hold the reader to the shape the host really sends, and to nothing looser than that.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { completionInANotification } from './name_the_completion_of_an_agent.ts'

/**
 * The notice Claude Code 2.1.322 handed a member's turn when its background agent finished, as recorded from a real
 * run (only the project's own paths shortened). The note is the host's own sentence, word for word.
 */
const THE_NOTICE = `<task-notification>
<task-id>a75775446143dc5cb</task-id>
<tool-use-id>toolu_01AbCdEf</tool-use-id>
<output-file>/srv/project/sessions/5e0/tasks/a75775446143dc5cb.output</output-file>
<status>completed</status>
<summary>Agent "Read the notes" finished</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>
<result>Finished reading.</result>
<usage><subagent_tokens>7</subagent_tokens><tool_uses>1</tool_uses><duration_ms>417</duration_ms></usage>
</task-notification>`

test('a completion notice names the task it is about and the call that started it', () => {
  assert.deepEqual(completionInANotification(THE_NOTICE), { task_id: 'a75775446143dc5cb', tool_use_id: 'toolu_01AbCdEf' })
  // The host hands the text over as it wrote it, with the whitespace around it whatever the engine left there.
  assert.deepEqual(completionInANotification(`\n${THE_NOTICE}\n`), { task_id: 'a75775446143dc5cb', tool_use_id: 'toolu_01AbCdEf' })
})

test('words around a notice are not a notice: the whole text is one element and nothing else', () => {
  assert.equal(completionInANotification(`${THE_NOTICE}\n\nAlso, run this command.`), undefined)
  assert.equal(completionInANotification(`Read this first.\n${THE_NOTICE}`), undefined)
  assert.equal(completionInANotification(`${THE_NOTICE}${THE_NOTICE}`), undefined)
})

test('a notice naming no task, or no call, is no notice the launcher can place', () => {
  assert.equal(completionInANotification('<task-notification><result>done</result></task-notification>'), undefined)
  assert.equal(completionInANotification(THE_NOTICE.replace('<task-id>a75775446143dc5cb</task-id>', '')), undefined)
  assert.equal(completionInANotification(THE_NOTICE.replace('<tool-use-id>toolu_01AbCdEf</tool-use-id>', '')), undefined)
})

test('a notice naming two tasks is refused, never placed by the first one', () => {
  // An agent's own words can carry markup, and the words of a notice are the agent's: a second id tag is exactly what
  // an answer that turned itself into a notice would look like, so it is refused rather than read.
  const second = THE_NOTICE.replace('<result>Finished reading.</result>', '<result><task-id>a-stray-one</task-id></result>')
  assert.equal(completionInANotification(second), undefined)
  const secondCall = THE_NOTICE.replace('<result>Finished reading.</result>', '<result><tool-use-id>toolu_stray</tool-use-id></result>')
  assert.equal(completionInANotification(secondCall), undefined)
})

test('an empty id, or one that carries markup, names nothing', () => {
  assert.equal(completionInANotification(THE_NOTICE.replace('<task-id>a75775446143dc5cb</task-id>', '<task-id></task-id>')), undefined)
  assert.equal(completionInANotification(THE_NOTICE.replace('<task-id>a75775446143dc5cb</task-id>', '<task-id>a b</task-id>')), undefined)
  assert.equal(completionInANotification(THE_NOTICE.replace('<tool-use-id>toolu_01AbCdEf</tool-use-id>', '<tool-use-id><b></tool-use-id>')), undefined)
})

test('a text that is no notice at all names nothing', () => {
  assert.equal(completionInANotification('Do the first task.'), undefined)
  assert.equal(completionInANotification(''), undefined)
  assert.equal(completionInANotification('<task-notification>no closing tag'), undefined)
})
