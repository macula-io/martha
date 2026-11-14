<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/macula-io/martha/main/assets/martha-full-dark.svg">
    <img src="https://raw.githubusercontent.com/macula-io/martha/main/assets/martha-full-light.svg" alt="Macula Martha" width="320">
  </picture>
</p>

# @macula-io/martha

**Goal:** one developer, or a whole team, runs a crew of coding agents that plans, builds, reviews and releases
software, with one method and one tool.

This is the installer for [Martha](https://github.com/macula-io/martha): it installs Martha from its signed public
package, with nothing but Node.

```sh
npx -y --ignore-scripts @macula-io/martha@<exact version> [<martha version>]
```

Always name the installer's exact version: npm never lets a published version be replaced, so that line is what you
trust. Leave out the Martha version to install the highest one; name it to install exactly that one.

## What it checks, before anything is written

1. The Node running it is one Martha runs on.
2. The version resolves once, to a digest computed from the manifest's bytes. Never `:latest`.
3. A version lower than the installed one needs `--downgrade` and the version named; a second digest for a version
   you hold is always refused. A version below the floor this machine holds is refused even then (see below).
4. The digest carries a Sigstore signature from `macula-io/macula-ci-images`' `attest-image.yml`, at a commit listed
   in `signers.txt`, for `github.com/macula-io/martha` and the tag `v<version>`. A signature check that could not
   run says "could not check", never "unsigned".
5. The one layer matches its digest and size; every tar entry is checked (and the unpacked size, the number of
   entries and every name capped) before a byte is written.
6. The release gets its own read-only directory under `$XDG_DATA_HOME/martha/releases/` (default
   `~/.local/share`), `current` is swapped to it by one rename, and `~/.local/bin/martha` links through `current`
   when the release carries a `martha` command. The release's `floor.json` is read before the rename, and once
   `current` is swapped this machine's floor becomes the higher of what it held and what the release declares.

Check the installer itself with `npm audit signatures`: it is published with provenance from this repository.

## The version floor

Each release declares a floor, and this machine keeps its own in `$XDG_DATA_HOME/martha/floor` (default
`~/.local/share`). An ordinary install only ever raises it. Below it, the installer places nothing and an installed
`martha` refuses to start, so an older release's weaker checks never come back to a machine that has passed them.
`martha install` puts the highest signed release back.

The only way below the floor is a withdrawal the project published: a later release carrying `floor-withdrawal.json`,
which names the one version it permits and the floor it lowers from. Name that release with `--withdrawal-in`:

```sh
martha install <older version> --downgrade --withdrawal-in <the release that carries the withdrawal>
```

It is checked with the same signature as any release, it is never installed itself, and it is honoured only while this
machine's floor is the one it lowers from.

## Options

```text
martha-install [<version>] [--downgrade] [--digest sha256:<hex>] [--withdrawal-in <version>]
```

## How a release is made

For maintainers: how a release is built, signed and published, and what stops one, is in
[the repository's docs](https://github.com/macula-io/martha/tree/main/docs), in `how-a-release-is-made.md`.

## License

Apache-2.0
