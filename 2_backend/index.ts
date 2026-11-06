import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, pool } from '../4_data/db.ts';
import { GameManager } from '../3_engine/gameManager.ts';

// Import modular backend routes
import authRouter from './routes/auth.ts';
import cardsRouter from './routes/cards.ts';
import decksRouter from './routes/decks.ts';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Initialize Database connection and core tables
    await initDatabase();

    // Ensure auth schema and users table exist
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

    // Ensure the decks table exists for the Deck Builder feature
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
    console.log('[DATABASE] Decks table verified successfully.');
  } catch (err: any) {
    console.error('[DATABASE INIT ERROR]', err.message);
  }

  // Mount REST API endpoints
  app.use('/api/auth', authRouter);
  app.use('/api/cards', cardsRouter);
  app.use('/api/decks', decksRouter);

  // Site configuration announcement endpoint
  app.get('/api/site/announcement', async (req, res) => {
    try {
      const result = await pool.query("SELECT value FROM site_config WHERE key = 'announcement'");
      const message = result.rows.length > 0 ? result.rows[0].value : null;
      res.json({ message });
    } catch {
      res.json({ message: null });
    }
  });

  // Create HTTP server and bind WebSocket GameManager
  const server = createServer(app);
  new GameManager(server);

  server.listen(PORT, () => {
    console.log(`[SERVER] MLP TCG Backend active on port ${PORT}`);
  });
}

startServer();