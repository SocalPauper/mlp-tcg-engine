import { Router } from 'express';
import { pool } from '../../4_data/db.js';

const router = Router();

router.get('/cards', async (req, res) => {
  try {
    // Explicitly query game.cards to match your database schema
    const result = await pool.query('SELECT * FROM game.cards ORDER BY id ASC;');
    return res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch cards from database:', err);
    return res.status(500).json({ success: false, message: 'Internal server error loading cards.' });
  }
});

export default router;