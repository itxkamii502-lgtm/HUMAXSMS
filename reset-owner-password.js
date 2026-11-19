#!/usr/bin/env node
/**
 * CLI Script: Reset Owner Password
 * Usage: node reset-owner-password.js "NewPassword"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env automatically so DATA_DIR from .env is respected
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const clean = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const eq = clean.indexOf('=');
      if (eq <= 0) continue;
      const key = clean.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;
      let val = clean.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (_) {}
})();

const newPassword = process.argv[2];

if (!newPassword || String(newPassword).trim().length < 6) {
  console.error('Error: Please provide a new password with at least 6 characters.');
  console.error('Usage: node reset-owner-password.js "NewStrongPassword"');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'humex-sms', 'data');
const usersFile = path.join(dataDir, 'users.json');
const sessionsFile = path.join(dataDir, 'sessions.json');

try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let users = [];
  if (fs.existsSync(usersFile)) {
    const raw = fs.readFileSync(usersFile, 'utf8').trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) users = parsed;
    }
  }

  const hashedPassword = bcrypt.hashSync(String(newPassword).trim(), 10);
  const now = new Date().toISOString();

  let ownerIndex = users.findIndex(u => {
    if (!u) return false;
    const name = String(u.username || '').toLowerCase();
    const role = String(u.role || '').toLowerCase();
    return name === 'kamran_bhatti' || role === 'owner';
  });

  if (ownerIndex === -1) {
    users.unshift({
      id: 1,
      username: 'Kamran_Bhatti',
      password: hashedPassword,
      role: 'Owner',
      email: '',
      balance: 0,
      status: 'active',
      numbers: 0,
      created: now,
      notes: 'System Owner',
      updated_at: now
    });
    ownerIndex = 0;
  } else {
    users[ownerIndex].password = hashedPassword;
    users[ownerIndex].status = 'active';
    users[ownerIndex].updated_at = now;
  }

  // Atomic write to users.json
  const tmpUsers = usersFile + '.tmp';
  fs.writeFileSync(tmpUsers, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmpUsers, usersFile);

  // Clear all active sessions
  fs.writeFileSync(sessionsFile, JSON.stringify({}, null, 2), 'utf8');

  console.log(`[HUMEX SMS] Data Directory: ${dataDir}`);
  console.log(`[HUMEX SMS] Successfully set password for Owner (${users[ownerIndex].username})`);
  console.log('[HUMEX SMS] All active sessions have been cleared.');
} catch (err) {
  console.error('Failed to reset owner password:', err.message);
  process.exit(1);
}
