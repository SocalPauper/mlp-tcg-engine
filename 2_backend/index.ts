import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, pool } from '../db.js';

// Import modular backend routes
import authRouter from './routes/auth.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await initDatabase();

    // Ensure auth schema and users table exist with all required columns
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS auth;

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DATABASE] Auth schema and users table verified successfully.');

    // Ensure the decks table exists in auth schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.decks (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        author VARCHAR(255),
        author_id VARCHAR(255),
        is_public BOOLEAN DEFAULT false,
        mane_character JSONB,
        cards JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DATABASE] Auth decks table verified successfully.');
  } catch (err: any) {
    console.error('[DATABASE INIT ERROR]', err.message);
  }

  app.use('/api/auth', authRouter);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', engine: 'MLP TCG Engine online' });
  });

  const server = createServer(app);
  server.listen(PORT, () => {
    console.log(`[SERVER] MLP TCG Backend active on port ${PORT}`);
  });
}

startServer();