// How many lines of code a host directory holds.
//
// The files that count are the ones the linter reads as code, under the
// directory recursively and dot directories included, because a host's
// decisions live in every folder it keeps: `src/claude_code_relay/.claude-plugin`
// is as much of the adapter as its top level. A test file counts for nothing: it
// proves the directory rather than spending its budget. The linter decides which
// files are code (see prove_the_core/the_linter_lints_it.ts), so a host recording
// kept as `.json` beside the sources carries none of it, and the compiler's
// scanner decides which lines of a file are code (see
// prove_the_core/the_code_lines_of_a_source.ts), so commentary and blank lines
// carry none either.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { codeLinesOf } from '../../prove_the_core/the_code_lines_of_a_source.ts'
import type { Lints } from '../../prove_the_core/the_linter_lints_it.ts'

/** A test file: the checks' own, which a host directory's ceiling never counts. */
const TEST_FILE = /\.node-test\.[^.]+$/

/** Whether a file's name marks it as a test the test script runs. */
export const isATestFile = (name: string): boolean => TEST_FILE.test(name)

/**
 * The lines of code under `directory`, which is named relative to `repository`,
 * counting every file the linter reads as code except a test file.
 */
export async function codeLinesOfDirectory(repository: string, directory: string, lints: Lints): Promise<number> {
  let code = 0
  for (const entry of readdirSync(join(repository, directory), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || isATestFile(entry.name)) continue
    const path = join(entry.parentPath, entry.name)
    if (!(await lints(path))) continue
    code += codeLinesOf(readFileSync(path, 'utf8'), path)
  }
  return code
}
