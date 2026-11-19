import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, pool } from '../4_data/db.js';

import authRouter from './routes/auth.js';
import cardsRouter from './routes/cards.js';
import decksRouter from './routes/decks.js';
import shopsRouter from './routes/shops.js';
import mediaRouter from './routes/media.js';
import adminRouter from './routes/admin.js';
import forumRouter from './routes/forum.js';
import rankedRouter from './routes/ranked.js';
import { GameManager } from './websocket/gameManager.js';

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
          ALTER TABLE auth.user_cards DROP CONSTRAINT IF EXISTS user_cards_user_id_fkey;
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

    // 4. Game inventory table matching DBeaver schema (auth.user_cards)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.user_cards (
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        card_id VARCHAR(50) REFERENCES game.cards(id) ON DELETE CASCADE,
        quantity INT DEFAULT 1,
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_alerted BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (user_id, card_id)
      );
    `);

    // 5. Weekly shop deals table for guaranteed weekly rotations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game.weekly_shop_deals (
        id SERIAL PRIMARY KEY,
        card_id VARCHAR(50) REFERENCES game.cards(id) ON DELETE CASCADE,
        price INTEGER NOT NULL,
        week_identifier VARCHAR(20) NOT NULL,
        slot_index INTEGER NOT NULL,
        UNIQUE(week_identifier, slot_index)
      );
    `);

    // 6. Persistent Global Site Settings (Wallpapers, Opacity, Live Announcements)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.site_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_by VARCHAR(100),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 7. Persistent Media Registry (R2 uploads for Admin Themes & Fan Page)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.uploaded_media (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        target_key VARCHAR(100),
        title VARCHAR(255),
        file_name VARCHAR(255) NOT NULL,
        public_url TEXT NOT NULL,
        uploaded_by VARCHAR(100),
        is_approved BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE auth.uploaded_media ADD COLUMN IF NOT EXISTS title VARCHAR(255);
    `);

    // 8. Fan Page Forum Tables (Threads, Nested Comments, Votes)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.forum_posts (
        id VARCHAR(255) PRIMARY KEY,
        author_id VARCHAR(255),
        author_name VARCHAR(255) NOT NULL,
        category VARCHAR(64) DEFAULT 'General',
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        image_status VARCHAR(32) DEFAULT 'NONE',
        upvotes INT DEFAULT 1,
        downvotes INT DEFAULT 0,
        is_pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth.forum_comments (
        id VARCHAR(255) PRIMARY KEY,
        post_id VARCHAR(255) REFERENCES auth.forum_posts(id) ON DELETE CASCADE,
        parent_id VARCHAR(255) NULL,
        author_id VARCHAR(255),
        author_name VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        upvotes INT DEFAULT 1,
        downvotes INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth.forum_votes (
        user_id VARCHAR(255) NOT NULL,
        target_id VARCHAR(255) NOT NULL,
        vote_value INT NOT NULL,
        PRIMARY KEY (user_id, target_id)
      );
    `);

    // 9. Ranked Mode Ratings & Match History Tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.player_ratings (
        user_id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        mmr INT DEFAULT 1200,
        peak_mmr INT DEFAULT 1200,
        placement_matches INT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        win_streak INT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth.ranked_match_history (
        id VARCHAR(255) PRIMARY KEY,
        winner_id VARCHAR(255) NOT NULL,
        winner_name VARCHAR(100) NOT NULL,
        loser_id VARCHAR(255) NOT NULL,
        loser_name VARCHAR(100) NOT NULL,
        winner_mmr_change INT NOT NULL,
        loser_mmr_change INT NOT NULL,
        played_at TIMESTAMPTZ DEFAULT NOW()
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
  app.use('/api/media', mediaRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/forum', forumRouter);
  app.use('/api/ranked', rankedRouter);
  app.use('/api', cardsRouter);
  app.use('/api', decksRouter);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', engine: 'MLP TCG Engine online' });
  });

  app.get('/api/site/announcement', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT setting_value FROM auth.site_settings WHERE setting_key = 'site_announcement'`
      );
      res.json({
        success: true,
        announcement: rows[0]?.setting_value || 'Welcome to Equestria Clash TCG Online!',
      });
    } catch {
      res.json({ success: true, announcement: 'Welcome to Equestria Clash TCG Online!' });
    }
  });

  const server = createServer(app);
  const gameManager = new GameManager(server);

  server.listen(PORT, () => {
    console.log(`[SERVER] MLP TCG Backend active on port ${PORT} with WebSocket GameManager enabled.`);
  });
}

startServer();