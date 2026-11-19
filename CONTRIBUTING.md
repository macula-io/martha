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
(cd installer && npm ci --ignore-scripts)   # the installer's own dependencies
npm test               # every capability's tests, and the installer job's steps
npm run typecheck      # tsc --noEmit
npm run lint           # the structural floor
```

The installer is a project of its own, and CI runs it as a job of its own. So
that a suite green here is green there, `npm test` runs that job's steps too,
read from `.github/workflows/ci.yml`, before its parallel run
(`prove_the_core/run_the_installer_job.ts`); without the installer's
dependencies it fails, naming the line to run. It also holds
what the clean-install proof loads out of the installed release by name to the
tree: each file it loads is there and exports every name it reads
(`prove_the_core/what_the_clean_install_loads_is_there.ts`).

`npm test` ends on its own. A test that runs longer than the test script's
`--test-timeout` fails by name, and `--test-force-exit` ends each test file's
process once its tests are done, even if it still holds something open. So a
hung test never outlives an interrupted run. The timeout is written once, in
the test script in package.json.

To run one file, or one named case, through those same bounds:

```bash
npm run test:file -- prove_the_core/parse_a_source.node-test.ts
npm run test:file -- '--test-name-pattern=a source that parses' prove_the_core/parse_a_source.node-test.ts
```

It is the run `npm test` makes of its files, with the six globs replaced by the
files you name (`prove_the_relay_loads/run_the_tests_of_one_file.sh`), so it
carries the test script's own timeout, force-exit and guard, and goes through
the same output check. The recorded-host and installer stages do not run, so a
green `test:file` says nothing about them: `npm test` is still the gate before a
handoff. A path the suite's own globs do not pick is refused, and a flag of your
own is refused too — the bounds are the test script's, and `--test-name-pattern`
is the one word it takes.

## Stopping a test run on a shared box

Several members run this suite at once, often as the same user. A pattern match
on the command (`pgrep -f "npm test"`, or a bare `pkill -f`) reaches every
session's run on the machine: the wrapper, npm and every test file's node all
carry the same words, and it has already killed a peer's run. So start your runs
with `npm run test:mine` and stop them with `npm run stop:my-run`.

```bash
npm run test:mine                        # the whole suite, as npm test runs it
npm run test:mine -- src/a_slice/x.node-test.ts
npm run stop:my-run                      # the one run this checkout started
npm run stop:my-run -- --all-mine        # every run this checkout started
npm run stop:my-run -- --token <t>       # that one, named
```

A run started with `test:mine` writes a record before its suite can run a file
(`prove_the_core/the_record_of_a_test_run.ts`), and `stop:my-run` signals the
process group that record names and nothing else. A record belongs to the
checkout that started it, because on this box the checkout is the only thing
that tells one member's run from a peer's. A record whose group is still there
after the wait is kept, and `--force` kills it; `--by-cwd <dir>` is the fallback
for a plain `npm test`, under one checkout's own top and no other: the directory
must be what `git rev-parse --show-toplevel` answers for it, so a folder above a
checkout (a home, a worktrees root) is refused, since every member's suite runs
under one of those.

Stopping a run is not cleaning up after a killed one: a process a test started in
a group of its own (`detached: true`, `setsid`, `script`, `unshare`) is not
reached by a signal to the run's group. `npm run
check:no-launcher-outlives-its-run` is what finds those afterwards ([#724],
[#737]).

[#724]: https://github.com/macula-io/martha/issues/724
[#737]: https://github.com/macula-io/martha/issues/737

Ending a file's process must not hide what it left behind, so the script also
loads `prove_the_core/fail_a_test_file_that_leaves_something_running.ts` into
every test file's process. A test file that leaves a server, socket, timer or
child process running after its tests fails by name, with what it left:

```text
src/x/x.node-test.ts left running after its tests: a listening TCP server (TCPServerWrap). Stop it in t.after.
```

Stop what a test starts in `t.after`, registered before the first assert, and
wait for it to stop (a server's `close` callback, a child's `exit`). A check
(`prove_the_core/every_test_run_ends.ts`) fails when the script loses any of
the three.

What a test leaves on disk fails the same way. Each file's process is handed a
`TMPDIR` and an `XDG_RUNTIME_DIR` of its own, both empty when it starts, so any
entry in either one is that file's to remove:

```text
src/x/x.node-test.ts left behind in the temp directory after its tests: martha-472-link-4242. Remove it in t.after.
```

A `tmpdir()` a test calls, or a sibling it starts calls, answers the file's own
directory, and it goes with the file whether the file passed or failed. Those
directories sit in two roots `npm test` makes for each stage and removes when the
stage ends (`prove_the_core/keep_a_test_run_in_one_temporary_root.ts`), so an
interrupted run leaves nothing in `/tmp` for the next one to guess at, and a
scratch a test forgets is never another run's to delete.

No test prints your environment. `npm test`, here and in `installer/`, runs
node --test through `prove_the_core/no_test_output_carries_the_environment.ts`,
which plants a fresh secret-looking value in `MARTHA_PLANTED_SECRET` and fails
the run when that value appears anywhere in its output, even though every
test passed. A test that starts a child which reports its environment captures
that child's output (`stdio: 'pipe'`) and asserts on the names it needs; it
never lets the output through, and never puts a whole environment in an
assertion message.

`npm run lint` holds every function to the structural floor: no block nested
deeper than an `if` inside an `if`, a cyclomatic complexity of at most 9, and at
most 60 lines, blank lines and comments aside. The caps are named once, in
`eslint.config.mjs`, and `prove_the_core/structure_stays_flat.node-test.ts`
plants a function over each to prove they bite. There is no baseline and no
exception: an `eslint-disable` comment is ignored, with a warning, and the run
allows none. A function over a cap is split into named steps.

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
