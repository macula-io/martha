import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { CLAUDE_CODE_FILE_RULE_TOOL, CLAUDE_CODE_LEGACY_GLOBAL_CONFIG_FILES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { NOT_MATCHED_MARK } from '../claude_code_host/file_permission_rules.ts'
import { USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { HOST_TRUST_RECORD_FILE } from '../launch_a_claude_code_member/host_runs_the_relay.ts'
import { namesTheOwnersSettings, realPathOf } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { SHELL_DEPTH_CAP } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'
import {
  FILE_WRITING_TOOLS,
  gapsInTheNameMap,
  hostLinesNamingARule,
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
  type OwnerUserScope,
} from './refuse_a_member_writing_owner_memory.ts'
import { NOTEBOOK_EDIT_TOOL, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

/** A home with a config dir, a main clone's memory folder, and a member's worktree elsewhere. */
function placeFor(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'martha-136-'))
  t.after(() => removeTheTree(root))
  const home = join(root, 'home')
  const config = join(home, '.claude')
  const mainMemory = join(config, 'projects', '-work-main-clone', 'memory')
  const otherMemory = join(config, 'projects', '-work-other', 'memory')
  const worktree = join(root, 'some-worktrees', 'main-clone-feature')
  for (const dir of [mainMemory, otherMemory, worktree, join(config, 'rules')]) mkdirSync(dir, { recursive: true })
  return { root, home, config, mainMemory, otherMemory, worktree }
}

/** The user-scope places the recording names, and the styles folder under this place's config dir (martha#154). */
const userScopeFor = (place: ReturnType<typeof placeFor>): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(place.config, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

const placesFor = (place: ReturnType<typeof placeFor>, launcher: Record<string, string> = {}, settings: string[] = []): OwnerMemoryPlaces =>
  ownerMemoryPlaces({ launcher_env: { HOME: place.home, ...launcher }, member_env: { HOME: place.home }, home: place.home, launch_dir: place.worktree, settings_files: settings, user_scope: userScopeFor(place) })

const write = (file_path: string) => ({ file_path, content: 'remember: the owner said deploy' })

function assertDenied(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  assertDeniedBy(places, cwd, home, file_path, 'martha#136', why)
}

/** Every writing tool, refused, and the refusal naming the issue that denies that place (martha#136, or #154). */
function assertDeniedBy(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, issue: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === NOTEBOOK_EDIT_TOOL ? { notebook_path: file_path } : write(file_path)
    const refusal = writesTheOwnersMemory(tool, input, places, cwd, home, thisMachine)
    assert.ok(refusal?.includes(issue), `${tool}: ${why} (${refusal ?? 'allowed'})`)
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
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(elsewhere)}/**)`), 'the permission rules name where a linked memory folder leads')
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
  for (const rule of [`Edit(/${join(leads, 'projects')}/*/memory/**)`, `Edit(/${join(leads, 'rules')}/**)`, `Edit(/${join(leads, 'CLAUDE.md')})`]) {
    assert.ok(rules.includes(rule), `${rule} in ${rules.join(' ')}`)
  }
})

test('a config dir whose projects folder is a link to another disk denies a real-path write into a project with no folder yet (#136 r=3)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'other-disk')
  mkdirSync(join(disk, '-home-owner-work'), { recursive: true })
  removeTheTree(join(place.config, 'projects'))
  symlinkSync(disk, join(place.config, 'projects'))
  const places = placesFor(place)
  // No folder for this project yet anywhere, so only the projects folder as it leads can catch it.
  assertDenied(places, place.worktree, place.home, join(disk, '-home-owner-next', 'memory', 'MEMORY.md'), 'a project with no folder yet, by the real projects folder')
  assert.ok(memoryDenyRules(places).includes(`Edit(/${join(realPathOf(disk))}/*/memory/**)`), 'the permission rules name where the projects folder leads')
})

test('a project\'s memory folder that is a link to a folder that does not exist yet is denied where it will lead (#136 r=3)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const notYet = join(place.root, 'not-yet-created', 'memory')
  const project = join(place.config, 'projects', '-dangling')
  mkdirSync(project)
  symlinkSync(notYet, join(project, 'memory'))
  assertDenied(places, place.worktree, place.home, join(notYet, 'MEMORY.md'), 'the folder the link will lead to')
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(notYet)}/**)`), 'the permission rules name where a link with no target yet will lead')
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
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(end)}/**)`), 'the permission rules name the end of the chain')
})

test('a projects folder that is a link to a disk folder that does not exist yet denies a write into it (#136 r=4)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'disk-not-yet')
  removeTheTree(join(place.config, 'projects'))
  symlinkSync(disk, join(place.config, 'projects'))
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, join(disk, '-new', 'memory', 'MEMORY.md'), 'a project under the disk the projects folder will be')
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(disk)}/*/memory/**)`), 'the permission rules name the disk it will lead to')
})

test('a project folder that is a link to a folder that does not exist yet denies a write into its memory (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const elsewhere = join(place.root, 'project-not-yet')
  symlinkSync(elsewhere, join(place.config, 'projects', '-project-link'))
  assertDenied(places, place.worktree, place.home, join(elsewhere, 'memory', 'MEMORY.md'), 'the memory of the project folder the link will lead to')
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(join(elsewhere, 'memory'))}/**)`), 'the permission rules name where that memory folder will be')
})

test('a chain of links at the cap is followed and denied at its end (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const end = join(place.root, 'end-at-cap')
  const project = join(place.config, 'projects', '-at-cap')
  mkdirSync(project)
  symlinkSync(chainAt(join(place.root, 'hops-at-cap'), LINK_HOPS - 1, end), join(project, 'memory'))
  assertDenied(places, place.worktree, place.home, join(end, 'MEMORY.md'), 'the end of a chain at the cap')
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(end)}/**)`), 'the permission rules name the end of a chain at the cap')
})

test('a chain of links one past the cap is refused, and no write is allowed while it stands (#136 r=4)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const end = join(place.root, 'end-past-cap')
  const project = join(place.config, 'projects', '-past-cap')
  mkdirSync(project)
  symlinkSync(chainAt(join(place.root, 'hops-past-cap'), LINK_HOPS, end), join(project, 'memory'))
  for (const file_path of [join(end, 'MEMORY.md'), join(place.worktree, 'notes.md')]) {
    const why = writesTheOwnersMemory(WHOLE_FILE_TOOL, { file_path, content: 'x' }, places, place.worktree, place.home, thisMachine)
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
  const why = writesTheOwnersMemory(WHOLE_FILE_TOOL, { file_path: memory, content: 'x' }, places, place.worktree, place.home, thisMachine)
  assert.ok(why?.includes('cannot be followed to its end'), `a cycle is refused: ${why}`)
  assert.equal(writesTheOwnersMemory('Read', { file_path: memory }, places, place.worktree, place.home, thisMachine), undefined, 'a read is not a write')
})

test('a projects folder that is a chain of links past the cap is refused, not dropped (#136 r=5)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'disk-past-cap')
  removeTheTree(join(place.config, 'projects'))
  symlinkSync(chainAt(join(place.root, 'projects-past-cap'), LINK_HOPS, disk), join(place.config, 'projects'))
  const places = placesFor(place)
  for (const file_path of [join(disk, '-new', 'memory', 'MEMORY.md'), join(place.worktree, 'notes.md')]) {
    const why = writesTheOwnersMemory(WHOLE_FILE_TOOL, { file_path, content: 'x' }, places, place.worktree, place.home, thisMachine)
    assert.ok(why?.includes('cannot be followed to its end'), `${file_path} is refused: ${why}`)
  }
})

test('a project folder that is a chain of links past the cap is refused, not dropped (#136 r=5)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const pe = join(place.root, 'pe-past-cap')
  symlinkSync(chainAt(join(place.root, 'project-past-cap'), LINK_HOPS, pe), join(place.config, 'projects', '-chain'))
  const why = writesTheOwnersMemory(WHOLE_FILE_TOOL, { file_path: join(pe, 'memory', 'MEMORY.md'), content: 'x' }, places, place.worktree, place.home, thisMachine)
  assert.ok(why?.includes('cannot be followed to its end'), `refused: ${why}`)
})

test('a projects folder that is a chain of links at the cap is followed and denied where it ends (#136 r=5)', (t) => {
  const place = placeFor(t)
  const disk = join(place.root, 'disk-at-cap')
  removeTheTree(join(place.config, 'projects'))
  symlinkSync(chainAt(join(place.root, 'projects-at-cap'), LINK_HOPS - 1, disk), join(place.config, 'projects'))
  const places = placesFor(place)
  assertDenied(places, place.worktree, place.home, join(disk, '-new', 'memory', 'MEMORY.md'), 'a project under a chain at the cap')
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(disk)}/*/memory/**)`), 'the permission rules name where the chain ends')
})

test('a project folder that is a chain of links at the cap is followed and denied where it ends (#136 r=5)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const pe = join(place.root, 'pe-at-cap')
  symlinkSync(chainAt(join(place.root, 'project-at-cap'), LINK_HOPS - 1, pe), join(place.config, 'projects', '-chain-at-cap'))
  assertDenied(places, place.worktree, place.home, join(pe, 'memory', 'MEMORY.md'), 'the memory of the project folder the chain leads to')
  assert.ok(memoryDenyRules(places).includes(`Edit(/${realPathOf(join(pe, 'memory'))}/**)`), 'the permission rules name it')
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
    user_scope: userScopeFor(place),
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

test('a member may not write a skill, an agent or a command under either config dir (martha#154)', (t) => {
  const place = placeFor(t)
  const scratchConfig = join(place.root, 'scratch-config')
  // The launcher's own CLAUDE_CONFIG_DIR is one scratch folder and the member's host resolves the home one: both are
  // config dirs whose user scope the host loads, so both are denied.
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
    user_scope: userScopeFor(place),
  })
  for (const kind of RECORDED_HOST.markdown_kinds) {
    for (const config of [place.config, scratchConfig]) {
      assertDeniedBy(both, place.worktree, place.home, join(config, kind, 'deploy.md'), 'martha#154', `${kind} under ${config}`)
    }
  }
  // A skill is a folder with a SKILL.md inside it: the folder is denied whole, not only the file the loader reads.
  assertDeniedBy(both, place.worktree, place.home, join(place.config, 'skills', 'deploy', 'SKILL.md'), 'martha#154', 'a skill\'s SKILL.md')
})

test('a member may not write an output style in the launcher\'s config dir, the member\'s, or the folder its init reported (martha#154)', (t) => {
  const place = placeFor(t)
  const scratchConfig = join(place.root, 'scratch-config')
  const reportedElsewhere = join(place.root, 'member-reported-styles')
  const scope: OwnerUserScope = { ...userScopeFor(place), reported_output_styles_dir: reportedElsewhere }
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
    user_scope: scope,
  })
  // The owner's dir keeps an output-styles folder even when the member's host reports another folder: a later launch
  // may report the owner's again, and the folder is still one the host loads.
  for (const config of [scratchConfig, place.config]) {
    assertDeniedBy(both, place.worktree, place.home, join(config, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, 'terse.md'), 'martha#154', `an output style under ${config}`)
  }
  assertDeniedBy(both, place.worktree, place.home, join(reportedElsewhere, 'terse.md'), 'martha#154', 'the folder the member\'s init reported')
})

test('a member may not write into any project\'s folder: its transcript, a file beside it, or a subagent\'s (#154)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const project = join(place.config, 'projects', '-work-main-clone')
  assertDeniedBy(places, place.worktree, place.home, join(project, 'session.jsonl'), 'martha#154', 'a session transcript')
  assertDeniedBy(places, place.worktree, place.home, join(project, 'notes.md'), 'martha#154', 'a plain file directly under a project folder')
  assertDeniedBy(places, place.worktree, place.home, join(project, 'subagents', 'agent-1.jsonl'), 'martha#154', 'a subagent\'s transcript')
  // A project key with no folder yet is denied on its spelling, after the link-following #136 already does.
  assertDeniedBy(places, place.worktree, place.home, join(place.config, 'projects', '-key-with-no-folder', 'session.jsonl'), 'martha#154', 'a project key that does not exist yet')
})

test('a write in the checkout, and any read of a memory file, are allowed', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  for (const tool of FILE_WRITING_TOOLS) {
    // A file in the checkout is the member's own to write, and a directory named memory inside it is not a memory
    // folder: only the host's own places are (martha#136, #154).
    assert.equal(writesTheOwnersMemory(tool, write(join(place.worktree, 'memory', 'notes.md')), places, place.worktree, place.home, thisMachine), undefined, tool)
    assert.equal(writesTheOwnersMemory(tool, write(join(place.worktree, 'src', 'notes.md')), places, place.worktree, place.home, thisMachine), undefined, tool)
  }
  // A read is never refused: the gate is about what a member leaves behind, not what it takes in (martha#136).
  assert.equal(writesTheOwnersMemory('Read', { file_path: join(place.mainMemory, 'MEMORY.md') }, places, place.worktree, place.home, thisMachine), undefined)
  assert.equal(writesTheOwnersMemory('Read', { file_path: join(place.config, 'projects', '-work-main-clone', 'session.jsonl') }, places, place.worktree, place.home, thisMachine), undefined)
})

test('the permission rules name the same places the gate denies, one rule each under the tool the host\'s checks match (#226)', (t) => {
  const place = placeFor(t)
  const override = join(place.root, 'cowork-memory')
  const places = placesFor(place, { [MEMORY_FOLDER_OVERRIDE]: override })
  const rules = memoryDenyRules(places)
  assert.ok(rules.length > 0)
  // One rule a place, and every one of them under the tool the host's own file permission checks match. The host says a
  // rule naming any other file-editing tool is never matched; a rule written there closes nothing (#226).
  assert.deepEqual(
    rules.filter((rule) => !rule.startsWith(`${CLAUDE_CODE_FILE_RULE_TOOL}(/`)),
    [],
    'every rule is written under the tool the host\'s file permission checks match',
  )
  assert.ok(!rules.some((rule) => rule.startsWith('Write(')), `no inert Write rule: ${rules.join(' ')}`)
  assert.ok(rules.includes(`Edit(/${join(place.config, 'projects')}/*/memory/**)`), rules.join(' '))
  // Each project's own folder is denied whole, so a transcript or a file beside it is refused too (martha#154).
  assert.ok(rules.includes(`Edit(/${join(place.config, 'projects')}/*/**)`), rules.join(' '))
  assert.ok(rules.includes(`Edit(/${override}/**)`), rules.join(' '))
  assert.ok(rules.includes(`Edit(/${join(place.config, 'CLAUDE.md')})`), rules.join(' '))
  assert.ok(rules.every((rule) => /^Edit\(\/\//.test(rule)), 'every rule names an absolute path')
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
    assertDeniedBy(placesFor(place), place.worktree, place.home, join(place.config, folder, 'run.sh'), 'martha#187', `the host runs what is in ${folder}`)
  })
}

for (const file of CODE_FILES) {
  test(`a member may not write the owner's ${file}, which the host acts on as code (martha#187)`, (t) => {
    const place = placeFor(t)
    assertDeniedBy(placesFor(place), place.worktree, place.home, join(place.config, file), 'martha#187', `the host acts on ${file}`)
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
    user_scope: userScopeFor(place),
  })
  assertDeniedBy(both, place.worktree, place.home, join(scratchConfig, USER_SETTINGS_FILE), 'martha#187', 'the launcher\'s settings file')
  assertDeniedBy(places, place.worktree, place.home, join(place.config, USER_SETTINGS_FILE), 'martha#187', 'the member\'s settings file')
})

test('a link to the owner\'s settings file whose target does not exist yet is refused here, where the settings check cannot see it (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const settings = join(place.config, USER_SETTINGS_FILE)
  assert.equal(existsSync(settings), false, 'the settings file is absent, so the link has no target')
  symlinkSync(USER_SETTINGS_FILE, join(place.config, 'sneaky'))
  const file_path = join(place.config, 'sneaky')
  assert.equal(namesTheOwnersSettings({ file_path }, settings, place.worktree, place.home), undefined, 'the settings check compares the link itself, not where it leads')
  assertDeniedBy(placesFor(place), place.worktree, place.home, file_path, 'martha#187', 'the link this guard follows to its end')
})

test('a member may not write the owner\'s user MCP config, in the config dir or beside the home folder, in the launcher\'s environment and the member\'s (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  const scratchConfig = join(place.root, 'scratch-config')
  mkdirSync(scratchConfig, { recursive: true })
  // CLAUDE_CONFIG_DIR unset: the host's global config is beside the home folder, not in ~/.claude.
  assertDeniedBy(places, place.worktree, place.home, join(place.home, HOST_TRUST_RECORD_FILE), 'martha#187', 'beside the home folder')
  // CLAUDE_CONFIG_DIR set on either side: the file is in that dir, and both dirs are denied.
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
    user_scope: userScopeFor(place),
  })
  assertDeniedBy(both, place.worktree, place.home, join(scratchConfig, HOST_TRUST_RECORD_FILE), 'martha#187', 'in the launcher\'s config dir')
  assertDeniedBy(both, place.worktree, place.home, join(place.home, HOST_TRUST_RECORD_FILE), 'martha#187', 'the member\'s own global config')
})

test('a link at the owner\'s user MCP config whose target does not exist yet is denied where it will write (martha#187 r=2)', (t) => {
  const place = placeFor(t)
  const target = join(place.root, 'not-yet', HOST_TRUST_RECORD_FILE)
  symlinkSync(target, join(place.home, HOST_TRUST_RECORD_FILE))
  const places = placesFor(place)
  assertDeniedBy(places, place.worktree, place.home, join(place.home, HOST_TRUST_RECORD_FILE), 'martha#187', 'the link where the host reads the config')
  assertDeniedBy(places, place.worktree, place.home, target, 'martha#187', 'the file the link will write')
})

test('a member may not write the global config the host prefers at a config dir\'s root, in the launcher\'s config dir and in the member\'s (martha#187 r=3)', (t) => {
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
    user_scope: userScopeFor(place),
  })
  for (const name of CLAUDE_CODE_LEGACY_GLOBAL_CONFIG_FILES) {
    // CLAUDE_CONFIG_DIR unset on either side: the file is at that side's own config dir.
    assertDeniedBy(places, place.worktree, place.home, join(place.config, name), 'martha#187', 'the member\'s config dir')
    // Set on the launcher's side: both config dirs are denied.
    assertDeniedBy(both, place.worktree, place.home, join(scratchConfig, name), 'martha#187', 'the launcher\'s config dir')
    assertDeniedBy(both, place.worktree, place.home, join(place.config, name), 'martha#187', 'the member\'s config dir, beside the launcher\'s')
  }
})

// The member's own host resolves the config dir its own environment names, which need not be the launcher's
// (martha#203, the case #187 left unpinned): the preferred global config there is refused as well, and the
// launcher's own dir is not lost by the difference.
test('a member may not write the global config the host prefers at the config dir only the member\'s environment names (martha#203)', (t) => {
  const place = placeFor(t)
  const memberConfig = join(place.root, 'member-only-config')
  mkdirSync(memberConfig, { recursive: true })
  const memberOnly = ownerMemoryPlaces({
    launcher_env: { HOME: place.home },
    member_env: { HOME: place.home, CLAUDE_CONFIG_DIR: memberConfig },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
    user_scope: userScopeFor(place),
  })
  for (const name of CLAUDE_CODE_LEGACY_GLOBAL_CONFIG_FILES) {
    assertDeniedBy(memberOnly, place.worktree, place.home, join(memberConfig, name), 'martha#187', 'the config dir only the member\'s own environment names')
    assertDeniedBy(memberOnly, place.worktree, place.home, join(place.config, name), 'martha#187', 'the launcher\'s config dir, which its own environment names')
  }
})

test('a link at the global config the host prefers, whose target does not exist yet, is denied where it will write (martha#187 r=3)', (t) => {
  const place = placeFor(t)
  for (const name of CLAUDE_CODE_LEGACY_GLOBAL_CONFIG_FILES) {
    const target = join(place.root, 'not-yet', name)
    symlinkSync(target, join(place.config, name))
    const places = placesFor(place)
    assertDeniedBy(places, place.worktree, place.home, join(place.config, name), 'martha#187', 'the link where the host reads it')
    assertDeniedBy(places, place.worktree, place.home, target, 'martha#187', 'the file the link will write')
  }
})

test('the global config file this guard denies is the recording\'s own name, whatever the host calls it (martha#187 r=3)', () => {
  const renamed = 'a-renamed-global-config.json'
  const recorded = placesTheHostProtects({ ...RECORDED_HOST, legacy_global_config_names: [renamed] })
  assert.deepEqual(recorded.files.filter((file) => file === renamed), [renamed])
  assert.equal(recorded.files.some((file) => CLAUDE_CODE_LEGACY_GLOBAL_CONFIG_FILES.includes(file)), false, 'the name the recording no longer holds is not denied')
})

// The host builds its global config's name as `<stem><suffix><extension>`, and the suffixes it can build are its own
// business: proving what a minified bundle can produce needs a binder and a dataflow pass, and each round of that proof
// closed its holes while the next opened new ones (martha#202). So the guard denies the SHAPE, and the stem and the
// extension are the recorded name's own, cut here the same way the guard cuts them. The suffixes below are THIS TEST'S
// FIXTURES and not the host's list: nothing records that list any more, and the guard reads none of it — the four are the
// three the host held when this landed and one no host holds yet, which stands for the next one it adds.
const GLOBAL_CONFIG_AT = HOST_TRUST_RECORD_FILE.lastIndexOf('.')
const GLOBAL_CONFIG_STEM = HOST_TRUST_RECORD_FILE.slice(0, GLOBAL_CONFIG_AT)
const GLOBAL_CONFIG_EXTENSION = HOST_TRUST_RECORD_FILE.slice(GLOBAL_CONFIG_AT)
const GLOBAL_CONFIG_FAMILY: readonly string[] = ['', '-staging-oauth', '-local-oauth', '-custom-oauth', '-a-suffix-no-host-holds-yet'].map(
  (suffix) => `${GLOBAL_CONFIG_STEM}${suffix}${GLOBAL_CONFIG_EXTENSION}`,
)

test('a member may not write any name in the global config\'s family, beside the home folder and in every config dir (martha#202)', (t) => {
  const place = placeFor(t)
  const scratchConfig = join(place.root, 'scratch-config')
  const memberConfig = join(place.root, 'member-config')
  for (const dir of [scratchConfig, memberConfig]) mkdirSync(dir, { recursive: true })
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home, CLAUDE_CONFIG_DIR: memberConfig },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
    user_scope: userScopeFor(place),
  })
  const launcherOnly = ownerMemoryPlaces({
    launcher_env: { HOME: place.home, CLAUDE_CONFIG_DIR: scratchConfig },
    member_env: { HOME: place.home },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
    user_scope: userScopeFor(place),
  })
  for (const name of GLOBAL_CONFIG_FAMILY) {
    // The name itself keeps the rule and the issue that landed it (#187); the shape is what denies every other member of
    // the family, and the pattern the launch writes covers the bare name too (asserted with the rules, below).
    const issue = name === HOST_TRUST_RECORD_FILE ? 'martha#187' : 'martha#202'
    // CLAUDE_CONFIG_DIR unset: the host's global config is beside the home folder, not in ~/.claude.
    assertDeniedBy(placesFor(place), place.worktree, place.home, join(place.home, name), issue, `beside the home folder: ${name}`)
    // Set on both sides: each dir the environments name denies the whole family.
    assertDeniedBy(both, place.worktree, place.home, join(scratchConfig, name), issue, `the launcher's config dir: ${name}`)
    assertDeniedBy(both, place.worktree, place.home, join(memberConfig, name), issue, `the member's config dir: ${name}`)
    // Set on the launcher's side only: the member's own host keeps its config beside the home folder, as #187 has it.
    assertDeniedBy(launcherOnly, place.worktree, place.home, join(place.home, name), issue, `the member's own config beside the home folder: ${name}`)
  }
  // The host matches a name without regard to case (measured on 2.1.322), and on a case-insensitive file system the
  // upper-case spelling IS the config file. The gate refuses it too, so the member is told why and not left to the
  // host's own answer alone (martha#202).
  const upperCased = (GLOBAL_CONFIG_FAMILY[1] ?? '').replace(GLOBAL_CONFIG_STEM, GLOBAL_CONFIG_STEM.toUpperCase())
  assertDeniedBy(placesFor(place), place.worktree, place.home, join(place.home, upperCased), 'martha#202', `the upper-case stem: ${upperCased}`)
  // The folder is compared as the name is: on a case-insensitive disk these two spellings are one folder, and the host
  // resolves either to the same file (Uranus, martha#202 r=1, r=3). The row proves case only if the two paths really
  // differ, and proves THIS folder only if nothing above it changed, so both are asserted rather than assumed of the
  // place's layout — a spelling that came out the same would otherwise be refused by the row that came before it.
  const upperHome = join(place.root, 'HOME')
  assert.notEqual(upperHome, place.home, 'the row names a folder spelled another way, not the home folder itself')
  assert.equal(dirname(upperHome), dirname(place.home), 'only the folder\'s own name is spelled differently, not where it sits')
  assert.equal(basename(upperHome).toLowerCase(), basename(place.home).toLowerCase(), 'the two spellings differ in case alone')
  assertDeniedBy(placesFor(place), place.worktree, place.home, join(upperHome, GLOBAL_CONFIG_FAMILY[1] ?? ''), 'martha#202', `a folder spelled with different case: ${upperHome}`)
})

test('a name that only looks like the global config\'s family is admitted (martha#202)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  // A name whose `*` would have to cross a `/`, another stem, and a name past the extension: `*` is one name's worth
  // of characters and the extension anchors the end (both measured on 2.1.322).
  const admitted = [join(place.home, '.claudex', 'src', 'a.json'), join(place.home, `.not${HOST_TRUST_RECORD_FILE}`), join(place.home, `${HOST_TRUST_RECORD_FILE}.bak`)]
  for (const file_path of admitted) {
    assert.equal(writesTheOwnersMemory(WHOLE_FILE_TOOL, write(file_path), places, place.worktree, place.home, thisMachine), undefined, `${file_path} is a name of its own, not the global config`)
  }
})

test('a write into the family through a folder that links to the home is refused on the resolved name (martha#202)', (t) => {
  const place = placeFor(t)
  const elsewhere = join(place.root, 'elsewhere')
  mkdirSync(elsewhere, { recursive: true })
  symlinkSync(place.home, join(elsewhere, 'hl'))
  const places = placesFor(place)
  // The gate runs through that link: a name of its own, written the same way, is allowed.
  assert.equal(writesTheOwnersMemory(WHOLE_FILE_TOOL, write(join(elsewhere, 'hl', `.not${HOST_TRUST_RECORD_FILE}`)), places, place.worktree, place.home, thisMachine), undefined, 'a name of its own through the same folder link')
  assertDeniedBy(places, place.worktree, place.home, join(elsewhere, 'hl', GLOBAL_CONFIG_FAMILY[1] ?? ''), 'martha#202', 'through a folder link, on the name it resolves to')
})

test('a link in the checkout pointing at a name in the family is refused at the gate, on the file it leads to (martha#202)', (t) => {
  const place = placeFor(t)
  const places = placesFor(place)
  // The host refuses to write through a link at all, so it never sends one: this is the gate's own case, for the target
  // path the host tells a member to write instead (measured on 2.1.322). The link's target need not exist yet.
  symlinkSync(join(place.home, `.not${HOST_TRUST_RECORD_FILE}`), join(place.worktree, 'fine.json'))
  symlinkSync(join(place.home, GLOBAL_CONFIG_FAMILY[1] ?? ''), join(place.worktree, 'innocent.json'))
  // The gate runs through a checkout link: a link to a name of its own is allowed.
  assert.equal(writesTheOwnersMemory(WHOLE_FILE_TOOL, write(join(place.worktree, 'fine.json')), places, place.worktree, place.home, thisMachine), undefined, 'a link to a name of its own')
  assertDeniedBy(places, place.worktree, place.home, join(place.worktree, 'innocent.json'), 'martha#202', 'a link to a file in the family, on the file it leads to')
  assertDeniedBy(places, place.worktree, place.home, join(place.home, GLOBAL_CONFIG_FAMILY[1] ?? ''), 'martha#202', 'the target the link names')
})

test('the permission rules deny the whole family by pattern, one rule for each directory the host keeps the config in (martha#202)', (t) => {
  const place = placeFor(t)
  const memberConfig = join(place.root, 'member-config')
  mkdirSync(memberConfig, { recursive: true })
  const both = ownerMemoryPlaces({
    launcher_env: { HOME: place.home },
    member_env: { HOME: place.home, CLAUDE_CONFIG_DIR: memberConfig },
    home: place.home,
    launch_dir: place.worktree,
    settings_files: [],
    user_scope: userScopeFor(place),
  })
  const rules = memoryDenyRules(both)
  const patternFor = (dir: string): string => `${CLAUDE_CODE_FILE_RULE_TOOL}(/${join(dir, `${GLOBAL_CONFIG_STEM}*${GLOBAL_CONFIG_EXTENSION}`)})`
  for (const dir of [place.home, memberConfig]) assert.ok(rules.includes(patternFor(dir)), `${patternFor(dir)} in ${rules.join(' ')}`)
  // The name itself keeps its own rule beside the pattern, as #187 landed it.
  assert.ok(rules.includes(`${CLAUDE_CODE_FILE_RULE_TOOL}(/${join(place.home, HOST_TRUST_RECORD_FILE)})`), 'the exact name keeps its rule beside the pattern')
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
  assert.equal(writesTheOwnersMemory(WHOLE_FILE_TOOL, write(join(place.worktree, 'notes.md')), places, place.worktree, place.home, thisMachine), undefined, 'a write outside every place')
  for (const name of deniedBy) {
    const file_path = join(place.config, A_WRITE_INTO[name] ?? '')
    assert.notEqual(writesTheOwnersMemory(WHOLE_FILE_TOOL, write(file_path), places, place.worktree, place.home, thisMachine), undefined, `${name}: ${file_path} is refused`)
  }
})

test('the permission rules carry every place the host runs as code into permissions.deny, one rule each (#187, #226)', (t) => {
  const place = placeFor(t)
  const rules = memoryDenyRules(placesFor(place))
  for (const folder of CODE_FOLDERS) {
    assert.ok(rules.includes(`Edit(/${join(place.config, folder)}/**)`), folder)
  }
  for (const file of [...CODE_FILES, USER_SETTINGS_FILE, ...CLAUDE_CODE_LEGACY_GLOBAL_CONFIG_FILES]) {
    assert.ok(rules.includes(`Edit(/${join(place.config, file)})`), file)
  }
  const config = join(place.home, HOST_TRUST_RECORD_FILE)
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

test('the places this guard denies are exactly the recorded names it owns, split into folders and files, and the global config it prefers (martha#187)', () => {
  const owned = namesInTheRecording(RECORDED_HOST).filter((name) => {
    const owner = PROTECTED_NAME_OWNERS[name]
    return owner !== undefined && 'denied_here' in owner
  })
  // The global config the host prefers is no name in its protected array: it is cut from its own chooser (r=3).
  const places = placesTheHostProtects()
  assert.deepEqual([...places.folders, ...places.files].sort(), [...owned, ...RECORDED_HOST.legacy_global_config_names].sort())
})

// --- what a later git run of the owner's reads (martha#168) -----------------------

/** Every file tool, refused as a git place, naming martha#168 and no other reason. */
function assertRefusedAsGit(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === NOTEBOOK_EDIT_TOOL ? { notebook_path: file_path } : write(file_path)
    const said = writesTheOwnersMemory(tool, input, places, cwd, home, thisMachine)
    assert.ok(said?.includes('martha#168'), `${tool}: ${why} (${said ?? 'admitted'})`)
    assert.ok(said !== undefined && !said.includes('martha#136'), `${tool}: ${why} is refused as memory, not as a git place (${said})`)
  }
}

/** Every file tool, admitted. */
function assertAdmitted(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === NOTEBOOK_EDIT_TOOL ? { notebook_path: file_path } : write(file_path)
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
  const linked = join(place.root, 'some-worktrees', 'a-linked-worktree')
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
  const why = writesTheOwnersMemory(WHOLE_FILE_TOOL, write(join(place.worktree, 'src', 'x.ts')), places, place.worktree, place.home, thisMachine)
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


// The rules are a second layer only on a host that matches them. The host says in its own words which of them its file
// permission checks never match, and a launch reads that before it starts a member (martha#226). What it says is
// matched against the rules this repository wrote, and nothing else: the wording is the host's, and a line quoting one
// of our rules is about that rule whatever it goes on to say.
test('the host\'s own words are read for a rule this launch wrote, and a line about someone else\'s rule is not one (#226)', () => {
  const written = ['Edit(//home/synthetic/.claude/projects/*/**)', 'Edit(//home/synthetic/.claude.json)']
  const aboutOurRule = 'Permission deny rule (martha.json): Edit(//home/synthetic/.claude.json) is not matched by file permission checks'
  assert.deepEqual(hostLinesNamingARule(`starting\n${aboutOurRule}\n`, written), [aboutOurRule])
  // A rule the owner's own settings carry is the owner's business, and not a reason to refuse their member.
  assert.deepEqual(hostLinesNamingARule('Permission deny rule (user.json): Edit(//home/synthetic/notes/**) is not matched by file permission checks', written), [])
  assert.deepEqual(hostLinesNamingARule('', written), [])
  // Every line that names one, not the first: a host complaining about two rules is two faults to read.
  const second = 'Permission deny rule (martha.json): Edit(//home/synthetic/.claude/projects/*/**) is not matched by file permission checks'
  assert.deepEqual(hostLinesNamingARule(`${aboutOurRule}\n${second}\n`, written), [aboutOurRule, second])
})

// A line is read for the rule it is ABOUT, never for one it merely quotes (martha#226 r=1). The host's complaint about
// a dead rule ends with the rule to write instead, so an owner who still protects a place the old way — a `Write(…)`
// twin of a place this launch denies — has the host quote one of our own rules back at it. That is the owner's rule,
// and refusing their member for it would leave an owner who protects their own CLAUDE.md unable to start one at all.
test('a line is read for the rule it is about, and one the host prints twice is one rule (#226 r=1)', () => {
  const written = ['Edit(//home/synthetic/.claude/projects/*/**)', 'Edit(//home/synthetic/.claude.json)']
  const theOwnersDeadRule = 'Permission deny rule (.claude/settings.json): Write(//home/synthetic/.claude.json) is not matched by file permission checks — only Edit(path) rules are. Use Edit(//home/synthetic/.claude.json) instead (Edit rules cover all file-editing tools).'
  assert.deepEqual(hostLinesNamingARule(theOwnersDeadRule, written), [])
  // The owner's twin of one of our rules, printed among our own line: ours is counted, theirs is not.
  const ours = 'Permission deny rule (martha.json): Edit(//home/synthetic/.claude.json) is not matched by file permission checks'
  assert.deepEqual(hostLinesNamingARule(`${theOwnersDeadRule}\n${ours}\n`, written), [ours])
  // The host prints a complaint once per stream and once more in a second shape: one dead rule is one fault to read.
  assert.deepEqual(hostLinesNamingARule(`${ours}\n${ours}\n`, written), [ours])
})

// The words the reading is anchored on are the recording's own, never a second copy of them (martha#226 r=2): a line
// built from NOT_MATCHED_MARK is read, and the same line with those words changed is not. A host that rewords the
// complaint therefore fails the recording — where the mark is cut from its text — rather than being read wrongly here.
test('a line is read by the wording the recording holds, not by a copy of it (#226 r=2)', () => {
  const written = ['Edit(//home/synthetic/.claude.json)']
  const about = `Permission deny rule (martha.json): ${written[0]} ${NOT_MATCHED_MARK} — only Edit(path) rules are. Use Edit(//home/synthetic/.claude.json) instead (Edit rules cover all file-editing tools).`
  assert.deepEqual(hostLinesNamingARule(about, written), [about])
  assert.deepEqual(hostLinesNamingARule(about.replace(NOT_MATCHED_MARK, 'is not matched by the file permission checks'), written), [])
})

// --- the paths a git configuration names, and the git directory a write completes (martha#192) ---
//
// A later git run of the owner's reads a configuration value and starts, or reads,
// what it names. The keys are not what the guard knows — git adds keys — so every
// value is asked the same question: does one of its words, or the value whole, land
// inside the checkout? Each test below stands a checkout with a config, and asks the
// guard about one write; the issue named in the refusal is the one that denies it.

/** Every file tool refused as a path a later git run reads, naming martha#192. */
function assertRefusedAs192(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === NOTEBOOK_EDIT_TOOL ? { notebook_path: file_path } : write(file_path)
    const said = writesTheOwnersMemory(tool, input, places, cwd, home, thisMachine)
    assert.ok(said?.includes('martha#192'), `${tool}: ${why} (${said ?? 'admitted'})`)
  }
}

/** A checkout at the place's worktree, with a git directory holding `config` and any other file given. */
function checkoutWith(place: ReturnType<typeof placeFor>, files: Readonly<Record<string, string>>): string {
  mkdirSync(join(place.worktree, '.git'), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const at = join(place.worktree, '.git', name)
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, text)
  }
  return place.worktree
}

