// The declaration's page (martha#931, Done-when 3): docs/the-declaration.md names every field a declaration may hold,
// in one place. The page is held to the parse's own key lists both ways: a field the code accepts and the page leaves
// out fails here by name, and so does a field the page names that the code would refuse.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { DECLARATION_FIELDS } from './declare_crew.ts'

const PAGE = readFileSync(new URL('../../docs/the-declaration.md', import.meta.url), 'utf8')

/** The block a page section is about: the code in its heading, `[]` dropped, or '' for "Top level". */
const blockOf = (heading: string): string | null => {
  if (heading.trim() === 'Top level') return ''
  const named = /^`([a-z_]+)(\[\])?`$/.exec(heading.trim())
  return named === null ? null : named[1]!
}

/** The fields each section's table names: the first cell of every row, in backticks. */
function theFieldsThePageNames(page: string): ReadonlyMap<string, readonly string[]> {
  const sections = page.split(/^## /m).slice(1)
  const named = new Map<string, readonly string[]>()
  for (const section of sections) {
    const [heading = '', ...body] = section.split('\n')
    const block = blockOf(heading)
    if (block === null) continue
    named.set(block, body.flatMap((line) => /^\| `([a-z_]+)` \|/.exec(line)?.[1] ?? []))
  }
  return named
}

const named = theFieldsThePageNames(PAGE)

test('#931: the declaration page has one section for every block the parse reads, and none other', () => {
  assert.deepEqual([...named.keys()].sort(), Object.keys(DECLARATION_FIELDS).sort())
})

test('#931: every field the parse accepts is named on the page, in its own block, and the page names no other', () => {
  for (const [block, fields] of Object.entries(DECLARATION_FIELDS)) {
    const onThePage = named.get(block) ?? []
    for (const field of fields) assert.ok(onThePage.includes(field), `docs/the-declaration.md does not name ${block === '' ? '' : `${block}.`}${field}`)
    for (const field of onThePage) assert.ok(fields.includes(field), `docs/the-declaration.md names ${block === '' ? '' : `${block}.`}${field}, which a declaration may not hold`)
  }
})
