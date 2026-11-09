import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { HOST_TRUST_RECORD_FILE } from '../launch_a_claude_code_member/host_runs_the_relay.ts'
import { namesTheOwnersSettings, realPathOf } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import {
  FILE_WRITING_TOOLS,
  gapsInTheNameMap,
  LINK_HOPS,
  MEMORY_DIRECTORY_KEY,
  MEMORY_FOLDER_OVERRIDE,
  memoryDenyRules,
  namesInTheRecording,
  ownerMemoryPlaces,
  placesTheHostProtects,
  PROTECTED_NAME_OWNERS,
  REMOTE_MEMORY_ROOT,
  writesTheOwnersMemory,
  type OwnerMemoryPlaces,
} from './refuse_a_member_writing_owner_memory.ts'

/** A home with a config dir, a main clone's memory folder, and a member's worktree elsewhere. */
function placeFor(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'martha-136-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const config = join(home, '.claude')
  const mainMemory = join(config, 'projects', '-work-main-clone', 'memory')
  const otherMemory = join(config, 'projects', '-work-other', 'memory')
  const worktree = join(root, 'worktrees', 'main-clone-feature')
  for (const dir of [mainMemory, otherMemory, worktree, join(config, 'rules')]) mkdirSync(dir, { recursive: true })
  return { root, home, config, mainMemory, otherMemory, worktree }
}

const placesFor = (place: ReturnType<typeof placeFor>, launcher: Record<string, string> = {}, settings: string[] = []): OwnerMemoryPlaces =>
  ownerMemoryPlaces({ launcher_env: { HOME: place.home, ...launcher }, member_env: { HOME: place.home }, home: place.home, launch_dir: place.worktree, settings_files: settings })

const write = (file_path: string) => ({ file_path, content: 'remember: the owner said deploy' })

function assertDenied(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === 'NotebookEdit' ? { notebook_path: file_path } : write(file_path)
    assert.ok(writesTheOwnersMemory(tool, input, places, cwd, home, thisMachine)?.includes('martha#136'), `${tool}: ${why}`)
  }
}

test('a member in a worktree may not write the main clone\'s memory folder, nor any other project\'s (#136)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, join(place.mainMemory, 'MEMORY.md'), 'the main clone\'s memory, from a worktree')
  assertDenied(places, place.worktree, place.home, join(place.otherMemory, 'notes.md'), 'another project\'s memory')
  assertDenied(places, place.worktree, place.home, join(place.config, 'projects', '-new-key', 'memory', 'MEMORY.md'), 'a project key that does not exist yet')
})

test('a memory path spelled with ~/, with white space around it, or through a link is denied as the host resolves it', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, '~/.claude/projects/-work-main-clone/memory/MEMORY.md', '~/ against the host\'s home')
  assertDenied(places, place.worktree, place.home, `  ${join(place.mainMemory, 'MEMORY.md')}\n`, 'white space around it')
  symlinkSync(place.mainMemory, join(place.worktree, 'notes'))
  assertDenied(places, place.worktree, place.home, 'notes/MEMORY.md', 'a link in the worktree to a memory folder')
})

