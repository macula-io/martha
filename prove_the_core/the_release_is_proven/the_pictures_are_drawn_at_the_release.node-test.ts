// The release's own check, proved on a tree and not on this one (martha#627). Since the C4 pictures are drawn at
// release rather than carried by every pull request, the release is where a stale picture is caught: it refuses a
// tree whose committed picture is not what architecture/c4_diagrams.ts draws, naming the file and the command that
// redraws it, and passes a tree where they agree. The tree here is a temporary one holding only assets/, so nothing
// this file writes can be read by the tree scan or left behind.
//
// The release's and the dry run's workflows are read too, and never run: the dry run must read the tree in the step
// immediately before it packs, as the release does, or a rehearsal proves a tree the release refuses (martha#601).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { DIAGRAMS, THE_C4_DIAGRAMS_PROGRAM } from '../../architecture/c4_diagrams.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

const PROGRAM = join(import.meta.dirname, '../../src/check_the_pictures_change_with_the_version/main.ts')

/** A tree holding only the pictures the generator draws, written as `draws` says of each. */
const aTreeOfPictures = (draws: (file: string) => string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'pictures-at-release-'))
  mkdirSync(join(directory, 'assets'))
  for (const make of DIAGRAMS) {
    const diagram = make()
    writeFileSync(join(directory, 'assets', diagram.file), draws(diagram.file))
  }
  return directory
}

const checked = (repository: string) =>
  spawnSync('node', [PROGRAM, '--tree', '--repository', repository], { encoding: 'utf8' })

/** A git command in the planted repository, which must end well. */
const gitIn = (repository: string, ...args: readonly string[]): string => {
  const ran = spawnSync('git', args, { cwd: repository, encoding: 'utf8' })
  assert.equal(ran.status, 0, `git ${args.join(' ')} failed: ${ran.stderr}`)
  return ran.stdout.trim()
}

test('a tree whose committed pictures are what the generator draws passes', () => {
  const directory = aTreeOfPictures((file) => DIAGRAMS.map((make) => make()).find((diagram) => diagram.file === file)!.svg())
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 0, `the release check refused a tree that carries the pictures it draws: ${ran.stderr}`)
  } finally {
    removeTheTree(directory)
  }
})

test('a stale picture is refused by name, with the command that redraws it', () => {
  const first = DIAGRAMS[0]().file
  const directory = aTreeOfPictures((file) => (file === first ? 'not the picture this tree draws' : DIAGRAMS.map((make) => make()).find((diagram) => diagram.file === file)!.svg()))
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 1, 'a stale picture passed the release check')
    assert.match(ran.stderr, new RegExp(first.replace(/[.]/g, '\\.')), 'the refusal does not name the stale file')
    assert.ok(ran.stderr.includes(THE_C4_DIAGRAMS_PROGRAM), 'the refusal does not name the command that redraws it')
  } finally {
    removeTheTree(directory)
  }
})

test('a picture the tree does not hold at all is refused, never read as current', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pictures-at-release-'))
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 1, 'a tree with no pictures passed the release check')
    assert.match(ran.stderr, /assets\//, 'the refusal names no picture')
  } finally {
    removeTheTree(directory)
  }
})

test('a change cut before the release bump is read from its merge base, never from the base tip', () => {
  // The shape of a branch cut before a release: main then bumps the version and draws the picture, and the branch
  // touches the model alone. Read two-dot against main's new tip, that change would look like a bump of its own, in
  // reverse — a downgrade counts — with main's redraw as its own picture, and the pictures it never touched are stale.
  const directory = aTreeOfPictures((file) => `the picture ${file} held before the model changed\n`)
  try {
    gitIn(directory, 'init', '-q', '-b', 'main')
    gitIn(directory, 'config', 'user.email', 'planted@example.invalid')
    gitIn(directory, 'config', 'user.name', 'planted')
    writeFileSync(join(directory, 'package.json'), '{"version":"1.0.0"}\n')
    writeFileSync(join(directory, 'the_model.ts'), 'the model, as the work was cut from it\n')
    gitIn(directory, 'add', '-A')
    gitIn(directory, 'commit', '-q', '-m', 'the tree the work was cut from')
    gitIn(directory, 'checkout', '-q', '-b', 'work')
    writeFileSync(join(directory, 'the_model.ts'), 'the model, as the work changed it\n')
    gitIn(directory, 'add', '-A')
    gitIn(directory, 'commit', '-q', '-m', 'a change to the model alone')
    const work = gitIn(directory, 'rev-parse', 'HEAD')
    gitIn(directory, 'checkout', '-q', 'main')
    writeFileSync(join(directory, 'package.json'), '{"version":"1.1.0"}\n')
    writeFileSync(join(directory, 'assets', DIAGRAMS[0]().file), 'the picture as that release drew it\n')
    gitIn(directory, 'add', '-A')
    gitIn(directory, 'commit', '-q', '-m', 'the release bump, and the picture it draws')
    const released = gitIn(directory, 'rev-parse', 'HEAD')
    gitIn(directory, 'checkout', '-q', 'work')

    const ran = spawnSync('node', [PROGRAM, '--base', released, '--head', work, '--repository', directory], { encoding: 'utf8' })
    assert.equal(ran.status, 0, `a change that touches no picture was refused because main had moved: ${ran.stderr}`)
    assert.match(ran.stdout, /no picture is touched/, 'the pass line reads as though the pictures were judged')
  } finally {
    removeTheTree(directory)
  }
})

