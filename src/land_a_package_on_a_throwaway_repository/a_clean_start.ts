// A restarted member's session starts with no stranger text in what the host loads by itself (martha#639, R3).
//
// Before the token enters the container, both members are started again in the throwaway clone. The host reads text
// from the working folder, its parents and the owner's config folder at a session's start, before any turn. So the run
// lists those places inside the container and judges the listing here:
//
// - the clone holds exactly what the run put there, and nothing else, so an instruction file, a config folder or a tool
//   server file of any name is a hit, with no list of names to keep up;
// - each folder between the clone and the home holds only the next folder of the path;
// - the home holds none of the host's own instruction files, and its config folder holds no file in any folder the
//   recorded host loads markdown from. Those names are the recording's (#146's markdown kinds, the output-styles folder,
//   and the instruction files among the config names the host protects), never typed here.
//
// A hit is named, and no token is placed.

import { dirname, join, relative, sep } from 'node:path'

import { CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'

/** What a markdown file's name ends with, so the instruction files among the host's protected config names are found. */
const MARKDOWN = '.md'

/** The places a clean start is judged on, and what the run put in the clone. */
export interface TheStart {
  /** The home of the container's node user. */
  readonly home: string
  /** The throwaway clone the restarted members start in, under the home. */
  readonly clone: string
  /** Every path under the clone the run put there, relative to it, `.git` and what is under it left out. */
  readonly made: readonly string[]
}

/** The instruction files the host reads from a folder, by the recording's protected config names. */
export const INSTRUCTION_FILES: readonly string[] = RECORDED_HOST.protected_config_names.filter((name) => name.endsWith(MARKDOWN))

/** The folders under the config folder the host loads the owner's markdown from, by the recording. */
export const LOADED_FOLDERS: readonly string[] = [...new Set([...RECORDED_HOST.markdown_kinds, CLAUDE_CODE_OUTPUT_STYLES_FOLDER])]

const under = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}${sep}`)

/** The folders from the clone's parent up to the home, nearest first. */
function parentsOf(start: TheStart): string[] {
  const parents: string[] = []
  for (let folder = dirname(start.clone); under(folder, start.home) && folder !== start.home; folder = dirname(folder)) parents.push(folder)
  return parents
}

/** What in the clone the run did not put there. */
function strangersInTheClone(start: TheStart, listed: readonly string[]): string[] {
  const made = new Set(start.made)
  return listed
    .filter((path) => under(path, start.clone) && path !== start.clone)
    .map((path) => relative(start.clone, path))
    .filter((path) => path !== '.git' && !path.startsWith(`.git${sep}`) && !made.has(path))
    .map((path) => `${join(start.clone, path)}: in the clone, and the run did not put it there`)
}

/** What a folder between the clone and the home holds beside the next folder of the path. */
function strangersInTheParents(start: TheStart, listed: readonly string[]): string[] {
  return parentsOf(start).flatMap((parent) => {
    const next = [start.clone, ...parentsOf(start)].find((path) => dirname(path) === parent)
    return listed.filter((path) => dirname(path) === parent && path !== next).map((path) => `${path}: beside the clone's path, which holds only its next folder`)
  })
}

/** The host's own instruction files in the home, and a file in a folder the host loads markdown from. */
function strangersInTheHome(start: TheStart, listed: readonly string[]): string[] {
  const config = join(start.home, CLAUDE_FOLDER)
  const instructions = INSTRUCTION_FILES.flatMap((name) => [join(start.home, name), join(config, name)])
  const loaded = LOADED_FOLDERS.map((name) => join(config, name))
  return listed
    .filter((path) => instructions.includes(path) || loaded.some((folder) => path.startsWith(`${folder}${sep}`)))
    .map((path) => `${path}: the host loads it at a session's start`)
}

/**
 * Every place a restarted member's session would load stranger text from, named; empty when the start is clean.
 * `listed` is every path the run found inside the container under the home, one absolute path each.
 */
export function whatTheStartWouldLoad(start: TheStart, listed: readonly string[]): string[] {
  if (!under(start.clone, start.home) || start.clone === start.home) return [`${start.clone}: the clone is not under the home ${start.home}`]
  if (!listed.includes(start.clone)) return [`${start.clone}: the clone is not in the listing, so the start was not read`]
  return [...strangersInTheClone(start, listed), ...strangersInTheParents(start, listed), ...strangersInTheHome(start, listed)]
}
