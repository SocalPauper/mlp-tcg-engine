import fs from 'fs';
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

// Exact manual overrides for heavily foil-obscured cards
const EXACT_CARD_OVERRIDES: Record<string, string> = {
  'BP01-C25': 'When promoted to this stage, draw 1 card.',
  'BP01-C29': 'When promoted to this stage, draw 1 card.',
  'BP01-C35': "When promoted to this stage, choose 1 Character in Rival's Adventure Area, it gets -3 Inspiration until the end of turn.",
  'BP01-C37': 'When promoted to this stage, draw 2 cards.',
  'BP01-C38': "When promoted to this stage, all Characters in Rival's Adventure Area get -1 Inspiration until the end of turn.",
  'BP01-C39': 'When promoted to this stage, choose 1 「Applejack」 in your Adventure Area, it gets +4 Inspiration until the end of turn.',
  'BP01-C41': 'When promoted to this stage, draw 1 card.',
  'BP01-C47': "When promoted to this stage, choose 1 Character with Inspiration 5 or less in Rival's Adventure Area to Retire.",
  'BP01-CR02': 'Appear: Choose 1 「Pet」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'BP01-CR03': 'Appear: Reveal the top 3 cards of your Deck, choose 1 Item from them, add it to Hand, move the rest to Retirement Area.',
  'BP01-CR05': "Appear: Choose 1 Character with Inspiration 2 or less in Rival's Adventure Area to Retire.",
  'BP01-CR07': 'Adventure: While there is any Event in your Retirement Area, this Character gets +2 Inspiration in your turn.',
  'BP01-CR08': 'Appear: Choose 1 「Pet」 in your Adventure Area, it gets +1 Inspiration until the end of turn.',
  'BP01-CR09': 'Adventure: Tap: Choose 1 Item with Cost of Force of Harmony 2 or less in your Retirement Area, add it to Hand.',
  'BP01-CR10': 'Appear: Choose 2 Scenes in your Scene Area, untap them.',
  'BP01-GR01': 'Appear: If there is any Event in your Retirement Area, choose 1 「Spike」 in your Adventure Area, it gets +3 Inspiration until the end of turn.',
  'BP01-GR03': 'Appear: If there is any Item in your Retirement Area, draw 1 card.',
  'BP01-GR04': 'Appear: Draw 1 card.',
  'BP01-GR06': 'Adventure: Tap: Choose 1 「Rarity」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'BP01-GR08': 'Appear: Reveal the top 3 cards of your Deck, choose 1 「Angel」 from them, add it to Hand, move the rest to Retirement Area.',
  'BP01-GR09': 'Adventure: While this Character is adorned with an Item, other Characters in your Adventure Area get +1 Inspiration.',
  'BP01-GR10': 'Appear: Choose 1 Scene in your Scene Area, untap it.',
  'BP01-GR11': "While there is any Character in Rival's Adventure Area and no Character in your Adventure Area, this Character gets -1 Cost of Force of Harmony when played from Hand.",
  'BP01-SPR28': 'Only adorn 「Pinkie Pie」. Adorned Character gains "Adventure: Tap: Choose 1 「Pinkie Pie」 with Cost of Force of Harmony 4 or less in your Retirement Area, add it to Hand."',
  'BP01-SR02': 'Appear: If there is any 「Angel」 in your Adventure Area, choose 1 「Pet」 in your Retirement Area, add it to Hand.',
  'BP01-SR05': "Appear: If there is any other 「Rainbow Dash」 in your Adventure Area, choose 1 Character with Inspiration 4 or less in Rival's Adventure Area to Retire.",
  'BP01-SR06': 'Appear: If there is any 「Opal」 in your Adventure Area, draw 1 card.',
  'BP01-SR07': 'Appear: If there is any 「Twilight Sparkle」 in your Adventure Area, this Character gets +1 Inspiration until the end of turn.',
  'BP01-SR08': 'Appear: Choose 1 「Fluttershy」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'BP01-SR09': 'Farewell: Draw 2 cards, discard 1 card.',
  'BP01-SR13': "Appear: If Rival has more Plans than you in Story Area, choose 1 Character with Inspiration 5 or less in Rival's Adventure Area to Retire.",
  'BP01-U11': 'Appear: Choose 1 「Opal」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'BP02-C09': 'Adventure: If there are 2 or more 「Pegasus」 in your Retirement Area, move this Character to Adventure Area.',
  'BP02-C26': 'When promoted to this stage, choose 1 「Unicorn」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'BP02-C28': 'When promoted to this stage, you win the game.',
  'BP02-C29': "When promoted to this stage, choose 1 Character in Rival's Adventure Area, it gets -1 Inspiration until the end of turn.",
  'BP02-C37': 'When promoted to this stage, choose 1 Character in your Adventure Area, it gets +1 Inspiration until the end of turn.',
  'BP02-C38': 'When promoted to this stage, if there is any 「Earth Pony」 in your Adventure Area, choose 1 face-down Scene in your Scene Area, turn it up.',
  'BP02-C39': 'When promoted to this stage, add 1 Scene.',
  'BP02-C41': 'When promoted to this stage, choose 1 「Pet」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'BP02-C43': 'When promoted to this stage, draw 2 cards.',
  'BP02-C46': 'When promoted to this stage, look at each Plan in your Story Area, then return them in original order.',
  'BP02-C48': 'When promoted to this stage, you win the game.',
  'BP02-RR03': '', // Vanilla Mane Character
  'SD01C-U03': "Appear: Choose 1 Character in Rival's Adventure Area, it gets -2 Inspiration until the end of turn.",
  'SD01D-U03': 'Appear: Choose 1 「Winona」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'SD01D-U04': 'Appear: Choose 1 Scene in your Scene Area, untap it.',
  'SD01F-U04': 'Appear: Choose 1 「Rarity」 in your Adventure Area, it gets +2 Inspiration until the end of turn.',
  'SD01-U05': 'Pre-Plan: Draw 2 cards.',
};

