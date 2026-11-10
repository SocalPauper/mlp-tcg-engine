import { Router } from 'express';
import { pool } from '../../4_data/db.js';

const router = Router();

router.get('/decks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM auth.decks ORDER BY created_at DESC;');
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching decks:', err);
    return res.json([]);
  }
});

router.post('/decks', async (req, res) => {
  const { id, name, isPublic, mane, stories, scenes, main } = req.body;
  const authorName = (req as any).user?.displayName || 'Player';

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
      id || ('deck-' + Date.now()),
      name,
      authorName,
      isPublic || false,
      JSON.stringify(mane),
      JSON.stringify({ stories, scenes, main })
    ]);
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saving deck:', err);
    return res.status(500).json({ success: false, message: 'Failed to save deck.' });
  }
});

export default router;