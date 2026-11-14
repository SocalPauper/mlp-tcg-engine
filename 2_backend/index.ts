import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, pool } from '../4_data/db.js';

import authRouter from './routes/auth.js';
import cardsRouter from './routes/cards.js';
import decksRouter from './routes/decks.js';
import shopsRouter from './routes/shops.js'; // Added shops router

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

    // 1. Updated users table to UUID and added reward_points
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS auth;

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

    // 2. Deck structure
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

    // 3. Added user_cards inventory table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_cards (
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        card_id VARCHAR(50) REFERENCES game.cards(id) ON DELETE CASCADE,
        quantity INT DEFAULT 1,
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_alerted BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (user_id, card_id)
      );
    `);

  } catch (err: any) {
    console.error('[DATABASE INIT ERROR]', err.message);
  }

  // Mount Routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', authRouter); // Alias to support /api/users/me endpoints
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