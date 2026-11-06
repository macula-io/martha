import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  declaredHostGlue,
  hostGlueImportedBySlices,
  hostGlueOf,
  launchRecordWritesOutsideTheLauncher,
  type PlantedSource,
} from './only_the_launcher_writes_launch_records.ts'
import { manifestOf, programsRunByScriptsOf, testSuffixesOf } from './declared_in_package_json.ts'

const repository = join(import.meta.dirname, '..')

// The host glue package.json declares: directories under src/ that implement the
// contract on a real machine, so they are not slices (#42).
const hostGlue = [...declaredHostGlue(repository), ...declaredHostGlue(repository, 'hostAdapters')]
// The test files and the programs package.json runs: no slices, so they may import glue.
const testSuffixes = testSuffixesOf(manifestOf(repository))
const programs = programsRunByScriptsOf(manifestOf(repository))

interface Planted {
  readonly caught: Readonly<Record<string, { readonly text: string; readonly lines: readonly number[]; readonly extension?: string }>>
  readonly quiet: readonly string[]
  readonly hostGlueImports: { readonly caught: readonly PlantedSource[]; readonly quiet: readonly PlantedSource[] }
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_launch_record_writes.json'), 'utf8')) as Planted

test('package.json declares the host glue and the host adapter, so the check knows what is not a slice', () => {
  assert.deepEqual(declaredHostGlue(repository), ['linux_process_identity', 'row_streams_directory'])
  assert.deepEqual(declaredHostGlue(repository, 'hostAdapters'), [
    'approve_a_checkouts_config',
    'claude_code_host',
    'claude_code_relay',
    'declare_a_solo_crew',
    'install_the_recorded_mesh_server',
    'keep_martha_state_outside_the_checkout',
    'launch_a_claude_code_member',
    'run_the_martha_command',
    'start_a_member',
  ])
})

test('a hostGlue entry that is not exactly src/<one directory> is refused, with the entry it names', () => {
  const real = (name: string) => name === 'linux_process_identity'
  assert.deepEqual(hostGlueOf(undefined, real), [])
  assert.deepEqual(hostGlueOf(['src/linux_process_identity'], real), ['linux_process_identity'])

  const refused: readonly unknown[] = [
    'src/linux_process_identity',
    ['src'],
    ['src/'],
    ['src/linux_process_identity/'],
    ['src/linux_process_identity/launch_records_directory.ts'],
    ['src/a/b'],
    ['src/..'],
    ['src/.'],
    ['../src/linux_process_identity'],
    ['./src/linux_process_identity'],
    ['lib/linux_process_identity'],
    ['linux_process_identity'],
    ['src\\linux_process_identity'],
    [7],
    ['src/missing_directory'],
    ['src/linux_process_identity', 'src/linux_process_identity'],
  ]
  for (const declared of refused) {
    assert.throws(() => hostGlueOf(declared, real), /martha\.hostGlue/, JSON.stringify(declared))
    assert.throws(() => hostGlueOf(declared, real, 'hostAdapters'), /martha\.hostAdapters/, JSON.stringify(declared))
  }
})

test('no slice but the launcher writes the launcher\'s records', () => {
  assert.deepEqual(launchRecordWritesOutsideTheLauncher(repository, hostGlue), [])
})

test('every planted write is named at its own lines, and every planted read is left alone', () => {
  const caught = Object.entries(planted.caught).map(([kind, source], index) => ({
    kind,
    path: join(`planted_${index}`, `planted${source.extension ?? '.ts'}`),
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

test('no slice imports the host glue, which builds the writable store', () => {
  assert.deepEqual(hostGlueImportedBySlices(repository, hostGlue, testSuffixes, programs), [])

  const { caught, quiet } = planted.hostGlueImports
  const found = hostGlueImportedBySlices(repository, hostGlue, testSuffixes, programs, [...caught, ...quiet])
  assert.deepEqual(
    [...new Set(found.map((reach) => reach.path))].sort(),
    caught.map((source) => source.path).sort(),
  )
})
