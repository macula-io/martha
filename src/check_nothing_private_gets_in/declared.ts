// What this repository declares about its own text. All of it is public: the
// lab's machine families are not here, because they are private (CI reads them
// from the MARTHA_LAB_HOSTS secret).
export const DECLARED = {
  // The email domain this repository's text may name.
  publicEmails: ['macula.io'],
  // Owners whose bare `owner/repo` slugs are looked up even without a URL, so a
  // constant holding a private repository's slug is caught.
  owners: ['macula-io', 'macula-services', 'macula-internal', 'reckon-db-org', 'beam-campus', 'hecate-social', 'rgfaber'],
  ownRepo: 'martha',
} as const
