import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'mlp_tcg_super_secret_key_2026';

if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY WARNING] JWT_SECRET env var not set; using fallback key.');
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    isSafeMode: boolean;
    isVerifiedAdult: boolean;
    isAdmin: boolean;
  };
}

export function verifyJwtToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as {
      id: string;
      username: string;
      isSafeMode: boolean;
      isVerifiedAdult: boolean;
      isAdmin: boolean;
    };
  } catch {
    return null;
  }
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const decoded = verifyJwtToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
  req.user = decoded;
  next();
}

export function optionalAuthenticateToken(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    const decoded = verifyJwtToken(token);
    if (decoded) req.user = decoded;
  }
  next();
}

export function requireNonSafeMode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (req.user.isSafeMode) {
    return res.status(403).json({
      error:
        'Action restricted. Your account is currently in Safe Mode. Please complete email verification and meet age requirements (13+) to unlock community features.',
    });
  }

  next();
}