test('a hooks folder the config names is refused, spelled relative, absolute, with a space, or bare (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n\thooksPath = .husky\n' })
  const places = placesFor(place)
  assertRefusedAs192(places, checkout, place.home, join(checkout, '.husky', 'pre-commit'), 'a relative hooks folder')
  assertAdmitted(places, checkout, place.home, join(checkout, 'src', 'a.ts'), 'an ordinary file in the same checkout')

  writeFileSync(join(checkout, '.git', 'config'), `[core]\n\thooksPath = ${join(checkout, '.husky')}\n`)
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.husky', 'pre-commit'), 'an absolute hooks folder')

  // A path value is taken whole: the words of `my hooks` name nothing, and git runs
  // the hook in the folder `<top>/my hooks`, which is the path this pins.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = "my hooks"\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'my hooks', 'pre-commit'), 'a hooks folder with a space in it')

  // And without a slash at all: `hk` is a path relative to the top, as measured.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = hk\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'hk', 'pre-commit'), 'a bare hooks folder')

  // A bare word inside a value that starts outside the tree: the value whole is
  // `/usr/bin/hookrun hk`, which resolves outside it, and only the word `hk` names a
  // path in it. A rule that judged only the words holding a slash would admit this.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = /usr/bin/hookrun hk\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'hk', 'pre-commit'), 'a bare word inside a value that starts outside the tree')

  // The same folder named through a link, which is how a checkout on macOS is
  // reached at all (/var -> /private/var, martha#79): the value resolves through the
  // link and the write resolves through it, and both answers are the tree.
  const throughALink = join(place.root, 'link-to-checkout')
  symlinkSync(checkout, throughALink)
  writeFileSync(join(checkout, '.git', 'config'), `[core]\n\thooksPath = ${join(throughALink, '.husky')}\n`)
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.husky', 'pre-commit'), 'an absolute hooks folder reached through a link')
})

