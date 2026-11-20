// How a launch reads the crew's backlog (martha#319 package B): `gh` through the crew's GitHub budget when the launch
// holds processes, and the backlog place in the crew's store. It sits apart from keep_the_backlog_read because the
// budget's spender reaches the seam's table of inbound paths, which names the unheld-work tool's path: the tool and its
// kept read must not import the spender, or the table would import itself.

import type { Processes, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { theGithubSpenderOf } from '../spend_the_github_budget/spend_the_github_budget.ts'
import type { CrewGithub } from '../declare_crew/the_crews_github.ts'
import { theBacklogReaderOver, type TheBacklogReader } from './keep_the_backlog_read.ts'

/** The places a launch reads the backlog from: the crew's stores, the checkout `gh` runs in, its processes when it holds
 * any, and the clock. */
export interface TheBacklogsPlaces {
  readonly stores: TheCrewFilesStores
  readonly root: string
  readonly processes?: Processes
  readonly ledger: { readonly clock: { readonly now: () => number } }
  /** The crew's GitHub block as declared (martha#931 B): the floor the backlog's reads are held to. */
  readonly github: CrewGithub
}

/** The reader over a launch's places: the crew's backlog place, `gh` through the crew's GitHub budget only when the
 * launch holds processes (undefined outside a launcher), and the time. */
export function theBacklogReaderIn(on: TheBacklogsPlaces): TheBacklogReader {
  const { stores, root, processes, ledger, github } = on
  const run = processes === undefined ? undefined : theGithubSpenderOf({ stores, root, processes, clock: ledger.clock, github }).run
  return theBacklogReaderOver(stores.crew, run, ledger.clock.now())
}
