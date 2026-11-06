# Nothing private gets in

This exists so that code moved into this public repository from a private one
carries nothing that belongs to the private side: no link to a private issue, no
internal host name, no private remote. A check in CI fails, by name, the moment
one gets in.

Martha's first code is written fresh here, but most of what it becomes is moved
in from a private repository where those things were normal to write. A comment
that cites a private issue is a dead link once public, and it says where the
private work lives. A fallback remote that names a private repository tells every
reader where to look. A lab host name is a map of the network.

## What could leak, and through which path

| What | Example of the shape | How it arrives |
|------|----------------------|----------------|
| A private issue or PR link | `synthetic-owner/private-repo#123`, `https://github.com/synthetic-owner/private-repo/issues/123` | a comment or doc moved as written |
| A shorthand link to another repository | `synthetic-repo#123` | the same; the owner is implied, so nothing outside the author's head says whether it is public |
| A private remote or repository name | `git@github.com:synthetic-owner/private-repo.git`, a constant holding `synthetic-owner/private-repo` | a fallback, a default, an install script |
| An internal host name | a `*.lab` name, a lab machine named by its family and number | a log line, a comment, a test fixture |
| A home directory, a private address, a private email, a real node id or key | `/home/<user>`, RFC 1918 addresses, a 64-hex id | the same classes the crew's note check and release scan already refuse |

Each of those can enter through four paths:

1. **The tree at the head of a pull request** — a file as it will be merged,
   and its path: a file named after a machine publishes the name with no text
   at all. Every tracked path, and every path a commit adds, is read as a line.
2. **A commit inside the pull request** that a later commit removes. GitHub keeps
   every pushed commit of a pull request reachable, so a leak that the final tree
   no longer shows is still public. The check reads every commit's added lines.
3. **A commit message.** It is published with the commit. The check reads it.
4. **The check's own output.** A CI log of a public repository is public. The lab's
   machine families are therefore never printed: a hit names the file, the line
   and the class, and withholds the value. Nothing else printed carries one
   either: a lab name in a path, a repository name or a shorthand is replaced
   by `<lab host>`.

Out of reach of this check, and said here so nobody assumes otherwise:

- **A push is public before CI runs.** The check makes a leak fail the pull
  request so it never merges, but it cannot unpublish a pushed commit. Run it
  before you push (`npm run check:private`, below). A leak that was pushed is
  handled as an incident, not by a later commit: the range keeps failing on
  that commit, so the work lands from a fresh branch of clean commits and the
  old branch is deleted.
- **The pull request's title, body and comments** are not code and are not read.
- **A private fact said in plain words** ("the box in the cupboard") matches no
  shape. The check guards shapes; the rewrite rule below guards the rest.

## How each class is decided

- **Repository references are resolved, not listed.** Every `owner/repo` the
  check finds — in a GitHub URL, an ssh or https remote, an `owner/repo#n`
  reference, or a bare slug under an owner this repository declares — is looked
  up on the GitHub API. Only a repository the API reports as public passes. An
  unknown repository, a renamed-away one, and a private one all fail. A list of
  private repositories would have to name them in this public repository, and
  would quietly pass every one it was not taught. The lookup reads the
  repository's visibility, not whether the caller can see it, so running it with
  a token that can read private repositories still refuses them.
- **A shorthand reference to another repository is refused** (`synthetic-repo#123`).
  Only this repository's own `martha#n` passes. Write `owner/repo#n` so the
  check, and a reader, can tell what it points at.
- **Lab machine families are a secret, not a file.** The generic classes (every
  `*.lab` name, every home directory, every RFC 1918 address) need no list. The
  families of the lab's machines do, and the list is itself private, so CI reads
  it from the `MARTHA_LAB_HOSTS` repository secret (a JSON array). A pull request
  from a fork gets no secrets: there the check runs every other class and says
  which one it skipped. Anywhere else, a missing list stops the check rather than
  passing it.
