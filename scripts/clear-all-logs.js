#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env if present (mirrors server.js)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'humex-sms', 'data');

const fullReset = process.argv.includes('--all-dummy');

const LOG_ARRAY_FILES = [
  'sms_log.json',
  'audit_logs.json',
  'login_activity.json',
  'firewall_events.json',
  'notifications.json',
  'allocation_history.json',
  'number_transfers.json'
];

const EXTRA_DUMMY_ARRAY_FILES = [
  'agents.json',
  'clients.json',
  'sms_ranges.json',
  'numbers.json',
  'services.json',
  'cli_routes.json',
  'rate_card.json',
  'payout_rates.json',
  'agent_client_rates.json',
  'payout_requests.json',
  'credit_notes.json',
  'number_requests.json',
  'registration_requests.json',
  'support_tickets.json',
  'announcements.json',
  'blacklist.json',
  'blocked_ips.json'
];

if (!fs.existsSync(DATA_DIR)) {
  console.log(`[CLEAR] DATA_DIR does not exist yet: ${DATA_DIR}`);
  process.exit(0);
}

const targets = fullReset ? [...LOG_ARRAY_FILES, ...EXTRA_DUMMY_ARRAY_FILES] : LOG_ARRAY_FILES;

let cleared = 0;
for (const file of targets) {
  const fullPath = path.join(DATA_DIR, file);
  if (fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, '[]\n', 'utf-8');
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
const archiveDir = path.join(DATA_DIR, 'archive');
if (fs.existsSync(archiveDir)) {
  for (const entry of fs.readdirSync(archiveDir)) {
    fs.rmSync(path.join(archiveDir, entry), { recursive: true, force: true });
    cleared++;
  }
}

// Clear active sessions on --all-dummy
if (fullReset) {
  const sessionsPath = path.join(DATA_DIR, 'sessions.json');
  if (fs.existsSync(sessionsPath)) {
    fs.writeFileSync(sessionsPath, '{}\n', 'utf-8');
    cleared++;
  }
}

console.log(`[CLEAR] Cleaned ${cleared} log/data items in ${DATA_DIR} (${fullReset ? 'full dummy reset, Owner & settings preserved' : 'all logs & archives cleared'}).`);
