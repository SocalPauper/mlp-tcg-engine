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

async function runAudit() {
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

    let cleanParsedCount = 0;
    const suspiciousRows: { id: string; name: string; issue: string; text: string }[] = [];

    for (const row of rows) {
      const text = sanitizeCardText(row.effect_text);

      // 1. Check for leftover OCR corruption markers
      const openBrackets = (text.match(/「/g) || []).length;
      const closeBrackets = (text.match(/」/g) || []).length;
      const hasWeirdChars = /[|\\~_<>@#*]/.test(text);

      if (openBrackets !== closeBrackets || hasWeirdChars) {
        suspiciousRows.push({
          id: row.id,
          name: row.name,
          issue: 'OCR artifact / unbalanced bracket',
          text,
        });
        continue;
      }

      // 2. Dry-run against the engine's effect parser
      const appearClause = extractTriggerClause(text, 'Appear');
      const farewellClause = extractTriggerClause(text, 'Farewell');

      if (appearClause && !parseEffectClause(appearClause)) {
        suspiciousRows.push({
          id: row.id,
          name: row.name,
          issue: 'Unrecognized Appear clause',
          text,
        });
        continue;
      }

      if (farewellClause && !parseEffectClause(farewellClause)) {
        suspiciousRows.push({
          id: row.id,
          name: row.name,
          issue: 'Unrecognized Farewell clause',
          text,
        });
        continue;
      }

      cleanParsedCount++;
    }

    console.log(`\n=== CARD EFFECT AUDIT SUMMARY ===`);
    console.log(`Total ability cards checked : ${rows.length}`);
    console.log(`Clean & engine-ready        : ${cleanParsedCount}`);
    console.log(`Flagged for manual review   : ${suspiciousRows.length}\n`);

    if (suspiciousRows.length > 0) {
      console.log(`--- Top Flagged Cards (First 25) ---`);
      for (const item of suspiciousRows.slice(0, 25)) {
        console.log(`[${item.id}] ${item.name} (${item.issue}):\n   "${item.text}"`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runAudit();