// A probe:launch row whose claim is that something did NOT happen is satisfied by
// a host that never ran: it touched none of the markers, exactly as the row says
// it would not (martha#188). So such a row also carries a claim that something
// DID happen, written by the host at the point under test, or the host's own
// clean exit. This module holds that rule and the judging of one row against one
// run, apart from the script that runs the hosts, so a test can judge a host that
// exits early having touched nothing without spawning one.

/** What one row claims: its markers, and a clean exit where the exit is what proves the host ran. */
export interface RowClaims {
  readonly what: string
  readonly expected: Readonly<Record<string, boolean>>
  readonly host_ok?: true
}

/** A run as the probe saw it: each marker and whether it was touched, and the host's exit status (null when no host ran). */
export interface RowRun {
  readonly markers: Readonly<Record<string, boolean>>
  readonly status: number | null
}

/** One printed line, and whether the row came out as claimed. */
export interface RowLine {
  readonly text: string
  readonly failed: boolean
}

const said = (started: boolean) => (started ? 'started' : 'not started')

/** Whether a row claims that something did not happen. */
const claimsAnAbsence = (row: RowClaims): boolean => Object.values(row.expected).includes(false)

/** Whether a row also claims something that did happen, or the host's clean exit. */
const provesTheHostRan = (row: RowClaims): boolean => row.host_ok === true || Object.values(row.expected).includes(true)

/**
 * The rows whose claim is an absence and that prove nothing else, by name. An
 * absence that travels alone passes on a host that exited on the config before
 * it reached the thing under test, which is the defect this names (martha#188).
 */
export function absencesWithoutAHostProof(rows: readonly RowClaims[]): readonly string[] {
  return rows.filter((row) => claimsAnAbsence(row) && !provesTheHostRan(row)).map((row) => row.what)
}

/** One marker against its claim. */
function claimLine(row: RowClaims, name: string, claimed: boolean, seen: boolean): RowLine {
  const matches = seen === claimed
  return { text: `${row.what}: ${name} ${said(seen)}, ${matches ? 'as claimed' : `CLAIMED ${said(claimed)}`}`, failed: !matches }
}

/** The host's exit, against the claim that it was clean. */
function exitLine(row: RowClaims, status: number | null): RowLine {
  const exitedOk = status === 0
  return {
    text: `${row.what}: the host exited ${exitedOk ? 'cleanly, as claimed' : `CLAIMED cleanly but exited ${status ?? 'not at all'}`}`,
    failed: !exitedOk,
  }
}

/**
 * One row judged against one run, line by line. A host that exits early having
 * touched nothing fails every row whose claim is an absence: the absence matches
 * and the positive claim beside it does not (martha#188).
 */
export function judgeRow(row: RowClaims, run: RowRun): readonly RowLine[] {
  const markers = Object.entries(row.expected).map(([name, claimed]) => claimLine(row, name, claimed, run.markers[name] === true))
  return row.host_ok === true ? [...markers, exitLine(row, run.status)] : markers
}
