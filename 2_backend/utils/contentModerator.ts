import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../4_data/db.js';
import { moderateForumContent } from '../utils/contentModerator.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'mlp-tcg-super-secret-key-2026';

async function resolveSessionUser(req: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded?.id || decoded?.userId;
    if (!userId) return null;

    const { rows } = await pool.query(
      `SELECT id, username, display_name, is_safe_mode, is_admin
       FROM auth.users
       WHERE id::text = $1::text
       LIMIT 1;`,
      [String(userId)]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function requireRegisteredNonSafeUser(req: any, res: any, next: any) {
  const user = await resolveSessionUser(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'You must be signed in to a registered account to post or vote.',
    });
  }
  if (user.is_safe_mode) {
    return res.status(403).json({
      success: false,
      message: 'Safe Mode accounts cannot create threads, reply, or vote. Verify your email to unlock full access.',
    });
  }
  req.forumUser = user;
  return next();
}

async function requireAdmin(req: any, res: any, next: any) {
  const user = await resolveSessionUser(req);
  if (!user || !user.is_admin) {
    return res.status(403).json({ success: false, message: 'Administrator privileges required.' });
  }
  req.forumUser = user;
  return next();
}

// GET /api/forum/posts
router.get('/posts', async (req, res) => {
  const category = String(req.query.category || 'ALL');
  const sort = String(req.query.sort || 'new');
  const viewer = await resolveSessionUser(req);
  const isAdmin = Boolean(viewer?.is_admin);
  const viewerId = viewer?.id ? String(viewer.id) : null;

  try {
    const params: any[] = [];
    let whereClause = '';
    if (category !== 'ALL') {
      params.push(category);
      whereClause = 'WHERE p.category = $1';
    }

    const orderBy =
      sort === 'top'
        ? 'ORDER BY p.is_pinned DESC, (p.upvotes - p.downvotes) DESC, p.created_at DESC'
        : 'ORDER BY p.is_pinned DESC, p.created_at DESC';

    const query = `
      SELECT p.*,
             (SELECT COUNT(*)::int FROM auth.forum_comments c WHERE c.post_id = p.id) AS comment_count
      FROM auth.forum_posts p
      ${whereClause}
      ${orderBy}
      LIMIT 100;
    `;
    const result = await pool.query(query, params);

    const posts = result.rows.map((p: any) => {
      const canSeeImage =
        p.image_status === 'APPROVED' ||
        isAdmin ||
        (viewerId && String(p.author_id) === viewerId);
      return {
        ...p,
        visible_image_url: canSeeImage ? p.image_url : null,
      };
    });

    return res.json(posts);
  } catch (err) {
    console.error('Error fetching forum posts:', err);
    return res.status(500).json({ success: false, message: 'Failed to load forum threads.' });
  }
});

// GET /api/forum/posts/:id
router.get('/posts/:id', async (req, res) => {
  const { id } = req.params;
  const viewer = await resolveSessionUser(req);
  const isAdmin = Boolean(viewer?.is_admin);
  const viewerId = viewer?.id ? String(viewer.id) : null;

  try {
    const postRes = await pool.query('SELECT * FROM auth.forum_posts WHERE id = $1;', [id]);
    if (postRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thread not found.' });
    }

    const post = postRes.rows[0];
    const canSeeImage =
      post.image_status === 'APPROVED' ||
      isAdmin ||
      (viewerId && String(post.author_id) === viewerId);

    const commentsRes = await pool.query(
      'SELECT * FROM auth.forum_comments WHERE post_id = $1 ORDER BY created_at ASC;',
      [id]
    );

    return res.json({
      post: {
        ...post,
        visible_image_url: canSeeImage ? post.image_url : null,
      },
      comments: commentsRes.rows,
    });
  } catch (err) {
    console.error('Error fetching thread:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch thread.' });
  }
});

