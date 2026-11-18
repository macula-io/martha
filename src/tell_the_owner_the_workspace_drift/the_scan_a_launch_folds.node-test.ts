// What a launch tells the owner about the workspace it was given (martha#562 package 2).
//
// Each case hands the folder its own scan, so these cases read the folder's answers alone: a drift becomes one line on
// the member's row, a scan that could not be made becomes its own line, and a launch with no layout writes nothing.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theRowWithNothingSaid, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { aFolderOfTheScan } from './tell_the_owner_the_workspace_drift.ts'

const MEMBER = 'Hygiea'

/** A directory this test removes when it ends, with the paths hard links are looked up by resolved. */
function aDirectory(t: TestContext, name: string): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), name)))
  t.after(() => removeTheTree(made))
  return made
}

/** A row for the member, kept the way the launcher keeps one, so a fold has one to write into. */
function aRowIn(dashboard: string): void {
  const kept = dashboardRowsIn(dashboard).change(MEMBER, (held) => held ?? ({ ...theRowWithNothingSaid(), member: MEMBER, session: 'session-1', at: 1 } as DashboardRow))
  assert.equal(kept.kept, true, 'the test could not keep a row to fold into')
}

/** The member's row, as the dashboard store holds it. */
const theRowOf = (dashboard: string): DashboardRow | null => dashboardRowsIn(dashboard).read(MEMBER)

/** The layout a scan is given in these cases: what a crew declared, and never read from the disk, since each case hands
 * its own scan to the folder. */
const A_WORKSPACE = { clones: '/the-clones-place', worktrees: '/the-worktrees-place', members: [MEMBER] }

/** The line the folder says when the scan could not be made: written here as the owner reads it, never imported, so a
 * change to the words the owner sees fails this case rather than moving with it. */
const THE_SCAN_FAILED = 'the workspace could not be scanned: run npm run check:workspace-layout by hand'

/** A tick of the launcher's own clock, so what the scan's promise did has settled before the folder is called. */
const aSettledTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** A dashboard with the member's row in it, ready to be folded into. */
function aDashboardWithARow(t: TestContext, name: string): string {
  const directory = aDirectory(t, name)
  const dashboard = join(directory, 'a-dashboard')
  mkdirSync(dashboard)
  aRowIn(dashboard)
  return dashboard
}

test("a launch given no workspace folds nothing, and starts no scan", (t) => {
  const dashboard = aDashboardWithARow(t, 'martha-562-scan-a-')
  let scanned = false
  const folder = aFolderOfTheScan(undefined, MEMBER, dashboardRowsIn(dashboard), async () => {
    scanned = true
    return ['a clone is off its branch']
  })
  folder()
  assert.equal(scanned, false, 'a launch with no layout scanned one anyway')
  assert.equal(theRowOf(dashboard)?.needs, '')
})

test('a drift the scan finds reaches the row as one line, naming the first of them', async (t) => {
  const dashboard = aDashboardWithARow(t, 'martha-562-scan-b-')
  const folder = aFolderOfTheScan(A_WORKSPACE, MEMBER, dashboardRowsIn(dashboard), async () => [
    'one clone is off its branch',
    'another holds work',
  ])
  await aSettledTick()
  folder()
  assert.equal(theRowOf(dashboard)?.needs, 'the workspace drifts from its layout in 2 places, the first being: one clone is off its branch')
})

test('a scan that rejects leaves one line on the row, and nothing goes unhandled', async (t) => {
  const dashboard = aDashboardWithARow(t, 'martha-562-scan-c-')
  const unhandled: unknown[] = []
  const saw = (reason: unknown): void => void unhandled.push(reason)
  process.on('unhandledRejection', saw)
  t.after(() => process.off('unhandledRejection', saw))
  const folder = aFolderOfTheScan(A_WORKSPACE, MEMBER, dashboardRowsIn(dashboard), () => Promise.reject(new Error('the git it asked would not run')))
  await aSettledTick()
  folder()
  assert.equal(theRowOf(dashboard)?.needs, THE_SCAN_FAILED)
  await aSettledTick()
  assert.deepEqual(unhandled, [], 'the rejected scan was left unhandled')
})

test('the folder returns while its scan is still running, and writes nothing until it settles', async (t) => {
  const dashboard = aDashboardWithARow(t, 'martha-562-scan-d-')
  let settled: (lines: readonly string[]) => void = () => {}
  const held = new Promise<readonly string[]>((resolve) => (settled = resolve))
  const folder = aFolderOfTheScan(A_WORKSPACE, MEMBER, dashboardRowsIn(dashboard), () => held)
  // Nothing waits on the scan: the folder was handed back, and the tick before the scan's answer writes nothing.
  folder()
  assert.equal(theRowOf(dashboard)?.needs, '', 'the row took a line before the scan had answered')
  settled(['one clone is off its branch'])
  await aSettledTick()
  folder()
  assert.equal(theRowOf(dashboard)?.needs, 'the workspace drifts from its layout: one clone is off its branch')
})

test('a line already written is not written again on every later tick', async (t) => {
  const dashboard = aDashboardWithARow(t, 'martha-562-scan-e-')
  const folder = aFolderOfTheScan(A_WORKSPACE, MEMBER, dashboardRowsIn(dashboard), async () => ['one clone is off its branch'])
  await aSettledTick()
  folder()
  const written = theRowOf(dashboard)
  await new Promise((resolve) => setTimeout(resolve, 5))
  folder()
  assert.deepEqual(theRowOf(dashboard), written, 'a later tick wrote the same line over itself')
})

test("a line another writer put in the row is left alone, and the scan's line waits for a tick that can take it", async (t) => {
  const dashboard = aDashboardWithARow(t, 'martha-562-scan-f-')
  const beats = dashboardRowsIn(dashboard)
  beats.change(MEMBER, (held) => (held === null ? null : { ...held, needs: 'the owner has a switch to answer' }))
  const folder = aFolderOfTheScan(A_WORKSPACE, MEMBER, beats, async () => ['one clone is off its branch'])
  await aSettledTick()
  folder()
  assert.equal(theRowOf(dashboard)?.needs, 'the owner has a switch to answer', "the scan wrote over another writer's line")
  // The other writer takes its own line back, and the next tick finds the slot free.
  beats.change(MEMBER, (held) => (held === null ? null : { ...held, needs: '' }))
  folder()
  assert.equal(theRowOf(dashboard)?.needs, 'the workspace drifts from its layout: one clone is off its branch')
})
