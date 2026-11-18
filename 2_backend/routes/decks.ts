import { Router } from 'express';
import { pool } from '../../4_data/db.js';

const router = Router();

// Maps the 6 retail Kayou Starter Boxes (SD01A through SD01F) to their exact elements & card prefixes
const STARTER_DEFINITIONS = [
  { id: 'starter-sd01', prefix: 'SD01A', name: 'Twilight Sparkle - Magic Starter', element: 'Magic', pony: 'Twilight Sparkle' },
  { id: 'starter-sd02', prefix: 'SD01E', name: 'Rainbow Dash - Loyalty Starter', element: 'Loyalty', pony: 'Rainbow Dash' },
  { id: 'starter-sd03', prefix: 'SD01D', name: 'Applejack - Honesty Starter', element: 'Honesty', pony: 'Applejack' },
  { id: 'starter-sd04', prefix: 'SD01F', name: 'Rarity - Generosity Starter', element: 'Generosity', pony: 'Rarity' },
  { id: 'starter-sd05', prefix: 'SD01B', name: 'Fluttershy - Kindness Starter', element: 'Kindness', pony: 'Fluttershy' },
  { id: 'starter-sd06', prefix: 'SD01C', name: 'Pinkie Pie - Laughter Starter', element: 'Laughter', pony: 'Pinkie Pie' },
];

function isTrueManeCharacter(c: any): boolean {
  const cardType = String(c.card_type || '').trim().toLowerCase();
  if (cardType !== 'mane character' && cardType !== 'maincharacter') return false;
  const name = String(c.name || '');
  const id = String(c.id || '');
  const effect = String(c.effect_text || '');
  if (name.includes(' - ') || name.includes(' – ') || name.includes('Stage')) return false;
  if (id.includes('SPR') || id.includes('ER')) return false;
  if (/Experience Report|Inspo Boost|Choose 1 Character|Adventure Area/i.test(effect)) return false;
  if (Number(c.cost) > 0) return false;
  return true;
}

function fillBucketWithCap(poolRows: any[], targetCount: number, maxPerBaseId: number): string[] {
  const result: string[] = [];
  const counts: Record<string, number> = {};
  for (const row of poolRows) {
    if (result.length >= targetCount) break;
    const baseId = String(row.id).replace(/-S$/i, '');
    const current = counts[baseId] || 0;
    const toAdd = Math.min(maxPerBaseId - current, targetCount - result.length);
    for (let i = 0; i < toAdd; i++) {
      result.push(row.id);
    }
    counts[baseId] = current + toAdd;
  }
  return result;
}

async function buildStarterDecks() {
  const cardRes = await pool.query(
    `SELECT id, name, set_code, card_type, element, rarity, cost, effect_text, image_url
     FROM game.cards
     ORDER BY
       CASE WHEN id ~* '^SD01[A-F]-' THEN 0 WHEN set_code ILIKE 'SD%' OR id ~* '^SD' THEN 1 ELSE 2 END,
       id ASC;`
  );

  const allCards = cardRes.rows;
  const trueManes = allCards.filter(isTrueManeCharacter);

  return STARTER_DEFINITIONS.map((def) => {
    const subPrefixRegex = new RegExp(`^${def.prefix}-`, 'i');

    // 1. Main Character (prefer exact retail sub-deck card, then shared SD01)
    const maneCard =
      trueManes.find((c) => subPrefixRegex.test(c.id) && c.name.toLowerCase().includes(def.pony.toLowerCase())) ||
      trueManes.find((c) => c.name.toLowerCase().includes(def.pony.toLowerCase()) && /^SD/i.test(c.id)) ||
      trueManes.find((c) => c.name.toLowerCase().includes(def.pony.toLowerCase())) ||
      null;

    // 2. Include all non-alt cards from this retail starter box (SD01A..SD01F) plus matching element cards
    const legalPool = allCards
      .filter((c) => {
        const idStr = String(c.id || '');
        if (idStr.includes('-S')) return false;
        if (subPrefixRegex.test(idStr)) return true;
        if (idStr.includes('SPR')) return false;
        const el = String(c.element || '').trim().toLowerCase();
        return el === def.element.toLowerCase() || el === 'everyday' || !el;
      })
      .sort((a, b) => {
        const aExact = subPrefixRegex.test(a.id) ? 0 : /^SD01-/i.test(a.id) ? 1 : 2;
        const bExact = subPrefixRegex.test(b.id) ? 0 : /^SD01-/i.test(b.id) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
        return String(a.id).localeCompare(String(b.id));
      });

    // 3. Story Deck: 4-stage retail Story arc
    const storyCandidates = legalPool.filter((c) => {
      const t = String(c.card_type || '').trim().toLowerCase();
      return t === 'story' || String(c.name || '').includes(' - ') || String(c.name || '').includes(' – ');
    });
    const storyDeck: string[] = [];
    let arcPrefix = '';
    for (const sc of storyCandidates) {
      const arcName = String(sc.name || '').split(/[-–]/)[0].trim().toLowerCase();
      if (!arcPrefix) arcPrefix = arcName;
      if (arcName === arcPrefix && storyDeck.length < 4) {
        storyDeck.push(sc.id);
      }
      if (storyDeck.length === 4) break;
    }

    // 4. Scene Deck: 15 Scenes
    const sceneCandidates = legalPool.filter(
      (c) => String(c.card_type || '').trim().toLowerCase() === 'scene'
    );
    const sceneDeck = fillBucketWithCap(sceneCandidates, 15, 3);

    // 5. Main Deck: Retail starter ratio = 34 Characters/Friends + 12 Events + 4 Items = 50 Cards
    const charCandidates = legalPool.filter((c) => {
      const t = String(c.card_type || '').trim().toLowerCase();
      return (
        (t === 'character' || t === 'friend character') &&
        !String(c.name || '').includes(' - ') &&
        !String(c.name || '').includes(' – ') &&
        !isTrueManeCharacter(c)
      );
    });
    const eventCandidates = legalPool.filter(
      (c) => String(c.card_type || '').trim().toLowerCase() === 'event'
    );
    const itemCandidates = legalPool.filter(
      (c) => String(c.card_type || '').trim().toLowerCase() === 'item'
    );

    const pickedChars = fillBucketWithCap(charCandidates, 34, 3);
    const pickedEvents = fillBucketWithCap(eventCandidates, 12, 3);
    const pickedItems = fillBucketWithCap(itemCandidates, 4, 3);

    let mainDeck = [...pickedChars, ...pickedEvents, ...pickedItems];
    if (mainDeck.length < 50) {
      const extraNeeded = 50 - mainDeck.length;
      const usedSet = new Set(mainDeck);
      const fallbackPool = [...charCandidates, ...eventCandidates, ...itemCandidates].filter(
        (c) => !usedSet.has(c.id)
      );
      mainDeck = [...mainDeck, ...fillBucketWithCap(fallbackPool, extraNeeded, 3)];
    }

    return {
      id: def.id,
      name: def.name,
      author: 'Official Retail Starter',
      element: def.element,
      mane_image_url: maneCard?.image_url || null,
      is_public: true,
      is_starter: true,
      mane_character: maneCard ? maneCard.id : null,
      story_deck: storyDeck,
      scene_deck: sceneDeck,
      main_deck: mainDeck.slice(0, 50),
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
      // Keep raw string ID
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