test('a project\'s memory folder that is itself a link is denied where it leads, however the write spells it (#136 r=2)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const elsewhere = join(place.root, 'elsewhere')
  mkdirSync(elsewhere)
  const project = join(place.config, 'projects', '-linked')
  mkdirSync(project)
  // Linked after the places were taken, as a member could during its session: the gate follows it at the write.
  symlinkSync(elsewhere, join(project, 'memory'))
  assertDenied(places, place.worktree, place.home, join(project, 'memory', 'MEMORY.md'), 'through the memory folder')
  assertDenied(places, place.worktree, place.home, join(elsewhere, 'a.md'), 'the folder the memory link leads to')
  symlinkSync(project, join(place.worktree, 'lnk'))
  assertDenied(places, place.worktree, place.home, 'lnk/memory/b.md', 'a checkout link to the project, then the memory link')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(elsewhere)}/**)`), 'the permission rules name where a linked memory folder leads')
})

test('a config dir that is a link is denied by its real path too: memory, CLAUDE.md and rules/ (#136 r=2)', (t) => {
  const place = placeFor(t)
  const real = join(place.root, 'real-config')
  mkdirSync(join(real, 'rules'), { recursive: true })
  const linkedConfig = join(place.root, 'config-link')
  symlinkSync(real, linkedConfig)
  const places = placesFor(place, { CLAUDE_CONFIG_DIR: linkedConfig })
  // A key with no folder yet, so only the config dir's own real path can catch it.
  assertDenied(places, place.worktree, place.home, join(real, 'projects', '-new-key', 'memory', 'MEMORY.md'), 'memory, by the real config dir')
  assertDenied(places, place.worktree, place.home, join(real, 'CLAUDE.md'), 'CLAUDE.md, by the real config dir')
  assertDenied(places, place.worktree, place.home, join(real, 'rules', 'deploy.md'), 'rules/, by the real config dir')
  const rules = memoryDenyRules(places)
  // Where the link leads, as the host resolves it: the scratch root a test runs in
  // is itself reached through a link on macOS and in the suite's long-TMPDIR run (martha#79).
  const leads = realPathOf(real)
  for (const rule of [`Write(/${join(leads, 'projects')}/*/memory/**)`, `Write(/${join(leads, 'rules')}/**)`, `Write(/${join(leads, 'CLAUDE.md')})`]) {
    assert.ok(rules.includes(rule), `${rule} in ${rules.join(' ')}`)
  }
})

test('a config dir whose projects folder is a link to another disk denies a real-path write into a project with no folder yet (#136 r=3)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'other-disk')
  mkdirSync(join(disk, '-home-owner-work'), { recursive: true })
  rmSync(join(place.config, 'projects'), { recursive: true, force: true })
  symlinkSync(disk, join(place.config, 'projects'))
  const places = placesFor(place)
  // No folder for this project yet anywhere, so only the projects folder as it leads can catch it.
  assertDenied(places, place.worktree, place.home, join(disk, '-home-owner-next', 'memory', 'MEMORY.md'), 'a project with no folder yet, by the real projects folder')
  assert.ok(memoryDenyRules(places).includes(`Write(/${join(realPathOf(disk))}/*/memory/**)`), 'the permission rules name where the projects folder leads')
})

test('a project\'s memory folder that is a link to a folder that does not exist yet is denied where it will lead (#136 r=3)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const notYet = join(place.root, 'not-yet-created', 'memory')
  const project = join(place.config, 'projects', '-dangling')
  mkdirSync(project)
  symlinkSync(notYet, join(project, 'memory'))
  assertDenied(places, place.worktree, place.home, join(notYet, 'MEMORY.md'), 'the folder the link will lead to')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(notYet)}/**)`), 'the permission rules name where a link with no target yet will lead')
})

/** A chain of `links` links under `base`, each pointing at the next and the last at `to`: returns the first (martha#136 r=4). */
function chainAt(base: string, links: number, to: string): string {
  mkdirSync(base, { recursive: true })
  let target = to
  for (let index = links; index >= 1; index -= 1) {
    const link = join(base, `hop-${index}`)
    symlinkSync(target, link)
    target = link
  }
  return target
}

