import { Router } from 'express';
import { pool } from '../../4_data/db.js';

const router = Router();

router.post('/decks', async (req, res) => {
  const { id, name, isPublic, mane, stories, scenes, main } = req.body;
  
  // Extract authenticated user info from session middleware (e.g. req.user)
  const authorName = (req as any).user?.displayName || (req as any).user?.username || 'Authenticated Player';

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
    return res.status(500).json({ success: false, message: 'Failed to save deck to database.' });
  }
});

export default router;