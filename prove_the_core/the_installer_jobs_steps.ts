// The steps of CI's installer job, as the workflow writes them (martha#496).
//
// run_the_installer_job.ts runs them in `npm test`, so a suite green here is green in that job. They are read from the
// workflow, never copied, so a step the job gains is a step the local run gains.

/** The workflow the installer job stands in, from the repository's top. */
export const WORKFLOW = '.github/workflows/ci.yml'
/** The installer job's id in the workflow. */
export const JOB = 'installer'
/** The folder the job's steps run in. */
export const FOLDER = 'installer'

/** The job's install of its own dependencies: the one step not run locally, as it rewrites the checkout. */
const INSTALL = /^npm ci\b/

/** Whether a step is the job's install of its dependencies. */
export const isTheInstall = (step: string): boolean => INSTALL.test(step)

const JOB_HEADER = new RegExp(String.raw`^  ${JOB}:\s*$`)
const NEXT_JOB = /^  [A-Za-z0-9_-]+:\s*$/
const RUN_LINE = /^\s+(?:- )?run:\s*(\S.*)$/

/**
 * The `run:` lines of the installer job, in order. Each is a one-line step, as the job writes them; a step written as
 * a block (`run: |`) reads as `|`, which no shell runs, so it fails by name rather than running half of itself.
 */
export function theJobsRunLines(workflow: string): string[] {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => JOB_HEADER.test(line))
  if (start === -1) return []
  const end = lines.findIndex((line, at) => at > start && NEXT_JOB.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end).flatMap((line) => RUN_LINE.exec(line)?.[1] ?? [])
}
