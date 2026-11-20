// An engine checkout on disk, read the way the engine facts' parts ask (macula-io/martha#541, martha#614).
//
// The recorder reads the engine it records through this, and the Goose trial reads the engine it launches through it
// too, so both take the engine's facts from one reader and neither keeps a resolver of its own.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { EngineSource } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'

/** A checkout on disk, read the way the parts ask: a missing file or directory is an absence, never a throw. */
export function anEngineCheckoutOnDisk(checkout: string): EngineSource {
  return {
    read: (path) => {
      try {
        return readFileSync(join(checkout, path), 'utf8')
      } catch {
        return undefined
      }
    },
    list: (directory) => {
      try {
        return readdirSync(join(checkout, directory))
      } catch {
        return []
      }
    },
  }
}
