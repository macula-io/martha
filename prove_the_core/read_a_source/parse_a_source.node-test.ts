import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { moduleReferencesOf, parseSource } from './parse_a_source.ts'

// The planted sources are JSON, so no walk of the core's code reads them as imports.
interface Planted {
  readonly references: readonly {
    readonly text: string
    readonly path: string
    readonly expect: readonly { specifier: string | null; kind: string; type_only: boolean; line: number }[]
  }[]
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_module_references.json'), 'utf8')) as Planted

test('every way a module names another is read, with its kind, whether it is a type, and its line', () => {
  assert.ok(planted.references.length > 0)
  for (const { text, path, expect } of planted.references) assert.deepEqual(moduleReferencesOf(text, path), expect, text)
})

test('a source that parses has no errors; one that does not names the line', () => {
  assert.deepEqual(parseSource('const ok = 1\n', 'a.ts').errors, [])
  assert.deepEqual([...new Set(parseSource('const ok = 1\nconst = 2\n', 'a.ts').errors.map(error => error.line))], [2])
})

test('JSX is read by its extension', () => {
  assert.deepEqual(parseSource('const view = <div>{x}</div>\n', 'a.tsx').errors, [])
  assert.notDeepEqual(parseSource('const view = <div>{x}</div>\n', 'a.ts').errors, [])
})
