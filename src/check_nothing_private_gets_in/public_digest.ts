// The forms in which a 64-hex string is a public digest, in ONE definition.
//
// A sha256 digest of a public file has the shape of a node id or a key: 64
// lowercase hex characters. The value alone cannot tell them apart, so the check
// refuses every bare one. What can tell them apart is the text around it: a
// digest is written as a digest. Each form below is a context that says so, and
// a 64-hex string passes only where one of these forms holds it. Anything else,
// a bare id beside a digest included, is still refused.
//
// A form guards against an id pasted by accident, not one disguised on purpose:
// no text rule can tell a deliberate `sha256:<id>` from a digest.
//
// `%h` marks the digest: the check fills it with the hex class's own pattern
// (PUBLIC_TEXT_PATTERNS.hex_id). `written` lists how each form is written in
// this repository, with `%h` for the digest: the docs show them, the tests
// plant them.
export const HEX_SLOT = '%h'

export interface DigestForm {
  readonly pattern: string
  readonly written: readonly string[]
}

export const PUBLIC_DIGEST_FORMS: Readonly<Record<string, DigestForm>> = {
  // Labelled as a sha256: an image reference's `@sha256:`, an OCI `sha256:`
  // digest, or a field named sha256 in YAML, JSON or TOML. The label stands
  // alone: it opens the line or follows a space, a quote, `@`, `{`, `,` or `[`,
  // so `node-sha256:`, `peer.sha256:` and `?sha256=` are not one.
  labelled_sha256: {
    pattern: String.raw`(?:^|(?<=[\s"'@{,\[]))(?:sha256|SHA256)["']?[ \t]*[:=][ \t]*["']?%h`,
    written: [
      'example.org/image@sha256:%h',
      'sha256:%h',
      '  sha256: %h',
      '{"sha256": "%h"}',
      'sha256 = "%h"',
    ],
  },
  // A sha256sum line, checked where it is written: a quoted `<digest>  <file>`
  // (or `<digest> *<file>`) piped on the same line to sha256sum, or shasum -a
  // 256, with -c or --check. A table of ids beside host names, addresses or
  // versions has the same shape and no check, so it is refused.
  checked_sha256sum_line: {
    pattern: String.raw`(["'])%h(?:  | \*)[A-Za-z0-9_./+-]+\1[ \t]*\|[ \t]*(?:sha256sum|shasum[ \t]+-a[ \t]*256)(?:[ \t]+-[-A-Za-z]*)*?[ \t]+(?:-c|--check)(?![-A-Za-z])`,
    written: [
      'echo "%h  direnv.linux-amd64" | sha256sum -c',
      "echo '%h *direnv' | shasum -a 256 --check",
      'echo "%h  release.tar.gz" | sha256sum --strict --check -',
    ],
  },
}

// The finder over every form, built once: given a line, where each digest a form
// holds starts. A 64-hex string passes only when it starts at one of these.
export const digestStartsFinder = (hexPattern: string) => {
  const forms = Object.values(PUBLIC_DIGEST_FORMS).map(
    (form) => new RegExp(form.pattern.replaceAll(HEX_SLOT, `(?<digest>${hexPattern})`), 'gd'),
  )
  return (text: string): ReadonlySet<number> =>
    new Set(
      forms.flatMap((form) =>
        [...text.matchAll(form)].flatMap((found) => {
          const at = found.indices?.groups?.['digest']
          return at === undefined ? [] : [at[0]]
        }),
      ),
    )
}
