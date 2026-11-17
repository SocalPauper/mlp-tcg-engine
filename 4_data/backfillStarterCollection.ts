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

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running starter collection backfill for existing users...');
    const res = await client.query(`
      INSERT INTO auth.user_cards (user_id, card_id, quantity, user_alerted)
      SELECT u.id, c.id, 3, TRUE
      FROM auth.users u
      CROSS JOIN game.cards c
      WHERE c.rarity IN ('C', 'U', 'R')
         OR c.id LIKE 'SD01%'
         OR c.element = 'Everyday'
      ON CONFLICT (user_id, card_id)
      DO UPDATE SET quantity = GREATEST(auth.user_cards.quantity, 3);
    `);
    console.log(`Successfully backfilled C/U/R starter collection across existing accounts (${res.rowCount} rows affected).`);
  } catch (err: any) {
    console.error('Backfill failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();