// `martha init`: declare a solo crew of two in a project that has none (martha#98).
//
// This exists so a stranger gets a crew without writing its declaration by hand: a builder and a reviewer, and
// the owner, who may do every act. It is written in the shape declareCrew reads (../declare_crew) and read back
// through it before init says it is done, so init can never leave a declaration the crew would refuse.
//
// It declares only in a real directory of the checkout: a declaration directory that is a link is refused by name,
// so a checkout cannot point init at a place outside it.
//
// It never writes over a declaration: the file is created only when it does not exist (O_EXCL), so one the
// owner wrote, or one a pull brought in, is left as it was and named. Each member's node id is made here too,
// in Martha's state outside the checkout (../keep_martha_state_outside_the_checkout), never typed by the owner.

import fs from 'node:fs'
import { join } from 'node:path'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import {
  ACTS,
  CHANNEL_READ_SECONDS_WHEN_UNNAMED,
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  DeclarationRefused,
  declareCrew,
  OWNER,
  type CrewSettings,
} from '../declare_crew/declare_crew.ts'
import { nodeIdsFor, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The mode a solo crew is declared in: a name for people to read. */
export const SOLO_MODE = 'solo'

/** The members of a solo crew, each in the role it is named after. */
export const SOLO_MEMBERS = [
  { name: 'builder', role: 'builder' },
  { name: 'reviewer', role: 'reviewer' },
] as const

/**
 * A solo crew's declaration: the owner may do every act, and how often its sessions read the crew channel
 * (martha#253) is the one value this slice writes and the reader reads a missing field as (../declare_crew,
 * martha#374), so init and the reader cannot drift apart.
 */
export function soloDeclaration(owner: string) {
  return {
    version: DECLARATION_VERSION,
    owner,
    members: SOLO_MEMBERS,
    mode: {
      name: SOLO_MODE,
      roles: SOLO_MEMBERS.map((member) => member.role),
      may: Object.fromEntries(ACTS.map((act) => [act, [OWNER]])),
    },
    channel_read_seconds: CHANNEL_READ_SECONDS_WHEN_UNNAMED,
  }
}

export interface SoloCrewRequest {
  /** The project's absolute path. */
  readonly root: string
  /** The owner's name, as git knows it; null when git has none. */
  readonly owner: string | null
  readonly state: MarthaState
  readonly documents: DocumentStore
  /** The models the host runs (martha#315), as its adapter records them: what the declaration is read back against. */
  readonly models: readonly string[]
}

export type SoloCrewDeclared =
  | { readonly declared: true; readonly settings: CrewSettings; readonly declaration: string }
  | { readonly declared: false; readonly refusal: string }

const NO_OWNER =
  'Martha needs your name as the crew\'s owner and git has none. Set it with git config user.name "Your Name", then run martha init again.'

/** Makes the declaration's directory when missing; why it may not hold one (a link, or not a directory), or undefined. */
function declarationDirectory(directory: string): string | undefined {
  const found = fs.lstatSync(directory, { throwIfNoEntry: false })
  if (found === undefined) {
    fs.mkdirSync(directory)
    return undefined
  }
  if (found.isSymbolicLink()) return `${directory} is a link, and martha init declares a crew only in a directory of the checkout's own.`
  return found.isDirectory() ? undefined : `${directory} is not a directory, so martha init cannot declare a crew in it.`
}

/** Writes the declaration, failing when one is there; why not, or undefined. */
function writeOnce(path: string, text: string): string | undefined {
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
  const directory = join(request.root, DECLARATION_DIRECTORY)
  const declaration = join(directory, DECLARATION_FILE)
  const unmade = declarationDirectory(directory)
  if (unmade !== undefined) return { declared: false, refusal: unmade }
  const unwritten = writeOnce(declaration, `${JSON.stringify(soloDeclaration(owner), null, 2)}\n`)
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
  return { declared: true, settings, declaration }
}
