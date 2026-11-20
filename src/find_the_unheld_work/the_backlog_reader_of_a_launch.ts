// How a launch reads the crew's backlog (martha#319 package B): `gh` run in the checkout when the launch holds
// processes, each page spent through the crew's GitHub budget (martha#947), and the backlog place in the crew's store.
// It sits apart from keep_the_backlog_read because the
// budget's spender reaches the seam's table of inbound paths, which names the unheld-work tool's path: the tool and its
// kept read must not import the spender, or the table would import itself.

import type { Processes, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { spendTheGithubBudget, theGithubSpenderOf } from '../spend_the_github_budget/spend_the_github_budget.ts'
import type { CrewGithub } from '../declare_crew/the_crews_github.ts'
import { theBacklogReaderOver, type TheBacklogReader } from './keep_the_backlog_read.ts'

/** The places a launch reads the backlog from: the crew's stores, the checkout `gh` runs in, its processes when it holds
 * any, and the clock. */
export interface TheBacklogsPlaces {
  readonly stores: TheCrewFilesStores
  readonly root: string
  readonly processes?: Processes
  readonly ledger: { readonly clock: { readonly now: () => number } }
  /** The crew's GitHub block as declared (martha#931 B), handed to the spender: its floor holds every page (martha#947). */
  readonly github: CrewGithub
  /** The crew's clock_zone as declared (martha#931 C): the zone the spender's refusals name their times in. */
  readonly clock_zone: string
}

/**
 * The wait one backlog page is spaced by in the crew's budget (martha#947): its own, so the pages of one read never hold
 * each other. A page that named nothing would wait the crew's spacing, which the page before it has just begun, and no
 * read could pass its first page. There are at most BACKLOG_PAGES_MOST of them, so the record holds that many keys at
 * most; a key's wait tops out at BACKOFF_MAX_MS, under BACKLOG_READ_INTERVAL_MS, so it never holds the next read.
 */
export const theBacklogPagesWait = (page: number): string => `backlog page ${String(page)}`

/**
 * The reader over a launch's places: the crew's backlog place, `gh` run in the checkout only when the launch holds
 * processes (undefined outside a launcher), and the time. Each page is one spend of the crew's GitHub budget
 * (martha#947), spaced by its own wait: the budget asks GitHub what is left first, so a page costs two calls, and a crew at its floor is refused
 * before any search call, in the spender's own words, which the kept read holds as its failure.
 */
export function theBacklogReaderIn(on: TheBacklogsPlaces): TheBacklogReader {
  const { stores, root, processes, ledger, github, clock_zone } = on
  if (processes === undefined) return theBacklogReaderOver(stores.crew, undefined, ledger.clock.now())
  const spender = theGithubSpenderOf({ stores, root, processes, clock: ledger.clock, github, clock_zone })
  const run: NonNullable<TheBacklogReader['run']> = async (args, page) => {
    const spent = await spendTheGithubBudget(spender, args, theBacklogPagesWait(page))
    return 'refusal' in spent ? spent : spent.said
  }
  return theBacklogReaderOver(stores.crew, run, ledger.clock.now())
}
