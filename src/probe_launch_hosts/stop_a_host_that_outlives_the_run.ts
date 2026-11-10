// A host the probe could not wait for is stopped, not left running (martha#179).
//
// `spawnSync` kills its direct child when the wait runs out, and nothing else. The
// rows that start the host under `sh -c` have the shell as that child, so a run
// whose wait ran out left the host alive: it wrote its project folder, and its
// session, after the probe had removed both. Every run now starts in a session of
// its own, whose process group the run records; when the wait runs out the whole
// group is killed and the probe waits for it to go before it removes anything.

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

/** What a run of the host did. */
export interface HostRun {
  /** The host's own exit status, or null when it did not exit on its own. */
  readonly status: number | null
  /** What the host printed on stdout. */
  readonly stdout: Buffer | null
  /** Why it could not run, when it could not; a run the wait ran out on says so here. */
  readonly error: string | undefined
  /** True when the wait ran out, so the group was killed instead of waited for. */
  readonly timedOut: boolean
}

/** How long the probe waits for a killed group to disappear, in tenths of a second. */
const WAITS = 50

/** Whether any process of the group is still there. */
function theGroupIsThere(group: number): boolean {
  try {
    process.kill(-group, 0)
    return true
  } catch {
    return false
  }
}

/** The process group the run recorded, when it recorded one the probe can use. */
function theGroupIn(pid_file: string): number | undefined {
  try {
    const group = Number(readFileSync(pid_file, 'utf8').trim())
    return Number.isInteger(group) && group > 0 ? group : undefined
  } catch {
    // The run never got as far as recording it.
    return undefined
  }
}

/** SIGKILLs the whole group the host leads, and does not return before it has gone. */
function killTheGroupOf(pid_file: string): void {
  const group = theGroupIn(pid_file)
  if (group === undefined) return
  try {
    process.kill(-group, 'SIGKILL')
  } catch {
    return
  }
  for (let waited = 0; waited < WAITS && theGroupIsThere(group); waited++) spawnSync('sleep', ['0.1'])
}

/** One run of the host, in its own session, whose group `pid_file` names. */
export function runTheHost(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env: Readonly<Record<string, string | undefined>>
    readonly timeout_ms: number
    /** Where the run writes the process group it leads, for the kill a timeout needs. */
    readonly pid_file: string
  },
): HostRun {
  const run = spawnSync(
    'setsid',
    ['-w', 'sh', '-c', 'echo $$ > "$0"; exec "$@"', options.pid_file, command, ...args],
    {
      cwd: options.cwd,
      env: options.env,
      // Captured for the rows that read the host's own account of what it was refused; the others ignore it.
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: options.timeout_ms,
    },
  )
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  if (timedOut) killTheGroupOf(options.pid_file)
  const error = run.error === undefined ? undefined : timedOut ? `spawnSync ${command} ETIMEDOUT` : run.error.message
  return { status: run.status, stdout: run.stdout, error, timedOut }
}

/** Every process on this machine whose working directory is inside `folder`. */
function thePidsWorkingIn(folder: string): readonly number[] {
  let entries: readonly string[]
  try {
    entries = readdirSync('/proc')
  } catch {
    return []
  }
  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .filter((entry) => {
      try {
        const cwd = readlinkSync(join('/proc', entry, 'cwd'))
        return cwd === folder || cwd.startsWith(`${folder}/`)
      } catch {
        return false
      }
    })
    .map(Number)
    .filter((pid) => pid !== process.pid)
}

/** SIGKILLs each pid, and answers with the ones that were still there to be killed. */
function killEach(pids: readonly number[]): readonly number[] {
  return pids.filter((pid) => {
    try {
      process.kill(pid, 'SIGKILL')
      return true
    } catch {
      // Gone between the read and the kill.
      return false
    }
  })
}

/**
 * SIGKILLs every process still working inside the run's scratch, and does not return
 * before none is left. A group kill reaches what the run started in this session; this
 * reaches the rest of it -- a host a row starts in a session of its own, a tool server
 * that lingers, a hook that sleeps -- because they all work in the scratch this run made.
 */
export function stopTheProcessesLeftIn(scratch: string): readonly number[] {
  const killed: number[] = []
  for (let waited = 0; waited < WAITS; waited++) {
    const there = thePidsWorkingIn(scratch)
    if (there.length === 0) break
    killed.push(...killEach(there))
    spawnSync('sleep', ['0.1'])
  }
  return killed
}
