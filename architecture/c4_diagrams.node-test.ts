// The C4 model cannot drift: each SVG in assets/ is exactly what c4_diagrams.ts
// draws, and architecture/README.md shows each one. The test only reads; it
// writes nothing, so it leaves nothing behind. Redraw with
// `node architecture/c4_diagrams.ts` after changing a box.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, relative } from 'node:path'
import { ASSETS, components, DIAGRAMS, LEFT_OUT, ROOM_SLICES_WHICH_LOAD } from './c4_diagrams.ts'

const README = readFileSync(join(import.meta.dirname, 'README.md'), 'utf8')
const SRC = join(import.meta.dirname, '..', 'src')

// Every directory under src/ a module of this process loads, by the resolve hook below. The hook lives
// in this test's own process, which node --test gives each test file, and the test writes nothing to
// disk, so nothing of it is left behind.
const loadedFromSrc = new Set<string>()
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context)
    const slice = /\/src\/([^/]+)\//.exec(resolved.url)?.[1]
    if (slice !== undefined) loadedFromSrc.add(slice)
    return resolved
  },
})

// The page links an SVG by its path from the page to the generator's ASSETS.
const linkTo = (file: string): string => `${relative(import.meta.dirname, ASSETS)}/${file}`

for (const make of DIAGRAMS) {
  const diagram = make()

  test(`${diagram.file} is what the generator draws`, () => {
    const drawn = readFileSync(join(ASSETS, diagram.file), 'utf8')
    assert.equal(drawn, diagram.svg(), `redraw: node architecture/c4_diagrams.ts`)
  })

  test(`architecture/README.md shows ${diagram.file}`, () => {
    assert.ok(README.includes(linkTo(diagram.file)), `architecture/README.md does not show ${diagram.file}`)
  })
}

// What the shared C4 gate asks of this repository (macula-io/macula-ci-images,
// .github/workflows/c4-model.yml): a Context and a Component diagram for a repository that
// builds an executable, and a Container diagram too because this one keeps architecture/README.md,
// each shown by a README. The gate reads the files; this reads the generator, so a box deleted
// here fails before the gate has to say so.
test('the model is a Context, a Component and a Container diagram, and the gate asks for each', () => {
  const files = DIAGRAMS.map((make) => make().file)
  for (const kind of ['context', 'component', 'container']) {
    assert.ok(files.some((f) => f.includes(kind)), `no ${kind} diagram in the generator`)
  }
})

// The Component diagram is the code, so a slice cannot reach src/ and stay off it unseen:
// it is drawn in a box, or named in LEFT_OUT with the reason it is not.
const slicesInSrc = (): string[] =>
  readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

test('every directory in src/ is drawn in a component box or declared left out', () => {
  const drawn = new Set(components().coverage.flatMap((box) => [...box.names]))
  const leftOut = new Set(LEFT_OUT.map((entry) => entry.name))
  const missing = slicesInSrc().filter((slice) => !drawn.has(slice) && !leftOut.has(slice))
  assert.deepEqual(missing, [], `in no box and not declared left out: ${missing.join(', ')}`)
})

test('a component box stands for directories that are in src/, and names each one it stands for', () => {
  const slices = new Set(slicesInSrc())
  for (const box of components().coverage) {
    for (const name of box.names) {
      assert.ok(slices.has(name), `${box.name} stands for ${name}, which is not a directory in src/`)
      assert.ok(box.text.includes(name), `${box.name} stands for ${name} but does not name it`)
    }
    for (const titled of box.name.split(', ')) {
      assert.ok(box.names.includes(titled), `${box.name} titles ${titled}, which it does not stand for`)
    }
  }
})

test('what is left out says why, is a directory in src/, and is said on the page', () => {
  const slices = new Set(slicesInSrc())
  const drawn = new Set(components().coverage.flatMap((box) => [...box.names]))
  for (const entry of LEFT_OUT) {
    assert.ok(slices.has(entry.name), `${entry.name} is left out and is not a directory in src/`)
    assert.ok(!drawn.has(entry.name), `${entry.name} is both drawn and declared left out`)
    assert.ok(entry.why.trim().length > 0, `${entry.name} is left out with no reason`)
    assert.ok(README.includes(entry.name), `architecture/README.md does not say ${entry.name} is left out`)
  }
})

// No room runs in this release, and a picture can easily say "solo loads none of it" and be wrong: the
// command does load parts of the room's slices. So the page's words are held to what the command loads,
// not to a reading of the imports.
test('a launch loads exactly the room slices the page says it does', async () => {
  loadedFromSrc.clear()
  await import('../src/run_the_martha_command/run_the_martha_command.ts')
  const loaded = [...ROOM_SLICES_WHICH_LOAD].filter((slice) => loadedFromSrc.has(slice)).sort()
  assert.deepEqual(loaded, [...ROOM_SLICES_WHICH_LOAD].sort(),
    `the page says a launch loads ${ROOM_SLICES_WHICH_LOAD.join(', ')}; one of them is no longer loaded, so the words and the code must be brought back together`)
  const drawn = new Set(components().coverage.flatMap((box) => [...box.names]))
  for (const slice of ROOM_SLICES_WHICH_LOAD) {
    assert.ok(drawn.has(slice), `${slice} loads on every launch, so the Component diagram must draw it`)
  }
})