test('a value naming a program is refused whoever holds the key: an alias, a hook command, a filter (#192)', (t) => {
  const place = placeFor(t)
  const cases: readonly (readonly [string, string, string])[] = [
    ['[alias]\n\tfmt = !tools/x.sh\n', join('tools', 'x.sh'), 'an alias git hands to a shell'],
    ['[hook "lint"]\n\tevent = pre-commit\n\tcommand = tools/h.sh\n', join('tools', 'h.sh'), 'a config hook\'s command'],
    ['[filter "fmt"]\n\tclean = tools/f.sh\n', join('tools', 'f.sh'), 'a filter\'s clean command'],
  ]
  for (const [config, written, why] of cases) {
    const checkout = checkoutWith(place, { config })
    const places = placesFor(place)
    assertRefusedAs192(places, checkout, place.home, join(checkout, written), why)
    assertAdmitted(places, checkout, place.home, join(checkout, 'src', 'a.ts'), `${why}: an ordinary file`)
  }
})

test('an attributes file the config names is refused, and so is a file it names through an include (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n\tattributesFile = attrs\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'attrs'), 'the attributes file `attrs`')

  // An include: the target is a tree file, and the resolution base is the directory
  // of the file that holds it, which is git's own (`../tree.cfg` from `.git/`).
  writeFileSync(join(checkout, '.git', 'config'), '[include]\n\tpath = ../tree.cfg\n')
  writeFileSync(join(checkout, 'tree.cfg'), '[include]\n\tpath = two.cfg\n')
  const places = placesFor(place)
  assertRefusedAs192(places, checkout, place.home, join(checkout, 'tree.cfg'), 'the file an include names')
  assertRefusedAs192(places, checkout, place.home, join(checkout, 'two.cfg'), 'a bare include path inside a tree file')

  writeFileSync(join(checkout, 'tree.cfg'), '[include]\n\tpath = sub/inner.cfg\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'sub', 'inner.cfg'), 'a second file in the chain')

  writeFileSync(join(checkout, '.git', 'config'), '[includeIf "gitdir:/a/directory/elsewhere/"]\n\tpath = ../other.cfg\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'other.cfg'), 'an include whose condition is false for the member')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'an ordinary file beside all of it')
})

test('the owner\'s own global config is read too, and the second file a git directory reads (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n' })
  // A value written once, relative, so it holds for every repository: the owner's.
  writeFileSync(join(place.home, '.gitconfig'), '[core]\n\thooksPath = .githooks\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.githooks', 'pre-commit'), 'a hooks folder the owner\'s global config names')

  // `config.worktree`, which git reads when `extensions.worktreeConfig` is on.
  writeFileSync(join(place.home, '.gitconfig'), '')
  writeFileSync(join(checkout, '.git', 'config'), '[extensions]\n\tworktreeConfig = true\n')
  writeFileSync(join(checkout, '.git', 'config.worktree'), '[core]\n\thooksPath = .wt-hooks\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.wt-hooks', 'pre-commit'), 'a hooks folder named in config.worktree')

  // git's other spellings of a boolean, which it reads as one too (r=2, R2).
  writeFileSync(join(checkout, '.git', 'config'), '[extensions]\n\tworktreeConfig = yes\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.wt-hooks', 'pre-commit'), 'the extension spelled yes')

  // And with the extension off, git does not read that file, so its value names nothing.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, '.wt-hooks', 'pre-commit'), 'a config.worktree git does not read')

  // The common case, and not an edge one: a member works in a linked worktree,
  // whose own git directory holds `config.worktree`, while the extension is set in
  // the shared config git keeps beside the main checkout (r=2, R2). A guard that
  // looked for the extension beside the second file finds no config there and skips
  // the file git reads.
  const main = join(place.root, 'main-clone')
  const worktrees = join(main, '.git', 'worktrees', 'wt')
  const linked = join(place.root, 'linked-worktree')
  for (const dir of [worktrees, join(main, '.git', 'objects'), join(main, '.git', 'refs', 'heads'), linked]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(main, '.git', 'config'), '[extensions]\n\tworktreeConfig = true\n')
  writeFileSync(join(worktrees, 'commondir'), '../..\n')
  writeFileSync(join(worktrees, 'config.worktree'), '[core]\n\thooksPath = .wt\n')
  writeFileSync(join(linked, '.git'), `gitdir: ${worktrees}\n`)
  assertRefusedAs192(placesFor(place), linked, place.home, join(linked, '.wt', 'pre-commit'), 'a hooks folder a linked worktree\'s own config.worktree names')

  // The control: the extension off in the shared config, and the second file names
  // nothing, as git reads it.
  writeFileSync(join(main, '.git', 'config'), '[core]\n')
  assertAdmitted(placesFor(place), linked, place.home, join(linked, '.wt', 'pre-commit'), 'a linked worktree\'s config.worktree, with the extension off')
})