const WORKFLOWS = join(import.meta.dirname, '../..', '.github', 'workflows')

/** The packer, whose own step is one no step may stand between a tree read and it. */
const THE_PACKER = 'pack_a_release/pack_a_release.sh'

/** A step's `run:` lines, as that step writes them. */
const theRunsOf = (step: readonly string[]): readonly string[] => step.filter((line) => /^-? ?run: /.test(line))

/**
 * The steps of a workflow, in the order it runs them, each with the lines that belong to it.
 *
 * They are read as the `- ` items at the indentation a step of that workflow opens at, taken from the packer's own
 * step, and not as the `run:` lines alone: a step that runs nothing is still a step, and the one that matters here is
 * a checkout, which replaces the tree a read just judged without running anything the read would see (martha#601 r=1).
 */
const theStepsIn = (workflow: string): readonly (readonly string[])[] => {
  const lines = readFileSync(join(WORKFLOWS, workflow), 'utf8').split('\n')
  const packed = lines.findIndex((line) => line.includes(THE_PACKER))
  assert.ok(packed > 0, `${workflow} runs no ${THE_PACKER}`)
  const opener = /^\s*- /.exec(lines.slice(0, packed + 1).reverse().find((line) => /^\s*- /.test(line)) ?? '')
  assert.ok(opener, `${workflow} opens the packer's step nowhere`)
  const content = ' '.repeat(opener[0].length)
  const steps: string[][] = []
  for (const line of lines) {
    if (line.startsWith(opener[0])) steps.push([line.slice(opener[0].length)])
    else if (steps.length > 0 && line.startsWith(content)) steps[steps.length - 1]?.push(line.trim())
  }
  return steps
}

/** The whole step immediately before the one that packs, in this workflow: every line of it, not its `run:` alone. */
const theStepBeforeThePackIn = (workflow: string): readonly string[] => {
  const steps = theStepsIn(workflow)
  const pack = steps.findIndex((step) => theRunsOf(step).some((run) => run.includes(THE_PACKER)))
  assert.ok(pack > 0, `${workflow} has no pack step to judge the order by`)
  return steps[pack - 1] ?? []
}

/**
 * The keys a tree read's step may carry: its name and the read. Any other key can skip the read (`if:`) or void its
 * refusal (`continue-on-error:`) while its `run:` line still reads the same (martha#601 r=2).
 */
const A_READS_KEYS: readonly string[] = ['name', 'run']

/**
 * The dry run rehearses a tree the release would then refuse if it packed it: the rehearsal proves nothing about the
 * release when the picture it packs is stale (martha#601). So the dry run reads the tree as the release does, and the
 * two commands are held to each other rather than to a spelling here: whatever the release runs immediately before it
 * packs, the rehearsal runs immediately before it packs — and it is the step immediately before, not merely a step
 * somewhere above, because any step between them can put another tree in the pack.
 */
test('the dry run reads the pictures as the release does, and immediately before it packs', () => {
  const release = theStepBeforeThePackIn('release.yml')
  const dryRun = theStepBeforeThePackIn('release-dry-run.yml')
  const reads = theRunsOf(release)
  assert.equal(reads.length, 1, 'release.yml does not read the tree once, in the step before its pack')
  assert.match(reads[0] ?? '', /^run: node \S+ --tree --repository \.$/, 'release.yml packs without reading the tree first')
  const stray = release.filter((line) => !A_READS_KEYS.includes(/^([\w-]+): /.exec(line)?.[1] ?? line))
  assert.deepEqual(stray, [], 'release.yml\'s tree read carries a line that can skip it or void its refusal')
  assert.deepEqual(dryRun, release, 'the dry run\'s step before its pack is not the release\'s own tree read, line for line')
})
