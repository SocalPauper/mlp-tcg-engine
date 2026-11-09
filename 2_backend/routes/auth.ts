import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../4_data/db.ts';
import { sendVerificationEmail } from '../services/mailer.ts';

const router = Router();

// ==========================================
// REGISTER ROUTE
// ==========================================
router.post('/register', async (req: Request, res: Response) => {
  try {
    // 1. Capture all fields matching the frontend form
    const { username, display_name, age, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    const userExists = await pool.query(
      'SELECT id FROM auth.users WHERE email = $1 OR username = $2', 
      [email, username]
    );
    
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already in use.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // 2. Include display_name and age in the INSERT statement
    const newUserQuery = `
      INSERT INTO auth.users (username, display_name, age, email, password_hash, verification_token, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, false)
      RETURNING id, username, email;
    `;
    
    const newUserData = await pool.query(newUserQuery, [
      username, 
      display_name, 
      age, // Ensure age is passed as an integer from the frontend, or cast it: parseInt(age, 10)
      email, 
      passwordHash, 
      verificationToken
    ]);
    
    const user = newUserData.rows[0];

    // Mailer is wrapped in its own try/catch so it won't trigger the outer 500 if SMTP fails
    try {
      await sendVerificationEmail(email, verificationToken);
    } catch (mailError) {
      console.error('Failed to send verification email, but user was created:', mailError);
    }

    return res.status(201).json({
      message: 'Registration successful! Please check your email to verify your account.',
      userId: user.id,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// ==========================================
// LOGIN ROUTE
// ==========================================
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await pool.query('SELECT * FROM auth.users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.is_verified === false) {
      return res.status(403).json({ error: 'Please verify your email address before logging in.' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'fallback_secret_key';
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// ==========================================
// EMAIL VERIFICATION ROUTE
// ==========================================
router.get('/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Missing verification token.' });
    }

    const updateQuery = `
      UPDATE auth.users
      SET is_verified = true, verification_token = NULL
      WHERE verification_token = $1 AND is_verified = false
      RETURNING id, username;
    `;
    const result = await pool.query(updateQuery, [token]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/login?verified=true`);
  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({ error: 'Internal server error during verification.' });
  }
});

export default router;