import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { loadDb } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function createToken(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '8h' });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ status: 'ERROR', message: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    req.userId = decoded.sub;
    return next();
  } catch {
    return res.status(401).json({ status: 'ERROR', message: 'Token inválido' });
  }
}

export function login(username: string, password: string) {
  const db = loadDb();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.passwordHash)) return null;
  return { user, token: createToken(user.id) };
}
