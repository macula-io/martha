// What this repository declares about its own text. All of it is public: the
// lab's machine families are not here, because they are private (CI reads them
// from the MARTHA_LAB_HOSTS secret).
export const DECLARED = {
  // The email domain this repository's text may name.
  publicEmails: ['macula.io'],
  // Identifiers shaped like an address that are not one. OpenSSH names its FIDO
  // key type this way, and the trust-list verifier must name it. Only this exact
  // string passes; any other address at that domain is still refused.
  publicAddresses: ['sk-ssh-ed25519@openssh.com'],
  // Owners whose bare `owner/repo` slugs are looked up even without a URL, so a
  // constant holding a private repository's slug is caught.
  owners: ['macula-io', 'macula-services', 'macula-internal', 'reckon-db-org', 'beam-campus', 'hecate-social', 'rgfaber'],
  ownRepo: 'martha',
} as const
