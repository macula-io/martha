// The `check:` scripts no pull request runs by design, each with why (martha#741).
//
// An entry the tree no longer bears out is a finding of its own: a listed script `package.json` does not declare, or
// one a job a pull request triggers does run, fails by name as a stale exception, so the list cannot go on excusing a
// script after the reason has gone.

/** One `check:` script excused from running on every pull request. */
export interface ExcusedCheck {
  /** The script's name, as `package.json` declares it. */
  readonly script: string
  /** Why no pull request runs it, and what runs it instead. */
  readonly reason: string
}

/** Every `check:` script no pull request runs. */
export const EXCEPTIONS: readonly ExcusedCheck[] = [
  {
    script: 'check:posted-text',
    reason: 'scheduled in posted-text.yml so old text never fails a pull request; every pull request runs its --self-test in posted-text-bites',
  },
  // The six below lost their CI job on 2026-11-19 (DECIDED "Dead jobs (Recommended)"): on a clean runner each one
  // always answered 0, or judged a tree it planted itself, so the job proved nothing a suite test does not. Each is
  // still run by hand, and the suite test named holds its bite on every pull request.
  {
    script: 'check:no-member-outlives-its-run',
    reason: 'run by hand over this machine\'s own runs; a clean runner always answers 0. Its bite is held by the suite (src/check_no_member_outlives_its_run)',
  },
  {
    script: 'check:no-launcher-outlives-its-run',
    reason: 'run by hand over this machine\'s own runs; a clean runner always answers 0. Its bite is held by the suite (prove_the_core/the_launchers_a_run_left.node-test.ts)',
  },
  {
    script: 'check:no-restore-in-the-release',
    reason: 'run by hand; its bite is held by the suite (prove_the_core/no_restore_reaches_the_release)',
  },
  {
    script: 'check:no-member-works-without-its-crew-tools',
    reason: 'run by hand over this machine\'s Martha state; a clean runner always answers 0. Its bite is held by the suite (src/check_no_member_works_without_its_crew_tools)',
  },
  {
    script: 'check:workspace-layout',
    reason: 'run by hand and by the owner\'s workspace-drift notice; this repository declares no layout, so a CI run was always green. Its bite is held by the suite (src/check_the_workspace_layout)',
  },
  {
    script: 'check:trial-evidence',
    reason: 'run by hand over a trial\'s evidence; in CI it judged a directory it planted itself. Its bite is held by the suite (trial_the_goose_host/the_evidence_it_keeps)',
  },
]
