import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safe column migrations in case the table already existed previously without them
    await client.query(`
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS age INT;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_safe_mode BOOLEAN DEFAULT TRUE;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_verified_adult BOOLEAN DEFAULT FALSE;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255);
    `);

    console.log('[DATABASE] Database initialization and auth.users schema check complete.');
  } finally {
    client.release();
  }
}