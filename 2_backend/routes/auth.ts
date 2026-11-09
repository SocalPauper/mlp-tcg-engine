import { Router } from 'express';
// (Keep your existing imports, and make sure your database pool/client is imported)

const router = Router();

// ... your existing /register and /login routes ...

// Verification Endpoint
router.get('/verify', async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid or missing verification token.' });
  }

  try {
    // 1. Find user by the verification token in your auth.users table
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

    // 2. Update user to mark them as verified and clear the token
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