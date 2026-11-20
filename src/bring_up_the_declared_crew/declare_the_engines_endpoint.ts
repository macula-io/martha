// The engine's endpoint, declared by `martha up` when an engine member is to start and the crew names none (martha#511
// part B, the Supervisor's ruling (c) under the owner's "no buts"): the owner need not look up the provider's URL.
//
// The provider's URL ships as data (./the_engines_endpoint.json). Where the key is read from is the owner's own: the
// provider's documented variable when it is set, else the file the owner names when asked, once, at the terminal
// `martha up` runs on. The key itself is never written in the declaration, never read here beyond the
// check the engine's start makes of the file, and never said back: an answer that is no path may be a pasted key.
//
// Threat model. (1) The key landing in the declaration, which may be shared or committed: only a variable's name or a
// file's path is written, and an answer that is not a key file's path is refused without being repeated. (2) A key
// file other accounts can read, or a link whose own mode says nothing of its target: refused by the same check the
// engine's start applies before it reads a key. (3) A declaration changed under this write: the guarded writer writes
// only while the file holds the bytes this read. (4) Asked off the owner's terminal: `martha up` refuses first.

import { join } from 'node:path'

import { DECLARATION_DIRECTORY, DECLARATION_FILE, ENGINE_ENDPOINT, isAKeyFilesPath } from '../declare_crew/declare_crew.ts'
import type { DocumentStore } from '../host_contract/host_contract.ts'
import { writeAChangedDeclaration } from '../declare_a_solo_crew/write_a_changed_declaration.ts'
import { THE_ENGINES_ENDPOINT, THE_KEY_FILE_QUESTION } from './bring_up_the_declared_crew.ts'

export interface EndpointRequest {
  readonly root: string
  /** The owner's home, a typed path under `~/` is written out against. */
  readonly home: string
  readonly documents: DocumentStore
  /** The environment `martha up` runs in, where the provider's key variable may be set. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Asks the owner at their terminal, and resolves to the answer. */
  readonly ask: (question: string) => Promise<string>
  /** Why the file at a key file's path is no key file of the owner's alone, or undefined when it is one. */
  readonly whyNotTheOwnersKeyFile: (key_file: string) => string | undefined
}

/** Where the key is read from: the provider's variable, or a file the owner named. */
type TheKeysPlace = { readonly key_from: string } | { readonly key_file: string }

/**
 * What a typed key file's path opens with when it is under the owner's home. The declaration takes absolute paths
 * only, so the path is written out against the home here, in the adapter, before it is checked or written.
 */
export const THE_HOMES_PREFIX = '~/'

/** An owner's typed path, with a leading `~/` written out against `home`. */
const writtenOut = (typed: string, home: string): string => (typed.startsWith(THE_HOMES_PREFIX) ? join(home, typed.slice(THE_HOMES_PREFIX.length)) : typed)

/** An answer refused before it is checked as a file: it is not repeated, since it may be the key itself. */
export const NOT_A_KEY_FILES_PATH = `that is not an absolute path or one under ${THE_HOMES_PREFIX}, so nothing was written. Name the file your key is in, never the key.`

/** The provider's variable when it holds a key, else the file the owner names when asked; or why not. */
async function theKeysPlace(request: EndpointRequest): Promise<TheKeysPlace | { readonly refusal: string }> {
  const variable = THE_ENGINES_ENDPOINT.key_variable
  if ((request.env[variable] ?? '') !== '') return { key_from: variable }
  const answer = writtenOut((await request.ask(THE_KEY_FILE_QUESTION)).trim(), request.home)
  if (!isAKeyFilesPath(answer)) return { refusal: NOT_A_KEY_FILES_PATH }
  const why = request.whyNotTheOwnersKeyFile(answer)
  return why === undefined ? { key_file: answer } : { refusal: `${why}, so nothing was written` }
}

/** The engine's endpoint written into the declaration at `root`, and the line that tells the owner; or why not. */
export async function declareTheEnginesEndpoint(request: EndpointRequest): Promise<{ readonly told: string } | { readonly refusal: string }> {
  const place = await theKeysPlace(request)
  if ('refusal' in place) return place
  const declaration = join(request.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const before = await request.documents.read(declaration).catch(() => undefined)
  if (before === undefined) return { refusal: `${declaration} could not be read, so ${ENGINE_ENDPOINT} was not written.` }
  const endpoint = { host: THE_ENGINES_ENDPOINT.host, ...place }
  const after = `${JSON.stringify({ ...(JSON.parse(before) as Record<string, unknown>), [ENGINE_ENDPOINT]: endpoint }, null, 2)}\n`
  const unwritten = writeAChangedDeclaration(request.root, { before, after })
  if (unwritten !== undefined) return { refusal: unwritten }
  const from = 'key_from' in place ? `the variable ${place.key_from}` : `the file ${place.key_file}`
  return { told: `${ENGINE_ENDPOINT} written into ${declaration}: the engine reaches ${endpoint.host}, with the key read from ${from}, never kept in the declaration.` }
}
