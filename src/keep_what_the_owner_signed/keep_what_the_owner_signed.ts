// What the owner signed for one project, kept in Martha's state directory, outside the checkout (martha#129,
// "How the list is signed and pinned"): the owner's hardware keys, the newest epoch each signed document was
// opened at, and the command shapes the owner signed, as the signed bytes and their signature.
//
// The owner pins a key and keeps a list with acts of their own (`martha pin-key`, `martha keep-shapes`), which
// need the owner's terminal; the launcher opens the kept list from the signed bytes on every run. The document is
// bound to this project: its `crew` is the project's name in the state root (the sha256 of the checkout's real
// path), so a list signed for one checkout opens empty in another.
//
// The epochs persist across processes (EpochStore's rule): a file that is there and does not parse is refused
// whole, so no open succeeds on it, never read as "nothing opened yet".
//
// The residual is the state directory's own: a member runs as the owner's OS user and can write here
// (martha#1 decision 2; ../keep_martha_state_outside_the_checkout).

import { basename, join } from 'node:path'

import {
  appendStateLine,
  hasExactly,
  isRecord,
  keepStateFile,
  readStateFile,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { openCommandShapes, type OpenedCommandShapes } from '../keep_the_shell_for_an_owner_signed_command/command_shapes.ts'
import { parseSshPublicKey, SK_ED25519 } from '../trust_only_signed_lists/ssh_signature.ts'
import type { EpochStore, OpenedEpoch, SignedListKind } from '../trust_only_signed_lists/trust_only_signed_lists.ts'

/** The owner's pinned public keys, one `{ "key": <OpenSSH line> }` per line. */
export const OWNER_KEYS_FILE = 'owner_keys.jsonl'
/** The newest epoch each signed document was opened at. */
export const EPOCHS_FILE = 'epochs.json'
/** The command shapes the owner signed, as signed, and the signature beside it. */
export const COMMAND_SHAPES_FILE = 'command_shapes.json'
export const SIGNATURE_SUFFIX = '.sig'

type Refused = { readonly refusal: string }

/** The name a signed document for this project names as its crew. */
export const projectOf = (state: MarthaState): string => basename(state.directory)

/** Pins one more of the owner's keys: a hardware key, not pinned before; or why it is not pinned. */
export function pinOwnerKey(state: MarthaState, line: string): Refused | undefined {
  const key = parseSshPublicKey(line.trim())
  if (key === undefined) return { refusal: 'that is not an OpenSSH public key line' }
  if (key.type !== SK_ED25519) return { refusal: `that is a ${key.type} key; Martha pins only a hardware key (${SK_ED25519})` }
  const pinned = pinnedOwnerKeys(state)
  if ('refusal' in pinned) return pinned
  if (pinned.keys.some((kept) => parseSshPublicKey(kept)?.blob.equals(key.blob) === true)) return { refusal: 'that key is pinned already' }
  return appendStateLine(join(state.directory, OWNER_KEYS_FILE), JSON.stringify({ key: line.trim() }), 'pinned key')
}

/** The owner's pinned keys, as OpenSSH lines; or why the file is not trusted. */
export function pinnedOwnerKeys(state: MarthaState): { readonly keys: readonly string[] } | Refused {
  const path = join(state.directory, OWNER_KEYS_FILE)
  const read = readStateFile(path)
  if ('refusal' in read) return read
  const keys = read.text
    .split('\n')
    .filter((line) => line !== '')
    .map(keyLineOf)
  const bad = keys.indexOf(undefined)
  if (bad !== -1) return { refusal: `${path} line ${bad + 1} is not a pinned key, so Martha reads none of it.` }
  return { keys: keys as string[] }
}

function keyLineOf(line: string): string | undefined {
  const value = parsedOrUndefined(line)
  return isRecord(value) && hasExactly(value, ['key']) && typeof value['key'] === 'string' ? value['key'] : undefined
}

function parsedOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

type Epochs = Record<string, Record<string, OpenedEpoch>>

const isOpenedEpoch = (value: unknown): value is OpenedEpoch =>
  isRecord(value) && hasExactly(value, ['epoch', 'digest']) && Number.isSafeInteger(value['epoch']) && typeof value['digest'] === 'string'

const isEpochs = (value: unknown): value is Epochs =>
  isRecord(value) && Object.values(value).every((kinds) => isRecord(kinds) && Object.values(kinds).every(isOpenedEpoch))

/** Every epoch kept; throws when the file is there and is not one, so nothing opens on it. */
function epochsOf(state: MarthaState): Epochs {
  const path = join(state.directory, EPOCHS_FILE)
  const read = readStateFile(path)
  if ('refusal' in read) throw new Error(read.refusal)
  if (read.text === '') return {}
  const value = parsedOrUndefined(read.text)
  if (!isEpochs(value)) throw new Error(`${path} does not hold the epochs Martha keeps, so no signed list opens on it.`)
  return value
}

/** The newest epoch per crew and kind, kept in the project's state directory across processes. */
export function epochsKeptIn(state: MarthaState): EpochStore {
  return {
    newest: (crew: string, kind: SignedListKind) => epochsOf(state)[crew]?.[kind],
    keep: (crew: string, kind: SignedListKind, opened: OpenedEpoch) => {
      const epochs = epochsOf(state)
      keepStateFile(state, EPOCHS_FILE, `${JSON.stringify({ ...epochs, [crew]: { ...epochs[crew], [kind]: opened } })}\n`)
    },
  }
}

/** The signed list given, opened with the pinned keys; kept as the project's list only when it opens trusted. */
export function keepCommandShapes(state: MarthaState, document: Buffer, signature: string, now: Date): OpenedCommandShapes {
  const opened = openWith(state, document, signature, now)
  if (!opened.trusted) return opened
  keepStateFile(state, COMMAND_SHAPES_FILE, document.toString('utf8'))
  keepStateFile(state, `${COMMAND_SHAPES_FILE}${SIGNATURE_SUFFIX}`, signature)
  return opened
}

/** The project's kept list, opened from the signed bytes; no shape when anything does not hold. */
export function openKeptCommandShapes(state: MarthaState, now: Date): OpenedCommandShapes {
  const document = readStateFile(join(state.directory, COMMAND_SHAPES_FILE))
  const signature = readStateFile(join(state.directory, `${COMMAND_SHAPES_FILE}${SIGNATURE_SUFFIX}`))
  if ('refusal' in document) return nothingOpened(document.refusal)
  if ('refusal' in signature) return nothingOpened(signature.refusal)
  return openWith(state, document.text === '' ? undefined : Buffer.from(document.text, 'utf8'), signature.text === '' ? undefined : signature.text, now)
}

const nothingOpened = (why: string): OpenedCommandShapes => ({ trusted: false, why, base: undefined, shapes: [] })

function openWith(state: MarthaState, document: Buffer | undefined, signature: string | undefined, now: Date): OpenedCommandShapes {
  const pinned = pinnedOwnerKeys(state)
  if ('refusal' in pinned) return nothingOpened(pinned.refusal)
  try {
    return openCommandShapes({ document, signature, pinned_keys: pinned.keys, crew: projectOf(state), now, epochs: epochsKeptIn(state) })
  } catch (error) {
    return nothingOpened(error instanceof Error ? error.message : String(error))
  }
}
