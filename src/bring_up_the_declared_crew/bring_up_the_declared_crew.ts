// `martha up` (martha#511): the crew a workspace declares, brought up from its declaration alone.
//
// This exists so the owner types one command in their workspace, the folder that holds their clones and worktrees,
// and gets the whole crew the file names, on both hosts (DECIDED 2026-11-20, Raf: "`martha up` against this file should
// contain all info required to bring up the crew"). The declaration is the config: `up` writes no member into it and
// adds none back. It starts every member the file declares that is not parked and not already running, each on its own
// host and model; a member the owner parks stays down until the file says otherwise.
//
// The file is the owner's to write. With none, `up` refuses with one line naming where it goes and the smallest one
// the reader takes, rather than writing a crew of its own choosing.
//
// The workspace is not a git checkout, so the crew is the folder's own, keyed in Martha's state by its real path
// (../keep_martha_state_outside_the_checkout, crewKeyOf): every member started there reads one store and one channel.

import { readFileSync } from 'node:fs'

import { DECLARATION_VERSION, type Member } from '../declare_crew/declare_crew.ts'

/** The provider the engine's members reach when the crew declares no endpoint, as data (./the_engines_endpoint.json). */
export interface TheEnginesEndpoint {
  readonly provider: string
  readonly host: string
  readonly key_variable: string
}

/** Where the engine's members reach their model when the crew declares no endpoint (martha#511 part B, ruling (c)). */
export const THE_ENGINES_ENDPOINT: TheEnginesEndpoint = (
  JSON.parse(readFileSync(new URL('./the_engines_endpoint.json', import.meta.url), 'utf8')) as { readonly endpoint: TheEnginesEndpoint }
).endpoint

/** What `martha up` asks the owner, once, when the key's variable is unset: the file the key is in. */
export const THE_KEY_FILE_QUESTION = `Where is your ${THE_ENGINES_ENDPOINT.provider} key file? `

/** Whether `martha up` starts a declared member: every one the owner has not parked. Running ones are left as they are. */
export const upStarts = (member: Member): boolean => !member.parked

/**
 * The smallest declaration the reader takes (../declare_crew): one member, in a mode with one role, whose table names
 * no act and so leaves every act the owner's. The owner's name is theirs to write in.
 */
export const THE_SMALLEST_DECLARATION = {
  version: DECLARATION_VERSION,
  owner: '<your name>',
  mode: { name: 'team', roles: ['builder'], may: {} },
  members: [{ name: 'Builder', role: 'builder' }],
}

/** Why `martha up` starts nothing where no crew is declared: where the file goes, and the smallest one. */
export const noCrewDeclaredAt = (declaration: string): string =>
  `no crew is declared here: write ${declaration}, the smallest is ${JSON.stringify(THE_SMALLEST_DECLARATION)}`
