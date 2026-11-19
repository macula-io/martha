import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { whyALoadedSkillCouldLeaveTheCheckout, type AnEntryUnderASkillRoot } from './a_loaded_skill_stays_in_the_checkout.ts'

/** A checkout and a skill folder in it, as real paths; the names are this test's own. */
const CHECKOUT = join('/', 'work', 'a-checkout')
const SKILL = join(CHECKOUT, 'skills-root-of-this-test', 'x')
/** Outside the checkout, and a sibling whose name starts like the checkout's, which a bare prefix test would take as inside. */
const OUTSIDE = join('/', 'home', 'someone', 'keys')
const SIBLING = `${CHECKOUT}-evil`

/** What a walk of an approved checkout's skill roots finds: a folder, a skill, a supporting file, and a link inside. */
const CLEAN: readonly AnEntryUnderASkillRoot[] = [
  { kind: 'folder', path: SKILL },
  { kind: 'file', path: join(SKILL, 'SKILL.md'), hard_links: 1 },
  { kind: 'file', path: join(SKILL, 'guide.txt'), hard_links: 1 },
  { kind: 'link', path: join(SKILL, 'same.txt'), leads_to: join(SKILL, 'guide.txt') },
  { kind: 'link', path: join(SKILL, 'whole'), leads_to: CHECKOUT },
]

test("a walk that finds nothing reaching outside the checkout lets a loaded skill be the checkout's own (martha#614 slice 3)", () => {
  assert.equal(whyALoadedSkillCouldLeaveTheCheckout(CHECKOUT, CLEAN), undefined)
  assert.equal(whyALoadedSkillCouldLeaveTheCheckout(`${CHECKOUT}/`, CLEAN), undefined, 'a checkout spelled with a trailing separator')
})

/** Mars's plants on the plan r=2 and r=3, each made mid-session after the owner approved the checkout, with the entry the refusal names. */
const PLANTS: ReadonlyArray<{ readonly what: string; readonly entry: AnEntryUnderASkillRoot; readonly named: string }> = [
  { what: 'a skill folder linked outside (R4)', entry: { kind: 'link', path: join(SKILL, '..', 'y'), leads_to: OUTSIDE }, named: `${join(SKILL, '..', 'y')} is a link to ${OUTSIDE}` },
  { what: 'a SKILL.md linked outside (R4)', entry: { kind: 'link', path: join(SKILL, 'SKILL.md'), leads_to: join(OUTSIDE, 'id') }, named: `${join(SKILL, 'SKILL.md')} is a link to ${join(OUTSIDE, 'id')}` },
  { what: "Mars's guide.txt linked outside (R4)", entry: { kind: 'link', path: join(SKILL, 'guide.txt'), leads_to: join(OUTSIDE, 'id') }, named: `${join(SKILL, 'guide.txt')} is a link to` },
  { what: 'a link into a sibling folder whose name starts like the checkout (R4)', entry: { kind: 'link', path: join(SKILL, 'next'), leads_to: SIBLING }, named: `${join(SKILL, 'next')} is a link to ${SIBLING}` },
  { what: 'a link whose target cannot be told (R4)', entry: { kind: 'link', path: join(SKILL, 'gone'), leads_to: undefined }, named: `${join(SKILL, 'gone')} is a link to a place that cannot be told` },
  { what: 'a hard-linked SKILL.md (R4a)', entry: { kind: 'file', path: join(SKILL, 'SKILL.md'), hard_links: 2 }, named: `${join(SKILL, 'SKILL.md')} has 2 hard links` },
  { what: 'a hard-linked guide.txt (R4a)', entry: { kind: 'file', path: join(SKILL, 'guide.txt'), hard_links: 3 }, named: `${join(SKILL, 'guide.txt')} has 3 hard links` },
]

test('anything under the skill roots that reaches outside the checkout, by a link or a hard link, is refused by its name (martha#614 slice 3, mutants: the link check, the unknown target, the bare prefix, the link count)', () => {
  for (const { what, entry, named } of PLANTS) {
    const why = whyALoadedSkillCouldLeaveTheCheckout(CHECKOUT, [...CLEAN, entry])
    assert.ok(why?.startsWith(named), `${what}: ${why ?? 'nothing refused'}`)
  }
})

test('the first entry that reaches outside is the one named, so the owner reads the place to look first (martha#614 slice 3)', () => {
  const [first, second] = PLANTS
  assert.ok(first !== undefined && second !== undefined)
  assert.ok(whyALoadedSkillCouldLeaveTheCheckout(CHECKOUT, [first.entry, second.entry])?.startsWith(first.named))
})
