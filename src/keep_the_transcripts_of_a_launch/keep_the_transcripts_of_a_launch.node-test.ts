// Keeping a member's host transcripts once its launch ends (martha#646), through the filesystem: the place, the modes,
// the staging name, the mark beside them and the prune. The choices themselves are held in the slice's own test.

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { THE_MARK_FILE } from '../choose_the_transcripts_to_keep/choose_the_transcripts_to_keep.ts'
import { openState, STATE_FILE_MODE, TRANSCRIPTS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { STAGING_PREFIX } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { TOKEN_PREFIXES } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { keepTheTranscriptsOf, pruneTheLaunchesPastTheNewest } from './keep_the_transcripts_of_a_launch.ts'
import { bytesKeptOf, TRANSCRIPTS_WHEN_UNNAMED } from '../declare_crew/the_crews_transcripts.ts'
/** The crew's default, as a declaration that names no block reads it (martha#931 B). */
const TRANSCRIPTS_LAUNCHES_KEPT = TRANSCRIPTS_WHEN_UNNAMED.launches_kept

/** The crew's default, as a declaration that names no block reads it (martha#931 B). */
const TRANSCRIPTS_LAUNCH_BYTES_KEPT = bytesKeptOf(TRANSCRIPTS_WHEN_UNNAMED)

// The host's own word for a project's transcripts, spelled here as a fixture rather than read from the slice.
const THE_HOSTS_PROJECTS_PLACE = 'projects'

/** A home of this test's own, its project, and a member's config folder with one transcript under it. */
const aLaunchEnding = (t: { after: (fn: () => void) => void }) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-646-')))
  t.after(() => removeTheTree(home))
  const project = join(home, 'project')
  const config = join(home, 'host-config')
  mkdirSync(project)
  mkdirSync(join(config, THE_HOSTS_PROJECTS_PLACE, 'the-project'), { recursive: true })
  const opened = openState(join(home, 'state'), project)
  if ('refusal' in opened) assert.fail(opened.refusal)
  const place = join(opened.directory, TRANSCRIPTS_PLACE)
  const kept = (name: string): string => join(place, encodeURIComponent('launch-1'), THE_HOSTS_PROJECTS_PLACE, 'the-project', name)
  return { home, project, config, state_root: join(home, 'state'), place, kept }
}

const aTranscriptIn = (config: string, name: string, text: string): void =>
  writeFileSync(join(config, THE_HOSTS_PROJECTS_PLACE, 'the-project', name), text)

