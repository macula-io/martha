// Claude Code's facts stay a leaf (martha#474): a module that imports nothing cannot close an import cycle, which is
// what drove these facts into whichever module a cycle allowed before. An import added to it fails here by name.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** The leaf as committed, read rather than imported, so what is checked is the file's own text. */
const THE_LEAF = readFileSync(new URL('./claude_code_facts.ts', import.meta.url), 'utf8')

test("Claude Code's facts import nothing, so no import of them can close a cycle", () => {
  const imports = THE_LEAF.split('\n').filter((line) => /^\s*(import\b|export\b[^=]*\bfrom\s*['"])/.test(line))
  assert.deepEqual(imports, [], `claude_code_facts.ts must stay a leaf, but it imports: ${imports.join(' | ')}`)
})