test('a config written as git writes it is read as git reads it: any case, and a continued line (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[Core]\n\tHooksPath = .hk\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.hk', 'pre-commit'), 'a section and key in another case')

  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = .h\\\nks\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.hks', 'pre-commit'), 'a value continued onto the next line')

  // A case matters where a key is looked up as well as where a value is judged:
  // whether the second file is read turns on `extensions.worktreeConfig`, and git
  // reads that name whatever case it is written in. A guard that kept the case would
  // not open the file, and the hooks folder it names would be a member's to write.
  writeFileSync(join(checkout, '.git', 'config'), '[Extensions]\n\tworktreeConfig = true\n')
  writeFileSync(join(checkout, '.git', 'config.worktree'), '[core]\n\thooksPath = .wt-hk\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.wt-hk', 'pre-commit'), 'a section in another case, deciding which file git reads')
})

test('a value keeps the spaces git keeps inside quotes, and a comment takes no next line with it (#192 r=2)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n\thooksPath = " hk"\n' })
  // git trims only the whitespace outside the quotes: `rev-parse --git-path hooks`
  // answers ` hk`, and `<top>/ hk/pre-commit` runs. A guard that trims the value
  // after the quotes are resolved reads `hk` and admits it.
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, ' hk', 'pre-commit'), 'a hooks folder whose path starts with a space git keeps')

  // A backslash inside a comment continues nothing, so the key on the next line is
  // git's and its value names a folder.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\t# a note \\\n\thooksPath = hk\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'hk', 'pre-commit'), 'the key after a comment ending in a backslash')

  // The control both of these could pass on nothing: git's trim still drops the
  // spaces outside the quotes, and a comment on a value's own line ends it.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = .hk   ; trailing\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.hk', 'pre-commit'), 'a value with a trailing comment')

  // And the whitespace just before a continuation is git's too: `hooksPath = hk \` is
  // the folder `hk ` (measured at a continuation, and at the end of a file), so a
  // write that names that folder is refused.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = hk \\\n\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'hk ', 'pre-commit'), 'a space that stands before a continuation')
})

