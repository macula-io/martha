// No launcher outlives its run (martha#559), over this machine's kernel:
//
//   node prove_the_core/a_test_leaves_nothing_behind/no_launcher_outlives_its_run.ts [--proc <dir>] [--temp <dir>]
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
// How old a process is comes from the kernel's own two numbers — field 22 of its stat line, in clock ticks since boot,
// over the kernel's CLK_TCK, added to the boot's `btime`. It is NOT the timestamp of the process's /proc directory,
// which procfs sets when the directory is first looked at: a chain that had stood for hours read as newborn that way,
// sat under the age this rule cuts at, and a real leftover passed as clean (review r=1, Jupiter: a six-second-old
// process read as newborn).
//
// `--proc` reads another kernel's tree and `--temp` another temp dir, which is how a test drives this gate over a killed
// run's chain and the home it made, without planting a process of its own in the machine's /proc. A tree read that way
// must hold its own `stat` file with a `btime` line, as every real kernel's does.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { PROC_ROOT } from '../../src/linux_process_identity/process_identity_from_proc.ts'
import {
  A_LAUNCH_HOME_PREFIX,
  parentIn,
  startTicksIn,
  startedAtOf,
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

/** When a process started, as the kernel's own two numbers hold it, or undefined for one that went since it was listed. */
function startTimeOf(proc_root: string, pid: number, boot_time_seconds: number, clock_ticks_per_second: number): number | undefined {
  const stat = statLineOf(proc_root, pid)
  const ticks = stat === undefined ? undefined : startTicksIn(stat)
  return ticks === undefined ? undefined : startedAtOf(ticks, boot_time_seconds, clock_ticks_per_second)
}

/** The pid of the process's parent, as field 4 of its stat line counts from the last closing parenthesis. */
function parentOf(proc_root: string, pid: number): number | undefined {
  const stat = statLineOf(proc_root, pid)
  return stat === undefined ? undefined : parentIn(stat)
}

/** A process's own stat line, or nothing when the kernel has no such process any more. */
function statLineOf(proc_root: string, pid: number): string | undefined {
  try {
    return readFileSync(join(proc_root, String(pid), 'stat'), 'utf8')
  } catch {
    return undefined
  }
}

/** The kernel's boot time in seconds since the epoch, as its own stat file holds it. */
function bootTimeOf(proc_root: string): number | undefined {
  try {
    const line = readFileSync(join(proc_root, 'stat'), 'utf8').split('\n').find((one) => one.startsWith('btime '))
    const at = Number(line?.split(' ')[1])
    return Number.isFinite(at) && at > 0 ? at : undefined
  } catch {
    return undefined
  }
}

/**
 * The kernel's clock ticks per second (`CLK_TCK`), asked of the C library that defines it rather than written down
 * here: a kernel that counted differently would make every age wrong, and a wrong age either hides a leftover or
 * names a live run. A machine whose getconf cannot answer is a check that could not be made, never a clean one.
 */
function clockTicksPerSecond(): number | undefined {
  const asked = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' })
  const ticks = Number(asked.stdout?.trim())
  return asked.status === 0 && Number.isInteger(ticks) && ticks > 0 ? ticks : undefined
}

/** Every process this kernel lists that it will say a command line, a parent and a start for: what the rule reads. */
function theProcessesOf(proc_root: string, boot_time_seconds: number, clock_ticks_per_second: number): readonly AProcessSeen[] {
  const seen: AProcessSeen[] = []
  for (const entry of readdirSync(proc_root)) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    const command_line = commandLineOf(proc_root, pid)
    const ppid = parentOf(proc_root, pid)
    const started_at = startTimeOf(proc_root, pid, boot_time_seconds, clock_ticks_per_second)
    if (command_line === undefined || ppid === undefined || started_at === undefined) continue
    seen.push({ pid, ppid, command_line, started_at })
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
  // Both of these are the kernel's, and neither has a default that would be right on another kernel: a check that
  // guessed either would read every age wrong. Not being able to read them is exit 2, never a pass.
  const boot = bootTimeOf(proc_root)
  const ticks = clockTicksPerSecond()
  let seen: readonly AProcessSeen[]
  let homes: readonly AHomeSeen[]
  try {
    if (boot === undefined) throw new Error(`${proc_root}/stat holds no btime line within it`)
    if (ticks === undefined) throw new Error('getconf CLK_TCK answered nothing')
    seen = theProcessesOf(proc_root, boot, ticks)
    homes = theHomesIn(temp)
  } catch (error) {
    console.error(`${NAME}: could not be made: ${(error as Error).message}`)
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
