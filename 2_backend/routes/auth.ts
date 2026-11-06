import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool as db } from '../../4_data/db.ts';
import { sendVerificationEmail } from '../utils/mailer.ts'; // <-- Import mailer

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'mlp_tcg_super_secret_key_2026';

// --- User Registration with Mailer Trigger ---
router.post('/register', async (req, res) => {
  try {
    const { username, displayName, email, password, age } = req.body;

    if (!username || !displayName || !password || age === undefined) {
      return res.status(400).json({ error: 'Username, display name, password, and age are required.' });
    }

    const existingUser = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const numericAge = parseInt(age, 10);
    
    const isSafeMode = true;
    const isVerifiedAdult = false;

    const result = await db.query(
      `INSERT INTO users (username, display_name, email, password_hash, age, is_safe_mode, is_verified_adult) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, username, display_name, email, age, is_safe_mode, is_verified_adult, created_at`,
      [username, displayName, email || null, passwordHash, numericAge, isSafeMode, isVerifiedAdult]
    );

    const user = result.rows[0];

    // Trigger verification email if email provided
    if (user.email) {
      sendVerificationEmail(user.email, user.id).catch(err => {
        console.error('[BACKGROUND EMAIL ERROR]', err);
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        isSafeMode: user.is_safe_mode, 
        isVerifiedAdult: user.is_verified_adult 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (err: any) {
    console.error('[REGISTRATION ERROR]', err.message);
    res.status(500).json({ error: 'Registration failed due to a server error.' });
  }
});

// --- User Login ---
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM users WHERE email = $1 OR username = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        isSafeMode: user.is_safe_mode, 
        isVerifiedAdult: user.is_verified_adult,
        isAdmin: user.is_admin 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        age: user.age,
        isSafeMode: user.is_safe_mode,
        isVerifiedAdult: user.is_verified_adult,
        isAdmin: user.is_admin,
      },
    });
  } catch (err: any) {
    console.error('[LOGIN ERROR]', err.message);
    res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

// --- Email Link Confirmation Route (Triggered when user clicks email button) ---
router.get('/confirm-email', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).send('<h3>Invalid verification link. User ID missing.</h3>');
    }

    const userResult = await db.query('SELECT id, age FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).send('<h3>User not found.</h3>');
    }

    const user = userResult.rows[0];
    const canDisableSafeMode = user.age >= 13;

    await db.query(
      `UPDATE users 
       SET is_verified_adult = $1, 
           is_safe_mode = $2 
       WHERE id = $3`,
      [true, canDisableSafeMode ? false : true, userId]
    );

    // Send a nice HTML success message to the browser tab
    res.send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #fdf4f8; color: #1c1917; height: 100vh;">
        <h1 style="color: #db2777;">Email Verified Successfully! ✨</h1>
        <p>Your email has been verified. ${canDisableSafeMode ? 'Safe Mode has been lifted, and full community features are now unlocked!' : 'Your account is verified.'}</p>
        <p>You can now close this tab and return to Equestria Clash TCG.</p>
      </div>
    `);
  } catch (err: any) {
    console.error('[EMAIL CONFIRMATION ERROR]', err.message);
    res.status(500).send('<h3>Internal server error during email verification.</h3>');
  }
});

export default router;