test('a value a shell runs is split as a shell splits it (#192 r=2)', (t) => {
  const place = placeFor(t)
  const cases: readonly (readonly [string, string, string])[] = [
    ['[alias]\n\tfmt = !sh -c \'tools/x.sh\'\n', join('tools', 'x.sh'), 'a path in single quotes inside sh -c'],
    ['[alias]\n\tfmt = "!tools/y.sh&&true"\n', join('tools', 'y.sh'), 'a path glued to a shell operator'],
    // A `;` outside quotes ends the value as git reads it, so a second command is
    // only in the value where a quote keeps it.
    ['[alias]\n\tfmt = "!tools/a.sh; tools/b.sh"\n', join('tools', 'b.sh'), 'a path after a semicolon a quote keeps'],
    ['[hook "lint"]\n\tcommand = sh -c \'tools/h.sh --fix\'\n', join('tools', 'h.sh'), 'a hook command git hands to a shell'],
  ]
  for (const [config, written, why] of cases) {
    const checkout = checkoutWith(place, { config })
    assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, written), why)
    assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), `${why}: an ordinary file`)
  }
})

/** A checkout whose config puts every write in it out of reach: refused by #192, naming each of `parts`. */
function assertWholeCheckoutRefused(place: ReturnType<typeof placeFor>, config: string, why: string, parts: readonly string[]): void {
  const checkout = checkoutWith(place, { config })
  const said = writesTheOwnersMemory(WHOLE_FILE_TOOL, write(join(checkout, 'src', 'a.ts')), placesFor(place), checkout, place.home, thisMachine)
  assert.ok(said?.includes('martha#192'), `${why}: every write into that checkout is refused (${said ?? 'admitted'})`)
  for (const part of parts) assert.ok(said?.includes(part), `${why}: the refusal names ${part} (${said})`)
}

