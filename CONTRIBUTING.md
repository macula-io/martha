# Contributing to Martha

Martha is in its design phase: there is no code to build yet. The most
useful contribution right now is in the issues.

## Where to start

- **The design** is open in [issue #1](https://github.com/macula-io/martha/issues/1).
  Questions, objections and use cases are welcome there.
- **A new idea** goes in a new issue. Open it with one line that says what
  someone can do afterwards that they cannot do today.
- **A bug in a document** (a broken link, a wrong statement) can go straight
  to a pull request.

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
- Every pull request gets a review before it lands.

## Licence

By contributing you agree that your contribution is licensed under the
Apache License 2.0, the licence of this repository.
