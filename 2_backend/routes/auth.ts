import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../../4_data/db.ts'; // Adjust relative path to db if needed based on directory structure
import { sendVerificationEmail } from '../services/mailer.js';

const router = Router();

// REGISTER ENDPOINT
router.post('/register', async (req, res) => {
  const { username, displayName, email, password, age } = req.body;

  if (!username || !displayName || !password || age === undefined) {
    return res.status(400).json({ success: false, message: 'Missing required registration fields.' });
  }

  try {
    // Check if username or email already exists
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

    // Insert user into database
    const insertResult = await pool.query(
      `INSERT INTO auth.users (username, display_name, email, password_hash, age, verification_token, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email`,
      [username, displayName, email || null, passwordHash, age, verificationToken, !email]
    );

    const newUser = insertResult.rows[0];

    // Send verification email if email is provided
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

    return res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        isSafeMode: user.is_safe_mode,
        isVerified: user.is_verified
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during login.' });
  }
});

// VERIFICATION ENDPOINT
router.get('/verify', async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid or missing verification token.' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id, is_verified FROM auth.users WHERE verification_token = $1',
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Verification token is invalid or has expired.' });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res.json({ success: true, message: 'Account is already verified. You can log in.' });
    }

    await pool.query(
      'UPDATE auth.users SET is_verified = TRUE, verification_token = NULL WHERE id = $1',
      [user.id]
    );

    return res.json({ success: true, message: 'Email verified successfully! You may now log in.' });
  } catch (err) {
    console.error('Error during email verification:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during verification.' });
  }
});

export default router;