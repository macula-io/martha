// The engine's entry places (#541 package A, design G1, "Proof for G1"): each engine `write` the design names is
// refused through the places the launch hands the entry, by the engine's own tool and argument names and as the engine
// resolves a path; and the re-check after a result runs the launch's own watch before the session store.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import type { OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theSecretsFileOf, THE_CONFIG_FILE, THE_CONFIG_FOLDER } from './launch_a_goose_member.ts'
import { theCalledNameOf, theOwnersEngineFolders, theRootsFolders } from './the_engines_decisions.ts'
import { NO_SESSION_READ_BACK, theEnginesPlaces, type TheEnginesOwnPlaces, type TheSharedPlaces } from './the_engines_places.ts'
import type { TheSessionsGate } from './the_session_store_read_back.ts'

const FACTS = RECORDED_GOOSE_ENGINE

/** The engine's own write tool and the argument it names its file in, as the recording has them (design G1). */
const WRITE = theCalledNameOf(FACTS, FACTS.developer_tools.find((tool) => tool.name === 'write')?.name ?? '')
const PATH = FACTS.developer_tools.find((tool) => tool.name === 'write')?.argument ?? ''

/** No Claude Code memory place: the engine's own folders are what these tests read. */
const NO_CLAUDE_CODE_MEMORY: OwnerMemoryPlaces = { config_dirs: [], memory_roots: [], folders: [], files: [], name_shapes: [], git_config_files: [], git_dirs_named_at_launch: [] }

interface AMachine {
  readonly home: string
  readonly checkout: string
  readonly root: string
  readonly owners_settings: string
}

/** A home with the owner's settings and a checkout two folders below it; the launch's root outside the home. */
function aMachine(t: TestContext): AMachine {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'martha-engine-places-')))
  t.after(() => removeTheTree(top))
  const home = join(top, 'home')
  const checkout = join(home, 'work', 'checkout')
  const root = join(top, 'launch', 'root')
  const owners_settings = join(home, CLAUDE_FOLDER, USER_SETTINGS_FILE)
  for (const folder of [checkout, join(home, CLAUDE_FOLDER), join(root, THE_CONFIG_FOLDER)]) mkdirSync(folder, { recursive: true })
  writeFileSync(owners_settings, '{}\n')
  return { home, checkout, root, owners_settings }
}

/** Only the launch and the machine are read by the closures under test; the rest of the entry's places is the caller's. */
const sharedFor = (machine: AMachine): TheSharedPlaces => ({ launch: { host: FACTS.engine_name, launch_dir: machine.checkout, stop_dir: machine.home, approved_fingerprints: [] }, machine: thisMachine }) as unknown as TheSharedPlaces

function placesFor(machine: AMachine, overrides: Partial<TheEnginesOwnPlaces> = {}) {
  const built = theEnginesPlaces(sharedFor(machine), {
    facts: FACTS,
    root: machine.root,
    home: machine.home,
    owners_settings_file: machine.owners_settings,
    owner_memory: NO_CLAUDE_CODE_MEMORY,
    launcher_env: { HOME: machine.home },
    settings_still_hold: () => undefined,
    the_sessions_gate: () => undefined,
    ...overrides,
  })
  assert.ok(!('refusal' in built), 'refusal' in built ? built.refusal : '')
  return built
}

/** Why the entry's two decisions refuse an engine `write` of `path`, the first that does, or undefined. */
function whyAWriteIsRefused(machine: AMachine, path: string): string | undefined {
  const places = placesFor(machine)
  const input = { [PATH]: path }
  return places.refusesAWriteToTheOwnersSettings(input) ?? places.refusesAWriteToTheOwnersMemory(WRITE, input)
}

test("an engine write naming the owner's Claude Code settings is refused (#541 package A, Proof for G1; mutant: Claude Code's names passed)", (t) => {
  const machine = aMachine(t)
  assert.match(whyAWriteIsRefused(machine, machine.owners_settings) ?? '', /settings/)
})

test("an engine write reaching the owner's settings by a ../../ path from the checkout is refused (#541 package A, Proof for G1)", (t) => {
  const machine = aMachine(t)
  const climbing = relative(machine.checkout, machine.owners_settings)
  assert.ok(climbing.startsWith('../../'), climbing)
  assert.match(whyAWriteIsRefused(machine, climbing) ?? '', /settings/)
})

