import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  declaredHostGlue,
  HOST_GLUE_ROOT,
  hostGlueImportedBySlices,
  hostGlueOf,
  launchRecordWritesOutsideTheLauncher,
  type PlantedSource,
} from './only_the_launcher_writes_launch_records.ts'
import { manifestOf, programsAndTheirPartsOf, testSuffixesOf } from '../read_the_manifest_and_the_linter/declared_in_package_json.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

const repository = join(import.meta.dirname, '../..')

// The host glue package.json declares: directories under src/ that implement the
// contract on a real machine, so they are not slices (#42).
const hostGlue = [...declaredHostGlue(repository), ...declaredHostGlue(repository, 'hostAdapters')]
// The test files, the programs package.json runs and their declared parts (martha#443): no slices, so they may import glue.
const testSuffixes = testSuffixesOf(manifestOf(repository))
const programs = programsAndTheirPartsOf(manifestOf(repository))

interface Planted {
  readonly caught: Readonly<Record<string, { readonly text: string; readonly lines: readonly number[]; readonly extension?: string }>>
  readonly quiet: readonly string[]
  readonly hostGlueImports: { readonly caught: readonly PlantedSource[]; readonly quiet: readonly PlantedSource[] }
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_launch_record_writes.json'), 'utf8')) as Planted

/** The host adapters package.json declares, in its order. */
const THE_HOST_ADAPTERS = [
    'answer_the_relay',
    'approve_a_checkouts_config',
    'ask_git_what_a_member_is_about_to_change',
    'ask_the_host_what_it_loads',
    'claude_code_host',
    'claude_code_relay',
    'cut_the_rules_from_the_host_binary',
    'dashboard_rows_directory',
    'declare_a_solo_crew',
    'drive_the_recorded_host',
    'end_a_launch',
    'end_a_launch_when_its_run_ends',
    'give_a_member_its_own_config',
    'find_a_homes_state_root',
    'guard_the_git_a_member_runs',
    'find_what_a_later_git_run_reads',
    'hear_the_hosts_dialogs',
    'install_the_mesh_server_for_claude_code',
    'install_the_pinned_installer',
    'install_the_recorded_mesh_server',
    'keep_martha_state_outside_the_checkout',
    'keep_where_owners_acts_were_typed',
    'keep_the_relays_journal',
    'keep_what_the_owner_signed',
    'launch_a_claude_code_member',
    'launch_a_goose_member',
    'list_stop_and_restart_the_crew',
    'load_the_hosts_markdown',
    'place_the_hosts_settings',
    'read_a_kernel_and_a_home',
    'refuse_a_git_call_in_a_members_shell',
    'refuse_a_member_writing_owner_memory',
    'refuse_settings_that_turn_hooks_off',
    'run_an_owner_signed_command',
    'run_the_martha_command',
    'run_the_nodes_own_npm_alone',
    'serve_the_crews_tools_to_an_engine',
    'serve_the_relay_to_a_launch',
    'serve_the_owners_answers',
    'start_a_member',
    'start_an_engine_member',
    'start_the_member_on_its_host',
    'start_the_member_on_the_owners_terminal',
    'sweep_leftover_launch_directories',
    'tell_the_member_a_line',
    'read_what_claude_code_says_of_an_agent',
    'read_what_claude_code_records_of_its_tools',
    'a_launch_end_on_this_machine',
    'watch_the_crew_tools_a_launch_served',
]

test('package.json declares the host glue and the host adapter, so the check knows what is not a slice', () => {
  assert.deepEqual(declaredHostGlue(repository), [
    'keep_the_crews_files_as_directories',
    'empty_directory_of_a_launch',
    'linux_process_identity',
    'owners_settings_directory',
    'row_streams_directory',
    'read_one_file_held_by_its_descriptor',
  ])
  assert.deepEqual(declaredHostGlue(repository, 'hostAdapters'), THE_HOST_ADAPTERS)
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

test('a bad hostAdapters entry read from package.json is reported as martha.hostAdapters, not martha.hostGlue (#544)', () => {
  const tree = mkdtempSync(join(tmpdir(), 'martha-544-'))
  try {
    mkdirSync(join(tree, HOST_GLUE_ROOT, 'real_directory'), { recursive: true })
    const real = [`${HOST_GLUE_ROOT}/real_directory`]
    const plant = (hostGlue: readonly unknown[], hostAdapters: readonly unknown[]) =>
      writeFileSync(
        join(tree, 'package.json'),
        JSON.stringify({ martha: { hostGlue, hostAdapters } }),
      )

    plant(real, real)
    assert.deepEqual(declaredHostGlue(tree, 'hostAdapters'), ['real_directory'])

    const refused: readonly (readonly unknown[])[] = [
      ['lib/real_directory'],
      [`${HOST_GLUE_ROOT}/missing_directory`],
      [`${HOST_GLUE_ROOT}/real_directory`, `${HOST_GLUE_ROOT}/real_directory`],
    ]
    for (const hostAdapters of refused) {
      plant(real, hostAdapters)
      assert.throws(() => declaredHostGlue(tree, 'hostAdapters'), /package\.json martha\.hostAdapters /, JSON.stringify(hostAdapters))
      assert.deepEqual(declaredHostGlue(tree), ['real_directory'], JSON.stringify(hostAdapters))
    }
    // The default key's own name is pinned the same way (#565): with only the adapters planted bad, a list name
    // hard-wired in declaredHostGlue would report a bad machine glue entry as the adapters'.
    for (const hostGlue of refused) {
      plant(hostGlue, real)
      assert.throws(() => declaredHostGlue(tree), /package\.json martha\.hostGlue /, JSON.stringify(hostGlue))
      assert.deepEqual(declaredHostGlue(tree, 'hostAdapters'), ['real_directory'], JSON.stringify(hostGlue))
    }
  } finally {
    removeTheTree(tree)
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
