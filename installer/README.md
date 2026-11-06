# @macula-io/martha

Installs [Martha](https://github.com/macula-io/martha) from its signed public package, with nothing but Node.

```sh
npx -y --ignore-scripts @macula-io/martha@<exact version> [<martha version>]
```

Always name the installer's exact version: npm never lets a published version be replaced, so that line is what you
trust. Leave out the Martha version to install the highest one; name it to install exactly that one.

## What it checks, before anything is written

1. The Node running it is one Martha runs on.
2. The version resolves once, to a digest computed from the manifest's bytes. Never `:latest`.
3. A version lower than the installed one needs `--downgrade` and the version named; a second digest for a version
   you hold is always refused.
4. The digest carries a Sigstore signature from `macula-io/macula-ci-images`' `attest-image.yml`, at a commit listed
   in `signers.txt`, for `github.com/macula-io/martha` and the tag `v<version>`. A signature check that could not
   run says "could not check", never "unsigned".
5. The one layer matches its digest and size; every tar entry is checked (and the unpacked size, the number of
   entries and every name capped) before a byte is written.
6. The release gets its own read-only directory under `$XDG_DATA_HOME/martha/releases/` (default
   `~/.local/share`), `current` is swapped to it by one rename, and `~/.local/bin/martha` links through `current`
   when the release carries a `martha` command.

Check the installer itself with `npm audit signatures`: it is published with provenance from this repository.

## Options

```text
martha-install [<version>] [--downgrade] [--digest sha256:<hex>]
```

## How a release is made

1. The release dry run (`release-dry-run.yml`, started by hand on a branch) pushes the packed tree into the release
   package under a `dry-run-<run>-<attempt>` tag, which is never a version, so no install ever takes it. It signs it
   through the same signing workflow, then checks that the signature verifies for that branch and is refused for
   `refs/tags/v<version>`, that an unsigned image is refused, and that the layer is exactly the committed tree.
2. The first dry run is what makes the release package. The maintainers then link it to this repository and make it
   public, before any release tag: every install pulls anonymously, and a refused pull must never read as
   "unsigned".
3. `installer-v<version>` publishes this installer to npm, with provenance, through trusted publishing.
4. `v<version>` publishes a signed Martha release into the package, pinning that installer.

## License

Apache-2.0
