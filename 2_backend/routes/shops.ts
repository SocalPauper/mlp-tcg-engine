import express from 'express';
import { pool } from '../../4_data/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware.js';

const router = express.Router();

const PACK_TIERS = {
  STANDARD: {
    name: 'Standard Booster Pack',
    badge: '3 CHASE CARDS',
    cost: 100,
    packsCount: 1,
    cardsPerPack: 3,
    description:
      '3 high-rarity cards (SR, ER, UR, CR, GR & Shining -S). Includes 10-pack CR+ pity guarantee!',
    rates: { SR: 0.65, UR: 0.22, CR: 0.08, SHINING: 0.03, GR: 0.02 },
  },
  SHINING: {
    name: 'Shining & UR+ Pack',
    badge: '1 GUARANTEED UR+',
    cost: 180,
    packsCount: 1,
    cardsPerPack: 1,
    description:
      '1 guaranteed Ultra Rare, Crystal Rare, Gold Rare, or Shining (-S) foil alternate art!',
    rates: { UR: 0.50, CR: 0.25, SHINING: 0.15, GR: 0.10 },
  },
  BUNDLE: {
    name: '5-Pack Booster Box',
    badge: '15 CARDS (5×3)',
    cost: 450,
    packsCount: 5,
    cardsPerPack: 3,
    description:
      '5 Standard Boosters (10% discount) with a guaranteed UR or higher chase hit in the box!',
    rates: { SR: 0.60, UR: 0.24, CR: 0.09, SHINING: 0.04, GR: 0.03 },
  },
};

