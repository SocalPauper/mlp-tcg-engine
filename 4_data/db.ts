import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO game, auth, public;');

    await client.query('CREATE SCHEMA IF NOT EXISTS game;');
    await client.query('CREATE SCHEMA IF NOT EXISTS auth;');

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        age INT NOT NULL,
        is_safe_mode BOOLEAN DEFAULT TRUE,
        is_verified_adult BOOLEAN DEFAULT FALSE,
        is_admin BOOLEAN DEFAULT FALSE,
        is_verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(255),
        reward_points INT DEFAULT 500,
        win_streak INT DEFAULT 0,
        last_first_win_date DATE,
        pity_counter INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS age INT;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_safe_mode BOOLEAN DEFAULT TRUE;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_verified_adult BOOLEAN DEFAULT FALSE;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255);
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS reward_points INT DEFAULT 500;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS win_streak INT DEFAULT 0;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_first_win_date DATE;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS pity_counter INT DEFAULT 0;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.point_transactions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        room_code VARCHAR(100),
        queue_type VARCHAR(50) NOT NULL,
        delta INT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, room_code)
      );
    `);

    // Backfill existing users so C, U, R, SPR, SD01*, and Everyday cards are unlocked at 4x playset
    await client.query(`
      INSERT INTO auth.user_cards (user_id, card_id, quantity, user_alerted)
      SELECT u.id, c.id,
        CASE WHEN c.card_type ILIKE '%Mane%' THEN 1 ELSE 4 END,
        TRUE
      FROM auth.users u
      CROSS JOIN game.cards c
      WHERE (c.rarity IN ('C', 'U', 'R', 'SPR') OR c.id ILIKE 'SD01%' OR c.element = 'Everyday')
        AND c.id NOT ILIKE '%-S'
      ON CONFLICT (user_id, card_id) DO UPDATE
      SET quantity = GREATEST(auth.user_cards.quantity, EXCLUDED.quantity);
    `);

    console.log('[DATABASE] Database initialization, economy ledger, and 4x starter unlocks complete.');
  } finally {
    client.release();
  }
}