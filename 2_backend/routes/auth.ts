import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../4_data/db.js';
import { sendVerificationEmail } from '../services/mailer.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'mlp_tcg_super_secret_key_2026';

// CURRENT SESSION ENDPOINT
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pool.query('SELECT id, username, display_name, email, is_safe_mode, is_verified, reward_points FROM auth.users WHERE id = $1', [req.user?.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false });
    
    const user = result.rows[0];
    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        isSafeMode: user.is_safe_mode,
        isVerified: user.is_verified,
        reward_points: user.reward_points
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

// GET USER CARD COLLECTION
router.get('/me/collection', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pool.query('SELECT card_id, quantity, user_alerted FROM public.user_cards WHERE user_id = $1', [req.user?.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching collection:', err);
    return res.status(500).json([]);
  }
});

// ACKNOWLEDGE NEW UNLOCKS
router.post('/me/collection/acknowledge', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    await pool.query('UPDATE public.user_cards SET user_alerted = TRUE WHERE user_id = $1 AND user_alerted = FALSE', [req.user?.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

// REGISTER ENDPOINT
router.post('/register', async (req, res) => {
  const { username, displayName, email, password, age } = req.body;

  if (!username || !displayName || !password || age === undefined) {
    return res.status(400).json({ success: false, message: 'Missing required registration fields.' });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM auth.users WHERE username = $1 OR ($2::text IS NOT NULL AND email = $2)',
      [username, email || null]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Username or email already in use.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const isVerified = !email;
    const isSafeMode = !(!email && age >= 13);

    const insertResult = await pool.query(
      `INSERT INTO auth.users (username, display_name, email, password_hash, age, verification_token, is_verified, is_safe_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, username, display_name, email, reward_points`,
      [username, displayName, email || null, passwordHash, age, verificationToken, isVerified, isSafeMode]
    );

    const newUser = insertResult.rows[0];

    // Issue token upon registration so user is instantly logged in
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, isSafeMode, isVerifiedAdult: false, isAdmin: false },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    if (email) {
      try {
        await sendVerificationEmail(email, verificationToken);
      } catch (emailErr) {
        console.error('Failed to send verification email:', emailErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: email ? 'Registration successful! Please check your email to verify your account.' : 'Registration successful!',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        displayName: newUser.display_name,
        reward_points: newUser.reward_points
      }
    });

  } catch (err: any) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during registration.' });
  }
});

// LOGIN ENDPOINT
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM auth.users WHERE username = $1 OR email = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    let currentSafeMode = user.is_safe_mode;
    if (user.is_verified && user.age >= 13 && currentSafeMode) {
      await pool.query('UPDATE auth.users SET is_safe_mode = FALSE WHERE id = $1', [user.id]);
      currentSafeMode = false;
    }

    // Generate JWT Token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        isSafeMode: currentSafeMode,
        isVerifiedAdult: user.is_verified_adult,
        isAdmin: user.is_admin
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        isSafeMode: currentSafeMode,
        isVerified: user.is_verified,
        reward_points: user.reward_points
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during login.' });
  }
});

// EMAIL VERIFICATION ENDPOINT
router.get('/verify', async (req, res) => {
  const { token } = req.query;

  if (!token) return res.status(401).json({ success: false, message: 'No verification token provided.' });
  if (typeof token !== 'string') return res.status(400).json({ success: false, message: 'Invalid token format.' });

  try {
    const userResult = await pool.query('SELECT id, age, is_verified FROM auth.users WHERE verification_token = $1', [token]);
    if (userResult.rows.length === 0) return res.status(400).json({ success: false, message: 'Token invalid or expired.' });

    const user = userResult.rows[0];
    if (user.is_verified) return res.json({ success: true, message: 'Already verified.' });

    const removeSafeMode = user.age >= 13;
    await pool.query(
      'UPDATE auth.users SET is_verified = TRUE, is_safe_mode = CASE WHEN $2::boolean THEN FALSE ELSE is_safe_mode END, verification_token = NULL WHERE id = $1',
      [user.id, removeSafeMode]
    );

    return res.json({ success: true, message: 'Email verified successfully! Safe mode removed.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;