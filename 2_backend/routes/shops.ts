import express from 'express';
import { pool } from '../../4_data/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware.js';

const router = express.Router();

// Tiered packs containing 1, 2, or 3 cards around 250 points base scale
const PACK_TIERS = {
  TIER_1: { name: 'Basic Pack (1 Card)', cost: 250, size: 1, rates: { C: 0.60, U: 0.30, R: 0.08, SR: 0.02 } },
  TIER_2: { name: 'Double Pack (2 Cards)', cost: 450, size: 2, rates: { C: 0.50, U: 0.35, R: 0.12, SR: 0.03 } },
  TIER_3: { name: 'Tri-Pack (3 Cards)', cost: 650, size: 3, rates: { C: 0.40, U: 0.40, R: 0.15, SR: 0.05 } }
};

// Helper to get current ISO week string (e.g., "2026-W46")
function getCurrentWeekId() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Get user shop status (Pony Points balance & active weekly deals)
router.get('/status', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    const userRes = await client.query('SELECT reward_points FROM auth.users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const rewardPoints = userRes.rows[0].reward_points;

    const weekId = getCurrentWeekId();
    let dealsRes = await client.query(
      `SELECT d.id, d.price, d.slot_index, c.id as card_id, c.name, c.card_type, c.element, c.rarity, c.cost, c.power, c.effect_text, c.image_url 
       FROM game.weekly_shop_deals d
       JOIN game.cards c ON d.card_id = c.id
       WHERE d.week_identifier = $1 ORDER BY d.slot_index ASC`,
      [weekId]
    );

    // If no deals for this week yet, generate 3 random higher-rarity cards (R, SR, SSR, UR)
    if (dealsRes.rows.length === 0) {
      const highRarityCards = await client.query(
        `SELECT id FROM game.cards WHERE rarity IN ('R', 'SR', 'SSR', 'UR', 'S') ORDER BY RANDOM() LIMIT 3`
      );

      if (highRarityCards.rows.length > 0) {
        for (let i = 0; i < highRarityCards.rows.length; i++) {
          await client.query(
            `INSERT INTO game.weekly_shop_deals (card_id, price, week_identifier, slot_index) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [highRarityCards.rows[i].id, 350, weekId, i + 1]
          );
        }
        dealsRes = await client.query(
          `SELECT d.id, d.price, d.slot_index, c.id as card_id, c.name, c.card_type, c.element, c.rarity, c.cost, c.power, c.effect_text, c.image_url 
           FROM game.weekly_shop_deals d
           JOIN game.cards c ON d.card_id = c.id
           WHERE d.week_identifier = $1 ORDER BY d.slot_index ASC`,
          [weekId]
        );
      }
    }

    res.json({
      reward_points: rewardPoints,
      weeklyDeals: dealsRes.rows,
      tiers: PACK_TIERS
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Buy Tiered Pack (1, 2, or 3 cards)
router.post('/buy-pack', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id; 
  const tier = req.body.tier as keyof typeof PACK_TIERS;
  const packConfig = PACK_TIERS[tier] || PACK_TIERS.TIER_1;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query('SELECT reward_points FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
    if (userRes.rows.length === 0) throw new Error('User not found');
    
    if (userRes.rows[0].reward_points < packConfig.cost) {
      throw new Error('Not enough Pony Points');
    }
    
    await client.query('UPDATE auth.users SET reward_points = reward_points - $1 WHERE id = $2', [packConfig.cost, userId]);

    const pulledCards = [];
    for (let i = 0; i < packConfig.size; i++) {
      const roll = Math.random();
      let targetRarity = 'C'; 
      
      let cumulative = 0;
      for (const [rarity, chance] of Object.entries(packConfig.rates)) {
        cumulative += chance;
        if (roll <= cumulative) {
          targetRarity = rarity;
          break;
        }
      }

      const cardRes = await client.query(
        `SELECT id, name, card_type, element, rarity, cost, power, effect_text, image_url FROM game.cards 
         WHERE rarity = $1 
         ORDER BY RANDOM() LIMIT 1`, 
        [targetRarity]
      );
      
      let pulledCard = cardRes.rows[0];
      if (!pulledCard) {
        const fallbackRes = await client.query(`SELECT id, name, card_type, element, rarity, cost, power, effect_text, image_url FROM game.cards ORDER BY RANDOM() LIMIT 1`);
        pulledCard = fallbackRes.rows[0];
      }

      if (pulledCard) {
        pulledCards.push(pulledCard);

        // Store into auth.user_cards matching your DBeaver schema
        await client.query(
          `INSERT INTO auth.user_cards (user_id, card_id, quantity) 
           VALUES ($1, $2, 1) 
           ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = auth.user_cards.quantity + 1`,
          [userId, pulledCard.id]
        );
      }
    }

    const updatedUser = await client.query('SELECT reward_points FROM auth.users WHERE id = $1', [userId]);

    await client.query('COMMIT');
    res.json({ success: true, remainingPoints: updatedUser.rows[0].reward_points, cards: pulledCards });

  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Buy guaranteed weekly deal card
router.post('/buy-deal', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const { dealId } = req.body;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dealRes = await client.query(
      `SELECT d.price, c.* FROM game.weekly_shop_deals d JOIN game.cards c ON d.card_id = c.id WHERE d.id = $1`,
      [dealId]
    );
    if (dealRes.rows.length === 0) throw new Error('Deal not found');
    const deal = dealRes.rows[0];

    const userRes = await client.query('SELECT reward_points FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
    if (userRes.rows.length === 0) throw new Error('User not found');

    if (userRes.rows[0].reward_points < deal.price) {
      throw new Error('Not enough Pony Points for this deal');
    }

    await client.query('UPDATE auth.users SET reward_points = reward_points - $1 WHERE id = $2', [deal.price, userId]);
    
    await client.query(
      `INSERT INTO auth.user_cards (user_id, card_id, quantity) 
       VALUES ($1, $2, 1) 
       ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = auth.user_cards.quantity + 1`,
      [userId, deal.id]
    );

    const updatedUser = await client.query('SELECT reward_points FROM auth.users WHERE id = $1', [userId]);

    await client.query('COMMIT');
    res.json({ success: true, remainingPoints: updatedUser.rows[0].reward_points, card: deal });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;