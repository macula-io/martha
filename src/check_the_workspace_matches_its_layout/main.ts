// Run the check: node src/check_the_workspace_matches_its_layout/main.ts <clones> <worktrees> [declaration.json]
//
// One line per drift in the crew's places, and exit 1 when there is one, so it stands as a check that fails by name.
// Exit 0 when the places match the layout, 2 when it was not given the places it reads. It never passes because it
// could not look: a place it cannot read shows as no clones in it, and the line it prints says how many it saw.

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

import type { FileTree, Processes } from '../host_contract/host_contract.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { theDriftInTheWorkspace } from './check_the_workspace_matches_its_layout.ts'

const NAME = 'check_the_workspace_matches_its_layout'

/** The tree read by name: what a check needs is the names in a directory, never the files. */
const treeReadByNames: Pick<FileTree, 'childrenOf'> = {
  childrenOf: (path) => {
    try {
      return readdirSync(path)
    } catch {
      return []
    }
  },
}

/** git run and waited for here, with the words it printed and the status it ended with. */
const processesRunHere: Pick<Processes, 'run'> = {
  run: async (request) => {
    const ended = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
    return { exit_code: ended.error === undefined ? ended.status : null, stdout: ended.stdout ?? '', stderr: ended.stderr ?? '' }
  },
}

/** The members a declaration names, read from the file the run was given as its third argument: none when unreadable. */
function theMembersDeclared(path: string | undefined): readonly string[] {
  if (path === undefined) return []
  try {
    const declared = JSON.parse(readFileSync(path, 'utf8')) as { members?: { name?: string }[] }
    return (declared.members ?? []).flatMap((member) => (member.name === undefined ? [] : [member.name]))
  } catch {
    return []
  }
}

/** The places the run was given, or the refusal, in the words the check uses. */
function thePlacesGiven(argv: readonly string[]): { readonly clones: string; readonly worktrees: string } {
  const [clones, worktrees] = argv.slice(2)
  if (clones === undefined || worktrees === undefined) {
    console.error(`${NAME}: give the crew's clone place and worktree place: main.ts <clones> <worktrees> [declaration.json]`)
    process.exit(2)
  }
  return { clones, worktrees }
}

const places = thePlacesGiven(process.argv)
const workspace: TheWorkspace = { ...places, members: theMembersDeclared(process.argv[4]) }
const drift = await theDriftInTheWorkspace({ files: treeReadByNames, processes: processesRunHere, workspace })
for (const line of drift) console.log(`${NAME}: ${line}`)
console.log(`${NAME}: ${drift.length === 0 ? 'the places match the layout this crew declared' : `${String(drift.length)} line(s) of drift`}`)
process.exit(drift.length === 0 ? 0 : 1)
