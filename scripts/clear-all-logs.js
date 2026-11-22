#!/usr/bin/env node
/**
 * HUMAX SMS — Production Log Cleaner & Owner-Only Data Reset Utility
 *
 * Modes:
 *   node scripts/clear-all-logs.js                -> Clear all SMS/audit/login/firewall logs & archives only
 *   node scripts/clear-all-logs.js --owner-only   -> Wipe ALL logs & ALL non-owner data; preserve ONLY Owner account & settings
 *   node scripts/clear-all-logs.js --all-dummy    -> Alias for --owner-only
 *
 * IMPORTANT on VPS: Always stop PM2 before running (`pm2 stop humex-sms`), then restart after.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env if present (mirrors server.js so DATA_DIR from .env is respected)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const clean = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = clean.indexOf('=');
    if (eq <= 0) continue;
    const k = clean.slice(0, eq).trim();
    let v = clean.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'humex-sms', 'data');

const ownerOnlyReset =
  process.argv.includes('--owner-only') ||
  process.argv.includes('--all-dummy') ||
  process.argv.includes('--production-reset');

const LOG_ARRAY_FILES = [
  'sms_log.json',
  'audit_logs.json',
  'login_activity.json',
  'firewall_events.json',
  'notifications.json',
  'allocation_history.json',
  'number_transfers.json'
];

const NON_OWNER_DATA_ARRAY_FILES = [
  'agents.json',
  'clients.json',
  'numbers.json',
  'sms_ranges.json',
  'services.json',
  'app_links.json',
  'cli_routes.json',
  'rate_card.json',
  'payout_rates.json',
  'agent_client_rates.json',
  'payout_requests.json',
  'credit_notes.json',
  'bank_accounts.json',
  'number_requests.json',
  'registration_requests.json',
  'support_tickets.json',
  'announcements.json',
  'blacklist.json',
  'blocked_ips.json',
  'chat_conversations.json',
  'chat_messages.json',
  'whitenoise_daily_stats.json',
  'whitenoise_upload_batches.json',
  'whitenoise_connections.json',
  'number_ownership_ledger.json',
  'cr_api_connections.json',
  'login_panels.json'
];

const OBJECT_STATE_FILES_TO_RESET = [
  { file: 'sessions.json', value: '{}' },
  { file: 'permissions.json', value: '{}' },
  { file: 'rate_limits.json', value: '{}' },
  { file: 'meta.json', value: JSON.stringify({ id_counters: {}, sms_last_id: 0 }) }
];

function emptyDirectory(dirPath, keepFilenames = new Set()) {
  if (!fs.existsSync(dirPath)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dirPath)) {
    if (keepFilenames.has(entry)) continue;
    fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

if (!fs.existsSync(DATA_DIR)) {
  console.log(`[CLEAR] DATA_DIR does not exist yet: ${DATA_DIR}`);
  process.exit(0);
}

const targets = ownerOnlyReset
  ? [...LOG_ARRAY_FILES, ...NON_OWNER_DATA_ARRAY_FILES]
  : LOG_ARRAY_FILES;

let cleared = 0;
for (const file of targets) {
  const fullPath = path.join(DATA_DIR, file);
  if (fs.existsSync(fullPath)) {
    if (file === 'sms_log.json') {
      atomicWrite(fullPath, '[]\n');
    } else if (ownerOnlyReset) {
      fs.rmSync(fullPath, { force: true });
    } else {
      atomicWrite(fullPath, '[]\n');
    }
    cleared++;
  }
}

// Clear SMS journal
const journalPath = path.join(DATA_DIR, 'sms_log.journal.ndjson');
if (fs.existsSync(journalPath)) {
  fs.writeFileSync(journalPath, '', 'utf-8');
  cleared++;
}

// Clear archived SMS logs
cleared += emptyDirectory(path.join(DATA_DIR, 'archive'));

if (ownerOnlyReset) {
  // 1. Preserve ONLY Owner account(s) in users.json & reset runtime balance/counters
  const usersPath = path.join(DATA_DIR, 'users.json');
  let preservedOwners = [];
  if (fs.existsSync(usersPath)) {
    try {
      const raw = fs.readFileSync(usersPath, 'utf-8').trim();
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        preservedOwners = parsed
          .filter(u => {
            if (!u) return false;
            const role = String(u.role || '').toLowerCase();
            const uname = String(u.username || '').toLowerCase();
            return role === 'owner' || uname === 'kamran_bhatti';
          })
          .map(u => ({
            ...u,
            role: 'Owner',
            status: 'active',
            balance: 0,
            numbers: 0,
            updated_at: new Date().toISOString()
          }));
      }
    } catch (e) {
      console.error('[CLEAR] Warning reading users.json:', e.message);
    }
    atomicWrite(usersPath, JSON.stringify(preservedOwners, null, 2) + '\n');
    cleared++;
  }

  // 2. Reset object state files (sessions, meta counters, permissions, rate limits)
  for (const { file, value } of OBJECT_STATE_FILES_TO_RESET) {
    const fullPath = path.join(DATA_DIR, file);
    if (file === 'sessions.json' || file === 'meta.json' || fs.existsSync(fullPath)) {
      atomicWrite(fullPath, `${value}\n`);
      cleared++;
    }
  }

  // 3. Determine if settings.json references a custom uploaded logo inside DATA_DIR/uploads
  const keepUploads = new Set();
  const settingsPath = path.join(DATA_DIR, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const logoUrl = String(s && s.logo_url || '').trim();
      if (logoUrl.startsWith('/uploads/') || logoUrl.startsWith('/static/img/')) {
        keepUploads.add(path.basename(logoUrl));
      }
    } catch (_) {}
  }

  // 4. Empty runtime media & upload directories
  cleared += emptyDirectory(path.join(DATA_DIR, 'chat_media'));
  cleared += emptyDirectory(path.join(DATA_DIR, 'agent_files'));
  cleared += emptyDirectory(path.join(DATA_DIR, 'uploads'), keepUploads);

  // 5. Remove any stray temp / backup / non-core JSON artifacts in DATA_DIR
  const KEEP_ROOT_FILES = new Set([
    'users.json',
    'settings.json',
    'sessions.json',
    'sms_log.json',
    'sms_log.journal.ndjson',
    'meta.json',
    'permissions.json',
    'rate_limits.json'
  ]);
  for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (entry.isFile() && !KEEP_ROOT_FILES.has(entry.name)) {
      if (
        entry.name.endsWith('.tmp') ||
        entry.name.endsWith('.bak') ||
        entry.name.endsWith('.log') ||
        entry.name.endsWith('.ndjson') ||
        entry.name.endsWith('.json')
      ) {
        fs.rmSync(path.join(DATA_DIR, entry.name), { force: true });
        cleared++;
      }
    }
  }

  const ownerNames = preservedOwners.map(o => o.username).join(', ') || '(will auto-bootstrap on next start)';
  console.log(`[CLEAR] Production Owner-Only Reset complete in ${DATA_DIR}`);
  console.log(`[CLEAR] Cleaned/reset ${cleared} files/items. Preserved Owner: ${ownerNames} + settings.json.`);
} else {
  console.log(`[CLEAR] Cleaned ${cleared} log/archive items in ${DATA_DIR} (all logs & archives cleared).`);
}
