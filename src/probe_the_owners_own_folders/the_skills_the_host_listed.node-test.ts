// What the host says it loaded (martha#243): the init event lists the skills by
// the folder they sit in, and a row about a folder the host reads at one depth
// asks it there rather than asking the model.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { skillsListedIn } from './the_skills_the_host_listed.ts'

const init = (skills: unknown) => JSON.stringify({ type: 'system', subtype: 'init', skills })

test('the skills the host listed are read by the folder each SKILL.md sits in, not by the name its frontmatter carries', () => {
  const printed = [`{"type":"system","subtype":"hook_started"}`, init(['.trash', 'control-skill', 'xlsx'])].join('\n')
  assert.deepEqual(skillsListedIn(printed), ['.trash', 'control-skill', 'xlsx'])
})

test('a list that holds something other than names keeps the names, and no init event, no list or no json names none', () => {
  assert.deepEqual(skillsListedIn(init(['a', 7, null, { b: 1 }, 'c'])), ['a', 'c'])
  assert.deepEqual(skillsListedIn(''), [])
  assert.deepEqual(skillsListedIn('not json at all'), [])
  assert.deepEqual(skillsListedIn(JSON.stringify({ type: 'system', subtype: 'init' })), [])
  assert.deepEqual(skillsListedIn(init('a-string')), [])
})
