-- Users & Authentication
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  display_name VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_verified_adult BOOLEAN DEFAULT false,
  is_admin BOOLEAN DEFAULT false,
  is_muted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Site Settings (Announcements, Maintenance mode, etc.)
CREATE TABLE IF NOT EXISTS site_config (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT
);

-- Kayou Card Catalog
CREATE TABLE IF NOT EXISTS cards (
  id VARCHAR(50) PRIMARY KEY,
  card_number VARCHAR(50) UNIQUE,
  name VARCHAR(150) NOT NULL,
  card_type VARCHAR(50) NOT NULL, -- 'MainCharacter', 'Character', 'Item', 'Event', 'Scene', 'Story'
  element VARCHAR(50), -- Harmony colors
  image_url TEXT,
  power INTEGER DEFAULT 0,
  defense INTEGER DEFAULT 0,
  effect_text TEXT
);

-- Player Decks
CREATE TABLE IF NOT EXISTS decks (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  author VARCHAR(50) NOT NULL,
  author_id VARCHAR(50) NOT NULL,
  mane_character JSONB, -- Stores the single required Leader card object
  cards JSONB NOT NULL, -- Stores the 50-card main deck array
  is_meta BOOLEAN DEFAULT false,
  win_rate VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);