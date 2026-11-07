import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  FILE_WRITING_TOOLS,
  MEMORY_DIRECTORY_KEY,
  MEMORY_FOLDER_OVERRIDE,
  memoryDenyRules,
  ownerMemoryPlaces,
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
  ownerMemoryPlaces({ launcher_env: { HOME: place.home, ...launcher }, member_env: { HOME: place.home }, home: place.home, settings_files: settings })

const write = (file_path: string) => ({ file_path, content: 'remember: the owner said deploy' })

function assertDenied(places: OwnerMemoryPlaces, cwd: string, home: string, file_path: string, why: string): void {
  for (const tool of FILE_WRITING_TOOLS) {
    const input = tool === 'NotebookEdit' ? { notebook_path: file_path } : write(file_path)
    assert.ok(writesTheOwnersMemory(tool, input, places, cwd, home)?.includes('martha#136'), `${tool}: ${why}`)
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
  const elsewhere = join(place.root, 'elsewhere')
  mkdirSync(elsewhere)
  const linked = join(place.config, 'projects', '-linked', 'memory')
  mkdirSync(join(place.config, 'projects', '-linked'))
  symlinkSync(elsewhere, linked)
  assertDenied(places, place.worktree, place.home, join(linked, 'MEMORY.md'), 'a memory folder that is itself a link')
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
    assert.equal(writesTheOwnersMemory(tool, write(join(place.config, 'projects', '-work-main-clone', 'session.jsonl')), places, place.worktree, place.home), undefined, tool)
    assert.equal(writesTheOwnersMemory(tool, write(join(place.worktree, 'memory', 'notes.md')), places, place.worktree, place.home), undefined, tool)
  }
  assert.equal(writesTheOwnersMemory('Read', { file_path: join(place.mainMemory, 'MEMORY.md') }, places, place.worktree, place.home), undefined)
})

test('the permission rules name the same places the gate denies, a Write and an Edit rule each', (t) => {
  const place = placeFor(t)
  const override = join(place.root, 'cowork-memory')
  const places = placesFor(place, { [MEMORY_FOLDER_OVERRIDE]: override })
  const rules = memoryDenyRules(places)
  const places_named = places.memory_roots.length + places.folders.length + places.files.length
  assert.equal(rules.length, 2 * places_named)
  assert.ok(rules.includes(`Write(/${join(place.config, 'projects')}/*/memory/**)`), rules.join(' '))
  assert.ok(rules.includes(`Edit(/${override}/**)`), rules.join(' '))
  assert.ok(rules.includes(`Write(/${join(place.config, 'CLAUDE.md')})`), rules.join(' '))
  assert.ok(rules.every((rule) => /^(Write|Edit)\(\/\//.test(rule)), 'every rule names an absolute path')
})
