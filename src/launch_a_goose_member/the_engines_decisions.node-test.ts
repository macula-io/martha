// The values an engine member's calls are judged by (#541 package A, design G1): each read from the engine's facts,
// proved on facts this test spells (names no recorded tool carries, so a value copied from the recording fails) and
// then on the recording, against the design table.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import type { DeveloperTool, EngineFacts } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  asTheEngineResolves,
  namesTheLaunchsRoot,
  theEnginesFileTools,
  theEnginesToolResultRows,
  theOwnersEngineFolders,
  theRootsFolders,
  XDG_DATA_HOME_VARIABLE,
  XDG_STATE_HOME_VARIABLE,
} from './the_engines_decisions.ts'
import { XDG_CONFIG_HOME_VARIABLE } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'

/** A tool this test spells, by its hints in the engine's order: read only, destructive, open world. */
const aTool = (name: string, argument: string, [read_only, destructive, open_world]: readonly [boolean, boolean, boolean]): DeveloperTool => ({
  name,
  params: `${name}Params`,
  argument,
  hints: { read_only, destructive, open_world },
})

/** Seven tools, one of each kind and three with none (each reaching past the machine), none named as the engine names its own. */
const SPELLED: Pick<EngineFacts, 'developer_tools' | 'shell_tool' | 'path_resolution'> = {
  developer_tools: [
    aTool('put', 'target', [false, true, false]),
    aTool('change', 'file', [false, true, false]),
    aTool('run', 'line', [false, true, true]),
    aTool('list', 'dir', [true, false, false]),
    aTool('look', 'where', [false, false, true]),
    aTool('send', 'to', [false, true, true]),
    aTool('browse', 'url', [true, false, true]),
  ],
  shell_tool: 'run',
  path_resolution: { absolute: 'as_given', bases: ['working_dir', 'current_dir', '.'], trims: false, expands_home: false },
}

/** A folder for one test, removed after it, as the file system spells it. */
function aFolder(t: TestContext): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), 'martha-541-decisions-')))
  t.after(() => removeTheTree(made))
  return made
}

const fileToolsOf = (facts: Parameters<typeof theEnginesFileTools>[0]) => {
  const built = theEnginesFileTools(facts)
  assert.ok('tools' in built, `the file tools are built: ${JSON.stringify(built)}`)
  return built.tools
}

test('each tool is placed by its hints: the shell tool a command, a destructive one that stays on the machine one file, a read-only one every file below, any other none (#541 package A, design G1; mutants: each kind branch, open world not read)', () => {
  assert.deepEqual(theEnginesToolResultRows(SPELLED), {
    put: { reads: 'a_file', source: 'checkout_file', field: 'target' },
    change: { reads: 'a_file', source: 'checkout_file', field: 'file' },
    run: { reads: 'a_command', source: 'checkout_run', field: 'line' },
    list: { reads: 'a_search', source: 'checkout_file', field: 'dir' },
  })
})

test('on the recording, the rows are the design table: write and edit one file, tree every file below, shell a command, read_image none (#541 package A, design G1)', () => {
  assert.deepEqual(theEnginesToolResultRows(RECORDED_GOOSE_ENGINE), {
    write: { reads: 'a_file', source: 'checkout_file', field: 'path' },
    edit: { reads: 'a_file', source: 'checkout_file', field: 'path' },
    shell: { reads: 'a_command', source: 'checkout_run', field: 'command' },
    tree: { reads: 'a_search', source: 'checkout_file', field: 'path' },
  })
})

test("the engine's file tools: the one-file tools write, each its own write on its argument; every file and search tool's argument names a file; no whole-file tool (#541 package A, design G1; mutants: search arguments dropped, shell taken as a writer)", () => {
  const tools = fileToolsOf(SPELLED)
  assert.deepEqual(tools.writing_tools, ['put', 'change'])
  assert.deepEqual(tools.file_arguments, ['target', 'file', 'dir'])
  assert.deepEqual(tools.own_writes, { put: 'target', change: 'file' })
  assert.equal(tools.whole_file, undefined)
  const recorded = fileToolsOf(RECORDED_GOOSE_ENGINE)
  assert.deepEqual(recorded.writing_tools, ['write', 'edit'])
  assert.deepEqual(recorded.file_arguments, ['path'])
})

test('a recording whose resolution trims, reads ~, or takes another base first builds no file tools (#541 package A, design G1; mutants: each condition dropped)', () => {
  const resolution = SPELLED.path_resolution
  for (const changed of [
    { ...resolution, trims: true },
    { ...resolution, expands_home: true },
    { ...resolution, bases: ['current_dir', 'working_dir'] },
  ]) {
    const built = theEnginesFileTools({ ...SPELLED, path_resolution: changed })
    assert.ok('refusal' in built && built.refusal.includes('resolves a path in a way this launch does not'), `${JSON.stringify(changed)} is refused: ${JSON.stringify(built)}`)
  }
})

