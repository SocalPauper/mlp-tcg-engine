import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../../4_data/db.ts';
import { sendVerificationEmail } from '../services/mailer.js';

const router = Router();

// CURRENT SESSION ENDPOINT
router.get('/me', async (req, res) => {
  return res.json({ success: true, user: null });
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

    // If no email is required or provided, and age >= 13, disable safe mode immediately
    const isVerified = !email;
    const isSafeMode = !(!email && age >= 13);

    const insertResult = await pool.query(
      `INSERT INTO auth.users (username, display_name, email, password_hash, age, verification_token, is_verified, is_safe_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, username, email`,
      [username, displayName, email || null, passwordHash, age, verificationToken, isVerified, isSafeMode]
    );

    const newUser = insertResult.rows[0];

    if (email) {
      try {
        await sendVerificationEmail(email, verificationToken);
      } catch (emailErr) {
        console.error('Failed to send verification email:', emailErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: email 
        ? 'Registration successful! Please check your email to verify your account.' 
        : 'Registration successful!',
      userId: newUser.id
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

    // Enforce rule: remove safe mode if verified and age >= 13
    let currentSafeMode = user.is_safe_mode;
    if (user.is_verified && user.age >= 13 && currentSafeMode) {
      await pool.query('UPDATE auth.users SET is_safe_mode = FALSE WHERE id = $1', [user.id]);
      currentSafeMode = false;
    }

    return res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        isSafeMode: currentSafeMode,
        isVerified: user.is_verified
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

  if (!token) {
    return res.status(401).json({ success: false, message: 'No verification token provided.' });
  }

  if (typeof token !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid verification token format.' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id, age, is_verified FROM auth.users WHERE verification_token = $1',
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Verification token is invalid or has expired.' });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res.json({ success: true, message: 'Account is already verified. You can log in.' });
    }

    // If verified and age >= 13, remove safe mode
    const removeSafeMode = user.age >= 13;

    await pool.query(
      'UPDATE auth.users SET is_verified = TRUE, is_safe_mode = CASE WHEN $2::boolean THEN FALSE ELSE is_safe_mode END, verification_token = NULL WHERE id = $1',
      [user.id, removeSafeMode]
    );

    return res.json({ success: true, message: 'Email verified successfully! Safe mode removed. You may now log in.' });
  } catch (err) {
    console.error('Error during email verification:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during verification.' });
  }
});

export default router;