import express from 'express';
import { pool } from '../../4_data/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware.js';

const router = express.Router();

// 3 Rounded Booster Pack Tiers (1, 3, and 5 cards at 300 / 600 / 1000 Pony Points)
const PACK_TIERS = {
  SPARKLE: {
    name: 'Sparkle Single',
    badge: '1 FOIL CARD',
    cost: 300,
    size: 1,
    description: '1 guaranteed above-Rare foil card (SR through SPR).',
    rates: { SR: 0.65, SSR: 0.22, UR: 0.08, GR: 0.03, CR: 0.015, SPR: 0.005 },
  },
  HARMONY: {
    name: 'Harmony Trio',
    badge: '3 FOIL CARDS',
    cost: 600,
    size: 3,
    description: '3 foil cards at 200 pts each (33% bonus value) with boosted SSR/UR odds.',
    rates: { SR: 0.55, SSR: 0.27, UR: 0.10, GR: 0.045, CR: 0.025, SPR: 0.01 },
  },
  ROYAL: {
    name: 'Canterlot Royal 5-Pack',
    badge: '5 FOIL CARDS',
    cost: 1000,
    size: 5,
    description: '5 foil cards with massively boosted UR, GR, CR & SPR chase rates!',
    rates: { SR: 0.40, SSR: 0.32, UR: 0.15, GR: 0.07, CR: 0.04, SPR: 0.02 },
  },
};

// Rounded Pony Point trade-in values for duplicate cards beyond a 3-card playset
const TRADE_IN_VALUES: Record<string, number> = {
  SR: 75,
  SSR: 150,
  UR: 300,
  GR: 500,
  CR: 750,
  SPR: 1000,
};

function getCurrentWeekId() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function calculateTradeInSummary(client: any, userId: string) {
  const { rows } = await client.query(
    `SELECT uc.card_id, uc.quantity, c.rarity
     FROM auth.user_cards uc
     JOIN game.cards c ON uc.card_id = c.id
     WHERE uc.user_id = $1 AND uc.quantity > 3`,
    [userId]
  );

  let extraCardsCount = 0;
  let totalPointsValue = 0;

  for (const row of rows) {
    const extras = Number(row.quantity) - 3;
    const rarity = String(row.rarity || 'SR').toUpperCase();
    const rate = TRADE_IN_VALUES[rarity] || 50;
    extraCardsCount += extras;
    totalPointsValue += extras * rate;
  }

  return { extraCardsCount, totalPointsValue };
}

