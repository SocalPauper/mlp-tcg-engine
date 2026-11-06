import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool as db } from '../../4_data/db.ts';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'mlp_tcg_super_secret_key_2026';

router.post('/register', async (req, res) => {
  try {
    const { displayName, email, password, isVerifiedAdult } = req.body;
    const hash = await bcrypt.hash(password, 10);
    
    const result = await db.query(
      `INSERT INTO users (display_name, email, password_hash, is_verified_adult) 
       VALUES ($1, $2, $3, $4) RETURNING id, display_name, is_verified_adult, is_admin, is_muted`,
      [displayName, email, hash, Boolean(isVerifiedAdult)]
    );
    
    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, displayName: user.display_name, isVerifiedAdult: user.is_verified_adult, isAdmin: user.is_admin, isMuted: user.is_muted },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ token, user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, displayName: user.display_name, isVerifiedAdult: user.is_verified_adult, isAdmin: user.is_admin, isMuted: user.is_muted },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
        isVerifiedAdult: user.is_verified_adult,
        isAdmin: user.is_admin,
        isMuted: user.is_muted,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;