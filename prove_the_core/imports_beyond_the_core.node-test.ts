import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { coreSources } from './core_sources.ts'
import { codeFoldersOf, loaderImportsOf, manifestOf, packageImportsOf, type Manifest } from './declared_in_package_json.ts'
import { importsBeyondTheCore, LOADS_BY_NAME, RUNS_TEXT, CALLS_REQUIRE_INDIRECTLY, COMPUTED } from './imports_beyond_the_core.ts'

const repository = join(import.meta.dirname, '..')
const manifest = manifestOf(repository)
const packages = packageImportsOf(manifest)
const loaders = loaderImportsOf(manifest)

// The planted imports below sit in strings, which the parser never reads as
// imports, so this file is scanned like any other.
const scanned = codeFoldersOf(manifest).flatMap((folder) =>
  coreSources(join(repository, folder)).map((source) => ({ ...source, path: join(folder, source.path) })),
)

const named = (path: string, line: number, specifier: string | null, why: string) => ({ path, line, specifier, why })
const imports = (path: string, specifier: string, line = 1) => named(path, line, specifier, `imports ${specifier}`)
const loader = (path: string, why: string, line = 1) => named(path, line, null, why)

test('no file imports anything but its own code, Node, or a package in the one folder declared for it', () => {
  assert.ok(scanned.some((source) => source.path.startsWith('src')), 'the scan read the core')
  assert.ok(scanned.some((source) => source.path.startsWith('prove_the_core')), 'the scan read the checks')
  assert.deepEqual(importsBeyondTheCore(scanned, packages, loaders), [])
})

const CONFINING_HOOK = 'src/install_the_recorded_mesh_server/confine_to_the_recorded_tree.ts'
const DIAGRAM_TEST = 'architecture/c4_diagrams.node-test.ts'
// The page's denials are held to what a launch loads (martha#323), which is a reading of the import
// graph: the same resolve hook the diagram test uses, and the same reason it is allowed one.
const PAGE_TEST = 'architecture/what_runs_today.node-test.ts'

test('tripwire: package.json lets exactly three files import node:module — the mesh server\'s confining hook (martha#73), the diagram test\'s resolve hook (martha#106) and the page test\'s resolve hook (martha#323); a fourth is a decision, not a drift', () => {
  assert.deepEqual(loaders, { [CONFINING_HOOK]: 'node:module', [DIAGRAM_TEST]: 'node:module', [PAGE_TEST]: 'node:module' })
})

test('a loader module allowed for one file is still named in any other file, and another loader module in that file is named too', () => {
  const planted = [
    { path: CONFINING_HOOK, text: "import { registerHooks } from 'node:module'" },
    { path: 'src/install_the_recorded_mesh_server/other.ts', text: "import { createRequire } from 'node:module'" },
    { path: CONFINING_HOOK, text: "import vm from 'node:vm'" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages, loaders), [
    named('src/install_the_recorded_mesh_server/other.ts', 1, 'node:module', `imports node:module, ${LOADS_BY_NAME}`),
    named(CONFINING_HOOK, 1, 'node:vm', `imports node:vm, ${LOADS_BY_NAME}`),
  ])
})

// eslint joined in martha#87: prove_the_core/structure_stays_flat.node-test.ts reads the structural floor's caps
// from eslint's resolved config and lints planted functions with them.
test('tripwire: package.json allows exactly typescript and eslint in prove_the_core, and saxes for the SVG parse in src (martha#271); a new package is a decision, not a drift', () => {
  assert.deepEqual(packages, { typescript: 'prove_the_core', eslint: 'prove_the_core', saxes: 'src' })
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
    imports('src/a/static.ts', '@opencode-ai/plugin'),
    imports('src/a/type_only.ts', '@anthropic-ai/claude-code'),
    imports('src/a/bare.ts', 'some-host-runtime'),
    imports('src/a/dynamic.ts', '@opencode-ai/sdk'),
    imports('src/a/required.ts', 'some-host-sdk'),
    imports('src/a/reexport.ts', 'host-api'),
    imports('src/a/template.ts', '@opencode-ai/sdk'),
    loader('src/a/computed.ts', COMPUTED),
    loader('src/a/computed_split.ts', COMPUTED),
    loader('src/a/required_split.ts', COMPUTED),
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
    imports('src/a/split.ts', '@opencode-ai/plugin', 2),
    imports('src/a/split_export.ts', 'host-api'),
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
    imports('src/a/parse.ts', 'typescript'),
    imports('architecture/parse.ts', 'typescript'),
    imports('prove_the_core_too/parse.ts', 'typescript'),
    imports('prove_the_core/other.ts', 'typescript/lib/tsserverlibrary'),
  ])
})

