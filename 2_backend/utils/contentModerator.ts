const BLOCKED_PATTERNS: RegExp[] = [
  // Extreme Profanity & Hate Slurs
  /\b(nigger|nigga|faggot|fag|kike|chink|spic|wetback|retard|tranny|cunt)\b/i,
  // Sexual / NSFW Content
  /\b(porn|pornhub|xvideos|xnxx|hentai|nsfw|rule34|r34|e621|clop|clopping|onlyfans|blowjob|handjob|cumshot|masturbat\w*|erotic\w*|xxx|nude|nudes|naked|bdsm|fetish|genital\w*|penis|vagina|boobs|tits|dickpic)\b/i,
  // Gore / Self-Harm / Extreme Violence
  /\b(gore|behead\w*|decapitat\w*|dismember\w*|mutilat\w*|suicide|kill\s*yourself|kys|self[- ]?harm|liveleak|bestgore|snuff)\b/i,
];

const MALICIOUS_LINK_PATTERNS: RegExp[] = [
  // Raw IPv4 URLs
  /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
  // Executable / dangerous file downloads
  /https?:\/\/[^\s]+\.(exe|scr|bat|cmd|msi|vbs|ps1|apk|jar|dll|iso|dmg)(\?[^\s]*)?$/i,
  // URL shorteners & IP grabbers
  /https?:\/\/(bit\.ly|tinyurl\.com|grabify\.link|iplogger\.org|2no\.co|blasze\.tk|ps3cfw\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|adf\.ly|shorte\.st)\//i,
  // Punycode homograph phishing domains
  /https?:\/\/xn--/i,
  // Script / data URI injections
  /(javascript:|data:text\/html)/i,
];

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
}

export function moderateForumContent(text: string): ModerationResult {
  const input = String(text || '').trim();
  if (!input) {
    return { allowed: false, reason: 'Content cannot be empty.' };
  }

  // Normalize leetspeak evasions (e.g., p0rn, n1gg3r, f@g)
  const normalized = input
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(input) || pattern.test(normalized)) {
      return {
        allowed: false,
        reason:
          'Post blocked by Equestrian Community Safety Filter: NSFW, sexual content, gore, or extreme profanity is prohibited.',
      };
    }
  }

  // Validate all external URLs
  const urls = input.match(/https?:\/\/[^\s<>"')]+/gi) || [];
  for (const rawUrl of urls) {
    for (const badLink of MALICIOUS_LINK_PATTERNS) {
      if (badLink.test(rawUrl)) {
        return {
          allowed: false,
          reason: `Unsafe or disallowed external link detected (${rawUrl}). Direct executables, IP links, and URL shorteners are blocked.`,
        };
      }
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { allowed: false, reason: 'Only standard HTTP/HTTPS web links are permitted.' };
      }
    } catch {
      return { allowed: false, reason: 'Malformed external URL detected.' };
    }
  }

  return { allowed: true };
}