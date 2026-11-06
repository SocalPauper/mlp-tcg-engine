import { pool } from './db.js';

async function syncCards() {
  console.log('[SYNC] Starting Kayou MLP TCG card synchronization...');

  try {
    // Drop and recreate the cards table to ensure clean schema alignment
    console.log('[SYNC] Rebuilding cards table schema with rules engine attributes...');
    await pool.query(`DROP TABLE IF EXISTS cards CASCADE;`);
    
    await pool.query(`
      CREATE TABLE cards (
        id VARCHAR(64) PRIMARY KEY,
        card_number VARCHAR(64),
        name TEXT NOT NULL,
        card_type VARCHAR(64),
        sub_type VARCHAR(100),
        element VARCHAR(64),
        image_url TEXT,
        power INT DEFAULT 0,
        defense INT DEFAULT 0,
        cost INT DEFAULT 0,
        traits TEXT,
        rarity VARCHAR(20),
        set_code VARCHAR(50),
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
        { id: 'BP01-U01', cardNumber: 'BP01-U01', name: 'Twilight Sparkle, Faithful Student', cardType: 'Main Character', subType: 'Leader', element: 'Magic', cost: 0, power: 3000, defense: 2500, traits: 'Pony, Unicorn', rarity: 'CR', setCode: 'BP01', effectText: 'Leader ability: When played, search your deck for an Event card.' },
        { id: 'BP01-U02', cardNumber: 'BP01-U02', name: 'Applejack, Honest Worker', cardType: 'Main Character', subType: 'Leader', element: 'Honesty', cost: 0, power: 3500, defense: 3000, traits: 'Pony, Earth Pony', rarity: 'CR', setCode: 'BP01', effectText: 'Leader ability: Boost Character power by +500.' },
        { id: 'BP01-U03', cardNumber: 'BP01-U03', name: 'Pinkie Pie, Party Planner', cardType: 'Character', subType: 'Ally', element: 'Laughter', cost: 2, power: 2000, defense: 1500, traits: 'Pony, Earth Pony', rarity: 'R', setCode: 'BP01', effectText: 'Draw a card when entering the scene.' },
        { id: 'BP01-U04', cardNumber: 'BP01-U04', name: 'Rainbow Dash, Swift Flyer', cardType: 'Character', subType: 'Ally', element: 'Loyalty', cost: 3, power: 4000, defense: 2000, traits: 'Pony, Pegasus', rarity: 'R', setCode: 'BP01', effectText: 'Fast action: Can attack the turn it is played.' },
        { id: 'BP01-U05', cardNumber: 'BP01-U05', name: 'Rarity, Generous Designer', cardType: 'Character', subType: 'Ally', element: 'Generosity', cost: 2, power: 2500, defense: 3000, traits: 'Pony, Unicorn', rarity: 'R', setCode: 'BP01', effectText: 'Search your deck for an Item card.' },
        { id: 'BP01-U06', cardNumber: 'BP01-U06', name: 'Fluttershy, Kind Caretaker', cardType: 'Character', subType: 'Ally', element: 'Kindness', cost: 2, power: 1500, defense: 4000, traits: 'Pony, Pegasus', rarity: 'R', setCode: 'BP01', effectText: 'Prevent opponent character attacks.' },
        { id: 'BP01-S01', cardNumber: 'BP01-S01', name: 'Grand Gala Night', cardType: 'Scene', subType: 'Stage', element: 'None', cost: 0, power: 0, defense: 0, traits: 'Location', rarity: 'U', setCode: 'BP01', effectText: 'Scene rule: All characters gain +500 defense.' },
        { id: 'BP01-ST01', cardNumber: 'BP01-ST01', name: 'The Ursa Minor Threat', cardType: 'Story', subType: 'Quest', element: 'None', cost: 0, power: 0, defense: 0, traits: 'Story', rarity: 'U', setCode: 'BP01', effectText: 'Story goal: Accumulate 5 power to clear.' }
      ];
    }

    console.log(`[SYNC] Upserting ${rawCards.length} cards into PostgreSQL with expanded rules fields...`);

    for (const card of rawCards) {
      const id = String(card.id || card.cardNumber || `card-${Math.random()}`);
      const cardNumber = String(card.cardNumber || card.id || '');
      const name = String(card.name || 'Unknown Card');
      const cardType = String(card.cardType || card.type || 'Character');
      const subType = String(card.subType || card.sub_type || 'Ally');
      const element = String(card.element || 'None');
      const imageUrl = String(card.imageUrl || card.image_url || `https://cards.equestria-clash.pages.dev/assets/${id}.webp`);
      const power = Number(card.power || 0);
      const defense = Number(card.defense || 0);
      const cost = Number(card.cost || 0);
      const traits = String(card.traits || '');
      const rarity = String(card.rarity || 'C');
      const setCode = String(card.setCode || card.set_code || cardNumber.split('-')[0] || 'BP01');
      const effectText = String(card.effectText || card.effect_text || '');

      await pool.query(`
        INSERT INTO cards (id, card_number, name, card_type, sub_type, element, image_url, power, defense, cost, traits, rarity, set_code, effect_text)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          card_number = EXCLUDED.card_number,
          name = EXCLUDED.name,
          card_type = EXCLUDED.card_type,
          sub_type = EXCLUDED.sub_type,
          element = EXCLUDED.element,
          image_url = EXCLUDED.image_url,
          power = EXCLUDED.power,
          defense = EXCLUDED.defense,
          cost = EXCLUDED.cost,
          traits = EXCLUDED.traits,
          rarity = EXCLUDED.rarity,
          set_code = EXCLUDED.set_code,
          effect_text = EXCLUDED.effect_text;
      `, [id, cardNumber, name, cardType, subType, element, imageUrl, power, defense, cost, traits, rarity, setCode, effectText]);
    }

    console.log('[SYNC] Card synchronization completed successfully!');
  } catch (err: any) {
    console.error('[SYNC ERROR] Failed to sync cards to database:', err.message);
  } finally {
    await pool.end();
  }
}

syncCards();