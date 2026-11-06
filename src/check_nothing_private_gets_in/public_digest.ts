// The forms in which a 64-hex string is a public digest, in ONE definition.
//
// A sha256 digest of a public file has the shape of a node id or a key: 64
// lowercase hex characters. The value alone cannot tell them apart, so the check
// refuses every bare one. What can tell them apart is the text around it: a
// digest is written as a digest. Each form below is a context that says so, and
// a 64-hex string passes only where one of these forms holds it. Anything else,
// a bare id beside a digest included, is still refused.
//
// `%h` is the hex class's own pattern (PUBLIC_TEXT_PATTERNS.hex_id); the form's
// first group is the digest. `written` lists how each form is written in this
// repository, with `%h` for the digest: the docs show them, the tests plant them.
export const HEX_SLOT = '%h'

export interface DigestForm {
  readonly pattern: string
  readonly written: readonly string[]
}

export const PUBLIC_DIGEST_FORMS: Readonly<Record<string, DigestForm>> = {
  // Labelled as a sha256: an image reference's `@sha256:`, an OCI `sha256:`
  // digest, or a field named sha256 in YAML, JSON or TOML. The label is a word
  // of its own: `node_sha256:` is not one.
  labelled_sha256: {
    pattern: String.raw`\b(?:sha256|SHA256)["']?[ \t]*[:=][ \t]*["']?(%h)`,
    written: [
      'example.org/image@sha256:%h',
      'sha256:%h',
      'sha256: %h',
      '"sha256": "%h"',
      'sha256 = "%h"',
    ],
  },
  // A sha256sum line: the digest opens the line (after its indentation) or a
  // quoted string, then the tool's own separator, two spaces or a space and a
  // star, then the file it is the digest of. The file name has an extension, so
  // a word after an id is not read as a file, and a word before one is not a line.
  sha256sum_line: {
    pattern: String.raw`(?:^[ \t]*|(?<=["']))(%h)(?:  | \*)[A-Za-z0-9_][A-Za-z0-9._+/-]*\.[A-Za-z0-9_+-]+`,
    written: [
      '%h  direnv.linux-amd64',
      '%h *release.tar.gz',
      '  %h  release.tar.gz',
      'echo "%h  direnv.linux-amd64" | sha256sum -c',
    ],
  },
}

// Where in a line a declared form holds a digest: the start of each digest it
// holds. A 64-hex string passes only when it starts at one of these.
export const digestStartsIn = (text: string, hexPattern: string): ReadonlySet<number> =>
  new Set(
    Object.values(PUBLIC_DIGEST_FORMS).flatMap((form) =>
      [...text.matchAll(new RegExp(form.pattern.replaceAll(HEX_SLOT, hexPattern), 'gd'))].flatMap((found) =>
        found.indices?.[1] === undefined ? [] : [found.indices[1][0]],
      ),
    ),
  )
