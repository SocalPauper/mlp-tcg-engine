import pkg from 'pg';
const { Pool } = pkg;

// Robust PostgreSQL Pool with forced SSL for Render/Cloud environments
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://mlp_admin:N759KYhjGJvlVnrgFTkF7sC8csN7aXs9@dpg-dblaqfm417fc7380ni40-a.oregon-postgres.render.com/mlp_tcg_db',
  ssl: { rejectUnauthorized: false },
});

// Force schema search path on every client connection checkout
pool.on('connect', (client) => {
  client.query('SET search_path TO game, auth, public;');
});

export const initDatabase = async () => {
  try {
    const client = await pool.connect();
    console.log('[DB] PostgreSQL connected successfully.');
    client.release();
  } catch (err: any) {
    console.warn('[DB] Running in offline memory mode (Database connection skipped):', err.message);
  }
};