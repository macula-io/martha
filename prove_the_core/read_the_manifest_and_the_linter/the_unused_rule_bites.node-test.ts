// The unused rule bites where the compiler cannot see (martha#171). eslint.config.mjs names it once, for the
// files no tsconfig includes and for a catch binding the compiler never looks at; CI runs it over the whole tree
// (`npm run lint`), and this proves that run is not vacuous, the way prove_the_core/structure_stays_flat.node-test.ts
// proves the structural floor is not.
//
// The compiler's half (noUnusedLocals and noUnusedParameters in tsconfig.json and installer/tsconfig.json) is not
// planted here: it is a compiler setting, and the red-first plant for it is in the pull request for this change.
// What is planted here is what eslint alone holds.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { ESLint } from 'eslint'

const repository = join(import.meta.dirname, '..')
const eslint = new ESLint({ cwd: repository })
const ERROR = 2

/** The rules a planted source breaks, named, under the config that source's own path is judged by. */
const rulesBrokenBy = async (filePath: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: join(repository, filePath) })
  return result!.messages.filter((message) => message.severity === ERROR).map((message) => message.ruleId ?? message.message)
}

test('an unused import in eslint.config.mjs, which belongs to no tsconfig, is named (martha#171)', async () => {
  const code = "import tseslint from 'typescript-eslint'\nimport { hostname } from 'node:os'\nexport default [tseslint.parser]\n"
  assert.deepEqual(await rulesBrokenBy('eslint.config.mjs', code), ['no-unused-vars'])
})

test('an unused import in a plain .mjs beside the sources is named (martha#171)', async () => {
  const code = "import { hostname } from 'node:os'\nexport const planted = 1\n"
  assert.deepEqual(await rulesBrokenBy('src/planted_by_the_unused_test/planted.mjs', code), ['no-unused-vars'])
})

test('a catch binding nobody reads is named, because the compiler does not look at it (martha#171)', async () => {
  const code = 'export function planted(): number {\n  try {\n    return 1\n  } catch (unusedError) {\n    return 0\n  }\n}\n'
  assert.deepEqual(await rulesBrokenBy('src/planted_by_the_unused_test/planted.ts', code), ['@typescript-eslint/no-unused-vars'])
})

test('the `_` prefix this repository uses is allowed, for a name it cannot avoid (martha#171)', async () => {
  const forTheHost = 'export const planted = (_place: string, kept: number): number => kept\n'
  const forACatch = 'export function planted(): number {\n  try {\n    return 1\n  } catch (_unusedError) {\n    return 0\n  }\n}\n'
  assert.deepEqual(await rulesBrokenBy('src/planted_by_the_unused_test/planted.ts', forTheHost), [])
  assert.deepEqual(await rulesBrokenBy('src/planted_by_the_unused_test/planted.ts', forACatch), [])
})
