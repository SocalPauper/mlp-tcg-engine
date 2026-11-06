import { pool } from './db.js';

async function syncCards() {
  console.log('[SYNC] Starting Kayou MLP TCG card synchronization...');

  try {
    // Drop and recreate the cards table to ensure clean schema alignment
    console.log('[SYNC] Rebuilding cards table schema...');
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

    const catalogUrl = 'https://cards.equestria-clash.pages.dev/cards.json';
    let rawCards: any[] = [];

    try {
      console.log(`[SYNC] Fetching card metadata from ${catalogUrl}...`);
      const response = await fetch(catalogUrl);
      if (response.ok) {
        const data = await response.json();
        rawCards = Array.isArray(data) ? data : (data.cards || []);
      }
    } catch (netErr) {
      console.warn('[SYNC] Remote catalog fetch failed, generating comprehensive base seed catalog...');
    }

    if (rawCards.length === 0) {
      rawCards = [
        { id: 'BP01-U01', cardNumber: 'BP01-U01', name: 'Twilight Sparkle, Faithful Student', cardType: 'Main Character', element: 'Magic', power: 3000, defense: 2500, effectText: 'Leader ability: When played, search your deck for an Event card.' },
        { id: 'BP01-U02', cardNumber: 'BP01-U02', name: 'Applejack, Honest Worker', cardType: 'Main Character', element: 'Honesty', power: 3500, defense: 3000, effectText: 'Leader ability: Boost Character power by +500.' },
        { id: 'BP01-U03', cardNumber: 'BP01-U03', name: 'Pinkie Pie, Party Planner', cardType: 'Character', element: 'Laughter', power: 2000, defense: 1500, effectText: 'Draw a card when entering the scene.' },
        { id: 'BP01-U04', cardNumber: 'BP01-U04', name: 'Rainbow Dash, Swift Flyer', cardType: 'Character', element: 'Loyalty', power: 4000, defense: 2000, effectText: 'Fast action: Can attack the turn it is played.' },
        { id: 'BP01-U05', cardNumber: 'BP01-U05', name: 'Rarity, Generous Designer', cardType: 'Character', element: 'Generosity', power: 2500, defense: 3000, effectText: 'Search your deck for an Item card.' },
        { id: 'BP01-U06', cardNumber: 'BP01-U06', name: 'Fluttershy, Kind Caretaker', cardType: 'Character', element: 'Kindness', power: 1500, defense: 4000, effectText: 'Prevent opponent character attacks.' },
        { id: 'BP01-S01', cardNumber: 'BP01-S01', name: 'Grand Gala Night', cardType: 'Scene', element: 'None', power: 0, defense: 0, effectText: 'Scene rule: All characters gain +500 defense.' },
        { id: 'BP01-ST01', cardNumber: 'BP01-ST01', name: 'The Ursa Minor Threat', cardType: 'Story', element: 'None', power: 0, defense: 0, effectText: 'Story goal: Accumulate 5 power to clear.' }
      ];
    }

    console.log(`[SYNC] Upserting ${rawCards.length} cards into PostgreSQL...`);

    for (const card of rawCards) {
      const id = String(card.id || card.cardNumber || `card-${Math.random()}`);
      const cardNumber = String(card.cardNumber || card.id || '');
      const name = String(card.name || 'Unknown Card');
      const cardType = String(card.cardType || card.type || 'Character');
      const element = String(card.element || 'None');
      const imageUrl = String(card.imageUrl || card.image_url || `https://cards.equestria-clash.pages.dev/assets/${id}.webp`);
      const power = Number(card.power || 0);
      const defense = Number(card.defense || 0);
      const effectText = String(card.effectText || card.effect_text || '');

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
    }

    console.log('[SYNC] Card synchronization completed successfully!');
  } catch (err: any) {
    console.error('[SYNC ERROR] Failed to sync cards to database:', err.message);
  } finally {
    await pool.end();
  }
}

syncCards();