import express from 'express';
import { pool } from '../../4_data/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware.js';

const router = express.Router();

const STATS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache to keep DB overhead minimal

interface CachedStatsPayload {
  computedAt: number;
  data: {
    newAccountsToday: number;
    gamesCreated: number;
    gamesPlayedToday: number;
    ponyPointsSpent: number;
    totalWebsiteVisits: number;
    totalRegisteredUsers: number;
    openBugReports: number;
    cachedAt: string;
    refreshIntervalLabel: string;
  };
}

let statsCache: CachedStatsPayload | null = null;
let schemasEnsured = false;

async function ensureAdminTables() {
  if (schemasEnsured) return;
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS game;
    CREATE TABLE IF NOT EXISTS game.global_announcements (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      updated_by VARCHAR(100) DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS game.chat_messages (
      id SERIAL PRIMARY KEY,
      channel VARCHAR(30) NOT NULL DEFAULT 'HUB',
      author_id VARCHAR(100),
      author_name VARCHAR(120) NOT NULL,
      content TEXT NOT NULL,
      is_censored BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS game.site_metrics (
      metric_key VARCHAR(80) PRIMARY KEY,
      metric_value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO game.site_metrics (metric_key, metric_value)
    VALUES ('total_visits', 0)
    ON CONFLICT (metric_key) DO NOTHING;
  `);
  schemasEnsured = true;
}

const requireAdmin = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized: No user ID in token' });

  try {
    const { rows } = await pool.query(
      'SELECT id, username, is_admin FROM auth.users WHERE id = $1',
      [userId]
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: 'Forbidden: User record not found' });
    }
    const userRow = rows[0];
    if (!userRow.is_admin && userRow.username !== 'BigMeatyPawz') {
      return res.status(403).json({ error: 'Forbidden: Admin privileges required' });
    }
    next();
  } catch (err: any) {
    console.error('[ADMIN AUTH ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
};

// Public lightweight visit incrementer
router.post('/visit', async (_req, res) => {
  try {
    await ensureAdminTables();
    const { rows } = await pool.query(
      `UPDATE game.site_metrics
       SET metric_value = metric_value + 1, updated_at = NOW()
       WHERE metric_key = 'total_visits'
       RETURNING metric_value`
    );
    res.json({ success: true, totalWebsiteVisits: Number(rows[0]?.metric_value || 0) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Public/non-admin chat feed reader so MainHub & Fan Page users see censored/deleted updates
router.get('/chat/feed', async (req, res) => {
  try {
    await ensureAdminTables();
    const channelParam = String(req.query.channel || 'HUB').toUpperCase();
    const channel = channelParam === 'FAN_PAGE' ? 'FAN_PAGE' : 'HUB';

    const { rows } = await pool.query(
      `SELECT id,
              channel,
              author_name AS "authorName",
              content,
              is_censored AS "isCensored",
              created_at AS "createdAt"
       FROM game.chat_messages
       WHERE UPPER(channel) = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [channel]
    );

    return res.json({ success: true, messages: rows });
  } catch (err: any) {
    console.error('[CHAT FEED GET ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Post a chat message to HUB or FAN_PAGE (any non-safe-mode authenticated user)
router.post('/chat-messages', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    await ensureAdminTables();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { rows: uRows } = await pool.query(
      'SELECT id, username, display_name, is_safe_mode FROM auth.users WHERE id = $1',
      [userId]
    );
    if (uRows.length === 0 || uRows[0].is_safe_mode) {
      return res.status(403).json({ success: false, error: 'Account cannot post in chat' });
    }

    const channel =
      String(req.body?.channel || 'HUB').toUpperCase() === 'FAN_PAGE' ? 'FAN_PAGE' : 'HUB';
    const content = String(req.body?.content || '').trim().slice(0, 1000);
    if (!content) return res.status(400).json({ success: false, error: 'Message required' });

    const authorName = String(
      req.body?.authorName || uRows[0].display_name || uRows[0].username || 'Duelist'
    ).slice(0, 120);

    const { rows } = await pool.query(
      `INSERT INTO game.chat_messages (channel, author_id, author_name, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id,
                 channel,
                 author_id AS "authorId",
                 author_name AS "authorName",
                 content,
                 is_censored AS "isCensored",
                 created_at AS "createdAt"`,
      [channel, String(userId), authorName, content]
    );

    return res.json({ success: true, message: rows[0] });
  } catch (err: any) {
    console.error('[CHAT POST ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 0. Website Statistics (cached for 1 hour unless ?refresh=1 is passed)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const now = Date.now();

  if (!forceRefresh && statsCache && now - statsCache.computedAt < STATS_CACHE_TTL_MS) {
    return res.json({ success: true, stats: statsCache.data, fromCache: true });
  }

  try {
    await ensureAdminTables();

    const usersTotalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM auth.users`);
    const usersTodayRes = await pool.query(
      `SELECT COUNT(*)::int AS today FROM auth.users WHERE created_at >= CURRENT_DATE`
    );

    let gamesCreated = 0;
    let gamesPlayedToday = 0;
    try {
      const [gAll, gToday] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM game.match_logs`),
        pool.query(`SELECT COUNT(*)::int AS today FROM game.match_logs WHERE created_at >= CURRENT_DATE`),
      ]);
      gamesCreated = Number(gAll.rows[0]?.total || 0);
      gamesPlayedToday = Number(gToday.rows[0]?.today || 0);
    } catch {
      gamesCreated = 0;
      gamesPlayedToday = 0;
    }

    let ponyPointsSpent = 0;
    try {
      const ptsRes = await pool.query(
        `SELECT COALESCE(SUM(ABS(delta)), 0)::bigint AS spent
         FROM auth.point_transactions
         WHERE delta < 0`
      );
      ponyPointsSpent = Number(ptsRes.rows[0]?.spent || 0);
    } catch {
      ponyPointsSpent = 0;
    }

    let openBugReports = 0;
    try {
      const bugsRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM game.bug_reports WHERE status <> 'RESOLVED'`
      );
      openBugReports = Number(bugsRes.rows[0]?.cnt || 0);
    } catch {
      openBugReports = 0;
    }

    const visitsRes = await pool.query(
      `SELECT metric_value FROM game.site_metrics WHERE metric_key = 'total_visits'`
    );
    const totalWebsiteVisits = Number(visitsRes.rows[0]?.metric_value || 0);

    const payload = {
      newAccountsToday: Number(usersTodayRes.rows[0]?.today || 0),
      gamesCreated,
      gamesPlayedToday,
      ponyPointsSpent,
      totalWebsiteVisits,
      totalRegisteredUsers: Number(usersTotalRes.rows[0]?.total || 0),
      openBugReports,
      cachedAt: new Date(now).toISOString(),
      refreshIntervalLabel: 'Cached hourly (click Refresh Now for immediate pull)',
    };

    statsCache = { computedAt: now, data: payload };
    return res.json({ success: true, stats: payload, fromCache: false });
  } catch (err: any) {
    console.error('[ADMIN STATS ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Global Announcements: List, Create, Edit, Delete
router.get('/announcements', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    await ensureAdminTables();
    let { rows } = await pool.query(
      `SELECT id,
              message,
              updated_by AS "updatedBy",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM game.global_announcements
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 50`
    );

    if (rows.length === 0) {
      const legacyRes = await pool.query(
        `SELECT setting_value, updated_by, updated_at
         FROM auth.site_settings
         WHERE setting_key = 'site_announcement' AND COALESCE(setting_value, '') <> ''
         LIMIT 1`
      );
      if (legacyRes.rows.length > 0) {
        const legacy = legacyRes.rows[0];
        const inserted = await pool.query(
          `INSERT INTO game.global_announcements (message, updated_by, created_at, updated_at)
           VALUES ($1, $2, COALESCE($3, NOW()), COALESCE($3, NOW()))
           RETURNING id,
                     message,
                     updated_by AS "updatedBy",
                     created_at AS "createdAt",
                     updated_at AS "updatedAt"`,
          [legacy.setting_value, legacy.updated_by || 'admin', legacy.updated_at]
        );
        rows = inserted.rows;
      }
    }

    return res.json({ success: true, announcements: rows });
  } catch (err: any) {
    console.error('[ADMIN ANNOUNCEMENTS GET ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/announcements', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    await ensureAdminTables();
    const message = String(req.body?.message || '').trim();
    const updatedBy = String(req.body?.updatedBy || req.user?.username || 'admin').slice(0, 80);
    if (!message) {
      return res.status(400).json({ success: false, error: 'Announcement message is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO game.global_announcements (message, updated_by, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id,
                 message,
                 updated_by AS "updatedBy",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [message, updatedBy]
    );

    await pool.query(
      `INSERT INTO auth.site_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES ('site_announcement', $1, $2, NOW())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()`,
      [message, updatedBy]
    ).catch(() => {});

    return res.json({ success: true, announcement: rows[0] });
  } catch (err: any) {
    console.error('[ADMIN ANNOUNCEMENTS POST ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/announcements/:id', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    await ensureAdminTables();
    const id = Number(req.params.id);
    const message = String(req.body?.message || '').trim();
    const updatedBy = String(req.body?.updatedBy || req.user?.username || 'admin').slice(0, 80);

    if (!Number.isInteger(id) || !message) {
      return res.status(400).json({ success: false, error: 'Valid announcement ID and message required' });
    }

    const { rows } = await pool.query(
      `UPDATE game.global_announcements
       SET message = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id,
                 message,
                 updated_by AS "updatedBy",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [message, updatedBy, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Announcement not found' });
    }

    await pool.query(
      `INSERT INTO auth.site_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES ('site_announcement', $1, $2, NOW())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()`,
      [message, updatedBy]
    ).catch(() => {});

    return res.json({ success: true, announcement: rows[0] });
  } catch (err: any) {
    console.error('[ADMIN ANNOUNCEMENTS PATCH ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/announcements/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureAdminTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, error: 'Invalid announcement ID' });
    }

    await pool.query(`DELETE FROM game.global_announcements WHERE id = $1`, [id]);

    const latestRes = await pool.query(
      `SELECT message FROM game.global_announcements ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1`
    );
    const nextBanner = latestRes.rows[0]?.message || '';
    await pool.query(
      `INSERT INTO auth.site_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES ('site_announcement', $1, 'admin', NOW())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
      [nextBanner]
    ).catch(() => {});

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[ADMIN ANNOUNCEMENTS DELETE ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Chat Moderation (Main Hub & Fan Page)
router.get('/chat-messages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureAdminTables();
    const channel = String(req.query.channel || 'ALL').toUpperCase();

    let query = `
      SELECT id,
             channel,
             author_id AS "authorId",
             author_name AS "authorName",
             content,
             is_censored AS "isCensored",
             created_at AS "createdAt"
      FROM game.chat_messages
    `;
    const params: any[] = [];
    if (channel === 'HUB' || channel === 'FAN_PAGE') {
      query += ` WHERE UPPER(channel) = $1`;
      params.push(channel);
    }
    query += ` ORDER BY created_at DESC LIMIT 100`;

    const { rows } = await pool.query(query, params);
    return res.json({ success: true, messages: rows });
  } catch (err: any) {
    console.error('[ADMIN CHAT GET ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/chat-messages/:id/censor', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureAdminTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, error: 'Invalid message ID' });
    }

    const replacement = String(req.body?.replacement || '[Message censored by moderator]').trim();

    const { rows } = await pool.query(
      `UPDATE game.chat_messages
       SET content = $1, is_censored = TRUE
       WHERE id = $2
       RETURNING id,
                 channel,
                 author_id AS "authorId",
                 author_name AS "authorName",
                 content,
                 is_censored AS "isCensored",
                 created_at AS "createdAt"`,
      [replacement, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Chat message not found' });
    }

    return res.json({ success: true, message: rows[0] });
  } catch (err: any) {
    console.error('[ADMIN CHAT CENSOR ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/chat-messages/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureAdminTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, error: 'Invalid message ID' });
    }

    await pool.query(`DELETE FROM game.chat_messages WHERE id = $1`, [id]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[ADMIN CHAT DELETE ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 1. Search or list users from auth.users
router.get('/users', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const search = String(req.query.search || '').trim();
  try {
    let query = `
      SELECT id, username, COALESCE(display_name, username) as display_name, email, COALESCE(reward_points, 0) as reward_points, created_at 
      FROM auth.users
    `;
    let params: any[] = [];

    if (search) {
      query += ` WHERE username ILIKE $1 OR COALESCE(display_name, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1`;
      params.push(`%${search}%`);
    }
    query += ` ORDER BY created_at DESC LIMIT 50`;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, users: rows });
  } catch (err: any) {
    console.error('[ADMIN USERS GET ERROR]', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Award Pony Points to a user
router.post('/users/award-points', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const { userId, points } = req.body;
  const ptsToAdd = parseInt(points, 10);

  if (!userId || isNaN(ptsToAdd)) {
    return res.status(400).json({ error: 'Invalid user ID or point amount' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE auth.users SET reward_points = COALESCE(reward_points, 0) + $1 WHERE id = $2 RETURNING id, username, reward_points`,
      [ptsToAdd, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Gift a specific card to a user
router.post('/users/gift-card', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const { userId, cardId } = req.body;
  if (!userId || !cardId) {
    return res.status(400).json({ error: 'Missing user ID or card ID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cardCheck = await client.query('SELECT id, name FROM game.cards WHERE id = $1', [cardId]);
    if (cardCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Card not found in database' });
    }

    await client.query(
      `INSERT INTO auth.user_cards (user_id, card_id, quantity, user_alerted)
       VALUES ($1, $2, 1, FALSE)
       ON CONFLICT (user_id, card_id)
       DO UPDATE SET quantity = auth.user_cards.quantity + 1, user_alerted = FALSE`,
      [userId, cardId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: `Successfully gifted ${cardCheck.rows[0].name} (${cardId})!` });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 4. Moderate user status
router.post('/users/moderate', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const { userId, action } = req.body;
  if (!userId || !action) {
    return res.status(400).json({ error: 'Missing user ID or action' });
  }

  try {
    let updateQuery = '';
    const params = [userId];

    switch (action.toUpperCase()) {
      case 'SILENCE':
        updateQuery = `UPDATE auth.users SET is_safe_mode = TRUE WHERE id = $1 RETURNING id, username`;
        break;
      case 'SUSPEND':
        updateQuery = `UPDATE auth.users SET is_safe_mode = TRUE, is_verified = FALSE WHERE id = $1 RETURNING id, username`;
        break;
      case 'BAN':
        updateQuery = `UPDATE auth.users SET is_safe_mode = TRUE, is_verified = FALSE WHERE id = $1 RETURNING id, username`;
        break;
      case 'ACTIVE':
        updateQuery = `UPDATE auth.users SET is_safe_mode = FALSE, is_verified = TRUE WHERE id = $1 RETURNING id, username`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid moderation action' });
    }

    const { rows } = await pool.query(updateQuery, params);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, message: `User ${rows[0].username} status updated to ${action.toUpperCase()}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;