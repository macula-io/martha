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
]