test('a memory folder that is a two-hop chain of links is denied where the chain ends, though the end does not exist yet (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const end = join(place.root, 'end-not-yet')
  const project = join(place.config, 'projects', '-two-hop')
  mkdirSync(project)
  symlinkSync(chainAt(join(place.root, 'hops'), 1, end), join(project, 'memory'))
  assertDenied(places, place.worktree, place.home, join(end, 'MEMORY.md'), 'where the two-hop chain ends')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(end)}/**)`), 'the permission rules name the end of the chain')
})

test('a projects folder that is a link to a disk folder that does not exist yet denies a write into it (#136 r=4)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'disk-not-yet')
  rmSync(join(place.config, 'projects'), { recursive: true, force: true })
  symlinkSync(disk, join(place.config, 'projects'))
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, join(disk, '-new', 'memory', 'MEMORY.md'), 'a project under the disk the projects folder will be')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(disk)}/*/memory/**)`), 'the permission rules name the disk it will lead to')
})

test('a project folder that is a link to a folder that does not exist yet denies a write into its memory (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const elsewhere = join(place.root, 'project-not-yet')
  symlinkSync(elsewhere, join(place.config, 'projects', '-project-link'))
  assertDenied(places, place.worktree, place.home, join(elsewhere, 'memory', 'MEMORY.md'), 'the memory of the project folder the link will lead to')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(join(elsewhere, 'memory'))}/**)`), 'the permission rules name where that memory folder will be')
})

test('a chain of links at the cap is followed and denied at its end (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const end = join(place.root, 'end-at-cap')
  const project = join(place.config, 'projects', '-at-cap')
  mkdirSync(project)
  symlinkSync(chainAt(join(place.root, 'hops-at-cap'), LINK_HOPS - 1, end), join(project, 'memory'))
  assertDenied(places, place.worktree, place.home, join(end, 'MEMORY.md'), 'the end of a chain at the cap')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(end)}/**)`), 'the permission rules name the end of a chain at the cap')
})

test('a chain of links one past the cap is refused, and no write is allowed while it stands (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const end = join(place.root, 'end-past-cap')
  const project = join(place.config, 'projects', '-past-cap')
  mkdirSync(project)
  symlinkSync(chainAt(join(place.root, 'hops-past-cap'), LINK_HOPS, end), join(project, 'memory'))
  for (const file_path of [join(end, 'MEMORY.md'), join(place.worktree, 'notes.md')]) {
    const why = writesTheOwnersMemory('Write', { file_path, content: 'x' }, places, place.worktree, place.home, thisMachine)
    assert.ok(why?.includes('cannot be followed to its end'), `${file_path} is refused: ${why}`)
  }
})

test('a link that turns on itself is refused, and a read of the same path is not a write (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const project = join(place.config, 'projects', '-cycle')
  mkdirSync(project)
  symlinkSync(join(project, 'second'), join(project, 'memory'))
  symlinkSync(join(project, 'memory'), join(project, 'second'))
  const memory = join(project, 'memory', 'MEMORY.md')
  const why = writesTheOwnersMemory('Write', { file_path: memory, content: 'x' }, places, place.worktree, place.home, thisMachine)
  assert.ok(why?.includes('cannot be followed to its end'), `a cycle is refused: ${why}`)
  assert.equal(writesTheOwnersMemory('Read', { file_path: memory }, places, place.worktree, place.home, thisMachine), undefined, 'a read is not a write')
})

test('a projects folder that is a chain of links past the cap is refused, not dropped (#136 r=5)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'disk-past-cap')
  rmSync(join(place.config, 'projects'), { recursive: true, force: true })
  symlinkSync(chainAt(join(place.root, 'projects-past-cap'), LINK_HOPS, disk), join(place.config, 'projects'))
  const places = placesFor(place)
  for (const file_path of [join(disk, '-new', 'memory', 'MEMORY.md'), join(place.worktree, 'notes.md')]) {
    const why = writesTheOwnersMemory('Write', { file_path, content: 'x' }, places, place.worktree, place.home, thisMachine)
    assert.ok(why?.includes('cannot be followed to its end'), `${file_path} is refused: ${why}`)
  }
})

test('a project folder that is a chain of links past the cap is refused, not dropped (#136 r=5)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const pe = join(place.root, 'pe-past-cap')
  symlinkSync(chainAt(join(place.root, 'project-past-cap'), LINK_HOPS, pe), join(place.config, 'projects', '-chain'))
  const why = writesTheOwnersMemory('Write', { file_path: join(pe, 'memory', 'MEMORY.md'), content: 'x' }, places, place.worktree, place.home, thisMachine)
  assert.ok(why?.includes('cannot be followed to its end'), `refused: ${why}`)
})

test('a projects folder that is a chain of links at the cap is followed and denied where it ends (#136 r=5)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'disk-at-cap')
  rmSync(join(place.config, 'projects'), { recursive: true, force: true })
  symlinkSync(chainAt(join(place.root, 'projects-at-cap'), LINK_HOPS - 1, disk), join(place.config, 'projects'))
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, join(disk, '-new', 'memory', 'MEMORY.md'), 'a project under a chain at the cap')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(disk)}/*/memory/**)`), 'the permission rules name where the chain ends')
})

test('a project folder that is a chain of links at the cap is followed and denied where it ends (#136 r=5)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const pe = join(place.root, 'pe-at-cap')
  symlinkSync(chainAt(join(place.root, 'project-at-cap'), LINK_HOPS - 1, pe), join(place.config, 'projects', '-chain-at-cap'))
  assertDenied(places, place.worktree, place.home, join(pe, 'memory', 'MEMORY.md'), 'the memory of the project folder the chain leads to')
  assert.ok(memoryDenyRules(places).includes(`Write(/${realPathOf(join(pe, 'memory'))}/**)`), 'the permission rules name it')
})

test('the owner\'s CLAUDE.md and rules are denied, in the launcher\'s config dir and in the member\'s when it differs', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, join(place.config, 'CLAUDE.md'), 'the owner\'s instructions')
  assertDenied(places, place.worktree, place.home, join(place.config, 'rules', 'deploy.md'), 'a file in the owner\'s rules')

  // (a) the launcher's CLAUDE_CONFIG_DIR is a scratch folder: that folder is the owner's.
  const scratchConfig = join(place.root, 'scratch-config')
  const scratchPlaces = placesFor(place, { CLAUDE_CONFIG_DIR: scratchConfig })
  assertDenied(scratchPlaces, place.worktree, place.home, join(scratchConfig, 'projects', 'x', 'memory', 'MEMORY.md'), 'the launcher\'s CLAUDE_CONFIG_DIR')
  // (b) the member's host resolves another dir than the launcher's: both are denied.
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
  })
  assertDenied(both, place.worktree, place.home, join(scratchConfig, 'projects', 'x', 'memory', 'MEMORY.md'), 'the launcher\'s dir')
  assertDenied(both, place.worktree, place.home, join(place.config, 'projects', 'x', 'memory', 'MEMORY.md'), 'the member\'s own dir')
})

test('the folders the launcher\'s environment moves memory to, and a settings file\'s memory folder, are denied', (t) => {
  const place = placeFor(t)
  const override = join(place.root, 'cowork-memory')
  const remote = join(place.root, 'remote')
  const named = join(place.root, 'named-memory')
  const settings = join(place.root, 'settings.json')
  writeFileSync(settings, JSON.stringify({ [MEMORY_DIRECTORY_KEY]: named }))
  const places = placesFor(place, { [MEMORY_FOLDER_OVERRIDE]: override, [REMOTE_MEMORY_ROOT]: remote }, [settings])
  assertDenied(places, place.worktree, place.home, join(override, 'MEMORY.md'), MEMORY_FOLDER_OVERRIDE)
  assertDenied(places, place.worktree, place.home, join(remote, 'projects', 'x', 'memory', 'MEMORY.md'), REMOTE_MEMORY_ROOT)
  assertDenied(places, place.worktree, place.home, join(named, 'MEMORY.md'), MEMORY_DIRECTORY_KEY)
})

test('a write elsewhere under projects/, outside the checkout, and any read of a memory file, are allowed', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  for (const tool of FILE_WRITING_TOOLS) {
    assert.equal(writesTheOwnersMemory(tool, write(join(place.config, 'projects', '-work-main-clone', 'session.jsonl')), places, place.worktree, place.home, thisMachine), undefined, tool)
    assert.equal(writesTheOwnersMemory(tool, write(join(place.worktree, 'memory', 'notes.md')), places, place.worktree, place.home, thisMachine), undefined, tool)
  }
  assert.equal(writesTheOwnersMemory('Read', { file_path: join(place.mainMemory, 'MEMORY.md') }, places, place.worktree, place.home, thisMachine), undefined)
})

test('the permission rules name the same places the gate denies, a Write and an Edit rule each', (t) => {
  const place = placeFor(t)
  const override = join(place.root, 'cowork-memory')
  const places = placesFor(place, { [MEMORY_FOLDER_OVERRIDE]: override })
  const rules = memoryDenyRules(places)
  // A place reached through a link is named twice, as spelled and as it leads
  // (martha#79), so the count is not fixed: each rule is a Write, and the same
  // Edit, of one place.
  assert.deepEqual(
    rules.filter((rule) => rule.startsWith('Edit(/')).map((rule) => rule.replace(/^Edit/, 'Write')),
    rules.filter((rule) => rule.startsWith('Write(/')),
    'every rule comes as a Write and an Edit of the same place',
  )
  assert.ok(rules.includes(`Write(/${join(place.config, 'projects')}/*/memory/**)`), rules.join(' '))
  assert.ok(rules.includes(`Edit(/${override}/**)`), rules.join(' '))
  assert.ok(rules.includes(`Write(/${join(place.config, 'CLAUDE.md')})`), rules.join(' '))
  assert.ok(rules.every((rule) => /^(Write|Edit)\(\/\//.test(rule)), 'every rule names an absolute path')
})

/**
 * The places the host records under a config dir as ones its own sessions run as
 * code, and which this guard refuses (martha#187). These names are the test's own
 * statement of what must be refused rather than a read of the recording, so a
 * place that drops out of the recording still fails here.
 */
