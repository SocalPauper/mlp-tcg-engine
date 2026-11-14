import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, pool } from '../4_data/db.js';

import authRouter from './routes/auth.js';
import cardsRouter from './routes/cards.js';
import decksRouter from './routes/decks.js';
import shopsRouter from './routes/shops.js';

const app = express();

app.use(cors({
  origin: ['https://equestria-clash.pages.dev', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await initDatabase();

    // 1. Ensure schemas exist
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS game;
    `);

    // 2. Provision auth.users with UUID primary key
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        age INT NOT NULL,
        reward_points INT DEFAULT 500,
        is_safe_mode BOOLEAN DEFAULT TRUE,
        is_verified_adult BOOLEAN DEFAULT FALSE,
        is_admin BOOLEAN DEFAULT FALSE,
        is_verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safety check: If auth.users was previously created as integer (serial), convert it to UUID safely
    await pool.query(`
      DO $$ 
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'id' AND data_type = 'integer'
        ) THEN
          ALTER TABLE public.user_cards DROP CONSTRAINT IF EXISTS user_cards_user_id_fkey;
          ALTER TABLE auth.users ALTER COLUMN id TYPE UUID USING gen_random_uuid();
        END IF;
      END $$;
    `);

    // 3. Deck structure
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.decks (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        author VARCHAR(255),
        author_id UUID,
        is_public BOOLEAN DEFAULT false,
        mane_character JSONB,
        cards JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Game inventory table (housed in the game schema)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game.user_cards (
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        card_id VARCHAR(50) REFERENCES game.cards(id) ON DELETE CASCADE,
        quantity INT DEFAULT 1,
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_alerted BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (user_id, card_id)
      );
    `);

    console.log('[DATABASE] Initialization and schema hardening complete.');
  } catch (err: any) {
    console.error('[DATABASE INIT ERROR]', err.message);
  }

  // Mount Routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', authRouter);
  app.use('/api/shop', shopsRouter);
  app.use('/api', cardsRouter);
  app.use('/api', decksRouter);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', engine: 'MLP TCG Engine online' });
  });

  app.get('/api/site/announcement', (req, res) => {
    res.json({ success: true, announcement: "Welcome to Equestria Clash TCG Online!" });
  });

  const server = createServer(app);
  server.listen(PORT, () => {
    console.log(`[SERVER] MLP TCG Backend active on port ${PORT}`);
  });
}

startServer();