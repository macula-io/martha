// The host's report of a failed agent, cut from its own text (martha#390): what the names stand for, and what happens
// when the host renames one or stops writing the report at all.
//
// The text here is the shape Claude Code 2.1.323 writes, in the size a test can hold: the declarations, the one function
// that builds the report, and the switch that gives a task its status. The real bundle is cut by the drift job
// (host-drift.yml), which re-records from npm's latest release and names the field that differs.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failedAgentsReportIn, THE_FAILED_TASK_STATUS } from '../read_a_failed_agents_report/read_a_failed_agents_report.ts'

/** The declarations the builder reads, as the host writes them: one run, just before the builder. */
const DECLARED = 'var hf="task-notification",FC="task-id",QY="tool-use-id",I2="task-type",R8e="output-file",oE="status",u_="summary"'

/** The one function that builds the report, and the switch that gives a task its status. */
const BUILDER = 'function Gi({taskId:t,toolUseId:n,taskType:r,outputFile:i,status:s,summary:e,summaryLead:d,body:T,trailing:p}){let l=[[FC,t],[QY,n],[I2,r],[R8e,i],[oE,s],[u_,e]],a=`<${hf}>`;return a}'
const STATUSES = 'function gt(e){switch(e.status){case"working":return{taskId:s,status:"working"};case"failed":return{taskId:s,status:"failed"};case"cancelled":return{taskId:s,status:"cancelled"}}}'

/** The host's own text, as the pieces above make it. */
const HOST = `${DECLARED};${BUILDER}${STATUSES}`

test('the report a host writes for a failed agent is cut from the code that writes it (martha#390)', () => {
  const report = failedAgentsReportIn(HOST)
  assert.equal(report.notification, 'task-notification', 'the envelope the report is wrapped in was not read')
  assert.deepEqual(
    report.elements.map(({ field, element }) => [field, element]),
    [
      ['taskId', 'task-id'],
      ['toolUseId', 'tool-use-id'],
      ['taskType', 'task-type'],
      ['outputFile', 'output-file'],
      ['status', 'status'],
      ['summary', 'summary'],
    ],
    'the elements the report carries are not the ones the host writes, field by field',
  )
  assert.deepEqual(report.task_statuses, ['working', THE_FAILED_TASK_STATUS, 'cancelled'], 'the words a task may end in were not read')
  assert.ok(report.task_statuses.includes(THE_FAILED_TASK_STATUS), 'the word this build decides on is not one the host writes')
})

test('a host that renames an element moves the record, and never reads as one that did not (martha#390)', () => {
  // The point of cutting the names: a rename is followed, and the envelope this tree carries then fails its own check by
  // name rather than a review's failure reading as no failure at all.
  const renamed = failedAgentsReportIn(HOST.replace('FC="task-id"', 'FC="task"'))
  assert.equal(renamed.elements.find(({ field }) => field === 'taskId')?.element, 'task', 'a renamed element was not followed')
})

test('a value the bundle declares twice is resolved by the run the builder reads, never by the bundle at large (martha#390)', () => {
  // A bundle of chunks reuses a minifier's names: `oE` is `status` here and something else in the chunk after, which is
  // exactly how a name read from the bundle at large goes wrong while still looking like a name.
  const otherChunk = 'var oE="ip_udp",FC="a help text"'
  assert.equal(failedAgentsReportIn(`${HOST};${otherChunk}`).elements.find(({ field }) => field === 'status')?.element, 'status', 'a name was taken from another chunk')
})

test('a host that no longer builds the report is refused by name, not read as one that reports nothing (martha#390)', () => {
  assert.throws(
    () => failedAgentsReportIn(HOST.replace('{taskId:t,', '{tid:t,')),
    /the function that builds a failed agent's report/,
    'a host without the builder was read as a host that reports nothing',
  )
  assert.throws(
    () => failedAgentsReportIn(HOST.replace('oE,s', 'oE,q')),
    /which element holds which field cannot be told/,
    'a map that carries the fields in another order was read as the one recorded',
  )
  // A status the host no longer writes is followed, and never quietly kept: the record moves, and the recording's own
  // check refuses one that lost the word this build decides on.
  const withoutTheFailure = failedAgentsReportIn(HOST.replace('case"failed":return{taskId:s,status:"failed"};', ''))
  assert.deepEqual(withoutTheFailure.task_statuses, ['working', 'cancelled'], 'a status the host stopped writing was kept')
  assert.ok(!withoutTheFailure.task_statuses.includes(THE_FAILED_TASK_STATUS), 'the record still says the host writes the failure it does not')
  // Two switches that give a task its status and disagree cannot both be the one the report's status comes from.
  assert.throws(
    () => failedAgentsReportIn(`${HOST}function gt2(e){switch(e.status){case"done":return{taskId:s,status:"done"}}}`),
    /switches that give a task its status/,
    'two disagreeing switches were read as one',
  )
})
