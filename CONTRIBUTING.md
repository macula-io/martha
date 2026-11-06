# Contributing to Martha

Martha is in its design phase: the design is open in
[issue #1](https://github.com/macula-io/martha/issues/1). The first code is
landing in `src/`, one directory per capability, starting with the publish gate
of [issue #2](https://github.com/macula-io/martha/issues/2); CI runs its tests
on every change.

## Where to start

- **The design** is open in [issue #1](https://github.com/macula-io/martha/issues/1).
  Questions, objections and use cases are welcome there.
- **A new idea** goes in a new issue. Open it with one line that says what
  someone can do afterwards that they cannot do today.
- **A bug in a document** (a broken link, a wrong statement) can go straight
  to a pull request.

## Running the checks

Node 24.18.1 or later, from the repository root:

```bash
npm ci
npm test               # every capability's tests
npm run typecheck      # tsc --noEmit
```

`npm test` ends on its own. A test that runs longer than the test script's
`--test-timeout` fails by name, and `--test-force-exit` ends each test file's
process once its tests are done, even if it still holds something open. So a
hung test never outlives an interrupted run, and a check
(`prove_the_core/every_test_run_ends.ts`) fails when the script loses either
flag. The timeout is written once, in the test script in package.json. A test that leaves a
server or timer running no longer hangs the run, so it gets no warning
either: clean up in `t.after`, registered before the first assert.

CI runs those, and three more: every link in every document must resolve, both
logos must be valid SVG, and `npm run check:private` must find no private link,
internal host name or private remote. The last one stops, rather than passing,
on a machine that does not hold the list of the lab's machine families, which is
a secret ([why](docs/nothing-private-gets-in.md)). CI holds it, except on a
pull request from a fork, where the check skips that one class and says so.

## How we build

Martha carries the method it teaches:

- **Vertical slices.** One directory per business capability. No `services/`,
  `utils/` or `helpers/` folders.
- **Names that scream intent.** A file name says what the code does for the
  business, not which technical layer it sits in.
- **Business verbs, not CRUD.** Events are named for what happened
  (`work_handed_over`), never `created`, `updated` or `deleted`.
- **No stubs.** If something cannot be finished, it does not go in.

## Pull requests

- One change per pull request, with a description that says why.
- CI must pass on the exact commit you ask us to merge.
- Code moved in from a private repository keeps its reasoning and drops its
  links: no private issue reference, internal host name or private remote.
  [The check](docs/nothing-private-gets-in.md) fails on one; run
  `npm run check:private` before you push, because a push is public at once.
- A pull request is reviewed by the maintainers' crew before it is merged.

## Licence

By contributing you agree that your contribution is licensed under the
Apache License 2.0, the licence of this repository.
