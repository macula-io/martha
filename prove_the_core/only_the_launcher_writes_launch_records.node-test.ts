import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchRecordWritesOutsideTheLauncher, type PlantedSource } from './only_the_launcher_writes_launch_records.ts'

const repository = join(import.meta.dirname, '..')

// The host glue package.json declares: directories under src/ that implement the
// contract on a real machine, so they are not slices (#42).
const declared = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { martha?: { hostGlue?: string[] } }
const hostGlue = (declared.martha?.hostGlue ?? []).map((path) => path.replace(/^src\//, ''))

interface Planted {
  readonly caught: Readonly<Record<string, { readonly text: string; readonly lines: readonly number[] }>>
  readonly quiet: readonly string[]
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_launch_record_writes.json'), 'utf8')) as Planted

test('package.json declares the Linux host glue, so the check knows what is not a slice', () => {
  assert.deepEqual(hostGlue, ['linux_process_identity'])
})

test('no slice but the launcher writes the launcher\'s records', () => {
  assert.deepEqual(launchRecordWritesOutsideTheLauncher(repository, hostGlue), [])
})

test('every planted write is named at its own lines, and every planted read is left alone', () => {
  const caught = Object.entries(planted.caught).map(([kind, source], index) => ({
    kind,
    path: join(`planted_${index}`, 'planted.ts'),
    ...source,
  }))
  const quiet = planted.quiet.map((text, index) => ({ path: join(`quiet_${index}`, 'quiet.ts'), text }))
  const sources: PlantedSource[] = [...caught, ...quiet].map(({ path, text }) => ({ path, text }))

  const found = launchRecordWritesOutsideTheLauncher(repository, hostGlue, sources)

  for (const { kind, path, lines } of caught) {
    const at = [...new Set(found.filter((write) => write.path === path).map((write) => write.line))].sort((a, b) => a - b)
    assert.deepEqual(at, lines, kind)
  }
  for (const { path } of quiet) {
    assert.deepEqual(found.filter((write) => write.path === path), [], path)
  }
})