const CODE_FOLDERS: readonly string[] = ['backups', 'daemon', 'hooks', 'jobs', 'plugins', 'routines', 'session-env', 'shell-snapshots', 'workflows']
const CODE_FILES: readonly string[] = ['daemon.json', 'launch.json', 'scheduled_tasks.json']

for (const folder of CODE_FOLDERS) {
  test(`a member may not write the owner's ${folder} folder, whose files the host runs as code (martha#187)`, (t) => {
    const place = placeFor(t)
    assertDenied(placesFor(place), place.worktree, place.home, join(place.config, folder, 'run.sh'), `the host runs what is in ${folder}`)
  })
}

for (const file of CODE_FILES) {
  test(`a member may not write the owner's ${file}, which the host acts on as code (martha#187)`, (t) => {
    const place = placeFor(t)
    assertDenied(placesFor(place), place.worktree, place.home, join(place.config, file), `the host acts on ${file}`)
  })
}

test('a member may not write the owner\'s user settings file, in the launcher\'s config dir and in the member\'s (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const scratchConfig = join(place.root, 'scratch-config')
  mkdirSync(scratchConfig, { recursive: true })
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
  })
  assertDenied(both, place.worktree, place.home, join(scratchConfig, USER_SETTINGS_FILE), 'the launcher\'s settings file')
  assertDenied(places, place.worktree, place.home, join(place.config, USER_SETTINGS_FILE), 'the member\'s settings file')
})

