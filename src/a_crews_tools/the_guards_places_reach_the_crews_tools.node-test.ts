// The workspace guard's three places reach the crew's tools as they were handed in (martha#562 merge round).
//
// The guard asks through the crew's tools at all three seams: the relay's tool_called (seam a), the shim on the
// member's PATH (seam b) and the clone's reference transaction (seam c). Each place is handed to crewToolsOver, and
// every guard test downstream builds its own CrewTools, so nothing joined the two. The merge made seam a's
// refusesTheGitIn optional, like seams b and c, so the compiler no longer notices a launch's tools that drop the
// handed place either. With crewToolsOver answering "nothing refused" on any one seam, every test still passed. This
// file holds each seam to the place it was handed: the call reaches that place unchanged, and its refusal comes back
// word for word.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { crewToolsOver, type CrewToolPlaces, type CrewTools } from './a_crews_tools.ts'

type TheGuardsPlaces = Pick<CrewToolPlaces, 'refusesTheGitCall' | 'refusesTheGitOnThePath' | 'refusesTheRefUpdate'>

/** The crew's tools over a place of the test's own, which it removes, handed `guard`'s places. */
function crewHanded(t: TestContext, guard: TheGuardsPlaces): CrewTools {
  const home = mkdtempSync(join(tmpdir(), 'martha-562-guard-places-'))
  t.after(() => removeTheTree(home))
  return crewToolsOver({
    member: 'Hygiea',
    ledger: { clock: { now: () => 1_000 }, stores: { rows: rowStreamsDirectory(join(home, 'row-streams')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root: home,
    documents: { read: async () => '{}' },
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-files')) },
    ...guard,
  })
}

const A_SHELL_CALL = { tool: 'Bash', input: { command: 'git push origin --delete uranus/9' } }
const A_SHIM_CALL = { directory: '/work/clone', args: ['push', 'origin', '--delete', 'uranus/9'] }
const A_REF_UPDATE = [{ ref: 'refs/heads/uranus/9', deletes: true }]

test("seam a: the shell's git call reaches the place the launch handed, and its refusal comes back", async (t) => {
  const asked: unknown[] = []
  const crew = crewHanded(t, {
    refusesTheGitCall: async (call) => {
      asked.push(call)
      return 'seam a refuses uranus/9'
    },
  })
  assert.equal(await crew.refusesTheGitIn?.(A_SHELL_CALL), 'seam a refuses uranus/9')
  assert.deepEqual(asked, [A_SHELL_CALL])
})

test("seam b: the shim's git call reaches the place the launch handed, and its refusal comes back", async (t) => {
  const asked: unknown[] = []
  const crew = crewHanded(t, {
    refusesTheGitOnThePath: async (call) => {
      asked.push(call)
      return 'seam b refuses uranus/9'
    },
  })
  assert.equal(await crew.refusesTheGitOnThePath?.(A_SHIM_CALL), 'seam b refuses uranus/9')
  assert.deepEqual(asked, [A_SHIM_CALL])
})

test("seam c: the clone's ref transaction reaches the place the launch handed, and its refusal comes back", async (t) => {
  const asked: unknown[] = []
  const crew = crewHanded(t, {
    refusesTheRefUpdate: (updates) => {
      asked.push(updates)
      return 'seam c refuses uranus/9'
    },
  })
  assert.equal(crew.refusesTheRefUpdate?.(A_REF_UPDATE), 'seam c refuses uranus/9')
  assert.deepEqual(asked, [A_REF_UPDATE])
})

// "Refuses nothing" is measured on the answer the crew's own seam gives, so each seam must be there to answer: a
// crew whose tools dropped a seam would also read as undefined through `?.`, and pass for the wrong reason.
test('a launch that handed no guard still answers at every seam, and refuses nothing', async (t) => {
  const crew = crewHanded(t, {})
  assert.equal(typeof crew.refusesTheGitIn, 'function', 'seam a is answered by the crew itself')
  assert.equal(typeof crew.refusesTheGitOnThePath, 'function', 'seam b is answered by the crew itself')
  assert.equal(typeof crew.refusesTheRefUpdate, 'function', 'seam c is answered by the crew itself')
  assert.equal(await crew.refusesTheGitIn?.(A_SHELL_CALL), undefined)
  assert.equal(await crew.refusesTheGitOnThePath?.(A_SHIM_CALL), undefined)
  assert.equal(crew.refusesTheRefUpdate?.(A_REF_UPDATE), undefined)
})
