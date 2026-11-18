// Run the check: node src/check_the_workspace_matches_its_layout/main.ts [--workspace <dir>] [--self-test]
//
// Exit 0 looked, and the workspace matches the layout its crew declared; 1 one line per drift, then a summary that
// names this check; 2 the check could not be made. A crew that declared no layout has nothing to check, and that is
// said out loud and answered with 0: a place the crew did not declare is not checked (martha#562).
//
// `--workspace` names the directory the crew declared from, which holds `.martha/martha.json`; it is the working
// directory when it is not given. `--self-test` is the proof the check bites where CI runs it, the way
// ../check_nothing_private_gets_in's is: this repository declares no layout, so a plain run there always takes the
// nothing-declared answer, and a job that only made that run would be green by construction.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { CLAUDE_CODE_MODELS } from '../claude_code_host/claude_code_host.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, declareCrew } from '../declare_crew/declare_crew.ts'
import { theWorkspaceTheCrewDeclared } from '../guard_workspace/guard_workspace.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theDriftInTheWorkspace } from './check_the_workspace_matches_its_layout.ts'

const NAME = 'check_the_workspace_matches_its_layout'

/** The value of `name` in the arguments, or undefined when it was not given. */
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** The line a run says when the crew declared no layout: said, not silent, so a green run is a named answer. */
const nothingDeclared = (): number => {
  console.error(`${NAME}: no crew declared a workspace layout, so there is nothing to check`)
  return 0
}

/** Every drift as its line, and the summary that carries this check's name: 1 when there is any, 0 when there is none. */
function reportFindings(lines: readonly string[]): number {
  for (const line of lines) console.error(line)
  console.error(`${NAME}: ${lines.length === 0 ? 'the workspace matches its layout' : `${String(lines.length)} line(s) above: the workspace drifts from its layout`}`)
  return lines.length === 0 ? 0 : 1
}

/** The gate over a directory: the crew's declaration read as the launcher reads it, and the scan over what it declared. */
async function theGate(root: string): Promise<number> {
  if (!existsSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE))) return nothingDeclared()
  const documents = { read: async (path: string): Promise<string> => readFileSync(path, 'utf8') }
  const workspace = theWorkspaceTheCrewDeclared(await declareCrew(documents, root, CLAUDE_CODE_MODELS))
  if (workspace === undefined) return nothingDeclared()
  const lines = await theDriftInTheWorkspace({ files: thisMachine.stores.files, processes: thisMachine.processes, workspace })
  return reportFindings(lines)
}

/** The git a planted workspace is built with, its own identity so nothing of the runner's is read. */
const gitIn = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', ['-c', 'user.name=the self-test', '-c', 'user.email=selftest@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

/** A bare origin with one commit on `main`, a clone of it under `<root>/clones/acme/widget`, and the worktree place
 * beside them: the shape a crew's places hold, planted from nothing so the self-test reads plantings of its own. */
function plantAWorkspace(root: string): { readonly workspace: { clones: string; worktrees: string; members: readonly string[] }; readonly clone: string } {
  const origin = join(root, 'origin.git')
  const clones = join(root, 'clones')
  const worktrees = join(root, 'worktrees')
  const seed = join(root, 'seed')
  mkdirSync(join(clones, 'acme'), { recursive: true })
  mkdirSync(worktrees)
  mkdirSync(seed)
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  gitIn(seed, 'add', '-A')
  gitIn(seed, 'commit', '--quiet', '-m', 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  gitIn(clones, 'clone', '--quiet', origin, join('acme', 'widget'))
  const clone = join(clones, 'acme', 'widget')
  // What a fresh clone records of the branch its origin starts on: without it the scan names the clone for that instead.
  gitIn(clone, 'remote', 'set-head', 'origin', '--auto')
  return { workspace: { clones, worktrees, members: ['self-test'] }, clone }
}

/** Live proof that the check bites: a planted drift is named at its own path, and a planted workspace that matches its
 * layout names nothing, so a check that always complains fails here as surely as one that never does. */
async function selfTest(): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), 'martha-562-selftest-'))
  try {
    const planted = plantAWorkspace(root)
    const clean = await theDriftInTheWorkspace({ files: thisMachine.stores.files, processes: thisMachine.processes, workspace: planted.workspace })
    gitIn(planted.clone, 'checkout', '--quiet', '-b', 'a-branch')
    const drifted = await theDriftInTheWorkspace({ files: thisMachine.stores.files, processes: thisMachine.processes, workspace: planted.workspace })
    const wanted = `${planted.clone} is on a-branch, and a clone stays on main: a branch's work belongs in a worktree.`
    const failures = [
      ...(clean.length === 0 ? [] : [`a workspace that matches its layout named ${String(clean.length)} line(s)`]),
      ...(drifted.length === 1 && drifted[0] === wanted ? [] : [`the planted clone off its branch was not named: ${drifted.join(' | ')}`]),
    ]
    for (const failure of failures) console.error(`does not bite: ${failure}`)
    console.log(`${NAME}: ${failures.length === 0 ? 'the check bites' : 'self-test failed'}`)
    return failures.length === 0 ? 0 : 1
  } finally {
    removeTheTree(root)
  }
}

const main = async (): Promise<number> =>
  process.argv.includes('--self-test') ? selfTest() : theGate(option('--workspace') ?? process.cwd())

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`${NAME}: could not be made: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  },
)