test('a value that computes a path at run time refuses every write into that checkout (#192 r=2)', (t) => {
  const place = placeFor(t)
  // A command substitution: the path is only known when a shell runs it.
  // The refusal says what stands in the value, not only that the write is refused:
  // a member who reads it learns which spelling put the checkout out of reach.
  assertWholeCheckoutRefused(place, '[alias]\n\tfmt = !sh -c "$(dirname x)/tools/z.sh"\n', 'a command substitution', [join('.git', 'config'), ':2', 'alias.fmt', '$(dirname x)', 'with nothing written before it'])
  // And where nothing is written before the variable, which is what isolates this
  // rule from the word rule beside it: the word lands at `<top>/$PAGER/run.sh`, a
  // path no member writes, and the file the shell runs is not that one (r=3 narrowed
  // the rule to this case: a folder written before the variable is protected instead).
  assertWholeCheckoutRefused(place, '[core]\n\tpager = $PAGER/run.sh\n', 'a variable with nothing written before it', ['core.pager', '$PAGER', 'with nothing written before it'])
})

// G2, G3 and G4 as Mercurius measured them on git 2.56.0 (martha#192 r=3): in each
// case a real git run of the owner's started the member's file, and the guard admitted
// the write. A word is not split at a quote — the quote joins the text on either side
// of it into one word — and a word holding a glob names a file the value does not
// spell, so the folder written before the glob is what is protected.
test('a shell word joins its quoted pieces, and a quoted space stays in it (#192 r=3)', (t) => {
  const place = placeFor(t)
  // G2: the shell joins the pieces into `tools/x.sh`, which runs.
  const checkout = checkoutWith(place, { config: '[alias]\n\tfa = !sh tools/x\'\'.sh\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'x.sh'), 'a word joined across an empty pair of quotes')

  // G3: a quoted space is part of the word, so the folder named is `tools/my x.sh`.
  writeFileSync(join(checkout, '.git', 'config'), '[alias]\n\tfb = !sh \'tools/my x.sh\'\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'my x.sh'), 'a path with a quoted space in it')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'an ordinary file in the same checkout')
})

test('a glob protects the folder written before it, and nothing else (#192 r=3)', (t) => {
  const place = placeFor(t)
  // G4: the shell expands `tools/*.sh` to `tools/g.sh`, which no literal path in the
  // value names, so the folder the glob writes its name in is the place to protect.
  const checkout = checkoutWith(place, { config: '[alias]\n\tfc = !sh tools/*.sh\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'g.sh'), 'a file a glob in a value reaches')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'an ordinary file in the same checkout')

  // And a value whose glob names nothing in the work tree costs no write: a clone's
  // own fetch refspec protects `<top>/+refs/heads`, a path that is nobody's.
  writeFileSync(join(checkout, '.git', 'config'), '[remote "origin"]\n\tfetch = +refs/heads/*:refs/heads/*\n')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'a refspec whose glob names nothing in the work tree')
})

test('the owner\'s own argument is let through, and anything else protects the folder before it (#192 r=3)', (t) => {
  const place = placeFor(t)
  // G5: the standard alias that takes an argument. `$1` is the owner's own, so an
  // ordinary write into the checkout stays the member's: refusing it refused every
  // write into every checkout whose owner writes aliases that way.
  const checkout = checkoutWith(place, { config: '[alias]\n\tco = "!f() { git checkout \\"$1\\"; }; f"\n' })
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'an ordinary write with an alias taking "$1"')

  // Every positional and special parameter is the owner's own shell state. Each is
  // quoted here because git reads an unquoted `#` as a comment, as it does in a
  // shell (measured, 2.56.0: `echo $#; }` is the value `echo $`).
  for (const parameter of ['$1', '$9', '$0', '$@', '$*', '$#', '$?', '$$', '$!', '$-', '${1}']) {
    writeFileSync(join(checkout, '.git', 'config'), `[alias]\n\tx = !f() { echo "${parameter}"; }\n`)
    assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), `the owner's parameter ${parameter}`)
  }

  // A variable with a folder written before it protects that folder.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\tpager = tools/$PAGER/run.sh\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'other.sh'), 'a folder a variable in the value writes into')

  // And one whose folder is outside the checkout is nobody's to steer.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\tpager = /usr/bin/$ARCH/pager\n')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'a variable whose folder is outside the checkout')
})

// H1, H2, H3 and H5 as Mercurius measured them on git 2.56.0 (martha#192 r=4): `sh -c
// '<line>'` hands a second shell a line of its own words, and in each case a real git run
// of the owner's started the member's file. The line is read by that shell's tokenizer —
// its quotes join, and a glob or substitution in it names the folder written before it —
// and not only at the spaces the outer shell left in the word (r=3).
test('a line a value hands a second shell is read with that shell\'s own words (#192 r=4)', (t) => {
  const place = placeFor(t)
  // The quotes of H2 and H5 are escaped in the file (`\"`), as Mercurius wrote them and as
  // git reads them: an escaped quote stays a quote in the value, where a bare one would be
  // git's own quoting and would take the quote out of what the second shell reads.
  const cases: readonly (readonly [string, string, string])[] = [
    ['[alias]\n\tp = !sh -c \'sh tools/*.sh\'\n', join('tools', 'g.sh'), 'H1: a glob inside sh -c'],
    ['[alias]\n\tp = !sh -c \\"sh tools/x\'\'.sh\\"\n', join('tools', 'x.sh'), 'H2: a pair of quotes joined inside sh -c'],
    ['[alias]\n\tp = !sh -c \'sh \\"tools/my x.sh\\"\'\n', join('tools', 'my x.sh'), 'H5: a quoted space inside sh -c'],
  ]
  for (const [config, written, why] of cases) {
    const checkout = checkoutWith(place, { config })
    assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, written), why)
    assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), `${why}: an ordinary file`)
  }

  // H3: the substitution stands with nothing written before it, so it names a path the
  // guard cannot place at all and every write into that checkout is refused — the second
  // shell's word is not text, and the refusal says which spelling it was.
  assertWholeCheckoutRefused(place, '[alias]\n\tp = !sh -c \'sh $(printf tools/x%s .sh)\'\n', 'H3: a command substitution inside sh -c', ['alias.p', '$(printf tools/x%s .sh)', 'with nothing written before it'])
})

