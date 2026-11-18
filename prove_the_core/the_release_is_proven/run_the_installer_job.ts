// Run CI's installer job here, step for step (martha#496): node prove_the_core/run_the_installer_job.ts [--repository <path>]
//
// This exists so a branch cannot be green locally while CI's installer job is red.
//
// The installer is a project of its own, with its own package.json, and CI runs it as a job of its own. `npm test` at
// the root never ran it, so a branch could pass the whole local suite, every check:*, the typecheck and the lint, and
// still fail in CI with nothing local to say so; that is what happened on the launcher split (martha#443). `npm test`
// runs this before its parallel run, so the installer's own suite has the machine to itself, as it does in its job:
// beside the parallel run, its clean-install case runs out of time for want of a core.
//
// The steps are the job's own `run:` lines, read from the workflow, so a step added there runs here without anyone
// copying it. Each runs in the installer folder, as the job runs it, and its output is let through. The one step not
// run is the job's install of the installer's own dependencies, which rewrites the checkout's node_modules; when they
// are missing this refuses, naming the line to run, and never passes for having run nothing.
//
// Exit 0 every step passed, 1 a step failed (named), 2 the job could not be run here (no such job, no step past the
// install, or the installer's dependencies are not installed).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { FOLDER, isTheInstall, JOB, theJobsRunLines, WORKFLOW } from './the_installer_jobs_steps.ts'

const NAME = 'run_the_installer_job'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** Why the job cannot run here, or null when it can. */
function whyItCannotRun(repository: string, steps: readonly string[]): string | null {
  const install = steps.find(isTheInstall)
  if (install === undefined) return `${WORKFLOW} has no "${JOB}" job installing its dependencies, so there is no job to run`
  if (!steps.some((step) => !isTheInstall(step))) return `${WORKFLOW}'s "${JOB}" job runs nothing past its install`
  if (!existsSync(join(repository, FOLDER, 'node_modules'))) {
    return `the installer's own dependencies are not installed, so its job cannot run here: run "${install}" in ${FOLDER}/`
  }
  return null
}

function main(): number {
  const repository = option('--repository') ?? '.'
  const steps = theJobsRunLines(readFileSync(join(repository, WORKFLOW), 'utf8'))
  const why = whyItCannotRun(repository, steps)
  if (why !== null) {
    console.error(`${NAME}: ${why}`)
    return 2
  }
  for (const step of steps.filter((line) => !isTheInstall(line))) {
    const { status, signal } = spawnSync('sh', ['-c', step], { cwd: join(repository, FOLDER), stdio: 'inherit' })
    if (status !== 0) {
      console.error(`${NAME}: CI's ${JOB} job step "${step}" fails in ${FOLDER}/ (${signal ?? `exit ${status}`})`)
      return 1
    }
  }
  console.log(`${NAME}: every step of CI's ${JOB} job past its install passed in ${FOLDER}/`)
  return 0
}

try {
  process.exitCode = main()
} catch (failure: unknown) {
  console.error(`${NAME}: the job could not be run: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exitCode = 2
}