function sanitizeFlaggedText(id: string, raw: string): string {
  const baseId = id.replace(/-S$/, '');
  if (EXACT_CARD_OVERRIDES[id] !== undefined) return EXACT_CARD_OVERRIDES[id];
  if (EXACT_CARD_OVERRIDES[baseId] !== undefined) return EXACT_CARD_OVERRIDES[baseId];

  let s = raw
    // Fix doubled "+2 I+1 Inspiration" artifact from earlier regex pass
    .replace(/([+-]\d+)\s*I\s*\+1\s*Inspiration/gi, '$1 Inspiration')
    .replace(/\bI\+1\s*Inspiration/gi, '+1 Inspiration')
    // Fix duplicate closing brackets 「Name」」 -> 「Name」
    .replace(/「([^」]+)」+/g, '「$1」')
    // Fix unclosed bracket [Name in -> 「Name」 in
    .replace(/\[([A-Za-z' ]{2,22}?)(?=\s+(?:in|with|from|adorned|gets|get|is)\b)/g, '「$1」')
    // Fix Adventure Area & Scene Area typos
    .replace(/\bAdventure:\s*(?:Arec|Arex|Are:|Area:?)\b/gi, 'Adventure Area')
    .replace(/\bScene\s+Area\s+n?tap\s*it\.?/gi, 'Scene Area, untap it.')
    .replace(/\bScene\s+Area\s+arn\s+it\s+down\.?/gi, 'Scene Area, turn it down.')
    .replace(/\bt\s+gets\s+([+-]\d+\s+Inspiration)/gi, 'it gets $1')
    .replace(/\buntil\s+the\s+en\s+f\s+turn\.?/gi, 'until the end of turn.')
    .replace(/\b1\s+or\s+les\s+1\s+Rival's/gi, "1 or less in Rival's")
    .replace(/\b2\s+or\s+les\s+1\s+Rival's/gi, "2 or less in Rival's")
    .replace(/\s{2,}/g, ' ')
    .trim();

  return s;
}

async function run() {
  const jsonPath = path.resolve(__dirname, 'flagged_cards_review.json');
  const flagged: Array<{ id: string; name: string; effect_text: string }> = JSON.parse(
    fs.readFileSync(jsonPath, 'utf-8')
  );

  const client = await pool.connect();
  try {
    let updated = 0;
    for (const item of flagged) {
      const cleaned = sanitizeFlaggedText(item.id, item.effect_text);
      if (cleaned !== item.effect_text) {
        await client.query(`UPDATE game.cards SET effect_text = $1 WHERE id = $2`, [
          cleaned,
          item.id,
        ]);
        updated++;
        console.log(`✅ ${item.id} (${item.name}) -> "${cleaned || '(Vanilla)'}"`);
      }
    }

    // Re-sync all -S parallels from their base cards
    const { rowCount: synced } = await client.query(`
      UPDATE game.cards AS s
      SET effect_text = base.effect_text
      FROM game.cards AS base
      WHERE s.id LIKE '%-S'
        AND base.id = REGEXP_REPLACE(s.id, '-S$', '')
        AND base.effect_text IS NOT NULL
    `);

    console.log(`\nUpdated ${updated} flagged cards and synced ${synced} "-S" parallel cards.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run();