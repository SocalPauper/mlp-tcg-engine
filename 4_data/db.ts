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
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        is_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add is_verified safely for the mailer to function
    await client.query(`
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
    `);

    console.log('[DATABASE] Database initialization and auth.users schema check complete.');
  } finally {
    client.release();
  }
}