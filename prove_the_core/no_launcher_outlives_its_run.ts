// No launcher outlives its run (martha#559), over this machine's kernel:
//
//   node prove_the_core/no_launcher_outlives_its_run.ts [--proc <dir>] [--temp <dir>]
//
// Exit 0 looked, and found none; 1 one or more found, each named with the home it was started from; 2 the check could
// not be made. It never passes because it could not look.
//
// This exists because the pile is what breaks the next run, and because nothing else looks: a launcher left by a killed
// run carries no launch record and no state root, so the member check (check_no_member_outlives_its_run) cannot place
// it, and the suite that would have noticed is the one that was killed.
//
// It is its own check and not a step before the suite on a machine, because it reads the WHOLE machine and a machine
// can hold a run in flight: a suite started beside another one starts and ends `script` pairs the whole time, and some
// of those are reparented away from their spawner while the run they belong to is alive and well. A gate that stopped
// every run for another run's work in progress would be wrong; run on its own, this names what is really left.
//
// What it does not see, stated rather than left to be discovered: a home made under a temp dir other than this run's own
// (a member whose TMPDIR points elsewhere). A process inside such a home is still named, wherever it was started from.
//
// `--proc` reads another kernel's tree and `--temp` another temp dir, which is how a test drives this gate over a killed
// run's chain and the home it made, without planting a process of its own in the machine's /proc.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { PROC_ROOT } from '../src/linux_process_identity/process_identity_from_proc.ts'
import {
  A_LAUNCH_HOME_PREFIX,
  theHomeLineOf,
  theHomesLeft,
  theHomesNamed,
  theLaunchersLeft,
  theLineOf,
  type AHomeSeen,
  type AProcessSeen,
} from './the_launchers_a_run_left.ts'

const NAME = 'no_launcher_outlives_its_run'

/** The command line of a process, its arguments separated by spaces, or nothing when the kernel will not say. */
function commandLineOf(proc_root: string, pid: number): string | undefined {
  try {
    return readFileSync(join(proc_root, String(pid), 'cmdline'), 'utf8').trim().split('\0').join(' ')
  } catch {
    return undefined
  }
}

/** When a process started, as the kernel's own directory for it holds it, or 0 for one that has gone since it was listed. */
function startedAt(proc_root: string, pid: number): number {
  try {
    return statSync(join(proc_root, String(pid))).mtimeMs
  } catch {
    return 0
  }
}

/** The pid of the process's parent, as field 4 of its stat line counts from the last closing parenthesis. */
function parentOf(proc_root: string, pid: number): number | undefined {
  try {
    const stat = readFileSync(join(proc_root, String(pid), 'stat'), 'utf8')
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
  } catch {
    return undefined
  }
}

/** Every process this kernel lists that it will say a command line and a parent for: what the rule reads. */
function theProcessesOf(proc_root: string): readonly AProcessSeen[] {
  const seen: AProcessSeen[] = []
  for (const entry of readdirSync(proc_root)) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    const command_line = commandLineOf(proc_root, pid)
    const ppid = parentOf(proc_root, pid)
    if (command_line === undefined || ppid === undefined) continue
    seen.push({ pid, ppid, command_line, started_at: startedAt(proc_root, pid) })
  }
  return seen
}

/** The value of `name` in the arguments, or undefined when it was not given. */
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** Every home a run made that is still under the temp dir, with when it was last written. */
function theHomesIn(where: string): readonly AHomeSeen[] {
  const homes: AHomeSeen[] = []
  for (const entry of readdirSync(where)) {
    if (!entry.includes(A_LAUNCH_HOME_PREFIX)) continue
    const path = join(where, entry)
    try {
      homes.push({ path, last_written_at: statSync(path).mtimeMs })
    } catch {
      // It went between being listed and being read.
    }
  }
  return homes
}

/** The gate over a kernel and the temp dir it makes its homes in: every launcher and every home a run left behind. */
function theGate(proc_root: string, temp: string): number {
  let seen: readonly AProcessSeen[]
  let homes: readonly AHomeSeen[]
  try {
    seen = theProcessesOf(proc_root)
    homes = theHomesIn(temp)
  } catch {
    console.error(`${NAME}: could not be made: ${proc_root} is not a /proc this reader can read`)
    return 2
  }
  const left = theLaunchersLeft(seen, Date.now())
  const abandoned = theHomesLeft(homes, theHomesNamed(seen), Date.now())
  for (const one of left) console.error(theLineOf(one))
  for (const home of abandoned) console.error(theHomeLineOf(home, Date.now()))
  const said =
    left.length + abandoned.length === 0
      ? 'no launcher outlives its run, and no home outlives its launcher'
      : `${left.length} launcher(s) and ${abandoned.length} home(s) above: a run was killed and left them, and their terminals are why the next launch test hangs`
  console.error(`${NAME}: ${said}`)
  return left.length + abandoned.length === 0 ? 0 : 1
}

process.exitCode = theGate(option('--proc') ?? PROC_ROOT, option('--temp') ?? tmpdir())