test('a link to the owner\'s settings file whose target does not exist yet is refused here, where the settings check cannot see it (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const settings = join(place.config, USER_SETTINGS_FILE)
  assert.equal(existsSync(settings), false, 'the settings file is absent, so the link has no target')
  symlinkSync(USER_SETTINGS_FILE, join(place.config, 'sneaky'))
  const file_path = join(place.config, 'sneaky')
  assert.equal(namesTheOwnersSettings({ file_path }, settings, place.worktree, place.home), undefined, 'the settings check compares the link itself, not where it leads')
  assertDenied(placesFor(place), place.worktree, place.home, file_path, 'the link this guard follows to its end')
})

test('a member may not write the owner\'s user MCP config, in the config dir or beside the home folder, in the launcher\'s environment and the member\'s (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const scratchConfig = join(place.root, 'scratch-config')
  mkdirSync(scratchConfig, { recursive: true })
  // CLAUDE_CONFIG_DIR unset: the host's global config is beside the home folder, not in ~/.claude.
  assertDenied(places, place.worktree, place.home, join(place.home, HOST_TRUST_RECORD_FILE), 'beside the home folder')
  // CLAUDE_CONFIG_DIR set on either side: the file is in that dir, and both dirs are denied.
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
  })
  assertDenied(both, place.worktree, place.home, join(scratchConfig, HOST_TRUST_RECORD_FILE), 'in the launcher\'s config dir')
  assertDenied(both, place.worktree, place.home, join(place.home, HOST_TRUST_RECORD_FILE), 'the member\'s own global config')
})

test('a link at the owner\'s user MCP config whose target does not exist yet is denied where it will write (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const target = join(place.root, 'not-yet', HOST_TRUST_RECORD_FILE)
  symlinkSync(target, join(place.home, HOST_TRUST_RECORD_FILE))
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, join(place.home, HOST_TRUST_RECORD_FILE), 'the link where the host reads the config')
  assertDenied(places, place.worktree, place.home, target, 'the file the link will write')
})

/**
 * A write a member would make inside each place the map says another package
 * denies (martha#187 r=2), relative to a config dir. The test's own statement, so
 * a name marked `denied_by` with no write here fails by name; and each of these
 * must be refused through the gate before #187 lands — #154 is what refuses the
 * markdown folders, the output styles and the transcript streams.
 */
const A_WRITE_INTO: Readonly<Record<string, string>> = {
  skills: 'skills/deploy.md',
  commands: 'commands/deploy.md',
  agents: 'agents/deploy.md',
  'output-styles': 'output-styles/deploy.md',
  rules: 'rules/deploy.md',
  'CLAUDE.md': 'CLAUDE.md',
  projects: 'projects/-home-owner-work/session.jsonl',
}

test('every place the map says another package denies is refused through the real gate (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const deniedBy = Object.entries(PROTECTED_NAME_OWNERS)
    .filter(([, owner]) => 'denied_by' in owner)
    .map(([name]) => name)
  assert.deepEqual(deniedBy.sort(), Object.keys(A_WRITE_INTO).sort(), 'every name the map says another package denies has a write this test makes')
  // The gate is known to run: a write outside every place is allowed.
  assert.equal(writesTheOwnersMemory('Write', write(join(place.worktree, 'notes.md')), places, place.worktree, place.home, thisMachine), undefined, 'a write outside every place')
  for (const name of deniedBy) {
    const file_path = join(place.config, A_WRITE_INTO[name] ?? '')
    assert.notEqual(writesTheOwnersMemory('Write', write(file_path), places, place.worktree, place.home, thisMachine), undefined, `${name}: ${file_path} is refused`)
  }
})

