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

> **Status: early 0.x.** What follows is what Martha is and how it works; the
> design is still open in
> [issue #1](https://github.com/macula-io/martha/issues/1).
> How the existing crew conductor moves in, slice by slice, is in
> [the port map](docs/port-map.md). What Martha talks to and what it is made
> of is drawn in [the architecture](architecture/README.md).

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

Martha runs on Node, from the version its `engines` field sets, and starts one
coding tool, whose version the Claude Code adapter records. These two commands,
run from a Martha checkout, print both:

```sh
node -p "require('./package.json').engines.node"
node -p "require('./src/claude_code_host/recorded_claude_code_host.json').host_version"
```

Those files are where the versions are set: upgrade Node to the one the first
names, and sign in to the coding tool the second names (`claude --version` is
what you have).

Install one of two ways: from the signed package, when you want to run Martha,
or from a checkout, when you are working on Martha itself.

### From the signed package

With Node alone:

```sh
npx -y --ignore-scripts @macula-io/martha@<exact version>
```

Name the installer's exact version: npm never lets a published version be
replaced, so that line is what you trust. What the installer checks before it
writes anything is in [the installer's README](installer/README.md).

### From a checkout

```sh
git clone https://github.com/macula-io/martha.git
cd martha
mkdir -p ~/.local/bin
ln -s "$PWD/bin/martha" ~/.local/bin/martha
martha --version
```

`martha --version` prints the release's version. If your shell cannot find
`martha`, put `~/.local/bin` on your `PATH`.

### Upgrading an installed Martha

Once Martha is installed, upgrade it with its own command, never with the
bootstrap line above:

```sh
martha install [<version>] [--downgrade] [--digest sha256:<hex>]
```

`martha install` runs the installer **the release you are running pins**, and no
other. Each release carries a pin — `installer.json`, three fields: the
installer's name, its version, and the npm integrity of the bytes npm serves for
it. The release job writes it from npm's own provenance, and refuses to build a
release unless the bytes it pins were published by this repository's installer
workflow at its own `installer-v` tag, from this tree's `installer/`. So taking
over the npm account cannot put a new installer in front of you: the release
that vouched for those bytes is signed, and its pin names them by hash.

What it does, in order: reads the pin from the running release (missing or
malformed is a refusal, before anything is fetched); fetches exactly that
version into a temporary directory with the npm that ships beside your node,
empty user and global config, this registry named explicitly, its own cache and
`--ignore-scripts`; refuses bytes that do not match the pin and never retries
them; runs the installer with your arguments unchanged; and removes the
temporary directory whatever happens.

It needs no terminal: a member with a shell can already type the bootstrap line,
so the pin and the signature are what bound an install, not who typed it.

What a refusal means:

| What you see | What it means |
|---|---|
| `... carries no readable installer pin ...` | this release predates the pin; upgrade once with the bootstrap line above |
| `... the installer pin in this release carries no <field> ...` | the release's pin is damaged: do not run it, install a good release |
| `... pins <name>, and Martha's installer is <name>.` | the pin names a package this release does not accept: do not run it |
| `... npm does not serve <name>@<version>, which this release pins ...` | that installer version is gone from npm, or never published; nothing was installed |
| `... npm served bytes for <name>@<version> that are not the ones this release pins ...` | npm is serving other bytes than the release vouched for; nothing was installed |
| `... the npm of this node is not at <path> ...` | your Node came without npm; use the bootstrap line, or a Node that carries npm |

**Changing `installer/` needs an npm publish before the next Martha release.**
The release pins the installer version this tree carries, and refuses to build
when `installer/` is not what that version's `installer-v` tag published — a fix
merged there without a version bump and a publish stops the release, in words,
instead of quietly never reaching anyone.

Then follow [getting started](docs/getting-started.md): a crew of two on your
own project.

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
