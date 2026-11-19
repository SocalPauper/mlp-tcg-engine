import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../4_data/db.js';

const router = Router();
const PLACEMENT_REQUIRED = 5;

export function getRankTier(mmr: number, placementMatches: number) {
  if (placementMatches < PLACEMENT_REQUIRED) {
    return {
      tier: 'Unranked',
      badge: '🔮',
      color: '#c4b5fd',
      isPlacement: true,
      placementsCompleted: placementMatches,
      placementsRequired: PLACEMENT_REQUIRED,
    };
  }
  if (mmr >= 1700) return { tier: 'Grand Princess', badge: '👑', color: '#fde047', isPlacement: false };
  if (mmr >= 1550) return { tier: 'Diamond Alicorn', badge: '💎', color: '#38bdf8', isPlacement: false };
  if (mmr >= 1400) return { tier: 'Platinum Pegasus', badge: '🪽', color: '#e2e8f0', isPlacement: false };
  if (mmr >= 1250) return { tier: 'Gold Unicorn', badge: '🦄', color: '#fbbf24', isPlacement: false };
  if (mmr >= 1100) return { tier: 'Silver Filly', badge: '🥈', color: '#cbd5e1', isPlacement: false };
  return { tier: 'Bronze Foal', badge: '🥉', color: '#d97706', isPlacement: false };
}

function extractToken(req: any): string | null {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t && t !== 'null' && t !== 'undefined') return t;
  }
  const rawCookie = req.headers?.cookie;
  if (rawCookie) {
    const parts = rawCookie.split(';').map((c: string) => c.trim());
    for (const part of parts) {
      if (part.startsWith('token=') || part.startsWith('jwt=') || part.startsWith('auth_token=')) {
        const val = decodeURIComponent(part.split('=')[1] || '').trim();
        if (val && val !== 'null' && val !== 'undefined') return val;
      }
    }
  }
  return null;
}