test('the permission rules carry every place the host runs as code into permissions.deny, a Write rule and an Edit rule each (martha#187)', (t) => {
  const place = placeFor(t)
  const rules = memoryDenyRules(placesFor(place))
  for (const folder of CODE_FOLDERS) {
    assert.ok(rules.includes(`Write(/${join(place.config, folder)}/**)`), folder)
    assert.ok(rules.includes(`Edit(/${join(place.config, folder)}/**)`), folder)
  }
  for (const file of [...CODE_FILES, USER_SETTINGS_FILE]) {
    assert.ok(rules.includes(`Write(/${join(place.config, file)})`), file)
    assert.ok(rules.includes(`Edit(/${join(place.config, file)})`), file)
  }
  const config = join(place.home, HOST_TRUST_RECORD_FILE)
  assert.ok(rules.includes(`Write(/${config})`), `Write(/${config}) in ${rules.join(' ')}`)
  assert.ok(rules.includes(`Edit(/${config})`), `Edit(/${config}) in ${rules.join(' ')}`)
})

test('every name the host records as a protected config-dir place has an owner, and no owner names a place the host has dropped (martha#187)', () => {
  assert.deepEqual(gapsInTheNameMap(namesInTheRecording(RECORDED_HOST)), { unowned: [], stale: [] })
})

test('a name a later host records with no owner fails the mapping test by name (martha#187)', () => {
  const added = [...namesInTheRecording(RECORDED_HOST), 'a-place-a-later-host-added']
  assert.deepEqual(gapsInTheNameMap(added).unowned, ['a-place-a-later-host-added'])
  assert.deepEqual(gapsInTheNameMap(added).stale, [])
})

test('a name the host no longer records fails the mapping test by name (martha#187)', () => {
  const [dropped, ...rest] = namesInTheRecording(RECORDED_HOST)
  assert.ok(dropped !== undefined, 'the recording holds at least one name')
  assert.deepEqual(gapsInTheNameMap(rest).stale, [dropped])
  assert.deepEqual(gapsInTheNameMap(rest).unowned, [])
})

test('the places this guard denies are exactly the recorded names it owns, split into folders and files (martha#187)', () => {
  const owned = namesInTheRecording(RECORDED_HOST).filter((name) => {
    const owner = PROTECTED_NAME_OWNERS[name]
    return owner !== undefined && 'denied_here' in owner
  })
  const places = placesTheHostProtects()
  assert.deepEqual([...places.folders, ...places.files].sort(), owned.sort())
})

// --- what a later git run of the owner's reads (martha#168) -----------------------

/** Every file tool, refused as a git place, naming martha#168 and no other reason. */
function assertRefusedAsGit(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === 'NotebookEdit' ? { notebook_path: file_path } : write(file_path)
    const said = writesTheOwnersMemory(tool, input, places, cwd, home, thisMachine)
    assert.ok(said?.includes('martha#168'), `${tool}: ${why} (${said ?? 'admitted'})`)
    assert.ok(said !== undefined && !said.includes('martha#136'), `${tool}: ${why} is refused as memory, not as a git place (${said})`)
  }
}

/** Every file tool, admitted. */
function assertAdmitted(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === 'NotebookEdit' ? { notebook_path: file_path } : write(file_path)
    assert.equal(writesTheOwnersMemory(tool, input, places, cwd, home, thisMachine), undefined, `${tool}: ${why}`)
  }
}