- **A public digest passes only where it is written as one.** A sha256 digest
  of a public file has the shape of a node id or a key, so a bare 64-hex string
  is refused whatever it is. A digest passes when the text around it says it is
  a digest: labelled as a sha256 (an image's `@sha256:<digest>`, an OCI
  `sha256:<digest>`, a `sha256` field in YAML, JSON or TOML), with the label
  standing alone, so `node-sha256:` or `?sha256=` is not one; or a sha256sum
  line checked where it is written, a quoted `<digest>  <file>` piped on the
  same line to `sha256sum -c` (or `shasum -a 256 -c`). A table of ids beside
  host names, addresses or versions has the sha256sum shape and no check, so it
  is refused. Each form vouches for the digest it holds and nothing else: an id
  beside it on the same line is still refused. The forms guard against an id
  pasted by accident; an id disguised on purpose as `sha256:<id>` is out of
  reach of any text rule. The forms, with how each is written, are one definition in
  `src/check_nothing_private_gets_in/public_digest.ts`, and the tests plant
  every written form with a real-shaped digest drawn at run time.
- **An id is seen wherever it is written, not only standing alone.** The hex
  class is 64 lowercase hex digits in a row, with no word boundary. So an id
  glued to a letter, a digit or `_` (`x<id>`, `id_<id>`, `<id>_key`) is
  refused, and so is any hex run longer than 64: two ids back to back, an id
  with more hex after it, a 128-hex Ed25519 secret key or signature. The hit
  names the whole hex run the id sits in. A run longer than 64 is refused even
  where a digest form holds it, because a digest form vouches only for a run of
  exactly 64. A sha512 written in hex is therefore refused, labelled or not;
  a crew that must publish one declares a form for it first. A run shorter
  than 64, such as a 40-hex git commit sha or a range of them, is outside this
  class. The length and the digit set are defined once (`HEX_DIGIT`,
  `ID_HEX_DIGITS` in `public_text.ts`), and the shared pattern stays POSIX ERE,
  so a `grep -E` reader refuses any line that holds such a run.
- **The text classes are one definition.** The patterns are the crew's own
  public-text classes, the same ones its note check and release scan hold to.

The check cannot be made when the API cannot answer, the list is missing outside
a fork, or git cannot read the range. It then exits 2 and CI fails: it never
passes because it could not look.

## Synthetic values

A test of a refusal has to state the value it refuses, and that test lives in
this public tree, where the check reads it too. Each class therefore has one
synthetic form that the tree scan accepts: a lab name ending `-synthetic` (`ci-synthetic.lab`), a machine
number in the 90s, `/home/synthetic`, the `192.168.255.0/24` block, the
`synthetic.invalid` email domain, the listed all-one-digit ids, and repository
owners starting `synthetic-`. The unit tests prove each class refuses its own
synthetic form when the allowance is off, and a structural test holds every form
to a whole-value match, so an allowance cannot swallow a real value that merely
contains one.

## The rewrite rule for moved code

Keep the reasoning, drop the link.

- A private issue reference: say what was decided and why, in the comment
  itself. If a public issue carries the same decision, link that, as
  `owner/repo#n`.
- An internal host name: name the role ("the CI runner", "a lab box"), not the
  machine.
- A private remote or repository: take it from configuration, or name the public
  repository it should be.
- A home directory, address or id: use the synthetic form, or a placeholder in
  angle brackets.

## Running it

```sh
# The tree as it is, every class except the lab's families:
MARTHA_LAB_HOSTS='[]' npm run check:private

# What CI runs on a pull request: the tree, then every commit in the range.
MARTHA_LAB_HOSTS='["<family>"]' GITHUB_TOKEN=... npm run check:private -- --range <base>..<head>
```

Exit 0 is clean, 1 lists one hit per line as `where: what`, and 2 means the check
could not be made.