async function resolveSessionUser(req: any) {
  const token = extractToken(req);
  if (!token) return null;

  let decoded: any = null;
  const secrets = [
    process.env.JWT_SECRET,
    'equestria_clash_secret_key',
    'mlp_tcg_secret',
    'supersecretkey',
  ].filter(Boolean) as string[];

  for (const secret of secrets) {
    try {
      decoded = jwt.verify(token, secret);
      if (decoded) break;
    } catch {
      // Try next secret
    }
  }

  if (!decoded) decoded = jwt.decode(token);

  const userId = decoded?.id || decoded?.userId || decoded?.sub;
  const username = decoded?.username;
  if (!userId && !username) return null;

  try {
    if (userId) {
      const { rows } = await pool.query(
        `SELECT id, username, display_name FROM auth.users WHERE id::text = $1::text LIMIT 1;`,
        [String(userId)]
      );
      if (rows[0]) return rows[0];
    }
    if (username) {
      const { rows } = await pool.query(
        `SELECT id, username, display_name FROM auth.users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
        [String(username)]
      );
      if (rows[0]) return rows[0];
    }
  } catch (err) {
    console.error('[RANKED AUTH ERROR]', err);
  }
  return null;
}

async function ensurePlayerRatingRow(userId: string, username: string, displayName: string) {
  await pool.query(
    `INSERT INTO auth.player_ratings (user_id, username, display_name, mmr, peak_mmr, placement_matches, wins, losses, win_streak)
     VALUES ($1, $2, $3, 1200, 1200, 0, 0, 0, 0)
     ON CONFLICT (user_id) DO UPDATE
     SET username = EXCLUDED.username,
         display_name = EXCLUDED.display_name;`,
    [String(userId), username, displayName || username]
  );
  const { rows } = await pool.query(
    `SELECT * FROM auth.player_ratings WHERE user_id = $1 LIMIT 1;`,
    [String(userId)]
  );
  return rows[0];
}

export async function recordRankedMatchResult(winnerId: string, loserId: string) {
  if (!winnerId || !loserId || String(winnerId) === String(loserId)) return null;

  const [wUserRes, lUserRes] = await Promise.all([
    pool.query(`SELECT id, username, display_name FROM auth.users WHERE id::text = $1::text LIMIT 1;`, [String(winnerId)]),
    pool.query(`SELECT id, username, display_name FROM auth.users WHERE id::text = $1::text LIMIT 1;`, [String(loserId)]),
  ]);

  if (!wUserRes.rows[0] || !lUserRes.rows[0]) return null;

  const wUser = wUserRes.rows[0];
  const lUser = lUserRes.rows[0];

  const winnerRow = await ensurePlayerRatingRow(wUser.id, wUser.username, wUser.display_name);
  const loserRow = await ensurePlayerRatingRow(lUser.id, lUser.username, lUser.display_name);

  const wMmr = Number(winnerRow.mmr || 1200);
  const lMmr = Number(loserRow.mmr || 1200);
  const wPlacements = Number(winnerRow.placement_matches || 0);
  const lPlacements = Number(loserRow.placement_matches || 0);

  // Double K-factor (64) during the 5 seeding placement matches, standard K=32 afterward
  const wK = wPlacements < PLACEMENT_REQUIRED ? 64 : 32;
  const lK = lPlacements < PLACEMENT_REQUIRED ? 64 : 32;

  const expectedWinner = 1 / (1 + Math.pow(10, (lMmr - wMmr) / 400));
  const expectedLoser = 1 - expectedWinner;

  const wDelta = Math.max(8, Math.round(wK * (1 - expectedWinner)));
  const lDelta = Math.min(-6, Math.round(lK * (0 - expectedLoser)));

  const nextWMmr = Math.max(600, wMmr + wDelta);
  const nextLMmr = Math.max(600, lMmr + lDelta);
  const nextWPlacements = wPlacements + 1;
  const nextLPlacements = lPlacements + 1;

  await pool.query(
    `UPDATE auth.player_ratings
     SET mmr = $1,
         peak_mmr = GREATEST(peak_mmr, $1),
         placement_matches = $2,
         wins = wins + 1,
         win_streak = win_streak + 1,
         updated_at = NOW()
     WHERE user_id = $3;`,
    [nextWMmr, nextWPlacements, String(wUser.id)]
  );

  await pool.query(
    `UPDATE auth.player_ratings
     SET mmr = $1,
         placement_matches = $2,
         losses = losses + 1,
         win_streak = 0,
         updated_at = NOW()
     WHERE user_id = $3;`,
    [nextLMmr, nextLPlacements, String(lUser.id)]
  );

  const matchId = `rnk-${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO auth.ranked_match_history
      (id, winner_id, winner_name, loser_id, loser_name, winner_mmr_change, loser_mmr_change)
     VALUES ($1, $2, $3, $4, $5, $6, $7);`,
    [
      matchId,
      String(wUser.id),
      wUser.display_name || wUser.username,
      String(lUser.id),
      lUser.display_name || lUser.username,
      wDelta,
      lDelta,
    ]
  );

  return {
    matchId,
    winner: {
      userId: wUser.id,
      mmr: nextWMmr,
      delta: wDelta,
      rank: getRankTier(nextWMmr, nextWPlacements),
    },
    loser: {
      userId: lUser.id,
      mmr: nextLMmr,
      delta: lDelta,
      rank: getRankTier(nextLMmr, nextLPlacements),
    },
  };
}

// GET /api/ranked/me (Current player's placement & rank profile)
router.get('/me', async (req, res) => {
  const user = await resolveSessionUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Sign in to view your ranked profile.' });
  }

  try {
    const row = await ensurePlayerRatingRow(user.id, user.username, user.display_name);
    const rank = getRankTier(Number(row.mmr), Number(row.placement_matches));
    return res.json({
      success: true,
      profile: {
        ...row,
        rank,
      },
    });
  } catch (err) {
    console.error('Error fetching ranked profile:', err);
    return res.status(500).json({ success: false, message: 'Failed to load ranked profile.' });
  }
});

// GET /api/ranked/standings (Public Leaderboard + Recent Ranked Matches)
router.get('/standings', async (_req, res) => {
  try {
    const [leadersRes, recentRes] = await Promise.all([
      pool.query(
        `SELECT user_id, username, display_name, mmr, peak_mmr, placement_matches, wins, losses, win_streak, updated_at
         FROM auth.player_ratings
         WHERE placement_matches >= $1
         ORDER BY mmr DESC, wins DESC
         LIMIT 100;`,
        [PLACEMENT_REQUIRED]
      ),
      pool.query(
        `SELECT id, winner_name, loser_name, winner_mmr_change, loser_mmr_change, played_at
         FROM auth.ranked_match_history
         ORDER BY played_at DESC
         LIMIT 20;`
      ),
    ]);

    const leaderboard = leadersRes.rows.map((r: any, idx: number) => ({
      position: idx + 1,
      ...r,
      rank: getRankTier(Number(r.mmr), Number(r.placement_matches)),
    }));

    return res.json({
      success: true,
      placementRequired: PLACEMENT_REQUIRED,
      leaderboard,
      recentMatches: recentRes.rows,
    });
  } catch (err) {
    console.error('Error fetching standings:', err);
    return res.status(500).json({ success: false, message: 'Failed to load standings.' });
  }
});

// POST /api/ranked/report (Called on ranked match completion)
router.post('/report', async (req, res) => {
  const user = await resolveSessionUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  const { winnerId, loserId } = req.body;
  try {
    const summary = await recordRankedMatchResult(winnerId, loserId);
    if (!summary) {
      return res.status(400).json({ success: false, message: 'Invalid ranked match participants.' });
    }
    return res.json({ success: true, summary });
  } catch (err) {
    console.error('Error reporting ranked match:', err);
    return res.status(500).json({ success: false, message: 'Failed to record ranked result.' });
  }
});

export default router;