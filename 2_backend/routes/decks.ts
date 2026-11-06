import { Router } from 'express';
import { pool as db } from '../../4_data/db.ts';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM decks ORDER BY created_at DESC');
    const decks = result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      author: row.author,
      authorId: row.author_id,
      maneCharacter: row.mane_character ? (typeof row.mane_character === 'string' ? JSON.parse(row.mane_character) : row.mane_character) : null,
      cards: typeof row.cards === 'string' ? JSON.parse(row.cards) : (row.cards || [])
    }));
    res.json(decks);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching decks' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, author, authorId, maneCharacter, cards } = req.body;
    const result = await db.query(
      `INSERT INTO decks (id, name, author, author_id, mane_character, cards, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [
        'deck-' + Date.now(),
        name || 'New Deck', 
        author || 'Jesse Alvarez', 
        authorId || 'Jesse Alvarez', 
        maneCharacter ? JSON.stringify(maneCharacter) : null,
        JSON.stringify(cards || [])
      ]
    );
    const row = result.rows[0];
    res.json({
      id: row.id,
      name: row.name,
      author: row.author,
      authorId: row.author_id,
      maneCharacter: row.mane_character ? (typeof row.mane_character === 'string' ? JSON.parse(row.mane_character) : row.mane_character) : null,
      cards: typeof row.cards === 'string' ? JSON.parse(row.cards) : row.cards
    });
  } catch (err: any) {
    console.error('[DECK CREATE ERROR]', err.message);
    res.status(500).json({ error: 'Failed to create deck' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, maneCharacter, cards } = req.body;

    const result = await db.query(
      `UPDATE decks 
       SET name = COALESCE($1, name), 
           mane_character = $2, 
           cards = COALESCE($3, cards) 
       WHERE id = $4 RETURNING *`,
      [name, maneCharacter ? JSON.stringify(maneCharacter) : null, JSON.stringify(cards), id]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Deck not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update deck' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM decks WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete deck' });
  }
});

export default router;