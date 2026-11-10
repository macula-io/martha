// The folders the host keeps a project's sessions and memory in, under the config
// dir it was started with (martha#179): a probe run writes one for its scratch
// checkout, and the probe has to take it away again -- every one its runs
// registered, and none that was already there.
//
// The name is not predicted. Before a run starts, the probe reads the names that
// are there; after the host has stopped it removes every name that appeared since
// and carries the scratch prefix, and then reads the folder back and says what is
// still there, which is what the last row reports. Predicting the name was how a
// folder was left behind: the probe removed `<checkout>`'s folder while the host --
// still alive past `spawnSync`'s timeout, because its shell, not it, was killed --
// wrote the folder again afterwards, and the next read found it.

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { userSettingsPath } from '../claude_code_host/settings_env_reaching_servers.ts'

/** The host's key for a project folder: every character that is not a letter or a digit becomes `-`. */
export function projectKeyOf(folder: string): string {
  return folder.replaceAll(/[^A-Za-z0-9]/g, '-')
}

/** The names of the project folders under the config dir the host was started with. Empty when it cannot be told. */
function rootUnder(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const settings = userSettingsPath(env)
  return 'path' in settings ? join(dirname(settings.path), 'projects') : undefined
}

/** The folder the host keeps one project in, under the config dir it was started with. */
export function projectFolderFor(
  env: Readonly<Record<string, string | undefined>>,
  folder: string,
): string | undefined {
  const root = rootUnder(env)
  return root === undefined ? undefined : join(root, projectKeyOf(folder))
}

/** The names of the project folders under the config dir the host was started with. Empty when it cannot be told. */
export function namesUnder(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const root = rootUnder(env)
  return root === undefined || !existsSync(root) ? [] : readdirSync(root)
}

/** The project folders there were before one run started. */
export interface ProjectFoldersBefore {
  /** The `projects` folder the run's host reads, or undefined when its config dir cannot be told. */
  readonly root: string | undefined
  /** Every name in it, read before the host started. */
  readonly names: ReadonlySet<string>
}

/** Reads the project folders a run is about to add to, from the environment its host will be started with. */
export function theProjectFoldersThere(
  env: Readonly<Record<string, string | undefined>>,
): ProjectFoldersBefore {
  return { root: rootUnder(env), names: new Set(namesUnder(env)) }
}

/** Every name now in `root`. */
function namesIn(root: string | undefined): readonly string[] {
  return root === undefined || !existsSync(root) ? [] : readdirSync(root)
}

/**
 * Removes every name that appeared since `before` was read and starts with
 * `prefix`, and answers with what a fresh read still holds of those: the folders
 * this run wrote and could not take away. A name that was there before is left
 * alone, whatever it is called, and a removal that fails is named by the read
 * that follows rather than thrown away as a crash.
 */
export function takeAwayTheOnesThisRunWrote(
  before: ProjectFoldersBefore,
  prefix: string,
): readonly string[] {
  const added = namesIn(before.root).filter(
    (name) => !before.names.has(name) && name.startsWith(prefix),
  )
  for (const name of added) {
    try {
      rmSync(join(before.root ?? '', name), { recursive: true, force: true })
    } catch {
      // Named below, by the read-back, if it is still there.
    }
  }
  const addedSet = new Set(added)
  return namesIn(before.root).filter((name) => addedSet.has(name))
}

/** The last row of a run: what its read-backs left, by name, or "none, as claimed". */
export function theLeftoverRow(left: readonly string[]): string {
  const said = left.length === 0 ? 'none, as claimed' : `${left.join(', ')}, CLAIMED none`
  return `project folders this run left in the owner's config dir: ${said}`
}

/**
 * The whole of what the run left, read once more at the end: what the runs' own
 * read-backs could not take away, and whatever the probe holds now that it did not
 * hold before it started -- a folder a host wrote after its run's read-back, which
 * is the one that was left behind before (martha#179). Read at the end because only
 * then can a folder written late be seen at all; nothing is taken from the owner's
 * own folders, only from the names this run's own scratch checkouts produce, one
 * prefix per scratch the runs made.
 */
export function whatIsStillLeftAtTheEnd(
  startedWith: ProjectFoldersBefore,
  prefixes: Iterable<string>,
  theRunsCouldNotTake: readonly string[],
): readonly string[] {
  const theEnd = [...prefixes].flatMap((prefix) => takeAwayTheOnesThisRunWrote(startedWith, prefix))
  return [...new Set([...theRunsCouldNotTake, ...theEnd])]
}
