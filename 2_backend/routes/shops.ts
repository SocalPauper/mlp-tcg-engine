import express from 'express';
import { pool } from '../../4_data/db.js';
import { authenticateToken, AuthenticatedRequest } from '../authMiddleware.js';

const router = express.Router();

// Define pack tiers and their drop rates
const PACK_TIERS = {
  BASIC: { cost: 500, size: 1, rates: { SR: 0.70, CR: 0.25, GR: 0.05 } },
  PREMIUM: { cost: 1200, size: 3, rates: { CR: 0.60, GR: 0.30, SPR: 0.08, RR: 0.02 } }
};

router.post('/buy-pack', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id; 
  const tier = req.body.tier as keyof typeof PACK_TIERS;
  const packConfig = PACK_TIERS[tier];

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!packConfig) return res.status(400).json({ error: 'Invalid pack tier' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check points and deduct
    const userRes = await client.query('SELECT reward_points FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
    if (userRes.rows.length === 0) throw new Error('User not found');
    
    if (userRes.rows[0].reward_points < packConfig.cost) {
      throw new Error('Not enough points');
    }
    
    await client.query('UPDATE auth.users SET reward_points = reward_points - $1 WHERE id = $2', [packConfig.cost, userId]);

    // 2. Generate Random Cards
    const pulledCards = [];
    for (let i = 0; i < packConfig.size; i++) {
      const roll = Math.random();
      let targetRarity = 'SR'; 
      
      let cumulative = 0;
      for (const [rarity, chance] of Object.entries(packConfig.rates)) {
        cumulative += chance;
        if (roll <= cumulative) {
          targetRarity = rarity;
          break;
        }
      }

      // Query random premium card
      const cardRes = await client.query(
        `SELECT id, name, image_url, rarity FROM game.cards 
         WHERE rarity = $1 AND id NOT LIKE 'SD01%' 
         ORDER BY RANDOM() LIMIT 1`, 
        [targetRarity]
      );
      
      const pulledCard = cardRes.rows[0];
      if (pulledCard) {
        pulledCards.push(pulledCard);

        // 3. Insert or Update User Collection
        await client.query(
          `INSERT INTO public.user_cards (user_id, card_id, quantity) 
           VALUES ($1, $2, 1) 
           ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = public.user_cards.quantity + 1`,
          [userId, pulledCard.id]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, cards: pulledCards });

  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;