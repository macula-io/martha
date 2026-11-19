// What Goose opened, read off the strace over its whole process tree.
//
// This exists because a marker that does not reach the model proves little on its own — a file could be
// ignored for a reason other than the per-launch home. The trace proves the stronger fact the owner asked
// for: no path under the owner's home is opened at all, and nothing under the real home is touched but the
// binary itself and the places the launcher wrote.

/** The paths a trace names, in the order they were opened, one per open of a file. */
export function pathsIn(trace: string): string[] {
  const opening = /^\d+\s+[a-z_0-9]+\((?:AT_FDCWD,\s*)?"((?:[^"\\]|\\.)*)"/gm
  const paths: string[] = []
  for (const found of trace.matchAll(opening)) {
    const path = found[1] ?? ''
    if (path.startsWith('/')) paths.push(path)
  }
  return paths
}

/** What the trace says was touched where it should not have been. */
export interface TraceFindings {
  readonly opens: number
  readonly underTheOwnerHome: readonly string[]
  readonly underTheRealHome: readonly string[]
}

/**
 * The opens that fail the trial: any under the owner's stand-in home, and any under the real home that is
 * neither the goose binary's own directory nor a place this launch wrote (`allowed`).
 */
export function findingsIn(paths: readonly string[], ownerHome: string, realHome: string, allowed: readonly string[]): TraceFindings {
  const underTheOwnerHome = paths.filter((path) => path === ownerHome || path.startsWith(`${ownerHome}/`))
  const underTheRealHome = paths.filter((path) => path === realHome || path.startsWith(`${realHome}/`))
    .filter((path) => !allowed.some((prefix) => path.startsWith(prefix)))
  return { opens: paths.length, underTheOwnerHome: [...new Set(underTheOwnerHome)], underTheRealHome: [...new Set(underTheRealHome)] }
}
