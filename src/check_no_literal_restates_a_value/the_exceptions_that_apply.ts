// Which exceptions apply to the tree a run judges (martha#256).
//
// An exception names a file and a value in this checkout, so it says nothing about another tree. The range
// tests plant a throwaway repository and run the gate with `--root`, and every entry declared here was held
// against those trees: a planted repository holds none of these files, so the list read as stale and the run
// ended 2 — "could not look" — where the test required a finding. The list applies to this checkout and to no
// other tree, so a tree brought here with `--root` is judged without it.

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'

/** Where a path really leads, so a checkout reached through a symlink is still the checkout. */
const realpathOf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The exceptions that apply to `root`: the declared ones when it is the checkout, and none for any other tree. */
export function exceptionsThatApply(root: string, checkout: string, declared: readonly Exception[]): readonly Exception[] {
  return realpathOf(root) === realpathOf(checkout) ? declared : []
}
