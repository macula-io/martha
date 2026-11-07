// The C4 model cannot drift: each SVG in assets/ is exactly what c4_diagrams.ts
// draws, and architecture/README.md shows each one. The test only reads; it
// writes nothing, so it leaves nothing behind. Redraw with
// `node architecture/c4_diagrams.ts` after changing a box.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ASSETS, DIAGRAMS } from './c4_diagrams.ts'

const README = readFileSync(join(import.meta.dirname, 'README.md'), 'utf8')

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