test('a write into the checkout\'s own git directory is refused, and an ordinary file in that checkout is admitted (#168)', (t) => {
  const place = placeFor(t)
  const checkout = place.worktree
  for (const dir of [join(checkout, '.git', 'hooks'), join(checkout, '.git', 'objects', 'info')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n')
  const places = placesFor(place)
  assertRefusedAsGit(places, checkout, place.home, join(checkout, '.git', 'hooks', 'pre-commit'), 'a hook the owner\'s next git run would start')
  assertRefusedAsGit(places, checkout, place.home, join(checkout, '.git', 'config'), 'the checkout\'s own git config')
  assertRefusedAsGit(places, checkout, place.home, join(checkout, '.git', 'objects', 'info', 'alternates'), 'the object store')
  assert.equal(writesTheOwnersMemory('Read', { file_path: join(checkout, '.git', 'config') }, places, checkout, place.home, thisMachine), undefined, 'a read of the git config is not a write')
  assertAdmitted(places, checkout, place.home, join(checkout, 'src', 'x.ts'), 'an ordinary file in the same checkout')
})

test('a .git segment anywhere is refused, at the end of the path and above it, and a .gitignore is not (#168)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const other = join(place.root, 'another-repo')
  mkdirSync(join(other, '.git', 'hooks'), { recursive: true })
  assertRefusedAsGit(places, place.worktree, place.home, join(place.worktree, 'src', '.git'), 'a .git file a member would add under src')
  assertRefusedAsGit(places, place.worktree, place.home, join(other, '.git', 'hooks', 'pre-commit'), 'another repository\'s git dir, outside this checkout')
  assertRefusedAsGit(places, place.worktree, place.home, join(place.worktree, '.git'), 'the .git entry itself, at the end of the path')
  assertAdmitted(places, place.worktree, place.home, join(place.worktree, 'src', '.gitignore'), 'a .gitignore is no .git')
  assertAdmitted(places, place.worktree, place.home, join(place.worktree, 'src', '.gitattributes'), 'a .gitattributes is no .git')
})

test('git\'s own .git synonyms are refused: any ASCII case, the points HFS+ ignores, and the NTFS short name (#168)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const named = (name: string) => join(place.worktree, 'src', name)
  // git 2.56.0 utf8.c next_hfs_char drops these code points, and folds with tolower(); path.c is_ntfs_dotgit takes `.git` in any case, and `git~1`.
  for (const spelling of ['.GIT', '.Git', '.gIt', '.git‌', '.g‌it', '.git﻿', '.git.', '.git ', 'git~1', 'GIT~1', 'git~1.', 'git~1 ']) {
    assertRefusedAsGit(places, place.worktree, place.home, named(spelling), `the spelling ${JSON.stringify(spelling)}`)
  }
  for (const spelling of ['git~2', 'git~4', 'git', '.gitignore', '.gitattributes', 'x.git', '.github']) {
    assertAdmitted(places, place.worktree, place.home, named(spelling), `the name ${JSON.stringify(spelling)} is no .git`)
  }
})

test('a backslash is a separator to git\'s NTFS check too, so src/a\\.git and src/a\\git~1 are refused (#168)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const named = (name: string) => join(place.worktree, 'src', name)
  // read-cache.c:1051-1054 (git 2.56.0): inside a path, a `\` makes git run
  // is_ntfs_dotgit again on what follows it, so the name it finds on this disk is not the one it judges.
  assertRefusedAsGit(places, place.worktree, place.home, named('a\\.git'), 'a .git after a backslash')
  assertRefusedAsGit(places, place.worktree, place.home, named('a\\git~1'), 'a git~1 after a backslash')
  assertRefusedAsGit(places, place.worktree, place.home, named('a\\.git\\hooks'), 'a .git between two backslashes')
  assertAdmitted(places, place.worktree, place.home, named('a\\b.ts'), 'an ordinary name holding a backslash')
  assertAdmitted(places, place.worktree, place.home, named('a\\.gitignore'), 'a .gitignore after a backslash is no .git')
})

test('a .git file naming a git directory outside the checkout is refused there, and where a linked worktree shares one (#168)', (t) => {
  const place = placeFor(t)
  const elsewhere = join(place.root, 'on-another-disk')
  const gitDir = join(elsewhere, 'a-git-dir')
  mkdirSync(join(gitDir, 'hooks'), { recursive: true })
  writeFileSync(join(place.worktree, '.git'), `gitdir: ${gitDir}\n`)
  const places = placesFor(place)
  assertRefusedAsGit(places, place.worktree, place.home, join(gitDir, 'hooks', 'pre-commit'), 'the git dir a .git file names, under no .git segment')
  assertRefusedAsGit(places, place.worktree, place.home, join(gitDir, 'config'), 'its config')
  assertAdmitted(places, place.worktree, place.home, join(place.worktree, 'src', 'x.ts'), 'an ordinary file in the checkout that named it')

  const shared = join(elsewhere, 'a-shared-git-dir')
  const linked = join(place.root, 'worktrees', 'a-linked-worktree')
  const worktreeGitDir = join(shared, 'worktrees', 'a-linked-worktree')
  mkdirSync(worktreeGitDir, { recursive: true })
  mkdirSync(join(shared, 'hooks'), { recursive: true })
  writeFileSync(join(worktreeGitDir, 'commondir'), '../..\n')
  writeFileSync(join(worktreeGitDir, 'index'), '')
  mkdirSync(linked, { recursive: true })
  writeFileSync(join(linked, '.git'), `gitdir: ${worktreeGitDir}\n`)
  assertRefusedAsGit(places, linked, place.home, join(worktreeGitDir, 'index'), 'the index in the worktree\'s own git dir')
  assertRefusedAsGit(places, linked, place.home, join(shared, 'hooks', 'pre-commit'), 'a hook in the git dir it shares, found through commondir')
  assertAdmitted(places, linked, place.home, join(linked, 'src', 'x.ts'), 'an ordinary file in the linked worktree')
})

