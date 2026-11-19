// Keeping a member's host transcripts after its launch ends (martha#646).
//
// The host writes the member's session under the member's own config folder, and that folder is a snapshot removed when
// the launch ends: a signal, the run's end or the ordinary end all remove it. This is the keep, called before that
// removal at each of the three, so what the member's session did is still readable after it has ended.
//
// It is synchronous on purpose: one of the three is a process `exit` handler, where nothing can be awaited. So it reads
// the folder, redacts and writes, bounded (../choose_the_transcripts_to_keep) by the launch's own bound, and prunes the
// launches past the newest TRANSCRIPTS_LAUNCHES_KEPT — a fraction of a second's work, waiting on no other process and
// no timer. What it could not keep is returned as one line each, so a caller can say it and the other removals go on.
//
// The place is the project's own state (../keep_martha_state_outside_the_checkout), made 0700, with every file 0600 and
// written whole under a staging name and renamed into place, as the own writes are. Another OS user is kept out; another
// member is not, and the design says so plainly: every member runs as the owner's OS user.

import fs from 'node:fs'
import { dirname, join } from 'node:path'

import {
  chooseTheTranscripts,
  HOST_PROJECTS_PLACE,
  THE_MARK_FILE,
  TRANSCRIPTS_FILE_BYTES_KEPT,
  TRANSCRIPTS_LAUNCHES_KEPT,
  theMarkOf,
  type AConfigFile,
} from '../choose_the_transcripts_to_keep/choose_the_transcripts_to_keep.ts'
import { openState, STATE_DIRECTORY_MODE, STATE_FILE_MODE, TRANSCRIPTS_PLACE, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { STAGING_PREFIX } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'

/** What one ended launch leaves to keep: where its folder is, under which project, and its own key. */
export interface WhatIsKept {
  readonly state_root: string
  /** The project whose state the transcripts are kept in: the checkout the member started in. */
  readonly project_root: string
  /** The member's own config folder, as the host wrote it. */
  readonly config_folder: string
  /** The launch's own name: one directory per launch, so no launch is overwritten by another. */
  readonly theLaunch: string
  /** The key this launch handed its member, redacted by its exact value wherever it was printed. */
  readonly theLaunchKey: string
}

/** The directory one launch's transcripts are kept under: never a path, and never a dot a person or git could steer with. */
const directoryOf = (place: string, theLaunch: string): string => join(place, encodeURIComponent(theLaunch).replaceAll('.', '%2E'))

/** Every file the member's config folder holds, as the host wrote them, with a file past its bound never read whole. */
const whatTheFolderHolds = (configFolder: string, fileBytesKept: number): readonly AConfigFile[] => {
  const projects = join(configFolder, HOST_PROJECTS_PLACE)
  let keys: string[]
  try {
    keys = fs.readdirSync(projects, { withFileTypes: true }).filter((one) => one.isDirectory()).map((one) => one.name)
  } catch {
    return []
  }
  const files: AConfigFile[] = []
  for (const key of keys) {
    let names: string[]
    try {
      names = fs.readdirSync(join(projects, key)).filter((name) => fs.lstatSync(join(projects, key, name), { throwIfNoEntry: false })?.isFile() === true)
    } catch {
      continue
    }
    for (const name of names) {
      const path = [HOST_PROJECTS_PLACE, key, name].join('/')
      let bytes = 0
      try {
        bytes = fs.statSync(join(projects, key, name)).size
      } catch {
        continue
      }
      const text = bytes > fileBytesKept ? undefined : readWhole(join(projects, key, name))
      files.push({ path, bytes, ...(text === undefined ? {} : { text }) })
    }
  }
  return files
}

/** A file's text, or undefined when it cannot be read: an unreadable transcript is not kept. */
const readWhole = (path: string): string | undefined => {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** `directory`, made mode 0700 if it is not there, with every directory above it under the same place. */
const aDirectoryOfOurs = (directory: string): void => {
  fs.mkdirSync(directory, { recursive: true, mode: STATE_DIRECTORY_MODE })
}

/** `text` written whole at `path`, mode 0600, under a staging name and renamed into place, so no reader sees half. */
const writtenWhole = (path: string, text: string): void => {
  aDirectoryOfOurs(dirname(path))
  const staging = join(dirname(path), `${STAGING_PREFIX}${process.pid}-${Date.now()}`)
  fs.writeFileSync(staging, text, { mode: STATE_FILE_MODE })
  fs.renameSync(staging, path)
}

/**
 * Keeps what the member's config folder held for this launch, and prunes the launches past the newest
 * TRANSCRIPTS_LAUNCHES_KEPT. Returns what could not be kept, one line each; a refusal of the state itself is one line.
 */
export function keepTheTranscriptsOf(what: WhatIsKept): readonly string[] {
  const state: MarthaState | { readonly refusal: string } = openState(what.state_root, what.project_root)
  if ('refusal' in state) return [state.refusal]
  const place = join(state.directory, TRANSCRIPTS_PLACE)
  const here = directoryOf(place, what.theLaunch)
  const chosen = chooseTheTranscripts({ files: whatTheFolderHolds(what.config_folder, TRANSCRIPTS_FILE_BYTES_KEPT), theLaunchKey: what.theLaunchKey })
  const trouble: string[] = []
  for (const kept of chosen.kept) {
    try {
      writtenWhole(join(here, ...kept.path.split('/')), kept.text)
    } catch (error) {
      trouble.push(`${kept.path} was not kept (${(error as NodeJS.ErrnoException).code ?? String(error)}).`)
    }
  }
  if (chosen.marked.length > 0) {
    try {
      writtenWhole(join(here, THE_MARK_FILE), theMarkOf(chosen.marked))
    } catch (error) {
      trouble.push(`the mark of the tokens found was not kept (${(error as NodeJS.ErrnoException).code ?? String(error)}).`)
    }
  }
  return trouble.concat(pruneTheLaunchesPastTheNewest(place))
}

/** Removes the launch directories past the newest TRANSCRIPTS_LAUNCHES_KEPT, by each directory's own last change. */
export function pruneTheLaunchesPastTheNewest(place: string): readonly string[] {
  let names: string[]
  try {
    names = fs.readdirSync(place, { withFileTypes: true }).filter((one) => one.isDirectory()).map((one) => one.name)
  } catch {
    return []
  }
  if (names.length <= TRANSCRIPTS_LAUNCHES_KEPT) return []
  const byLastChange = names
    .map((name) => ({ name, at: fs.lstatSync(join(place, name), { throwIfNoEntry: false })?.mtimeMs ?? 0 }))
    .sort((one, other) => other.at - one.at || one.name.localeCompare(other.name))
  return byLastChange.slice(TRANSCRIPTS_LAUNCHES_KEPT).flatMap(({ name }) => {
    try {
      fs.rmSync(join(place, name), { recursive: true, force: true })
      return []
    } catch (error) {
      return [`${join(place, name)} could not be removed (${(error as NodeJS.ErrnoException).code ?? String(error)}).`]
    }
  })
}
