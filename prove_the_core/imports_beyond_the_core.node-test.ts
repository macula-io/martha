import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { coreSources } from './core_sources.ts'
import { codeFoldersOf, manifestOf, packageImportsOf } from './declared_in_package_json.ts'
import { importsBeyondTheCore } from './imports_beyond_the_core.ts'

const repository = join(import.meta.dirname, '..')
const manifest = manifestOf(repository)
const packages = packageImportsOf(manifest)

// The planted imports below sit in strings, which the parser never reads as
// imports, so this file is scanned like any other.
const scanned = codeFoldersOf(manifest).flatMap((folder) =>
  coreSources(join(repository, folder)).map((source) => ({ ...source, path: join(folder, source.path) })),
)

test('no file imports anything but its own code, Node, or a package in the one folder declared for it', () => {
  assert.ok(scanned.some((source) => source.path.startsWith('src')), 'the scan read the core')
  assert.ok(scanned.some((source) => source.path.startsWith('prove_the_core')), 'the scan read the checks')
  assert.deepEqual(importsBeyondTheCore(scanned, packages), [])
})

test('package.json declares each allowed package with the one folder that may import it', () => {
  assert.deepEqual(packages, { typescript: 'prove_the_core' })
})

test('a planted import of a coding tool is named, with its file and line', () => {
  const planted = [
    { path: 'src/a/static.ts', text: "import { tool } from '@opencode-ai/plugin'" },
    { path: 'src/a/type_only.ts', text: "import type { Hooks } from '@anthropic-ai/claude-code'" },
    { path: 'src/a/bare.ts', text: "import 'some-host-runtime'" },
    { path: 'src/a/dynamic.ts', text: "const sdk = await import('@opencode-ai/sdk')" },
    { path: 'src/a/required.ts', text: "const sdk = require('some-host-sdk')" },
    { path: 'src/a/reexport.ts', text: "export * from 'host-api'" },
    { path: 'src/a/template.ts', text: 'const sdk = await import(`@opencode-ai/sdk`)' },
    { path: 'src/a/computed.ts', text: 'const sdk = await import(name)' },
    { path: 'src/a/computed_split.ts', text: 'const sdk = await import(\n  name\n)' },
    { path: 'src/a/required_split.ts', text: 'const sdk = require(\n  name\n)' },
    { path: 'src/a/fine.ts', text: "import { join } from 'node:path'\nimport { x } from '../b/b.ts'" },
    { path: 'src/a/prose.ts', text: "lines.filter((line) => line.startsWith('import '))\nassert(x, ['y'])" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    { path: 'src/a/static.ts', line: 1, specifier: '@opencode-ai/plugin' },
    { path: 'src/a/type_only.ts', line: 1, specifier: '@anthropic-ai/claude-code' },
    { path: 'src/a/bare.ts', line: 1, specifier: 'some-host-runtime' },
    { path: 'src/a/dynamic.ts', line: 1, specifier: '@opencode-ai/sdk' },
    { path: 'src/a/required.ts', line: 1, specifier: 'some-host-sdk' },
    { path: 'src/a/reexport.ts', line: 1, specifier: 'host-api' },
    { path: 'src/a/template.ts', line: 1, specifier: '@opencode-ai/sdk' },
    { path: 'src/a/computed.ts', line: 1, specifier: null },
    { path: 'src/a/computed_split.ts', line: 1, specifier: null },
    { path: 'src/a/required_split.ts', line: 1, specifier: null },
  ])
})

test('an import inside a string or a comment is text, not an import', () => {
  const planted = [
    { path: 'src/a/string.ts', text: "const s = \"import { tool } from '@opencode-ai/plugin'\"" },
    { path: 'src/a/template.ts', text: "const s = `require('some-host-sdk')`" },
    { path: 'src/a/line_comment.ts', text: "// import { tool } from '@opencode-ai/plugin'\n" },
    { path: 'src/a/block_comment.ts', text: "/*\nconst sdk = await import('@opencode-ai/sdk')\n*/\n" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [])
})

test('an import split over lines is named, at the line it starts on', () => {
  const planted = [
    { path: 'src/a/split.ts', text: "\nimport {\n  tool,\n} from\n  '@opencode-ai/plugin'\n" },
    { path: 'src/a/split_export.ts', text: "export {\n  tool\n}\nfrom 'host-api'\n" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    { path: 'src/a/split.ts', line: 2, specifier: '@opencode-ai/plugin' },
    { path: 'src/a/split_export.ts', line: 1, specifier: 'host-api' },
  ])
})

test('an allowed package is named outside the one folder declared for it, and only there', () => {
  const allowed = { typescript: 'prove_the_core' }
  const planted = [
    { path: 'prove_the_core/parse.ts', text: "import ts from 'typescript'" },
    { path: 'prove_the_core/deeper/parse.ts', text: "import ts from 'typescript'" },
    { path: 'src/a/parse.ts', text: "import ts from 'typescript'" },
    { path: 'architecture/parse.ts', text: "import ts from 'typescript'" },
    { path: 'prove_the_core_too/parse.ts', text: "import ts from 'typescript'" },
    { path: 'prove_the_core/other.ts', text: "import x from 'typescript/lib/tsserverlibrary'" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, allowed), [
    { path: 'src/a/parse.ts', line: 1, specifier: 'typescript' },
    { path: 'architecture/parse.ts', line: 1, specifier: 'typescript' },
    { path: 'prove_the_core_too/parse.ts', line: 1, specifier: 'typescript' },
    { path: 'prove_the_core/other.ts', line: 1, specifier: 'typescript/lib/tsserverlibrary' },
  ])
})

test('the code folders are the ones the test script runs', () => {
  assert.deepEqual(codeFoldersOf(manifest).sort(), ['architecture', 'prove_the_core', 'src'])
})