// H4 as Mercurius measured it (martha#192 r=4): git runs an alias with /bin/sh, which is
// bash on this machine, and bash expands `{x,y}` even called as sh, so the brace names the
// folder written before it. The control is the standard alias: the `{` that opens a
// function body has no list and no range in it, is text, and names nothing.
test('a brace expansion protects the folder written before it, and a function body\'s brace does not (#192 r=4)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[alias]\n\tp = !sh tools/{x,y}.sh\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'x.sh'), 'H4: a brace expansion')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'H4: an ordinary file')

  writeFileSync(join(checkout, '.git', 'config'), '[alias]\n\tco = "!f() { git checkout \\"$1\\"; }; f"\n')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'the brace that opens a function body')

  // And a brace holding no list and no range is text to bash (`{x}` is not expanded), so
  // the file that runs is `tools/{x}.sh` itself and a write beside it is nobody's.
  writeFileSync(join(checkout, '.git', 'config'), '[alias]\n\tp = !sh tools/{x}.sh\n')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'tools', 'x.sh'), 'a brace holding neither a list nor a range')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', '{x}.sh'), 'the file a brace with no list names literally')
})

// J1 and J2 as Mercurius measured them on git 2.56.0 (martha#192 r=5): the second shell
// hands a third one a line of its own, and that third one ran the member's file. Reading
// each word again once reaches the second shell and never the third, so a value is read
// through its shells until no new word appears — and `SHELL_DEPTH_CAP` is how far, past
// which nothing the guard says about the next shell can be trusted.
//
// The quote of the second shell is escaped in the file (`\"`), as Mercurius wrote it and
// as git reads it: a bare one is git's own quoting, and the shell never sees it.
test('a glob two shells down protects its folder (#192 r=5)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[alias]\n\tp = !sh -c \\"sh -c \'sh tools/*.sh\'\\"\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'g.sh'), 'J1: a glob two shells down')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'J1: an ordinary file')
})

// K1, K2 and K3 as Mercurius measured them on git 2.56.0 (martha#192 r=6): the same text
// is a different word in each shell that reads it — quoted at the outer shell it is
// literal, and the glob of it is the next shell's — so a word is remembered by its whole
// self, what it says and what it computes, and not by its text alone. Keyed by text, the
// second shell's word was dropped as one already seen and the folder went unprotected.
test('the same text is a new word in the shell that expands it (#192 r=6)', (t) => {
  const place = placeFor(t)
  const cases: readonly (readonly [string, string, string])[] = [
    ['[alias]\n\tp = !sh -c \'tools/*.sh\'\n', join('tools', 'g.sh'), 'K1: a glob quoted at the outer shell'],
    ['[alias]\n\tp = !sh -c \\"tools/*.sh\\"\n', join('tools', 'g.sh'), 'K2: the same glob in a double quote'],
  ]
  for (const [config, written, why] of cases) {
    const checkout = checkoutWith(place, { config })
    assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, written), why)
    assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), `${why}: an ordinary file`)
  }

  // K3: the glob is three shells down, and the last of them expands it.
  const deep = checkoutWith(place, { config: '[alias]\n\tp = !sh -c "sh -c \'tools/*.sh\'"\n' })
  assertRefusedAs192(placesFor(place), deep, place.home, join(deep, 'tools', 'g.sh'), 'K3: a glob three shells down')
  assertAdmitted(placesFor(place), deep, place.home, join(deep, 'src', 'a.ts'), 'K3: an ordinary file')
})

test('a plain path two shells down is named, with nothing computed in it (#192 r=5)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[alias]\n\tp = !sh -c \\"sh -c \'sh tools/x.sh\'\\"\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'x.sh'), 'J2: a plain path two shells down')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'J2: an ordinary file')
})

