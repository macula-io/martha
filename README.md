# Martha

[![CI](https://img.shields.io/github/actions/workflow/status/macula-io/martha/ci.yml?branch=main&label=CI)](https://github.com/macula-io/martha/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](#license)
[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-support-ea4aaa.svg?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/rgfaber)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-ffdd00.svg?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/rlefever)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/martha-full-dark.svg">
    <img src="assets/martha-full-light.svg" alt="Macula Martha" width="320">
  </picture>
</p>

<p align="center">
  <strong>A crew of coding agents that builds software the way a good team does</strong>
</p>

---

**Goal:** one developer, or a whole team, runs a crew of coding agents that
plans, builds, reviews and releases software, with one method and one tool.

> **Status: design.** Nothing is published yet. What follows is what Martha
> will be; the design is open in [issue #1](https://github.com/macula-io/martha/issues/1).
> How the existing crew conductor moves in, slice by slice, is in
> [the port map](docs/port-map.md).

## What is Martha?

Martha gives each coding agent a job on a crew: one builds, another reviews,
and a conductor hands work from one to the next. Every hand-off, verdict and
release is written down, so you can always see who did what and why.

The crew works with one method: event storming to find the business,
vertical slices (one directory per capability), and event sourcing. Names say
what the code does.

## Two modes, one tool

| | **Solo** | **Team** |
|---|---|---|
| Who | one developer on one machine | several people, several machines |
| Needs | nothing else: no mesh, no account | the [Macula](https://github.com/macula-io/macula) mesh |
| Who may approve a push or a release | you | the people the team names |

The mode is a table of who may do what, not a different program. Solo is a
table with one person allowed to do everything; team is a table with roles.
Start solo and move to team without changing tools.

## What it is, and what it is not

**It is**

- fully open source;
- a core that no coding tool owns, with thin adapters for each one (Claude
  Code, OpenCode, lazymesh and others);
- usable alone, with the mesh only when a team wants it.

**It is not**

- a hosted service, or anything that needs an account;
- tied to one AI vendor or one coding tool;
- a replacement for your own review: every push and every release still waits
  for a person's yes.

## Install

Not yet available. Martha will ship as `@macula-io/martha` on npm once the
publish gate ([issue #2](https://github.com/macula-io/martha/issues/2)) is met.

## Why "Martha"?

Martha was Paul McCartney's Old English sheepdog, the one in "Martha My Dear".
A sheepdog keeps a flock together and moving the same way without doing the
grazing itself. That is the job.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
