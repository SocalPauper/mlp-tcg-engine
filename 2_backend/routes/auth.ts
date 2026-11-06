import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool as db } from '../../4_data/db.js';
import { sendVerificationEmail } from '../utils/mailer.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'mlp_tcg_super_secret_key_2026';

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const existingUser = await db.query('SELECT id FROM auth.users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO auth.users (username, email, password_hash) 
       VALUES ($1, $2, $3) 
       RETURNING id, username, email, is_admin, created_at`,
      [username, email || null, passwordHash]
    );

    const user = result.rows[0];

    if (user.email) {
      sendVerificationEmail(user.email, user.id).catch(err => {
        console.error('[BACKGROUND EMAIL ERROR]', err);
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        isAdmin: user.is_admin 
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

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM auth.users WHERE email = $1 OR username = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
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
        email: user.email,
        isAdmin: user.is_admin,
      },
    });
  } catch (err: any) {
    console.error('[LOGIN ERROR]', err.message);
    res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

export default router;