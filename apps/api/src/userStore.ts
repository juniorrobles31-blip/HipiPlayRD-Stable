import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type ServerUser = {
  id: string;
  localUserId: string;
  username: string;
  deviceId: string;
  coins: number;
  role: 'player' | 'admin';
  createdAt: string;
  updatedAt: string;
};

const dataDir = path.resolve(process.cwd(), 'data');
const usersFile = path.join(dataDir, 'users.json');

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify([], null, 2), 'utf8');
  }
}

export function readUsers(): ServerUser[] {
  ensureStore();
  const raw = fs.readFileSync(usersFile, 'utf8');
  return JSON.parse(raw) as ServerUser[];
}

export function writeUsers(users: ServerUser[]) {
  ensureStore();
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
}

export function findUserById(id: string) {
  const users = readUsers();
  return users.find(user => user.id === id);
}

export function createOrGetUser(params: {
  localUserId: string;
  username: string;
  deviceId: string;
}) {
  const users = readUsers();

  const existing = users.find(
    user =>
      user.username.toLowerCase() === params.username.toLowerCase() ||
      user.localUserId === params.localUserId
  );

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();

  const user: ServerUser = {
    id: `user-${crypto.randomUUID()}`,
    localUserId: params.localUserId,
    username: params.username,
    deviceId: params.deviceId,
    coins: 1000,
    role: 'player',
    createdAt: now,
    updatedAt: now
  };

  users.push(user);
  writeUsers(users);

  return user;
}
