// The rule that a test file's tree goes through the removal that retries (martha#272).
//
// Two things are proved here. That the suite keeps the rule: every test file in the repository is read, and a removal
// of a tree without the retry fails this test by name, with the file and line. And that the check is not vacuous: a
// planted test file that removes a tree each of the ways a test really can — plain, through `fs.`, through an aliased
// import, through an element access, split over lines — is named, while the removal that retries, a removal of one
// file, and the same call written inside a string or a comment are not.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { coreSources } from './core_sources.ts'
import { removalsWithoutARetry, THE_REMOVAL_THAT_RETRIES } from './removals_without_a_retry.ts'

const repository = join(import.meta.dirname, '..')

const planted = (text: string, path = 'src/planted/planted.node-test.ts'): CoreSource => ({ path, text })

test('no test file in the suite removes a tree without the bounded retry (martha#272)', () => {
  const findings = removalsWithoutARetry(coreSources(repository))
  assert.deepEqual(
    findings,
    [],
    `these test files remove a tree with no retry: use ${THE_REMOVAL_THAT_RETRIES} (martha#272)\n${findings
      .map(({ path, line, why }) => `  ${path}:${line} ${why}`)
      .join('\n')}`,
  )
})

test('a test file that clears its tree with the filesystem remove is named, with its line', () => {
  const text = [
    "import { mkdtempSync, rmSync } from 'node:fs'",
    'export const a = (home: string): void => {',
    '  rmSync(home,',
    '    { recursive: true, force: true },',
    '  )',
    '}',
    '',
  ].join('\n')
  const findings = removalsWithoutARetry([planted(text)])
  assert.equal(findings.length, 1)
  assert.equal(findings[0]?.path, 'src/planted/planted.node-test.ts')
  assert.equal(findings[0]?.line, 3, 'the call is named on the line it starts')
  assert.match(findings[0]?.why ?? '', /removes a tree with no retry/)
})

test('the same removal is named through fs., through an element access, and through an aliased import', () => {
  const ways = [
    'import fs from \'node:fs\'\nexport const a = (home: string): void => { fs.rmSync(home, { recursive: true, force: true }) }\n',
    'import fs from \'node:fs\'\nexport const a = (home: string): void => { fs[\'rmSync\'](home, { recursive: true }) }\n',
    'import { rmSync as clear } from \'node:fs\'\nexport const a = (home: string): void => { clear(home, { recursive: true }) }\n',
    'import { rm } from \'node:fs/promises\'\nexport const a = async (home: string): Promise<void> => { await rm(home, { recursive: true, force: true }) }\n',
  ]
  assert.deepEqual(
    ways.map((text) => removalsWithoutARetry([planted(text)]).length),
    [1, 1, 1, 1],
  )
})

test('the removal that retries, a removal of one file, and the same call inside a string or a comment are not named', () => {
  const allowed = [
    `import { ${THE_REMOVAL_THAT_RETRIES} } from '../launch_a_claude_code_member/relay_copy.ts'\nexport const a = (home: string): void => { ${THE_REMOVAL_THAT_RETRIES}(home) }\n`,
    "import { rmSync } from 'node:fs'\nexport const a = (file: string): void => { rmSync(file) }\n",
    "import { mkdtempSync } from 'node:fs'\nexport const a = 'rmSync(home, { recursive: true })'\n// rmSync(home, { recursive: true, force: true })\n",
  ]
  assert.deepEqual(
    allowed.map((text) => removalsWithoutARetry([planted(text)]).map(({ line, why }) => [line, why])),
    allowed.map(() => []),
  )
})

test('a removal whose failure is asserted is an expectation, not a teardown, and is not named', () => {
  const text = [
    "import assert from 'node:assert/strict'",
    "import { rmSync } from 'node:fs'",
    'export const a = (copy: string): void => {',
    '  assert.throws(',
    '    () => rmSync(copy, { recursive: true }),',
    "    'the read-only copy refuses a plain removal',",
    '  )',
    '}',
    '',
  ].join('\n')
  assert.deepEqual(removalsWithoutARetry([planted(text)]), [])
})

test('a file that is not a test file is not judged: the core removes trees of its own', () => {
  const text = "import { rmSync } from 'node:fs'\nexport const a = (home: string): void => { rmSync(home, { recursive: true, force: true }) }\n"
  assert.deepEqual(removalsWithoutARetry([planted(text, 'src/planted/planted.ts')]), [])
})