test('the git configuration files of the owner\'s own runs are refused, and the variables that move them too (#168)', (t) => {
  const place = placeFor(t)
  const moved = join(place.root, 'moved', 'gitconfig')
  const system = join(place.root, 'system-gitconfig')
  const xdg = join(place.root, 'an-xdg-config-home')
  const places = placesFor(place, { GIT_CONFIG_GLOBAL: moved, GIT_CONFIG_SYSTEM: system, XDG_CONFIG_HOME: xdg })
  assertRefusedAsGit(places, place.worktree, place.home, moved, 'GIT_CONFIG_GLOBAL')
  assertRefusedAsGit(places, place.worktree, place.home, system, 'GIT_CONFIG_SYSTEM')
  assertRefusedAsGit(places, place.worktree, place.home, join(xdg, 'git', 'config'), 'the XDG file the launcher\'s environment moves')
  assertRefusedAsGit(places, place.worktree, place.home, join(place.home, '.gitconfig'), 'the owner\'s ~/.gitconfig')
  assertRefusedAsGit(places, place.worktree, place.home, join(place.home, '.config', 'git', 'config'), 'the XDG file\'s own default under ~/.config')
  assertAdmitted(places, place.worktree, place.home, join(place.root, 'a-project', 'gitconfig'), 'a gitconfig no git run reads')
  assert.equal(writesTheOwnersMemory('Read', { file_path: moved }, places, place.worktree, place.home, thisMachine), undefined, 'a read of the user-level git config is not a write')

  // A path a variable named is admitted once nothing names it.
  const plain = placesFor(place)
  assertAdmitted(plain, place.worktree, place.home, moved, 'no variable names it')
  assertAdmitted(plain, place.worktree, place.home, join(xdg, 'git', 'config'), 'no XDG_CONFIG_HOME is set')
})

test('GIT_DIR and GIT_COMMON_DIR the launcher\'s environment names are refused whole (#168)', (t) => {
  const place = placeFor(t)
  const gitDir = join(place.root, 'a-git-dir-the-launcher-names')
  const shared = join(place.root, 'a-shared-git-dir')
  mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
  mkdirSync(join(shared, 'hooks'), { recursive: true })
  const places = placesFor(place, { GIT_DIR: gitDir, GIT_COMMON_DIR: shared })
  assertRefusedAsGit(places, place.worktree, place.home, join(gitDir, 'refs', 'heads', 'main'), 'GIT_DIR')
  assertRefusedAsGit(places, place.worktree, place.home, join(shared, 'hooks', 'pre-commit'), 'GIT_COMMON_DIR')
  assertAdmitted(places, place.worktree, place.home, join(place.worktree, 'src', 'x.ts'), 'an ordinary file')
})

test('a git directory behind a chain of links that cannot be followed is refused, never allowed (#168)', (t) => {
  const place = placeFor(t)
  // A link that turns on itself, where the launcher's environment says the git dir is.
  const loop = join(place.root, 'loop-git-dir')
  symlinkSync('loop-git-dir', loop)
  const places = placesFor(place, { GIT_DIR: loop })
  const why = writesTheOwnersMemory('Write', write(join(place.worktree, 'src', 'x.ts')), places, place.worktree, place.home, thisMachine)
  assert.ok(why?.includes('martha#168'), `a write while the git dir cannot be followed is refused (${why ?? 'admitted'})`)
})

test('a git directory that appears during the session is covered from the next call (#168)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const gitDir = join(place.root, 'a-git-dir-made-later')
  const config = join(gitDir, 'config')
  assertAdmitted(places, place.worktree, place.home, config, 'the checkout that says where its git dir is has not appeared yet')
  mkdirSync(gitDir, { recursive: true })
  writeFileSync(join(place.worktree, '.git'), `gitdir: ${gitDir}\n`)
  assertRefusedAsGit(places, place.worktree, place.home, config, 'the checkout that appeared between calls')
})

