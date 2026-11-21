// `martha init`: declare a solo crew of two in a project that has none (martha#98).
//
// This exists so a stranger gets a crew without writing its declaration by hand: a builder and a reviewer, and
// the owner, who may do every act. The declaration's shape is the reader's (../declare_crew, soloDeclaration), and
// the file is read back through the reader before init says it is done, so init can never leave a declaration the
// crew would refuse.
//
// It never writes over a declaration: the file is created only when it does not exist (O_EXCL), so one the
// owner wrote, or one a pull brought in, is left as it was and named. Each member's node id is made here too,
// in Martha's state outside the checkout (../keep_martha_state_outside_the_checkout), never typed by the owner.
//
// It declares the crew's workspace layout too, when the checkout can prove one (martha#611): a member's
// `worktree_open` refuses a crew that names no layout (../open_and_finish_a_worktree), so a declaration with none
// would leave the owner editing `house_rules` by hand before the crew can do anything with a worktree. What a
// checkout proves is the core's answer (../declare_crew, workspaceLayoutOf); this slice reads git where it is read.

import fs from 'node:fs'
import { join } from 'node:path'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import {
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DeclarationRefused,
  declareCrew,
  soloDeclaration,
  workspaceLayoutOf,
  type CrewSettings,
  type ModelVocabulary,
} from '../declare_crew/declare_crew.ts'
import { nodeIdsFor, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { repoOfTheCheckout } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { CONFINEMENT_THAT_INIT_WRITES, theConfinementInitLeftOut, type AConfinement } from '../declare_crew/the_crews_confinement.ts'
import { aUserManagerListensIn } from '../confine_a_member/the_systemd_only_bus.ts'

export interface SoloCrewRequest {
  /** The project's absolute path. */
  readonly root: string
  /** The owner's name, as git knows it; null when git has none. */
  readonly owner: string | null
  /** The origin URL git reports in the checkout, as `git remote get-url origin` says it; null when it names none. */
  readonly origin: string | null
  readonly state: MarthaState
  readonly documents: DocumentStore
  /** The models the host runs (martha#315), as its adapter records them: what the declaration is read back against. */
  readonly models: ModelVocabulary
  /**
   * The host this install starts a member on (martha#541, #547): the crew-level `host` init writes. The Claude Code
   * plugin's init names Claude Code; the standalone install's names the engine, from its own recording.
   */
  readonly host: string
  /**
   * The launcher's `$XDG_RUNTIME_DIR`, or undefined when unset (martha#989): init declares crew-code's confinement only
   * when a user manager listens under it, since a declared ceiling no manager can hold refuses every member's start.
   */
  readonly runtime_dir: string | undefined
}

export type SoloCrewDeclared =
  | {
      readonly declared: true
      readonly settings: CrewSettings
      readonly declaration: string
      readonly workspace: string
      /** The line that says no confinement was declared and which block to add, or undefined when one was. */
      readonly confinement_left_out: string | undefined
    }
  | { readonly declared: false; readonly refusal: string }

export const NO_OWNER =
  'Martha needs your name as the crew\'s owner and git has none. Set it with git config user.name "Your Name", then run martha init again.'

/** Makes the declaration's directory when missing; why it may not hold one (not a directory), or undefined. A
 * directory that is a link is followed: the owner cut that refusal (martha#601), so what it points at is where the
 * crew is declared. */
export function declarationDirectory(directory: string): string | undefined {
  const found = fs.statSync(directory, { throwIfNoEntry: false })
  if (found === undefined) {
    fs.mkdirSync(directory)
    return undefined
  }
  return found.isDirectory() ? undefined : `${directory} is not a directory, so Martha cannot declare a crew in it.`
}

/** Writes the declaration, failing when one is there; why not, or undefined. */
export function writeOnce(path: string, text: string): string | undefined {
  try {
    fs.writeFileSync(path, text, { flag: 'wx' })
    return undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return `${path} already exists, and martha init never writes over a declaration.`
    return `${path} could not be written (${code ?? String(error)}).`
  }
}

/** Declares a solo crew of two at `root`, never over an existing declaration, and makes each member's node id. */
export async function declareSoloCrew(request: SoloCrewRequest): Promise<SoloCrewDeclared> {
  const owner = request.owner?.trim() ?? ''
  if (owner === '') return { declared: false, refusal: NO_OWNER }
  const workspace = workspaceLayoutOf(fs.realpathSync(request.root), repoOfTheCheckout(request.origin), request.origin)
  const directory = join(request.root, DECLARATION_DIRECTORY), declaration = join(directory, DECLARATION_FILE)
  const unmade = declarationDirectory(directory)
  if (unmade !== undefined) return { declared: false, refusal: unmade }
  const confined = theConfinementInitDeclares(request.runtime_dir, declaration)
  const unwritten = writeOnce(declaration, `${JSON.stringify(soloDeclaration(owner, workspace.layout, request.host, confined.confinement), null, 2)}\n`)
  if (unwritten !== undefined) return { declared: false, refusal: unwritten }

  let settings: CrewSettings
  try {
    settings = await declareCrew(request.documents, request.root, request.models)
  } catch (error) {
    if (error instanceof DeclarationRefused) return { declared: false, refusal: error.message }
    throw error
  }
  const ids = nodeIdsFor(request.state, settings.members.map((member) => member.name))
  if ('refusal' in ids) return { declared: false, refusal: ids.refusal }
  return { declared: true, settings, declaration, workspace: workspace.said, confinement_left_out: confined.left_out }
}

/**
 * crew-code's confinement when a user manager listens under `runtime_dir` to hold it; else none, with the line that
 * says so and names the block to add to `declaration` (martha#989).
 */
function theConfinementInitDeclares(runtime_dir: string | undefined, declaration: string): { readonly confinement: AConfinement | null; readonly left_out: string | undefined } {
  const holds = runtime_dir !== undefined && runtime_dir !== '' && aUserManagerListensIn(runtime_dir)
  return holds ? { confinement: CONFINEMENT_THAT_INIT_WRITES, left_out: undefined } : { confinement: null, left_out: theConfinementInitLeftOut(declaration) }
}
