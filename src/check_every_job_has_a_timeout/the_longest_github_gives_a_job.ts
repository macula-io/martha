// The outside fact this check is sized against (martha#992): what GitHub itself does with a job that names no
// timeout-minutes. Named here, once, so the check and its test read the same number and no line spells it twice.

/** The minutes after which GitHub ends a job that names no `timeout-minutes` of its own. */
export const GITHUB_LONGEST_MINUTES = 360
