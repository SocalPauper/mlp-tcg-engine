import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  extractTriggerClause,
  parseEffectClause,
  sanitizeCardText,
} from '../3_engine/effectParser.js';

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

async function run() {
  const client = await pool.connect();
  try {
    // 1. Copy clean base card effect_text onto matching -S shining parallels
    const { rowCount: synced } = await client.query(`
      UPDATE game.cards AS s
      SET effect_text = base.effect_text
      FROM game.cards AS base
      WHERE s.id LIKE '%-S'
        AND base.id = REGEXP_REPLACE(s.id, '-S$', '')
        AND base.effect_text IS NOT NULL
        AND TRIM(base.effect_text) <> ''
        AND base.effect_text !~ '[|\\\\~_<>@#*]'
    `);
    console.log(`Synced clean ability text onto ${synced} "-S" shining parallel cards.`);

    // 2. Export remaining flagged rows to flagged_cards_review.json
    const { rows } = await client.query<{
      id: string;
      name: string;
      card_type: string;
      effect_text: string;
      image_url: string;
    }>(`
      SELECT id, name, card_type, effect_text, image_url
      FROM game.cards
      WHERE effect_text IS NOT NULL AND TRIM(effect_text) <> ''
      ORDER BY id ASC
    `);

    const flagged = rows.filter((row) => {
      const text = sanitizeCardText(row.effect_text);
      const openB = (text.match(/「/g) || []).length;
      const closeB = (text.match(/」/g) || []).length;
      if (openB !== closeB || /[|\\~_<>@#*]/.test(text)) return true;

      const appear = extractTriggerClause(text, 'Appear');
      const farewell = extractTriggerClause(text, 'Farewell');
      if (appear && !parseEffectClause(appear)) return true;
      if (farewell && !parseEffectClause(farewell)) return true;
      return false;
    });

    const outPath = path.resolve(__dirname, 'flagged_cards_review.json');
    fs.writeFileSync(outPath, JSON.stringify(flagged, null, 2), 'utf-8');
    console.log(
      `Clean & ready: ${rows.length - flagged.length} / ${rows.length} cards. Exported ${flagged.length} remaining flagged cards to ${outPath}`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

run();