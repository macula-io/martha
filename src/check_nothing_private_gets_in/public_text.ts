// The classes of text a public tree may not carry, in ONE definition.
//
// These are the crew's own public-text classes, verbatim: the same strings its
// note check (what a note may carry into a public issue) and its release scan
// (what a published package may carry) hold to. When that code moves into this
// repository it brings this object with it, and the two become one file.
//
// The strings are POSIX ERE as well as JavaScript, because a grep -E reader
// holds to them too: no \d, and a group is a plain group.
//
// What is a crew's own is declared, not coded: the families of its machine names
// (`%s` in lab_machine) and the email domains it may name. A crew that declares
// nothing still refuses every `*.lab` hostname.
export const PUBLIC_TEXT_PATTERNS = {
  lab_fqdn: String.raw`\b[a-z0-9-]+\.lab\b`,
  lab_machine: String.raw`\b(%s)[0-9][0-9]\b`,
  home_dir: String.raw`/(home|Users)/[a-z_][a-z0-9_-]*`,
  private_address: String.raw`\b(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})\b`,
  email: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`,
  hex_id: String.raw`\b[0-9a-f]{64}\b`,
  allow_home: String.raw`^/(home|Users)/(test|probe|x|ops)$`,
  allow_email: String.raw`noreply@anthropic\.com|git@github\.com|[A-Za-z0-9._%+-]+@example\.(com|org|invalid)`,
}
