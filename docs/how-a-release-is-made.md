# How a release is made

This exists so a maintainer can follow how a Martha release is built, signed and
published, and what stops one. Someone who only wants to install Martha needs
none of it: that is the npm page, [the installer's README](../installer/README.md).

## The steps

1. The release dry run (`release-dry-run.yml`, started by hand on a branch) pushes the packed tree into the release
   package under a `dry-run-<run>-<attempt>` tag, which is never a version, so no install ever takes it. It signs it
   through the same signing workflow, then checks that the signature verifies for that branch and is refused for
   `refs/tags/v<version>`, that an unsigned image is refused, and that the layer is exactly the committed tree.
   Its two tags are kept in the public package, not pruned: one pair per run, and runs are started by hand.
   Neither is ever installed: no tag of that shape is a version, and the signature is for a branch, so an install,
   which demands `refs/tags/v<version>`, refuses it. Pruning would need a workflow that can delete package versions,
   and none of Martha's workflows holds that power. A maintainer may delete old ones by hand in the package settings.
2. The first dry run is what makes the release package. The maintainers then link it to this repository and make it
   public, before any release tag: every install pulls anonymously, and a refused pull must never read as
   "unsigned".
3. `installer-v<version>` publishes the installer to npm, with provenance, through trusted publishing.
4. `v<version>` publishes a signed Martha release into the package, pinning that installer.

## What stops a publish

Neither tag publishes while a dependency of Martha or of its installer carries a known published advisory
(`advisories.yml`, which also runs on every pull request). An advisory is fixed or waived by a dated, named, expiring
row in `.github/advisories-waivers.txt`; there is no baseline. The `overrides` in `package.json` are such fixes:
sigstore 5.0.0 resolves glob 13 and minimatch 10, which carry GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249, so the
installer pins their first patched releases. Its callers use only `glob(pattern, options)` and
`minimatch(path, pattern)`, which both majors keep. Drop an override once sigstore resolves a patched release itself.