// POST /api/forum/posts
router.post('/posts', requireRegisteredNonSafeUser, async (req: any, res) => {
  const { title, body, category, image_url } = req.body;
  const user = req.forumUser;

  const titleCheck = moderateForumContent(title);
  if (!titleCheck.allowed) {
    return res.status(400).json({ success: false, message: titleCheck.reason });
  }

  const bodyCheck = moderateForumContent(body);
  if (!bodyCheck.allowed) {
    return res.status(400).json({ success: false, message: bodyCheck.reason });
  }

  let cleanImageUrl: string | null = null;
  let imageStatus = 'NONE';

  if (image_url && String(image_url).trim()) {
    const rawImg = String(image_url).trim();
    const linkCheck = moderateForumContent(rawImg);
    if (!linkCheck.allowed) {
      return res.status(400).json({ success: false, message: linkCheck.reason });
    }
    cleanImageUrl = rawImg;
    imageStatus = user.is_admin ? 'APPROVED' : 'PENDING';
  }

  const postId = `post-${crypto.randomUUID()}`;
  const authorName = user.display_name || user.username || 'PonyFan';

  try {
    const query = `
      INSERT INTO auth.forum_posts
        (id, author_id, author_name, category, title, body, image_url, image_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const result = await pool.query(query, [
      postId,
      String(user.id),
      authorName,
      category || 'General',
      String(title).trim(),
      String(body).trim(),
      cleanImageUrl,
      imageStatus,
    ]);

    return res.json({
      success: true,
      post: {
        ...result.rows[0],
        visible_image_url: result.rows[0].image_url,
      },
      pendingImageApproval: imageStatus === 'PENDING',
    });
  } catch (err) {
    console.error('Error creating forum post:', err);
    return res.status(500).json({ success: false, message: 'Failed to create post.' });
  }
});

// POST /api/forum/posts/:id/comments
router.post('/posts/:id/comments', requireRegisteredNonSafeUser, async (req: any, res) => {
  const { id } = req.params;
  const { body, parent_id } = req.body;
  const user = req.forumUser;

  const modCheck = moderateForumContent(body);
  if (!modCheck.allowed) {
    return res.status(400).json({ success: false, message: modCheck.reason });
  }

  const commentId = `cmt-${crypto.randomUUID()}`;
  const authorName = user.display_name || user.username || 'PonyFan';

  try {
    const result = await pool.query(
      `INSERT INTO auth.forum_comments (id, post_id, parent_id, author_id, author_name, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *;`,
      [commentId, id, parent_id || null, String(user.id), authorName, String(body).trim()]
    );
    return res.json({ success: true, comment: result.rows[0] });
  } catch (err) {
    console.error('Error posting comment:', err);
    return res.status(500).json({ success: false, message: 'Failed to post reply.' });
  }
});

// POST /api/forum/vote
router.post('/vote', requireRegisteredNonSafeUser, async (req: any, res) => {
  const { targetId, targetType, value } = req.body;
  const userId = String(req.forumUser.id);
  const voteVal = value === -1 ? -1 : 1;
  const table = targetType === 'comment' ? 'auth.forum_comments' : 'auth.forum_posts';

  try {
    const existing = await pool.query(
      'SELECT vote_value FROM auth.forum_votes WHERE user_id = $1 AND target_id = $2;',
      [userId, targetId]
    );

    let upDelta = 0;
    let downDelta = 0;

    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO auth.forum_votes (user_id, target_id, vote_value) VALUES ($1, $2, $3);',
        [userId, targetId, voteVal]
      );
      if (voteVal === 1) upDelta = 1;
      else downDelta = 1;
    } else {
      const prev = existing.rows[0].vote_value;
      if (prev === voteVal) {
        await pool.query(
          'DELETE FROM auth.forum_votes WHERE user_id = $1 AND target_id = $2;',
          [userId, targetId]
        );
        if (prev === 1) upDelta = -1;
        else downDelta = -1;
      } else {
        await pool.query(
          'UPDATE auth.forum_votes SET vote_value = $3 WHERE user_id = $1 AND target_id = $2;',
          [userId, targetId, voteVal]
        );
        if (voteVal === 1) {
          upDelta = 1;
          downDelta = -1;
        } else {
          upDelta = -1;
          downDelta = 1;
        }
      }
    }

    const updated = await pool.query(
      `UPDATE ${table}
       SET upvotes = GREATEST(0, upvotes + $1),
           downvotes = GREATEST(0, downvotes + $2)
       WHERE id = $3
       RETURNING upvotes, downvotes;`,
      [upDelta, downDelta, targetId]
    );

    return res.json({ success: true, ...updated.rows[0] });
  } catch (err) {
    console.error('Vote error:', err);
    return res.status(500).json({ success: false, message: 'Failed to register vote.' });
  }
});

// ADMIN: Pending Images Queue
router.get('/admin/pending-images', requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, author_name, category, title, image_url, created_at
       FROM auth.forum_posts
       WHERE image_status = 'PENDING'
       ORDER BY created_at ASC;`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending images:', err);
    return res.status(500).json({ success: false, message: 'Failed to load moderation queue.' });
  }
});

// ADMIN: Approve or Reject Uploaded Image
router.post('/admin/moderate-image/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  try {
    await pool.query(
      'UPDATE auth.forum_posts SET image_status = $1 WHERE id = $2;',
      [status, id]
    );
    return res.json({ success: true, status });
  } catch (err) {
    console.error('Error moderating image:', err);
    return res.status(500).json({ success: false, message: 'Failed to update image status.' });
  }
});

export default router;