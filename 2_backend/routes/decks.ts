import { Router } from 'express';
import { pool } from '../../4_data/db.js';

const router = Router();

const STARTER_DEFINITIONS = [
  { id: 'starter-sd01', setCode: 'SD01', name: 'Twilight Sparkle - Magic Starter', element: 'Magic' },
  { id: 'starter-sd02', setCode: 'SD02', name: 'Rainbow Dash - Loyalty Starter', element: 'Loyalty' },
  { id: 'starter-sd03', setCode: 'SD03', name: 'Applejack - Honesty Starter', element: 'Honesty' },
  { id: 'starter-sd04', setCode: 'SD04', name: 'Rarity - Generosity Starter', element: 'Generosity' },
  { id: 'starter-sd05', setCode: 'SD05', name: 'Fluttershy - Kindness Starter', element: 'Kindness' },
  { id: 'starter-sd06', setCode: 'SD06', name: 'Pinkie Pie - Laughter Starter', element: 'Laughter' },
];

async function buildStarterDecks() {
  const cardRes = await pool.query(
    `SELECT id, name, set_code, card_type, element
     FROM game.cards
     WHERE set_code IN ('SD01', 'SD02', 'SD03', 'SD04', 'SD05', 'SD06')
        OR id ~* '^SD0[1-6]'
     ORDER BY id ASC;`
  );

  const allStarterCards = cardRes.rows;

  return STARTER_DEFINITIONS.map((def) => {
    const setCards = allStarterCards.filter(
      (c) =>
        (c.set_code && c.set_code.toUpperCase() === def.setCode) ||
        c.id.toUpperCase().startsWith(def.setCode)
    );

    const maneCard =
      setCards.find(
        (c) =>
          c.card_type === 'Mane Character' &&
          !c.name.includes(' - ') &&
          !c.name.includes(' – ') &&
          !c.name.includes('Stage')
      ) || setCards.find((c) => c.card_type === 'Mane Character') || null;

    const storyCards = setCards.filter(
      (c) =>
        c.card_type === 'Story' ||
        /-(?:C2[5-9]|C[3-4]\d)/i.test(c.id) ||
        c.name.includes(' - ') ||
        c.name.includes(' – ')
    );

    const sceneCards = setCards.filter((c) => c.card_type === 'Scene');

    const mainCards = setCards.filter(
      (c) =>
        c.id !== maneCard?.id &&
        !storyCards.some((s) => s.id === c.id) &&
        !sceneCards.some((sc) => sc.id === c.id)
    );

    return {
      id: def.id,
      name: def.name,
      author: 'Official Starter',
      element: def.element,
      is_public: true,
      is_starter: true,
      mane_character: maneCard ? maneCard.id : null,
      story_deck: storyCards.map((c) => c.id),
      scene_deck: sceneCards.map((c) => c.id),
      main_deck: mainCards.map((c) => c.id),
    };
  });
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
      // Keep raw string ID if not JSON
    }
  } else if (parsedMane && typeof parsedMane === 'object') {
    parsedMane = parsedMane.id || parsedMane.card_id || null;
  }

  return {
    ...row,
    is_starter: Boolean(row.is_starter),
    mane_character: parsedMane || null,
    story_deck: row.story_deck || parsedCards.story_deck || parsedCards.stories || [],
    scene_deck: row.scene_deck || parsedCards.scene_deck || parsedCards.scenes || [],
    main_deck: row.main_deck || parsedCards.main_deck || parsedCards.main || [],
  };
}

// GET /api/decks -> Returns all 6 official starter decks + player decks
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

// GET /api/decks/:id -> Hydrates a single starter deck or user deck for EDIT / VIEW / COPY
router.get('/decks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (id.startsWith('starter-')) {
      const starters = await buildStarterDecks();
      const foundStarter = starters.find((s) => s.id === id);
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

// POST /api/decks -> Creates a new user deck (including copies of starter decks)
router.post('/decks', async (req, res) => {
  const {
    id,
    name,
    is_public,
    isPublic,
    mane_character,
    mane,
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
      resolvedMane,
      JSON.stringify({
        story_deck: resolvedStories,
        scene_deck: resolvedScenes,
        main_deck: resolvedMain,
      }),
    ]);

    return res.json(normalizeDeckRow(result.rows[0]));
  } catch (err) {
    console.error('Error saving deck:', err);
    return res.status(500).json({ success: false, message: 'Failed to save deck.' });
  }
});

// PUT /api/decks/:id -> Updates an existing custom deck (blocks editing starter decks)
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
      resolvedMane,
      JSON.stringify({
        story_deck: resolvedStories,
        scene_deck: resolvedScenes,
        main_deck: resolvedMain,
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

// DELETE /api/decks/:id -> Deletes a custom deck (blocks deleting starter decks)
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