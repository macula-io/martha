// The backlog read the crew keeps, and the `unheld_work` answer drawn from it (martha#319, package B).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewPlace, ProcessOutcome } from '../host_contract/host_contract.ts'
import { BACKLOG } from '../declare_crew/declare_crew.ts'
import { BACKLOG_READ_INTERVAL_MS, THE_READ_FILE, theBacklogNow, type TheBacklogReader } from './keep_the_backlog_read.ts'
import { unheldWorkOver, type UnheldWorkAsked } from './unheld_work_tool.ts'
import { UNHELD_WORK_PATH } from './unheld_work_path.ts'
import { INBOUND_PATHS } from '../inbound_paths/inbound_paths.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'

const NOW = Date.parse('2026-11-16T12:00:00Z')

/** A crew place held in memory: what a test keeps in it, and what it reads back. */
function aPlace(): CrewPlace & { readonly files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    path: `/a-crew-store/${BACKLOG}`,
    keep: (name, text) => void files.set(name, text),
    read: (name) => (files.has(name) ? { text: files.get(name) ?? '' } : undefined),
    names: () => [...files.keys()],
  }
}

/** One page holding the issues numbered, and nothing after it. */
const aPage = (...numbers: readonly number[]): ProcessOutcome => ({
  exit_code: 0,
  stderr: '',
  stdout: JSON.stringify({
    data: {
      search: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: numbers.map((number) => ({
          number,
          title: `Issue ${String(number)}`,
          createdAt: '2026-11-10T12:00:00Z',
          body: '',
          repository: { nameWithOwner: 'macula-io/martha' },
          labels: { nodes: [{ name: 'work-package' }] },
          timelineItems: { nodes: [] },
        })),
      },
    },
  }),
})