test('a value nested past the shells the guard reads through refuses the checkout (#192 r=5)', (t) => {
  const place = placeFor(t)
  // A shell past the cap: what it runs cannot be told, so every write into that
  // checkout is refused rather than read further.
  assertWholeCheckoutRefused(place, `[alias]\n\tp = !${asTheConfigFileHoldsIt(nestedUnderShells(SHELL_DEPTH_CAP + 1, 'tools/x.sh'))}\n`, 'one shell past the depth a value is read through', ['alias.p', `${SHELL_DEPTH_CAP} shells`, 'martha#192'])

  // The control: as deep as the cap allows is still read, so the file it names is
  // refused and an ordinary write beside it is not.
  const atTheCap = checkoutWith(place, { config: `[alias]\n\tp = !${asTheConfigFileHoldsIt(nestedUnderShells(SHELL_DEPTH_CAP, 'tools/x.sh'))}\n` })
  assertRefusedAs192(placesFor(place), atTheCap, place.home, join(atTheCap, 'tools', 'x.sh'), 'a value nested as deep as the cap allows')
  assertAdmitted(placesFor(place), atTheCap, place.home, join(atTheCap, 'src', 'a.ts'), 'an ordinary file beside a value at the cap')
})

/**
 * `command` run by `depth` shells one inside the next (`sh -c "sh -c \"…\""`), each
 * layer's quote escaped for the one outside it, as a shell spelling that nests is.
 */
function nestedUnderShells(depth: number, command: string): string {
  let line = command
  for (let at = 0; at < depth; at += 1) line = `sh -c "${escapedForDoubleQuotes(line)}"`
  return line
}

/** `line` with every character a double quote would work out or end it on escaped. */
function escapedForDoubleQuotes(line: string): string {
  return line.replace(/[\\"$`]/g, (letter) => `\\${letter}`)
}

/** A value as the config file holds it: git reads `\"` as a quote and `\\` as a backslash. */
function asTheConfigFileHoldsIt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

test('a key on the line of its section header is read as git reads it (#192 r=2)', (t) => {
  const place = placeFor(t)
  // git reads `[core] hooksPath = .hk` as the entry `core.hooksPath = .hk`
  // (measured, 2.56.0): the header is no whole line to git, and the folder it names
  // is a later run's to start however it is spelled.
  const checkout = checkoutWith(place, { config: '[core] hooksPath = .hk\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, '.hk', 'pre-commit'), 'a key on the section header\'s line')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'an ordinary file in the same checkout')

  writeFileSync(join(checkout, '.git', 'config'), '[alias] fmt = "!tools/x.sh"\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'x.sh'), 'an alias on the section header\'s line')

  // And a second header on the line opens a section, as git reads it.
  writeFileSync(join(checkout, '.git', 'config'), '[core] [alias]\n\tfmt = !tools/y.sh\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'tools', 'y.sh'), 'a second header on the line')
})

// Mercurius's G6 (martha#192 r=3) as the guard meets it: a config git reads perfectly is no refusal. The parse itself is
// pinned beside the parser, ../find_what_a_later_git_run_reads/git_config_a_later_run_reads.node-test.ts.
test('a comment after a section header is no entry, and the key below it is git\'s (#192 r=3)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core] ; note\n\thooksPath = hk6\n' })
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'hk6', 'pre-commit'), 'a key under a header that ends in a comment')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'an ordinary file in the same checkout')

  // The same in the spelling with the comment stuck to the bracket, and with `#`.
  writeFileSync(join(checkout, '.git', 'config'), '[core]#note\n\thooksPath = hk6b\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'hk6b', 'pre-commit'), 'a comment stuck to the header')
})

test('a config the guard cannot read refuses every write into that checkout, naming the file and line (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n\thooksPath = "unterminated\n' })
  const places = placesFor(place)
  const said = writesTheOwnersMemory(WHOLE_FILE_TOOL, write(join(checkout, 'src', 'a.ts')), places, checkout, place.home, thisMachine)
  assert.ok(said?.includes('martha#192'), `an ordinary file in a checkout whose config cannot be read is refused (${said ?? 'admitted'})`)
  assert.ok(said?.includes(join('.git', 'config')) && said.includes(':2'), `the refusal names the file and the line (${said})`)
  assertAdmitted(places, checkout, place.home, join(place.root, 'outside-the-checkout.ts'), 'a write outside that checkout')

  // An escape git itself refuses is a parse failure here too, never a value read another way.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = .a\\ b\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'a config with an escape git refuses')

  // A well-formed config is not a refusal: the control that keeps this from passing on nothing.
  writeFileSync(join(checkout, '.git', 'config'), '[core]\n\thooksPath = .husky\n')
  assertAdmitted(placesFor(place), checkout, place.home, join(checkout, 'src', 'a.ts'), 'a config the guard does read')
})

test('a file named commondir is refused inside the checkout, so a split git directory cannot be assembled (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n' })
  const places = placesFor(place)
  assertRefusedAs192(places, checkout, place.home, join(checkout, 'a', 'commondir'), 'the file a split git directory is joined with')
  assertAdmitted(places, checkout, place.home, join(checkout, 'a', 'HEAD'), 'the first half of the shape is no git directory yet')
})

test('the write that completes a git directory is refused, whichever of the three names it is (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n' })
  // Two of the three names are on disk, and the guard is asked about the third, as
  // it is just before that write lands. Each of the three can be the last, and the
  // rule is asked of the directory the write completes, whatever landed first.
  const shapes = [
    { last: 'HEAD', already: ['objects/x', 'refs/heads/main'] },
    { last: 'refs/heads/main', already: ['HEAD', 'objects/x'] },
    { last: 'objects/x', already: ['HEAD', 'refs/heads/main'] },
  ]
  for (const shape of shapes) {
    const dir = join(checkout, shape.last.replaceAll('/', '-'))
    mkdirSync(dir, { recursive: true })
    for (const name of shape.already) {
      mkdirSync(dirname(join(dir, name)), { recursive: true })
      writeFileSync(join(dir, name), name === 'HEAD' ? 'ref: refs/heads/main\n' : '')
    }
    assertRefusedAs192(placesFor(place), checkout, place.home, join(dir, shape.last), `the write of ${shape.last}, completing the set`)
  }

  // The control that keeps this from refusing a shape that is not one: with only
  // HEAD, the write of objects/ is no git directory yet, and is admitted.
  const early = join(checkout, 'only-head')
  mkdirSync(early, { recursive: true })
  writeFileSync(join(early, 'HEAD'), 'ref: refs/heads/main\n')
  assertAdmitted(placesFor(place), checkout, place.home, join(early, 'objects', 'x'), 'a directory holding one of the three is no git directory')

  // A `HEAD` that is there and is not one git accepts, overwritten by a write that
  // is: the write itself is what the directory completes with, whatever stands on
  // disk now (r=2, R1). Measured: with `HEAD` = `junk` and the two folders in
  // place, git starts the alias in that directory's config only after the write.
  const over = join(checkout, 'over-an-invalid-head')
  mkdirSync(join(over, 'objects'), { recursive: true })
  mkdirSync(join(over, 'refs', 'heads'), { recursive: true })
  writeFileSync(join(over, 'objects', 'o'), '')
  writeFileSync(join(over, 'refs', 'heads', 'main'), '')
  writeFileSync(join(over, 'HEAD'), 'junk\n')
  assertRefusedAs192(placesFor(place), checkout, place.home, join(over, 'HEAD'), 'a valid HEAD written over an invalid one')
})

test('the refusal names the file, the key and the value that put a whole checkout out of reach (#192)', (t) => {
  const place = placeFor(t)
  const checkout = checkoutWith(place, { config: '[core]\n' })
  // git itself writes this into the owner's global config, and a value naming the
  // checkout's top refuses every write into it.
  writeFileSync(join(place.home, '.gitconfig'), `[safe]\n\tdirectory = ${checkout}\n`)
  const said = writesTheOwnersMemory(WHOLE_FILE_TOOL, write(join(checkout, 'src', 'a.ts')), placesFor(place), checkout, place.home, thisMachine)
  assert.ok(said?.includes('martha#192'), `a checkout the owner's own config puts out of reach is refused (${said ?? 'admitted'})`)
  assert.ok(said?.includes(join(place.home, '.gitconfig')), `the refusal names the file (${said})`)
  assert.ok(said?.includes('safe.directory'), `the refusal names the key (${said})`)
  assert.ok(said?.includes(checkout), `the refusal names the value (${said})`)
  assert.ok(said?.includes('git configuration'), `the refusal tells the owner what to change (${said})`)
})