// --- a module loaded by a name the check cannot read -------------------------------

test('the Node modules that load other modules by name are named, with or without node:', () => {
  const planted = [
    { path: 'src/a/module.ts', text: "import { createRequire } from 'node:module'\ncreateRequire(import.meta.url)('host-sdk')" },
    { path: 'src/a/module_bare.ts', text: "import { createRequire } from 'module'" },
    { path: 'src/a/vm.ts', text: "import vm from 'node:vm'" },
    { path: 'src/a/vm_bare.ts', text: "const vm = await import('vm')" },
    { path: 'src/a/module.cjs', text: "const { createRequire } = require('node:module')" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    named('src/a/module.ts', 1, 'node:module', `imports node:module, ${LOADS_BY_NAME}`),
    named('src/a/module_bare.ts', 1, 'module', `imports module, ${LOADS_BY_NAME}`),
    named('src/a/vm.ts', 1, 'node:vm', `imports node:vm, ${LOADS_BY_NAME}`),
    named('src/a/vm_bare.ts', 1, 'vm', `imports vm, ${LOADS_BY_NAME}`),
    named('src/a/module.cjs', 1, 'node:module', `imports node:module, ${LOADS_BY_NAME}`),
  ])
})

test('every reach for getBuiltinModule is named', () => {
  const planted = [
    { path: 'src/a/builtin.ts', text: "process.getBuiltinModule('module').createRequire(import.meta.url)('host-sdk')" },
    { path: 'src/a/builtin_key.ts', text: "globalThis.process['getBuiltinModule']('vm')" },
    { path: 'src/a/builtin_held.ts', text: 'const { getBuiltinModule } = process' },
    { path: 'src/a/builtin_quoted.ts', text: "const { 'getBuiltinModule': get } = process" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    loader('src/a/builtin.ts', `uses getBuiltinModule, ${LOADS_BY_NAME}`),
    loader('src/a/builtin_key.ts', `uses getBuiltinModule, ${LOADS_BY_NAME}`),
    loader('src/a/builtin_held.ts', `uses getBuiltinModule, ${LOADS_BY_NAME}`),
    loader('src/a/builtin_quoted.ts', `uses getBuiltinModule, ${LOADS_BY_NAME}`),
  ])
})

test('eval and Function used at all are named: text they run can import anything', () => {
  const planted = [
    { path: 'src/a/eval.ts', text: "eval(\"import('host-sdk')\")" },
    { path: 'src/a/function.ts', text: "new Function(\"return import('host-sdk')\")()" },
    { path: 'src/a/held.ts', text: 'const run = globalThis.eval' },
    { path: 'src/a/keyed.ts', text: "const F = globalThis['Function']" },
    { path: 'src/a/destructured.ts', text: 'const { eval: e } = globalThis' },
    { path: 'src/a/shorthand.ts', text: 'const { Function } = globalThis' },
    { path: 'src/a/a_type.ts', text: 'type F = Function\nconst o = { eval: 1 }' },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    loader('src/a/eval.ts', `uses eval, ${RUNS_TEXT}`),
    loader('src/a/function.ts', `uses Function, ${RUNS_TEXT}`),
    loader('src/a/held.ts', `uses eval, ${RUNS_TEXT}`),
    loader('src/a/keyed.ts', `uses Function, ${RUNS_TEXT}`),
    loader('src/a/destructured.ts', `uses eval, ${RUNS_TEXT}`),
    loader('src/a/shorthand.ts', `uses Function, ${RUNS_TEXT}`),
  ])
})

