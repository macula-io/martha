// The forms the host writes a completion notice's fields in (martha#170 r=3).
//
// These are constants rather than shapes because each is a fixed word of the host's: a test that read them back from
// the module would agree with itself, so the host's own words are written here as they were recorded, from a live
// member's notice on Claude Code 2.1.322, and held against the module's.

import assert from 'node:assert/strict'
import test from 'node:test'

import { COMPLETION_NOTE, COMPLETION_STATUS, completionNoticeOf, summaryOfAnAgent } from './name_the_completion_of_an_agent.ts'

/** The note sentence the host wrote, copied from a live member's notice. */
const THE_HOSTS_NOTE =
  'A task-notification fires each time this agent stops with no live background children of its own. ' +
  'The user can send it another message and resume it, so the same task-id may notify more than once.'

/** The status the host wrote, and the summary it built from the member's own description. */
const THE_HOSTS_STATUS = 'completed'
const THE_HOSTS_SUMMARY = 'Agent "Read the notes" finished'

test('the note, the status and the summary are the host’s own words, as a live notice carried them (martha#170 r=3)', () => {
  assert.equal(COMPLETION_NOTE, THE_HOSTS_NOTE)
  assert.equal(COMPLETION_STATUS, THE_HOSTS_STATUS)
  assert.equal(summaryOfAnAgent('Read the notes'), THE_HOSTS_SUMMARY)
})

test('the agent’s words may hold a <, and the notice is still read to its own closing tag (martha#170 r=3)', () => {
  const notice =
    '<task-notification>\n' +
    '<task-id>a75775446143dc5cb</task-id>\n' +
    '<tool-use-id>tu-spawn</tool-use-id>\n' +
    '<output-file>/nowhere/tasks/a75775446143dc5cb.output</output-file>\n' +
    `<status>${THE_HOSTS_STATUS}</status>\n` +
    `<summary>${THE_HOSTS_SUMMARY}</summary>\n` +
    `<note>${THE_HOSTS_NOTE}</note>\n` +
    '<result>Left the <div class="note"> in place.</result>\n' +
    '<usage><subagent_tokens>7</subagent_tokens><tool_uses>1</tool_uses><duration_ms>417</duration_ms></usage>\n' +
    '</task-notification>'
  assert.deepEqual(completionNoticeOf(notice), {
    task_id: 'a75775446143dc5cb',
    tool_use_id: 'tu-spawn',
    summary: THE_HOSTS_SUMMARY,
    words: 'Left the <div class="note"> in place.',
  })
})

test('a path that names another task’s output file is not this notice’s (martha#170 r=3)', () => {
  const notice =
    '<task-notification>\n' +
    '<task-id>a75775446143dc5cb</task-id>\n' +
    '<tool-use-id>tu-spawn</tool-use-id>\n' +
    '<output-file>/nowhere/tasks/someone-else.output</output-file>\n' +
    `<status>${THE_HOSTS_STATUS}</status>\n` +
    `<summary>${THE_HOSTS_SUMMARY}</summary>\n` +
    `<note>${THE_HOSTS_NOTE}</note>\n` +
    '<result>Finished reading.</result>\n' +
    '<usage><subagent_tokens>7</subagent_tokens><tool_uses>1</tool_uses><duration_ms>417</duration_ms></usage>\n' +
    '</task-notification>'
  assert.equal(completionNoticeOf(notice), undefined)
})
