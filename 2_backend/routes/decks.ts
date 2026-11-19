import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../4_data/db.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const startermaps: any[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'StartingDecks.json'), 'utf-8')
);

async function getCardLookupMap() {
  const res = await pool.query(
    `SELECT id, name, card_type, element, rarity, image_url FROM game.cards;`
  );
  const map = new Map();
  for (const row of res.rows) {
    map.set(String(row.id).toLowerCase(), row);
  }
  return map;
}

// Rules v1.3.0 (102.1.0 - 102.1.2): Max 4 copies per base ID (ignoring ※ and -S stamps), unlimited for "Everyday"
function validateRulesV130Deck(
  cardMap: Map<string, any>,
  storyIds: string[],
  sceneIds: string[],
  mainIds: string[]
): string | null {
  if (storyIds.length > 4) return 'Story Deck cannot exceed 4 cards (Rules v1.3.0 Rule 102.1.3).';
  if (sceneIds.length > 15) return 'Scene Deck cannot exceed 15 cards (Rules v1.3.0 Rule 102.0.0).';
  if (mainIds.length > 50) return 'Main Deck cannot exceed 50 cards (Rules v1.3.0 Rule 102.0.0).';

  const counts = new Map<string, number>();
  for (const rawId of [...storyIds, ...sceneIds, ...mainIds]) {
    const card = cardMap.get(String(rawId).toLowerCase());
    if (!card) continue;
    const isEveryday =
      String(card.element || '').toLowerCase() === 'everyday' ||
      /everyday/i.test(String(card.name || '')) ||
      /-EV/i.test(String(card.id || ''));
    if (isEveryday) continue;

    // Strip ※ promo stamp and -S alternate art suffix to group shared card IDs (Rule 102.1.1)
    const canonicalId = String(card.id)
      .replace(/^※/, '')
      .replace(/-S$/i, '')
      .toUpperCase();
    const nextCount = (counts.get(canonicalId) || 0) + 1;
    if (nextCount > 4) {
      return `Deck exceeds the 4-copy limit for ${card.name} (${canonicalId}) under Rules v1.3.0 Rule 102.1.0.`;
    }
    counts.set(canonicalId, nextCount);
  }
  return null;
}

function findRealManeCard(cardMap: any, maneId: string | null, ponyHint?: string) {
  if (maneId) {
    const direct = cardMap.get(String(maneId).toLowerCase());
    if (direct && direct.image_url) return direct;
  }
  if (ponyHint) {
    const hint = ponyHint.toLowerCase();
    for (const card of cardMap.values()) {
      const t = String(card.card_type || '').toLowerCase();
      const n = String(card.name || '').toLowerCase();
      if (
        (t === 'mane character' || t === 'maincharacter') &&
        n.includes(hint) &&
        !n.includes(' - ') &&
        !n.includes(' – ') &&
        !String(card.id).includes('-S')
      ) {
        return card;
      }
    }
  }
  return null;
}

async function buildStarterDecks(cardMap: any) {
  return startermaps.map((starter: any) => {
    const ponyName = String(starter.name || '').split('-')[0].trim();
    const realMane = findRealManeCard(cardMap, starter.mane_character, ponyName);

    return {
      ...starter,
      is_starter: true,
      mane_character: realMane ? realMane.id : starter.mane_character,
      mane_image_url: realMane?.image_url || starter.mane_image_url,
      deck_banner_url: realMane?.image_url || starter.mane_image_url,
      banner_crop_position: '50% 25%',
      banner_zoom: 100,
    };
  });
}

function normalizeDeckRow(row: any, cardMap: any) {
  let parsedCards: any = {};
  if (row.cards) {
    if (typeof row.cards === 'string') {
      try {
        parsedCards = JSON.parse(row.cards);
      } catch {
        parsedCards = {};
      }
    } else {
      parsedCards = row.cards;
    }
  }

  let parsedMane = row.mane_character;
  if (typeof parsedMane === 'string' && parsedMane.startsWith('{')) {
    try {
      const obj = JSON.parse(parsedMane);
      parsedMane = obj?.id || obj?.card_id || null;
    } catch {
      // Keep raw string ID
    }
  } else if (parsedMane && typeof parsedMane === 'object') {
    parsedMane = parsedMane.id || parsedMane.card_id || null;
  }

  const realMane = findRealManeCard(cardMap, parsedMane);
  const resolvedBanner =
    parsedCards.deck_banner_url || row.deck_banner_url || realMane?.image_url || null;

  return {
    ...row,
    is_starter: Boolean(row.is_starter),
    element: row.element || realMane?.element || 'Unaligned',
    mane_character: parsedMane || null,
    mane_image_url: resolvedBanner,
    deck_banner_url: resolvedBanner,
    banner_crop_position: parsedCards.banner_crop_position || row.banner_crop_position || '50% 25%',
    banner_zoom: Number(parsedCards.banner_zoom || 100),
    story_deck: row.story_deck || parsedCards.story_deck || parsedCards.stories || [],
    scene_deck: row.scene_deck || parsedCards.scene_deck || parsedCards.scenes || [],
    main_deck: row.main_deck || parsedCards.main_deck || parsedCards.main || [],
  };
}

router.get('/decks', async (req, res) => {
  try {
    const [cardMap, result] = await Promise.all([
      getCardLookupMap(),
      pool.query('SELECT * FROM auth.decks ORDER BY created_at DESC;'),
    ]);

    const starters = await buildStarterDecks(cardMap);
    const userDecks = result.rows.map((r: any) => normalizeDeckRow(r, cardMap));
    return res.json([...starters, ...userDecks]);
  } catch (err) {
    console.error('Error fetching decks:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch decks.' });
  }
});