// Get user shop status (Pony Points balance, automatic weekly deals & duplicate trade-in summary)
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

    // Automatically generate 4 rounded-price weekly featured cards if a new ISO week has started
    if (dealsRes.rows.length === 0) {
      const slotSpecs = [
        { rarities: ['SR'], price: 400 },
        { rarities: ['SSR'], price: 800 },
        { rarities: ['UR'], price: 1500 },
        { rarities: ['GR', 'CR', 'SPR'], price: 2500 },
      ];

      const chosenIds = new Set<string>();
      for (let i = 0; i < slotSpecs.length; i++) {
        const spec = slotSpecs[i];
        let pickRes = await client.query(
          `SELECT id FROM game.cards
           WHERE rarity = ANY($1)
           ORDER BY RANDOM() LIMIT 1`,
          [spec.rarities]
        );

        if (pickRes.rows.length === 0) {
          pickRes = await client.query(
            `SELECT id FROM game.cards
             WHERE rarity IN ('SR', 'SSR', 'UR', 'GR', 'CR', 'SPR')
             ORDER BY RANDOM() LIMIT 1`
          );
        }

        const pickedId = pickRes.rows[0]?.id;
        if (pickedId && !chosenIds.has(pickedId)) {
          chosenIds.add(pickedId);
          await client.query(
            `INSERT INTO game.weekly_shop_deals (card_id, price, week_identifier, slot_index)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [pickedId, spec.price, weekId, i + 1]
          );
        }
      }

      dealsRes = await client.query(
        `SELECT d.id, d.price, d.slot_index, c.id as card_id, c.name, c.card_type, c.element, c.rarity, c.cost, c.power, c.effect_text, c.image_url 
         FROM game.weekly_shop_deals d
         JOIN game.cards c ON d.card_id = c.id
         WHERE d.week_identifier = $1 ORDER BY d.slot_index ASC`,
        [weekId]
      );
    }

    const tradeInSummary = await calculateTradeInSummary(client, userId);

    res.json({
      reward_points: rewardPoints,
      weekId,
      weeklyDeals: dealsRes.rows,
      tiers: PACK_TIERS,
      tradeInValues: TRADE_IN_VALUES,
      tradeInSummary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Buy Tiered Pack (SPARKLE, HARMONY, ROYAL)
router.post('/buy-pack', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const tierKey = String(req.body.tier || 'SPARKLE').toUpperCase() as keyof typeof PACK_TIERS;
  const packConfig = PACK_TIERS[tierKey] || PACK_TIERS.SPARKLE;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      'SELECT reward_points FROM auth.users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (userRes.rows.length === 0) throw new Error('User not found');

    if (userRes.rows[0].reward_points < packConfig.cost) {
      throw new Error('Not enough Pony Points');
    }

    await client.query(
      'UPDATE auth.users SET reward_points = reward_points - $1 WHERE id = $2',
      [packConfig.cost, userId]
    );

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

      let cardRes = await client.query(
        `SELECT id, name, card_type, element, rarity, cost, power, effect_text, image_url
         FROM game.cards
         WHERE rarity = $1
         ORDER BY RANDOM() LIMIT 1`,
        [targetRarity]
      );

      if (cardRes.rows.length === 0) {
        cardRes = await client.query(
          `SELECT id, name, card_type, element, rarity, cost, power, effect_text, image_url
           FROM game.cards
           WHERE rarity IN ('SR', 'SSR', 'UR', 'GR', 'CR', 'SPR')
           ORDER BY RANDOM() LIMIT 1`
        );
      }

      const pulledCard = cardRes.rows[0];
      if (pulledCard) {
        pulledCards.push(pulledCard);

        await client.query(
          `INSERT INTO auth.user_cards (user_id, card_id, quantity, user_alerted)
           VALUES ($1, $2, 1, FALSE)
           ON CONFLICT (user_id, card_id)
           DO UPDATE SET
             quantity = auth.user_cards.quantity + 1,
             user_alerted = FALSE`,
          [userId, pulledCard.id]
        );
      }
    }

    const updatedUser = await client.query(
      'SELECT reward_points FROM auth.users WHERE id = $1',
      [userId]
    );
    const tradeInSummary = await calculateTradeInSummary(client, userId);

    await client.query('COMMIT');
    res.json({
      success: true,
      tierName: packConfig.name,
      remainingPoints: updatedUser.rows[0].reward_points,
      cards: pulledCards,
      tradeInSummary,
    });
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
      `SELECT d.price, c.* FROM game.weekly_shop_deals d
       JOIN game.cards c ON d.card_id = c.id
       WHERE d.id = $1`,
      [dealId]
    );
    if (dealRes.rows.length === 0) throw new Error('Deal not found');
    const deal = dealRes.rows[0];

    const userRes = await client.query(
      'SELECT reward_points FROM auth.users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (userRes.rows.length === 0) throw new Error('User not found');

    if (userRes.rows[0].reward_points < deal.price) {
      throw new Error('Not enough Pony Points for this deal');
    }

    await client.query(
      'UPDATE auth.users SET reward_points = reward_points - $1 WHERE id = $2',
      [deal.price, userId]
    );

    await client.query(
      `INSERT INTO auth.user_cards (user_id, card_id, quantity, user_alerted)
       VALUES ($1, $2, 1, FALSE)
       ON CONFLICT (user_id, card_id)
       DO UPDATE SET
         quantity = auth.user_cards.quantity + 1,
         user_alerted = FALSE`,
      [userId, deal.id]
    );

    const updatedUser = await client.query(
      'SELECT reward_points FROM auth.users WHERE id = $1',
      [userId]
    );
    const tradeInSummary = await calculateTradeInSummary(client, userId);

    await client.query('COMMIT');
    res.json({
      success: true,
      remainingPoints: updatedUser.rows[0].reward_points,
      card: deal,
      tradeInSummary,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Trade in all duplicate copies beyond 3 per card for rounded Pony Points
router.post('/trade-in-extras', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT uc.card_id, uc.quantity, c.rarity
       FROM auth.user_cards uc
       JOIN game.cards c ON uc.card_id = c.id
       WHERE uc.user_id = $1 AND uc.quantity > 3
       FOR UPDATE OF uc`,
      [userId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No extra copies beyond 3 to trade in!' });
    }

    let tradedCount = 0;
    let pointsEarned = 0;

    for (const row of rows) {
      const extras = Number(row.quantity) - 3;
      const rarity = String(row.rarity || 'SR').toUpperCase();
      const rate = TRADE_IN_VALUES[rarity] || 50;
      tradedCount += extras;
      pointsEarned += extras * rate;
    }

    await client.query(
      `UPDATE auth.user_cards
       SET quantity = 3
       WHERE user_id = $1 AND quantity > 3`,
      [userId]
    );

    const updatedUser = await client.query(
      `UPDATE auth.users
       SET reward_points = reward_points + $1
       WHERE id = $2
       RETURNING reward_points`,
      [pointsEarned, userId]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      tradedCount,
      pointsEarned,
      remainingPoints: updatedUser.rows[0].reward_points,
      tradeInSummary: { extraCardsCount: 0, totalPointsValue: 0 },
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;