const TRADE_IN_VALUES: Record<string, number> = {
  C: 5,
  U: 10,
  R: 15,
  SPR: 15,
  SR: 20,
  SSR: 35,
  UR: 50,
  CR: 60,
  DR: 80,
  SHINING: 100,
  GR: 100,
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

function getCardDustRate(cardId: string, rarity: string): number {
  if (String(cardId || '').trim().toUpperCase().endsWith('-S')) {
    return TRADE_IN_VALUES.SHINING;
  }
  return TRADE_IN_VALUES[String(rarity || 'SR').trim().toUpperCase()] ?? 20;
}

function getMaxPlaysetForCard(cardType: string): number {
  const t = String(cardType || '').trim().toLowerCase();
  return t.includes('mane') || t.includes('main character') ? 1 : 4;
}

async function calculateTradeInSummary(client: any, userId: string) {
  const { rows } = await client.query(
    `SELECT uc.card_id, uc.quantity, c.rarity, c.card_type
     FROM auth.user_cards uc
     JOIN game.cards c ON uc.card_id = c.id
     WHERE uc.user_id = $1`,
    [userId]
  );

  let extraCardsCount = 0;
  let totalPointsValue = 0;

  for (const row of rows) {
    const maxPlayset = getMaxPlaysetForCard(row.card_type);
    const qty = Number(row.quantity) || 0;
    if (qty > maxPlayset) {
      const extras = qty - maxPlayset;
      const rate = getCardDustRate(row.card_id, row.rarity);
      extraCardsCount += extras;
      totalPointsValue += extras * rate;
    }
  }

  return { extraCardsCount, totalPointsValue };
}

async function getUserOwnedQuantities(client: any, userId: string): Promise<Record<string, number>> {
  const { rows } = await client.query(
    `SELECT card_id, quantity FROM auth.user_cards WHERE user_id = $1`,
    [userId]
  );
  const ownedQuantities: Record<string, number> = {};
  for (const r of rows) {
    ownedQuantities[r.card_id] = Number(r.quantity) || 0;
  }
  return ownedQuantities;
}

async function drawSingleChaseCard(client: any, bucket: string) {
  let cardRes;
  if (bucket === 'SHINING') {
    cardRes = await client.query(
      `SELECT id, name, card_type, element, rarity, cost, power, effect_text, image_url
       FROM game.cards
       WHERE id ILIKE '%-S'
       ORDER BY RANDOM() LIMIT 1`
    );
  } else {
    cardRes = await client.query(
      `SELECT id, name, card_type, element, rarity, cost, power, effect_text, image_url
       FROM game.cards
       WHERE rarity = $1 AND id NOT ILIKE '%-S'
       ORDER BY RANDOM() LIMIT 1`,
      [bucket]
    );
  }

  if (!cardRes || cardRes.rows.length === 0) {
    cardRes = await client.query(
      `SELECT id, name, card_type, element, rarity, cost, power, effect_text, image_url
       FROM game.cards
       WHERE rarity IN ('SR', 'SSR', 'UR', 'GR', 'CR', 'DR') OR id ILIKE '%-S'
       ORDER BY RANDOM() LIMIT 1`
    );
  }
  return cardRes.rows[0];
}

router.get('/status', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    const userRes = await client.query(
      'SELECT reward_points, pity_counter FROM auth.users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const rewardPoints = userRes.rows[0].reward_points;
    const pityCounter = userRes.rows[0].pity_counter ?? 0;

    const weekId = getCurrentWeekId();
    let dealsRes = await client.query(
      `SELECT d.id, d.price, d.slot_index, c.id as card_id, c.name, c.card_type, c.element, c.rarity, c.cost, c.power, c.effect_text, c.image_url 
       FROM game.weekly_shop_deals d
       JOIN game.cards c ON d.card_id = c.id
       WHERE d.week_identifier = $1 ORDER BY d.slot_index ASC`,
      [weekId]
    );

    if (dealsRes.rows.length === 0) {
      const slotSpecs = [
        { query: `rarity = 'SR' AND id NOT ILIKE '%-S'`, price: 150 },
        { query: `rarity = 'UR' AND id NOT ILIKE '%-S'`, price: 350 },
        { query: `(rarity = 'CR' OR id ILIKE '%-S')`, price: 350 },
        { query: `rarity = 'GR'`, price: 600 },
      ];

      const chosenIds = new Set<string>();
      for (let i = 0; i < slotSpecs.length; i++) {
        const spec = slotSpecs[i];
        let pickRes = await client.query(
          `SELECT id FROM game.cards WHERE ${spec.query} ORDER BY RANDOM() LIMIT 1`
        );
        if (pickRes.rows.length === 0) {
          pickRes = await client.query(
            `SELECT id FROM game.cards WHERE rarity IN ('SR', 'UR', 'CR', 'GR', 'DR') ORDER BY RANDOM() LIMIT 1`
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
    const ownedQuantities = await getUserOwnedQuantities(client, userId);

    res.json({
      reward_points: rewardPoints,
      pityCounter,
      weekId,
      weeklyDeals: dealsRes.rows,
      tiers: PACK_TIERS,
      tradeInValues: TRADE_IN_VALUES,
      tradeInSummary,
      ownedQuantities,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/buy-pack', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const tierKey = String(req.body.tier || 'STANDARD').toUpperCase() as keyof typeof PACK_TIERS;
  const packConfig = PACK_TIERS[tierKey] || PACK_TIERS.STANDARD;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      'SELECT reward_points, pity_counter FROM auth.users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (userRes.rows.length === 0) throw new Error('User not found');

    if (userRes.rows[0].reward_points < packConfig.cost) {
      throw new Error('Not enough Pony Points');
    }

    let pityCounter = Number(userRes.rows[0].pity_counter || 0);

    await client.query(
      'UPDATE auth.users SET reward_points = reward_points - $1 WHERE id = $2',
      [packConfig.cost, userId]
    );

    const totalCards = packConfig.packsCount * packConfig.cardsPerPack;
    const pulledCards: any[] = [];
    let autoDustEarned = 0;

    for (let i = 0; i < totalCards; i++) {
      const isChaseSlot =
        packConfig.cardsPerPack === 1 || (i + 1) % packConfig.cardsPerPack === 0;

      let targetBucket = 'SR';
      if (isChaseSlot) {
        pityCounter += 1;
        if (pityCounter >= 10) {
          const pityRoll = Math.random();
          targetBucket = pityRoll < 0.6 ? 'CR' : pityRoll < 0.85 ? 'SHINING' : 'GR';
          pityCounter = 0;
        } else {
          const roll = Math.random();
          let cumulative = 0;
          for (const [bucket, chance] of Object.entries(packConfig.rates)) {
            cumulative += chance;
            if (roll <= cumulative) {
              targetBucket = bucket;
              break;
            }
          }
          if (['CR', 'SHINING', 'GR'].includes(targetBucket)) {
            pityCounter = 0;
          }
        }
      } else {
        targetBucket = Math.random() < 0.85 ? 'SR' : 'UR';
      }

      if (
        tierKey === 'BUNDLE' &&
        i === totalCards - 1 &&
        !pulledCards.some(
          (c) => ['UR', 'CR', 'GR', 'DR'].includes(c.rarity) || String(c.id).endsWith('-S')
        )
      ) {
        targetBucket = 'UR';
      }

      const pulledCard = await drawSingleChaseCard(client, targetBucket);
      if (pulledCard) {
        const maxPlayset = getMaxPlaysetForCard(pulledCard.card_type);
        const existingRes = await client.query(
          'SELECT quantity FROM auth.user_cards WHERE user_id = $1 AND card_id = $2',
          [userId, pulledCard.id]
        );
        const currentQty = Number(existingRes.rows[0]?.quantity) || 0;

        if (currentQty >= maxPlayset) {
          const dust = getCardDustRate(pulledCard.id, pulledCard.rarity);
          autoDustEarned += dust;
          pulledCards.push({ ...pulledCard, convertedToDust: dust });
        } else {
          pulledCards.push(pulledCard);
          await client.query(
            `INSERT INTO auth.user_cards (user_id, card_id, quantity, user_alerted)
             VALUES ($1, $2, 1, FALSE)
             ON CONFLICT (user_id, card_id)
             DO UPDATE SET
               quantity = LEAST($3, auth.user_cards.quantity + 1),
               user_alerted = FALSE`,
            [userId, pulledCard.id, maxPlayset]
          );
        }
      }
    }

    const updatedUser = await client.query(
      `UPDATE auth.users
       SET reward_points = reward_points + $1,
           pity_counter = $2
       WHERE id = $3
       RETURNING reward_points, pity_counter`,
      [autoDustEarned, pityCounter, userId]
    );

    const tradeInSummary = await calculateTradeInSummary(client, userId);
    const ownedQuantities = await getUserOwnedQuantities(client, userId);

    await client.query('COMMIT');
    res.json({
      success: true,
      tierName: packConfig.name,
      remainingPoints: updatedUser.rows[0].reward_points,
      pityCounter: updatedUser.rows[0].pity_counter,
      autoDustEarned,
      cards: pulledCards,
      tradeInSummary,
      ownedQuantities,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Buy guaranteed weekly deal card — strictly capped at 4x (or 1x for Mane Characters)
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
    if (dealRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Deal not found' });
    }
    const deal = dealRes.rows[0];

    const maxPlayset = getMaxPlaysetForCard(deal.card_type);
    const existingRes = await client.query(
      'SELECT quantity FROM auth.user_cards WHERE user_id = $1 AND card_id = $2 FOR UPDATE',
      [userId, deal.id]
    );
    const currentQty = Number(existingRes.rows[0]?.quantity) || 0;
    if (currentQty >= maxPlayset) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `You already own the maximum playset (${currentQty}/${maxPlayset}) of ${deal.name}!`,
      });
    }

    const userRes = await client.query(
      'SELECT reward_points FROM auth.users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    if (userRes.rows[0].reward_points < deal.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough Pony Points for this deal' });
    }

    await client.query('UPDATE auth.users SET reward_points = reward_points - $1 WHERE id = $2', [
      deal.price,
      userId,
    ]);

    const upsertRes = await client.query(
      `INSERT INTO auth.user_cards (user_id, card_id, quantity, user_alerted)
       VALUES ($1, $2, 1, FALSE)
       ON CONFLICT (user_id, card_id)
       DO UPDATE SET
         quantity = LEAST($3, auth.user_cards.quantity + 1),
         user_alerted = FALSE
       RETURNING quantity`,
      [userId, deal.id, maxPlayset]
    );

    const updatedUser = await client.query('SELECT reward_points FROM auth.users WHERE id = $1', [
      userId,
    ]);
    const tradeInSummary = await calculateTradeInSummary(client, userId);
    const ownedQuantities = await getUserOwnedQuantities(client, userId);

    await client.query('COMMIT');
    res.json({
      success: true,
      remainingPoints: updatedUser.rows[0].reward_points,
      card: deal,
      newQuantity: Number(upsertRes.rows[0]?.quantity) || currentQty + 1,
      maxPlayset,
      tradeInSummary,
      ownedQuantities,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Trade in any extra copies beyond a 4-card playset
router.post('/trade-in-extras', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT uc.card_id, uc.quantity, c.rarity, c.card_type
       FROM auth.user_cards uc
       JOIN game.cards c ON uc.card_id = c.id
       WHERE uc.user_id = $1
       FOR UPDATE OF uc`,
      [userId]
    );

    let tradedCount = 0;
    let pointsEarned = 0;

    for (const row of rows) {
      const maxPlayset = getMaxPlaysetForCard(row.card_type);
      const qty = Number(row.quantity) || 0;
      if (qty > maxPlayset) {
        const extras = qty - maxPlayset;
        const rate = getCardDustRate(row.card_id, row.rarity);
        tradedCount += extras;
        pointsEarned += extras * rate;

        await client.query(
          `UPDATE auth.user_cards SET quantity = $1 WHERE user_id = $2 AND card_id = $3`,
          [maxPlayset, userId, row.card_id]
        );
      }
    }

    if (tradedCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No extra copies beyond a 4-card playset to trade in!' });
    }

    const updatedUser = await client.query(
      `UPDATE auth.users
       SET reward_points = reward_points + $1
       WHERE id = $2
       RETURNING reward_points`,
      [pointsEarned, userId]
    );

    const ownedQuantities = await getUserOwnedQuantities(client, userId);

    await client.query('COMMIT');
    res.json({
      success: true,
      tradedCount,
      pointsEarned,
      remainingPoints: updatedUser.rows[0].reward_points,
      tradeInSummary: { extraCardsCount: 0, totalPointsValue: 0 },
      ownedQuantities,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;