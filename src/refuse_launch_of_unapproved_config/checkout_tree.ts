// What the checkout's author can change, as one git tree id.
//
// A config the owner approves names commands, and those commands run files in
// the checkout: a hook `.claude/hooks/start.sh`, a server `node ./tools/server.js`,
// a plugin path. Fingerprinting the config alone lets a pull request change the
// script and keep the approval. So the approval also binds the work tree: the
// tree git would write if every tracked change and every untracked, unignored
// file were staged now. A pull, a merge, a checkout of another branch or an edit
// to any such file changes it.
//
// It is computed in a scratch index, never the checkout's own, so the member's
// staging area is untouched. Git writes the blobs it hashes into the repository's
// object store, as `git add` does; nothing else in the repository changes.
//
// What it does not cover, stated rather than hidden: a file git ignores and does
// not track. Such a file is not shipped by the checkout's author (a commit
// cannot carry it untracked); it is written on this machine, by a command the
// member ran (A13). Nor the inside of a submodule beyond the commit its parent
// records.
//
// Git runs here with every inherited GIT_ variable dropped, so the caller's
// environment cannot point it at another repository or index, and with
// fsmonitor off, the one setting that would make `git add` start a program.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The tree id of the checkout holding `dir`, with its uncommitted and untracked
 * (unignored) changes included, or `null` when `dir` is in no git checkout or
 * git cannot read it.
 */
export function readCheckoutTree(dir: string): string | null {
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  if (top === undefined) return null

  const scratch = mkdtempSync(join(tmpdir(), 'martha-tree-'))
  try {
    const index = { GIT_INDEX_FILE: join(scratch, 'index') }
    const seeded = git(top, ['read-tree', 'HEAD'], index) ?? git(top, ['read-tree', '--empty'], index)
    if (seeded === undefined) return null
    if (git(top, ['add', '--all', '--', '.'], index) === undefined) return null
    return git(top, ['write-tree'], index) ?? null
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function git(cwd: string, args: readonly string[], extra: Readonly<Record<string, string>> = {}): string | undefined {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  const run = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, ...extra },
  })
  return run.status === 0 ? run.stdout.trim() : undefined
}
