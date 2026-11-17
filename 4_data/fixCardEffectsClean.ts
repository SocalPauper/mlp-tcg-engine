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

function fixCardText(raw: string, cardType: string): string {
  if (!raw || !raw.trim()) return '';

  let s = raw.trim();

  // 1. Undo accidental 「...」 brackets around non-bracket phrases (e.g., 「nspiration...」)
  s = s.replace(/「([^」]+)」/g, (full, inner: string) => {
    if (/nspiration|turn|Area|Hand|Deck|Force|REE|ULE|nwrap|tems|NK|EED/i.test(inner)) {
      return inner;
    }
    return full;
  });

  // 2. Restore clipped leading characters on common starter verbs
  s = s
    .replace(/^nly\s+(?:use|adorn)\b/i, (m) => 'O' + m)
    .replace(/^when\s+(?:there\s+is|there\s+are|cards\s+in|Rival\s+has|the\s+number)/i, (m) => 'Only use ' + m)
    .replace(/^adorn\s+「/i, 'Only adorn 「')
    .replace(/^Adorn\s+「/i, 'Only Adorn 「')
    .replace(/^hoose\b/i, 'Choose')
    .replace(/^raw\s+(\d+)\s+card/i, 'Draw $1 card')
    .replace(/^eveal\s+the\s+top/i, 'Reveal the top')
    .replace(/^the\s+top\s+(\d+|card)\s+cards?\s+of/i, 'Reveal the top $1 cards of')
    .replace(/^all\s+Characters\s+with\s+Cost/i, 'Retire all Characters with Cost')
    .replace(/^the\s+end\s+of\s+turn,/i, 'Until the end of turn,')
    .replace(/^dorned\s+Character/i, 'Adorned Character')
    .replace(/^his\s+Character/i, 'This Character')
    .replace(/^his\s+Item/i, 'This Item')
    .replace(/^ach\b/i, 'Each')
    .replace(/^Vhile\b/i, 'While')
    .replace(/^Vhen\b/i, 'When')
    .replace(/^hen\s+Adorned\b/i, 'When Adorned')
    .replace(/^discard\s+1\s+card\.\s*4\s*'Y$/i, 'Draw 2 cards, discard 1 card.')
    .replace(/^discard\s+1\s+card\.$/i, 'Draw 2 cards, discard 1 card.');

  // 3. Fix Inspiration & common word truncations
  s = s
    .replace(/\+?1?nspiration\b/gi, '+1 Inspiration')
    .replace(/\+\s*nspiration\b/gi, '+2 Inspiration')
    .replace(/\bInspiration\b/gi, 'Inspiration')
    .replace(/\bInSpinatio\b/gi, 'Inspiration')
    .replace(/\bInspiratiol\b/gi, 'Inspiration')
    .replace(/\bInspiratior\b/gi, 'Inspiration')
    .replace(/\bInspiratic\b/gi, 'Inspiration')
    .replace(/\bRetiremer\s*(?:rea|Area)?\b/gi, 'Retirement Area')
    .replace(/\bAdventur\s*(?:req|rea|Area|Arec)?\b/gi, 'Adventure Area')
    .replace(/\bScen\s*(?:req|rea|Area|Arec)?\b/gi, 'Scene Area')
    .replace(/\bStor\s*(?:req|rea|Area)?\b/gi, 'Story Area')
    .replace(/\buntil\s+the\s+en\s+f\s+turn\b/gi, 'until the end of turn')
    .replace(/\buntil\s+the\s+end\s+o\s+urn\b/gi, 'until the end of turn')
    .replace(/\buntil\s+th\s+nd\s+of\s+this\s+Contact\b/gi, 'until the end of this Contact')
    .replace(/\badd\s+it\s+to\s+Hane\b/gi, 'add it to Hand')
    .replace(/\bmove\s+it\s+t\s+Adventure Area\b/gi, 'move it to Adventure Area')
    .replace(/\bmove\s+it\s+t\s+Retirement Area\b/gi, 'move it to Retirement Area')
    .replace(/\b1\s+or\s+les\s+1\s+Rival's\b/gi, "1 or less in Rival's")
    .replace(/\b2\s+or\s+les\s+1\s+Rival's\b/gi, "2 or less in Rival's")
    .replace(/\bCost\s+of\s+Force\s+of\s+Harmor\b/gi, 'Cost of Force of Harmony')
    .replace(/\bCost\s+of\s+Force\s+c\s+larmony\b/gi, 'Cost of Force of Harmony')
    .replace(/\bCost\s+of\s+Force\s+of\s+larmony\b/gi, 'Cost of Force of Harmony')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 4. Clean trailing OCR junk after final period on non-Story cards
  if (String(cardType || '').toLowerCase() !== 'story') {
    s = s.replace(/(\.)\s+[A-Za-z0-9'"]{1,4}(?:\s+[A-Za-z0-9'"]{1,4})?$/, '$1');
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

    let fixed = 0;
    for (const row of rows) {
      const cleaned = fixCardText(row.effect_text, row.card_type);
      if (cleaned !== row.effect_text) {
        await client.query(`UPDATE game.cards SET effect_text = $1 WHERE id = $2`, [
          cleaned,
          row.id,
        ]);
        fixed++;
      }
    }

    console.log(`Polished ${fixed} card ability texts.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run();