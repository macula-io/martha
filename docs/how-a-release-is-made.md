# How a release is made

This exists so a maintainer can follow how a Martha release is built, signed and
published, and what stops one. Someone who only wants to install Martha needs
none of it: that is the npm page, [the installer's README](../installer/README.md).

## The steps

1. The release dry run (`release-dry-run.yml`, started by hand on a branch) pushes the packed tree into the release
   package under a `dry-run-<run>-<attempt>` tag, which is never a version, so no install ever takes it. It signs it
   through the same signing workflow, then checks that the signature verifies for that branch and is refused for
   `refs/tags/v<version>`, that an unsigned image is refused, and that the layer is exactly the committed tree plus
   the installer pin and the `floor.json` the packer generates after it. It packs through the same
   `pack_a_release.sh`, so a floor that would stop a release stops the dry run first.
   Its two tags are kept in the public package, not pruned: one pair per run, and runs are started by hand.
   Neither is ever installed: no tag of that shape is a version, and the signature is for a branch, so an install,
   which demands `refs/tags/v<version>`, refuses it. Pruning would need a workflow that can delete package versions,
   and none of Martha's workflows holds that power. A maintainer may delete old ones by hand in the package settings.
2. The first dry run is what makes the release package. The maintainers then link it to this repository and make it
   public, before any release tag: every install pulls anonymously, and a refused pull must never read as
   "unsigned".
3. `installer-v<version>` publishes the installer to npm, with provenance, through trusted publishing.
4. `v<version>` publishes a signed Martha release into the package, pinning that installer.

## The version floor

Once a machine runs a release that carries the floor, no script, page or typed command can put it back on an older
release that also carries the floor, unless the owner has published a withdrawal for that exact version (martha#21,
R9 of #84). So an older release's weaker gates are never placed on a machine that has already passed them.

| Floor | Where | Who sets it |
|---|---|---|
| the project's | `floor.txt` at the root, one `X.Y.Z` line | a reviewed commit |
| the one a release declares | `floor.json`, `{ "floor": "X.Y.Z" }`, which the packer generates into the layer from `floor.txt` | the release signature, which covers the layer |
| this machine's | `floor` beside `releases/`, in `$XDG_DATA_HOME/martha/` (default `~/.local/share`) | the installer, after each install |

- **Raising it** is an ordinary release with a reviewed edit to `floor.txt`. The first value, `0.2.0`, is the first
  release that carries the floor, so the releases nothing of ours checks are exactly the ones before it.
- **Installing** refuses a version below this machine's floor, even with `--downgrade`, and a release whose
  `floor.json` is missing, malformed or above the release itself. After `current` is swapped, the machine's floor
  becomes the higher of what it held and what the release declares: an ordinary install never lowers it.
- **Launching** a placed release below this machine's floor is refused for every act but `martha --version` and
  `martha install`, which puts the highest signed release back. The launcher finds the floor from its own real path,
  beside the `releases/` it sits in, never from the environment.
- **Lowering it** is the owner's act alone: a release that carries a tracked `floor-withdrawal.json`,
  `{ "version": "X.Y.Z", "from": "X.Y.Z" }`. The publish is what makes it the owner's: that release passes the same
  tag-on-main and version guard, and the same signature, as any release, so there is no new key, workflow or signer
  to rotate. A user names it with `--withdrawal-in <that release>`. The installer verifies and unpacks it, never
  installs it, and honours it only for exactly `version`, and only while this machine's floor is exactly `from`. On
  success the machine's floor becomes `version`, written after `current` swapped, so a failed install leaves it
  where it was.
- **Ending a withdrawal** takes a release whose `floor.txt` is above its `from`. Until then the same file lowers the
  floor again on a machine that went back up to `from`: the owner's statement still stands. Delete
  `floor-withdrawal.json` in that release, too: the packer refuses one whose `from` is below `floor.txt`, so a
  dead withdrawal never ships.

The installer checks the floor from its version `1.1.0` on, and every release that carries the floor pins one at
or above it. The order for the first such release is `installer-v1.1.0`, then `v0.2.0`. From the commit that added `floor.txt` on, no
`0.1.x` release can be packed.

What it stops: **T19**, a command, script or page naming an older release that carries the floor; and **T20**, a
forged, mis-signed or still-live withdrawal used where the owner did not mean it. What it does not:

- **R10.** The bootstrap line names the installer version itself. An installer from before the floor has no floor
  check, and will place a release from before the floor, whose launcher has none either. Nothing of ours runs on that
  path, and npm cannot withdraw a version after 72 hours, so it stays open for good. The next install by a
  floor-aware installer, and every later launch of a release that carries the floor, stops it.
- **R11.** The machine's floor is a file its user owns. Whoever can write it can move it, as they can move `current`
  (R7). A withdrawal also ends per machine: one that never installed the release that raised the floor past its
  `from` still honours it.
- **R12.** A launcher running from a checkout, not from a placed release, has no machine floor: running a checkout
  is running your own code.

## What stops a publish

Neither tag publishes while a dependency of Martha or of its installer carries a known published advisory
(`advisories.yml`, which also runs on every pull request). An advisory is fixed or waived by a dated, named, expiring
row in `.github/advisories-waivers.txt`; there is no baseline. The `overrides` in `package.json` are such fixes:
sigstore 5.0.0 resolves glob 13 and minimatch 10, which carry GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249, so the
installer pins their first patched releases. Its callers use only `glob(pattern, options)` and
`minimatch(path, pattern)`, which both majors keep. Drop an override once sigstore resolves a patched release itself.
