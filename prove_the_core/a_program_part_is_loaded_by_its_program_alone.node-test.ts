import assert from 'node:assert/strict'
import { join, sep } from 'node:path'
import { test } from 'node:test'

import { coreSources } from './core_sources.ts'
import { CORE, manifestOf, programPartsOf, programsRunByScriptsOf } from './declared_in_package_json.ts'
import { programPartsImportedFromOutside, type ProgramParts } from './a_program_part_is_loaded_by_its_program_alone.ts'

const repository = join(import.meta.dirname, '..')
const manifest = manifestOf(repository)
const declared = programPartsOf(manifest)

// A made-up map for the planted cases: two parts of one program, and one part of another.
const PROGRAM = 'run_a_program'
const OTHER_PROGRAM = 'run_another_program'
const PART = 'one_part'
const SIBLING = 'a_sibling_part'
const OTHERS_PART = 'another_programs_part'
const PARTS: ProgramParts = { [PART]: PROGRAM, [SIBLING]: PROGRAM, [OTHERS_PART]: OTHER_PROGRAM }

// An import of one module, written so that no text walk reads this file as importing it.
const importOf = (specifier: string, keyword = 'import') => [keyword, '{ x }', 'from', `'${specifier}'`].join(' ')
const fileIn = (directory: string, name = 'a_file.ts') => join(directory, name)
const intoThePart = `../${PART}/${PART}.ts`

/** The lines at which the planted file in `directory` is named for importing `specifier`. */
const linesFound = (directory: string, specifier: string, keyword?: string) =>
  programPartsImportedFromOutside([{ path: fileIn(directory), text: `\n${importOf(specifier, keyword)}\n` }], PARTS).map((found) => found.line)

test('package.json declares program parts, each a directory under the core that exists, belonging to a program a script runs', () => {
  const directories = new Set(coreSources(join(repository, CORE)).map((source) => source.path.split(sep)[0]))
  const programs = programsRunByScriptsOf(manifest)
  const glueAndAdapters = [...(manifest.martha?.hostGlue ?? []), ...(manifest.martha?.hostAdapters ?? [])].map((entry) => entry.replace(`${CORE}/`, ''))
  assert.notDeepEqual(Object.keys(declared), [], 'the declaration is read')
  for (const [part, program] of Object.entries(declared)) {
    assert.ok(directories.has(part), `${part} is not a directory under ${CORE}`)
    assert.ok(programs.includes(program), `${part} names ${program}, which no script runs`)
    assert.ok(!programs.includes(part), `${part} is a program itself, so declaring it a part does nothing`)
    assert.ok(!glueAndAdapters.includes(part), `${part} is host glue or an adapter, which a program part is not`)
  }
})

test('no file under the core imports a program part but the part itself, its program and the program\'s other parts', () => {
  const sources = coreSources(join(repository, CORE))
  assert.ok(sources.length > 1, 'the walk read the core')
  assert.deepEqual(programPartsImportedFromOutside(sources, declared), [])
})

test('caught: a slice that imports a program part, named by file and line (martha#443)', () => {
  assert.deepEqual(linesFound('some_slice', intoThePart), [2])
  const [found] = programPartsImportedFromOutside([{ path: fileIn('some_slice'), text: importOf(intoThePart) }], PARTS)
  assert.equal(found?.path, fileIn('some_slice'))
  assert.match(found?.why ?? '', new RegExp(`${PART}.*${PROGRAM}`))
})

test('caught: a part of another program, and a type-only import, are not let through (martha#443)', () => {
  assert.deepEqual(linesFound(OTHERS_PART, intoThePart), [2])
  assert.deepEqual(linesFound('some_slice', intoThePart, 'import type'), [2])
})

test('quiet: the part\'s own files, its program and a sibling part import it; and a slice importing what is not a part (martha#443)', () => {
  assert.deepEqual(linesFound(PART, `./${PART}.ts`), [])
  assert.deepEqual(linesFound(PROGRAM, intoThePart), [])
  assert.deepEqual(linesFound(SIBLING, intoThePart), [])
  assert.deepEqual(linesFound('some_slice', '../some_other_slice/x.ts'), [])
  assert.deepEqual(linesFound('some_slice', 'node:fs'), [])
  // A package whose name is a part's, imported from a file at the core's top: a package is never a directory under it.
  assert.deepEqual(programPartsImportedFromOutside([{ path: 'a_file.ts', text: importOf(`${PART}/${PART}.ts`) }], PARTS), [])
})
