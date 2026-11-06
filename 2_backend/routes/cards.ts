import { Router } from 'express';
import { pool as db } from '../../4_data/db.ts';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { search, type } = req.query;
    let query = 'SELECT * FROM cards WHERE 1=1';
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND name ILIKE $${params.length}`;
    }

    if (type && type !== 'All') {
      params.push(type);
      query += ` AND (card_type = $${params.length} OR cardtype = $${params.length})`;
    }

    query += ' ORDER BY id ASC LIMIT 200';
    
    const result = await db.query(query, params);
    
    // Flexible mapping to support both schema variations safely
    const cards = result.rows.map(row => ({
      id: row.id,
      cardNumber: row.card_number || row.cardnumber || row.id,
      name: row.name,
      type: row.card_type || row.cardtype || 'Character',
      element: row.element || 'None',
      imageUrl: row.image_url || row.imageurl || `/assets/cards/${row.id}.webp`,
      power: row.power || 0,
      defense: row.defense || 0,
      effectText: row.effect_text || row.effecttext || ''
    }));

    res.json(cards);
  } catch (err: any) {
    console.error('[CARDS API ERROR]', err.message);
    res.status(500).json({ error: 'Failed to fetch card catalog' });
  }
});

export default router;