// `martha up` (martha#511): the declaration a workspace holds is the whole config. The smallest one the refusal shows is
// one the reader takes, a member's `parked` is read as written, and `up` starts exactly the members not parked.
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE, DeclarationRefused, declareCrewOnHosts, PARKED } from '../declare_crew/declare_crew.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { THE_VOCABULARIES_OF_HOST } from '../start_the_member_on_its_host/start_the_member_on_its_host.ts'
import { noCrewDeclaredAt, THE_SMALLEST_DECLARATION, upStarts } from './bring_up_the_declared_crew.ts'

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** A workspace under a temporary home, no git checkout, holding `declaration` as its file. */
function aWorkspaceDeclaring(t: TestContext, declaration: unknown): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-511-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'work')
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  writeFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), `${JSON.stringify(declaration, null, 2)}\n`)
  return root
}

const readAt = (root: string) => declareCrewOnHosts(documents, root, THE_VOCABULARIES_OF_HOST)

test('#511: the smallest declaration the refusal shows is one the reader takes, and up starts its one member', async (t) => {
  const settings = await readAt(aWorkspaceDeclaring(t, THE_SMALLEST_DECLARATION))
  assert.deepEqual(settings.members.filter(upStarts).map((member) => member.name), THE_SMALLEST_DECLARATION.members.map((member) => member.name))
})

test('#511: the refusal names the file where it goes and shows the smallest declaration whole, on one line', () => {
  const at = join('/a-workspace-a-test-names', DECLARATION_DIRECTORY, DECLARATION_FILE)
  const said = noCrewDeclaredAt(at)
  assert.ok(said.includes(at), said)
  assert.ok(said.includes(JSON.stringify(THE_SMALLEST_DECLARATION)), said)
  assert.equal(said.includes('\n'), false, said)
})

test('#511: up starts every member not parked; a member with no parked is not parked', async (t) => {
  const members = [
    { name: 'Lead', role: 'builder' },
    { name: 'Kept-down', role: 'builder', [PARKED]: true },
    { name: 'Said-up', role: 'builder', [PARKED]: false },
  ]
  const settings = await readAt(aWorkspaceDeclaring(t, { ...THE_SMALLEST_DECLARATION, members }))
  assert.deepEqual(settings.members.map((member) => [member.name, member.parked]), [['Lead', false], ['Kept-down', true], ['Said-up', false]])
  assert.deepEqual(settings.members.filter(upStarts).map((member) => member.name), ['Lead', 'Said-up'])
})

test('#511: a parked that is not true or false is refused by its field, never read as either', async (t) => {
  const root = aWorkspaceDeclaring(t, { ...THE_SMALLEST_DECLARATION, members: [{ name: 'Lead', role: 'builder', [PARKED]: 'yes' }] })
  await assert.rejects(readAt(root), (error: unknown) => error instanceof DeclarationRefused && error.message.includes(`members[0].${PARKED}`))
})
