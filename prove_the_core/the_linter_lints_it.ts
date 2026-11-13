// Which files the linter reads as code, answered by the linter itself.
//
// A host directory's ceiling (martha#322) counts the lines of the files eslint
// lints as code there, so a `.json` host recording, a file the linter ignores,
// and a directory holding neither carry none of the budget. The list of
// extensions is typed nowhere: the linter's own config answers for a path, and
// a path it says nothing about is not code. A new extension reaches the check
// when the linter gains it, with no second place to keep in step.
//
// This folder is outside src/, the core, on purpose: package.json declares
// eslint for this folder alone, and the core may not import it.

import { isAbsolute, relative, resolve } from 'node:path'

import { ESLint } from 'eslint'

/** Whether the linter reads a path as code; the path may be absolute or relative to the repository. */
export type Lints = (path: string) => Promise<boolean>

/** The linter over `repository`, answering for each path it is asked about. */
export function theLinterLints(repository: string): Lints {
  const root = resolve(repository)
  const eslint = new ESLint({ cwd: root })
  return async (path) => {
    const inside = isAbsolute(path) ? relative(root, path) : path
    return (await eslint.calculateConfigForFile(inside)) !== undefined
  }
}
