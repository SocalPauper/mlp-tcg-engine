import pkg from 'pg';
const { Pool } = pkg;

// Robust PostgreSQL Pool with forced SSL for Render/Cloud environments
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/mlp_tcg',
  ssl: { rejectUnauthorized: false },
});

export const initDatabase = async () => {
  try {
    // We will run schema.sql contents through this pool in a migration script
    const client = await pool.connect();
    console.log('[DB] PostgreSQL connected successfully.');
    client.release();
  } catch (err: any) {
    console.warn('[DB] Running in offline memory mode (Database connection skipped):', err.message);
  }
};