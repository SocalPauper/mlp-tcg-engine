import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

// Known Kayou MLP TCG bracketed names & traits
const KNOWN_BRACKET_TERMS = [
  'Twilight Sparkle',
  'Fluttershy',
  'Pinkie Pie',
  'Applejack',
  'Rainbow Dash',
  'Rarity',
  'Spike',
  'Princess Celestia',
  'Princess Luna',
  'Princess Cadance',
  'Starlight Glimmer',
  'Trixie',
  'Apple Bloom',
  'Sweetie Belle',
  'Scootaloo',
  'Big McIntosh',
  'Granny Smith',
  'Earth Pony',
  'Unicorn',
  'Pegasus',
  'Alicorn',
  'Pet',
  'Nightmare Night',
  "Hearth's Warming Eve",
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function closestBracketTerm(rawInner: string): string {
  const cleaned = rawInner.replace(/[^A-Za-z' ]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) return rawInner;

  let bestTerm = cleaned;
  let bestDist = Infinity;
  for (const term of KNOWN_BRACKET_TERMS) {
    const dist = levenshtein(cleaned.toLowerCase(), term.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestTerm = term;
    }
  }
  // Accept fuzzy match if within ~40% edit distance
  return bestDist <= Math.ceil(bestTerm.length * 0.42) ? bestTerm : cleaned;
}

export function contextualRepairEffectText(
  rawText: string,
  cardType: string
): string {
  if (!rawText || !rawText.trim()) return '';

  let s = rawText
    .replace(/\r?\n+/g, ' ')
    .replace(/[|\\/]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const normalizedType = String(cardType || '').toLowerCase();

  // 1. Story Cards: Anchor to "When promoted to this stage" and strip bottom Story title noise
  if (normalizedType === 'story') {
    // Repair corrupted "When promoted to this stage" prefix
    s = s.replace(
      /^.*?\b(?:When|vinci|Wh)\s+[a-z]{4,12}\s+to\s+[a-z]{2,6}\s+[a-z]{3,7}[,;:]?\s*/i,
      'When promoted to this stage, '
    );
    if (!/^When promoted to this stage/i.test(s)) {
      const promotedIdx = s.search(/promoted\s+to\s+this\s+stage/i);
      if (promotedIdx !== -1) {
        s = 'When ' + s.slice(promotedIdx);
      }
    }

    // Truncate Story title / episode banner appearing after the main sentence period
    const periodMatch = s.match(/^(When promoted to this stage,[^.]+\.)/i);
    if (periodMatch) {
      s = periodMatch[1];
    } else if (/win\s+the\s+game|thelgame/i.test(s)) {
      s = 'When promoted to this stage, you win the game.';
    }
  } else {
    // 2. Non-Story Cards: Detect leading keyword pill vs garbled pill artifacts
    const hasTap = /^(?:[A-Z]{1,5}\.?\s+)?Tap\b/i.test(s);
    if (hasTap) {
      s = s.replace(/^(?:[A-Z]{1,5}\.?\s+)?Tap\b[:.]?\s*/i, 'Adventure: Tap ');
    } else {
      // Strip leading 1-6 char OCR noise before the first real grammar starter word
      s = s.replace(
        /^[^A-Za-z]*(?:[A-Za-z]{1,6}[^A-Za-z]+){0,3}(?=(?:Appear|Farewell|Adventure|Pre-?Plan|Inspo|When|While|If|Only|Choose|Draw|Reveal|Discard|Put|Switch|Move|Each|All|Adorn|This|The)\b)/i,
        ''
      );
    }

    // Strip trailing 1-5 char OCR noise after the final period
    s = s.replace(/(\.)\s*[^A-Za-z0-9」)]*([A-Za-z]{1,4}\s*){1,2}$/, '$1');
  }

  // 3. Fuzzy-repair bracketed names/traits: [Earth Pony J, IFllttershy.], [Tiwilight:Sparkle, etc.
  s = s.replace(/[\[\(「｢I]\s*([A-Za-z:.' -]{3,26}?)\s*[\]\)」｣J.]/g, (_, inner) => {
    const fixed = closestBracketTerm(inner);
    return `「${fixed}」`;
  });

  // 4. Contextual Grammar & Zone Phrase Reconstruction
  s = s
    // Zones
    .replace(/\b(?:in|into|from)\s+you[rl]?\s+[A-Za-z\\]{4,12}\s*[\\/.]?\s*Are[a-z]*/gi, (m) => {
      if (/retire|etite|stite/i.test(m)) return m.replace(/you[rl]?\s+.*$/i, 'your Retirement Area');
      if (/scen|cen/i.test(m)) return m.replace(/you[rl]?\s+.*$/i, 'your Scene Area');
      if (/stor/i.test(m)) return m.replace(/you[rl]?\s+.*$/i, 'your Story Area');
      return m.replace(/you[rl]?\s+.*$/i, 'your Adventure Area');
    })
    .replace(/\b(?:in|into|from)\s+Rival['’]?[is]?\s+[A-Za-z\\]{4,12}\s*[\\/.]?\s*Are[a-z]*/gi, (m) => {
      if (/stor/i.test(m)) return m.replace(/Rival.*$/i, "Rival's Story Area");
      if (/scen/i.test(m)) return m.replace(/Rival.*$/i, "Rival's Scene Area");
      return m.replace(/Rival.*$/i, "Rival's Adventure Area");
    })
    .replace(/\bAdventur[a-z]*\s+[\\/.]?re[a-z]*/gi, 'Adventure Area')
    .replace(/\b(?:R|et|St)etiremen[a-z]*\s+Are[a-z]*/gi, 'Retirement Area')
    .replace(/\b[Sc]?cene\s+Area\b/gi, 'Scene Area')
    // Common truncated words at line breaks
    .replace(/\bad\s+t\s+to\s+Hand\b/gi, 'add it to Hand')
    .replace(/\badd\s+ig\s*to\s*Hand\b/gi, 'add it to Hand')
    .replace(/\bwhe\s+layed\s+from\s+Hand\b/gi, 'when played from Hand')
    .replace(/\bii\s+our\s+turn\b/gi, 'in your turn')
    .replace(/\bin\s+you\s+urn\b/gi, 'in your turn')
    .replace(/\bunt\s+he\s+end\s+of\s+turn\b/gi, 'until the end of turn')
    .replace(/\buntil\s+th[ea]\s+end\s+of\s+[a-z]{2,6}\b/gi, 'until the end of turn')
    .replace(/\bCost\s+of\s+Force\s+of\s+Harmon[a-z]*/gi, 'Cost of Force of Harmony')
    // Numbers & verbs
    .replace(/\bdraw\s+(?:il\*?|1l|\{1|a)\s+card[s]?\b/gi, 'draw 1 card')
    .replace(/\bdraw\s+1\s+ard[!.]?/gi, 'draw 1 card.')
    .replace(/\bchoose\s*(?:iil|il|1l|til|l)\b/gi, 'choose 1')
    .replace(/\bShoots\s+1\b/gi, 'choose 1')
    .replace(/\bChooses,\s*/gi, 'Choose 1 ')
    .replace(/\bChodseyl\b/gi, 'Choose 1')
    .replace(/\bGhareeeey|Cheresich\b/gi, 'Character')
    .replace(/\bCharecterstm\b/gi, 'Characters in')
    .replace(/\bfor\s+lee\s+1\b/gi, 'or less in')
    .replace(/\b[—–]\s*(\d+)\s*i?Inspiration/gi, '-$1 Inspiration')
    .replace(/\+\s*(\d+)\s*Inspiration/gi, '+$1 Inspiration')
    .replace(/\bgets\s+a['’]?\s*nspiration/gi, 'gets +1 Inspiration')
    .replace(/\bgets\s+kh\s+Inspiration/gi, 'gets +2 Inspiration')
    // Clean punctuation spacing
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 5. Infer missing "Appear:" prefix on Character cards whose text starts with an immediate verb
  if (
    normalizedType.includes('character') &&
    /^(?:Choose|Draw|Reveal|Discard|Put|Switch|Move|Retire|All|Each)\b/.test(s)
  ) {
    s = `Appear: ${s}`;
  }

  return s;
}

async function run() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      id: string;
      name: string;
      card_type: string;
      effect_text: string;
    }>(`
      SELECT id, name, card_type, effect_text
      FROM game.cards
      WHERE effect_text IS NOT NULL AND TRIM(effect_text) <> ''
      ORDER BY id ASC
    `);

    console.log(`Running contextual grammar repair on ${rows.length} cards...`);
    let repairedCount = 0;

    for (const row of rows) {
      const repaired = contextualRepairEffectText(row.effect_text, row.card_type);
      if (repaired !== row.effect_text) {
        await client.query(`UPDATE game.cards SET effect_text = $1 WHERE id = $2`, [
          repaired,
          row.id,
        ]);
        repairedCount++;
        console.log(`🔧 ${row.id} (${row.name}):\n   BEFORE: ${row.effect_text}\n   AFTER : ${repaired}`);
      }
    }

    console.log(`\nDone! Repaired ${repairedCount} card ability texts.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run();