test('require reached other than by a direct call is named', () => {
  const planted = [
    { path: 'src/a/property.cjs', text: "module.require('x')" },
    { path: 'src/a/held.cjs', text: "const r = require\nr('x')" },
    { path: 'src/a/call.cjs', text: "require.call(null, 'x')" },
    { path: 'src/a/comma.cjs', text: "(0, require)('x')" },
    { path: 'src/a/parenthesised.cjs', text: "(require)('x')" },
    { path: 'src/a/keyed.cjs', text: "module['require']('x')" },
    { path: 'src/a/destructured.cjs', text: "const { require: r } = module" },
    { path: 'src/a/direct.cjs', text: "const path = require('node:path')" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    loader('src/a/property.cjs', CALLS_REQUIRE_INDIRECTLY),
    loader('src/a/held.cjs', CALLS_REQUIRE_INDIRECTLY),
    loader('src/a/call.cjs', CALLS_REQUIRE_INDIRECTLY),
    loader('src/a/comma.cjs', CALLS_REQUIRE_INDIRECTLY),
    loader('src/a/parenthesised.cjs', CALLS_REQUIRE_INDIRECTLY),
    loader('src/a/keyed.cjs', CALLS_REQUIRE_INDIRECTLY),
    loader('src/a/destructured.cjs', CALLS_REQUIRE_INDIRECTLY),
  ])
})

// --- types are coupling too ------------------------------------------------------------

test('a type reference directive and a JSDoc import of a package are named', () => {
  const planted = [
    { path: 'src/a/directive.ts', text: '// first\n/// <reference types="host-sdk" />\nexport const a = 1' },
    { path: 'src/a/jsdoc_type.js', text: "/** @type {import('host-sdk').X} */\nexport let x" },
    { path: 'src/a/jsdoc_type.ts', text: "/** @type {import('host-sdk').X} */\nexport let x" },
    { path: 'src/a/jsdoc_import.js', text: "/** @import { X } from 'host-sdk' */\n\n/** @param {X} x */\nexport function f(x) { return x }" },
    { path: 'src/a/jsdoc_import_last.js', text: "export const a = 1\n/** @import { X } from 'host-sdk' */\n" },
    { path: 'src/a/jsdoc_own.js', text: "/** @import { X } from './x.js' */\n/** @type {import('node:path').ParsedPath} */\nexport let p" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    imports('src/a/directive.ts', 'host-sdk', 2),
    imports('src/a/jsdoc_type.js', 'host-sdk'),
    imports('src/a/jsdoc_type.ts', 'host-sdk'),
    imports('src/a/jsdoc_import.js', 'host-sdk'),
    imports('src/a/jsdoc_import_last.js', 'host-sdk', 2),
  ])
})

test('a file\'s findings come in the order of its lines, whatever kind each is', () => {
  const planted = [{ path: 'src/a/mixed.cjs', text: "const r = require\nconst sdk = require('host-sdk')\neval('x')" }]
  assert.deepEqual(importsBeyondTheCore(planted, packages), [
    loader('src/a/mixed.cjs', CALLS_REQUIRE_INDIRECTLY, 1),
    imports('src/a/mixed.cjs', 'host-sdk', 2),
    loader('src/a/mixed.cjs', `uses eval, ${RUNS_TEXT}`, 3),
  ])
})

// --- what the check cannot read ----------------------------------------------------------

test('a file that does not parse is named, since nothing in it can be judged', () => {
  const [finding, ...rest] = importsBeyondTheCore([{ path: 'src/a/broken.ts', text: 'export const = \n' }], packages)
  assert.deepEqual(rest, [])
  assert.equal(finding?.path, 'src/a/broken.ts')
  assert.equal(finding?.specifier, null)
  assert.match(finding?.why ?? '', /^does not parse: /)
})

test('the code folders are the ones the test script runs', () => {
  assert.deepEqual(codeFoldersOf(manifest).sort(), ['architecture', 'prove_the_core', 'rehearse_a_release', 'src'])
})

test('every glob form the test script uses is read, and one naming no folder fails by name', () => {
  const testing = (command: string): Manifest => ({ scripts: { test: command } })
  assert.deepEqual(
    codeFoldersOf(testing("node --test --test-reporter=spec 'src/**/*.node-test.ts' architecture/*.node-test.ts \"checks/x.node-test.ts\"")),
    ['src', 'architecture', 'checks'],
  )
  assert.deepEqual(
    codeFoldersOf(testing("node ./runs/through.ts node --test 'src/**/*.node-test.ts'")),
    ['runs', 'src'],
    'a runner node --test is started through is code the script runs',
  )
  assert.throws(() => codeFoldersOf(testing("node --test 'src/**/*.ts' '*.node-test.ts'")), /'\*\.node-test\.ts'/)
  assert.throws(() => codeFoldersOf(testing('node --test lone.node-test.ts')), /'lone\.node-test\.ts'/)
  assert.throws(() => codeFoldersOf(testing("node --test '**/*.node-test.ts'")), /'\*\*\/\*\.node-test\.ts'/)
})
