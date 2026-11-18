import express from 'express';
import { pool } from '../../4_data/db.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware.js';

const router = express.Router();

// Middleware to ensure requester is admin
const requireAdmin = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { rows } = await pool.query('SELECT is_admin, role FROM auth.users WHERE id = $1', [userId]);
    if (rows.length === 0 || (!rows[0].is_admin && rows[0].role !== 'admin')) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 1. Search or list users from auth.users
router.get('/users', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const search = String(req.query.search || '').trim();
  try {
    let query = `SELECT id, username, display_name, email, reward_points, is_admin, is_verified, is_safe_mode, created_at FROM auth.users`;
    let params: any[] = [];

    if (search) {
      query += ` WHERE username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1`;
      params.push(`%${search}%`);
    }
    query += ` ORDER BY created_at DESC LIMIT 50`;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, users: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

    // Verify card exists
    const cardCheck = await client.query('SELECT id, name FROM game.cards WHERE id = $1', [cardId]);
    if (cardCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Card not found in database' });
    }

    // Add or increment in user_cards
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

// 4. Moderate user status (Silence, Suspend, Ban, Active)
router.post('/users/moderate', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const { userId, action } = req.body; // action: 'SILENCE' | 'SUSPEND' | 'BAN' | 'ACTIVE'
  if (!userId || !action) {
    return res.status(400).json({ error: 'Missing user ID or action' });
  }

  try {
    let updateQuery = '';
    let params = [userId];

    switch (action.toUpperCase()) {
      case 'SILENCE':
        // Enable safe mode / restriction flag
        updateQuery = `UPDATE auth.users SET is_safe_mode = TRUE WHERE id = $1 RETURNING id, username`;
        break;
      case 'SUSPEND':
        updateQuery = `UPDATE auth.users SET is_verified = FALSE, is_safe_mode = TRUE WHERE id = $1 RETURNING id, username`;
        break;
      case 'BAN':
        // Clear tokens or set role/flag if applicable, or delete/deactivate
        updateQuery = `UPDATE auth.users SET is_verified = FALSE, is_safe_mode = TRUE, email = CONCAT('banned_', email) WHERE id = $1 RETURNING id, username`;
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