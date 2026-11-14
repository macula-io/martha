// Only a coincidence file imports a coincidence file (martha#289 r=3, ruling P).
//
// A slice's coincidences.ts is exempt from the reach rules (no_setting_outside_the_declaration), the way a test
// file is, because it never runs: the restated-values check reads it as a syntax tree and never imports it. That
// exemption holds only while no running code depends on the file, so this guard names every other file that
// reaches one: by import (of values or of types), export-from, import() or require, whenever the name is written
// as a literal. A name computed at run time is imports_beyond_the_core's to name. A coincidence file may import
// another, which is how a reason shared across slices travels from the slice that owns the fact.

import { basename } from 'node:path'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { moduleReferencesIn, parseSource } from './parse_a_source.ts'
import { COINCIDENCE_FILE, isACoincidenceFile } from './the_coincidences_a_slice_declares.ts'

/** Why an importer is named, in the words the test prints. */
export const IMPORTS_A_COINCIDENCE_FILE = `imports a ${COINCIDENCE_FILE}, which only another ${COINCIDENCE_FILE} may: the file is read by the check and never run`

export interface CoincidenceImport {
  readonly path: string
  readonly line: number
  readonly why: string
}

/** The base name a coincidence file is reached by, with or without its extension. */
const THE_NAME_WITHOUT_EXTENSION = COINCIDENCE_FILE.replace(/\.ts$/, '')

/** Whether a module, as written, is a coincidence file: a relative path whose base name is the file's, extension or not. */
const reachesACoincidenceFile = (specifier: string): boolean =>
  specifier.startsWith('.') && basename(specifier).replace(/\.(ts|js|mts|mjs)$/, '') === THE_NAME_WITHOUT_EXTENSION

const WAYS_TO_REACH_A_MODULE = new Set(['import', 'export_from', 'dynamic_import', 'require'])

/** Every file among `sources`, other than a coincidence file, that reaches a coincidence file. */
export function importsOfACoincidenceFile(sources: readonly CoreSource[]): CoincidenceImport[] {
  return sources
    .filter((source) => !isACoincidenceFile(source.path))
    .flatMap((source) =>
      moduleReferencesIn(parseSource(source.text, source.path).file)
        .filter((reference) => WAYS_TO_REACH_A_MODULE.has(reference.kind) && reference.specifier !== null && reachesACoincidenceFile(reference.specifier))
        .map((reference) => ({ path: source.path, line: reference.line, why: IMPORTS_A_COINCIDENCE_FILE })),
    )
}