router.get('/decks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const cardMap = await getCardLookupMap();

    if (id.startsWith('starter-')) {
      const starters = await buildStarterDecks(cardMap);
      const foundStarter = starters.find((s: any) => s.id === id);
      if (!foundStarter) {
        return res.status(404).json({ success: false, message: 'Starter deck not found.' });
      }
      return res.json(foundStarter);
    }

    const result = await pool.query('SELECT * FROM auth.decks WHERE id = $1;', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Deck not found.' });
    }

    return res.json(normalizeDeckRow(result.rows[0], cardMap));
  } catch (err) {
    console.error('Error fetching deck by ID:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch deck.' });
  }
});

router.post('/decks', async (req, res) => {
  const {
    id,
    name,
    is_public,
    isPublic,
    mane_character,
    mane,
    deck_banner_url,
    banner_crop_position,
    banner_zoom,
    story_deck,
    stories,
    scene_deck,
    scenes,
    main_deck,
    main,
  } = req.body;

  const authorName = (req as any).user?.displayName || (req as any).user?.username || 'Player';
  const authorId = (req as any).user?.id || null;
  const resolvedPublic = is_public ?? isPublic ?? true;
  const resolvedMane =
    typeof mane_character === 'string'
      ? mane_character
      : mane_character?.id || mane?.id || (typeof mane === 'string' ? mane : null);

  const resolvedStories = story_deck || stories || [];
  const resolvedScenes = scene_deck || scenes || [];
  const resolvedMain = main_deck || main || [];

  const deckId = id && !String(id).startsWith('starter-') ? id : `deck-${Date.now()}`;

  try {
    const cardMap = await getCardLookupMap();
    const validationErr = validateRulesV130Deck(
      cardMap,
      resolvedStories,
      resolvedScenes,
      resolvedMain
    );
    if (validationErr) {
      return res.status(400).json({ success: false, message: validationErr });
    }

    const query = `
      INSERT INTO auth.decks (id, name, author, author_id, is_public, mane_character, cards)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          is_public = EXCLUDED.is_public,
          mane_character = EXCLUDED.mane_character,
          cards = EXCLUDED.cards
      RETURNING *;
    `;
    const result = await pool.query(query, [
      deckId,
      name || 'My Sparkle Deck',
      authorName,
      authorId,
      resolvedPublic,
      resolvedMane ? JSON.stringify({ id: resolvedMane }) : null,
      JSON.stringify({
        story_deck: resolvedStories,
        scene_deck: resolvedScenes,
        main_deck: resolvedMain,
        deck_banner_url: deck_banner_url || null,
        banner_crop_position: banner_crop_position || '50% 25%',
        banner_zoom: Number(banner_zoom || 100),
      }),
    ]);

    return res.json(normalizeDeckRow(result.rows[0], cardMap));
  } catch (err) {
    console.error('Error saving deck:', err);
    return res.status(500).json({ success: false, message: 'Failed to save deck.' });
  }
});

router.put('/decks/:id', async (req, res) => {
  const { id } = req.params;

  if (id.startsWith('starter-')) {
    return res.status(403).json({
      success: false,
      message: 'Starter decks cannot be edited directly. Copy the deck to customize it.',
    });
  }

  const {
    name,
    is_public,
    isPublic,
    mane_character,
    mane,
    deck_banner_url,
    banner_crop_position,
    banner_zoom,
    story_deck,
    stories,
    scene_deck,
    scenes,
    main_deck,
    main,
  } = req.body;

  const resolvedPublic = is_public ?? isPublic ?? true;
  const resolvedMane =
    typeof mane_character === 'string'
      ? mane_character
      : mane_character?.id || mane?.id || (typeof mane === 'string' ? mane : null);

  const resolvedStories = story_deck || stories || [];
  const resolvedScenes = scene_deck || scenes || [];
  const resolvedMain = main_deck || main || [];

  try {
    const cardMap = await getCardLookupMap();
    const validationErr = validateRulesV130Deck(
      cardMap,
      resolvedStories,
      resolvedScenes,
      resolvedMain
    );
    if (validationErr) {
      return res.status(400).json({ success: false, message: validationErr });
    }

    const query = `
      UPDATE auth.decks
      SET name = $1,
          is_public = $2,
          mane_character = $3::jsonb,
          cards = $4::jsonb
      WHERE id = $5
      RETURNING *;
    `;
    const result = await pool.query(query, [
      name || 'My Sparkle Deck',
      resolvedPublic,
      resolvedMane ? JSON.stringify({ id: resolvedMane }) : null,
      JSON.stringify({
        story_deck: resolvedStories,
        scene_deck: resolvedScenes,
        main_deck: resolvedMain,
        deck_banner_url: deck_banner_url || null,
        banner_crop_position: banner_crop_position || '50% 25%',
        banner_zoom: Number(banner_zoom || 100),
      }),
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Deck not found.' });
    }

    return res.json(normalizeDeckRow(result.rows[0], cardMap));
  } catch (err) {
    console.error('Error updating deck:', err);
    return res.status(500).json({ success: false, message: 'Failed to update deck.' });
  }
});

router.delete('/decks/:id', async (req, res) => {
  const { id } = req.params;

  if (id.startsWith('starter-')) {
    return res.status(403).json({
      success: false,
      message: 'Starter decks cannot be deleted.',
    });
  }

  try {
    await pool.query('DELETE FROM auth.decks WHERE id = $1;', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting deck:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete deck.' });
  }
});

export default router;