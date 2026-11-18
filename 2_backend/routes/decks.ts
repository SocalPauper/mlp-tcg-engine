import { Router } from 'express';
import { pool } from '../../4_data/db.js';
import startermaps from './StartingDecks.json' assert { type: 'json' };

const router = Router();

async function buildStarterDecks() {
  return startermaps;
}

function normalizeDeckRow(row: any) {
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

  return {
    ...row,
    is_starter: Boolean(row.is_starter),
    mane_character: parsedMane || null,
    deck_banner_url: parsedCards.deck_banner_url || row.deck_banner_url || null,
    banner_crop_position: parsedCards.banner_crop_position || row.banner_crop_position || 'center 20%',
    story_deck: row.story_deck || parsedCards.story_deck || parsedCards.stories || [],
    scene_deck: row.scene_deck || parsedCards.scene_deck || parsedCards.scenes || [],
    main_deck: row.main_deck || parsedCards.main_deck || parsedCards.main || [],
  };
}

router.get('/decks', async (req, res) => {
  try {
    const [starters, result] = await Promise.all([
      buildStarterDecks(),
      pool.query('SELECT * FROM auth.decks ORDER BY created_at DESC;'),
    ]);

    const userDecks = result.rows.map(normalizeDeckRow);
    return res.json([...starters, ...userDecks]);
  } catch (err) {
    console.error('Error fetching decks:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch decks.' });
  }
});

router.get('/decks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (id.startsWith('starter-')) {
      const starters = await buildStarterDecks();
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

    return res.json(normalizeDeckRow(result.rows[0]));
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
    story_deck,
    stories,
    scene_deck,
    scenes,
    main_deck,
    main,
  } = req.body;

  const authorName = (req as any).user?.displayName || (req as any).user?.username || 'Player';
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
    const query = `
      INSERT INTO auth.decks (id, name, author, is_public, mane_character, cards)
      VALUES ($1, $2, $3, $4, $5, $6)
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
      resolvedPublic,
      resolvedMane ? JSON.stringify({ id: resolvedMane }) : null,
      JSON.stringify({
        story_deck: resolvedStories,
        scene_deck: resolvedScenes,
        main_deck: resolvedMain,
        deck_banner_url: deck_banner_url || null,
        banner_crop_position: banner_crop_position || 'center 20%',
      }),
    ]);

    return res.json(normalizeDeckRow(result.rows[0]));
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
    const query = `
      UPDATE auth.decks
      SET name = $1,
          is_public = $2,
          mane_character = $3,
          cards = $4
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
        banner_crop_position: banner_crop_position || 'center 20%',
      }),
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Deck not found.' });
    }

    return res.json(normalizeDeckRow(result.rows[0]));
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