const FAILED: ProcessOutcome = { exit_code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' }

/** A reader over `place` at `now`, whose `gh` answers each call with the next outcome given. */
function aReader(place: CrewPlace, now: number, ...outcomes: ProcessOutcome[]): TheBacklogReader & { readonly calls: () => number } {
  let calls = 0
  return {
    place,
    now,
    calls: () => calls,
    run: async () => {
      calls += 1
      return outcomes.shift() ?? FAILED
    },
  }
}

/** The tool asked by the Supervisor of a crew that declares a backlog. */
const theSupervisorAsks = (reader: TheBacklogReader, changes: Partial<UnheldWorkAsked> = {}): ReturnType<typeof unheldWorkOver> =>
  unheldWorkOver({
    settings: {
      members: [
        { name: 'Supervisor', role: SUPERVISOR, model: null, host: null },
        { name: 'Vesta', role: 'builder', model: null, host: null },
      ],
      mode: { name: 'team', roles: [SUPERVISOR, 'builder'], may: { assign_work: [SUPERVISOR], approve_landing: ['owner'], resume_parked_work: [SUPERVISOR], offer_owner_asks: ['owner'], restart_member: ['owner'] } },
      backlog: { places: ['macula-io'], idle_minutes: 30 },
    },
    asker: 'Supervisor',
    reader,
    ...changes,
  })

test('#319 B test 3: a failed read shows the last good list beside the error', async () => {
  const place = aPlace()
  const first = await theSupervisorAsks(aReader(place, NOW, aPage(1, 2)))
  assert.ok('answer' in first)
  const later = await theSupervisorAsks(aReader(place, NOW + BACKLOG_READ_INTERVAL_MS, FAILED))
  assert.ok('answer' in later, 'a failed read was refused rather than answered from the kept list')
  assert.match(later.answer, /macula-io\/martha#1/, 'the kept list was dropped when the newer read failed')
  assert.match(later.answer, /macula-io\/martha#2/)
  assert.match(later.answer, /The newest read failed at 12:10 UTC: HTTP 502: Bad Gateway\. This is the last good list\./)
  assert.match(later.answer, /read at 12:00 UTC/, 'the answer does not say when its list was read')
})

test('#319 B: a failed first read is refused, naming the error, and never answered as "nothing is unheld" (review r=1)', async () => {
  const place = aPlace()
  const answer = await theSupervisorAsks(aReader(place, NOW, FAILED))
  assert.deepEqual(answer, {
    refused: 'no read of the backlog has succeeded yet, so there is no list to tell unheld work from; the try at 12:00 UTC failed: HTTP 502: Bad Gateway',
  })
  const within = await theSupervisorAsks(aReader(place, NOW + BACKLOG_READ_INTERVAL_MS - 1, aPage(1)))
  assert.ok('refused' in within, 'inside the interval the kept failed read was answered as a list')
})

test('#319 B: GitHub is asked again only once the interval has passed, and a later good read clears the error', async () => {
  const place = aPlace()
  const reader = aReader(place, NOW, aPage(1))
  await theBacklogNow(reader, ['macula-io'])
  const early = aReader(place, NOW + BACKLOG_READ_INTERVAL_MS - 1, aPage(1, 2))
  const kept = await theBacklogNow(early, ['macula-io'])
  assert.equal(early.calls(), 0, 'GitHub was asked again inside the interval')
  assert.ok(kept !== undefined && !('refusal' in kept) && kept.issues.length === 1)
  await theBacklogNow(aReader(place, NOW + BACKLOG_READ_INTERVAL_MS, FAILED), ['macula-io'])
  const again = await theBacklogNow(aReader(place, NOW + 2 * BACKLOG_READ_INTERVAL_MS, aPage(3)), ['macula-io'])
  assert.ok(again !== undefined && !('refusal' in again))
  assert.equal(again.error, null)
  assert.deepEqual(again.issues.map((issue) => issue.package), ['macula-io/martha#3'])
})

test('#319 B: a launch that cannot run gh answers from the kept read, and says so when there is none', async () => {
  const place = aPlace()
  const none = await theSupervisorAsks({ place, run: undefined, now: NOW })
  assert.deepEqual(none, { refused: 'nothing has read the backlog yet, and this launch cannot run gh to read it.' })
  await theBacklogNow(aReader(place, NOW, aPage(4)), ['macula-io'])
  const kept = await theSupervisorAsks({ place, run: undefined, now: NOW + 3 * BACKLOG_READ_INTERVAL_MS })
  assert.ok('answer' in kept && kept.answer.includes('macula-io/martha#4'))
})

test('#319 B: a kept read that is not one is refused by name, never read as an empty list', async () => {
  const place = aPlace()
  place.files.set(THE_READ_FILE, '{"issues": "not a list"}')
  const answer = await theSupervisorAsks(aReader(place, NOW, aPage(1)))
  assert.deepEqual(answer, { refused: `the crew's backlog read cannot be kept: ${THE_READ_FILE} in the crew's backlog place is not a backlog read` })
})

test('#319 B: only a role the table grants assign_work may ask, and a crew with no backlog has no places to look in', async () => {
  const reader = aReader(aPlace(), NOW, aPage(1))
  const builder = await theSupervisorAsks(reader, { asker: 'Vesta' })
  assert.ok('refused' in builder && builder.refused.startsWith('Vesta may not ask for unheld work'))
  const none = await theSupervisorAsks(reader, {
    settings: { members: [{ name: 'Supervisor', role: SUPERVISOR, model: null, host: null }], mode: { name: 'team', roles: [SUPERVISOR], may: { assign_work: [SUPERVISOR], approve_landing: ['owner'], resume_parked_work: ['owner'], offer_owner_asks: ['owner'], restart_member: ['owner'] } }, backlog: null },
  })
  assert.deepEqual(none, { refused: 'this crew declares no backlog, so there are no places to look for unheld work in.' })
  assert.equal(reader.calls(), 0, 'a refused ask still asked GitHub')
})

test('#319 B test 7: the inbound table names where the answer\'s issue text comes from: fetched, behind the shell gate, nobody attesting', () => {
  const row = INBOUND_PATHS.find((path) => path.id === UNHELD_WORK_PATH)
  assert.ok(row !== undefined, `no inbound path ${UNHELD_WORK_PATH} names the unheld_work answer`)
  assert.deepEqual({ klass: row.klass, control: row.control, attestation: row.attestation }, { klass: 'fetched', control: { kind: 'shell-gate' }, attestation: 'none' })
  assert.match(row.what, /unheld_work/)
})