/** One line of the host's own record, as the host writes it: serialized, so a break in it is the two characters a file holds. */
const aLineOf = (text: string) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`

/** A file of `bytes` that costs the disk nothing: made, then stretched, so a bound measured in megabytes is testable. */
const spacedTo = (path: string, bytes: number): void => {
  writeFileSync(path, '')
  truncateSync(path, bytes)
}

test('a transcript is kept with its token redacted, 0600, and the mark says which file held one (martha#646)', (t) => {
  const ending = aLaunchEnding(t)
  const token = `${TOKEN_PREFIXES[0] ?? 'ghp_'}abcdefghijklmnop`
  aTranscriptIn(ending.config, 's-1.jsonl', `{"text":"git push with ${token} here"}\n`)
  writeFileSync(join(ending.config, 'notes.txt'), '{"model":"sonnet"}')
  const trouble = keepTheTranscriptsOf({ ...ending, project_root: ending.project, config_folder: ending.config, theLaunch: 'launch-1', theLaunchKey: 'sk-ant-the-key', transcripts: TRANSCRIPTS_WHEN_UNNAMED })
  assert.deepEqual(trouble, [], 'the keep said it could not keep what it should have')
  const keptText = readFileSync(ending.kept('s-1.jsonl'), 'utf8')
  assert.equal(keptText.includes(token), false, 'the token was kept in the clear')
  assert.equal(statSync(ending.kept('s-1.jsonl')).mode & 0o777, STATE_FILE_MODE, 'the kept transcript is not 0600')
  assert.deepEqual(JSON.parse(readFileSync(join(ending.place, encodeURIComponent('launch-1'), THE_MARK_FILE), 'utf8')), { token_found_in: ['projects/the-project/s-1.jsonl'] })
  assert.equal(statSync(join(ending.place, encodeURIComponent('launch-1'), 'projects')).mode & 0o777, 0o700, 'the directory the transcripts sit in is not 0700')
})

test('a folder with no transcript keeps nothing, and a launch with no token gets no mark (martha#646)', (t) => {
  const ending = aLaunchEnding(t)
  writeFileSync(join(ending.config, 'notes.txt'), '{"model":"sonnet"}')
  aTranscriptIn(ending.config, 's-1.jsonl', '{"text":"nothing secret here"}\n')
  keepTheTranscriptsOf({ ...ending, project_root: ending.project, config_folder: ending.config, theLaunch: 'launch-1', theLaunchKey: 'sk-ant-the-key', transcripts: TRANSCRIPTS_WHEN_UNNAMED })
  assert.equal(readFileSync(ending.kept('s-1.jsonl'), 'utf8'), '{"text":"nothing secret here"}\n', 'a clean transcript was not kept as written')
  assert.throws(() => statSync(join(ending.place, encodeURIComponent('launch-1'), THE_MARK_FILE)), 'a mark was written for a launch that held no token')
})

test('a member whose config folder is gone is kept with nothing and is no failure (martha#646)', (t) => {
  const ending = aLaunchEnding(t)
  const trouble = keepTheTranscriptsOf({ ...ending, project_root: ending.project, config_folder: join(ending.home, 'not-there'), theLaunch: 'launch-1', theLaunchKey: '', transcripts: TRANSCRIPTS_WHEN_UNNAMED })
  assert.deepEqual(trouble, [], 'a folder the host never made was reported as a failure')
})

test('a file that is not the host\'s transcript shape is never read, however large, and eats none of the launch\'s bound (martha#646 r=1 R4)', (t) => {
  const ending = aLaunchEnding(t)
  // Sparse, so the size is real to `stat` without writing the bytes: a reader that walks by size alone would read this.
  spacedTo(join(ending.config, THE_HOSTS_PROJECTS_PLACE, 'the-project', 'not-a-transcript.bin'), TRANSCRIPTS_LAUNCH_BYTES_KEPT)
  aTranscriptIn(ending.config, 's-1.jsonl', aLineOf('kept whole'))
  const trouble = keepTheTranscriptsOf({ ...ending, project_root: ending.project, config_folder: ending.config, theLaunch: 'launch-1', theLaunchKey: '', transcripts: TRANSCRIPTS_WHEN_UNNAMED })
  assert.deepEqual(trouble, [])
  assert.equal(readFileSync(ending.kept('s-1.jsonl'), 'utf8'), aLineOf('kept whole'), 'a file of another shape took the transcript\'s room in the launch\'s bound')
  assert.equal(readdirSync(join(ending.place, encodeURIComponent('launch-1'), THE_HOSTS_PROJECTS_PLACE, 'the-project')).sort().join(','), 's-1.jsonl', 'a file that is not the host\'s transcript was kept')
})

test('the launch\'s bound stops the reads, and a transcript past it is kept as the line that says so (martha#646 r=1 R4)', (t) => {
  const ending = aLaunchEnding(t)
  const half = TRANSCRIPTS_LAUNCH_BYTES_KEPT / 2
  // Sparse again: the content is not what this test is about, and a bound measured in megabytes is the product's own.
  spacedTo(join(ending.config, THE_HOSTS_PROJECTS_PLACE, 'the-project', 's-1.jsonl'), half)
  spacedTo(join(ending.config, THE_HOSTS_PROJECTS_PLACE, 'the-project', 's-2.jsonl'), half)
  aTranscriptIn(ending.config, 's-3.jsonl', aLineOf('one byte too many'))
  keepTheTranscriptsOf({ ...ending, project_root: ending.project, config_folder: ending.config, theLaunch: 'launch-1', theLaunchKey: '', transcripts: TRANSCRIPTS_WHEN_UNNAMED })
  assert.match(readFileSync(ending.kept('s-3.jsonl'), 'utf8'), /of one launch\]$/, 'a transcript past the launch\'s bound was read and kept, or its note names another bound')
})

test('a keep whose write fails leaves no half under the staging name (martha#646 r=1, nit 1)', (t) => {
  const ending = aLaunchEnding(t)
  aTranscriptIn(ending.config, 's-1.jsonl', aLineOf('kept'))
  // A directory where the kept file goes: the write lands whole under the staging name, and the rename cannot replace it.
  mkdirSync(ending.kept('s-1.jsonl'), { recursive: true })
  const trouble = keepTheTranscriptsOf({ ...ending, project_root: ending.project, config_folder: ending.config, theLaunch: 'launch-1', theLaunchKey: '', transcripts: TRANSCRIPTS_WHEN_UNNAMED })
  assert.equal(trouble.length, 1, 'a transcript that could not be renamed into place was not said as trouble')
  const left = readdirSync(join(ending.place, encodeURIComponent('launch-1'), THE_HOSTS_PROJECTS_PLACE, 'the-project'))
  assert.equal(left.filter((name) => name.startsWith(STAGING_PREFIX)).length, 0, `a half-written file was left behind: ${left.join(', ')}`)
})

test('the launches past the newest are pruned by each directory\'s own last change, and the oldest goes (martha#646)', (t) => {
  const ending = aLaunchEnding(t)
  mkdirSync(ending.place, { recursive: true })
  // The names run the other way to the times on purpose: the newest launch is the first by name, so a prune that
  // ordered by a directory's name and not by its own last change keeps the wrong ones and fails here by name.
  for (let at = 0; at <= TRANSCRIPTS_LAUNCHES_KEPT; at += 1) {
    const directory = join(ending.place, `launch-${String(at)}`)
    mkdirSync(directory)
    const when = new Date(Date.UTC(2026, 0, 1) + (TRANSCRIPTS_LAUNCHES_KEPT - at) * 1000)
    utimesSync(directory, when, when)
  }
  const trouble = pruneTheLaunchesPastTheNewest(ending.place, TRANSCRIPTS_LAUNCHES_KEPT)
  assert.deepEqual(trouble, [])
  assert.throws(() => statSync(join(ending.place, `launch-${String(TRANSCRIPTS_LAUNCHES_KEPT)}`)), 'the launch kept longest ago was not pruned')
  assert.equal(statSync(join(ending.place, 'launch-0')).isDirectory(), true, 'the launch last kept was pruned')
  assert.equal(statSync(join(ending.place, `launch-${String(TRANSCRIPTS_LAUNCHES_KEPT - 1)}`)).isDirectory(), true,
    'the launch the bound still had room for was pruned too, so more than one went')
  assert.deepEqual(readdirSync(ending.place).sort(), Array.from({ length: TRANSCRIPTS_LAUNCHES_KEPT }, (_, at) => `launch-${String(at)}`).sort(),
    'the place does not hold exactly the newest launches the bound keeps')
})

test('#931 B: a launch keeps to the declared transcripts.megabytes_kept and prunes past the declared launches_kept', (t) => {
  const declared = { launches_kept: 2, megabytes_kept: 1 }
  const between = bytesKeptOf(declared) + 1
  const keep = (ending: ReturnType<typeof aLaunchEnding>, theLaunch: string, transcripts: typeof declared) =>
    keepTheTranscriptsOf({ ...ending, project_root: ending.project, config_folder: ending.config, theLaunch, theLaunchKey: '', transcripts })

  const byDefault = aLaunchEnding(t)
  spacedTo(join(byDefault.config, THE_HOSTS_PROJECTS_PLACE, 'the-project', 's-1.jsonl'), between)
  keep(byDefault, 'launch-1', TRANSCRIPTS_WHEN_UNNAMED)
  assert.doesNotMatch(readFileSync(byDefault.kept('s-1.jsonl'), 'utf8'), /too large to keep/, 'under the default bound the transcript is kept')

  const bounded = aLaunchEnding(t)
  spacedTo(join(bounded.config, THE_HOSTS_PROJECTS_PLACE, 'the-project', 's-1.jsonl'), between)
  keep(bounded, 'launch-1', declared)
  assert.match(readFileSync(bounded.kept('s-1.jsonl'), 'utf8'), new RegExp(`past the ${String(bytesKeptOf(declared))} bytes Martha keeps`), 'the declared bound was not the one kept to')

  // Two files that each fit the declared bound but not together: the second is unreadable, so a reader that opened it,
  // rather than stopping at the launch's declared room by its size, would note that it could not read it.
  const shared = aLaunchEnding(t)
  const half = bytesKeptOf(declared) / 2 + 1
  spacedTo(join(shared.config, THE_HOSTS_PROJECTS_PLACE, 'the-project', 's-1.jsonl'), half)
  const second = join(shared.config, THE_HOSTS_PROJECTS_PLACE, 'the-project', 's-2.jsonl')
  spacedTo(second, half)
  chmodSync(second, 0o000)
  keep(shared, 'launch-1', declared)
  assert.match(readFileSync(shared.kept('s-2.jsonl'), 'utf8'), new RegExp(`past the ${String(bytesKeptOf(declared))} bytes Martha keeps of one launch`), 'the reader opened a file past the declared launch room')

  // Three launches, kept under the default count so none is pruned yet, dated oldest first; then one more keep under
  // the declared count, which leaves the newest two.
  for (const at of [2, 3]) keep(bounded, `launch-${String(at)}`, TRANSCRIPTS_WHEN_UNNAMED)
  for (const at of [1, 2, 3]) {
    const when = new Date(Date.UTC(2026, 0, 1) + at * 1000)
    utimesSync(join(bounded.place, `launch-${String(at)}`), when, when)
  }
  keep(bounded, 'launch-3', declared)
  assert.deepEqual(readdirSync(bounded.place).sort(), ['launch-2', 'launch-3'], 'past the declared count, the oldest launch was not pruned')
})