test("a path resolves as the engine reaches it: absolute as given, relative under the session's folder, no ~ and no trim, a .. from where a link leads (#541 package A, design G1)", (t) => {
  const at = aFolder(t)
  const cwd = join(at, 'checkout')
  const elsewhere = join(at, 'elsewhere', 'deep')
  mkdirSync(cwd)
  mkdirSync(elsewhere, { recursive: true })
  symlinkSync(elsewhere, join(cwd, 'link'))
  const home = join(at, 'home')
  assert.equal(asTheEngineResolves(join(at, 'x'), cwd, home), join(at, 'x'))
  assert.equal(asTheEngineResolves('a/b', cwd, home), join(cwd, 'a', 'b'))
  assert.equal(asTheEngineResolves('~/notes', cwd, home), join(cwd, '~', 'notes'))
  assert.equal(asTheEngineResolves(' a', cwd, home), join(cwd, ' a'))
  assert.equal(asTheEngineResolves('./a/../b', cwd, home), join(cwd, 'b'))
  assert.equal(asTheEngineResolves('link/../x', cwd, home), join(at, 'elsewhere', 'x'), 'the .. is taken from where the link leads')
})

test('a call naming a folder of the launch root is refused, by any spelling that reaches it; the root beside them is not (#541 package A, design G1 row (b); mutants: link not followed, a folder dropped)', (t) => {
  const at = aFolder(t)
  const root = join(at, 'root')
  const cwd = join(at, 'checkout')
  mkdirSync(cwd)
  const folders = theRootsFolders(RECORDED_GOOSE_ENGINE, root)
  for (const folder of folders) mkdirSync(folder, { recursive: true })
  const tools = fileToolsOf(RECORDED_GOOSE_ENGINE)
  const [argument] = tools.file_arguments
  assert.ok(argument !== undefined)
  for (const folder of folders) {
    const why = namesTheLaunchsRoot({ [argument]: join(folder, 'any') }, folders, cwd, at, tools)
    assert.ok(why?.includes("a folder of this launch's own engine root"), `${folder} is refused: ${why}`)
  }
  symlinkSync(root, join(cwd, 'into'))
  assert.ok(namesTheLaunchsRoot({ [argument]: 'into/config/secrets.yaml' }, folders, cwd, at, tools), 'a link into the root is followed')
  assert.ok(namesTheLaunchsRoot({ [argument]: '../root/data' }, folders, cwd, at, tools), 'a relative path reaching a folder is refused')
  assert.equal(namesTheLaunchsRoot({ [argument]: join(root, 'beside') }, folders, cwd, at, tools), undefined, 'the root beside its folders is not one of them')
  assert.equal(namesTheLaunchsRoot({ [argument]: join(root, 'configs') }, folders, cwd, at, tools), undefined, 'a name that only begins like a folder is not in it')
  assert.equal(namesTheLaunchsRoot({ other: join(root, 'config') }, folders, cwd, at, tools), undefined, 'an argument that names no file is not read')
})

test("on the recording, the root's folders are config, data, state and .agents, each once (#541 package A, design r=4 R1)", () => {
  assert.deepEqual(theRootsFolders(RECORDED_GOOSE_ENGINE, '/r').sort(), ['/r/.agents', '/r/config', '/r/data', '/r/state'])
})

test("the owner's engine folders: a layout folder under its variable only when absolute, else under the home, with the engine's unixy name; a home folder under the home (#541 package A, design G1; mutants: relative variable taken, name not lowered)", () => {
  const facts: Parameters<typeof theOwnersEngineFolders>[0] = {
    engine_name: 'Some Engine',
    engine_folders: {
      under_root: {},
      without_root: { config: { layout: 'config_dir' }, data: { layout: 'data_dir' }, state: { layout: 'state_dir' }, mine: { home: ['.mine', 'sub'] }, again: { home: ['.mine', 'sub'] } },
    },
  }
  const env = { [XDG_CONFIG_HOME_VARIABLE]: '/xdg/conf', [XDG_DATA_HOME_VARIABLE]: 'relative/data', [XDG_STATE_HOME_VARIABLE]: '' }
  const told = theOwnersEngineFolders(facts, env, '/h')
  assert.ok('folders' in told)
  assert.deepEqual(told.folders.map((folder) => folder.what), ['/xdg/conf/some-engine', '/h/.local/share/some-engine', '/h/.local/state/some-engine', '/h/.mine/sub'])
  assert.ok(told.folders.every((folder) => folder.loaded_by === "the owner's own engine sessions"))
  const unknown = theOwnersEngineFolders({ ...facts, engine_folders: { under_root: {}, without_root: { cache: { layout: 'cache_dir' } } } }, {}, '/h')
  assert.ok('refusal' in unknown && unknown.refusal.includes('cache_dir'), JSON.stringify(unknown))
})

test("on the recording, the owner's engine folders are its XDG config, data and state folders and its ~/.agents (#541 package A, design G1 and r=4)", () => {
  const told = theOwnersEngineFolders(RECORDED_GOOSE_ENGINE, {}, '/h')
  assert.ok('folders' in told)
  assert.deepEqual(told.folders.map((folder) => folder.what).sort(), ['/h/.agents', '/h/.agents/agents', '/h/.agents/plugins', '/h/.config/martha-engine', '/h/.local/share/martha-engine', '/h/.local/state/martha-engine'])
})
