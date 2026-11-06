import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'mlp_tcg_super_secret_key_2026';

// Extend Express Request interface to include user payload
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    username: string;
    isSafeMode: boolean;
    isVerifiedAdult: boolean;
    isAdmin: boolean;
  };
}

// Middleware to authenticate JWT token
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}

// Middleware to block restricted actions if the user is in Safe Mode
export function requireNonSafeMode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  // If user is still in safe mode, block chat, community posts, public decks, etc.
  if (req.user.isSafeMode) {
    return res.status(403).json({ 
      error: 'Action restricted. Your account is currently in Safe Mode. Please complete email verification and meet age requirements (13+) to unlock community features.' 
    });
  }

  next();
}