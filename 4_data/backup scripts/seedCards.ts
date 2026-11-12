import { pool } from './db.js';
import * as fs from 'fs';
import * as path from 'path';

async function seedDatabase() {
  console.log('[SEED] Starting full Kayou MLP TCG card database re-compilation...');

  try {
    // 1. Recreate cards table with clean schema
    console.log('[SEED] Rebuilding PostgreSQL cards table schema...');
    await pool.query(`DROP TABLE IF EXISTS cards CASCADE;`);
    
    await pool.query(`
      CREATE TABLE cards (
        id VARCHAR(64) PRIMARY KEY,
        card_number VARCHAR(64),
        name TEXT NOT NULL,
        card_type VARCHAR(64),
        element VARCHAR(64),
        image_url TEXT,
        power INT DEFAULT 0,
        defense INT DEFAULT 0,
        effect_text TEXT
      );
    `);

    let rawCards: any[] = [];

    // 2. Try loading local cards.json file first if it exists in your project workspace
    const localJsonPath = path.join(process.cwd(), '4_data', 'cards.json');
    const rootJsonPath = path.join(process.cwd(), 'cards.json');

    if (fs.existsSync(localJsonPath)) {
      console.log(`[SEED] Loading cards from local file: ${localJsonPath}`);
      const fileData = fs.readFileSync(localJsonPath, 'utf8');
      const json = JSON.parse(fileData);
      rawCards = Array.isArray(json) ? json : (json.cards || json.data || json.results || []);
    } else if (fs.existsSync(rootJsonPath)) {
      console.log(`[SEED] Loading cards from root file: ${rootJsonPath}`);
      const fileData = fs.readFileSync(rootJsonPath, 'utf8');
      const json = JSON.parse(fileData);
      rawCards = Array.isArray(json) ? json : (json.cards || json.data || json.results || []);
    } else {
      // 3. Fallback to remote fetch if no local file is found
      const catalogUrl = 'https://cards.equestria-clash.pages.dev/cards.json';
      console.log(`[SEED] Local cards.json not found. Fetching from ${catalogUrl}...`);
      
      const response = await fetch(catalogUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote catalog: ${response.statusText}`);
      }

      const json = await response.json();
      rawCards = Array.isArray(json) ? json : (json.cards || json.data || json.results || []);
    }

    if (rawCards.length === 0) {
      throw new Error('Found 0 cards to ingest!');
    }

    console.log(`[SEED] Successfully retrieved ${rawCards.length} cards. Inserting into PostgreSQL...`);

    let insertedCount = 0;

    for (const card of rawCards) {
      const id = String(card.id || card.cardNumber || card.card_number || `card-${Math.random()}`);
      const cardNumber = String(card.cardNumber || card.card_number || card.id || '');
      const name = String(card.name || 'Unknown Card');
      const cardType = String(card.cardType || card.card_type || card.type || 'Character');
      const element = String(card.element || 'None');
      const imageUrl = String(card.imageUrl || card.image_url || `https://cards.equestria-clash.pages.dev/assets/${id}.webp`);
      const power = Number(card.power || 0);
      const defense = Number(card.defense || 0);
      const effectText = String(card.effectText || card.effect_text || card.effect || '');

      await pool.query(`
        INSERT INTO cards (id, card_number, name, card_type, element, image_url, power, defense, effect_text)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          card_number = EXCLUDED.card_number,
          name = EXCLUDED.name,
          card_type = EXCLUDED.card_type,
          element = EXCLUDED.element,
          image_url = EXCLUDED.image_url,
          power = EXCLUDED.power,
          defense = EXCLUDED.defense,
          effect_text = EXCLUDED.effect_text;
      `, [id, cardNumber, name, cardType, element, imageUrl, power, defense, effectText]);

      insertedCount++;
      if (insertedCount % 50 === 0) {
        console.log(`[SEED] Progress: Inserted ${insertedCount} / ${rawCards.length} cards...`);
      }
    }

    console.log(`[SEED] Complete! Successfully compiled and loaded all ${insertedCount} cards into PostgreSQL.`);
  } catch (err: any) {
    console.error('[SEED ERROR] Failed to seed database:', err.message);
  } finally {
    await pool.end();
  }
}

seedDatabase();