/** Everything written to the process's own error output while `act` runs (martha#601). */
const theNoticeWhile = (act: () => void): string => {
  const written: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    act()
  } finally {
    process.stderr.write = original
  }
  return written.join('')
}

test("an engine write into the owner's own engine config folder is noticed with one line, and goes ahead (#541 package A, Proof for G1)", (t) => {
  const machine = aMachine(t)
  const folders = theOwnersEngineFolders(FACTS, { HOME: machine.home }, machine.home)
  assert.ok('folders' in folders)
  const config = folders.folders.find((folder) => folder.what.startsWith(join(machine.home, '.config')))
  assert.ok(config !== undefined, JSON.stringify(folders.folders))
  const file = join(config.what, THE_CONFIG_FILE)
  let refusal: string | undefined
  const notice = theNoticeWhile(() => {
    refusal = whyAWriteIsRefused(machine, file)
  })
  assert.equal(refusal, undefined, `the write was refused: ${refusal}`)
  assert.ok(notice.includes(config.what) && notice.includes('the write went ahead'), `the write went ahead without a notice naming ${config.what} (notice: ${notice || 'none'})`)
})

test("an engine write of the launch's secrets.yaml is refused (#541 package A, Proof for G1)", (t) => {
  const machine = aMachine(t)
  assert.match(whyAWriteIsRefused(machine, theSecretsFileOf(FACTS, machine.root)) ?? '', /engine root/)
})

test("an engine write of the root's config/.goosehints is refused, and every folder of the root is (#541 package A, Proof for G1)", (t) => {
  const machine = aMachine(t)
  assert.match(whyAWriteIsRefused(machine, join(machine.root, THE_CONFIG_FOLDER, '.goosehints')) ?? '', /engine root/)
  for (const folder of theRootsFolders(FACTS, machine.root)) assert.match(whyAWriteIsRefused(machine, join(folder, 'a-file')) ?? '', /engine root/, folder)
})

test("a ~/ path is a folder named ~ in the checkout, as the engine resolves it, and is not refused (#541 package A, Proof for G1; mutant: Claude Code's resolver passed)", (t) => {
  const machine = aMachine(t)
  assert.equal(whyAWriteIsRefused(machine, `~/${relative(machine.home, machine.owners_settings)}`), undefined)
  assert.equal(whyAWriteIsRefused(machine, ` ${machine.owners_settings}`), undefined)
})

test("an engine write in the checkout is not refused (#541 package A, Proof for G1)", (t) => {
  const machine = aMachine(t)
  assert.equal(whyAWriteIsRefused(machine, 'notes.md'), undefined)
})

test('the re-check after a result runs the launch’s own watch first and reads no store when it fails (#541 package A, design G1 row checkTheSettingsStillHold)', (t) => {
  const machine = aMachine(t)
  let read = 0
  const places = placesFor(machine, { settings_still_hold: () => 'the watch said so', the_sessions_gate: () => (read++, undefined) })
  assert.equal(places.results?.checkTheSettingsStillHold(), 'the watch said so')
  assert.equal(read, 0)
})

test('a result before the session was read back stops the member, by name (#541 package A, design R1\')', (t) => {
  const machine = aMachine(t)
  assert.equal(placesFor(machine).results?.checkTheSettingsStillHold(), NO_SESSION_READ_BACK)
})

test('after the watch, the session store is read back against the snapshot: a store that is not there stops the member (#541 package A, design R1\')', (t) => {
  const machine = aMachine(t)
  const gate = { id: 'a-session', fields: {}, enabled_extensions: '' } as unknown as TheSessionsGate
  const why = placesFor(machine, { the_sessions_gate: () => gate }).results?.checkTheSettingsStillHold()
  assert.ok(why !== undefined && why !== NO_SESSION_READ_BACK, String(why))
})

test('the engine’s results are recorded by its own rows, with no switch and no start arguments read (#541 package A, design G1)', (t) => {
  const machine = aMachine(t)
  const results = placesFor(machine).results
  assert.ok(results !== undefined)
  assert.ok(WRITE in results.tool_result_rows, JSON.stringify(results.tool_result_rows))
  assert.equal(results.read_attaches_nothing, undefined)
  assert.equal(results.started_with, undefined)
  assert.equal(results.wordless_answers, undefined)
})
