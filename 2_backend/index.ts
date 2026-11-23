import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, pool } from '../4_data/db.js';
import {
  authenticateToken,
  optionalAuthenticateToken,
  AuthenticatedRequest,
} from './middleware/authMiddleware.js';

import authRouter from './routes/auth.js';
import cardsRouter from './routes/cards.js';
import decksRouter from './routes/decks.js';
import shopsRouter from './routes/shops.js';
import mediaRouter from './routes/media.js';
import adminRouter from './routes/admin.js';
import forumRouter from './routes/forum.js';
import rankedRouter from './routes/ranked.js';
import { GameManager } from './websocket/gameManager.js';

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = [
  'https://equestria-clash.pages.dev',
  'https://mlp-tcg-engine.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.pages.dev')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));

// Lightweight IP rate limiter to prevent brute-force logins, shop spam, or bug-report floods
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function createRateLimiter(maxRequests: number, windowMs: number, prefix: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${prefix}:${req.ip || 'unknown'}`;
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || now > entry.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      return res
        .status(429)
        .json({ error: 'Too many requests. Please slow down and try again shortly.' });
    }
    entry.count += 1;
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets.entries()) {
    if (now > v.resetAt) rateBuckets.delete(k);
  }
}, 60_000);

function buildDiagnosticClues(params: {
  category?: string;
  roomCode?: string | null;
  seat?: string | null;
  summary: string;
  boardSnapshot?: any;
  clientMeta?: any;
}) {
  const snap = params.boardSnapshot || null;
  const actionLog = Array.isArray(snap?.actionLog) ? snap.actionLog : [];
  const debugTrace = Array.isArray(snap?.debugTrace) ? snap.debugTrace : [];

  const recentActions = actionLog.slice(-12).map((a: any) => ({
    turn: a.turn,
    actor: a.actor,
    category: a.category,
    sourceCard: a.sourceCard || null,
    text: a.text,
  }));

  const recentDebugTraces = debugTrace.slice(-15).map((d: any) => ({
    turn: d.turn,
    phase: d.phase,
    actor: d.actor,
    card: `${d.cardName} (${d.cardId})`,
    cardText: d.cardText,
    trigger: d.triggerType,
    parsedKind: d.parsedKind,
    status: d.status,
    targetsOrChoice: d.targetsOrChoice,
    notes: d.notes,
  }));

  const flaggedAnomalies = debugTrace
    .filter((d: any) => ['SKIPPED', 'AWAITING_INPUT', 'QUEUED_STACK'].includes(d.status))
    .slice(-10)
    .map((d: any) => `[T${d.turn} ${d.status}] ${d.cardName} (${d.cardId}): ${d.notes}`);

  const summarizePlayer = (p: any) => {
    if (!p) return null;
    const adv = p.adventureArea || {};
    return {
      displayName: p.displayName,
      mane: p.leader ? `${p.leader.name} (${p.leader.id})` : 'None',
      storyProgress: `${p.storyProgress ?? 0}/4`,
      scenesTotal: Array.isArray(p.sceneArea) ? p.sceneArea.length : 0,
      scenesReady: Array.isArray(p.sceneArea)
        ? p.sceneArea.filter((s: any) => !s.isExhausted).length
        : 0,
      handCount: Array.isArray(p.hand) ? p.hand.length : p.handCount ?? 0,
      retirementCount: Array.isArray(p.retirement) ? p.retirement.length : 0,
      lanes: {
        left: adv.left?.character
          ? `${adv.left.character.name} (${adv.left.character.id})${
              adv.left.items?.length ? ` [Item: ${adv.left.items[0].name}]` : ''
            }`
          : 'Empty',
        center: adv.center?.character
          ? `${adv.center.character.name} (${adv.center.character.id})${
              adv.center.items?.length ? ` [Item: ${adv.center.items[0].name}]` : ''
            }`
          : 'Empty',
        right: adv.right?.character
          ? `${adv.right.character.name} (${adv.right.character.id})${
              adv.right.items?.length ? ` [Item: ${adv.right.items[0].name}]` : ''
            }`
          : 'Empty',
      },
    };
  };

  return {
    capturedAt: new Date().toISOString(),
    matchContext: snap
      ? {
          roomId: snap.roomId || params.roomCode || null,
          phase: snap.phase,
          turnNumber: snap.turnNumber,
          turnPlayerId: snap.turnPlayerId,
          reporterSeat: params.seat || null,
          pendingTarget: snap.pendingTarget
            ? {
                sourceCard: snap.pendingTarget.sourceCard?.name,
                effectAction: snap.pendingTarget.effectAction,
                validTargets: snap.pendingTarget.validTargets,
              }
            : null,
          pendingHandChoice: snap.pendingHandChoice
            ? {
                sourceCard: snap.pendingHandChoice.sourceCard?.name,
                choiceType: snap.pendingHandChoice.choiceType,
                count: snap.pendingHandChoice.count,
              }
            : null,
          players: {
            '0': summarizePlayer(snap.players?.['0']),
            '1': summarizePlayer(snap.players?.['1']),
          },
        }
      : null,
    flaggedAnomalies,
    recentActions,
    recentDebugTraces,
    clientEnvironment: params.clientMeta || null,
  };
}

async function ensureBugReportsSchema() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS game;
    CREATE TABLE IF NOT EXISTS game.bug_reports (
      id SERIAL PRIMARY KEY,
      reporter_id VARCHAR(100),
      reporter_name VARCHAR(120) NOT NULL,
      category VARCHAR(50) DEFAULT 'IN_MATCH',
      room_code VARCHAR(50),
      seat VARCHAR(20),
      summary TEXT NOT NULL,
      board_snapshot JSONB,
      diagnostic_clues JSONB,
      priority VARCHAR(20) DEFAULT 'MEDIUM',
      admin_notes JSONB DEFAULT '[]'::jsonb,
      status VARCHAR(30) DEFAULT 'OPEN',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE game.bug_reports ADD COLUMN IF NOT EXISTS diagnostic_clues JSONB;
    ALTER TABLE game.bug_reports ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIUM';
    ALTER TABLE game.bug_reports ADD COLUMN IF NOT EXISTS admin_notes JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE game.bug_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `);
}

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await initDatabase();

    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS game;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        age INT NOT NULL,
        reward_points INT DEFAULT 500,
        is_safe_mode BOOLEAN DEFAULT TRUE,
        is_verified_adult BOOLEAN DEFAULT FALSE,
        is_admin BOOLEAN DEFAULT FALSE,
        is_verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.decks (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        author VARCHAR(255),
        author_id UUID,
        is_public BOOLEAN DEFAULT false,
        mane_character JSONB,
        cards JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.user_cards (
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        card_id VARCHAR(50) REFERENCES game.cards(id) ON DELETE CASCADE,
        quantity INT DEFAULT 1,
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_alerted BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (user_id, card_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS game.weekly_shop_deals (
        id SERIAL PRIMARY KEY,
        card_id VARCHAR(50) REFERENCES game.cards(id) ON DELETE CASCADE,
        price INTEGER NOT NULL,
        week_identifier VARCHAR(20) NOT NULL,
        slot_index INTEGER NOT NULL,
        UNIQUE(week_identifier, slot_index)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.site_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_by VARCHAR(100),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.uploaded_media (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        target_key VARCHAR(100),
        title VARCHAR(255),
        file_name VARCHAR(255) NOT NULL,
        public_url TEXT NOT NULL,
        uploaded_by VARCHAR(100),
        is_approved BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE auth.uploaded_media ADD COLUMN IF NOT EXISTS title VARCHAR(255);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.forum_posts (
        id VARCHAR(255) PRIMARY KEY,
        author_id VARCHAR(255),
        author_name VARCHAR(255) NOT NULL,
        category VARCHAR(64) DEFAULT 'General',
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        image_status VARCHAR(32) DEFAULT 'NONE',
        upvotes INT DEFAULT 1,
        downvotes INT DEFAULT 0,
        is_pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth.forum_comments (
        id VARCHAR(255) PRIMARY KEY,
        post_id VARCHAR(255) REFERENCES auth.forum_posts(id) ON DELETE CASCADE,
        parent_id VARCHAR(255) NULL,
        author_id VARCHAR(255),
        author_name VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        upvotes INT DEFAULT 1,
        downvotes INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth.forum_votes (
        user_id VARCHAR(255) NOT NULL,
        target_id VARCHAR(255) NOT NULL,
        vote_value INT NOT NULL,
        PRIMARY KEY (user_id, target_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.player_ratings (
        user_id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        mmr INT DEFAULT 1200,
        peak_mmr INT DEFAULT 1200,
        placement_matches INT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        win_streak INT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth.ranked_match_history (
        id VARCHAR(255) PRIMARY KEY,
        winner_id VARCHAR(255) NOT NULL,
        winner_name VARCHAR(100) NOT NULL,
        loser_id VARCHAR(255) NOT NULL,
        loser_name VARCHAR(100) NOT NULL,
        winner_mmr_change INT NOT NULL,
        loser_mmr_change INT NOT NULL,
        played_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await ensureBugReportsSchema();

    console.log('[DATABASE] Initialization and schema hardening complete.');
  } catch (err: any) {
    console.error('[DATABASE INIT ERROR]', err.message);
  }

  // Mount Routes with Rate Limiters on sensitive endpoints
  app.use('/api/auth', createRateLimiter(25, 60_000, 'auth'), authRouter);
  app.use('/api/users', createRateLimiter(25, 60_000, 'users'), authRouter);
  app.use('/api/shop', createRateLimiter(40, 60_000, 'shop'), shopsRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/forum', forumRouter);
  app.use('/api/ranked', rankedRouter);
  app.use('/api', cardsRouter);
  app.use('/api', decksRouter);

  // Public / In-Match Bug Report Submission Endpoint (Auto-attaches diagnostic clues)
  app.post(
    '/api/bug-reports',
    createRateLimiter(20, 60_000, 'bugs'),
    optionalAuthenticateToken,
    async (req: AuthenticatedRequest, res) => {
      const { category, roomCode, seat, summary, boardSnapshot, reporterName, clientMeta } =
        req.body || {};
      const cleanSummary = String(summary || '').trim().slice(0, 2000);
      if (!cleanSummary) {
        return res.status(400).json({ error: 'Please describe the issue before submitting.' });
      }

      const finalReporterId = req.user?.id || null;
      const finalReporterName = String(
        req.user?.username || reporterName || 'Alpha Tester'
      ).slice(0, 100);

      const clues = buildDiagnosticClues({
        category,
        roomCode,
        seat,
        summary: cleanSummary,
        boardSnapshot,
        clientMeta,
      });

      try {
        await ensureBugReportsSchema();
        const { rows } = await pool.query(
          `INSERT INTO game.bug_reports
             (reporter_id, reporter_name, category, room_code, seat, summary, board_snapshot, diagnostic_clues, priority, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'MEDIUM', 'OPEN')
           RETURNING id, created_at`,
          [
            finalReporterId,
            finalReporterName,
            String(category || 'GENERAL').slice(0, 40),
            roomCode ? String(roomCode).slice(0, 40) : null,
            seat ? String(seat).slice(0, 20) : null,
            cleanSummary,
            boardSnapshot ? JSON.stringify(boardSnapshot) : null,
            JSON.stringify(clues),
          ]
        );
        res.status(201).json({ success: true, reportId: rows[0].id });
      } catch (err: any) {
        console.error('[BUG REPORT SAVE ERROR]', err.message);
        res.status(500).json({ error: `Database error saving report: ${err.message}` });
      }
    }
  );

  // Admin: List All Bug Reports
  app.get('/api/admin/bug-reports', authenticateToken, async (req: AuthenticatedRequest, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
    try {
      await ensureBugReportsSchema();
      const { rows } = await pool.query(
        `SELECT id, reporter_id, reporter_name, category, room_code, seat, summary,
                board_snapshot, diagnostic_clues, priority, admin_notes, status, created_at, updated_at
         FROM game.bug_reports
         ORDER BY
           CASE status WHEN 'OPEN' THEN 1 WHEN 'IN_PROGRESS' THEN 2 ELSE 3 END,
           CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
           created_at DESC`
      );
      res.json({ success: true, reports: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Manually Create a Bug / Tracking Item
  app.post('/api/admin/bug-reports', authenticateToken, async (req: AuthenticatedRequest, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
    const { category, priority, roomCode, summary, initialNote } = req.body || {};
    const cleanSummary = String(summary || '').trim().slice(0, 2000);
    if (!cleanSummary) {
      return res.status(400).json({ error: 'Bug summary is required.' });
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const cleanPriority = validPriorities.includes(String(priority || '').toUpperCase())
      ? String(priority).toUpperCase()
      : 'MEDIUM';

    const initialNotes =
      initialNote && String(initialNote).trim()
        ? [
            {
              id: `note-${Date.now()}`,
              author: req.user.username || 'Admin',
              text: String(initialNote).trim().slice(0, 1500),
              createdAt: new Date().toISOString(),
            },
          ]
        : [];

    try {
      await ensureBugReportsSchema();
      const { rows } = await pool.query(
        `INSERT INTO game.bug_reports
           (reporter_id, reporter_name, category, room_code, summary, priority, admin_notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'OPEN')
         RETURNING *`,
        [
          req.user.id,
          req.user.username || 'Admin',
          String(category || 'ADMIN_MANUAL').slice(0, 40),
          roomCode ? String(roomCode).trim().slice(0, 40) : null,
          cleanSummary,
          cleanPriority,
          JSON.stringify(initialNotes),
        ]
      );
      res.status(201).json({ success: true, report: rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Update Status, Priority, or Append Progress Comment
  app.patch(
    '/api/admin/bug-reports/:id',
    authenticateToken,
    async (req: AuthenticatedRequest, res) => {
      if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
      const reportId = parseInt(req.params.id, 10);
      if (isNaN(reportId)) return res.status(400).json({ error: 'Invalid report ID.' });

      const { status, priority, newComment } = req.body || {};
      const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
      const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

      try {
        await ensureBugReportsSchema();
        const existingRes = await pool.query(
          `SELECT admin_notes, status, priority FROM game.bug_reports WHERE id = $1`,
          [reportId]
        );
        if (existingRes.rows.length === 0) {
          return res.status(404).json({ error: 'Bug report not found.' });
        }

        const current = existingRes.rows[0];
        const nextStatus = validStatuses.includes(String(status || '').toUpperCase())
          ? String(status).toUpperCase()
          : current.status;
        const nextPriority = validPriorities.includes(String(priority || '').toUpperCase())
          ? String(priority).toUpperCase()
          : current.priority;

        const notesArray = Array.isArray(current.admin_notes) ? [...current.admin_notes] : [];
        if (newComment && String(newComment).trim()) {
          notesArray.push({
            id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            author: req.user.username || 'Admin',
            text: String(newComment).trim().slice(0, 1500),
            createdAt: new Date().toISOString(),
          });
        }

        const { rows } = await pool.query(
          `UPDATE game.bug_reports
           SET status = $1,
               priority = $2,
               admin_notes = $3::jsonb,
               updated_at = NOW()
           WHERE id = $4
           RETURNING *`,
          [nextStatus, nextPriority, JSON.stringify(notesArray), reportId]
        );
        res.json({ success: true, report: rows[0] });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // Admin: Delete a Bug Report
  app.delete(
    '/api/admin/bug-reports/:id',
    authenticateToken,
    async (req: AuthenticatedRequest, res) => {
      if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
      const reportId = parseInt(req.params.id, 10);
      if (isNaN(reportId)) return res.status(400).json({ error: 'Invalid report ID.' });

      try {
        await pool.query(`DELETE FROM game.bug_reports WHERE id = $1`, [reportId]);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', engine: 'MLP TCG Engine online' });
  });

  app.get('/api/site/announcement', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT setting_key, setting_value FROM auth.site_settings WHERE setting_key IN ('site_announcement', 'maintenance_mode')`
      );
      const map = new Map(rows.map((r: any) => [r.setting_key, r.setting_value]));
      res.json({
        success: true,
        announcement: map.get('site_announcement') || 'Welcome to Equestria Clash TCG Online!',
        maintenanceMode: map.get('maintenance_mode') === 'true',
      });
    } catch {
      res.json({
        success: true,
        announcement: 'Welcome to Equestria Clash TCG Online!',
        maintenanceMode: false,
      });
    }
  });

  const server = createServer(app);
  const gameManager = new GameManager(server);

  server.listen(PORT, () => {
    console.log(`[SERVER] MLP TCG Backend active on port ${PORT} with WebSocket GameManager enabled.`);
  });
}

startServer();