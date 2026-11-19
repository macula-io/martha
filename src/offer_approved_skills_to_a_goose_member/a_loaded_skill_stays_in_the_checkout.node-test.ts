import assert from 'node:assert/strict'
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { FileTree } from '../host_contract/host_contract.ts'
import { filesOnThisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theEntriesUnderTheSkillRoots, whyALoadedSkillCouldLeaveTheCheckout, type AnEntryUnderASkillRoot } from './a_loaded_skill_stays_in_the_checkout.ts'

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

// --- the walk, on this machine's own files -------------------------------------------------------------------------

/** Two skill roots of this test's own naming, one of them below a folder of its own, as the recording names roots. */
const ROOTS = ['skills-root-a', join('nested-of-this-test', 'skills-root-b')] as const

/** A checkout holding a skill in each root and a link that stays inside, and a place outside it holding a secret; both real paths. */
function aCheckout(t: TestContext): { readonly checkout: string; readonly outside: string } {
  const made = [mkdtempSync(join(tmpdir(), 'martha-614-checkout-')), mkdtempSync(join(tmpdir(), 'martha-614-outside-'))]
  t.after(() => made.forEach((dir) => removeTheTree(dir)))
  const [checkout, outside] = made.map((dir) => realpathSync(dir)) as [string, string]
  for (const root of ROOTS) {
    mkdirSync(join(checkout, root, 'x'), { recursive: true })
    writeFileSync(join(checkout, root, 'x', 'SKILL.md'), 'the approved skill')
    writeFileSync(join(checkout, root, 'x', 'guide.txt'), 'its guide')
  }
  symlinkSync(join(checkout, ROOTS[0], 'x', 'guide.txt'), join(checkout, ROOTS[0], 'x', 'same.txt'))
  writeFileSync(join(outside, 'secret'), 'bytes from outside')
  mkdirSync(join(outside, 'y'))
  writeFileSync(join(outside, 'y', 'SKILL.md'), 'a skill from outside')
  return { checkout, outside }
}

const walked = (checkout: string): string | undefined => whyALoadedSkillCouldLeaveTheCheckout(checkout, theEntriesUnderTheSkillRoots(filesOnThisMachine, checkout, ROOTS))

test("the walk of an approved checkout's skill roots finds nothing that reaches outside it (martha#614 slice 3)", (t) => {
  const { checkout } = aCheckout(t)
  const entries = theEntriesUnderTheSkillRoots(filesOnThisMachine, checkout, ROOTS)
  assert.equal(whyALoadedSkillCouldLeaveTheCheckout(checkout, entries), undefined)
  assert.ok(entries.some((entry) => entry.path === join(checkout, ROOTS[1], 'x', 'guide.txt')), 'the walk reached below the second root')
  assert.ok(entries.some((entry) => entry.kind === 'link' && entry.path === join(checkout, ROOTS[0], 'x', 'same.txt')), 'the walk saw the link inside, without following it')
})

/** Mars's T7 plants, each made after the checkout was approved, and the path the refusal must name first. */
const MID_SESSION_PLANTS: ReadonlyArray<{ readonly what: string; readonly plant: (checkout: string, outside: string) => string }> = [
  { what: 'a skill folder linked outside', plant: (c, o) => { const at = join(c, ROOTS[0], 'y'); symlinkSync(join(o, 'y'), at); return `${at} is a link to ${join(o, 'y')}` } },
  { what: 'a SKILL.md linked outside', plant: (c, o) => { const at = join(c, ROOTS[1], 'x', 'SKILL.md'); rmSync(at); symlinkSync(join(o, 'secret'), at); return `${at} is a link to ${join(o, 'secret')}` } },
  { what: "Mars's guide.txt linked outside", plant: (c, o) => { const at = join(c, ROOTS[0], 'x', 'guide.txt'); rmSync(at); symlinkSync(join(o, 'secret'), at); return `${at} is a link to ${join(o, 'secret')}` } },
  { what: 'a folder above a root linked outside', plant: (c, o) => { const at = join(c, 'nested-of-this-test'); removeTheTree(at); symlinkSync(o, at); return `${at} is a link to ${o}` } },
  { what: 'a link spelled inside the checkout that leads outside through a second link', plant: (c, o) => { const hop = join(c, 'hop-of-this-test'); symlinkSync(o, hop); const at = join(c, ROOTS[0], 'x', 'via'); symlinkSync(join(hop, 'secret'), at); return `${at} is a link to ${join(o, 'secret')}` } },
  { what: 'a hard-linked SKILL.md (R4a)', plant: (c, o) => { const at = join(c, ROOTS[0], 'x', 'SKILL.md'); rmSync(at); linkSync(join(o, 'secret'), at); return `${at} has 2 hard links` } },
  { what: 'a hard-linked guide.txt (R4a)', plant: (c, o) => { const at = join(c, ROOTS[1], 'x', 'guide.txt'); rmSync(at); linkSync(join(o, 'secret'), at); return `${at} has 2 hard links` } },
]

test('a link or a hard link made under the skill roots after approval is refused by the path it stands at (martha#614 slice 3, T7, mutants: the walk follows links, a root\'s parents not walked, below a root not walked)', (t) => {
  for (const { what, plant } of MID_SESSION_PLANTS) {
    const { checkout, outside } = aCheckout(t)
    const named = plant(checkout, outside)
    const why = walked(checkout)
    assert.ok(why?.startsWith(named), `${what}: ${why ?? 'nothing refused'}`)
  }
})

test('a tree that cannot tell a file\'s hard links has every file refused, never read as one link (martha#614 slice 3)', (t) => {
  const { checkout } = aCheckout(t)
  const silent: FileTree = { ...filesOnThisMachine, kindOf: (path) => { const kind = filesOnThisMachine.kindOf(path); return kind.kind === 'file' ? { kind: 'file', ownerExecutes: kind.ownerExecutes } : kind } }
  const why = whyALoadedSkillCouldLeaveTheCheckout(checkout, theEntriesUnderTheSkillRoots(silent, checkout, ROOTS))
  assert.match(why ?? '', /has a count of hard links that cannot be told/)
})

test('something that is neither a file, a folder nor a link under a root is refused by its path (martha#614 slice 3)', (t) => {
  const { checkout } = aCheckout(t)
  const odd = join(checkout, ROOTS[0], 'x', 'pipe')
  const tree: FileTree = { ...filesOnThisMachine, kindOf: (path) => (path === odd ? { kind: 'other' } : filesOnThisMachine.kindOf(path)), childrenOf: (path) => [...filesOnThisMachine.childrenOf(path), ...(path === join(checkout, ROOTS[0], 'x') ? ['pipe'] : [])] }
  assert.ok(whyALoadedSkillCouldLeaveTheCheckout(checkout, theEntriesUnderTheSkillRoots(tree, checkout, ROOTS))?.startsWith(`${odd} is neither`))
})
