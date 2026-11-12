// The directory this check reads and judges (martha#289).
//
// One declaration, because the range reader, the paths the findings name and the
// callers that ask for a range all have to agree on it.

/** The core: the directory whose sources the rule reads, and the only one git is asked about. */
export const CORE = 'src'
