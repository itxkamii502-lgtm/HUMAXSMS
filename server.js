import express from 'express';
import compression from 'compression';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env automatically if present (without overriding explicit shell/PM2 env vars)
(function loadEnvFileIfPresent() {
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
  } catch (err) {
    console.warn('[BOOT] Could not parse .env file:', err.message);
  }
})();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── Rate Limiting Helper (Bounded & Self-Pruning) ─────────────
const rateLimitBuckets = new Map();
let rateLimitOps = 0;
function isRateLimited(key, limit, windowMs) {
  const now = Date.now();
  rateLimitOps++;
  if (rateLimitOps % 250 === 0 || rateLimitBuckets.size > 5000) {
    for (const [k, b] of rateLimitBuckets.entries()) {
      if (now >= (b.expiresAt || (b.start + windowMs))) {
        rateLimitBuckets.delete(k);
      }
    }
    if (rateLimitBuckets.size > 10000) {
      let drop = rateLimitBuckets.size - 8000;
      for (const k of rateLimitBuckets.keys()) {
        rateLimitBuckets.delete(k);
        if (--drop <= 0) break;
      }
    }
  }
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, expiresAt: now + windowMs, count: 1 };
    rateLimitBuckets.set(key, bucket);
    return false;
  }
  bucket.count++;
  return bucket.count > limit;
}

// ── Strict Number Allocation Mutex / Serialization Lock ────────
let allocationLockQueue = Promise.resolve();
function withAllocationLock(fn) {
  const result = allocationLockQueue.then(() => fn());
  allocationLockQueue = result.catch(() => {});
  return result;
}

// ── Secure Recipient-Filtered WebSocket Broadcast ──────────────
function broadcastWs(data, targetFilter = null) {
  try {
    let payload = data;
    if (data && data.type === 'otp' && data.data) {
      payload = {
        type: 'otp',
        ...data.data,
        data: data.data
      };
    }
    const msg = JSON.stringify(payload);
    wss.clients.forEach(client => {
      if (client.readyState !== 1) return;
      
      // Unauthenticated sockets do NOT receive private system events
      if (!client.user) {
        if (data.type === 'heartbeat' || data.type === 'connected') {
          client.send(msg);
        }
        return;
      }

      const u = client.user;
      const uRole = (u.role || '').toLowerCase();
      const isOwner = uRole === 'owner' || uRole === 'admin';

      if (typeof targetFilter === 'function') {
        if (isOwner || targetFilter(u)) {
          client.send(msg);
        }
        return;
      }

      // Event-type based privacy routing (role-sanitized payloads)
      if (data.type === 'otp') {
        const recipientUser = String(payload.user || payload.client_username || payload.client_name || '').toLowerCase();
        const recipientClientId = payload.client_id != null && payload.client_id !== '' ? Number(payload.client_id) : null;
        const recipientAgentId = payload.agent_id != null && payload.agent_id !== '' ? Number(payload.agent_id) : null;

        if (isOwner) {
          client.send(msg);
        } else if (uRole === 'agent' && recipientAgentId && Number(u.id) === recipientAgentId) {
          const base = { ...(payload.data || payload) };
          base.cli = serverMaskCli(base.cli || base.app || base.sender);
          base.provider = maskProviderLabel(base.provider || '', false);
          delete base.company_rate;
          delete base.company_cost;
          delete base.company_payout;
          delete base.carrier_revenue;
          delete base.owner_amount;
          delete base.profit;
          delete base.admin_profit;
          delete base.gross_margin;
          client.send(JSON.stringify({ type: 'otp', ...base, data: base }));
        } else if (uRole === 'client' && (
          (recipientClientId != null && Number(u.id) === recipientClientId) ||
          (recipientClientId == null && recipientUser && String(u.username || '').toLowerCase() === recipientUser)
        )) {
          const base = { ...(payload.data || payload) };
          base.cli = serverMaskCli(base.cli || base.app || base.sender);
          base.provider = maskProviderLabel(base.provider || '', false);
          delete base.company_rate;
          delete base.company_cost;
          delete base.company_payout;
          delete base.carrier_revenue;
          delete base.owner_amount;
          delete base.profit;
          delete base.admin_profit;
          delete base.gross_margin;
          delete base.agent_rate;
          delete base.agent_payout;
          delete base.agent_amount;
          delete base.payout_cost;
          client.send(JSON.stringify({ type: 'otp', ...base, data: base }));
        }
        return;
      }

      if (data.type === 'live_access_otp') {
        const cfg = readDb('settings') || {};
        const allowAgents = Boolean(cfg.live_access_agents_enabled);
        const allowClients = Boolean(cfg.live_access_clients_enabled);
        if (isOwner || (uRole === 'agent' && allowAgents) || (uRole === 'client' && allowClients)) {
          client.send(msg);
        }
        return;
      }

      if (data.type === 'agent_number_request') {
        const agId = data.data && Number(data.data.agent_id);
        const clId = data.data && Number(data.data.client_id);
        if (isOwner ||
          (uRole === 'agent' && agId && Number(u.id) === agId) ||
          (uRole === 'client' && clId && Number(u.id) === clId)) {
          client.send(msg);
        }
        return;
      }

      if (data.type === 'agent_request_updated') {
        const agId = data.data && Number(data.data.agent_id);
        const clId = data.data && Number(data.data.client_id);
        if (isOwner ||
          (uRole === 'agent' && agId && Number(u.id) === agId) ||
          (uRole === 'client' && clId && Number(u.id) === clId)) {
          client.send(msg);
        }
        return;
      }

      if (data.type === 'notification') {
        const notif = data.notification || data.data || data;
        const targetRole = String(notif.recipient_role || '').toLowerCase();
        const targetId = notif.recipient_id ? Number(notif.recipient_id) : null;
        const targetUsername = String(notif.recipient_username || '').toLowerCase();

        if (isOwner) {
          // Owner receives Owner/Admin/All notifications in real-time (strict role scoping)
          if (!targetRole || targetRole === 'owner' || targetRole === 'admin' || targetRole === 'all') {
            client.send(msg);
          }
        } else if (targetRole === 'all') {
          client.send(msg);
        } else if (targetId && Number(u.id) === targetId && (targetRole === uRole || !targetRole)) {
          client.send(msg);
        } else if (targetUsername && u.username.toLowerCase() === targetUsername && (targetRole === uRole || !targetRole)) {
          client.send(msg);
        } else if (targetRole && uRole === targetRole && !targetId && !targetUsername) {
          client.send(msg);
        }
        return;
      }

      // Safe non-sensitive events
      if (['heartbeat', 'connected', 'brand_theme_updated'].includes(data.type)) {
        client.send(msg);
      }
    });
  } catch (e) {
    console.error('broadcastWs error:', e);
  }
}

// ── Secure Password Hashing & Verification ─────────────────────
function hashPassword(plain) {
  if (!plain) return '';
  return bcrypt.hashSync(String(plain), 10);
}

function verifyPassword(plain, stored) {
  if (!plain || !stored) return false;
  const s = String(stored).trim();
  const p = String(plain).trim();
  if (s.startsWith('$2a$') || s.startsWith('$2b$')) {
    return bcrypt.compareSync(p, s);
  }
  // Safe migration fallback: verify against plaintext once
  return p === s;
}

const portArgIdx = process.argv.indexOf('--port');
const portFromArg = portArgIdx !== -1 && process.argv[portArgIdx + 1] ? Number(process.argv[portArgIdx + 1]) : null;
const envPort = Number(process.env.PORT);
const PORT = portFromArg || (envPort && envPort !== 8080 ? envPort : 3000);
const HUMEX_DIR = path.join(__dirname, 'humex-sms');
const STATIC_DIR = path.join(HUMEX_DIR, 'static');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(HUMEX_DIR, 'data');
const AGENT_FILES_DIR = path.join(DATA_DIR, 'agent_files');
const CHAT_MEDIA_DIR = path.join(DATA_DIR, 'chat_media');
console.log(`[BOOT] Resolved APP_DIR:  ${HUMEX_DIR}`);
console.log(`[BOOT] Resolved DATA_DIR: ${DATA_DIR}`);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(AGENT_FILES_DIR)) {
  fs.mkdirSync(AGENT_FILES_DIR, { recursive: true });
}
if (!fs.existsSync(CHAT_MEDIA_DIR)) {
  fs.mkdirSync(CHAT_MEDIA_DIR, { recursive: true });
}

// ── Database Helpers ──────────────────────────────────────────
const DB_CACHE = new Map();
const DB_MTIME = new Map();

// SMS log persistence: every SMS is appended to a crash-safe journal immediately, the big
// sms_log.json is rewritten in the background (debounced, atomic). Nothing is lost on a crash.
const SMS_JOURNAL = path.join(DATA_DIR, 'sms_log.journal.ndjson');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const SMS_RETENTION_DAYS = Number(process.env.SMS_LOG_RETENTION_DAYS) || 90;
const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(path.dirname(DATA_DIR), 'backups');
const debounceTimers = new Map();
function readMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, 'utf-8')) || {}; } catch (e) { return {}; } }
function writeMeta(m) { try { fs.writeFileSync(META_FILE + '.tmp', JSON.stringify(m)); fs.renameSync(META_FILE + '.tmp', META_FILE); } catch (e) { console.error('meta write error', e.message); } }

function readDb(name) {
  try {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      if (DB_CACHE.has(name)) {
        return DB_CACHE.get(name);
      }
      const empty = [];
      DB_CACHE.set(name, empty);
      return empty;
    }
    const stat = fs.statSync(filePath);
    const lastMtime = DB_MTIME.get(name);
    if (DB_CACHE.has(name) && lastMtime && stat.mtimeMs <= lastMtime) {
      return DB_CACHE.get(name);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw || !raw.trim()) {
      return [];
    }
    const data = JSON.parse(raw);
    if (name === 'sms_ranges' && Array.isArray(data)) {
      data.forEach(r => {
        const rn = r.range_name || r.name || r.country || 'Range';
        r.range_name = rn;
        r.name = rn;
      });
    }
    DB_CACHE.set(name, data);
    DB_MTIME.set(name, stat.mtimeMs);
    if (name === 'numbers' && Array.isArray(data) && !NUMBER_OWNERSHIP_SNAPSHOT_READY) {
      refreshNumberOwnershipSnapshot(data);
    }
    return data;
  } catch (err) {
    console.error(`Error reading ${name}.json:`, err);
    return [];
  }
}

function atomicWriteFileSync(filePath, content) {
  const rand = crypto.randomBytes(6).toString('hex');
  const tmpPath = `${filePath}.tmp.${process.pid}.${rand}`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function writeDb(name, data) {
  try {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    const jsonStr = (name === 'sms_log')
      ? JSON.stringify(data)
      : JSON.stringify(data, null, 2);
    atomicWriteFileSync(filePath, jsonStr);
    DB_CACHE.set(name, data);
    try {
      DB_MTIME.set(name, fs.statSync(filePath).mtimeMs || Date.now());
    } catch (_) {
      DB_MTIME.set(name, Date.now());
    }
    if (name === 'sms_log') {
      // everything in the journal is now inside sms_log.json
      try { fs.writeFileSync(SMS_JOURNAL, ''); } catch (e) { /* ignore */ }
      const t = debounceTimers.get('sms_log'); if (t) { clearTimeout(t); debounceTimers.delete('sms_log'); }
    }
    if (name === 'numbers' && Array.isArray(data) && !SUPPRESS_OWNERSHIP_LEDGER_HOOK) {
      try { syncNumberOwnershipLedgerOnWrite(data); } catch (e) { console.error('[OWNERSHIP_LEDGER] hook error:', e.message); }
    }
    return true;
  } catch (err) {
    console.error(`Error writing ${name}.json:`, err);
    return false;
  }
}

function bumpIdCounter(tableName, idVal) {
  if (!tableName) return;
  const n = Number(idVal);
  if (!Number.isFinite(n) || n <= 0) return;
  const meta = readMeta();
  if (!meta.id_counters || typeof meta.id_counters !== 'object') meta.id_counters = {};
  const prev = Number(meta.id_counters[tableName] || 0);
  if (n > prev) {
    meta.id_counters[tableName] = n;
    writeMeta(meta);
  }
}

function nextId(data, tableName = null) {
  let max = 0;
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const n = Number(data[i] && data[i].id);
      if (Number.isFinite(n) && n > 0 && n > max) max = n;
    }
  }
  if (tableName) {
    const meta = readMeta();
    if (!meta.id_counters || typeof meta.id_counters !== 'object') meta.id_counters = {};
    const stored = Number(meta.id_counters[tableName] || 0);
    const next = Math.max(max, Number.isFinite(stored) ? stored : 0) + 1;
    meta.id_counters[tableName] = next;
    writeMeta(meta);
    return next;
  }
  return max + 1;
}

// Debounced background write (always writes whatever is current in the cache at flush time)
const DB_FLUSH_MS = process.env.DATA_DIR ? 50 : 1500;
function debouncedWriteDb(name, ms = DB_FLUSH_MS) {
  if (debounceTimers.has(name)) return;
  const t = setTimeout(() => { debounceTimers.delete(name); const cur = DB_CACHE.get(name); if (cur) writeDb(name, cur); }, ms);
  if (t.unref) t.unref();
  debounceTimers.set(name, t);
}
function flushPendingWrites() {
  for (const [name, t] of Array.from(debounceTimers.entries())) { clearTimeout(t); debounceTimers.delete(name); const cur = DB_CACHE.get(name); if (cur) writeDb(name, cur); }
}

// ── High-Performance Indexed In-Memory Lookup for Numbers & Ingestion ──
let CACHED_NUMBERS_BY_DIGITS = null;
let CACHED_NUMBERS_BY_RAW = null;
let CACHED_NUMBERS_MTIME = 0;

function getIndexedNumbers() {
  const currentMtime = DB_MTIME.get('numbers') || 0;
  if (!CACHED_NUMBERS_BY_DIGITS || CACHED_NUMBERS_MTIME !== currentMtime) {
    const numbers = readDb('numbers') || [];
    const byDigits = new Map();
    const byRaw = new Map();
    for (let i = 0; i < numbers.length; i++) {
      const n = numbers[i];
      if (!n) continue;
      const raw = String(n.number || '').trim();
      const d = raw.replace(/\D/g, '');
      if (raw && !byRaw.has(raw)) byRaw.set(raw, n);
      if (d && !byDigits.has(d)) byDigits.set(d, n);
    }
    CACHED_NUMBERS_BY_DIGITS = byDigits;
    CACHED_NUMBERS_BY_RAW = byRaw;
    CACHED_NUMBERS_MTIME = currentMtime;
  }
  return { byDigits: CACHED_NUMBERS_BY_DIGITS, byRaw: CACHED_NUMBERS_BY_RAW };
}

// SMS id counter (persisted, never recomputed from a huge array on every SMS)
let smsLastId = null;
function nextSmsId(log) {
  if (smsLastId === null) {
    smsLastId = Number(readMeta().sms_last_id) || 0;
    for (let i = 0; i < log.length; i++) { const n = Number(log[i] && log[i].id) || 0; if (n > smsLastId) smsLastId = n; }
  }
  smsLastId += 1;
  if (smsLastId % 50 === 0) { const m = readMeta(); m.sms_last_id = smsLastId; writeMeta(m); }
  return smsLastId;
}
// Canonical content fingerprint helpers for cross-source duplicate prevention
function normalizePhoneKey(raw) {
  return String(raw || '').replace(/\D/g, '').replace(/^00+/, '');
}
function normalizeMsgKey(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}
function isRelativeTimestampStr(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return true;
  return /^(just now|now|today|yesterday|\d+\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*ago)$/i.test(s);
}
function buildSmsContentKey(num, msg, rawTs) {
  const nKey = normalizePhoneKey(num);
  const mKey = normalizeMsgKey(msg);
  if (!nKey || !mKey) return '';
  if (rawTs && !isRelativeTimestampStr(rawTs)) {
    const iso = normalizeIsoTimestamp(rawTs);
    // Minute precision protects against sub-second formatting variance across polls
    return `c:${md5(`${nKey}|${iso.slice(0, 16)}|${mKey}`)}`;
  }
  return '';
}
function buildSmsBodyKey(num, msg) {
  const nKey = normalizePhoneKey(num);
  const mKey = normalizeMsgKey(msg);
  if (!nKey || !mKey) return '';
  return `b:${md5(`${nKey}|${mKey}`)}`;
}

// Duplicate detection index (sms_id / ext_key / canonical content / recent body window)
const smsIdx = { set: new Set(), bodyLastTs: new Map(), len: -1, ref: null };
function smsIndexAddRow(r) {
  if (!r) return;
  if (r.ext_key) smsIdx.set.add('k:' + r.ext_key);
  if (r.sms_id) smsIdx.set.add('i:' + r.sms_id);
  const cKey = buildSmsContentKey(r.number, r.message, r.timestamp || r.date);
  if (cKey) smsIdx.set.add(cKey);
  const bKey = buildSmsBodyKey(r.number, r.message);
  if (bKey) {
    const tsMs = Date.parse(r.timestamp || r.date || '') || Date.now();
    const prev = smsIdx.bodyLastTs.get(bKey) || 0;
    if (tsMs > prev) smsIdx.bodyLastTs.set(bKey, tsMs);
  }
}
function smsIndexSync(log) {
  if (smsIdx.ref !== log || smsIdx.len !== log.length) {
    smsIdx.set = new Set();
    smsIdx.bodyLastTs = new Map();
    for (let i = 0; i < log.length; i++) {
      smsIndexAddRow(log[i]);
    }
    smsIdx.ref = log;
    smsIdx.len = log.length;
  }
}
function smsIndexHas(log, dedupeKey, smsId, { number = '', message = '', rawTimestamp = '', hasRealTimestamp = true } = {}) {
  smsIndexSync(log);
  if (dedupeKey && smsIdx.set.has('k:' + dedupeKey)) return true;
  if (smsId && smsIdx.set.has('i:' + smsId)) return true;
  if (number && message) {
    if (hasRealTimestamp && rawTimestamp) {
      const cKey = buildSmsContentKey(number, message, rawTimestamp);
      if (cKey && smsIdx.set.has(cKey)) return true;
    }
    const bKey = buildSmsBodyKey(number, message);
    if (bKey && smsIdx.bodyLastTs.has(bKey)) {
      const prevMs = smsIdx.bodyLastTs.get(bKey) || 0;
      const nowMs = Date.now();
      // If source omitted a real timestamp (or sent relative time like "2 mins ago"), block same number+message for 24h;
      // even with a timestamp, block identical number+message within 90s to stop clock-drift / multi-source dupes.
      const windowMs = hasRealTimestamp ? 90 * 1000 : 24 * 3600 * 1000;
      if (Math.abs(nowMs - prevMs) <= windowMs) return true;
    }
  }
  return false;
}
const periodStatsCache = new Map();
function appendSmsLog(entry, log) {
  smsIndexSync(log);
  log.unshift(entry);
  DB_CACHE.set('sms_log', log);
  smsIdx.ref = log;
  smsIdx.len = log.length;
  smsIndexAddRow(entry);
  periodStatsCache.clear();
  try { fs.appendFileSync(SMS_JOURNAL, JSON.stringify(entry) + '\n'); } catch (e) { console.error('SMS journal error:', e.message); }
  debouncedWriteDb('sms_log');
}
function recoverSmsJournal() {
  try {
    if (!fs.existsSync(SMS_JOURNAL)) return;
    const lines = fs.readFileSync(SMS_JOURNAL, 'utf-8').split('\n').filter(Boolean);
    if (!lines.length) return;
    const log = readDb('sms_log') || [];
    const haveId = new Set(log.map(r => r && r.id));
    smsIndexSync(log);
    let added = 0;
    for (const ln of lines) {
      let r; try { r = JSON.parse(ln); } catch (e) { continue; }
      if (!r || haveId.has(r.id)) continue;
      if (smsIndexHas(log, r.ext_key || '', r.sms_id || '', {
        number: r.number || '',
        message: r.message || '',
        rawTimestamp: r.timestamp || r.date || '',
        hasRealTimestamp: Boolean(r.timestamp || r.date)
      })) {
        continue;
      }
      log.unshift(r);
      haveId.add(r.id);
      smsIndexAddRow(r);
      smsIdx.len = log.length;
      added++;
    }
    log.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    writeDb('sms_log', log);
    if (added) console.log(`[HUMEX SMS] Recovered ${added} unique SMS from journal`);
  } catch (e) { console.error('Journal recovery error:', e); }
}
// Retention: rows older than SMS_RETENTION_DAYS move to data/archive/sms_log_YYYY-MM.json (never deleted)
function rotateSmsLog() {
  try {
    const log = readDb('sms_log');
    if (!Array.isArray(log) || !log.length) return;
    const cutoff = Date.now() - SMS_RETENTION_DAYS * 86400000;
    const keep = [], groups = new Map();
    for (const r of log) {
      const t = Date.parse(r && (r.timestamp || r.date));
      if (isFinite(t) && t < cutoff) { const k = new Date(t).toISOString().slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      else keep.push(r);
    }
    if (!groups.size) return;
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    for (const [month, rows] of groups) {
      const f = path.join(ARCHIVE_DIR, `sms_log_${month}.json`);
      let ex = []; try { ex = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) { ex = []; }
      const ids = new Set(ex.map(r => r.id)); for (const r of rows) if (!ids.has(r.id)) ex.push(r);
      ex.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      fs.writeFileSync(f + '.tmp', JSON.stringify(ex)); fs.renameSync(f + '.tmp', f);
    }
    writeDb('sms_log', keep); // only after every archive file is safely written
    console.log(`[HUMEX SMS] Archived ${log.length - keep.length} old SMS rows`);
  } catch (e) { console.error('SMS rotation error:', e); }
}
// Current log + archives (for payments / long reports)
const archiveFileCache = new Map();
function readArchivedJsonCached(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cached = archiveFileCache.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.data;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const data = Array.isArray(parsed) ? parsed : [];
    archiveFileCache.set(filePath, { mtime: stat.mtimeMs, data });
    return data;
  } catch (e) {
    return [];
  }
}

function readSmsWithArchive(fromDate) {
  const current = readDb('sms_log') || [];
  let archiveFiles = [];
  try {
    if (fs.existsSync(ARCHIVE_DIR)) {
      const fromMonth = fromDate ? String(fromDate).slice(0, 7) : '0000-00';
      const files = fs.readdirSync(ARCHIVE_DIR);
      archiveFiles = files.filter(f => {
        const m = /^sms_log_(\d{4}-\d{2})\.json$/.exec(f);
        return m && m[1] >= fromMonth;
      });
    }
  } catch (e) { /* ignore */ }

  if (!archiveFiles.length) {
    return current;
  }

  const out = current.slice();
  const seenIds = new Set();
  for (let i = 0; i < current.length; i++) {
    const r = current[i];
    if (r && r.id != null) seenIds.add(String(r.id));
  }
  for (const f of archiveFiles) {
    const archived = readArchivedJsonCached(path.join(ARCHIVE_DIR, f));
    for (let i = 0; i < archived.length; i++) {
      const r = archived[i];
      const idStr = r && r.id != null ? String(r.id) : null;
      if (!idStr || !seenIds.has(idStr)) {
        if (idStr) seenIds.add(idStr);
        out.push(r);
      }
    }
  }
  return out;
}
// Real traffic counters (no random numbers)
const recentSmsTs = [];
function noteSmsArrival() { const now = Date.now(); recentSmsTs.push(now); while (recentSmsTs.length && recentSmsTs[0] < now - 60000) recentSmsTs.shift(); }

let CACHED_SAMPLE_LOG = null;
let CACHED_SAMPLE_MTIME = 0;
let CACHED_SAMPLE_RATE = 0;

function liveTrafficStats() {
  const now = Date.now(); while (recentSmsTs.length && recentSmsTs[0] < now - 60000) recentSmsTs.shift();
  const last10 = recentSmsTs.filter(t => t >= now - 10000).length;
  const mtime = DB_MTIME.get('sms_log') || 0;
  if (!CACHED_SAMPLE_LOG || CACHED_SAMPLE_MTIME !== mtime) {
    const log = readDb('sms_log') || [];
    const sample = log.slice(0, 200);
    CACHED_SAMPLE_RATE = sample.length ? Math.round(sample.filter(r => r.status === 'delivered').length / sample.length * 100) : 0;
    CACHED_SAMPLE_LOG = sample;
    CACHED_SAMPLE_MTIME = mtime;
  }
  return { mps: Math.round(last10 / 10 * 10) / 10, per_minute: recentSmsTs.length, success_rate: CACHED_SAMPLE_RATE, dlr: CACHED_SAMPLE_RATE };
}


function logAudit(actor, action, details, module = 'General') {
  try {
    const logs = readDb('audit_logs');
    const arr = Array.isArray(logs) ? logs : [];
    arr.unshift({
      id: nextId(arr, 'audit_logs'),
      actor: actor || 'Owner',
      action: action || '',
      details: details || '',
      module: module || 'System',
      ip: '127.0.0.1',
      timestamp: new Date().toISOString()
    });
    if (arr.length > 500) arr.pop();
    writeDb('audit_logs', arr);
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

// ── Startup Safe Password Migration ─────────────────────────────
function migratePlaintextPasswords() {
  try {
    const tables = ['users', 'agents', 'clients'];
    for (const tbl of tables) {
      let rows = readDb(tbl);
      if (!Array.isArray(rows) || rows.length === 0) continue;
      let changed = false;
      rows = rows.map(r => {
        if (r && r.password && typeof r.password === 'string' && !r.password.startsWith('$2a$') && !r.password.startsWith('$2b$')) {
          changed = true;
          return { ...r, password: hashPassword(r.password) };
        }
        return r;
      });
      if (changed) {
        writeDb(tbl, rows);
      }
    }
  } catch (e) {
    console.error('Password migration error:', e);
  }
}
// ── Fresh DATA_DIR Auto-Bootstrap (for Clean VPS Installs) ──────
function bootstrapFreshDataDir() {
  try {
    const usersPath = path.join(DATA_DIR, 'users.json');
    let needOwnerSeed = !fs.existsSync(usersPath);
    if (!needOwnerSeed) {
      const existingUsers = readDb('users');
      if (!Array.isArray(existingUsers) || existingUsers.length === 0) {
        needOwnerSeed = true;
      }
    }
    if (needOwnerSeed) {
      const envPass = String(process.env.OWNER_INITIAL_PASSWORD || '').trim();
      const initialPass = envPass.length >= 6 ? envPass : crypto.randomBytes(12).toString('base64url');
      const now = new Date().toISOString();
      writeDb('users', [
        {
          id: 1,
          username: 'Kamran_Bhatti',
          password: hashPassword(initialPass),
          role: 'Owner',
          email: '',
          balance: 0,
          status: 'active',
          numbers: 0,
          created: now,
          notes: 'System Owner',
          updated_at: now
        }
      ]);
      if (envPass.length >= 6) {
        console.log('[BOOTSTRAP] Initialized fresh users.json for Owner (Kamran_Bhatti) using OWNER_INITIAL_PASSWORD.');
      } else {
        console.log('====================================================================');
        console.log('[BOOTSTRAP] Fresh database initialized!');
        console.log('[BOOTSTRAP] Owner Username: Kamran_Bhatti');
        console.log(`[BOOTSTRAP] Generated One-Time Password: ${initialPass}`);
        console.log('[BOOTSTRAP] Or change anytime via: node reset-owner-password.js "NewPass"');
        console.log('====================================================================');
      }
    }

    const settingsPath = path.join(DATA_DIR, 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      writeDb('settings', {
        site_name: 'HUMAX SMS',
        tagline: 'Wholesale SMS Termination Gateway',
        footer_text: '© 2026 HUMAX SMS. All rights reserved.',
        default_currency: 'USD',
        timezone: 'Asia/Karachi',
        payterms: ['Weekly', 'Monthly'],
        default_theme_key: 'cobalt_emerald',
        theme_mode: 'light',
        font_family: 'jakarta',
        logo_url: '/static/img/humex-sms-logo.png',
        two_fa_enabled: true,
        max_sessions: 3,
        session_timeout: 60
      });
    }

    const sessionsPath = path.join(DATA_DIR, 'sessions.json');
    if (!fs.existsSync(sessionsPath)) {
      atomicWriteFileSync(sessionsPath, JSON.stringify({}, null, 2));
    }
    const smsLogPath = path.join(DATA_DIR, 'sms_log.json');
    if (!fs.existsSync(smsLogPath)) {
      writeDb('sms_log', []);
    }
    if (!fs.existsSync(SMS_JOURNAL)) {
      fs.writeFileSync(SMS_JOURNAL, '', 'utf-8');
    }
  } catch (err) {
    console.error('[BOOTSTRAP] Error initializing fresh DATA_DIR:', err);
  }
}

bootstrapFreshDataDir();
migratePlaintextPasswords();
recoverSmsJournal();
rotateSmsLog();
{ const _t = setInterval(rotateSmsLog, 6 * 3600 * 1000); if (_t.unref) _t.unref(); }

let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[HUMEX SMS] Received ${signal}, shutting down gracefully...`);
  const forceExitTimer = setTimeout(() => {
    try { flushPendingWrites(); } catch (_) {}
    process.exit(0);
  }, 3500);
  if (forceExitTimer.unref) forceExitTimer.unref();

  try {
    if (typeof wss !== 'undefined' && wss && wss.clients) {
      wss.clients.forEach(client => {
        try { client.close(1001, 'Server restarting'); } catch (_) {}
      });
    }
  } catch (_) {}
  try {
    if (typeof savePersistedSessions === 'function') savePersistedSessions();
  } catch (_) {}
  try { flushPendingWrites(); } catch (_) {}
  try {
    server.close(() => {
      try { flushPendingWrites(); } catch (_) {}
      process.exit(0);
    });
  } catch (_) {
    process.exit(0);
  }
}
for (const _sig of ['SIGINT', 'SIGTERM']) process.on(_sig, () => gracefulShutdown(_sig));
process.on('exit', () => { try { flushPendingWrites(); } catch (e) { /* ignore */ } });

// ── Real-Time Sensitive Notification Engine (Role-Aware) ─────
const DEFAULT_NOTIFICATION_PREFS = {
  live_toast: true,
  sound_enabled: true,
  categories: {
    numbers: true,
    requests: true,
    payments: true,
    system: true
  }
};

function normalizeNotificationPrefs(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const cats = (src.categories && typeof src.categories === 'object') ? src.categories : {};
  return {
    live_toast: src.live_toast !== false,
    sound_enabled: src.sound_enabled !== false,
    categories: {
      numbers: cats.numbers !== false,
      requests: cats.requests !== false,
      payments: cats.payments !== false,
      system: cats.system !== false
    }
  };
}

function formatNotifPayterm(ptKey, isWn = false) {
  const k = String(ptKey || 'Weekly').trim().toLowerCase();
  if (isWn || k.includes('month') || k === '30/5' || k === 'monthly30_5') {
    return 'Monthly (30/5) {W}';
  }
  return 'Weekly (7/3)';
}

function cleanMoneyStr(val, maxDecimals = 4) {
  const num = Number(val);
  if (!Number.isFinite(num) || num === 0) return '0';
  const trimmed = num.toFixed(maxDecimals).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

function formatNotifRate(rate, currency = 'USD') {
  const num = Number(rate || 0);
  if (!Number.isFinite(num) || num <= 0) return '';
  const clean = cleanMoneyStr(num, 4);
  return currency === 'PKR' ? `Rs. ${clean}/SMS` : `$${clean}/SMS`;
}

function inferNotifCategory(type, explicitCategory) {
  if (explicitCategory && ['numbers', 'requests', 'payments', 'system'].includes(String(explicitCategory).toLowerCase())) {
    return String(explicitCategory).toLowerCase();
  }
  const t = String(type || '').toLowerCase();
  if (t === 'allocation' || t === 'revocation' || t === 'numbers') return 'numbers';
  if (t === 'request' || t === 'request_approved' || t === 'request_rejected') return 'requests';
  if (t === 'payout' || t === 'payment') return 'payments';
  return 'system';
}

function sendInstantNotification({
  recipient_role,
  recipient_id,
  recipient_username,
  title,
  message,
  type = 'info',
  category = '',
  action_page = '',
  payterm = '',
  rate_label = '',
  status = '',
  range_id = null,
  range_name = '',
  count = 0,
  actor_role = 'System',
  actor_name = 'System',
  metadata = {}
}) {
  try {
    let notifications = readDb('notifications');
    if (!Array.isArray(notifications)) notifications = [];

    const now = new Date().toISOString();
    const resolvedCategory = inferNotifCategory(type, category || metadata?.category);
    const mergedMeta = {
      ...(metadata || {}),
      category: resolvedCategory,
      ...(payterm ? { payterm } : {}),
      ...(rate_label ? { rate_label } : {}),
      ...(action_page ? { action_page } : {}),
      ...(status ? { status } : {})
    };
    const entry = {
      id: nextId(notifications, 'notifications'),
      recipient_role: recipient_role ? String(recipient_role).toLowerCase() : 'all',
      recipient_id: recipient_id ? Number(recipient_id) : null,
      recipient_username: recipient_username || '',
      title: title || 'Notification',
      message: message || '',
      body: message || '',
      type: type || 'info',
      category: resolvedCategory,
      action_page: action_page || mergedMeta.action_page || '',
      payterm: payterm || mergedMeta.payterm || '',
      rate_label: rate_label || mergedMeta.rate_label || '',
      status: status || mergedMeta.status || '',
      range_id: range_id ? Number(range_id) : null,
      range_name: range_name || '',
      count: Number(count) || 0,
      actor_role: actor_role || 'System',
      actor_name: actor_name || 'System',
      metadata: mergedMeta,
      read: false,
      created: now,
      timestamp: now
    };

    notifications.unshift(entry);
    if (notifications.length > 2000) notifications.pop();
    writeDb('notifications', notifications);

    // Broadcast in REAL-TIME over WebSockets (Instant within 1 second)
    broadcastWs({
      type: 'notification',
      notification: entry,
      data: entry,
      recipient_role: entry.recipient_role,
      recipient_id: entry.recipient_id,
      recipient_username: entry.recipient_username,
      title: entry.title,
      message: entry.message,
      category: entry.category,
      notif_type: entry.type,
      time: now
    });

    return entry;
  } catch (err) {
    console.error('sendInstantNotification error:', err);
    return null;
  }
}

// ── SMS Ingestion, Scraping & Polling Engine ───────────────────
function md5(str) {
  return crypto.createHash('md5').update(String(str || '')).digest('hex');
}

function detectApp(cli, message) {
  const text = `${cli || ''} ${message || ''}`.toLowerCase();
  if (/whatsapp|\bwa\b/i.test(text)) return 'WhatsApp';
  if (/telegram/i.test(text)) return 'Telegram';
  if (/google|gmail|g-|youtube/i.test(text)) return 'Google';
  if (/apple|icloud/i.test(text)) return 'Apple';
  if (/microsoft|msft|outlook|azure/i.test(text)) return 'Microsoft';
  if (/amazon|aws/i.test(text)) return 'Amazon';
  if (/facebook|meta|instagram|\big\b/i.test(text)) return 'Facebook';
  if (/tiktok/i.test(text)) return 'TikTok';
  if (/uber/i.test(text)) return 'Uber';
  if (/dhl/i.test(text)) return 'DHL';
  if (/netflix/i.test(text)) return 'Netflix';
  if (/twitter|\bx\b/i.test(text)) return 'Twitter';
  if (/binance/i.test(text)) return 'Binance';
  if (/snapchat/i.test(text)) return 'Snapchat';
  if (/imo/i.test(text)) return 'IMO';
  if (/viber/i.test(text)) return 'Viber';
  if (/tinder/i.test(text)) return 'Tinder';
  if (cli && /^[a-zA-Z]{3,15}$/.test(cli.trim())) return cli.trim();
  return 'General';
}

function detectCountry(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '—';
  if (digits.startsWith('1')) return 'United States';
  if (digits.startsWith('44')) return 'United Kingdom';
  if (digits.startsWith('7')) return 'Russia';
  if (digits.startsWith('33')) return 'France';
  if (digits.startsWith('49')) return 'Germany';
  if (digits.startsWith('91')) return 'India';
  if (digits.startsWith('92')) return 'Pakistan';
  if (digits.startsWith('86')) return 'China';
  if (digits.startsWith('211')) return 'South Sudan';
  if (digits.startsWith('212')) return 'Morocco';
  if (digits.startsWith('213')) return 'Algeria';
  if (digits.startsWith('216')) return 'Tunisia';
  if (digits.startsWith('218')) return 'Libya';
  if (digits.startsWith('220')) return 'Gambia';
  if (digits.startsWith('221')) return 'Senegal';
  if (digits.startsWith('222')) return 'Mauritania';
  if (digits.startsWith('223')) return 'Mali';
  if (digits.startsWith('224')) return 'Guinea';
  if (digits.startsWith('225')) return 'Ivory Coast';
  if (digits.startsWith('226')) return 'Burkina Faso';
  if (digits.startsWith('227')) return 'Niger';
  if (digits.startsWith('228')) return 'Togo';
  if (digits.startsWith('229')) return 'Benin';
  if (digits.startsWith('230')) return 'Mauritius';
  if (digits.startsWith('231')) return 'Liberia';
  if (digits.startsWith('232')) return 'Sierra Leone';
  if (digits.startsWith('233')) return 'Ghana';
  if (digits.startsWith('234')) return 'Nigeria';
  if (digits.startsWith('235')) return 'Chad';
  if (digits.startsWith('236')) return 'Central African Republic';
  if (digits.startsWith('237')) return 'Cameroon';
  if (digits.startsWith('240')) return 'Equatorial Guinea';
  if (digits.startsWith('241')) return 'Gabon';
  if (digits.startsWith('242')) return 'Congo';
  if (digits.startsWith('243')) return 'DR Congo';
  if (digits.startsWith('244')) return 'Angola';
  if (digits.startsWith('245')) return 'Guinea-Bissau';
  if (digits.startsWith('249')) return 'Sudan';
  if (digits.startsWith('250')) return 'Rwanda';
  if (digits.startsWith('251')) return 'Ethiopia';
  if (digits.startsWith('252')) return 'Somalia';
  if (digits.startsWith('253')) return 'Djibouti';
  if (digits.startsWith('254')) return 'Kenya';
  if (digits.startsWith('255')) return 'Tanzania';
  if (digits.startsWith('256')) return 'Uganda';
  if (digits.startsWith('257')) return 'Burundi';
  if (digits.startsWith('258')) return 'Mozambique';
  if (digits.startsWith('260')) return 'Zambia';
  if (digits.startsWith('261')) return 'Madagascar';
  if (digits.startsWith('263')) return 'Zimbabwe';
  if (digits.startsWith('264')) return 'Namibia';
  if (digits.startsWith('265')) return 'Malawi';
  if (digits.startsWith('27')) return 'South Africa';
  if (digits.startsWith('20')) return 'Egypt';
  if (digits.startsWith('966')) return 'Saudi Arabia';
  if (digits.startsWith('971')) return 'UAE';
  if (digits.startsWith('90')) return 'Turkey';
  if (digits.startsWith('55')) return 'Brazil';
  if (digits.startsWith('52')) return 'Mexico';
  if (digits.startsWith('62')) return 'Indonesia';
  if (digits.startsWith('880')) return 'Bangladesh';
  if (digits.startsWith('63')) return 'Philippines';
  if (digits.startsWith('84')) return 'Vietnam';
  if (digits.startsWith('380')) return 'Ukraine';
  if (digits.startsWith('31')) return 'Netherlands';
  if (digits.startsWith('32')) return 'Belgium';
  if (digits.startsWith('34')) return 'Spain';
  if (digits.startsWith('39')) return 'Italy';
  if (digits.startsWith('40')) return 'Romania';
  if (digits.startsWith('48')) return 'Poland';
  if (digits.startsWith('351')) return 'Portugal';
  return 'International';
}

function extractOtp(text) {
  if (!text) return '';
  const s = String(text).trim();
  const patterns = [
    // Prefix G-123456 or WA-123456, OTP-123456
    /\b(?:G|WA|FB|TG|OTP|PIN)-?(\d{4,8})\b/i,
    // Explicit prefix with colon/is: "code is: 123456", "code: 123456", "OTP: 123456", "PIN: 1234" (must contain at least one digit)
    /(?:verification\s*(?:code|pin)?|verify\s*code|otp|o\.t\.p|pin|password|passcode|secret\s*code|kod|kodunuz|codice|c[oó]digo|senha)\s*(?:is|est|ist|es|:|:=|=|-)?\s*[:\-\s]?\s*([0-9A-Za-z]*\d[0-9A-Za-z]*)\b/i,
    // Digits preceding "is your ... code/otp": "123456 is your Apple ID code", "<#> 136445 est votre code Facebook"
    /(?:^|[^\d])(\d{4,8})\s+(?:is\s+your|is\s+the|est\s+votre|es\s+tu|es\s+su|ist\s+ihr|ist\s+dein|to\s+verify|for\s+verification)\b/i,
    // Bracketed or quoted OTP: [123456], (123456), "123456", '123456'
    /[\[\(\'\"](\d{4,8})[\]\)\'\"]/,
    // Hyphenated code: 123-456 or 12-34-56
    /\b(\d{2,4}[\s\-]\d{2,4}(?:[\s\-]\d{2,4})?)\b/,
    // Any standalone 4 to 8 digits
    /\b(\d{4,8})\b/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m && m[1]) {
      const val = String(m[1]).trim();
      const digits = val.replace(/\D/g, '');
      if (digits.length >= 4 && digits.length <= 8) return digits;
      if (val.length >= 4 && val.length <= 8 && /\d/.test(val) && /^[0-9A-Za-z]+$/.test(val)) return val;
    }
  }
  return '';
}

function parseWhitenoiseTimestamp(raw) {
  if (!raw) return null;
  if (typeof raw === 'number' || /^\d{10,13}$/.test(String(raw).trim())) {
    const num = Number(raw);
    const ms = num < 1e11 ? num * 1000 : num;
    const d = new Date(ms);
    return !isNaN(d.getTime()) ? d.toISOString() : null;
  }
  const s = String(raw).trim();
  // Strict DD-MM-YYYY HH:mm:ss or DD/MM/YYYY HH:mm:ss BEFORE Date() so "05-12-2025 09:16:14" parses as Dec 5, not May 12
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    const year = parseInt(dmy[3], 10);
    const hour = parseInt(dmy[4] || '0', 10);
    const min = parseInt(dmy[5] || '0', 10);
    const sec = parseInt(dmy[6] || '0', 10);
    const d = new Date(Date.UTC(year, month, day, hour, min, sec));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function normalizeIsoTimestamp(raw) {
  if (!raw) return new Date().toISOString();
  if (typeof raw === 'number' || /^\d{10,13}$/.test(String(raw).trim())) {
    const num = Number(raw);
    const ms = num < 1e11 ? num * 1000 : num;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  let s = String(raw).trim();
  const dmyIso = parseWhitenoiseTimestamp(s);
  if (dmyIso) return dmyIso;

  let d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  if (s.includes(' ')) s = s.replace(' ', 'T');
  d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  return new Date().toISOString();
}

function extractDateStr(s) {
  if (!s) return '';
  if (typeof s === 'string') {
    const raw = s.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    if (/^\d{10,13}$/.test(raw)) {
      const ms = Number(raw) < 1e11 ? Number(raw) * 1000 : Number(raw);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return raw.slice(0, 10);
  }
  const raw = String(s.date || s.timestamp || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{10,13}$/.test(raw)) {
    const ms = Number(raw) < 1e11 ? Number(raw) * 1000 : Number(raw);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

function getDateRangeBuckets() {
  const now = new Date();
  const utcToday = now.toISOString().slice(0, 10);
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todaySet = new Set([utcToday, localToday]);

  const yestUtc = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const yestLocalObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestLocal = `${yestLocalObj.getFullYear()}-${String(yestLocalObj.getMonth() + 1).padStart(2, '0')}-${String(yestLocalObj.getDate()).padStart(2, '0')}`;
  const yesterdaySet = new Set([yestUtc, yestLocal]);
  yesterdaySet.delete(utcToday);
  yesterdaySet.delete(localToday);

  // Standardize week/month/year boundaries on UTC Monday 00:00 (Monday 05:00 AM PKT)
  // matching getAgentClientWeeklyPkrStats and period-stats so server TZ never causes drift.
  const utcDayOfWeek = (now.getUTCDay() + 6) % 7;
  const startOfWeekUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - utcDayOfWeek));
  const weekStartStr = startOfWeekUtc.toISOString().slice(0, 10);

  const monthStartStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const yearStartStr = `${now.getUTCFullYear()}-01-01`;

  return { todaySet, yesterdaySet, weekStartStr, monthStartStr, yearStartStr, now, todayStr: utcToday, yesterdayStr: yestUtc };
}

function parseRateValue(val) {
  if (val === undefined || val === null || val === '' || typeof val === 'boolean') return undefined;
  if (typeof val === 'number') return Number.isFinite(val) && val >= 0 ? val : undefined;
  let s = String(val).trim();
  if (!s || /^(-|—|n\/?a|null|undefined)$/i.test(s)) return undefined;
  if (!s.includes('.') && /^[+-]?[$€£¥₹]?\s*\d+,\d+(?:\s*[A-Za-z]{0,5})?$/.test(s)) {
    s = s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const m = s.match(/[-+]?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const num = parseFloat(m[0]);
  return Number.isFinite(num) && num >= 0 ? num : undefined;
}

function isLikelyRateToken(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 && raw <= 50;
  const s = String(raw ?? '').trim();
  if (!s || s.length > 24) return false;
  if (/\d{4}-\d{2}-\d{2}|:\d{2}|\d+\.\d+\.\d+\.\d+/.test(s)) return false;
  if (/^\+?\d{6,}$/.test(s.replace(/[\s()-]/g, ''))) return false;
  const num = parseRateValue(s);
  return num !== undefined && num >= 0 && num <= 50;
}

function extractCrApiRate(row) {
  if (!row) return undefined;
  if (Array.isArray(row)) {
    if (row.length === 5 && /^\+?\d{6,16}$/.test(String(row[1] || '').trim().replace(/[\s()-]/g, '')) && isLikelyRateToken(row[4])) {
      return parseRateValue(row[4]);
    }
    for (let i = 5; i < row.length; i++) {
      if (isLikelyRateToken(row[i])) {
        const val = parseRateValue(row[i]);
        if (val !== undefined && val > 0) return val;
      }
    }
    for (let i = 5; i < row.length; i++) {
      if (isLikelyRateToken(row[i])) {
        const val = parseRateValue(row[i]);
        if (val !== undefined) return val;
      }
    }
    return undefined;
  }
  if (typeof row === 'object') {
    const keys = [
      'company_rate', 'company_payout', 'my_payout', 'payout', 'payout_rate',
      'rate', 'price', 'cost', 'amount', 'sms_rate', 'carrier_rate',
      'buy_rate', 'sell_rate', 'client_payout', 'agent_payout',
      'earning', 'revenue', 'usd', 'fee', 'value'
    ];
    let zeroFallback;
    const lowerMap = new Map();
    for (const k of Object.keys(row)) {
      lowerMap.set(k.toLowerCase(), row[k]);
    }
    for (const k of keys) {
      const rawVal = row[k] !== undefined ? row[k] : lowerMap.get(k);
      const parsed = parseRateValue(rawVal);
      if (parsed !== undefined) {
        if (parsed > 0) return parsed;
        if (zeroFallback === undefined) zeroFallback = parsed;
      }
    }
    return zeroFallback;
  }
  return undefined;
}

function getRangeCompanyCost(rng) {
  if (!rng) return 0;
  const candidates = [rng.company_cost, rng.cost, rng.buy_rate, rng.carrier_rate, rng.company_rate];
  for (const c of candidates) {
    const v = parseRateValue(c);
    if (v !== undefined && v > 0) return v;
  }
  return 0;
}

// ── Master 2-Payterm System (Weekly 7/3 for standard, Monthly 30/5 {W} for Whitenoise) ──
const DEFAULT_PAYTERMS = ['Weekly', 'Monthly'];

const PAYTERM_DEFINITIONS = {
  Weekly: {
    key: 'Weekly',
    code: '7/3',
    label: 'Weekly (7/3)',
    cycle_days: 7,
    hold_days: 3,
    schedule: 'weekly7_3',
    description: 'Weekly payment · 3 day hold'
  },
  Monthly: {
    key: 'Monthly',
    code: '30/5 {W}',
    label: 'Monthly (30/5) {W}',
    cycle_days: 30,
    hold_days: 5,
    schedule: 'monthly30_5',
    description: 'Monthly payment · 5 day hold'
  }
};

function getPaytermMeta(term) {
  const norm = normalizePaytermKey(term || 'Weekly');
  if (PAYTERM_DEFINITIONS[norm]) return PAYTERM_DEFINITIONS[norm];
  return PAYTERM_DEFINITIONS.Weekly;
}

function getMasterPayterms() {
  try {
    const settings = readDb('settings');
    if (settings && Array.isArray(settings.payterms) && settings.payterms.length > 0) {
      const cleaned = Array.from(new Set(
        settings.payterms.map(p => normalizePaytermKey(String(p || '').trim())).filter(p => p && p !== 'Biweekly')
      ));
      if (cleaned.length > 0) return cleaned;
    }
  } catch (e) {}
  return [...DEFAULT_PAYTERMS];
}

function normalizePaytermKey(k) {
  if (!k || typeof k !== 'string') return k;
  const s = k.trim();
  const sl = s.toLowerCase().replace(/\s+/g, ' ');
  if (sl === 'weekly' || sl === '7/3' || sl === 'weekly 7/3' || sl === 'weekly (7/3)' || sl === 'weekly7_3') return 'Weekly';
  if (sl === 'monthly' || sl === '30/5' || sl === '30/5 {w}' || sl === 'monthly 30/5' || sl === 'monthly (30/5)' || sl === 'monthly 30/5 {w}' || sl === 'monthly (30/5) {w}' || sl === 'monthly30_5') return 'Monthly';
  return s;
}

function migrateLegacyPayterm(k) {
  if (!k || typeof k !== 'string') return 'Weekly';
  const norm = normalizePaytermKey(k);
  if (DEFAULT_PAYTERMS.includes(norm)) return norm;
  const sl = k.trim().toLowerCase();
  if (['1/1', '7/1', '7/7', 'daily', 'weekly (7/1)', 'biweekly', 'bi-weekly', 'bi weekly', '15/3', 'biweekly 15/3', 'biweekly (15/3)', 'biweekly15_3', '15/1', '15/15', '15/30'].includes(sl)) return 'Weekly';
  if (['30/1', '30/15', '30/30', '30/45', '30/60', 'monthly60', 'monthly10', '30/10', 'monthly (30/30)', 'monthly (10th fixed)', 'monthly10 (10th fixed)', '10th'].includes(sl)) return 'Monthly';
  return norm;
}

function isValidPayterm(term) {
  if (!term || typeof term !== 'string') return false;
  const s = term.trim();
  const sl = s.toLowerCase();
  if (sl.includes('biweek') || sl === '15/3' || sl === 'biweekly15_3') return false;
  const list = getMasterPayterms();
  const norm = normalizePaytermKey(s);
  return list.includes(s) || list.includes(norm);
}

function runPaytermMigration() {
  try {
    // 1. Settings -> clean up legacy & Biweekly payterms to active Weekly & Monthly terms
    let settings = readDb('settings');
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
    let settingsChanged = false;
    if (!settings.payterms || !Array.isArray(settings.payterms) || settings.payterms.length === 0) {
      settings.payterms = [...DEFAULT_PAYTERMS];
      settingsChanged = true;
    } else {
      const migrated = Array.from(new Set(
        settings.payterms
          .map(migrateLegacyPayterm)
          .filter(k => k && k !== 'Biweekly')
      ));
      const finalTerms = migrated.length ? migrated : [...DEFAULT_PAYTERMS];
      if (!finalTerms.includes('Weekly')) finalTerms.unshift('Weekly');
      if (!finalTerms.includes('Monthly')) finalTerms.push('Monthly');
      if (JSON.stringify(finalTerms) !== JSON.stringify(settings.payterms)) {
        settings.payterms = finalTerms;
        settingsChanged = true;
      }
    }
    if (settingsChanged) writeDb('settings', settings);

    // 2. SMS Ranges -> enforce Whitenoise = Monthly only, Non-Whitenoise = Weekly only, remove Biweekly
    let ranges = readDb('sms_ranges') || [];
    let rangesChanged = false;
    const wnTags = getWhitenoiseProviderTags();
    ranges.forEach(r => {
      const isWn = isWhitenoiseRecord(r, null, wnTags);
      const ptInfo = resolveRangeActivePayterms(r, isWn);
      const ptMeta = getPaytermMeta(ptInfo.primary_payterm);
      if (
        r.payterm !== ptMeta.key ||
        r.payout_schedule !== ptMeta.schedule ||
        JSON.stringify(r.active_payterms || []) !== JSON.stringify(ptInfo.active_payterms) ||
        JSON.stringify(r.payterms || {}) !== JSON.stringify(ptInfo.payterms)
      ) {
        r.payterm = ptMeta.key;
        r.active_payterms = ptInfo.active_payterms;
        r.payterms = ptInfo.payterms;
        r.payout_schedule = ptMeta.schedule;
        r.cycle_days = ptMeta.cycle_days;
        r.hold_days = ptMeta.hold_days;
        if (isWn) r.is_whitenoise = true;
        rangesChanged = true;
      }
    });
    if (rangesChanged) writeDb('sms_ranges', ranges);

    // 3. Numbers -> migrate payterm & client_payterm cleanly (strip Biweekly -> Weekly)
    let numbers = readDb('numbers') || [];
    let numbersChanged = false;
    numbers.forEach(n => {
      if (n.payterm) {
        const norm = migrateLegacyPayterm(n.payterm);
        if (norm !== n.payterm) { n.payterm = norm; numbersChanged = true; }
      }
      if (n.client_payterm) {
        const norm = migrateLegacyPayterm(n.client_payterm);
        if (norm !== n.client_payterm) { n.client_payterm = norm; numbersChanged = true; }
      }
    });
    if (numbersChanged) writeDb('numbers', numbers);
  } catch (err) {
    console.error('Payterm migration error:', err);
  }
}

function getRangeAgentRate(rng, payterm = 'Weekly') {
  if (!rng) return 0;
  const normPt = normalizePaytermKey(payterm);
  if (rng.payterms && typeof rng.payterms === 'object') {
    if (rng.payterms[normPt] !== undefined && rng.payterms[normPt] !== 'NA' && !isNaN(Number(rng.payterms[normPt]))) {
      return Number(rng.payterms[normPt]);
    }
    if (rng.payterms[payterm] !== undefined && rng.payterms[payterm] !== 'NA' && !isNaN(Number(rng.payterms[payterm]))) {
      return Number(rng.payterms[payterm]);
    }
    if (normPt === 'Weekly') {
      const v = rng.payterms['Weekly'] ?? rng.payterms['7/3'];
      if (v !== undefined && v !== 'NA' && !isNaN(Number(v))) return Number(v);
    }
    if (normPt === 'Monthly') {
      const v = rng.payterms['Monthly'] ?? rng.payterms['30/5'] ?? rng.payterms['Weekly'];
      if (v !== undefined && v !== 'NA' && !isNaN(Number(v))) return Number(v);
    }
    if (rng.payterms['Weekly'] !== undefined && rng.payterms['Weekly'] !== 'NA' && !isNaN(Number(rng.payterms['Weekly']))) {
      return Number(rng.payterms['Weekly']);
    }
    for (const v of Object.values(rng.payterms)) {
      if (v !== 'NA' && v !== undefined && v !== null && !isNaN(Number(v)) && Number(v) > 0) {
        return Number(v);
      }
    }
  }
  if (rng.payout !== undefined && rng.payout !== null && !isNaN(Number(rng.payout))) return Number(rng.payout);
  if (rng.sell_rate !== undefined && rng.sell_rate !== null && !isNaN(Number(rng.sell_rate))) return Number(rng.sell_rate);
  return 0;
}

// Resolve strictly configured payterms on a range (Owner -> Agent -> Client).
// Strict Business Rule:
//   - Whitenoise ranges -> ONLY Monthly (30/5) {W}
//   - Standard (non-Whitenoise) ranges -> ONLY Weekly (7/3)
//   - Biweekly (15/3) is permanently removed.
function resolveRangeActivePayterms(rng, isWnOverride = null) {
  if (!rng || typeof rng !== 'object') {
    return { active_payterms: ['Weekly'], primary_payterm: 'Weekly', payterms: {} };
  }
  const wnTags = getWhitenoiseProviderTags();
  const isWn = isWnOverride !== null ? Boolean(isWnOverride) : isWhitenoiseRecord(rng, null, wnTags);
  const readNum = (v) => {
    if (v === null || v === undefined || v === '' || v === 'NA' || v === 'N/A') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const srcPts = (rng.payterms && typeof rng.payterms === 'object') ? rng.payterms : {};
  const rawW = readNum(srcPts['Weekly'] !== undefined ? srcPts['Weekly'] : srcPts['7/3']);
  const rawM = readNum(srcPts['Monthly'] !== undefined ? srcPts['Monthly'] : srcPts['30/5']);
  const fallbackRate = readNum(rng.payout) ?? readNum(rng.rate) ?? readNum(rng.sell_rate) ?? 0;

  if (isWn) {
    const mRate = rawM !== null ? rawM : (rawW !== null ? rawW : fallbackRate);
    return {
      active_payterms: ['Monthly'],
      primary_payterm: 'Monthly',
      payterms: { Monthly: mRate }
    };
  }

  const wRate = rawW !== null ? rawW : (rawM !== null ? rawM : fallbackRate);
  return {
    active_payterms: ['Weekly'],
    primary_payterm: 'Weekly',
    payterms: { Weekly: wRate }
  };
}

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;
const round4 = v => Math.round((Number(v) || 0) * 10000) / 10000;
const round6 = v => Math.round((Number(v) || 0) * 1000000) / 1000000;

function getUsdToPkrRate() {
  const settings = readDb('settings');
  if (settings && !Array.isArray(settings)) {
    const r = Number(settings.usd_to_pkr_rate);
    if (Number.isFinite(r) && r > 0) return r;
  }
  return 280;
}

function getMinPayoutPkr() {
  const settings = readDb('settings');
  if (settings && !Array.isArray(settings)) {
    if (settings.min_payout_pkr !== undefined && settings.min_payout_pkr !== null && settings.min_payout_pkr !== '') {
      const mp = Number(settings.min_payout_pkr);
      if (Number.isFinite(mp) && mp >= 0) return round2(mp);
    }
    const usdMin = Number(settings.min_payout || 0);
    if (Number.isFinite(usdMin) && usdMin > 0) {
      return round2(usdMin * getUsdToPkrRate());
    }
  }
  return 0;
}

function safeClientForOwner(c) {
  if (!c || typeof c !== 'object') return c;
  return {
    id: c.id,
    username: c.username,
    role: c.role || 'Client',
    agent_id: c.agent_id ?? null,
    agent_username: c.agent_username || '',
    status: c.status || 'active',
    created: c.created || c.created_at || c.timestamp || '',
    created_at: c.created_at || c.created || c.timestamp || '',
    two_fa_enabled: Boolean(c.two_fa_enabled || c.two_fa),
    alloc_mode: c.alloc_mode || null,
    alloc_daily_limit: c.alloc_daily_limit ?? null,
    alloc_total_limit: c.alloc_total_limit ?? null,
    whitenoise_access: Boolean(c.whitenoise_access),
    app_links_access: Boolean(c.app_links_access),
    privacy_redacted: true
  };
}

// ── Whitenoise Isolation, Permission & Monthly10 Helpers ──────────
function isWhitenoiseText(val) {
  return typeof val === 'string' && /whitenoise/i.test(val);
}

function getWhitenoiseProviderTags() {
  const conns = readDb('whitenoise_connections') || [];
  const tags = new Set(['whitenoise']);
  if (Array.isArray(conns)) {
    for (const c of conns) {
      if (!c) continue;
      if (c.provider_tag) tags.add(String(c.provider_tag).trim().toLowerCase());
      if (c.name) tags.add(String(c.name).trim().toLowerCase());
    }
  }
  return tags;
}

function buildRangesLookupMap() {
  const ranges = readDb('sms_ranges') || [];
  const map = new Map();
  for (const r of ranges) {
    if (!r) continue;
    if (r.id != null) map.set(`id:${Number(r.id)}`, r);
    const rn = String(r.range_name || r.name || '').trim().toLowerCase();
    if (rn) map.set(`name:${rn}`, r);
  }
  return map;
}

function normalizeYmd(val) {
  const s = String(val || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function addDaysYmd(ymd, days) {
  const clean = normalizeYmd(ymd);
  if (!clean) return null;
  const dt = new Date(`${clean}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + (parseInt(days, 10) || 0));
  return dt.toISOString().slice(0, 10);
}

function getDefaultMonthlyCycle(refDate = new Date()) {
  const y = refDate.getUTCFullYear();
  const m = refDate.getUTCMonth();
  const startDt = new Date(Date.UTC(y, m, 1));
  const endDt = new Date(Date.UTC(y, m + 1, 0));
  const clearDt = new Date(Date.UTC(y, m + 1, 5));
  const start_date = startDt.toISOString().slice(0, 10);
  const end_date = endDt.toISOString().slice(0, 10);
  const clear_date = clearDt.toISOString().slice(0, 10);
  return {
    start_date,
    end_date,
    clear_date,
    label: `${start_date} to ${end_date}`
  };
}

function normalizeMonthlyCycleInput(raw, fallbackRef = new Date()) {
  const def = getDefaultMonthlyCycle(fallbackRef);
  if (!raw || typeof raw !== 'object') return def;
  const start_date = normalizeYmd(raw.start_date) || def.start_date;
  let end_date = normalizeYmd(raw.end_date) || def.end_date;
  if (end_date < start_date) end_date = start_date;
  let clear_date = normalizeYmd(raw.clear_date) || addDaysYmd(end_date, 5) || def.clear_date;
  if (clear_date < end_date) clear_date = end_date;
  const label = String(raw.label || '').trim() || `${start_date} to ${end_date}`;
  return { start_date, end_date, clear_date, label };
}

function getMonthlyCycleConfig(refDate = new Date()) {
  const settings = readDb('settings');
  const raw = (settings && !Array.isArray(settings) && settings.monthly_cycle) ? settings.monthly_cycle : null;
  const cfg = normalizeMonthlyCycleInput(raw, refDate);
  const todayYmd = refDate.toISOString().slice(0, 10);
  return {
    ...cfg,
    is_cleared_window: todayYmd >= cfg.clear_date
  };
}

function computeMonthlyClearIso(timestampIso, refDate = new Date()) {
  const cfg = getMonthlyCycleConfig(refDate);
  const tsStr = String(timestampIso || '').trim();
  const tsYmd = normalizeYmd(tsStr.replace('T', ' ').slice(0, 10)) || refDate.toISOString().slice(0, 10);
  if (tsYmd >= cfg.start_date && tsYmd <= cfg.end_date) {
    return `${cfg.clear_date}T00:00:00.000Z`;
  }
  const dt = new Date(`${tsYmd}T00:00:00.000Z`);
  if (!Number.isNaN(dt.getTime())) {
    const clearDt = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 5));
    return clearDt.toISOString();
  }
  return `${cfg.clear_date}T00:00:00.000Z`;
}

function phoneDigitsVariantsMatch(storedRaw, queryRaw) {
  const stored = String(storedRaw || '').replace(/\D/g, '');
  const q = String(queryRaw || '').replace(/\D/g, '');
  if (!stored || !q) return false;
  if (stored === q || stored.includes(q)) return true;
  const qNo00 = q.replace(/^00+/, '');
  const qNo0 = qNo00.replace(/^0+/, '');
  if (qNo00.length >= 6 && (stored === qNo00 || stored.endsWith(qNo00) || stored.includes(qNo00))) return true;
  if (qNo0.length >= 6 && (stored === qNo0 || stored.endsWith(qNo0) || stored.includes(qNo0))) return true;
  const sNo0 = stored.replace(/^0+/, '');
  if (sNo0.length >= 6 && qNo0.length >= 6 && (sNo0.endsWith(qNo0) || qNo0.endsWith(sNo0))) return true;
  return false;
}

function maskProviderLabel(val, isOwner = false, wnTags = null) {
  const str = String(val || '');
  if (isOwner) return str;
  const trimmed = str.trim();
  if (!trimmed) return '';
  const tags = wnTags || getWhitenoiseProviderTags();
  if (isWhitenoiseText(trimmed) || tags.has(trimmed.toLowerCase())) {
    return 'Carrier 2';
  }
  return str;
}

function scrubWhitenoiseName(val, isOwner = false) {
  const str = String(val || '');
  if (isOwner || !str) return str;
  return str.replace(/whitenoise/ig, 'Monthly');
}

function sanitizeNumberForRole(numObj, isOwner = false, wnTags = null) {
  if (!numObj || typeof numObj !== 'object' || isOwner) return numObj;
  const copy = { ...numObj };
  const tags = wnTags || getWhitenoiseProviderTags();
  if (copy.provider) copy.provider = maskProviderLabel(copy.provider, false, tags);
  if (copy.company) copy.company = maskProviderLabel(copy.company, false, tags);
  if (copy.source && isWhitenoiseText(copy.source)) copy.source = 'monthly_route';
  if (copy.range_name) copy.range_name = scrubWhitenoiseName(copy.range_name, false);
  if (copy.range_label) copy.range_label = scrubWhitenoiseName(copy.range_label, false);
  if (copy.range) copy.range = scrubWhitenoiseName(copy.range, false);
  if (copy.panel_name && (isWhitenoiseText(copy.panel_name) || tags.has(String(copy.panel_name).trim().toLowerCase()))) {
    copy.panel_name = 'Carrier 2';
  }
  return copy;
}

function isWhitenoiseRecord(obj, rangesMap = null, wnTags = null) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.is_whitenoise === true) return true;
  if (String(obj.source || '').trim().toLowerCase() === 'whitenoise') return true;
  if (obj.whitenoise_sms_id != null && obj.whitenoise_sms_id !== '') return true;
  const tags = wnTags || getWhitenoiseProviderTags();
  const candidates = [obj.provider, obj.panel_name, obj.range_name, obj.range_label, obj.range, obj.name];
  for (const c of candidates) {
    const s = String(c || '').trim().toLowerCase();
    if (!s) continue;
    if (s.includes('whitenoise') || tags.has(s)) return true;
  }
  if (rangesMap) {
    let linked = null;
    if (obj.range_id != null) linked = rangesMap.get(`id:${Number(obj.range_id)}`);
    if (!linked && (obj.range_name || obj.range)) {
      linked = rangesMap.get(`name:${String(obj.range_name || obj.range).trim().toLowerCase()}`);
    }
    if (linked && linked !== obj) {
      return isWhitenoiseRecord(linked, null, tags);
    }
  }
  return false;
}

function hasWhitenoiseAccess(userOrRef) {
  if (!userOrRef) return false;
  const role = normRole(userOrRef.role);
  if (role === 'owner') return true;
  if (role === 'agent') {
    const agents = readDb('agents') || [];
    const ag = agents.find(a => Number(a.id) === Number(userOrRef.id) || (userOrRef.username && String(a.username || '').toLowerCase() === String(userOrRef.username).toLowerCase()));
    return Boolean(ag ? ag.whitenoise_access : userOrRef.whitenoise_access);
  }
  if (role === 'client') {
    const clients = readDb('clients') || [];
    const cl = clients.find(c => Number(c.id) === Number(userOrRef.id) || (userOrRef.username && String(c.username || '').toLowerCase() === String(userOrRef.username).toLowerCase()));
    if (!cl || !cl.whitenoise_access) return false;
    const agId = cl.agent_id || userOrRef.agent_id;
    if (agId) {
      const agents = readDb('agents') || [];
      const ag = agents.find(a => Number(a.id) === Number(agId));
      if (!ag || !ag.whitenoise_access) return false;
    }
    return true;
  }
  return false;
}

function hasAppLinksAccess(userOrRef) {
  if (!userOrRef) return false;
  const role = normRole(userOrRef.role);
  if (role === 'owner') return true;
  if (role === 'agent') {
    const agents = readDb('agents') || [];
    const ag = agents.find(a => Number(a.id) === Number(userOrRef.id) || (userOrRef.username && String(a.username || '').toLowerCase() === String(userOrRef.username).toLowerCase()));
    return Boolean(ag ? ag.app_links_access : userOrRef.app_links_access);
  }
  if (role === 'client') {
    const clients = readDb('clients') || [];
    const cl = clients.find(c => Number(c.id) === Number(userOrRef.id) || (userOrRef.username && String(c.username || '').toLowerCase() === String(userOrRef.username).toLowerCase()));
    if (!cl || !cl.app_links_access) return false;
    const agId = cl.agent_id || userOrRef.agent_id;
    if (agId) {
      const agents = readDb('agents') || [];
      const ag = agents.find(a => Number(a.id) === Number(agId));
      if (!ag || !ag.app_links_access) return false;
    }
    return true;
  }
  return false;
}

function hasLiveAccess(userOrRef) {
  if (!userOrRef) return false;
  const role = normRole(userOrRef.role);
  if (role === 'owner') return true;
  const cfg = readDb('settings') || {};
  if (role === 'agent') return Boolean(cfg.live_access_agents_enabled);
  if (role === 'client') return Boolean(cfg.live_access_clients_enabled);
  return false;
}

function maskOtpInSmsBody(rawMessage, knownOtp = '') {
  let text = String(rawMessage || '');
  if (!text) return '';
  const otpStr = String(knownOtp || '').trim();
  if (otpStr && otpStr.length >= 3) {
    const escaped = otpStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const maskStr = 'X'.repeat(Math.max(3, otpStr.length));
    text = text.replace(new RegExp(escaped, 'gi'), maskStr);
    const digitsOnly = otpStr.replace(/\D/g, '');
    if (digitsOnly.length >= 4 && digitsOnly !== otpStr) {
      text = text.replace(new RegExp(digitsOnly, 'g'), 'X'.repeat(digitsOnly.length));
    }
  }
  // Mask hyphenated / spaced verification codes like 123-456 or 123 456
  text = text.replace(/\b(\d{3})([-\s])(\d{3})\b/g, 'XXX$2XXX');
  // Mask prefix codes like G-123456 or OTP-123456
  text = text.replace(/\b([A-Za-z]{1,4}-)(\d{4,8})\b/g, (_, pfx, digs) => pfx + 'X'.repeat(digs.length));
  // Mask standalone 4-8 digit codes (OTP / PIN / verification numbers)
  text = text.replace(/(^|[^\d])(\d{4,8})(?!\d)/g, (_, lead, digs) => lead + 'X'.repeat(digs.length));
  return text;
}

function computeUserHoldSummary(smsList, role, fxRate = 280, refDate = new Date()) {
  const nowMs = refDate.getTime();
  const sRole = normRole(role);
  const monthlyCfg = getMonthlyCycleConfig(refDate);
  const byTerm = {
    Weekly: { ...PAYTERM_DEFINITIONS.Weekly, sms_count: 0, cleared_usd: 0, held_usd: 0, cleared_pkr: 0, held_pkr: 0, next_release_at: null },
    Monthly: { ...PAYTERM_DEFINITIONS.Monthly, sms_count: 0, cleared_usd: 0, held_usd: 0, cleared_pkr: 0, held_pkr: 0, next_release_at: null }
  };
  let clearedUsd = 0, heldUsd = 0, clearedPkr = 0, heldPkr = 0;
  let wnUsd = 0, wnHeldUsd = 0, wnClearedUsd = 0, wnPkr = 0, wnHeldPkr = 0, wnClearedPkr = 0;
  let wnSmsCount = 0;
  let nextReleaseMs = null;

  for (const s of (smsList || [])) {
    if (!s) continue;
    const isWn = Boolean(
      s.is_whitenoise ||
      String(s.source || '').toLowerCase() === 'whitenoise' ||
      String(s.provider || '').toLowerCase().includes('whitenoise') ||
      String(s.payout_schedule || '').toLowerCase() === 'monthly30_5'
    );
    const rawPt = isWn ? 'Monthly' : migrateLegacyPayterm(s.payterm || s.payterms || 'Weekly');
    const ptKey = PAYTERM_DEFINITIONS[rawPt] ? rawPt : 'Weekly';
    const meta = PAYTERM_DEFINITIONS[ptKey];

    const amtUsd = sRole === 'client'
      ? (Number(s.client_amount) || 0)
      : (sRole === 'agent' ? (Number(s.agent_amount) || 0) : (Number(s.owner_amount) || 0));
    const amtPkr = sRole === 'client'
      ? (s.client_amount_pkr != null ? Number(s.client_amount_pkr) : amtUsd * (Number(s.fx_usd_to_pkr) || fxRate))
      : amtUsd * fxRate;

    const tsMs = s.timestamp ? new Date(s.timestamp).getTime() : nowMs;
    const tsYmd = normalizeYmd(String(s.timestamp || s.date || '').replace('T', ' ').slice(0, 10));
    let clearsMs;
    if (isWn || ptKey === 'Monthly') {
      if (tsYmd && tsYmd >= monthlyCfg.start_date && tsYmd <= monthlyCfg.end_date) {
        clearsMs = new Date(`${monthlyCfg.clear_date}T00:00:00.000Z`).getTime();
      } else {
        clearsMs = s.clears_at ? new Date(s.clears_at).getTime() : new Date(computeMonthlyClearIso(s.timestamp || s.date, refDate)).getTime();
      }
    } else {
      clearsMs = s.clears_at ? new Date(s.clears_at).getTime() : ((Number.isFinite(tsMs) ? tsMs : nowMs) + meta.hold_days * 86400000);
    }
    const isCleared = nowMs >= clearsMs;

    const rowWeight = (s.sms_count != null && Number(s.sms_count) > 0) ? Math.round(Number(s.sms_count)) : 1;
    const b = byTerm[ptKey];
    b.sms_count += rowWeight;
    if (isCleared) {
      clearedUsd += amtUsd;
      clearedPkr += amtPkr;
      b.cleared_usd += amtUsd;
      b.cleared_pkr += amtPkr;
      if (isWn) { wnClearedUsd += amtUsd; wnClearedPkr += amtPkr; }
    } else {
      heldUsd += amtUsd;
      heldPkr += amtPkr;
      b.held_usd += amtUsd;
      b.held_pkr += amtPkr;
      if (isWn) { wnHeldUsd += amtUsd; wnHeldPkr += amtPkr; }
      const relIso = new Date(clearsMs).toISOString();
      if (!b.next_release_at || relIso < b.next_release_at) b.next_release_at = relIso;
      if (nextReleaseMs === null || clearsMs < nextReleaseMs) nextReleaseMs = clearsMs;
    }
    if (isWn) {
      wnSmsCount += rowWeight;
      wnUsd += amtUsd;
      wnPkr += amtPkr;
    }
  }

  for (const k of Object.keys(byTerm)) {
    byTerm[k].cleared_usd = round4(byTerm[k].cleared_usd);
    byTerm[k].held_usd = round4(byTerm[k].held_usd);
    byTerm[k].cleared_pkr = round2(byTerm[k].cleared_pkr);
    byTerm[k].held_pkr = round2(byTerm[k].held_pkr);
  }

  return {
    cleared_usd: round4(clearedUsd),
    held_usd: round4(heldUsd),
    cleared_pkr: round2(clearedPkr),
    held_pkr: round2(heldPkr),
    whitenoise_usd: round4(wnUsd),
    whitenoise_held_usd: round4(wnHeldUsd),
    whitenoise_cleared_usd: round4(wnClearedUsd),
    whitenoise_pkr: round2(wnPkr),
    whitenoise_held_pkr: round2(wnHeldPkr),
    whitenoise_cleared_pkr: round2(wnClearedPkr),
    whitenoise_sms_count: wnSmsCount,
    monthly_cycle: monthlyCfg,
    next_release_date: nextReleaseMs ? new Date(nextReleaseMs).toISOString().slice(0, 10) : monthlyCfg.clear_date,
    by_payterm: byTerm
  };
}

function getMonthly30_5ScheduleInfo(holdSummary = null, refDate = new Date()) {
  const cfg = (holdSummary && holdSummary.monthly_cycle) ? holdSummary.monthly_cycle : getMonthlyCycleConfig(refDate);
  const mHold = holdSummary && holdSummary.by_payterm ? holdSummary.by_payterm.Monthly : null;
  return {
    payterm: 'Monthly',
    code: '30/5 {W}',
    label: 'Monthly (30/5) {W}',
    cycle_days: 30,
    hold_days: 5,
    schedule: 'monthly30_5',
    cycle_start: cfg.start_date,
    cycle_end: cfg.end_date,
    clear_date: cfg.clear_date,
    cycle_label: cfg.label,
    is_cleared_window: Boolean(cfg.is_cleared_window),
    sms_count: holdSummary ? (holdSummary.whitenoise_sms_count || 0) : 0,
    next_release_date: cfg.clear_date || (mHold && mHold.next_release_at ? mHold.next_release_at.slice(0, 10) : cfg.clear_date),
    held_usd: holdSummary ? holdSummary.whitenoise_held_usd : 0,
    cleared_usd: holdSummary ? holdSummary.whitenoise_cleared_usd : 0,
    held_pkr: holdSummary ? holdSummary.whitenoise_held_pkr : 0,
    cleared_pkr: holdSummary ? holdSummary.whitenoise_cleared_pkr : 0
  };
}

function normalizeAllowedQuantities(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' ? raw.split(/[\s,;]+/) : []);
  const clean = Array.from(new Set(
    arr.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0 && n <= 10000)
  )).sort((a, b) => a - b);
  return clean.length ? clean : [25, 50];
}

function getAllAgentClientRates() {
  const list = readDb('agent_client_rates');
  return Array.isArray(list) ? list : [];
}

function getAgentClientRates(agentId) {
  const aid = Number(agentId);
  if (!aid) return [];
  return getAllAgentClientRates().filter(r => r && Number(r.agent_id) === aid);
}

function findAgentClientRate(agentId, rangeId, rangeName = '') {
  const aid = Number(agentId);
  if (!aid) return null;
  const rows = getAgentClientRates(aid);
  if (rangeId != null && rangeId !== '') {
    const byId = rows.find(r => Number(r.range_id) === Number(rangeId));
    if (byId) return byId;
  }
  const cleanName = String(rangeName || '').trim().toLowerCase();
  if (cleanName) {
    const byName = rows.find(r => String(r.range_name || '').trim().toLowerCase() === cleanName);
    if (byName) return byName;
  }
  return null;
}

function getAgentRangeClientPkrRate(acr, payterm = 'Weekly') {
  if (!acr) return 0;
  if (acr.payterms && typeof acr.payterms === 'object') {
    const normPt = normalizePaytermKey(payterm);
    if (acr.payterms[normPt] !== undefined && Number(acr.payterms[normPt]) > 0) return round2(acr.payterms[normPt]);
    if (acr.payterms[payterm] !== undefined && Number(acr.payterms[payterm]) > 0) return round2(acr.payterms[payterm]);
  }
  return round2(acr.client_rate_pkr || 0);
}

// Per-Range Client Limits (NO cross-range limit; strictly enforced per individual range):
// - Max 25 numbers added/requested per UTC day per range
// - Max 50 active (+ pending) numbers held at a time per range
// - Max 3 additions/requests per rolling 7-day week per range
const CLIENT_RANGE_DAILY_NUMBERS_MAX = 25;
const CLIENT_RANGE_ACTIVE_HOLD_MAX = 50;
const CLIENT_RANGE_WEEKLY_ADDS_MAX = 3;
const CLIENT_RANGE_WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function matchesRangeRef(item, rangeId, rangeName) {
  if (!item) return false;
  const rid = rangeId != null && rangeId !== '' ? Number(rangeId) : null;
  const rNameLc = String(rangeName || '').trim().toLowerCase();
  if (rid && item.range_id != null && Number(item.range_id) === rid) return true;
  const itemNameLc = String(item.range_name || item.name || '').trim().toLowerCase();
  if (rNameLc && itemNameLc && itemNameLc === rNameLc) return true;
  return false;
}

function getClientRangeQuota(clientId, rangeId, rangeName = '', preloaded = null) {
  const cid = Number(clientId);
  const numbers = (preloaded && preloaded.numbers) || readDb('numbers') || [];
  const requests = (preloaded && preloaded.requests) || readDb('number_requests') || [];
  const history = (preloaded && preloaded.history) || readDb('allocation_history') || [];
  const nowMs = Date.now();
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const weekCutoffMs = nowMs - CLIENT_RANGE_WEEKLY_WINDOW_MS;

  const heldCount = numbers.filter(n =>
    n && Number(n.client_id) === cid && matchesRangeRef(n, rangeId, rangeName)
  ).length;

  const clientRangeReqs = requests.filter(r => {
    if (!r || Number(r.client_id) !== cid) return false;
    if (String(r.status || '').toLowerCase() === 'rejected') return false;
    return matchesRangeRef(r, rangeId, rangeName);
  });

  const pendingReqs = clientRangeReqs
    .filter(r => String(r.status || '').toLowerCase() === 'pending');
  const pendingRequestCount = pendingReqs.length;
  const hasPendingRequest = pendingRequestCount > 0;
  const pendingQty = pendingReqs
    .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);

  const todayReqNums = clientRangeReqs
    .filter(r => String(r.created || r.timestamp || '').slice(0, 10) === todayIso)
    .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);

  // Direct allocations (self-allocate or manual agent assign) not originating from a number request
  const directTodayNums = numbers.filter(n => {
    if (!n || Number(n.client_id) !== cid) return false;
    if (!matchesRangeRef(n, rangeId, rangeName)) return false;
    const assignedDay = String(n.client_assigned_at || n.assigned_at || n.assigned_date || '').slice(0, 10);
    if (assignedDay !== todayIso) return false;
    if (String(n.notes || '').startsWith('Allocated via Request #')) return false;
    return true;
  }).length;

  const todayNumbers = todayReqNums + directTodayNums;

  const weeklyEventsMs = [];
  for (const r of clientRangeReqs) {
    const ts = Date.parse(r.created || r.timestamp || '');
    if (Number.isFinite(ts) && ts >= weekCutoffMs) weeklyEventsMs.push(ts);
  }
  for (const h of history) {
    if (!h) continue;
    const isThisClient = (h.to_user_id != null && Number(h.to_user_id) === cid && String(h.to_role || '').toLowerCase() === 'client')
      || (h.target_id != null && Number(h.target_id) === cid && String(h.to_role || '').toLowerCase() === 'client');
    if (!isThisClient) continue;
    if (h.request_id || /^(Allocated via Request #|Request #\d+)/i.test(String(h.notes || '').trim())) continue;
    if (!matchesRangeRef(h, rangeId, rangeName)) continue;
    const ts = Date.parse(h.timestamp || h.created || '');
    if (Number.isFinite(ts) && ts >= weekCutoffMs) weeklyEventsMs.push(ts);
  }
  weeklyEventsMs.sort((a, b) => a - b);

  const weeklyAddsUsed = weeklyEventsMs.length;
  const dailyRemaining = Math.max(0, CLIENT_RANGE_DAILY_NUMBERS_MAX - todayNumbers);
  const holdRemaining = Math.max(0, CLIENT_RANGE_ACTIVE_HOLD_MAX - heldCount - pendingQty);
  const weeklyAddsRemaining = Math.max(0, CLIENT_RANGE_WEEKLY_ADDS_MAX - weeklyAddsUsed);
  const maxRequestableNow = weeklyAddsRemaining > 0 ? Math.min(dailyRemaining, holdRemaining) : 0;
  const canRequestNow = maxRequestableNow > 0 && !hasPendingRequest;

  let blockReason = null;
  if (!canRequestNow) {
    if (holdRemaining <= 0) blockReason = 'hold_limit';
    else if (weeklyAddsRemaining <= 0) blockReason = 'weekly_limit';
    else if (dailyRemaining <= 0) blockReason = 'daily_limit';
    else if (hasPendingRequest) blockReason = 'pending_request';
  }

  const nextWeeklySlotAt = (weeklyAddsRemaining <= 0 && weeklyEventsMs.length > 0)
    ? new Date(weeklyEventsMs[0] + CLIENT_RANGE_WEEKLY_WINDOW_MS).toISOString()
    : null;

  return {
    daily_numbers_limit: CLIENT_RANGE_DAILY_NUMBERS_MAX,
    today_numbers: todayNumbers,
    daily_remaining: dailyRemaining,
    max_hold_limit: CLIENT_RANGE_ACTIVE_HOLD_MAX,
    held_count: heldCount,
    pending_qty: pendingQty,
    pending_request_count: pendingRequestCount,
    has_pending_request: hasPendingRequest,
    hold_remaining: holdRemaining,
    weekly_adds_limit: CLIENT_RANGE_WEEKLY_ADDS_MAX,
    weekly_adds_used: weeklyAddsUsed,
    weekly_adds_remaining: weeklyAddsRemaining,
    next_weekly_slot_at: nextWeeklySlotAt,
    max_requestable_now: maxRequestableNow,
    can_request_now: canRequestNow,
    block_reason: blockReason
  };
}

function getAgentClientWeeklyPkrStats(agentId) {
  const aid = Number(agentId);
  const agents = readDb('agents') || [];
  const ag = agents.find(a => Number(a.id) === aid) || {};
  const targetPkr = Math.max(0, round2(ag.weekly_pkr_target || 0));
  const enforceMode = ag.weekly_pkr_enforce_mode === 'block' ? 'block' : 'warn';

  const now = new Date();
  const dayOffset = (now.getUTCDay() + 6) % 7;
  const mondayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset, 0, 0, 0, 0));
  const weekStartIso = mondayUtc.toISOString();

  const fx = getUsdToPkrRate();
  const sms = readSmsWithArchive();
  let usedPkr = 0;
  for (const s of sms) {
    if (!s || Number(s.agent_id) !== aid || !s.client_id) continue;
    const ts = String(s.timestamp || s.date || '');
    if (ts < weekStartIso) continue;
    if (s.client_amount_pkr != null && Number(s.client_amount_pkr) > 0) {
      usedPkr += Number(s.client_amount_pkr);
    } else if (s.client_amount != null && Number(s.client_amount) > 0) {
      usedPkr += Number(s.client_amount) * (Number(s.fx_usd_to_pkr) || fx);
    }
  }
  usedPkr = round2(usedPkr);
  const remainingPkr = targetPkr > 0 ? Math.max(0, round2(targetPkr - usedPkr)) : null;
  const pct = targetPkr > 0 ? Math.min(100, Math.round((usedPkr / targetPkr) * 1000) / 10) : 0;

  return {
    weekly_pkr_target: targetPkr,
    weekly_pkr_used: usedPkr,
    weekly_pkr_remaining: remainingPkr,
    weekly_pkr_percent: pct,
    weekly_pkr_enforce_mode: enforceMode,
    week_start: weekStartIso.slice(0, 10)
  };
}

function resolveClientRatePair({ agentId, rangeId, rangeName, payterm = 'Weekly', agentRateUsd = 0, explicitClientRate = null, clientRecord = null }) {
  const fx = getUsdToPkrRate();
  if (explicitClientRate !== undefined && explicitClientRate !== null && explicitClientRate !== '' && !isNaN(Number(explicitClientRate))) {
    const usd = round6(explicitClientRate);
    return {
      error: (agentRateUsd > 0 && usd >= agentRateUsd)
        ? `Client rate ($${usd}) must be strictly less than agent rate ($${agentRateUsd}) for this range.`
        : null,
      client_rate: usd,
      client_rate_pkr: round2(usd * fx),
      client_currency: 'PKR',
      fx_usd_to_pkr: fx,
      source: 'explicit'
    };
  }
  const acr = agentId ? findAgentClientRate(agentId, rangeId, rangeName) : null;
  if (acr && acr.published !== false && Number(acr.client_rate_pkr) > 0) {
    const pkr = getAgentRangeClientPkrRate(acr, payterm);
    let usd = round6(pkr / fx);
    if (agentRateUsd > 0 && usd >= agentRateUsd) {
      usd = round6(agentRateUsd * 0.9999);
    }
    return {
      error: null,
      client_rate: usd,
      client_rate_pkr: pkr,
      client_currency: 'PKR',
      fx_usd_to_pkr: fx,
      source: 'agent_client_rates'
    };
  }
  let usd = 0;
  if (clientRecord && clientRecord.client_rate !== undefined && clientRecord.client_rate !== null && Number(clientRecord.client_rate) > 0 && (agentRateUsd <= 0 || Number(clientRecord.client_rate) < agentRateUsd)) {
    usd = round6(clientRecord.client_rate);
  } else if (agentRateUsd > 0) {
    usd = Math.round(agentRateUsd * 0.9 * 10000) / 10000;
  }
  return {
    error: null,
    client_rate: usd,
    client_rate_pkr: round2(usd * fx),
    client_currency: 'PKR',
    fx_usd_to_pkr: fx,
    source: 'fallback'
  };
}


function ingestSms({
  sender = '',
  to_number = '',
  message = '',
  otp = '',
  sms_id = '',
  company = '',
  provider: customProvider = '',
  range: customRange = '',
  country: customCountry = '',
  source = 'api',
  panel_id = null,
  panel_name = '',
  ext_key = '',
  timestamp = null,
  currency: customCurrency = '',
  payout: customPayout = undefined,
  company_rate: customCompanyRate = undefined,
  agent_rate: customAgentRate = undefined,
  client_rate: customClientRate = undefined,
  whitenoise_sms_id = null,
  conversion_sent = false,
  conversion_at = null
}) {
  try {
    const cleanTo = String(to_number || '').trim();
    const cleanMsg = String(message || '').trim();
    if (!cleanTo || !cleanMsg) {
      return { status: 'error', error: 'Missing number or message' };
    }

    const { byDigits, byRaw } = getIndexedNumbers();
    const digits = cleanTo.replace(/\D/g, '');
    let numberRec = byRaw.get(cleanTo) || byDigits.get(digits) || null;
    const assignedNumberRec = (numberRec && (numberRec.agent_id || numberRec.client_id)) ? numberRec : null;

    const smsLog = readDb('sms_log') || [];
    const rawTsStr = timestamp != null ? String(timestamp).trim() : '';
    const hasRealTimestamp = Boolean(rawTsStr) && !isRelativeTimestampStr(rawTsStr);
    const dedupeKey = ext_key || (sms_id ? `smsid-${sms_id}` : '');
    if (smsIndexHas(smsLog, dedupeKey, sms_id, {
      number: cleanTo,
      message: cleanMsg,
      rawTimestamp: hasRealTimestamp ? rawTsStr : '',
      hasRealTimestamp
    })) {
      return { status: 'ok', duplicate: true, sms_id: sms_id || dedupeKey };
    }

    if (!numberRec && digits.length >= 7) {
      const allNums = readDb('numbers') || [];
      numberRec = allNums.find(n => n && n.number && phoneDigitsVariantsMatch(n.number, digits)) || null;
    }

    const ranges = readDb('sms_ranges') || [];
    const rateCard = readDb('rate_card') || [];

    let rng = null;
    // 1. Prioritize range lookup by range_name
    if (numberRec && numberRec.range_name) {
      const rn = String(numberRec.range_name).trim().toLowerCase();
      rng = ranges.find(r => (r.range_name && String(r.range_name).trim().toLowerCase() === rn) || (r.name && String(r.name).trim().toLowerCase() === rn));
    }
    // 2. Fallback to range_id
    if (!rng && numberRec && numberRec.range_id) {
      rng = ranges.find(r => Number(r.id) === Number(numberRec.range_id));
    }
    // 3. Fallback to prefix
    if (!rng && digits) {
      rng = ranges.find(r => (r.prefix && digits.startsWith(String(r.prefix).replace(/\D/g, ''))) ||
                             (r.dial_code && digits.startsWith(String(r.dial_code).replace(/\D/g, ''))));
    }

    const detectedCountry = detectCountry(cleanTo);
    const cleanCustomCountry = cleanSmsMetaVal(customCountry);
    const country = (rng && rng.country) || (numberRec && numberRec.country) || (cleanCustomCountry && cleanCustomCountry !== 'International' ? cleanCustomCountry : '') || detectedCountry;
    const panelFallbackProvider = (source === 'cr_api' || source === 'login_panel') ? (panel_name || company) : '';
    const rawProvider = (rng && rng.provider) || (numberRec && numberRec.provider) || customProvider || panelFallbackProvider || '';
    const provider = cleanSmsMetaVal(rawProvider);
    const rawRange = (rng && (rng.range_name || rng.name)) || (numberRec && (numberRec.range_name || numberRec.range)) || cleanSmsMetaVal(customRange);
    const fallbackRange = (country && provider && country !== 'International') ? `${country} ${provider}` : (country || '');
    const rangeLabel = rawRange || fallbackRange;

    // ── STAGE C: Precise Ledger Stamping & Rate Calculations ──
    // 1. Company Rate (Owner buy cost: custom override -> live CR API/panel rate -> number override -> range -> rate card -> custom payout fallback)
    let company_rate = 0;
    const parsedCustomCompanyRate = parseRateValue(customCompanyRate);
    const parsedCustomPayout = parseRateValue(customPayout);
    if (parsedCustomCompanyRate != null && parsedCustomCompanyRate > 0) {
      company_rate = round6(parsedCustomCompanyRate);
    }
    if (!company_rate && (source === 'cr_api' || source === 'login_panel') && parsedCustomPayout != null && parsedCustomPayout > 0) {
      company_rate = round6(parsedCustomPayout);
    }
    if (!company_rate && numberRec) {
      const numCost = parseRateValue(numberRec.company_rate) ?? parseRateValue(numberRec.company_cost) ?? parseRateValue(numberRec.cost) ?? parseRateValue(numberRec.carrier_rate);
      if (numCost != null && numCost > 0) {
        company_rate = round6(numCost);
      }
    }
    if (!company_rate && rng) {
      company_rate = round6(getRangeCompanyCost(rng));
    }
    if (!company_rate) {
      const rc = rateCard.find(c => c && c.active && (
        (country && c.country && String(c.country).toLowerCase() === String(country).toLowerCase()) ||
        (provider && c.provider && String(c.provider).toLowerCase() === String(provider).toLowerCase())
      ));
      if (rc && rc.buy_rate != null) company_rate = round6(parseRateValue(rc.buy_rate) || 0);
    }
    if (!company_rate && parsedCustomPayout != null && parsedCustomPayout > 0) {
      company_rate = round6(parsedCustomPayout);
    }

    // 2. Payterm & Agent Rate (number override -> range -> rate card; Monthly 30/5 {W} locked for Whitenoise)
    const isWnTraffic = source === 'whitenoise' ||
      isWhitenoiseRecord({ provider, source, panel_name, range: rangeLabel }) ||
      isWhitenoiseRecord(rng) ||
      isWhitenoiseRecord(numberRec);
    const payterm = isWnTraffic ? 'Monthly' : migrateLegacyPayterm((numberRec && (numberRec.payterm || numberRec.payterms)) || 'Weekly');
    const ptMeta = getPaytermMeta(payterm);
    let agent_rate = 0;
    if (customAgentRate !== undefined && customAgentRate !== null && !isNaN(Number(customAgentRate)) && Number(customAgentRate) > 0) {
      agent_rate = round6(customAgentRate);
    }
    if (!agent_rate && numberRec && numberRec.agent_rate != null && Number(numberRec.agent_rate) > 0) {
      agent_rate = round6(numberRec.agent_rate);
    }
    if (!agent_rate && rng) {
      agent_rate = round6(getRangeAgentRate(rng, payterm));
    }
    if (!agent_rate) {
      const rc = rateCard.find(c => c && c.active && (
        (country && c.country && String(c.country).toLowerCase() === String(country).toLowerCase()) ||
        (provider && c.provider && String(c.provider).toLowerCase() === String(provider).toLowerCase())
      ));
      if (rc && rc.sell_rate != null) agent_rate = round6(rc.sell_rate);
    }

    let resolvedAgentId = numberRec && numberRec.agent_id;
    let resolvedClientId = numberRec && numberRec.client_id;

    // Check if numberRec.user is a client
    if (!resolvedClientId && numberRec && numberRec.user && numberRec.user !== 'unallocated') {
      const c = (readDb('clients') || []).find(x => String(x.username).toLowerCase() === String(numberRec.user).toLowerCase());
      if (c) resolvedClientId = c.id;
    }

    if (!resolvedClientId && numberRec && numberRec.client_username) {
      const c = (readDb('clients') || []).find(x => String(x.username).toLowerCase() === String(numberRec.client_username).toLowerCase());
      if (c) resolvedClientId = c.id;
    }

    // Resolve up the chain from client -> agent
    if (resolvedClientId) {
      const c = (readDb('clients') || []).find(x => Number(x.id) === Number(resolvedClientId));
      if (c && !resolvedAgentId && c.agent_id) resolvedAgentId = c.agent_id;
    }

    if (!resolvedAgentId && numberRec && numberRec.agent_username) {
      const a = (readDb('agents') || []).find(x => String(x.username).toLowerCase() === String(numberRec.agent_username).toLowerCase());
      if (a) resolvedAgentId = a.id;
    }

    const hasClient = Boolean(resolvedClientId);
    const hasAgent = Boolean(resolvedAgentId);

    // 3. Client Rate (number override / agent_client_rates -> client record -> range/card fallback)
    const fxUsdToPkr = getUsdToPkrRate();
    const acrRec = (hasClient && hasAgent)
      ? findAgentClientRate(resolvedAgentId, (rng && rng.id) || (numberRec && numberRec.range_id), rangeLabel)
      : null;
    let client_rate = 0;
    let client_rate_pkr = 0;
    if (hasClient) {
      const hasExplicitNumUsd = numberRec && (numberRec.client_rate != null || numberRec.client_payout != null) && Number(numberRec.client_rate ?? numberRec.client_payout) > 0;
      const numFromAcr = numberRec && numberRec.rate_source === 'agent_client_rates';
      if (hasExplicitNumUsd && !numFromAcr) {
        client_rate = round6(numberRec.client_rate ?? numberRec.client_payout);
        if (numberRec.client_rate_pkr != null && Number(numberRec.client_rate_pkr) > 0) {
          client_rate_pkr = round2(numberRec.client_rate_pkr);
        } else {
          client_rate_pkr = round2(client_rate * fxUsdToPkr);
        }
      } else if (acrRec && acrRec.published !== false && Number(acrRec.client_rate_pkr) > 0) {
        client_rate_pkr = getAgentRangeClientPkrRate(acrRec, payterm);
        client_rate = round6(client_rate_pkr / fxUsdToPkr);
      } else if (numberRec && numberRec.client_rate_pkr != null && Number(numberRec.client_rate_pkr) > 0) {
        client_rate_pkr = round2(numberRec.client_rate_pkr);
        client_rate = round6(client_rate_pkr / fxUsdToPkr);
      }
      if (!client_rate) {
        const clients = readDb('clients') || [];
        const cl = clients.find(c => (resolvedClientId && Number(c.id) === Number(resolvedClientId)) || (numberRec && numberRec.client_username && String(c.username).toLowerCase() === String(numberRec.client_username).toLowerCase()));
        if (cl && cl.client_rate != null) {
          client_rate = round6(cl.client_rate);
        } else {
          client_rate = agent_rate;
        }
        if (!client_rate_pkr) client_rate_pkr = round2(client_rate * fxUsdToPkr);
      }
      if (agent_rate > 0 && client_rate > agent_rate) {
        client_rate = agent_rate;
      }
    } else {
      client_rate = 0;
      client_rate_pkr = 0;
    }

    // 4. STRICT 3-TIER LEDGER AMOUNTS (Owner -> Agent -> Client)
    // Invariant: company_rate === owner_amount + agent_amount + client_amount
    const client_amount = hasClient ? round6(client_rate) : 0;
    const client_amount_pkr = hasClient ? round2(client_rate_pkr) : 0;
    const agent_amount = hasAgent ? (hasClient ? round6(agent_rate - client_rate) : round6(agent_rate)) : 0;
    const owner_amount = hasAgent ? Math.max(0, round6(company_rate - agent_rate)) : round6(company_rate);

    const finalTimestamp = (source === 'whitenoise' ? parseWhitenoiseTimestamp(timestamp) : null) || normalizeIsoTimestamp(timestamp);
    const datePart = finalTimestamp.slice(0, 10);
    const timePart = finalTimestamp.slice(11, 19);

    const cleanHierarchyStr = (val) => {
      const s = String(val || '').trim();
      if (!s) return '';
      const sl = s.toLowerCase();
      if (['unallocated', 'unassigned', 'direct', 'general', '—', '-', 'unknown', 'none', 'null'].includes(sl)) return '';
      return s;
    };

    const appName = (numberRec && numberRec.app) || detectApp(sender, cleanMsg);
    let agent_username = cleanHierarchyStr(numberRec && (numberRec.agent_username || numberRec.agent));
    let client_username = cleanHierarchyStr(numberRec && (numberRec.client_username || numberRec.client_name || numberRec.user));
    if (!agent_username && hasAgent) {
      const aRec = (readDb('agents') || []).find(a => Number(a.id) === Number(resolvedAgentId));
      if (aRec) agent_username = cleanHierarchyStr(aRec.username);
    }
    if (!client_username && hasClient) {
      const cRec = (readDb('clients') || []).find(c => Number(c.id) === Number(resolvedClientId));
      if (cRec) client_username = cleanHierarchyStr(cRec.username);
    }

    const smsType = 'General';
    const finalOtp = otp || extractOtp(cleanMsg);

    const entry = {
      id: nextSmsId(smsLog),
      number: cleanTo,
      cli: sender || '',
      message: cleanMsg,
      timestamp: finalTimestamp,
      date: datePart,
      time: timePart,
      otp: finalOtp,
      range_label: rangeLabel,
      range_name: rangeLabel,
      range: rangeLabel,
      country: country || '',
      provider: provider || '',
      range_id: rng ? rng.id : null,
      app: appName,
      type: smsType,
      status: 'delivered',
      cause: 'Success',
      currency: (rng && rng.currency) || cleanSmsMetaVal(customCurrency) || 'USD',
      company_rate: company_rate,
      agent_rate: agent_rate,
      client_rate: client_rate,
      client_currency: 'PKR',
      fx_usd_to_pkr: fxUsdToPkr,
      client_rate_pkr: client_rate_pkr,
      client_amount_pkr: client_amount_pkr,
      payterm: ptMeta.key,
      payterms: ptMeta.key,
      payout_schedule: ptMeta.schedule,
      cycle_days: ptMeta.cycle_days,
      hold_days: ptMeta.hold_days,
      clears_at: (isWnTraffic || ptMeta.schedule === 'monthly30_5')
        ? computeMonthlyClearIso(finalTimestamp)
        : new Date((new Date(finalTimestamp).getTime() || Date.now()) + ptMeta.hold_days * 86400000).toISOString(),
      is_whitenoise: isWnTraffic,
      whitenoise_sms_id: whitenoise_sms_id != null ? whitenoise_sms_id : null,
      conversion_sent: Boolean(conversion_sent),
      conversion_at: conversion_at || null,
      client_amount: client_amount,
      agent_amount: agent_amount,
      owner_amount: owner_amount,
      has_rate: Boolean(company_rate > 0 || agent_rate > 0),
      no_rate: !(company_rate > 0 || agent_rate > 0),
      payout: hasClient ? client_amount : (hasAgent ? agent_amount : 0),
      client_payout: hasClient ? client_amount : 0,
      agent_payout: hasAgent ? agent_rate : 0,
      company_payout: company_rate,
      profit: owner_amount,
      carrier_revenue: company_rate,
      payout_cost: round6(agent_rate),
      admin_profit: owner_amount,
      agent_id: resolvedAgentId != null ? Number(resolvedAgentId) : null,
      client_id: resolvedClientId != null ? Number(resolvedClientId) : null,
      agent_username: agent_username || null,
      client_username: client_username || null,
      user: client_username || '',
      source: source || 'api',
      panel_id: panel_id || null,
      panel_name: panel_name || '',
      sms_id: sms_id || '',
      company: company || (numberRec ? numberRec.company : '') || '',
      ext_key: dedupeKey || md5(`${panel_id || 'api'}|${cleanTo}|${finalTimestamp}|${cleanMsg}`)
    };

    appendSmsLog(entry, smsLog);
    noteSmsArrival();

    // Update last_sms_at on the matched number so active numbers stay protected from inactivity auto-block
    if (numberRec) {
      numberRec.last_sms_at = finalTimestamp;
      if (numberRec.inactivity_flagged && String(numberRec.status || '').toLowerCase() !== 'blocked') {
        numberRec.inactivity_flagged = false;
        numberRec.inactivity_flagged_at = null;
      }
      debouncedWriteDb('numbers');
    }

    // ── STAGE D: Live Money Flow Balances Update (Strict 3-Tier Waterfall) ──
    try {
      const allClients = readDb('clients') || [];
      const allAgents = readDb('agents') || [];
      const allUsers = readDb('users') || [];

      // 1. Client balance += client_amount (USD) & balance_pkr += client_amount_pkr (PKR)
      if (hasClient && (client_amount > 0 || client_amount_pkr > 0)) {
        const cIdx = allClients.findIndex(c => c && (
          (client_username && String(c.username).trim().toLowerCase() === String(client_username).trim().toLowerCase()) ||
          (resolvedClientId && Number(c.id) === Number(resolvedClientId))
        ));
        if (cIdx !== -1) {
          const curBal = Number(allClients[cIdx].balance || 0);
          allClients[cIdx].balance = Math.round((curBal + client_amount) * 1000000) / 1000000;
          const curBalPkr = Number(allClients[cIdx].balance_pkr != null ? allClients[cIdx].balance_pkr : round2(curBal * fxUsdToPkr));
          allClients[cIdx].balance_pkr = round2(curBalPkr + client_amount_pkr);
          debouncedWriteDb('clients');
        }
      }

      // 2. Agent balance += agent_amount
      if (hasAgent && agent_amount > 0) {
        const aIdx = allAgents.findIndex(a => a && (
          (agent_username && String(a.username).trim().toLowerCase() === String(agent_username).trim().toLowerCase()) ||
          (resolvedAgentId && Number(a.id) === Number(resolvedAgentId))
        ));
        if (aIdx !== -1) {
          const curBal = Number(allAgents[aIdx].balance || 0);
          allAgents[aIdx].balance = Math.round((curBal + agent_amount) * 1000000) / 1000000;
          debouncedWriteDb('agents');
        }
      }

      // 3. Owner profit += owner_amount
      if (owner_amount > 0) {
        const oIdx = allUsers.findIndex(u => u && (
          (u.role || '').toLowerCase() === 'owner' ||
          String(u.username || '').toLowerCase() === 'kamran_bhatti'
        ));
        if (oIdx !== -1) {
          const curBal = Number(allUsers[oIdx].balance || 0);
          allUsers[oIdx].balance = Math.round((curBal + owner_amount) * 1000000) / 1000000;
          debouncedWriteDb('users');
        }
      }
    } catch (balErr) {
      console.error('Error updating money flow balances:', balErr);
    }

    if (numberRec) {
      numberRec.sms_count = (numberRec.sms_count || 0) + 1;
      numberRec.last_sms = entry.timestamp;
      debouncedWriteDb('numbers');
    }

    broadcastWs({
      type: 'otp',
      data: entry
    });

    try {
      const wnRangesMap = buildRangesLookupMap();
      const wnTags = getWhitenoiseProviderTags();
      const isWn = isWhitenoiseRecord(entry, wnRangesMap, wnTags);
      if (!isWn) {
        const rangeLabel = String(entry.range_name || entry.range_label || entry.range || entry.country || 'International').trim();
        const cliLabel = String(entry.cli || entry.app || entry.sender || 'SMS').trim();
        broadcastWs({
          type: 'live_access_otp',
          data: {
            id: entry.id,
            range: rangeLabel,
            cli: cliLabel,
            sms: maskOtpInSmsBody(entry.message || '', entry.otp || ''),
            timestamp: entry.timestamp || new Date().toISOString()
          }
        });
      }
    } catch (_) {}

    const live = liveTrafficStats();
    broadcastWs({
      type: 'traffic',
      mps: live.mps,
      timestamp: new Date().toISOString(),
      total: smsLog.length,
      success_rate: live.success_rate
    });

    return { status: 'ok', logged: true, matched_number: Boolean(numberRec), entry };
  } catch (err) {
    console.error('ingestSms error:', err);
    return { status: 'error', error: err.message };
  }
}

const loginPanelsInFlight = new Set();
const loginPanelCookieCache = new Map();

function extractOtpQuick(text) {
  const s = String(text || '');
  const m1 = s.match(/(?:code|otp|pin|verification|passcode|password)[^\d]{0,16}(\d{4,8})/i);
  if (m1) return m1[1];
  const m2 = s.match(/\b(\d{3}[-\s]\d{3})\b/);
  if (m2) return m2[1].replace(/\D/g, '');
  const m3 = s.match(/\b(\d{4,8})\b/);
  return m3 ? m3[1] : '';
}

function parseGenericSmsHtmlTable(html, panelName = '') {
  if (!html || typeof html !== 'string') return [];
  // First try Whitenoise 8/9-col format
  const wnRows = parseWhitenoiseWebSmsHtml(html);
  if (wnRows.length > 0) {
    return wnRows.map(r => ({
      date: r.time_received || r.time_sent || '',
      number: r.dst || '',
      cli: r.src || r.service_name || 'Whitenoise',
      message: r.text || '',
      otp: extractOtpQuick(r.text),
      provider: r.provider_col || panelName || 'Whitenoise',
      range: r.service_name || ''
    }));
  }

  // Generic HTML <table> header-aware parser
  const rows = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const tbl = tm[1];
    const headers = [];
    const thRe = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
    let hm;
    while ((hm = thRe.exec(tbl)) !== null) {
      headers.push(decodeHtmlEntities(hm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).toLowerCase());
    }
    const idxOf = (re) => headers.findIndex(h => re.test(h));
    const iNum = idxOf(/number|dest|destination|phone|msisdn|\bto\b/);
    const iMsg = idxOf(/message|text|sms|content|body/);
    const iCli = idxOf(/cli|sender|source|\bfrom\b|service|origin/);
    const iDate = idxOf(/time|date|received|sent|created/);
    const iRange = idxOf(/range|country|route|termination/);
    const iProv = idxOf(/provider|carrier|vendor/);

    const bodyMatch = tbl.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const slice = bodyMatch ? bodyMatch[1] : tbl;
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trm;
    while ((trm = trRe.exec(slice)) !== null) {
      if (/<th\b/i.test(trm[1])) continue;
      const cells = [];
      const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
      let tdm;
      while ((tdm = tdRe.exec(trm[1])) !== null) {
        cells.push(decodeHtmlEntities(tdm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
      }
      if (cells.length < 3) continue;
      let num = iNum >= 0 ? (cells[iNum] || '') : '';
      let msg = iMsg >= 0 ? (cells[iMsg] || '') : '';
      let cli = iCli >= 0 ? (cells[iCli] || '') : '';
      let dt = iDate >= 0 ? (cells[iDate] || '') : '';
      let rng = iRange >= 0 ? (cells[iRange] || '') : '';
      let prov = iProv >= 0 ? (cells[iProv] || '') : '';

      // Heuristic fallback if table has no <th> headers
      if (!num) {
        const foundNum = cells.find(c => /^\+?\d[\d\s\-()]{6,18}$/.test(c.trim()));
        if (foundNum) num = foundNum.trim();
      }
      if (!msg) {
        const candidates = cells.filter(c => c !== num && c.length >= 6);
        msg = candidates.sort((a, b) => b.length - a.length)[0] || '';
      }
      if (!num || !msg) continue;
      const numDigits = num.replace(/\D/g, '');
      if (numDigits.length < 6) continue;
      rows.push({
        date: dt || '',
        number: num.startsWith('+') ? num : '+' + numDigits,
        cli: cli || panelName || 'SMS',
        message: msg,
        otp: extractOtpQuick(msg),
        provider: prov || panelName || '',
        range: rng || ''
      });
    }
    if (rows.length > 0) break;
  }
  return rows;
}

async function fetchWithCookieRedirects(url, { method = 'GET', headers = {}, body, cookieJar = '', timeoutMs = 20000, maxRedirects = 5 } = {}) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  let cookies = cookieJar;
  let resp = null;
  let text = '';

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const reqHeaders = { ...headers };
      if (cookies) reqHeaders.Cookie = cookies;
      if (currentMethod === 'GET' || currentMethod === 'HEAD') {
        delete reqHeaders['Content-Type'];
      }
      resp = await fetch(currentUrl, {
        method: currentMethod,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: reqHeaders,
        body: (currentMethod === 'GET' || currentMethod === 'HEAD') ? undefined : currentBody
      });
      const sc = resp.headers.getSetCookie ? resp.headers.getSetCookie() : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')] : []);
      cookies = mergeCookieHeader(cookies, sc);
      const loc = resp.headers.get('location');
      if (loc && resp.status >= 300 && resp.status < 400 && hop < maxRedirects) {
        currentUrl = new URL(loc, currentUrl).toString();
        currentMethod = 'GET';
        currentBody = undefined;
        continue;
      }
      text = await resp.text();
      break;
    } finally {
      clearTimeout(t);
    }
  }
  return { status: resp ? resp.status : 0, url: currentUrl, html: text, cookies };
}

async function runNodeLoginPanelScraper(panel) {
  const loginUrl = String(panel.panel_url || '').trim();
  const dataUrl = String(panel.data_url || '').trim();
  if (!loginUrl || !dataUrl) {
    throw new Error('Both Login URL and SMS Page URL are required.');
  }
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const baseHeaders = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8'
  };

  const performLogin = async () => {
    const getPage = await fetchWithCookieRedirects(loginUrl, { method: 'GET', headers: baseHeaders, timeoutMs: 20000 });
    let cookies = getPage.cookies;
    const html = getPage.html || '';

    // Parse form action, input field names, and hidden inputs
    const formTag = html.match(/<form\b[^>]*>/i)?.[0] || '';
    const actionAttr = formTag.match(/action=["']([^"']*)["']/i)?.[1] || '';
    const postUrl = actionAttr ? new URL(actionAttr, getPage.url || loginUrl).toString() : (getPage.url || loginUrl);

    const hidden = {};
    let userField = '';
    let passField = '';
    const inputRe = /<input\b[^>]*>/gi;
    let im;
    while ((im = inputRe.exec(html)) !== null) {
      const tag = im[0];
      const type = (tag.match(/type=["']?([^"'\s>]+)/i)?.[1] || 'text').toLowerCase();
      const name = tag.match(/name=["']([^"']+)["']/i)?.[1] || '';
      const val = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? '';
      if (!name) continue;
      if (type === 'hidden') {
        hidden[name] = val;
      } else if (type === 'password' && !passField) {
        passField = name;
      } else if (!userField && (type === 'email' || type === 'text') && /email|user|login|uname|account/i.test(name)) {
        userField = name;
      }
    }
    if (!userField) userField = /whitenoise\.one/i.test(loginUrl) ? 'email' : 'username';
    if (!passField) passField = 'password';

    const formBody = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) formBody.append(k, v);
    formBody.append(userField, String(panel.username || '').trim());
    formBody.append(passField, String(panel.password || ''));

    const postRes = await fetchWithCookieRedirects(postUrl, {
      method: 'POST',
      cookieJar: cookies,
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': getPage.url || loginUrl,
        'Origin': new URL(postUrl).origin
      },
      body: formBody.toString(),
      timeoutMs: 20000
    });
    cookies = postRes.cookies;
    const postText = postRes.html || '';
    const badCreds = /incorrect username or password|invalid (username|email|password|credentials)|wrong password/i.test(postText);
    if (badCreds) {
      throw new Error('Login failed: Incorrect username/email or password on remote panel.');
    }
    if (postRes.status >= 400) {
      throw new Error(`Login HTTP ${postRes.status} on ${postUrl}`);
    }
    if (isWhitenoiseLoginHtml(postText) && postRes.url.replace(/\/+$/, '') === loginUrl.replace(/\/+$/, '')) {
      throw new Error('Login rejected by remote panel — please check Email/Username and Password.');
    }
    loginPanelCookieCache.set(panel.id, cookies);
    return cookies;
  };

  let cookies = loginPanelCookieCache.get(panel.id) || '';
  if (!cookies) {
    cookies = await performLogin();
  }

  const fetchSmsPage = async (targetUrl, ck) => {
    return fetchWithCookieRedirects(targetUrl, {
      method: 'GET',
      cookieJar: ck,
      headers: { ...baseHeaders, 'Referer': loginUrl },
      timeoutMs: 25000
    });
  };

  const isWhitenoiseTarget = /whitenoise\.one/i.test(dataUrl) || /whitenoise\.one/i.test(loginUrl);
  let targetFetchUrl = dataUrl;
  if (isWhitenoiseTarget && !dataUrl.includes('?')) {
    const now = new Date();
    const startDt = new Date(now.getTime() - 360 * 60000); // last 6 hours
    targetFetchUrl = `${dataUrl.replace(/\/+$/, '')}?sms_time_start=${encodeURIComponent(formatWhitenoiseWebTime(startDt))}&sms_time_end=${encodeURIComponent(formatWhitenoiseWebTime(now))}&order=id:desc`;
  }

  let dataRes = await fetchSmsPage(targetFetchUrl, cookies);
  cookies = dataRes.cookies || cookies;

  // Detect expired session / redirected back to login page -> auto-relogin once
  if (dataRes.status === 401 || dataRes.status === 403 || isWhitenoiseLoginHtml(dataRes.html)) {
    cookies = await performLogin();
    dataRes = await fetchSmsPage(targetFetchUrl, cookies);
    cookies = dataRes.cookies || cookies;
    if (dataRes.status === 401 || dataRes.status === 403 || isWhitenoiseLoginHtml(dataRes.html)) {
      throw new Error('Remote panel requires login — credentials rejected or session blocked.');
    }
  }
  if (dataRes.status < 200 || dataRes.status >= 300) {
    throw new Error(`SMS page HTTP ${dataRes.status} at ${targetFetchUrl}`);
  }
  loginPanelCookieCache.set(panel.id, cookies);

  const parseBody = (raw) => {
    const trimmed = String(raw || '').trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed);
        const arr = Array.isArray(j) ? j : (j.data || j.aaData || j.rows || j.sms || j.messages || []);
        if (Array.isArray(arr)) {
          return arr.map(r => {
            if (Array.isArray(r)) {
              const dt = String(r[0] || '');
              const num = String(r[1] || r[2] || '');
              const cli = String(r[2] || r[1] || '');
              const msg = String(r[3] || r[4] || '');
              return { date: dt, number: num, cli, message: msg, otp: extractOtpQuick(msg) };
            }
            const msg = String(r.message ?? r.text ?? r.sms ?? r.body ?? '');
            return {
              date: String(r.date ?? r.time ?? r.timestamp ?? r.time_received ?? ''),
              number: String(r.number ?? r.dst ?? r.phone ?? r.to ?? ''),
              cli: String(r.cli ?? r.src ?? r.sender ?? r.service_name ?? panel.name ?? ''),
              message: msg,
              otp: String(r.otp || extractOtpQuick(msg)),
              provider: String(r.provider || panel.name || ''),
              range: String(r.range || r.range_name || r.service_name || '')
            };
          }).filter(x => x.number && x.message);
        }
      } catch (_) {}
    }
    return parseGenericSmsHtmlTable(raw, panel.name || '');
  };

  let rows = parseBody(dataRes.html);
  // If time-windowed Whitenoise query returned 0 rows, also check bare data_url (default view)
  if (rows.length === 0 && targetFetchUrl !== dataUrl) {
    const bareRes = await fetchSmsPage(dataUrl, cookies);
    if (bareRes.status >= 200 && bareRes.status < 300 && !isWhitenoiseLoginHtml(bareRes.html)) {
      rows = parseBody(bareRes.html);
    }
  }

  return { success: true, rows };
}

function assertSafeExternalUrl(rawUrl, label = 'URL') {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new Error(`Invalid ${label}: must be a valid http(s) URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid ${label}: only http:// and https:// URLs are allowed.`);
  }
  const host = (parsed.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^(fc|fd|fe80)/i.test(host)
  ) {
    throw new Error(`Blocked ${label}: private or local network addresses are not permitted.`);
  }
  return parsed.toString();
}

const loginPanelBackoff = new Map(); // panelId -> { errors, nextAllowedAt }
const crApiInFlight = new Set();
const crApiBackoff = new Map(); // connId -> { errors, nextAllowedAt }

async function pollSingleLoginPanel(panelId, force = false) {
  const panels = readDb('login_panels') || [];
  const panel = panels.find(p => Number(p.id) === Number(panelId));
  if (!panel || (!force && panel.status !== 'running')) return 0;
  if (loginPanelsInFlight.has(panelId)) {
    return 0;
  }
  if (!force) {
    const bo = loginPanelBackoff.get(panelId);
    if (bo && Date.now() < bo.nextAllowedAt) return 0;
  }
  loginPanelsInFlight.add(panelId);
  let added = 0;
  let lastError = '';
  const runAt = new Date().toISOString();

  try {
    assertSafeExternalUrl(panel.panel_url, 'Panel URL');
    assertSafeExternalUrl(panel.data_url, 'SMS Data URL');
    const result = await runNodeLoginPanelScraper(panel);
    const isWnPanel = /whitenoise/i.test(`${panel.name || ''} ${panel.panel_url || ''} ${panel.data_url || ''}`);

    if (result.success && Array.isArray(result.rows)) {
      // Reverse rows so newest unshifts to the top of smsLog
      const rowsToProcess = [...result.rows].reverse();
      for (const row of rowsToProcess) {
        if (!row.number || !row.message) continue;
        const cleanDate = (row.date && !isRelativeTimestampStr(row.date)) ? String(row.date).trim() : '';
        const normNum = normalizePhoneKey(row.number);
        const normMsg = normalizeMsgKey(row.message);
        const key = cleanDate
          ? md5(`lp|${panel.id}|${normNum}|${cleanDate}|${normMsg}`)
          : md5(`lp|${panel.id}|${normNum}|${normMsg}`);
        const panelRate = extractCrApiRate(row);
        const ingestRes = ingestSms({
          sender: row.cli,
          to_number: row.number,
          message: row.message,
          otp: row.otp || '',
          timestamp: cleanDate || null,
          range: row.range || row.range_name || '',
          country: row.country || '',
          provider: row.provider || (isWnPanel ? 'Whitenoise' : panel.name) || '',
          payout: panelRate,
          source: isWnPanel ? 'whitenoise' : 'login_panel',
          panel_id: panel.id,
          panel_name: panel.name,
          ext_key: key
        });
        if (ingestRes && ingestRes.logged) {
          added++;
        }
      }
      lastError = '';
      loginPanelBackoff.delete(panelId);
    } else {
      lastError = (result && result.error) ? String(result.error).slice(0, 200) : 'Failed to parse table';
      const prev = loginPanelBackoff.get(panelId) || { errors: 0, nextAllowedAt: 0 };
      const errs = Math.min(prev.errors + 1, 6);
      const baseSec = Math.max(10, parseInt(panel.interval) || 15);
      const delaySec = Math.min(180, baseSec * Math.pow(2, errs - 1));
      loginPanelBackoff.set(panelId, { errors: errs, nextAllowedAt: Date.now() + delaySec * 1000 });
    }
  } catch (err) {
    const errorMsg = err.name === 'AbortError' ? 'Connection timed out. Please try again.' : (err.message || 'Scraper failed');
    lastError = String(errorMsg).slice(0, 200);
    const prev = loginPanelBackoff.get(panelId) || { errors: 0, nextAllowedAt: 0 };
    const errs = Math.min(prev.errors + 1, 6);
    const baseSec = Math.max(10, parseInt(panel.interval) || 15);
    const delaySec = Math.min(180, baseSec * Math.pow(2, errs - 1));
    loginPanelBackoff.set(panelId, { errors: errs, nextAllowedAt: Date.now() + delaySec * 1000 });
  } finally {
    loginPanelsInFlight.delete(panelId);
  }

  // Merge ONLY runtime stats onto fresh DB record (never overwrite status/credentials changed while in-flight)
  const allPanels = readDb('login_panels') || [];
  const idx = allPanels.findIndex(p => Number(p.id) === Number(panelId));
  if (idx !== -1) {
    allPanels[idx] = {
      ...allPanels[idx],
      last_run: runAt,
      last_error: lastError,
      total_sms: (allPanels[idx].total_sms || 0) + added
    };
    writeDb('login_panels', allPanels);
  }
  return added;
}

async function pollSingleCrApiConnection(connId, force = false) {
  const conns = readDb('cr_api_connections') || [];
  const conn = conns.find(c => Number(c.id) === Number(connId));
  if (!conn || (!force && !conn.active)) return 0;
  if (crApiInFlight.has(connId)) {
    return 0;
  }
  if (!force) {
    const bo = crApiBackoff.get(connId);
    if (bo && Date.now() < bo.nextAllowedAt) return 0;
  }
  crApiInFlight.add(connId);
  let pulled = 0;
  let lastStatus = '';
  const pulledAt = new Date().toISOString();

  try {
    const base = assertSafeExternalUrl(conn.panel_url, 'CR API Panel URL');
    const sep = base.includes('?') ? '&' : '?';
    // Use records=100 for reliable polling, deduplicating locally via ingestSms
    const hasTokenParam = /[?&]token=/i.test(base);
    const hasRecordsParam = /[?&]records=/i.test(base);
    const pollUrl = hasTokenParam
      ? (hasRecordsParam ? base : `${base}${sep}records=100`)
      : `${base}${sep}token=${encodeURIComponent(conn.token)}${hasRecordsParam ? '' : '&records=100'}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let resp;
    try {
      resp = await fetch(pollUrl, { signal: controller.signal, headers: { 'User-Agent': 'HUMEX-SMS/1.0' } });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    const json = await resp.json();
    const rowsCandidate = Array.isArray(json)
      ? json
      : (json && (json.data || json.aaData || json.rows || json.records || json.messages || json.list || json.result));
    const statusStr = json && json.status != null ? String(json.status).trim().toLowerCase() : '';
    const isOkStatus = Array.isArray(json)
      || statusStr === 'success'
      || statusStr === 'ok'
      || json?.status === true
      || json?.status === 1
      || (!statusStr && Array.isArray(rowsCandidate) && !json?.error);

    if (!isOkStatus) {
      const errTxt = (json && (json.msg || json.message || json.error)) || '';
      if (errTxt && /no records found|no data|empty/i.test(errTxt)) {
        lastStatus = 'Active — Waiting for new SMS';
        crApiBackoff.delete(connId);
        const allConns = readDb('cr_api_connections') || [];
        const idx = allConns.findIndex(c => Number(c.id) === Number(connId));
        if (idx !== -1) {
          allConns[idx] = {
            ...allConns[idx],
            last_pulled_at: pulledAt,
            last_status: lastStatus
          };
          writeDb('cr_api_connections', allConns);
        }
        return 0;
      }
      throw new Error(errTxt || 'Panel returned non-success status');
    }

    const rows = Array.isArray(rowsCandidate) ? rowsCandidate : [];
    // Process oldest -> newest so newest unshifts to the top of sms_log
    const rowsToProcess = [...rows].reverse();
    for (const row of rowsToProcess) {
      let num = '';
      let cli = '';
      let msg = '';
      let dt = '';
      let rowRange = '';
      let rowCountry = '';
      let rowProvider = '';
      let rowCurrency = '';
      let payoutVal;

      if (Array.isArray(row)) {
        // Support [dt, num, cli, msg], [dt, num, cli, msg, payout], [dt, range, num, cli, msg, payout?]
        if (row.length === 5 && /^\+?\d{6,16}$/.test(String(row[1] || '').trim().replace(/[\s()-]/g, '')) && isLikelyRateToken(row[4])) {
          dt = String(row[0] || '').trim();
          num = String(row[1] || '').trim();
          cli = String(row[2] || '').trim();
          msg = String(row[3] || '').trim();
          payoutVal = extractCrApiRate(row);
        } else if (row.length >= 5) {
          dt = String(row[0] || '').trim();
          rowRange = String(row[1] || '').trim();
          num = String(row[2] || '').trim();
          cli = String(row[3] || '').trim();
          msg = String(row[4] || '').trim();
          payoutVal = extractCrApiRate(row);
        } else {
          dt = String(row[0] || '').trim();
          num = String(row[1] || '').trim();
          cli = String(row[2] || '').trim();
          msg = String(row[3] || '').trim();
        }
      } else if (row && typeof row === 'object') {
        num = String(row.num ?? row.number ?? row.to ?? row.to_number ?? row.destination ?? row.dst ?? row.msisdn ?? row.phone ?? row.receiver ?? row.recipient ?? '').trim();
        cli = String(row.cli ?? row.sender ?? row.from ?? row.sender_id ?? row.sid ?? row.originator ?? row.src ?? row.service ?? row.app ?? '').trim();
        msg = String(row.message ?? row.sms ?? row.sms_text ?? row.text ?? row.msg ?? row.body ?? row.content ?? row.otp_message ?? '').trim();
        dt = String(row.dt ?? row.timestamp ?? row.date ?? row.created_at ?? row.received_at ?? row.time_received ?? row.sent_at ?? row.created ?? row.time ?? row.datetime ?? row.date_time ?? '').trim();
        rowRange = String(row.range_name ?? row.range ?? row.range_label ?? row.termination ?? '').trim();
        rowCountry = String(row.country ?? row.country_name ?? '').trim();
        rowProvider = String(row.provider ?? row.carrier ?? row.route ?? '').trim();
        rowCurrency = String(row.currency ?? row.curr ?? row.cur ?? '').trim().toUpperCase();
        payoutVal = extractCrApiRate(row);
      }

      if (!num || !msg) continue;

      const cleanDt = (dt && !isRelativeTimestampStr(dt)) ? dt : '';
      const normNum = normalizePhoneKey(num);
      const normMsg = normalizeMsgKey(msg);
      const smsId = cleanDt
        ? `crapi-${conn.id}-${md5(`${cleanDt}|${normNum}|${cli}|${normMsg}`).slice(0, 16)}`
        : `crapi-${conn.id}-${md5(`${normNum}|${cli}|${normMsg}`).slice(0, 16)}`;
      const ingestRes = ingestSms({
        sender: cli,
        to_number: num,
        message: msg,
        sms_id: smsId,
        company: conn.panel_name || 'CR API',
        provider: rowProvider || conn.panel_name || '',
        range: rowRange,
        country: rowCountry,
        currency: rowCurrency,
        source: 'cr_api',
        panel_id: conn.id,
        panel_name: conn.panel_name,
        timestamp: cleanDt || null,
        payout: Number.isFinite(payoutVal) ? payoutVal : undefined
      });
      if (ingestRes && ingestRes.logged) {
        pulled++;
      }
    }

    lastStatus = pulled > 0 ? `OK — pulled ${pulled} new message(s)` : 'Active — Up to date';
    crApiBackoff.delete(connId);
  } catch (err) {
    lastStatus = `Error — ${String(err.message).slice(0, 180)}`;
    const prev = crApiBackoff.get(connId) || { errors: 0, nextAllowedAt: 0 };
    const errs = Math.min(prev.errors + 1, 6);
    const baseSec = Math.max(5, parseInt(conn.interval) || 10);
    const delaySec = Math.min(120, baseSec * Math.pow(2, errs - 1));
    crApiBackoff.set(connId, { errors: errs, nextAllowedAt: Date.now() + delaySec * 1000 });
  } finally {
    crApiInFlight.delete(connId);
  }

  // Merge ONLY runtime stats onto fresh DB record (never overwrite active/token/url edited while in-flight)
  const allConns = readDb('cr_api_connections') || [];
  const idx = allConns.findIndex(c => Number(c.id) === Number(connId));
  if (idx !== -1) {
    allConns[idx] = {
      ...allConns[idx],
      last_pulled_at: pulledAt,
      last_status: lastStatus,
      total_pulled: (allConns[idx].total_pulled || 0) + pulled
    };
    writeDb('cr_api_connections', allConns);
  }
  return pulled;
}

// Background poller intervals — controlled cadence with in-flight locks & exponential error backoff
setInterval(async () => {
  try {
    const panels = readDb('login_panels') || [];
    const now = Date.now();
    for (const p of panels) {
      if (p.status !== 'running') continue;
      if (loginPanelsInFlight.has(p.id)) continue;
      const bo = loginPanelBackoff.get(p.id);
      if (bo && now < bo.nextAllowedAt) continue;
      const intervalSec = Math.max(10, parseInt(p.interval) || 15);
      const lastRunMs = p.last_run ? new Date(p.last_run).getTime() : 0;
      if (now - lastRunMs >= intervalSec * 1000) {
        pollSingleLoginPanel(p.id)
          .catch(e => console.error('Login panel worker error:', e));
      }
    }
  } catch (e) {
    console.error('Login panel poller loop error:', e);
  }
}, 2000);

setInterval(async () => {
  try {
    const conns = readDb('cr_api_connections') || [];
    const now = Date.now();
    for (const c of conns) {
      if (!c.active) continue;
      if (crApiInFlight.has(c.id)) continue;
      const bo = crApiBackoff.get(c.id);
      if (bo && now < bo.nextAllowedAt) continue;
      const intervalSec = c.interval ? Math.max(5, parseInt(c.interval)) : 10;
      const lastPullMs = c.last_pulled_at ? new Date(c.last_pulled_at).getTime() : 0;
      if (now - lastPullMs >= intervalSec * 1000) {
        pollSingleCrApiConnection(c.id)
          .catch(e => console.error('CR API poller error:', e));
      }
    }
  } catch (e) {
    console.error('CR API poller loop error:', e);
  }
}, 2500);

// ── Whitenoise Pure-Node Provider Adapter (Mode A API + Mode B Web Feed Hybrid) ──
const whitenoiseInFlight = new Set();
const whitenoisePhoneCooldown = new Map();
const whitenoiseRoundRobinCursor = new Map();
const whitenoiseClientCursor = new Map();
const whitenoisePoolCursor = new Map();
const whitenoiseLastClientSweepAt = new Map();
const whitenoiseLastPoolSweepAt = new Map();
const whitenoiseOnDemandFetchedAt = new Map();
const whitenoiseWebLoginPromises = new Map();
const whitenoiseWebInFlightPromises = new Map();
const whitenoiseWebPhoneCache = new Map();
const whitenoiseWebBackoffUntil = new Map();

function formatWhitenoisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '').replace(/^00+/, '');
  if (!digits) return '';
  return '+' + digits;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function parseWhitenoiseWebSmsHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const bodySlice = tbodyMatch ? tbodyMatch[1] : html;
  const rows = [];
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(bodySlice)) !== null) {
    const trHtml = trMatch[1];
    if (/<th\b/i.test(trHtml)) continue;
    const cells = [];
    const tdRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(trHtml)) !== null) {
      const stripped = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      cells.push(decodeHtmlEntities(stripped));
    }
    // Columns: #, Service, Source, Destination, SMSC, Text, Provider, Time sent, Time received
    if (cells.length >= 8) {
      const destDigits = String(cells[3] || '').replace(/\D/g, '');
      if (destDigits.length < 6 || !cells[5]) continue;
      rows.push({
        rowNum: cells[0] || '',
        service_name: cells[1] || '',
        src: cells[2] || '',
        dst: formatWhitenoisePhone(cells[3]),
        smsc: cells[4] || '',
        text: cells[5] || '',
        provider_col: cells[6] || '',
        time_sent: cells[7] || '',
        time_received: cells[8] || cells[7] || ''
      });
    }
  }
  return rows;
}

function normalizeWhitenoiseWebBaseUrl(rawUrl) {
  let u = String(rawUrl || 'https://whitenoise.one').trim().replace(/\/+$/, '');
  if (!u) u = 'https://whitenoise.one';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  // Prevent double /sms/sms if user enters https://whitenoise.one/sms
  u = u.replace(/\/sms$/i, '');
  return u;
}

function mergeCookieHeader(existingCookie, setCookieHeaders) {
  const jar = new Map();
  const addPair = (raw) => {
    const first = String(raw || '').split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq > 0) {
      const k = first.slice(0, eq).trim();
      const v = first.slice(eq + 1).trim();
      if (k) jar.set(k, v);
    }
  };
  if (existingCookie) {
    String(existingCookie).split(';').forEach(addPair);
  }
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
  list.forEach(addPair);
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function isWhitenoiseLoginHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const hasPassInput = /<input[^>]+type=["']?password["']?[^>]*>/i.test(html) || /<input[^>]+name=["']?password["']?[^>]*>/i.test(html);
  const hasEmailInput = /<input[^>]+name=["']?email["']?[^>]*>/i.test(html);
  const isLoginTitle = /<title>\s*Login\s*<\/title>/i.test(html);
  return (hasPassInput && hasEmailInput) || (isLoginTitle && hasPassInput);
}

async function loginWhitenoiseWebPanel(conn) {
  const lockKey = String(conn.id != null ? conn.id : (conn.web_email || 'default'));
  if (whitenoiseWebLoginPromises.has(lockKey)) {
    const sharedCookie = await whitenoiseWebLoginPromises.get(lockKey);
    conn.web_cookie = sharedCookie;
    return sharedCookie;
  }
  const runPromise = (async () => {
  const email = String(conn.web_email || '').trim();
  const password = String(conn.web_password || '');
  if (!email || !password) {
    throw new Error('Whitenoise Web Login requires both email and password.');
  }
  const loginBase = normalizeWhitenoiseWebBaseUrl(conn.web_login_url || conn.web_url || 'https://whitenoise.one');
  const loginEndpoint = String(conn.web_login_url || `${loginBase}/`).trim();
  const ua = String(conn.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  const timeoutMs = Math.max(3000, Math.min(60000, parseInt(conn.timeout_ms, 10) || 15000));

  // Step 1: GET login page to initialize APPSID cookie & extract any hidden fields
  let cookieJar = String(conn.web_cookie || '').trim();
  const hiddenFields = {};
  let postTarget = loginEndpoint;
  {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const getResp = await fetch(loginEndpoint, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(cookieJar ? { Cookie: cookieJar } : {})
        }
      });
      const sc = getResp.headers.getSetCookie ? getResp.headers.getSetCookie() : (getResp.headers.get('set-cookie') ? [getResp.headers.get('set-cookie')] : []);
      cookieJar = mergeCookieHeader(cookieJar, sc);
      const loginHtml = await getResp.text();
      const formTag = loginHtml.match(/<form\b[^>]*>/i)?.[0] || '';
      const act = formTag.match(/action=["']([^"']*)["']/i)?.[1] || '';
      if (act) postTarget = new URL(act, loginEndpoint).toString();
      const hiddenRe = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
      let hm;
      while ((hm = hiddenRe.exec(loginHtml)) !== null) {
        const tag = hm[0];
        const nm = tag.match(/name=["']([^"']+)["']/i)?.[1];
        const val = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? '';
        if (nm) hiddenFields[nm] = val;
      }
    } finally {
      clearTimeout(t);
    }
  }

  // Step 2: POST email + password form
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(hiddenFields)) form.append(k, v);
  form.append('email', email);
  form.append('password', password);

  const ctrl2 = new AbortController();
  const t2 = setTimeout(() => ctrl2.abort(), timeoutMs);
  let postResp;
  let postHtml = '';
  try {
    postResp = await fetch(postTarget, {
      method: 'POST',
      redirect: 'manual',
      signal: ctrl2.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': loginEndpoint,
        'Origin': new URL(postTarget).origin,
        ...(cookieJar ? { Cookie: cookieJar } : {})
      },
      body: form.toString()
    });
    const sc2 = postResp.headers.getSetCookie ? postResp.headers.getSetCookie() : (postResp.headers.get('set-cookie') ? [postResp.headers.get('set-cookie')] : []);
    cookieJar = mergeCookieHeader(cookieJar, sc2);
    postHtml = await postResp.text();
  } finally {
    clearTimeout(t2);
  }

  const loc = postResp.headers.get('location') || '';
  if (postResp.status >= 400 || /incorrect username or password/i.test(postHtml) || (!loc && isWhitenoiseLoginHtml(postHtml))) {
    throw new Error('Whitenoise web login rejected — check your Whitenoise email and password.');
  }

  // Persist refreshed session cookie on connection record
  conn.web_cookie = cookieJar;
  if (conn.id != null) {
    const allConns = readDb('whitenoise_connections') || [];
    const idx = allConns.findIndex(c => Number(c.id) === Number(conn.id));
    if (idx !== -1) {
      allConns[idx].web_cookie = cookieJar;
      writeDb('whitenoise_connections', allConns);
    }
  }
  return cookieJar;
  })();
  whitenoiseWebLoginPromises.set(lockKey, runPromise);
  try {
    return await runPromise;
  } finally {
    if (whitenoiseWebLoginPromises.get(lockKey) === runPromise) {
      whitenoiseWebLoginPromises.delete(lockKey);
    }
  }
}

async function callWhitenoiseApi(conn, endpointPath, payload = {}, method = 'POST') {
  const baseUrl = String(conn.base_url || 'https://api.whitenoise.one').trim().replace(/\/+$/, '');
  const fullPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const apiKey = String(conn.api_key || '').trim();
  const reqBody = { api_key: apiKey, ...payload };
  const timeoutMs = Math.max(3000, Math.min(60000, parseInt(conn.timeout_ms, 10) || 15000));
  const ua = String(conn.user_agent || 'HUMEX-SMS-Whitenoise/1.0');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let targetUrl = `${baseUrl}${fullPath}`;
    const opts = {
      method: method.toUpperCase(),
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': ua,
        ...(apiKey ? { 'X-Api-Key': apiKey } : {})
      }
    };
    if (opts.method === 'GET') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(reqBody)) {
        if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
      }
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + qs.toString();
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(reqBody);
    }

    const resp = await fetch(targetUrl, opts);
    const rawText = await resp.text();
    let json = {};
    try { json = JSON.parse(rawText); } catch (_) { json = { raw: rawText }; }
    if (!resp.ok || (json && json.status && String(json.status).toLowerCase() !== 'ok')) {
      let errMsg = (json && (json.error || json.message || json.detail)) || `HTTP ${resp.status}`;
      if (resp.status === 403 && /permission|access|forbidden/i.test(String(errMsg))) {
        errMsg = `${errMsg} (Check API Key & whitelist this server IP in Whitenoise API settings, or switch to Web Panel Login mode.)`;
      }
      const err = new Error(String(errMsg));
      err.httpStatus = resp.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrency(items, concurrency, workerFn) {
  const cap = Math.max(1, Math.min(20, parseInt(concurrency, 10) || 6));
  let idx = 0;
  const results = new Array(items.length);
  const runners = Array.from({ length: Math.min(cap, items.length || 1) }, async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      try {
        results[myIdx] = await workerFn(items[myIdx], myIdx);
      } catch (e) {
        results[myIdx] = { error: e.message };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function sendWhitenoiseConversionNonBlocking(conn, { smsId, phone, serviceName, logEntryId }) {
  if (!conn || !conn.api_key || conn.conversion_mode === 'off') return;
  if (smsId == null || smsId === '' || isNaN(Number(smsId))) return;
  const body = {
    sms_id: Number(smsId),
    phone: formatWhitenoisePhone(phone)
  };
  if (serviceName) body.service_name = String(serviceName);
  callWhitenoiseApi(conn, '/sms/register-sms-conversion', body, 'POST')
    .then(res => {
      if (res && res.conversion !== false && logEntryId != null) {
        const smsLog = readDb('sms_log') || [];
        const rec = smsLog.find(s => Number(s.id) === Number(logEntryId));
        if (rec) {
          rec.conversion_sent = true;
          rec.conversion_at = new Date().toISOString();
          debouncedWriteDb('sms_log');
        }
      }
    })
    .catch(err => {
      console.warn(`[Whitenoise conversion warning] sms_id=${smsId}:`, err.message);
    });
}

async function fetchWhitenoiseSinglePhone(conn, rawPhone, opts = {}) {
  const formattedPhone = formatWhitenoisePhone(rawPhone);
  if (!formattedPhone) {
    return { checked: false, skipped: 'invalid_phone', new_sms: 0, conversions: 0, sms_count: null, latest_sms: [] };
  }
  const cooldownMs = opts.cooldownMs != null ? Number(opts.cooldownMs) : 15000;
  const cooldownKey = `${conn.id}:${formattedPhone}`;
  const nowMs = Date.now();
  const lastAt = whitenoisePhoneCooldown.get(cooldownKey) || 0;
  if (!opts.bypassCooldown && cooldownMs > 0 && (nowMs - lastAt) < cooldownMs) {
    const remainSec = Math.ceil((cooldownMs - (nowMs - lastAt)) / 1000);
    return { checked: false, cooldown_active: true, retry_after_sec: remainSec, new_sms: 0, conversions: 0, sms_count: null, latest_sms: [] };
  }
  whitenoisePhoneCooldown.set(cooldownKey, nowMs);
  if (opts.onDemand) {
    const digits = formattedPhone.replace(/\D/g, '');
    if (digits) whitenoiseOnDemandFetchedAt.set(`${conn.id}:${digits}`, nowMs);
  }

  const sinceSec = Math.max(15, Math.min(600, parseInt(opts.since ?? conn.since ?? conn.since_seconds ?? 600, 10) || 600));
  const payload = { phone: formattedPhone, since: sinceSec };
  const svc = opts.service_name || conn.default_service_name || '';
  if (svc) payload.service_name = svc;

  const data = await callWhitenoiseApi(conn, '/sms/get-phone-last-sms', payload, 'POST');
  let smsCount = null;
  if (opts.includeCount) {
    try {
      const cntRes = await callWhitenoiseApi(conn, '/sms/get-phone-sms-count', { phone: formattedPhone }, 'POST');
      if (cntRes && cntRes.count !== undefined) smsCount = Number(cntRes.count);
    } catch (_) {}
  }

  const rawRows = Array.isArray(data && data.sms) ? data.sms : [];
  // Sort ascending by numeric id so newest is processed last (and unshifted to top)
  const ordered = [...rawRows].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  const newEntries = [];
  let conversions = 0;
  const shouldIngest = opts.ingest !== false;

  if (shouldIngest) {
    for (const row of ordered) {
      if (!row || !row.text) continue;
      const wnId = row.id != null ? String(row.id) : md5(`${row.dst || formattedPhone}|${row.time || ''}|${row.text}`).slice(0, 16);
      const extKey = `wn-${conn.id}-${wnId}`;
      const targetDst = formatWhitenoisePhone(row.dst || formattedPhone);
      const ingestRes = ingestSms({
        sender: row.src || row.service_name || 'Whitenoise',
        to_number: targetDst,
        message: row.text,
        sms_id: wnId,
        company: conn.name || 'Whitenoise',
        provider: conn.provider_tag || conn.name || 'Whitenoise',
        country: row.country || '',
        source: 'whitenoise',
        panel_id: conn.id,
        panel_name: conn.name || 'Whitenoise',
        ext_key: extKey,
        timestamp: row.time || new Date().toISOString(),
        whitenoise_sms_id: row.id != null ? Number(row.id) : null
      });

      if (ingestRes && ingestRes.logged && ingestRes.entry) {
        newEntries.push(ingestRes.entry);
        const convMode = String(conn.conversion_mode || 'on_client_match').toLowerCase();
        const shouldConvert = convMode === 'always' || (convMode === 'on_client_match' && ingestRes.entry.client_id != null);
        if (shouldConvert && row.id != null && !isNaN(Number(row.id))) {
          conversions++;
          sendWhitenoiseConversionNonBlocking(conn, {
            smsId: row.id,
            phone: targetDst,
            serviceName: row.service_name || svc || '',
            logEntryId: ingestRes.entry.id
          });
        }
      }
    }
  }

  return {
    checked: true,
    phone: formattedPhone,
    sms_count: smsCount,
    fetched_count: ordered.length,
    new_sms: newEntries.length,
    conversions,
    latest_sms: rawRows
  };
}

function formatWhitenoiseWebTime(dateObj) {
  const pad = n => String(n).padStart(2, '0');
  return `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth() + 1)}-${pad(dateObj.getUTCDate())}.${pad(dateObj.getUTCHours())}.${pad(dateObj.getUTCMinutes())}`;
}

function buildWhitenoiseWebSmsUrl(smsBaseUrl, opts = {}) {
  if (smsBaseUrl.includes('?') && !opts.filterPhone) return smsBaseUrl;
  const now = new Date();
  const windowMin = Math.max(5, parseInt(opts.windowMinutes, 10) || 1440);
  // Use UTC start-of-day (or wider lookback if requested) and UTC start-of-tomorrow (+24h)
  // so timezone differences (e.g. Whitenoise UTC+3 vs UTC) never cut off fresh incoming SMS.
  const todayMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const lookbackDt = new Date(now.getTime() - windowMin * 60000);
  const startDt = lookbackDt < todayMidnightUtc ? lookbackDt : todayMidnightUtc;
  const endDt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

  const qs = new URLSearchParams();
  const targetPhone = opts.filterPhone ? formatWhitenoisePhone(opts.filterPhone) : '';
  if (targetPhone) qs.set('sms_to', targetPhone);
  qs.set('dup', String(opts.dup != null ? opts.dup : 2));
  qs.set('sms_time_start', formatWhitenoiseWebTime(startDt));
  qs.set('sms_time_end', formatWhitenoiseWebTime(endDt));
  qs.set('order', 'id:desc');
  const baseClean = smsBaseUrl.split('?')[0];
  return `${baseClean}?${qs.toString()}`;
}

async function pollWhitenoiseWebFeed(conn, opts = {}) {
  const hasWebLogin = Boolean(conn.web_email && conn.web_password);
  if (!conn.web_cookie && !hasWebLogin) {
    throw new Error('Whitenoise Web Feed requires Email + Password or an APPSID Session Cookie.');
  }

  const targetPhone = opts.filterPhone ? formatWhitenoisePhone(opts.filterPhone) : '';
  const connKey = String(conn.id != null ? conn.id : (conn.web_email || 'default'));
  const cacheKey = `${connKey}:${targetPhone || '__all__'}`;
  const nowMs = Date.now();

  // Respect temporary rate-limit backoff if Whitenoise returned HTTP 429
  const backoffUntil = whitenoiseWebBackoffUntil.get(connKey) || 0;
  if (!opts.bypassCooldown && backoffUntil > nowMs) {
    const waitSec = Math.ceil((backoffUntil - nowMs) / 1000);
    return { rows_parsed: 0, new_sms: 0, rows: [], rate_limited: true, retry_after_sec: waitSec };
  }

  // Serve from short per-number cache (protects Whitenoise under 200-500 req/min burst load)
  const cacheTtlMs = opts.cacheTtlMs != null ? Number(opts.cacheTtlMs) : (targetPhone ? 10000 : 0);
  if (!opts.bypassCooldown && cacheTtlMs > 0) {
    const cached = whitenoiseWebPhoneCache.get(cacheKey);
    if (cached && (nowMs - cached.ts) < cacheTtlMs) {
      return { ...cached.result, cached: true, cooldown_active: true };
    }
  }

  // Deduplicate concurrent identical requests for the same (connection, phone)
  if (whitenoiseWebInFlightPromises.has(cacheKey)) {
    return whitenoiseWebInFlightPromises.get(cacheKey);
  }

  const runPromise = (async () => {
    const baseWeb = normalizeWhitenoiseWebBaseUrl(conn.web_login_url || conn.web_url || 'https://whitenoise.one');
    const smsBaseUrl = String(conn.web_sms_url || `${baseWeb}/sms`).trim().replace(/\/+$/, '');
    const windowedUrl = buildWhitenoiseWebSmsUrl(smsBaseUrl, {
      filterPhone: targetPhone,
      windowMinutes: opts.windowMinutes ?? conn.web_window_minutes ?? 1440,
      dup: opts.dup != null ? opts.dup : 2
    });
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(conn.timeout_ms, 10) || 20000));
    const ua = String(conn.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

    if (!conn.web_cookie && hasWebLogin) {
      await loginWhitenoiseWebPanel(conn);
    }

    const fetchSmsHtml = async (urlToHit) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(urlToHit, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'Cookie': String(conn.web_cookie || '').trim(),
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': `${baseWeb}/sms`
          }
        });
        const text = await resp.text();
        return { status: resp.status, location: resp.headers.get('location') || '', html: text };
      } finally {
        clearTimeout(timeout);
      }
    };

    let resObj = await fetchSmsHtml(windowedUrl);
    if (resObj.status === 429) {
      whitenoiseWebBackoffUntil.set(connKey, Date.now() + 20000);
      throw new Error('Whitenoise Web rate limited (HTTP 429) — cooling down 20s automatically.');
    }
    const needsReauth = resObj.status === 401 || resObj.status === 403 || (resObj.status >= 300 && resObj.status < 400) || isWhitenoiseLoginHtml(resObj.html);
    if (needsReauth) {
      if (hasWebLogin) {
        await loginWhitenoiseWebPanel(conn);
        resObj = await fetchSmsHtml(windowedUrl);
      }
      if (resObj.status === 429) {
        whitenoiseWebBackoffUntil.set(connKey, Date.now() + 20000);
        throw new Error('Whitenoise Web rate limited (HTTP 429) — cooling down 20s automatically.');
      }
      if (resObj.status === 401 || resObj.status === 403 || (resObj.status >= 300 && resObj.status < 400) || isWhitenoiseLoginHtml(resObj.html)) {
        throw new Error('Whitenoise web session expired or unauthorized — please verify Email/Password or paste a fresh APPSID cookie.');
      }
    }
    if (resObj.status < 200 || resObj.status >= 300) {
      throw new Error(`Web feed HTTP ${resObj.status}`);
    }

    let parsedRows = parseWhitenoiseWebSmsHtml(resObj.html);
    // Fallback: if time-filtered view returned 0 rows, try simpler query (sms_to+dup=2 for targeted, or bare /sms for global)
    if (parsedRows.length === 0) {
      const fallbackUrl = targetPhone
        ? `${smsBaseUrl.split('?')[0]}?sms_to=${encodeURIComponent(targetPhone)}&dup=2`
        : smsBaseUrl;
      if (fallbackUrl !== windowedUrl) {
        const bareRes = await fetchSmsHtml(fallbackUrl);
        if (bareRes.status >= 200 && bareRes.status < 300 && !isWhitenoiseLoginHtml(bareRes.html)) {
          parsedRows = parseWhitenoiseWebSmsHtml(bareRes.html);
        }
      }
    }

    if (opts.onDemand && targetPhone) {
      const digits = targetPhone.replace(/\D/g, '');
      if (digits) whitenoiseOnDemandFetchedAt.set(`${conn.id}:${digits}`, Date.now());
    }

    const ordered = [...parsedRows].reverse();
    const shouldIngest = opts.ingest !== false;
    let newCount = 0;

    if (shouldIngest) {
      for (const row of ordered) {
        if (targetPhone && !phoneDigitsVariantsMatch(row.dst, targetPhone)) continue;
        const hashKey = md5(`${row.dst}|${row.src}|${row.time_received}|${row.text}`).slice(0, 16);
        const wnRowId = /^\d{4,}$/.test(String(row.rowNum || '').trim()) ? String(row.rowNum).trim() : '';
        const extKey = `wn-web-${conn.id}-${wnRowId || hashKey}`;
        const ingestRes = ingestSms({
          sender: row.src || row.service_name || 'Whitenoise',
          to_number: row.dst,
          message: row.text,
          sms_id: wnRowId || hashKey,
          company: conn.name || 'Whitenoise',
          provider: conn.provider_tag || conn.name || 'Whitenoise',
          source: 'whitenoise',
          panel_id: conn.id,
          panel_name: conn.name || 'Whitenoise',
          ext_key: extKey,
          timestamp: row.time_received || row.time_sent
        });
        if (ingestRes && ingestRes.logged) {
          newCount++;
          // Optional conversion lookup if api_key is present & client-matched
          if (conn.api_key && conn.conversion_mode !== 'off' && ingestRes.entry?.client_id != null) {
            callWhitenoiseApi(conn, '/sms/get-phone-last-sms', { phone: row.dst, since: 120 }, 'POST')
              .then(apiRes => {
                const list = Array.isArray(apiRes && apiRes.sms) ? apiRes.sms : [];
                const matched = list.find(x => x && String(x.text || '').trim() === String(row.text || '').trim());
                if (matched && matched.id != null) {
                  sendWhitenoiseConversionNonBlocking(conn, {
                    smsId: matched.id,
                    phone: row.dst,
                    serviceName: matched.service_name || row.service_name || '',
                    logEntryId: ingestRes.entry.id
                  });
                }
              })
              .catch(() => {});
          }
        }
      }
    }
    const result = { rows_parsed: parsedRows.length, new_sms: newCount, rows: parsedRows };
    if (targetPhone) {
      whitenoiseWebPhoneCache.set(cacheKey, { ts: Date.now(), result });
      if (whitenoiseWebPhoneCache.size > 2000) {
        const firstKey = whitenoiseWebPhoneCache.keys().next().value;
        if (firstKey) whitenoiseWebPhoneCache.delete(firstKey);
      }
    }
    return result;
  })();

  whitenoiseWebInFlightPromises.set(cacheKey, runPromise);
  try {
    return await runPromise;
  } finally {
    if (whitenoiseWebInFlightPromises.get(cacheKey) === runPromise) {
      whitenoiseWebInFlightPromises.delete(cacheKey);
    }
  }
}

function getNumbersForWhitenoiseConnection(conn, scopeFilter = {}) {
  const numbers = readDb('numbers') || [];
  const rangesMap = buildRangesLookupMap();
  const connTags = new Set(['whitenoise']);
  if (conn.provider_tag) connTags.add(String(conn.provider_tag).trim().toLowerCase());
  if (conn.name) connTags.add(String(conn.name).trim().toLowerCase());

  let list = numbers.filter(n => {
    if (!n || !n.number) return false;
    if (!isWhitenoiseRecord(n, rangesMap, connTags)) return false;
    if (scopeFilter.client_id != null && Number(n.client_id) !== Number(scopeFilter.client_id)) return false;
    if (scopeFilter.agent_id != null && Number(n.agent_id) !== Number(scopeFilter.agent_id)) return false;
    if (scopeFilter.range) {
      const rq = String(scopeFilter.range).trim().toLowerCase();
      const nRng = String(n.range_name || n.range || '').trim().toLowerCase();
      if (String(n.range_id || '') !== String(scopeFilter.range) && !nRng.includes(rq)) return false;
    }
    if (scopeFilter.number) {
      const nq = String(scopeFilter.number).replace(/\D/g, '');
      const nd = String(n.number || '').replace(/\D/g, '');
      if (nq && !nd.includes(nq)) return false;
    }
    return true;
  });

  // Priority sorting: 1. Client-assigned numbers, 2. Agent-assigned numbers, 3. Unassigned
  list.sort((a, b) => {
    const tierA = a.client_id ? 0 : (a.agent_id ? 1 : 2);
    const tierB = b.client_id ? 0 : (b.agent_id ? 1 : 2);
    if (tierA !== tierB) return tierA - tierB;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  return list;
}

async function pollSingleWhitenoiseConnection(connId, force = false) {
  const conns = readDb('whitenoise_connections') || [];
  const conn = conns.find(c => Number(c.id) === Number(connId));
  if (!conn || (!force && !conn.active)) return 0;
  let pulled = 0;
  let checkedCount = 0;
  let conversionsCount = 0;

  try {
    const mode = String(conn.mode || 'api_key').toLowerCase();
    const hasWebCreds = Boolean(conn.web_cookie || (conn.web_email && conn.web_password));
    let statusDetail = '';

    if ((mode === 'web_login' || mode === 'hybrid') && hasWebCreds) {
      const modeTag = mode === 'web_login' ? 'Web Login' : 'Hybrid';
      const webRes = await pollWhitenoiseWebFeed(conn);
      pulled += webRes.new_sms;
      checkedCount = webRes.rows_parsed || 0;

      // whitenoise.one/sms returns 0 rows unless ?sms_to=%2B<number>&dup=2 is passed.
      // When global scan returns 0 rows, automatically sweep active assigned Whitenoise numbers with safe concurrency cap.
      if (checkedCount === 0) {
        const wnNumbers = getNumbersForWhitenoiseConnection(conn);
        const nowMs = Date.now();
        let batch = [];
        if (force) {
          const cycleMax = Math.max(1, Math.min(60, parseInt(conn.max_numbers_per_cycle, 10) || 25));
          if (wnNumbers.length <= cycleMax) {
            batch = wnNumbers;
          } else {
            const cursor = whitenoiseRoundRobinCursor.get(conn.id) || 0;
            for (let i = 0; i < cycleMax; i++) batch.push(wnNumbers[(cursor + i) % wnNumbers.length]);
            whitenoiseRoundRobinCursor.set(conn.id, (cursor + cycleMax) % wnNumbers.length);
          }
        } else {
          const skipRecentOnDemand = (numObj) => {
            const d = String(numObj?.number || '').replace(/\D/g, '');
            if (!d) return false;
            const lastOd = whitenoiseOnDemandFetchedAt.get(`${conn.id}:${d}`) || 0;
            return (nowMs - lastOd) < 120000;
          };
          const clientNums = wnNumbers.filter(n => Boolean(n.client_id) && !skipRecentOnDemand(n));
          const poolNums = wnNumbers.filter(n => !n.client_id && !skipRecentOnDemand(n));
          const clientIntervalMs = Math.max(30, parseInt(conn.client_interval_sec ?? conn.interval, 10) || 120) * 1000;
          const poolIntervalMs = Math.max(60, parseInt(conn.pool_interval_sec, 10) || 360) * 1000;
          const pickBatch = (list, cursorMap, cap) => {
            if (!list.length) return [];
            if (list.length <= cap) return list.slice();
            const cur = cursorMap.get(conn.id) || 0;
            const picked = [];
            for (let i = 0; i < cap; i++) picked.push(list[(cur + i) % list.length]);
            cursorMap.set(conn.id, (cur + cap) % list.length);
            return picked;
          };
          const lastClientAt = whitenoiseLastClientSweepAt.get(conn.id) || 0;
          if (clientNums.length > 0 && (nowMs - lastClientAt) >= clientIntervalMs) {
            whitenoiseLastClientSweepAt.set(conn.id, nowMs);
            batch.push(...pickBatch(clientNums, whitenoiseClientCursor, Math.min(12, parseInt(conn.max_numbers_per_cycle, 10) || 12)));
          }
          const lastPoolAt = whitenoiseLastPoolSweepAt.get(conn.id) || 0;
          if (poolNums.length > 0 && (nowMs - lastPoolAt) >= poolIntervalMs) {
            whitenoiseLastPoolSweepAt.set(conn.id, nowMs);
            batch.push(...pickBatch(poolNums, whitenoisePoolCursor, 10));
          }
        }

        if (batch.length > 0) {
          const effConcurrency = Math.min(4, Math.max(1, parseInt(conn.concurrency, 10) || 4));
          const sweepResults = await runWithConcurrency(batch, effConcurrency, (numObj) =>
            pollWhitenoiseWebFeed(conn, { filterPhone: numObj.number, bypassCooldown: force })
          );
          let numsSwept = 0;
          let rowsFound = 0;
          let firstErr = '';
          for (const r of sweepResults) {
            if (r && r.error && !firstErr) firstErr = r.error;
            if (r && !r.error) {
              numsSwept++;
              rowsFound += Number(r.rows_parsed || 0);
              pulled += Number(r.new_sms || 0);
            }
          }
          checkedCount = rowsFound || numsSwept;
          if (numsSwept === 0 && firstErr) throw new Error(firstErr);
          statusDetail = pulled > 0
            ? `OK (${modeTag}) — pulled ${pulled} new SMS across ${numsSwept} number(s)`
            : `Active (${modeTag}) — checked ${numsSwept} number(s) (${rowsFound} row(s))`;
        } else {
          statusDetail = `Active (${modeTag}) — logged in (ready for per-number sms_to fetch)`;
        }
      } else {
        statusDetail = webRes.new_sms > 0
          ? `OK (${modeTag}) — pulled ${webRes.new_sms} new from ${webRes.rows_parsed} web row(s)`
          : `Active (${modeTag}) — scanned ${webRes.rows_parsed} web row(s)`;
      }
    } else if (conn.api_key) {
      const wnNumbers = getNumbersForWhitenoiseConnection(conn);
      const nowMs = Date.now();
      let batch = [];

      if (force) {
        const cycleMax = Math.max(1, Math.min(200, parseInt(conn.max_numbers_per_cycle, 10) || 40));
        if (wnNumbers.length <= cycleMax) {
          batch = wnNumbers;
        } else {
          const cursor = whitenoiseRoundRobinCursor.get(conn.id) || 0;
          for (let i = 0; i < cycleMax; i++) {
            batch.push(wnNumbers[(cursor + i) % wnNumbers.length]);
          }
          whitenoiseRoundRobinCursor.set(conn.id, (cursor + cycleMax) % wnNumbers.length);
        }
      } else {
        const skipRecentOnDemand = (numObj) => {
          const d = String(numObj?.number || '').replace(/\D/g, '');
          if (!d) return false;
          const lastOd = whitenoiseOnDemandFetchedAt.get(`${conn.id}:${d}`) || 0;
          return (nowMs - lastOd) < 180000;
        };
        const clientNums = wnNumbers.filter(n => Boolean(n.client_id) && !skipRecentOnDemand(n));
        const poolNums = wnNumbers.filter(n => !n.client_id && !skipRecentOnDemand(n));

        const clientIntervalMs = Math.max(30, parseInt(conn.client_interval_sec ?? conn.interval, 10) || 240) * 1000;
        const poolIntervalMs = Math.max(60, parseInt(conn.pool_interval_sec, 10) || 540) * 1000;

        const pickBatch = (list, cursorMap, cap) => {
          if (!list.length) return [];
          if (list.length <= cap) return list.slice();
          const cur = cursorMap.get(conn.id) || 0;
          const picked = [];
          for (let i = 0; i < cap; i++) picked.push(list[(cur + i) % list.length]);
          cursorMap.set(conn.id, (cur + cap) % list.length);
          return picked;
        };

        const lastClientAt = whitenoiseLastClientSweepAt.get(conn.id) || 0;
        if (clientNums.length > 0 && (nowMs - lastClientAt) >= clientIntervalMs) {
          whitenoiseLastClientSweepAt.set(conn.id, nowMs);
          const clientCap = Math.min(15, parseInt(conn.max_numbers_per_cycle, 10) || 15);
          batch.push(...pickBatch(clientNums, whitenoiseClientCursor, clientCap));
        }

        const lastPoolAt = whitenoiseLastPoolSweepAt.get(conn.id) || 0;
        if (poolNums.length > 0 && (nowMs - lastPoolAt) >= poolIntervalMs) {
          whitenoiseLastPoolSweepAt.set(conn.id, nowMs);
          batch.push(...pickBatch(poolNums, whitenoisePoolCursor, 20));
        }
      }

      if (batch.length > 0) {
        const effConcurrency = force ? Math.min(6, conn.concurrency || 6) : Math.min(3, conn.concurrency || 3);
        const resList = await runWithConcurrency(batch, effConcurrency, (numObj) =>
          fetchWhitenoiseSinglePhone(conn, numObj.number, {
            bypassCooldown: force,
            since: conn.since || 600
          })
        );
        let firstErr = '';
        for (const r of resList) {
          if (r && r.error && !firstErr) firstErr = r.error;
          if (r && r.checked !== false && !r.error) checkedCount++;
          if (r && r.new_sms) pulled += r.new_sms;
          if (r && r.conversions) conversionsCount += r.conversions;
        }
        if (checkedCount === 0 && firstErr) {
          throw new Error(firstErr);
        }
        statusDetail = pulled > 0
          ? `OK — pulled ${pulled} new SMS across ${checkedCount} number(s)`
          : (firstErr ? `Partial — swept ${checkedCount}/${batch.length} (${firstErr.slice(0, 90)})` : `Active — swept ${checkedCount} number(s)`);
      } else if (force) {
        statusDetail = 'Connected — No Whitenoise numbers assigned yet (add numbers under a Whitenoise range or use Test Number)';
      } else {
        statusDetail = conn.last_status || 'Idle (waiting for next paced sweep or on-demand fetch)';
      }
    } else {
      statusDetail = 'Warning — Missing API Key or Web Login / Session Cookie';
    }

    conn.last_pulled_at = new Date().toISOString();
    conn.last_status = statusDetail;
    conn.total_pulled = (conn.total_pulled || 0) + pulled;
    conn.total_conversions = (conn.total_conversions || 0) + conversionsCount;
    conn._last_checked = checkedCount;
    conn._last_conversions = conversionsCount;
  } catch (err) {
    conn.last_pulled_at = new Date().toISOString();
    conn.last_status = `Error — ${String(err.message).slice(0, 220)}`;
    conn._last_checked = checkedCount;
    conn._last_conversions = conversionsCount;
  }

  const allConns = readDb('whitenoise_connections') || [];
  const idx = allConns.findIndex(c => Number(c.id) === Number(connId));
  if (idx !== -1) {
    const { _last_checked, _last_conversions, ...persistable } = conn;
    allConns[idx] = persistable;
    writeDb('whitenoise_connections', allConns);
  }
  return pulled;
}

// NOTE: Automatic Whitenoise background API/Web polling has been retired (zero VPS background load).
// Whitenoise (CDR 2) operates in Excel-Only Daily Stats mode via /api/whitenoise-excel/* endpoints.
// Manual /api/whitenoise-connections/:id/pull and /api/cdr2/sync remain available if explicitly triggered.

// ════════════════════════════════════════════════════════════════════
//  WHITENOISE (CDR 2) EXCEL-ONLY DAILY STATS & DATE-OWNERSHIP ENGINE
// ════════════════════════════════════════════════════════════════════
const NUMBER_OWNERSHIP_SNAPSHOT = new Map();
let NUMBER_OWNERSHIP_SNAPSHOT_READY = false;
let SUPPRESS_OWNERSHIP_LEDGER_HOOK = false;
const WHITENOISE_PREVIEW_CACHE = new Map();
const WHITENOISE_PREVIEW_TTL_MS = 20 * 60 * 1000;

function normalizePhoneDigits(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' && Number.isFinite(val)) {
    return String(Math.trunc(val)).replace(/\D/g, '');
  }
  const s = String(val).trim();
  if (!s) return '';
  // Handle Excel scientific notation strings like "5.25644310154E+11"
  if (/^\+?\d+(?:\.\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.trunc(n)).replace(/\D/g, '');
  }
  return s.replace(/\D/g, '');
}

function normalizeServiceKey(val) {
  const s = String(val || '').trim();
  if (!s) return 'general';
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function getBusinessDateYmd(dateRef = new Date()) {
  try {
    const settings = readDb('settings') || {};
    const tz = (settings && typeof settings === 'object' && settings.timezone) ? String(settings.timezone) : 'Asia/Karachi';
    const d = dateRef instanceof Date ? dateRef : new Date(dateRef);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const ymd = fmt.format(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  } catch (_) {}
  try {
    const d = dateRef instanceof Date ? dateRef : new Date(dateRef);
    return d.toISOString().slice(0, 10);
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

function refreshNumberOwnershipSnapshot(numbersArr) {
  NUMBER_OWNERSHIP_SNAPSHOT.clear();
  for (const n of (numbersArr || [])) {
    if (!n) continue;
    const digits = normalizePhoneDigits(n.number);
    if (!digits) continue;
    NUMBER_OWNERSHIP_SNAPSHOT.set(digits, {
      agent_id: n.agent_id ? Number(n.agent_id) : null,
      client_id: n.client_id ? Number(n.client_id) : null,
      range_id: n.range_id ? Number(n.range_id) : null
    });
  }
  NUMBER_OWNERSHIP_SNAPSHOT_READY = true;
}

function getLedgerNextSeq(ledger) {
  let max = 0;
  for (const e of (ledger || [])) {
    const s = Number(e && e.event_seq);
    if (Number.isFinite(s) && s > max) max = s;
  }
  return max + 1;
}

function buildOwnershipRateSnapshotForNumber(numObj, ctx = null) {
  const ranges = ctx ? ctx.ranges : (readDb('sms_ranges') || []);
  const agents = ctx ? ctx.agents : (readDb('agents') || []);
  const clients = ctx ? ctx.clients : (readDb('clients') || []);
  const fx = ctx ? ctx.fxRate : getUsdToPkrRate();

  const rng = (numObj.range_id && ranges.find(r => Number(r.id) === Number(numObj.range_id))) ||
    (numObj.range_name && ranges.find(r => String(r.range_name || r.name || '').toLowerCase() === String(numObj.range_name || '').toLowerCase())) ||
    null;

  const agentId = numObj.agent_id ? Number(numObj.agent_id) : null;
  const clientId = numObj.client_id ? Number(numObj.client_id) : null;
  const agObj = agentId ? agents.find(a => Number(a.id) === agentId) : null;
  const clObj = clientId ? clients.find(c => Number(c.id) === clientId) : null;

  const ownerCostUsd = Number(rng?.cost ?? rng?.company_cost ?? numObj.company_rate ?? numObj.cost ?? 0) || 0;
  let agentRateUsd = 0;
  if (agentId) {
    agentRateUsd = Number(numObj.agent_rate || numObj.payout || 0) || getRangeAgentRate(rng, 'Monthly') || Number(rng?.payout || 0) || 0;
  } else {
    agentRateUsd = Number(numObj.agent_rate || 0) || getRangeAgentRate(rng, 'Monthly') || Number(rng?.payout || 0) || 0;
  }

  let clientRatePkr = 0;
  if (clientId) {
    if (Number(numObj.client_rate_pkr) > 0) {
      clientRatePkr = round2(Number(numObj.client_rate_pkr));
    } else if (Number(numObj.client_rate || numObj.client_payout) > 0) {
      clientRatePkr = round2(Number(numObj.client_rate || numObj.client_payout) * (Number(numObj.fx_usd_to_pkr) || fx));
    } else {
      const rp = resolveClientRatePair({
        agentId,
        rangeId: numObj.range_id || (rng && rng.id),
        rangeName: numObj.range_name || (rng && rng.range_name),
        payterm: 'Monthly',
        agentRateUsd,
        clientRecord: clObj
      });
      if (rp && !rp.error && Number(rp.client_rate_pkr) > 0) {
        clientRatePkr = round2(Number(rp.client_rate_pkr));
      }
    }
  }

  return {
    agent_id: agentId,
    agent_name: agObj?.username || numObj.agent_username || numObj.agent_name || '',
    client_id: clientId,
    client_name: clObj?.username || numObj.client_username || numObj.client_name || numObj.user || '',
    range_id: numObj.range_id ? Number(numObj.range_id) : (rng ? Number(rng.id) : null),
    range_name: numObj.range_name || rng?.range_name || rng?.name || numObj.country || '',
    owner_cost_usd: round4(ownerCostUsd),
    agent_rate_usd: round4(agentRateUsd),
    client_rate_pkr: round2(clientRatePkr),
    fx_usd_to_pkr: round2(Number(numObj.fx_usd_to_pkr) || fx)
  };
}

function syncNumberOwnershipLedgerOnWrite(nextNumbers, opts = {}) {
  if (!Array.isArray(nextNumbers)) return;
  if (!NUMBER_OWNERSHIP_SNAPSHOT_READY) {
    refreshNumberOwnershipSnapshot(nextNumbers);
    return;
  }

  const eventDate = normalizeYmd(opts.eventDate) || getBusinessDateYmd();
  const actor = opts.actor || 'System';
  const changed = [];

  for (const n of nextNumbers) {
    if (!n) continue;
    const digits = normalizePhoneDigits(n.number);
    if (!digits) continue;
    const prev = NUMBER_OWNERSHIP_SNAPSHOT.get(digits) || { agent_id: null, client_id: null, range_id: null };
    const nextAg = n.agent_id ? Number(n.agent_id) : null;
    const nextCl = n.client_id ? Number(n.client_id) : null;

    if (prev.agent_id !== nextAg || prev.client_id !== nextCl) {
      let action = 'update';
      if (!prev.agent_id && nextAg && !nextCl) action = 'assign_agent';
      else if (!prev.client_id && nextCl) action = 'assign_client';
      else if (prev.client_id && nextCl && prev.client_id !== nextCl) action = 'transfer';
      else if (prev.client_id && !nextCl && nextAg) action = 'return_to_agent';
      else if ((prev.agent_id || prev.client_id) && !nextAg && !nextCl) action = 'unassign';
      else if (prev.agent_id !== nextAg && nextAg) action = 'assign_agent';
      changed.push({ n, digits, action });
    }
  }

  if (changed.length > 0) {
    const ledger = readDb('number_ownership_ledger') || [];
    let seq = getLedgerNextSeq(ledger);
    let idCounter = nextId(ledger, 'number_ownership_ledger');
    const ctx = {
      ranges: readDb('sms_ranges') || [],
      agents: readDb('agents') || [],
      clients: readDb('clients') || [],
      fxRate: getUsdToPkrRate()
    };
    const nowIso = new Date().toISOString();
    for (const item of changed) {
      const snap = buildOwnershipRateSnapshotForNumber(item.n, ctx);
      ledger.push({
        id: idCounter++,
        number_digits: item.digits,
        number: String(item.n.number || item.digits),
        event_date: eventDate,
        event_seq: seq++,
        action: opts.action || item.action,
        ...snap,
        actor,
        created_at: nowIso
      });
    }
    writeDb('number_ownership_ledger', ledger);
  }

  refreshNumberOwnershipSnapshot(nextNumbers);
}

function recordExplicitOwnershipEvent({ number, event_date, action, agent_id, client_id, range_id, owner_cost_usd, agent_rate_usd, client_rate_pkr, fx_usd_to_pkr, actor = 'Owner' }) {
  const digits = normalizePhoneDigits(number);
  if (!digits) throw new Error('Valid phone number is required');
  const ymd = normalizeYmd(event_date) || getBusinessDateYmd();
  const numbers = readDb('numbers') || [];
  const numObj = numbers.find(n => normalizePhoneDigits(n.number) === digits) || { number: digits };
  const ctx = {
    ranges: readDb('sms_ranges') || [],
    agents: readDb('agents') || [],
    clients: readDb('clients') || [],
    fxRate: getUsdToPkrRate()
  };

  const mergedNum = {
    ...numObj,
    agent_id: agent_id !== undefined ? (agent_id ? Number(agent_id) : null) : (numObj.agent_id ? Number(numObj.agent_id) : null),
    client_id: client_id !== undefined ? (client_id ? Number(client_id) : null) : (numObj.client_id ? Number(numObj.client_id) : null),
    range_id: range_id !== undefined ? (range_id ? Number(range_id) : null) : (numObj.range_id ? Number(numObj.range_id) : null)
  };
  const snap = buildOwnershipRateSnapshotForNumber(mergedNum, ctx);
  if (owner_cost_usd != null && Number.isFinite(Number(owner_cost_usd))) snap.owner_cost_usd = round4(Number(owner_cost_usd));
  if (agent_rate_usd != null && Number.isFinite(Number(agent_rate_usd))) snap.agent_rate_usd = round4(Number(agent_rate_usd));
  if (client_rate_pkr != null && Number.isFinite(Number(client_rate_pkr))) snap.client_rate_pkr = round2(Number(client_rate_pkr));
  if (fx_usd_to_pkr != null && Number.isFinite(Number(fx_usd_to_pkr))) snap.fx_usd_to_pkr = round2(Number(fx_usd_to_pkr));

  const ledger = readDb('number_ownership_ledger') || [];
  const evt = {
    id: nextId(ledger, 'number_ownership_ledger'),
    number_digits: digits,
    number: String(numObj.number || number),
    event_date: ymd,
    event_seq: getLedgerNextSeq(ledger),
    action: action || (snap.client_id ? 'assign_client' : (snap.agent_id ? 'assign_agent' : 'unassign')),
    ...snap,
    actor,
    created_at: new Date().toISOString()
  };
  ledger.push(evt);
  writeDb('number_ownership_ledger', ledger);
  return evt;
}

function seedOwnershipLedgerIfEmpty() {
  try {
    const numbers = readDb('numbers') || [];
    refreshNumberOwnershipSnapshot(numbers);
    const ledger = readDb('number_ownership_ledger') || [];
    if (ledger.length > 0) return;

    const assignedNums = numbers.filter(n => n && (n.agent_id || n.client_id));
    if (!assignedNums.length) return;

    const ctx = {
      ranges: readDb('sms_ranges') || [],
      agents: readDb('agents') || [],
      clients: readDb('clients') || [],
      fxRate: getUsdToPkrRate()
    };
    const seeded = [];
    let seq = 1;
    let id = 1;
    const nowIso = new Date().toISOString();
    for (const n of assignedNums) {
      const digits = normalizePhoneDigits(n.number);
      if (!digits) continue;
      const rawDate = String(n.assigned_date || n.assigned_at || n.created || '').replace('T', ' ').slice(0, 10);
      const ymd = normalizeYmd(rawDate) || getBusinessDateYmd();
      const snap = buildOwnershipRateSnapshotForNumber(n, ctx);
      seeded.push({
        id: id++,
        number_digits: digits,
        number: String(n.number || digits),
        event_date: ymd,
        event_seq: seq++,
        action: snap.client_id ? 'assign_client' : 'assign_agent',
        ...snap,
        actor: 'BootSeed',
        created_at: nowIso
      });
    }
    if (seeded.length) {
      writeDb('number_ownership_ledger', seeded);
      console.log(`[OWNERSHIP_LEDGER] Seeded ${seeded.length} baseline ownership event(s).`);
    }
  } catch (err) {
    console.error('[OWNERSHIP_LEDGER] seed error:', err.message);
  }
}

function buildOwnershipResolverContext() {
  const ledger = readDb('number_ownership_ledger') || [];
  const numbers = readDb('numbers') || [];
  const ranges = readDb('sms_ranges') || [];
  const agents = readDb('agents') || [];
  const clients = readDb('clients') || [];
  const fxRate = getUsdToPkrRate();
  const wnRangesMap = buildRangesLookupMap();
  const wnTags = getWhitenoiseProviderTags();

  const ledgerByDigits = new Map();
  for (const e of ledger) {
    if (!e || !e.number_digits) continue;
    const d = String(e.number_digits);
    if (!ledgerByDigits.has(d)) ledgerByDigits.set(d, []);
    ledgerByDigits.get(d).push(e);
  }
  const numbersByDigits = new Map();
  for (const n of numbers) {
    if (!n) continue;
    const d = normalizePhoneDigits(n.number);
    if (d && !numbersByDigits.has(d)) numbersByDigits.set(d, n);
  }
  const wnRanges = ranges.filter(r => isWhitenoiseRecord(r, wnRangesMap, wnTags));
  const rangesByPrefixDesc = (wnRanges.length ? wnRanges : ranges)
    .filter(r => r && String(r.prefix || '').replace(/\D/g, '').length > 0)
    .sort((a, b) => String(b.prefix || '').replace(/\D/g, '').length - String(a.prefix || '').replace(/\D/g, '').length);

  return {
    ledgerByDigits,
    numbersByDigits,
    ranges,
    rangesById: new Map(ranges.map(r => [Number(r.id), r])),
    rangesByPrefixDesc,
    agents,
    agentsById: new Map(agents.map(a => [Number(a.id), a])),
    clients,
    clientsById: new Map(clients.map(c => [Number(c.id), c])),
    fxRate
  };
}

function resolveNumberOwnershipForDate(numberDigits, dateYmd, ctx) {
  const digits = normalizePhoneDigits(numberDigits);
  const altDigits = digits.startsWith('00') ? digits.slice(2) : digits;
  const lookupDigits = ctx.ledgerByDigits.has(digits) || ctx.numbersByDigits.has(digits) ? digits : altDigits;

  const events = ctx.ledgerByDigits.get(lookupDigits) || [];
  const numRec = ctx.numbersByDigits.get(lookupDigits) || null;

  // Match range from number record or longest Whitenoise prefix fallback
  let fallbackRng = null;
  if (numRec && numRec.range_id) fallbackRng = ctx.rangesById.get(Number(numRec.range_id)) || null;
  if (!fallbackRng && numRec && numRec.range_name) {
    fallbackRng = ctx.ranges.find(r => String(r.range_name || r.name || '').toLowerCase() === String(numRec.range_name).toLowerCase()) || null;
  }
  if (!fallbackRng) {
    for (const r of ctx.rangesByPrefixDesc) {
      const pfx = String(r.prefix || '').replace(/\D/g, '');
      if (pfx && lookupDigits.startsWith(pfx)) {
        fallbackRng = r;
        break;
      }
    }
  }

  // Filter ledger events where event_date <= dateYmd, sort DESC by (event_date, event_seq)
  const eligible = events.filter(e => e && e.event_date && e.event_date <= dateYmd);
  if (eligible.length > 0) {
    eligible.sort((a, b) => {
      if (a.event_date !== b.event_date) return b.event_date.localeCompare(a.event_date);
      return (Number(b.event_seq) || 0) - (Number(a.event_seq) || 0);
    });
    const top = eligible[0];
    const rng = (top.range_id && ctx.rangesById.get(Number(top.range_id))) || fallbackRng;
    const agObj = top.agent_id ? ctx.agentsById.get(Number(top.agent_id)) : null;
    const clObj = top.client_id ? ctx.clientsById.get(Number(top.client_id)) : null;
    const matchStatus = top.client_id ? 'matched_client' : (top.agent_id ? 'agent_pool' : 'unassigned');
    return {
      number_digits: lookupDigits,
      number: top.number || (numRec && numRec.number) || lookupDigits,
      match_status: matchStatus,
      resolved_via: 'ownership_ledger',
      event_date: top.event_date,
      event_seq: top.event_seq,
      agent_id: top.agent_id ? Number(top.agent_id) : null,
      agent_name: agObj?.username || top.agent_name || '',
      client_id: top.client_id ? Number(top.client_id) : null,
      client_name: clObj?.username || top.client_name || '',
      range_id: top.range_id ? Number(top.range_id) : (rng ? Number(rng.id) : null),
      range_name: top.range_name || rng?.range_name || rng?.name || (numRec && numRec.range_name) || 'Whitenoise',
      country: rng?.country || (numRec && numRec.country) || detectCountry(lookupDigits),
      owner_cost_usd: Number(top.owner_cost_usd) > 0 ? Number(top.owner_cost_usd) : (Number(rng?.cost ?? rng?.company_cost ?? 0) || 0),
      agent_rate_usd: top.agent_id ? (Number(top.agent_rate_usd) > 0 ? Number(top.agent_rate_usd) : (getRangeAgentRate(rng, 'Monthly') || Number(rng?.payout || 0) || 0)) : 0,
      client_rate_pkr: top.client_id ? (Number(top.client_rate_pkr) || 0) : 0,
      fx_usd_to_pkr: Number(top.fx_usd_to_pkr) || ctx.fxRate
    };
  }

  // No ledger event <= dateYmd
  if (numRec) {
    // If ledger has later events (number was assigned AFTER dateYmd), it was unassigned on dateYmd!
    const hasFutureEvents = events.length > 0;
    const assignedRaw = String(numRec.assigned_date || numRec.assigned_at || '').replace('T', ' ').slice(0, 10);
    const assignedYmd = normalizeYmd(assignedRaw);
    const legacyEligible = !hasFutureEvents && (numRec.agent_id || numRec.client_id) && (!assignedYmd || dateYmd >= assignedYmd);

    if (legacyEligible) {
      const snap = buildOwnershipRateSnapshotForNumber(numRec, ctx);
      return {
        number_digits: lookupDigits,
        number: String(numRec.number || lookupDigits),
        match_status: snap.client_id ? 'matched_client' : 'agent_pool',
        resolved_via: 'legacy_number_record',
        event_date: assignedYmd || dateYmd,
        event_seq: 0,
        ...snap,
        country: fallbackRng?.country || numRec.country || detectCountry(lookupDigits)
      };
    }

    return {
      number_digits: lookupDigits,
      number: String(numRec.number || lookupDigits),
      match_status: 'unassigned',
      resolved_via: hasFutureEvents ? 'before_first_assignment' : 'pool_unassigned',
      event_date: null,
      event_seq: 0,
      agent_id: null,
      agent_name: '',
      client_id: null,
      client_name: '',
      range_id: numRec.range_id ? Number(numRec.range_id) : (fallbackRng ? Number(fallbackRng.id) : null),
      range_name: numRec.range_name || fallbackRng?.range_name || fallbackRng?.name || 'Whitenoise',
      country: fallbackRng?.country || numRec.country || detectCountry(lookupDigits),
      owner_cost_usd: Number(fallbackRng?.cost ?? fallbackRng?.company_cost ?? numRec.company_rate ?? 0) || 0,
      agent_rate_usd: 0,
      client_rate_pkr: 0,
      fx_usd_to_pkr: ctx.fxRate
    };
  }

  // Unknown number (not in numbers.json)
  return {
    number_digits: lookupDigits,
    number: lookupDigits,
    match_status: 'unknown_number',
    resolved_via: 'not_in_inventory',
    event_date: null,
    event_seq: 0,
    agent_id: null,
    agent_name: '',
    client_id: null,
    client_name: '',
    range_id: fallbackRng ? Number(fallbackRng.id) : null,
    range_name: fallbackRng?.range_name || fallbackRng?.name || 'Unmatched Range',
    country: fallbackRng?.country || detectCountry(lookupDigits),
    owner_cost_usd: Number(fallbackRng?.cost ?? fallbackRng?.company_cost ?? 0) || 0,
    agent_rate_usd: 0,
    client_rate_pkr: 0,
    fx_usd_to_pkr: ctx.fxRate
  };
}

const WN_MONTH_MAP = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function daysInUtcMonth(year, month1To12) {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

function enumerateDatesYmd(startYmd, endYmd) {
  if (!startYmd || !endYmd || startYmd > endYmd) return [];
  const out = [];
  const cur = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  let guard = 0;
  while (cur.getTime() <= end.getTime() && guard < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard++;
  }
  return out;
}

function extractFilenameDateHints(filename) {
  const fn = String(filename || '');
  const now = new Date();
  let hintYear = now.getUTCFullYear();
  let hintMonth = now.getUTCMonth() + 1;
  let fallbackFileDate = null;
  let hasDateRange = false;

  // Detect explicit multi-day range patterns in filename: e.g. 01.11.2026-15.11.2026, 2026-11-01_2026-11-15, 1-15.11.2026, 15-19.11.2026
  const rangeFullDm = fn.match(/(\d{1,2})[.-](\d{1,2})[.-](\d{4})\s*(?:to|-|_|–)\s*(\d{1,2})[.-](\d{1,2})[.-](\d{4})/i);
  const rangeFullIso = fn.match(/(\d{4})-(\d{2})-(\d{2})\s*(?:to|-|_|–)\s*(\d{4})-(\d{2})-(\d{2})/i);
  const rangeShortDm = fn.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})[.-](\d{1,2})[.-](\d{4})/);
  const rangeDayWord = fn.match(/(?:^|[^0-9])(1\s*[-–]\s*15|01\s*[-–]\s*15|16\s*[-–]\s*(?:28|29|30|31))(?:[^0-9]|$)/);

  if (rangeFullDm) {
    hasDateRange = true;
    hintYear = Number(rangeFullDm[6]);
    hintMonth = Number(rangeFullDm[5]);
    fallbackFileDate = parseExcelDateYmd(`${rangeFullDm[4]}.${rangeFullDm[5]}.${rangeFullDm[6]}`);
  } else if (rangeFullIso) {
    hasDateRange = true;
    hintYear = Number(rangeFullIso[4]);
    hintMonth = Number(rangeFullIso[5]);
    fallbackFileDate = `${rangeFullIso[4]}-${rangeFullIso[5]}-${rangeFullIso[6]}`;
  } else if (rangeShortDm) {
    hasDateRange = true;
    hintYear = Number(rangeShortDm[4]);
    hintMonth = Number(rangeShortDm[3]);
    fallbackFileDate = parseExcelDateYmd(`${rangeShortDm[2]}.${rangeShortDm[3]}.${rangeShortDm[4]}`);
  } else {
    const fnMatch = fn.match(/(\d{1,2})[.-](\d{1,2})[.-](\d{4})/);
    if (fnMatch) {
      fallbackFileDate = parseExcelDateYmd(`${fnMatch[1]}.${fnMatch[2]}.${fnMatch[3]}`);
      if (fallbackFileDate) {
        hintYear = Number(fallbackFileDate.slice(0, 4));
        hintMonth = Number(fallbackFileDate.slice(5, 7));
      }
    } else {
      const fnIso = fn.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (fnIso) {
        fallbackFileDate = `${fnIso[1]}-${fnIso[2]}-${fnIso[3]}`;
        hintYear = Number(fnIso[1]);
        hintMonth = Number(fnIso[2]);
      } else {
        const fnYm = fn.match(/(\d{4})[-_.](0?[1-9]|1[0-2])(?:\b|[^0-9])/);
        if (fnYm) {
          hintYear = Number(fnYm[1]);
          hintMonth = Number(fnYm[2]);
        }
      }
    }
    if (rangeDayWord) hasDateRange = true;
  }

  return { hintYear, hintMonth, fallbackFileDate, hasDateRange };
}

function parseExcelDateYmd(val, opts = {}) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number' && Number.isFinite(val) && val > 25000 && val < 75000) {
    try {
      const dc = XLSX.SSF.parse_date_code(val);
      if (dc && dc.y >= 2000 && dc.y <= 2100 && dc.m >= 1 && dc.m <= 12 && dc.d >= 1 && dc.d <= 31) {
        return `${dc.y}-${String(dc.m).padStart(2, '0')}-${String(dc.d).padStart(2, '0')}`;
      }
    } catch (_) {}
  }
  const s = String(val).trim();
  if (!s) return null;

  // Numeric string Excel serial
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 25000 && n < 75000) return parseExcelDateYmd(n, opts);
  }
  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD (optionally with time)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[\sT].*)?$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  // DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY (optionally with time)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[\sT].*)?$/);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    let d = a, mo = b;
    if (b > 12 && a <= 12) { mo = a; d = b; }
    if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  // DD.MM.YY or DD/MM/YY or DD-MM-YY (optionally with time)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})(?:[\sT].*)?$/);
  if (m) {
    let d = Number(m[1]), mo = Number(m[2]), y = 2000 + Number(m[3]);
    if (mo > 12 && d <= 12) { const tmp = d; d = mo; mo = tmp; }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  // Text month formats: "15 Nov 2026", "15-Nov-2026", "15/Nov/26", "15 Nov"
  m = s.match(/^(\d{1,2})[\s./-]+([A-Za-z]{3,9})(?:[\s,./-]+(\d{2,4}))?(?:[\sT].*)?$/);
  if (m) {
    const d = Number(m[1]);
    const mo = WN_MONTH_MAP[m[2].toLowerCase()];
    const rawY = m[3] ? Number(m[3]) : (opts.hintYear || new Date().getUTCFullYear());
    const y = rawY < 100 ? (2000 + rawY) : rawY;
    if (mo && y >= 2000 && y <= 2100 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  // Text month formats: "Nov 15, 2026", "November 15 2026", "Nov-15-26", "Nov 15"
  m = s.match(/^([A-Za-z]{3,9})[\s./-]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,./-]+(\d{2,4}))?(?:[\sT].*)?$/);
  if (m) {
    const mo = WN_MONTH_MAP[m[1].toLowerCase()];
    const d = Number(m[2]);
    const rawY = m[3] ? Number(m[3]) : (opts.hintYear || new Date().getUTCFullYear());
    const y = rawY < 100 ? (2000 + rawY) : rawY;
    if (mo && y >= 2000 && y <= 2100 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  // Short DD.MM or DD/MM (pivot headers or short date cells when year hint is available)
  if (opts.allowShortDate) {
    m = s.match(/^(\d{1,2})[./-](\d{1,2})$/);
    if (m) {
      let d = Number(m[1]), mo = Number(m[2]);
      if (mo > 12 && d <= 12) { const tmp = d; d = mo; mo = tmp; }
      const y = opts.hintYear || new Date().getUTCFullYear();
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    // "Day 1" .. "Day 31"
    m = s.match(/^day\s*(\d{1,2})$/i);
    if (m && opts.hintYear && opts.hintMonth) {
      const d = Number(m[1]);
      if (d >= 1 && d <= daysInUtcMonth(opts.hintYear, opts.hintMonth)) {
        return `${opts.hintYear}-${String(opts.hintMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

function buildWorksheetMatrix(ws) {
  const rawMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const fmtMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  // Merge formatted strings for date-formatted cells when raw value isn't obviously parseable or is a serial
  return rawMatrix.map((row, rIdx) => {
    const fmtRow = fmtMatrix[rIdx] || [];
    return (row || []).map((cell, cIdx) => {
      if (cell === '' || cell === null || cell === undefined) return '';
      if (typeof cell === 'number' && cell > 25000 && cell < 75000) {
        const fmtVal = String(fmtRow[cIdx] || '').trim();
        // Only treat numeric serial as date if formatted cell actually looks like a date (not a count or phone)
        if (fmtVal && /[./-\sA-Za-z]/.test(fmtVal) && parseExcelDateYmd(fmtVal)) {
          return parseExcelDateYmd(fmtVal);
        }
      }
      return cell;
    });
  });
}

function detectSheetColumnMapping(rowsMatrix, dateHints = {}) {
  let headerRowIdx = 0;
  let bestRowScore = -1;
  const headerParseOpts = { hintYear: dateHints.hintYear, hintMonth: dateHints.hintMonth, allowShortDate: true };

  const maxScan = Math.min(rowsMatrix.length, 15);
  for (let r = 0; r < maxScan; r++) {
    const row = rowsMatrix[r] || [];
    const nonEmpty = row.filter(c => String(c ?? '').trim() !== '').length;
    if (nonEmpty < 2) continue;
    let score = 0;
    let dateHeaderCols = 0;
    for (const cell of row) {
      const h = String(cell ?? '').trim().toLowerCase();
      if (!h) continue;
      if (parseExcelDateYmd(cell, headerParseOpts)) dateHeaderCols++;
      if (/\b(date|day|time|period|created|sent|datetime|timestamp)\b/.test(h)) score += 3;
      if (/\b(number|phone|msisdn|did|dst|destination|to|sms_to|recipient|num)\b/.test(h)) score += 4;
      if (/\b(service|cli|sender|app|source|src|sid|origin|brand|product)\b/.test(h)) score += 3;
      if (/\b(count|sms|qty|quantity|total|messages|msgs|hits|delivered|volume|amount)\b/.test(h)) score += 3;
      if (/\b(range|country|route|prefix|operator)\b/.test(h)) score += 1;
    }
    if (dateHeaderCols >= 2) score += 8;
    if (score > bestRowScore) {
      bestRowScore = score;
      headerRowIdx = r;
    }
  }

  const rawHeaders = (rowsMatrix[headerRowIdx] || []).map((c, idx) => {
    const dYmd = parseExcelDateYmd(c, headerParseOpts);
    if (dYmd && typeof c === 'number') return dYmd;
    const s = String(c ?? '').trim();
    return s || `Col ${idx + 1}`;
  });

  const colMap = { date: -1, number: -1, service: -1, sms_count: -1, range: -1 };
  const datePivotCols = [];

  rawHeaders.forEach((hdr, idx) => {
    const h = hdr.toLowerCase();
    const parsedHeaderDate = parseExcelDateYmd(rowsMatrix[headerRowIdx]?.[idx], headerParseOpts);
    if (parsedHeaderDate) {
      datePivotCols.push({ idx, date_ymd: parsedHeaderDate, label: hdr });
      return;
    }
    if (colMap.date === -1 && /(^|[\s_-])(date|day|sms_date|stat_date|report_date|created|created_at|sent_at|datetime|timestamp|time|period)([\s_-]|$)/.test(h)) {
      colMap.date = idx;
    } else if (colMap.number === -1 && /(number|phone|msisdn|did|dst|destination|sms_to|recipient|tel|mobile)/.test(h)) {
      colMap.number = idx;
    } else if (colMap.service === -1 && /(service|cli|sender|app|source|src|sid|application|brand|origin)/.test(h)) {
      colMap.service = idx;
    } else if (colMap.sms_count === -1 && /(sms_count|count|sms|qty|quantity|total|messages|msgs|delivered|hits|volume|cnt)/.test(h) && !/rate|price|cost|payout|amount|usd|pkr/.test(h)) {
      colMap.sms_count = idx;
    } else if (colMap.range === -1 && /(range|country|route|prefix)/.test(h)) {
      colMap.range = idx;
    }
  });

  // Content-based fallback heuristic on first 25 data rows if any key column wasn't named cleanly
  const sampleRows = rowsMatrix.slice(headerRowIdx + 1, headerRowIdx + 26);
  const cellParseOpts = { hintYear: dateHints.hintYear, hintMonth: dateHints.hintMonth, allowShortDate: true };
  if (sampleRows.length > 0) {
    const colCount = rawHeaders.length;
    if (colMap.number === -1) {
      for (let c = 0; c < colCount; c++) {
        if (Object.values(colMap).includes(c)) continue;
        let phoneHits = 0, valid = 0;
        for (const r of sampleRows) {
          const d = normalizePhoneDigits(r[c]);
          if (String(r[c] ?? '').trim() !== '') {
            valid++;
            if (d.length >= 8 && d.length <= 16 && !parseExcelDateYmd(r[c], cellParseOpts)) phoneHits++;
          }
        }
        if (valid > 0 && phoneHits / valid >= 0.6) { colMap.number = c; break; }
      }
    }
    if (colMap.date === -1 && datePivotCols.length === 0) {
      for (let c = 0; c < colCount; c++) {
        if (Object.values(colMap).includes(c)) continue;
        let dateHits = 0, valid = 0;
        for (const r of sampleRows) {
          if (String(r[c] ?? '').trim() !== '') {
            valid++;
            if (parseExcelDateYmd(r[c], cellParseOpts)) dateHits++;
          }
        }
        if (valid > 0 && dateHits / valid >= 0.5) { colMap.date = c; break; }
      }
    }
    if (colMap.sms_count === -1 && datePivotCols.length === 0) {
      for (let c = 0; c < colCount; c++) {
        if (Object.values(colMap).includes(c)) continue;
        let intHits = 0, valid = 0;
        for (const r of sampleRows) {
          const v = r[c];
          if (v !== '' && v !== null && v !== undefined) {
            valid++;
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0 && n <= 1000000) intHits++;
          }
        }
        if (valid > 0 && intHits / valid >= 0.7) { colMap.sms_count = c; break; }
      }
    }
  }

  const layout = (colMap.date === -1 && datePivotCols.length >= 1 && colMap.number !== -1) ? 'date_pivot' : 'tabular';
  let sheetScore = 0;
  if (colMap.number !== -1) sheetScore += 40;
  if (colMap.date !== -1 || datePivotCols.length >= 1) sheetScore += 35;
  if (colMap.service !== -1) sheetScore += 15;
  if (colMap.sms_count !== -1 || datePivotCols.length >= 1) sheetScore += 15;
  const dataRowCount = Math.max(0, rowsMatrix.length - headerRowIdx - 1);
  if (dataRowCount > 0) sheetScore += Math.min(20, dataRowCount);

  return {
    headerRowIdx,
    headers: rawHeaders,
    colMap,
    datePivotCols,
    layout,
    sheetScore,
    dataRowCount
  };
}

function parseWhitenoiseExcelBuffer(buffer, filename = 'stats.xlsx', opts = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  if (!wb || !Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) {
    throw new Error('Workbook contains no readable sheets.');
  }

  const dateHints = extractFilenameDateHints(filename);
  const cellDateOpts = { hintYear: dateHints.hintYear, hintMonth: dateHints.hintMonth, allowShortDate: true };

  const sheetInfos = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const matrix = buildWorksheetMatrix(ws);
    const det = detectSheetColumnMapping(matrix, dateHints);
    const sheetDateYmd = parseExcelDateYmd(name, { ...cellDateOpts, allowShortDate: true });
    return {
      name,
      matrix,
      sheetDateYmd,
      ...det
    };
  });

  // Auto-detect multi-sheet date-per-tab workbooks (e.g. tabs named 01.11.2026 .. 15.11.2026)
  const dateNamedSheets = sheetInfos.filter(s => s.sheetDateYmd && s.colMap.number !== -1 && s.dataRowCount > 0);
  const useMultiDateSheets = !opts.sheetName && dateNamedSheets.length >= 2;

  let selected = null;
  if (opts.sheetName && opts.sheetName !== '__ALL_DATE_SHEETS__') {
    selected = sheetInfos.find(s => s.name === opts.sheetName) || null;
  }
  if (!selected) {
    const sorted = sheetInfos.slice().sort((a, b) => b.sheetScore - a.sheetScore);
    selected = sorted[0];
  }

  const effectiveMap = {
    date: opts.colMap && opts.colMap.date !== undefined ? Number(opts.colMap.date) : selected.colMap.date,
    number: opts.colMap && opts.colMap.number !== undefined ? Number(opts.colMap.number) : selected.colMap.number,
    service: opts.colMap && opts.colMap.service !== undefined ? Number(opts.colMap.service) : selected.colMap.service,
    sms_count: opts.colMap && opts.colMap.sms_count !== undefined ? Number(opts.colMap.sms_count) : selected.colMap.sms_count,
    range: opts.colMap && opts.colMap.range !== undefined ? Number(opts.colMap.range) : selected.colMap.range
  };

  const warnings = [];
  const aggregated = new Map();
  let rawParsedRows = 0;
  let skippedInvalidRows = 0;

  const parseSheetIntoAgg = (sh, mapToUse, fallbackDate) => {
    const isPivot = (mapToUse.date === -1 && sh.datePivotCols.length >= 1 && mapToUse.number !== -1);
    const dataRows = sh.matrix.slice(sh.headerRowIdx + 1);
    if (mapToUse.number === -1) return;

    if (isPivot) {
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (!Array.isArray(row) || row.every(c => String(c ?? '').trim() === '')) continue;
        const firstCellStr = String(row[0] ?? '').trim().toLowerCase();
        if (firstCellStr === 'total' || firstCellStr === 'grand total' || firstCellStr.startsWith('total:')) continue;
        const digits = normalizePhoneDigits(row[mapToUse.number]);
        if (digits.length < 6) { skippedInvalidRows++; continue; }
        const serviceRaw = mapToUse.service >= 0 ? String(row[mapToUse.service] ?? '').trim() : '';
        const serviceLabel = serviceRaw || 'General';
        const serviceNorm = normalizeServiceKey(serviceLabel);
        const rangeHint = mapToUse.range >= 0 ? String(row[mapToUse.range] ?? '').trim() : '';

        for (const dc of sh.datePivotCols) {
          const cnt = Number(String(row[dc.idx] ?? '').replace(/,/g, '').trim());
          if (!Number.isFinite(cnt) || cnt <= 0) continue;
          const intCnt = Math.round(cnt);
          rawParsedRows++;
          const statKey = `${dc.date_ymd}|${digits}|${serviceNorm}`;
          const prev = aggregated.get(statKey);
          if (prev) {
            prev.sms_count += intCnt;
          } else {
            aggregated.set(statKey, {
              stat_key: statKey,
              date_ymd: dc.date_ymd,
              number_digits: digits,
              service: serviceLabel,
              service_normalized: serviceNorm,
              sms_count: intCnt,
              range_hint: rangeHint
            });
          }
        }
      }
      return;
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!Array.isArray(row) || row.every(c => String(c ?? '').trim() === '')) continue;
      const firstCellStr = String(row[0] ?? '').trim().toLowerCase();
      if (firstCellStr === 'total' || firstCellStr === 'grand total' || firstCellStr.startsWith('total:')) continue;

      const digits = normalizePhoneDigits(row[mapToUse.number]);
      if (digits.length < 6) { skippedInvalidRows++; continue; }

      const dateYmd = mapToUse.date >= 0
        ? parseExcelDateYmd(row[mapToUse.date], cellDateOpts)
        : (sh.sheetDateYmd || fallbackDate);
      if (!dateYmd) { skippedInvalidRows++; continue; }

      const serviceRaw = mapToUse.service >= 0 ? String(row[mapToUse.service] ?? '').trim() : '';
      const serviceLabel = serviceRaw || 'General';
      const serviceNorm = normalizeServiceKey(serviceLabel);
      const rangeHint = mapToUse.range >= 0 ? String(row[mapToUse.range] ?? '').trim() : '';

      let cnt = 1;
      if (mapToUse.sms_count >= 0) {
        const rawCnt = row[mapToUse.sms_count];
        const parsedCnt = Number(String(rawCnt ?? '').replace(/,/g, '').trim());
        if (!Number.isFinite(parsedCnt) || parsedCnt < 0) { skippedInvalidRows++; continue; }
        cnt = Math.round(parsedCnt);
        if (cnt === 0) continue;
      }

      rawParsedRows++;
      const statKey = `${dateYmd}|${digits}|${serviceNorm}`;
      const prev = aggregated.get(statKey);
      if (prev) {
        prev.sms_count += cnt;
      } else {
        aggregated.set(statKey, {
          stat_key: statKey,
          date_ymd: dateYmd,
          number_digits: digits,
          service: serviceLabel,
          service_normalized: serviceNorm,
          sms_count: cnt,
          range_hint: rangeHint
        });
      }
    }
  };

  let usedLayout = 'tabular';
  if (useMultiDateSheets) {
    usedLayout = 'multi_date_sheets';
    for (const sh of dateNamedSheets) {
      parseSheetIntoAgg(sh, sh.colMap, sh.sheetDateYmd);
    }
  } else {
    const usePivot = (effectiveMap.date === -1 && selected.datePivotCols.length >= 1 && effectiveMap.number !== -1);
    usedLayout = usePivot ? 'date_pivot' : 'tabular';
    if (effectiveMap.number === -1) {
      warnings.push('Could not auto-detect Number column — please select the Number column below.');
    } else {
      if (!usePivot && effectiveMap.date === -1 && !selected.sheetDateYmd && !dateHints.fallbackFileDate) {
        warnings.push('Could not auto-detect Date column — please map the Date column below.');
      }
      parseSheetIntoAgg(selected, effectiveMap, dateHints.fallbackFileDate);
    }
  }

  if (skippedInvalidRows > 0) {
    warnings.push(`Skipped ${skippedInvalidRows} non-data / invalid row(s) (missing valid phone number, date, or count).`);
  }

  const canonicalRows = Array.from(aggregated.values()).sort((a, b) => {
    if (a.date_ymd !== b.date_ymd) return b.date_ymd.localeCompare(a.date_ymd);
    if (a.number_digits !== b.number_digits) return a.number_digits.localeCompare(b.number_digits);
    return a.service.localeCompare(b.service);
  });

  const distinctDates = Array.from(new Set(canonicalRows.map(r => r.date_ymd))).sort();
  let dateRangeCollapsedWarning = false;
  if (dateHints.hasDateRange && distinctDates.length <= 1 && effectiveMap.date === -1 && !useMultiDateSheets && usedLayout !== 'date_pivot') {
    dateRangeCollapsedWarning = true;
    warnings.push(
      `This file's name indicates a multi-day range, but the sheet has no per-day Date column or date columns — all rows fell onto a single date (${distinctDates[0] || dateHints.fallbackFileDate || 'unknown'}). Export a daily/date-column report or map the Date column so each date is recorded date-to-date.`
    );
  }

  return {
    filename,
    sheets: sheetInfos.map(s => ({
      name: s.name,
      row_count: s.dataRowCount,
      score: s.sheetScore,
      layout: s.layout,
      sheet_date_ymd: s.sheetDateYmd || null,
      headers: s.headers,
      detected_col_map: s.colMap
    })),
    selected_sheet: useMultiDateSheets ? `All ${dateNamedSheets.length} Date Sheets` : selected.name,
    layout: usedLayout,
    headers: selected.headers,
    col_map: effectiveMap,
    distinct_dates: distinctDates,
    date_range_collapsed_warning: dateRangeCollapsedWarning,
    raw_parsed_rows: rawParsedRows,
    skipped_invalid_rows: skippedInvalidRows,
    warnings,
    canonical_rows: canonicalRows
  };
}

function computeStatFinancials(smsCount, { agent_id, client_id, owner_cost_usd, agent_rate_usd, client_rate_pkr, fx_usd_to_pkr }) {
  const C = Math.max(0, Math.round(Number(smsCount) || 0));
  const fx = Number(fx_usd_to_pkr) > 0 ? Number(fx_usd_to_pkr) : getUsdToPkrRate();
  const rOwner = Number(owner_cost_usd) || 0;
  const rAgent = agent_id ? (Number(agent_rate_usd) || 0) : 0;
  const rClientPkr = client_id ? (Number(client_rate_pkr) || 0) : 0;

  const owner_revenue_usd = round4(C * rOwner);
  const agent_payout_usd = agent_id ? round4(C * rAgent) : 0;
  const client_payout_pkr = client_id ? round2(C * rClientPkr) : 0;
  const client_payout_usd = client_id ? round4(client_payout_pkr / fx) : 0;
  const owner_profit_usd = agent_id ? round4(Math.max(0, owner_revenue_usd - agent_payout_usd)) : owner_revenue_usd;
  const agent_profit_usd = agent_id ? round4(agent_payout_usd - client_payout_usd) : 0;

  return {
    owner_revenue_usd,
    agent_payout_usd,
    client_payout_pkr,
    client_payout_usd,
    owner_profit_usd,
    agent_profit_usd,
    fx_usd_to_pkr: round2(fx)
  };
}

function evaluateWhitenoiseExcelUpload(buffer, filename, opts = {}) {
  const parsed = parseWhitenoiseExcelBuffer(buffer, filename, opts);
  const existingStats = readDb('whitenoise_daily_stats') || [];
  const existingByKey = new Map();
  for (const st of existingStats) {
    if (st && st.stat_key) existingByKey.set(st.stat_key, st);
  }
  const resolverCtx = buildOwnershipResolverContext();
  const monthlyCfg = getMonthlyCycleConfig();

  let newRows = 0, updatedRows = 0, unchangedRows = 0;
  let matchedClient = 0, agentPool = 0, unassigned = 0, unknownNumbers = 0;
  let totalSmsInFile = 0, netSmsDelta = 0;
  let netOwnerRevDelta = 0, netAgentPayDelta = 0, netClientPkrDelta = 0, netOwnerProfitDelta = 0;
  let dateMin = null, dateMax = null;

  const evaluatedRows = [];

  for (const row of parsed.canonical_rows) {
    if (!dateMin || row.date_ymd < dateMin) dateMin = row.date_ymd;
    if (!dateMax || row.date_ymd > dateMax) dateMax = row.date_ymd;
    totalSmsInFile += row.sms_count;

    const existing = existingByKey.get(row.stat_key) || null;
    const resolved = resolveNumberOwnershipForDate(row.number_digits, row.date_ymd, resolverCtx);

    // If existing record exists and was already matched to an agent/client, keep its locked historical owner & rates.
    // If existing was unassigned/unknown and Owner later added/assigned the number for that date, upgrade ownership cleanly!
    const useLockedExisting = existing && (existing.agent_id || existing.client_id);
    const effOwner = useLockedExisting ? {
      number_digits: existing.number_digits,
      number: existing.number,
      match_status: existing.client_id ? 'matched_client' : 'agent_pool',
      resolved_via: existing.resolved_via || 'locked_existing',
      agent_id: existing.agent_id || null,
      agent_name: existing.agent_name || '',
      client_id: existing.client_id || null,
      client_name: existing.client_name || '',
      range_id: existing.range_id || resolved.range_id || null,
      range_name: existing.range_name || resolved.range_name || row.range_hint || 'Whitenoise',
      country: existing.country || resolved.country || '',
      owner_cost_usd: Number(existing.owner_cost_usd ?? resolved.owner_cost_usd ?? 0),
      agent_rate_usd: Number(existing.agent_rate_usd ?? resolved.agent_rate_usd ?? 0),
      client_rate_pkr: Number(existing.client_rate_pkr ?? resolved.client_rate_pkr ?? 0),
      fx_usd_to_pkr: Number(existing.fx_usd_to_pkr ?? resolved.fx_usd_to_pkr ?? resolverCtx.fxRate)
    } : {
      ...resolved,
      range_name: (resolved.range_name && resolved.range_name !== 'Unmatched Range') ? resolved.range_name : (row.range_hint || resolved.range_name)
    };

    const fin = computeStatFinancials(row.sms_count, effOwner);
    const clearsAt = (row.date_ymd >= monthlyCfg.start_date && row.date_ymd <= monthlyCfg.end_date)
      ? `${monthlyCfg.clear_date}T00:00:00.000Z`
      : computeMonthlyClearIso(`${row.date_ymd} 12:00:00`);

    let action = 'new';
    let prevCount = 0;
    let deltaSms = row.sms_count;
    let deltaOwnerRev = fin.owner_revenue_usd;
    let deltaAgentPay = fin.agent_payout_usd;
    let deltaClientPkr = fin.client_payout_pkr;
    let deltaOwnerProfit = fin.owner_profit_usd;

    if (existing) {
      prevCount = Number(existing.sms_count) || 0;
      const ownerUpgraded = !useLockedExisting && (
        (effOwner.agent_id || null) !== (existing.agent_id || null) ||
        (effOwner.client_id || null) !== (existing.client_id || null)
      );
      if (prevCount === row.sms_count && !ownerUpgraded) {
        action = 'unchanged';
        deltaSms = 0;
        deltaOwnerRev = 0;
        deltaAgentPay = 0;
        deltaClientPkr = 0;
        deltaOwnerProfit = 0;
        unchangedRows++;
      } else {
        action = 'updated';
        deltaSms = row.sms_count - prevCount;
        deltaOwnerRev = round4(fin.owner_revenue_usd - (Number(existing.owner_revenue_usd) || 0));
        deltaAgentPay = round4(fin.agent_payout_usd - (Number(existing.agent_payout_usd) || 0));
        deltaClientPkr = round2(fin.client_payout_pkr - (Number(existing.client_payout_pkr) || 0));
        deltaOwnerProfit = round4(fin.owner_profit_usd - (Number(existing.owner_profit_usd) || 0));
        updatedRows++;
      }
    } else {
      newRows++;
    }

    if (effOwner.match_status === 'matched_client') matchedClient++;
    else if (effOwner.match_status === 'agent_pool') agentPool++;
    else if (effOwner.match_status === 'unknown_number') unknownNumbers++;
    else unassigned++;

    netSmsDelta += deltaSms;
    netOwnerRevDelta = round4(netOwnerRevDelta + deltaOwnerRev);
    netAgentPayDelta = round4(netAgentPayDelta + deltaAgentPay);
    netClientPkrDelta = round2(netClientPkrDelta + deltaClientPkr);
    netOwnerProfitDelta = round4(netOwnerProfitDelta + deltaOwnerProfit);

    evaluatedRows.push({
      stat_key: row.stat_key,
      action,
      date_ymd: row.date_ymd,
      number_digits: effOwner.number_digits,
      number: effOwner.number,
      service: row.service,
      service_normalized: row.service_normalized,
      range_id: effOwner.range_id,
      range_name: effOwner.range_name,
      country: effOwner.country,
      match_status: effOwner.match_status,
      resolved_via: effOwner.resolved_via,
      agent_id: effOwner.agent_id,
      agent_name: effOwner.agent_name,
      client_id: effOwner.client_id,
      client_name: effOwner.client_name,
      owner_cost_usd: effOwner.owner_cost_usd,
      agent_rate_usd: effOwner.agent_rate_usd,
      client_rate_pkr: effOwner.client_rate_pkr,
      fx_usd_to_pkr: fin.fx_usd_to_pkr,
      prev_sms_count: prevCount,
      sms_count: row.sms_count,
      delta_sms: deltaSms,
      owner_revenue_usd: fin.owner_revenue_usd,
      agent_payout_usd: fin.agent_payout_usd,
      client_payout_pkr: fin.client_payout_pkr,
      client_payout_usd: fin.client_payout_usd,
      owner_profit_usd: fin.owner_profit_usd,
      agent_profit_usd: fin.agent_profit_usd,
      clears_at: clearsAt,
      existing_snapshot: existing ? { ...existing } : null
    });
  }

  // Build Day-by-Day Verification Matrix & Half-Month (1-15 / 16-End) Missing-Day Gap Detection
  const existingSmsByDate = new Map();
  for (const st of existingStats) {
    if (!st || !st.date_ymd) continue;
    existingSmsByDate.set(st.date_ymd, (existingSmsByDate.get(st.date_ymd) || 0) + (Number(st.sms_count) || 0));
  }
  const existingDatesAll = Array.from(existingSmsByDate.keys()).sort();
  const existingMinAll = existingDatesAll[0] || null;
  const existingMaxAll = existingDatesAll[existingDatesAll.length - 1] || null;

  const perDateMap = new Map();
  for (const r of evaluatedRows) {
    const d = r.date_ymd;
    if (!perDateMap.has(d)) {
      const dayNum = Number(d.slice(8, 10)) || 1;
      perDateMap.set(d, {
        date_ymd: d,
        day: dayNum,
        half_period: dayNum <= 15 ? '1-15' : '16-end',
        existing_sms: existingSmsByDate.get(d) || 0,
        file_sms: 0,
        delta_sms: 0,
        new_rows: 0,
        updated_rows: 0,
        unchanged_rows: 0,
        status: 'new_day'
      });
    }
    const bucket = perDateMap.get(d);
    bucket.file_sms += Number(r.sms_count) || 0;
    bucket.delta_sms += Number(r.delta_sms) || 0;
    if (r.action === 'new') bucket.new_rows++;
    else if (r.action === 'updated') bucket.updated_rows++;
    else bucket.unchanged_rows++;
  }

  const missingDaysFilled = [];
  const perDateSummary = Array.from(perDateMap.values()).sort((a, b) => a.date_ymd.localeCompare(b.date_ymd));
  for (const dRow of perDateSummary) {
    const wasMissingGap = dRow.existing_sms === 0 && existingMinAll && existingMaxAll &&
      ((dRow.date_ymd > existingMinAll && dRow.date_ymd < existingMaxAll) ||
       (dRow.date_ymd < existingMaxAll && dRow.date_ymd.slice(0, 7) === existingMaxAll.slice(0, 7)));
    if (wasMissingGap) {
      dRow.status = 'missing_day_filled';
      missingDaysFilled.push(dRow.date_ymd);
    } else if (dRow.existing_sms === 0) {
      dRow.status = 'new_day';
    } else if (dRow.new_rows === 0 && dRow.updated_rows === 0 && dRow.delta_sms === 0) {
      dRow.status = 'verified_match';
    } else {
      dRow.status = 'updated';
    }
  }

  // Detect any remaining missing dates inside the file span [dateMin..dateMax]
  const fileDateSet = new Set(perDateSummary.map(d => d.date_ymd));
  const missingDatesRemaining = [];
  if (dateMin && dateMax) {
    for (const dYmd of enumerateDatesYmd(dateMin, dateMax)) {
      if (!fileDateSet.has(dYmd) && !(existingSmsByDate.get(dYmd) > 0)) {
        missingDatesRemaining.push(dYmd);
      }
    }
  }

  const targetMonth = (dateMax || existingMaxAll || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const halfMonthCoverage = buildWhitenoiseMonthCoverage(targetMonth, existingStats, perDateSummary);

  return {
    parsed,
    date_min: dateMin,
    date_max: dateMax,
    distinct_dates: perDateSummary.map(d => d.date_ymd),
    per_date_summary: perDateSummary,
    missing_days_filled: missingDaysFilled,
    missing_dates_remaining: missingDatesRemaining,
    half_month_coverage: halfMonthCoverage,
    summary: {
      total_rows: evaluatedRows.length,
      distinct_dates_count: perDateSummary.length,
      new_rows: newRows,
      updated_rows: updatedRows,
      unchanged_rows: unchangedRows,
      missing_days_filled_count: missingDaysFilled.length,
      missing_dates_remaining_count: missingDatesRemaining.length,
      matched_client: matchedClient,
      agent_pool: agentPool,
      unassigned: unassigned + unknownNumbers,
      unknown_numbers: unknownNumbers,
      total_sms_in_file: totalSmsInFile,
      net_sms_delta: netSmsDelta,
      net_owner_revenue_delta_usd: netOwnerRevDelta,
      net_agent_payout_delta_usd: netAgentPayDelta,
      net_client_payout_delta_pkr: netClientPkrDelta,
      net_owner_profit_delta_usd: netOwnerProfitDelta
    },
    evaluated_rows: evaluatedRows
  };
}

function buildWhitenoiseMonthCoverage(monthYm, statsList = null, previewDateSummary = null) {
  const stats = statsList || (readDb('whitenoise_daily_stats') || []);
  const todayYmd = new Date().toISOString().slice(0, 10);
  const safeYm = /^\d{4}-\d{2}$/.test(String(monthYm || '')) ? String(monthYm) : todayYmd.slice(0, 7);
  const year = Number(safeYm.slice(0, 4));
  const month = Number(safeYm.slice(5, 7));
  const totalDays = daysInUtcMonth(year, month);

  const smsByDate = new Map();
  for (const st of stats) {
    if (!st || !st.date_ymd || !String(st.date_ymd).startsWith(safeYm)) continue;
    smsByDate.set(st.date_ymd, (smsByDate.get(st.date_ymd) || 0) + (Number(st.sms_count) || 0));
  }
  const previewByDate = new Map();
  if (Array.isArray(previewDateSummary)) {
    for (const d of previewDateSummary) {
      if (d && d.date_ymd && d.date_ymd.startsWith(safeYm)) previewByDate.set(d.date_ymd, d);
    }
  }

  const allUploadedDates = Array.from(smsByDate.keys()).sort();
  const maxUploadedInMonth = allUploadedDates[allUploadedDates.length - 1] || null;
  const maxCheckYmd = maxUploadedInMonth && maxUploadedInMonth > todayYmd ? maxUploadedInMonth : todayYmd;

  const buildPeriod = (startDay, endDay) => {
    const days = [];
    let uploadedDays = 0;
    let missingDays = 0;
    let totalSms = 0;
    const missingDates = [];

    for (let day = startDay; day <= endDay; day++) {
      const ymd = `${safeYm}-${String(day).padStart(2, '0')}`;
      const existingSms = smsByDate.get(ymd) || 0;
      const prevInfo = previewByDate.get(ymd) || null;
      const effectiveSms = prevInfo ? Math.max(existingSms, prevInfo.file_sms) : existingSms;

      let status = 'future';
      if (existingSms > 0) {
        status = prevInfo && prevInfo.status === 'updated' ? 'updated' : 'uploaded';
        uploadedDays++;
        totalSms += existingSms;
      } else if (prevInfo && prevInfo.file_sms > 0) {
        status = prevInfo.status === 'missing_day_filled' ? 'missing_day_filled' : 'incoming';
        uploadedDays++;
        totalSms += prevInfo.file_sms;
      } else if (ymd <= maxCheckYmd && (maxUploadedInMonth ? ymd <= maxUploadedInMonth : ymd <= todayYmd)) {
        status = 'missing';
        missingDays++;
        missingDates.push(ymd);
      }

      days.push({
        day,
        date_ymd: ymd,
        status,
        existing_sms: existingSms,
        sms_count: effectiveSms
      });
    }

    return {
      label: startDay === 1 ? '1 – 15' : `16 – ${endDay}`,
      start_day: startDay,
      end_day: endDay,
      uploaded_days: uploadedDays,
      missing_days: missingDays,
      missing_dates: missingDates,
      total_sms: totalSms,
      days
    };
  };

  return {
    month: safeYm,
    total_days: totalDays,
    period_1_15: buildPeriod(1, Math.min(15, totalDays)),
    period_16_end: buildPeriod(16, totalDays)
  };
}

function applyWhitenoiseBalanceDeltas(ownerDeltaUsd, agentDeltasMap, clientDeltasMap) {
  if (Math.abs(ownerDeltaUsd) > 0.000001) {
    const users = readDb('users') || [];
    const oIdx = users.findIndex(u => normRole(u.role) === 'owner');
    if (oIdx !== -1) {
      users[oIdx].balance = round6((Number(users[oIdx].balance) || 0) + ownerDeltaUsd);
      writeDb('users', users);
    }
  }
  if (agentDeltasMap.size > 0) {
    const agents = readDb('agents') || [];
    let touched = false;
    for (const [agId, delta] of agentDeltasMap.entries()) {
      if (Math.abs(delta) < 0.000001) continue;
      const idx = agents.findIndex(a => Number(a.id) === Number(agId));
      if (idx !== -1) {
        agents[idx].balance = round6((Number(agents[idx].balance) || 0) + delta);
        touched = true;
      }
    }
    if (touched) writeDb('agents', agents);
  }
  if (clientDeltasMap.size > 0) {
    const clients = readDb('clients') || [];
    let touched = false;
    for (const [clId, d] of clientDeltasMap.entries()) {
      if (Math.abs(d.usd) < 0.000001 && Math.abs(d.pkr) < 0.001) continue;
      const idx = clients.findIndex(c => Number(c.id) === Number(clId));
      if (idx !== -1) {
        clients[idx].balance = round6((Number(clients[idx].balance) || 0) + d.usd);
        clients[idx].balance_pkr = round2((Number(clients[idx].balance_pkr) || 0) + d.pkr);
        touched = true;
      }
    }
    if (touched) writeDb('clients', clients);
  }
}

function commitWhitenoiseExcelEvaluation(evalRes, actorUsername = 'Owner') {
  const stats = readDb('whitenoise_daily_stats') || [];
  const statsByKey = new Map();
  stats.forEach((st, idx) => { if (st && st.stat_key) statsByKey.set(st.stat_key, idx); });

  const batches = readDb('whitenoise_upload_batches') || [];
  const batchNumId = nextId(batches, 'whitenoise_upload_batches');
  const batchId = `WN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(batchNumId).padStart(4, '0')}`;
  const nowIso = new Date().toISOString();

  const insertedKeys = [];
  const previousSnapshots = [];
  let idCounter = nextId(stats, 'whitenoise_daily_stats');

  let ownerDeltaUsd = 0;
  const agentDeltas = new Map();
  const clientDeltas = new Map();

  const addAgentDelta = (agId, d) => {
    if (!agId || !d) return;
    agentDeltas.set(Number(agId), (agentDeltas.get(Number(agId)) || 0) + d);
  };
  const addClientDelta = (clId, dUsd, dPkr) => {
    if (!clId || (!dUsd && !dPkr)) return;
    const prev = clientDeltas.get(Number(clId)) || { usd: 0, pkr: 0 };
    prev.usd += dUsd;
    prev.pkr += dPkr;
    clientDeltas.set(Number(clId), prev);
  };

  for (const r of evalRes.evaluated_rows) {
    if (r.action === 'unchanged') continue;
    const { action, prev_sms_count, delta_sms, existing_snapshot, ...cleanFields } = r;

    if (action === 'new') {
      const rec = {
        id: idCounter++,
        ...cleanFields,
        payterm: 'Monthly',
        payout_schedule: 'monthly30_5',
        is_whitenoise: true,
        source: 'whitenoise_excel',
        batch_id: batchId,
        created_at: nowIso,
        updated_at: nowIso
      };
      stats.push(rec);
      statsByKey.set(rec.stat_key, stats.length - 1);
      insertedKeys.push(rec.stat_key);

      ownerDeltaUsd += Number(rec.owner_profit_usd) || 0;
      addAgentDelta(rec.agent_id, Number(rec.agent_profit_usd) || 0);
      addClientDelta(rec.client_id, Number(rec.client_payout_usd) || 0, Number(rec.client_payout_pkr) || 0);
    } else if (action === 'updated') {
      const idx = statsByKey.get(r.stat_key);
      if (idx !== undefined && stats[idx]) {
        const prevRec = { ...stats[idx] };
        previousSnapshots.push(prevRec);

        const nextRec = {
          ...prevRec,
          ...cleanFields,
          batch_id: batchId,
          updated_at: nowIso
        };
        stats[idx] = nextRec;

        ownerDeltaUsd += (Number(nextRec.owner_profit_usd) || 0) - (Number(prevRec.owner_profit_usd) || 0);
        addAgentDelta(prevRec.agent_id, -(Number(prevRec.agent_profit_usd) || 0));
        addAgentDelta(nextRec.agent_id, Number(nextRec.agent_profit_usd) || 0);
        addClientDelta(prevRec.client_id, -(Number(prevRec.client_payout_usd) || 0), -(Number(prevRec.client_payout_pkr) || 0));
        addClientDelta(nextRec.client_id, Number(nextRec.client_payout_usd) || 0, Number(nextRec.client_payout_pkr) || 0);
      }
    }
  }

  writeDb('whitenoise_daily_stats', stats);
  applyWhitenoiseBalanceDeltas(ownerDeltaUsd, agentDeltas, clientDeltas);

  const batchRec = {
    id: batchNumId,
    batch_id: batchId,
    filename: evalRes.parsed.filename,
    sheet_name: evalRes.parsed.selected_sheet,
    layout: evalRes.parsed.layout,
    uploaded_by: actorUsername,
    uploaded_at: nowIso,
    date_min: evalRes.date_min,
    date_max: evalRes.date_max,
    distinct_dates: evalRes.distinct_dates || [],
    missing_days_filled: evalRes.missing_days_filled || [],
    per_date_summary: evalRes.per_date_summary || [],
    total_rows: evalRes.summary.total_rows,
    rows_inserted: evalRes.summary.new_rows,
    rows_updated: evalRes.summary.updated_rows,
    rows_unchanged: evalRes.summary.unchanged_rows,
    matched_client: evalRes.summary.matched_client,
    agent_pool: evalRes.summary.agent_pool,
    unassigned: evalRes.summary.unassigned,
    total_sms_in_file: evalRes.summary.total_sms_in_file,
    net_sms_delta: evalRes.summary.net_sms_delta,
    net_owner_revenue_delta_usd: evalRes.summary.net_owner_revenue_delta_usd,
    net_agent_payout_delta_usd: evalRes.summary.net_agent_payout_delta_usd,
    net_client_payout_delta_pkr: evalRes.summary.net_client_payout_delta_pkr,
    net_owner_profit_delta_usd: evalRes.summary.net_owner_profit_delta_usd,
    rolled_back: false,
    rolled_back_at: null,
    rolled_back_by: null,
    inserted_keys: insertedKeys,
    previous_snapshots: previousSnapshots
  };

  batches.unshift(batchRec);
  writeDb('whitenoise_upload_batches', batches);

  logAudit(
    actorUsername,
    'Whitenoise Excel Upload',
    `${batchId} (${batchRec.filename}): +${batchRec.rows_inserted} new, ${batchRec.rows_updated} updated, ${batchRec.rows_unchanged} unchanged, SMS delta ${batchRec.net_sms_delta >= 0 ? '+' : ''}${batchRec.net_sms_delta}`,
    'CDR 2'
  );

  const { inserted_keys, previous_snapshots, ...publicBatch } = batchRec;
  return publicBatch;
}

function rollbackWhitenoiseBatchById(batchIdOrNum, actorUsername = 'Owner') {
  const batches = readDb('whitenoise_upload_batches') || [];
  const bIdx = batches.findIndex(b => String(b.id) === String(batchIdOrNum) || String(b.batch_id) === String(batchIdOrNum));
  if (bIdx === -1) throw new Error('Upload batch not found.');
  const batch = batches[bIdx];
  if (batch.rolled_back) throw new Error('This upload batch has already been rolled back.');

  let stats = readDb('whitenoise_daily_stats') || [];
  const insertedSet = new Set(batch.inserted_keys || []);
  const prevSnapMap = new Map();
  for (const snap of (batch.previous_snapshots || [])) {
    if (snap && snap.stat_key) prevSnapMap.set(snap.stat_key, snap);
  }

  let ownerDeltaUsd = 0;
  const agentDeltas = new Map();
  const clientDeltas = new Map();
  const addAgentDelta = (agId, d) => { if (agId && d) agentDeltas.set(Number(agId), (agentDeltas.get(Number(agId)) || 0) + d); };
  const addClientDelta = (clId, dUsd, dPkr) => {
    if (!clId || (!dUsd && !dPkr)) return;
    const prev = clientDeltas.get(Number(clId)) || { usd: 0, pkr: 0 };
    prev.usd += dUsd; prev.pkr += dPkr;
    clientDeltas.set(Number(clId), prev);
  };

  let removedCount = 0;
  let restoredCount = 0;
  const nextStats = [];

  for (const st of stats) {
    if (!st) continue;
    if (insertedSet.has(st.stat_key)) {
      removedCount++;
      ownerDeltaUsd -= Number(st.owner_profit_usd) || 0;
      addAgentDelta(st.agent_id, -(Number(st.agent_profit_usd) || 0));
      addClientDelta(st.client_id, -(Number(st.client_payout_usd) || 0), -(Number(st.client_payout_pkr) || 0));
      continue;
    }
    if (prevSnapMap.has(st.stat_key)) {
      const restored = prevSnapMap.get(st.stat_key);
      restoredCount++;
      ownerDeltaUsd += (Number(restored.owner_profit_usd) || 0) - (Number(st.owner_profit_usd) || 0);
      addAgentDelta(st.agent_id, -(Number(st.agent_profit_usd) || 0));
      addAgentDelta(restored.agent_id, Number(restored.agent_profit_usd) || 0);
      addClientDelta(st.client_id, -(Number(st.client_payout_usd) || 0), -(Number(st.client_payout_pkr) || 0));
      addClientDelta(restored.client_id, Number(restored.client_payout_usd) || 0, Number(restored.client_payout_pkr) || 0);
      nextStats.push(restored);
      continue;
    }
    nextStats.push(st);
  }

  writeDb('whitenoise_daily_stats', nextStats);
  applyWhitenoiseBalanceDeltas(ownerDeltaUsd, agentDeltas, clientDeltas);

  batches[bIdx] = {
    ...batch,
    rolled_back: true,
    rolled_back_at: new Date().toISOString(),
    rolled_back_by: actorUsername
  };
  writeDb('whitenoise_upload_batches', batches);

  logAudit(actorUsername, 'Whitenoise Batch Rollback', `Rolled back ${batch.batch_id} (${batch.filename}): removed ${removedCount}, restored ${restoredCount}`, 'CDR 2');
  return {
    batch_id: batch.batch_id,
    removed_rows: removedCount,
    restored_rows: restoredCount
  };
}

function statRowToVirtualSms(st, fxFallback = 280) {
  const C = Math.max(0, Math.round(Number(st.sms_count) || 0));
  const fx = Number(st.fx_usd_to_pkr) || fxFallback;
  const ownerRev = Number(st.owner_revenue_usd) || 0;
  const agPay = Number(st.agent_payout_usd) || 0;
  const clPkr = Number(st.client_payout_pkr) || 0;
  const clUsd = Number(st.client_payout_usd) || (clPkr ? round4(clPkr / fx) : 0);
  const ownerProfit = st.owner_profit_usd != null ? Number(st.owner_profit_usd) : (st.agent_id ? round4(Math.max(0, ownerRev - agPay)) : ownerRev);
  const agProfit = st.agent_profit_usd != null ? Number(st.agent_profit_usd) : (st.agent_id ? round4(agPay - clUsd) : 0);

  return {
    id: `wns_${st.id || st.stat_key}`,
    stat_key: st.stat_key,
    record_type: 'excel_stat',
    date_ymd: st.date_ymd,
    date: st.date_ymd,
    timestamp: `${st.date_ymd} 12:00:00`,
    created: st.created_at || `${st.date_ymd}T12:00:00.000Z`,
    provider: 'Whitenoise',
    source: 'whitenoise_excel',
    is_whitenoise: true,
    payterm: 'Monthly',
    payout_schedule: 'monthly30_5',
    cycle_days: 30,
    hold_days: 5,
    range_id: st.range_id || null,
    range_name: st.range_name || 'Whitenoise',
    range_label: st.range_name || 'Whitenoise',
    range: st.range_name || 'Whitenoise',
    country: st.country || '',
    number: st.number || st.number_digits || '',
    number_digits: st.number_digits || normalizePhoneDigits(st.number),
    cli: st.service || 'General',
    app: st.service || 'General',
    service: st.service || 'General',
    message: '',
    sms_count: C,
    status: 'delivered',
    cause: 'Excel Report',
    match_status: st.match_status || (st.client_id ? 'matched_client' : (st.agent_id ? 'agent_pool' : 'unassigned')),
    agent_id: st.agent_id || null,
    agent: st.agent_name || '',
    agent_name: st.agent_name || '',
    agent_username: st.agent_name || '',
    client_id: st.client_id || null,
    client: st.client_name || '',
    client_name: st.client_name || '',
    client_username: st.client_name || '',
    currency: 'USD',
    unit_owner_rate_usd: Number(st.owner_cost_usd) || 0,
    unit_agent_rate_usd: Number(st.agent_rate_usd) || 0,
    unit_client_rate_pkr: Number(st.client_rate_pkr) || 0,
    fx_usd_to_pkr: fx,
    company_rate: ownerRev,
    company_payout: ownerRev,
    carrier_revenue: ownerRev,
    owner_revenue_usd: ownerRev,
    agent_rate: agPay,
    agent_payout: agPay,
    agent_payout_usd: agPay,
    client_rate: clUsd,
    client_payout: clUsd,
    client_amount: clUsd,
    client_amount_pkr: clPkr,
    client_payout_pkr: clPkr,
    agent_amount: agProfit,
    owner_amount: ownerProfit,
    profit: ownerProfit,
    clears_at: st.clears_at || computeMonthlyClearIso(`${st.date_ymd} 12:00:00`),
    batch_id: st.batch_id || '',
    client_deleted: Boolean(st.client_deleted),
    client_deleted_at: st.client_deleted_at || null
  };
}

function getScopedWhitenoiseStatsAsVirtualSms(sessionUser, opts = {}) {
  const stats = readDb('whitenoise_daily_stats') || [];
  if (!stats.length) return [];
  const sRole = normRole(sessionUser?.role);
  const uid = Number(sessionUser?.id);
  const uname = String(sessionUser?.username || '').trim().toLowerCase();
  const fx = getUsdToPkrRate();

  let filtered = stats;
  if (sRole === 'client') {
    filtered = stats.filter(st =>
      !st.client_deleted && (
        (st.client_id != null && st.client_id !== '' && Number(st.client_id) === uid) ||
        ((st.client_id == null || st.client_id === '') && uname && String(st.client_name || '').toLowerCase() === uname)
      )
    );
  } else if (sRole === 'agent') {
    filtered = stats.filter(st => Number(st.agent_id) === uid || (uname && String(st.agent_name || '').toLowerCase() === uname));
    if (opts.client_id) {
      filtered = filtered.filter(st => Number(st.client_id) === Number(opts.client_id));
    }
  } else if (sRole === 'owner') {
    if (opts.agent_id) filtered = filtered.filter(st => Number(st.agent_id) === Number(opts.agent_id));
    if (opts.client_id) filtered = filtered.filter(st => Number(st.client_id) === Number(opts.client_id));
  } else {
    return [];
  }

  return filtered.map(st => statRowToVirtualSms(st, fx));
}

// ── Middleware ───────────────────────────────────────────────
// Enable high-efficiency gzip/deflate compression for fast responses over slow networks
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  threshold: 512
}));

// Large bodies on bulk import, commit, upload, and backup routes; generous 10 MB cap for all other JSON/form endpoints
app.use([
  '/api/numbers/import-to-range',
  '/api/numbers/bulk-range-import',
  '/api/numbers/smart-sheet-commit',
  '/api/numbers/upload',
  '/api/numbers/bulk-delete-many',
  '/api/numbers/bulk-allocate',
  '/api/numbers/bulk-assign-many',
  '/api/numbers/bulk-unassign-many',
  '/api/numbers/bulk-return',
  '/api/numbers/return-by-date',
  '/api/whitenoise-excel/upload',
  '/api/backup/restore',
  '/api/backup/import'
], express.json({ limit: '25mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (process.env.TRUST_PROXY === 'false') {
  app.set('trust proxy', false);
} else if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== 'true') {
  app.set('trust proxy', isNaN(Number(process.env.TRUST_PROXY)) ? process.env.TRUST_PROXY : Number(process.env.TRUST_PROXY));
} else {
  app.set('trust proxy', 1);
}

// ── Global Firewall Helpers & Middleware ─────────────────────
function isIpBlocked(ip) {
  if (!ip) return false;
  const cleanIp = String(ip).trim().replace(/^::ffff:/, '');
  const blocked = readDb('blocked_ips');
  if (!Array.isArray(blocked) || blocked.length === 0) return false;
  return blocked.some(b => {
    if (!b || !b.ip) return false;
    const bIp = String(b.ip).trim().replace(/^::ffff:/, '');
    return bIp === cleanIp || bIp === String(ip).trim();
  });
}

function logFirewallEvent(ip, reason = 'Blocked IP attempted access', targetPath = '') {
  try {
    const events = readDb('firewall_events') || [];
    const entry = {
      id: nextId(events, 'firewall_events'),
      ip: String(ip).replace(/^::ffff:/, ''),
      event_type: 'ip_blocked',
      severity: 'high',
      reason: String(reason),
      path: String(targetPath),
      timestamp: new Date().toISOString()
    };
    events.unshift(entry);
    if (events.length > 500) events.length = 500;
    writeDb('firewall_events', events);
  } catch (err) {
    console.error('Failed to log firewall event:', err);
  }
}

// Global firewall: first check before static, API, or webhooks
app.use((req, res, next) => {
  const clientIp = req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  if (isIpBlocked(clientIp)) {
    logFirewallEvent(clientIp, 'Global Firewall Block', req.originalUrl || req.url);
    return res.status(403).json({ error: 'Access denied — IP blocked' });
  }
  next();
});

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

function getEffectiveHosts(req) {
  const hosts = new Set();
  if (!req || !req.headers) return hosts;
  const h = String(req.headers.host || '').split(',')[0].trim().toLowerCase();
  if (h) hosts.add(h);
  if (process.env.TRUST_PROXY !== 'false') {
    const xfh = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
    if (xfh) hosts.add(xfh);
  }
  return hosts;
}

function isRequestHttps(req) {
  if (!req) return false;
  if (req.secure) return true;
  const xfp = String((req.headers && req.headers['x-forwarded-proto']) || '').toLowerCase();
  if (xfp.includes('https')) return true;
  const origin = String((req.headers && req.headers.origin) || '').toLowerCase();
  if (origin.startsWith('https://')) return true;
  const referer = String((req.headers && req.headers.referer) || '').toLowerCase();
  if (referer.startsWith('https://')) return true;
  const xfh = String((req.headers && req.headers['x-forwarded-host']) || '').split(',')[0].trim().toLowerCase();
  if (xfh && (xfh.endsWith('.run.app') || xfh.endsWith('.googleusercontent.com'))) return true;
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const effectiveHosts = getEffectiveHosts(req);
  let isAllowed = false;

  if (origin) {
    const originLower = origin.toLowerCase();
    let isSameOrigin = false;
    try {
      const parsedOrigin = new URL(originLower);
      isSameOrigin = effectiveHosts.has(parsedOrigin.host.toLowerCase());
    } catch (_) {}
    if (isSameOrigin || ALLOWED_ORIGINS.has(originLower)) {
      isAllowed = true;
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token, X-Agent-ID, X-Client-ID, X-Inbound-Token');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isRequestHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; frame-ancestors *; object-src 'none'; base-uri 'self';"
  );
  // X-Frame-Options omitted to allow embedding in AI Studio preview iframe
  if (req.method === 'OPTIONS') {
    return res.sendStatus(isAllowed || !origin ? 200 : 403);
  }
  next();
});

// Boot-unique asset version so browsers cache JS/CSS aggressively in production and auto-refresh on restart
const ASSET_BUILD_VER = Date.now().toString(36);

// Serve static assets from humex-sms/static with fast ETag & production browser caching
const staticOpts = {
  etag: true,
  lastModified: true,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath || '').toLowerCase();
    if (process.env.NODE_ENV === 'production' && /\.(js|css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|eot)$/.test(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
};
// Intercept direct HTML file requests with strict role authorization
const DIRECT_HTML_ROLES = {
  'index.html': ['owner', 'admin'],
  'agent.html': ['agent'],
  'client.html': ['client']
};

app.get(['/dashboard.html', '/static/dashboard.html'], (req, res) => res.redirect('/login'));

app.get(['/static/:file(*.html)', '/:file(*.html)'], (req, res, next) => {
  const baseName = path.basename(req.params.file || '').toLowerCase();
  if (baseName === 'login.html') {
    return sendInjectedHtml(res, path.join(STATIC_DIR, 'login.html'), req);
  }
  if (DIRECT_HTML_ROLES[baseName]) {
    const user = getSessionUser(req);
    if (!user) {
      return res.redirect('/login');
    }
    const userRole = (user.role || '').toLowerCase();
    const isOwner = userRole === 'owner' || userRole === 'admin';
    const allowed = DIRECT_HTML_ROLES[baseName];
    if (!allowed.includes(userRole) && !(isOwner && allowed.includes('owner'))) {
      return res.redirect(ROLE_HOME_URL[userRole] || '/login');
    }
  }
  const filePath = path.join(STATIC_DIR, path.basename(req.params.file || ''));
  if (fs.existsSync(filePath)) {
    return sendInjectedHtml(res, filePath, req);
  }
  next();
});

/* ══════════════════════════════════════════════════════════════════════════
   HUMEX SMS REBRANDING COMPATIBILITY ALIAS MIDDLEWARE (START)
   Maps legacy asset names to unified humex-sms conventions. Can be safely deleted once
   browsers and proxies have fully cleared cache.
   ══════════════════════════════════════════════════════════════════════════ */
const ASSET_RENAME_MAP = {
  // Brand Images
  'humax-sms-logo.png': 'humex-sms-logo.png',
  'custom-logo.png': 'humex-sms-logo.png',
  'humex-sms-dp.jpg': 'humex-sms-logo.png',
  'alphasms-logo.svg': 'humex-sms-logo.svg',
  'alphasms-circle-logo.svg': 'humex-sms-circle-logo.svg',
  'alphasms-icon.svg': 'humex-sms-icon.svg',
  // Stylesheets
  'speed-panel.css': 'humex-panel.css',
  'speed-admin-skin.css': 'humex-admin-skin.css',
  'apx-telecom.css': 'humex-telecom.css',
  'style.css': 'humex-global.css',
  // JavaScript - Owner
  'app.js': 'owner-engine.js',
  'speed-admin.js': 'owner-shell.js',
  'new_features.js': 'owner-features.js',
  // JavaScript - Agent
  'agent.js': 'agent-engine.js',
  'speed-agent.js': 'agent-shell.js',
  'speed-agent-pages.js': 'agent-pages.js',
  'agent_features.js': 'agent-features.js',
  // JavaScript - Client
  'client.js': 'client-engine.js',
  'speed-client.js': 'client-shell.js',
  'speed-client-pages.js': 'client-pages.js',
  // JavaScript - Shared
  'speed-kit.js': 'shared-ui-kit.js',
  'brand-theme.js': 'shared-brand-theme.js',
  'speed-auth-guard.js': 'shared-auth-guard.js',
  'speed-profile-security.js': 'shared-profile-security.js',
  'speed-url.js': 'shared-url-router.js',
  'speed-flash.js': 'shared-flash.js',
  'speed-loginpanel.js': 'shared-login-modal.js'
};

app.use((req, res, next) => {
  const urlPath = req.path;
  // Never serve source maps or backup artifacts
  if (/\.(map|bak|tmp)$/i.test(urlPath)) {
    return res.status(404).end();
  }
  const m = urlPath.match(/^(?:\/static)?\/(js|css|img)\/([^/?#]+)$/i);
  if (m) {
    const sub = m[1].toLowerCase();
    const oldBase = m[2];
    if (ASSET_RENAME_MAP[oldBase]) {
      if (sub === 'img' && fs.existsSync(path.join(uploadsDir, oldBase))) {
        return next();
      }
      if (fs.existsSync(path.join(STATIC_DIR, sub, oldBase))) {
        return next();
      }
      const newBase = ASSET_RENAME_MAP[oldBase];
      const targetPath = path.join(STATIC_DIR, sub, newBase);
      if (fs.existsSync(targetPath)) return res.sendFile(targetPath);
    }
  }
  next();
});
/* ══════════════════════════════════════════════════════════════════════════
   HUMEX SMS REBRANDING COMPATIBILITY ALIAS MIDDLEWARE (END)
   ══════════════════════════════════════════════════════════════════════════ */

const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}
}
app.use('/static/img', express.static(uploadsDir, staticOpts));
app.use('/uploads', express.static(uploadsDir, staticOpts));
app.use('/static', express.static(STATIC_DIR, staticOpts));
app.use('/css', express.static(path.join(STATIC_DIR, 'css'), staticOpts));
app.use('/js', express.static(path.join(STATIC_DIR, 'js'), staticOpts));
app.use('/img', express.static(path.join(STATIC_DIR, 'img'), staticOpts));

// ── HTML Page Routes ──────────────────────────────────────────
// ── Unified Role-Based Theme Architecture ─────────────────────
const DEFAULT_ROLE_THEMES = [
  {
    key: 'cobalt_emerald',
    name: 'Royal Blue & Emerald',
    description: 'Clean white surfaces, Royal Blue primary actions & Emerald Green accents with locked neutral ink',
    is_builtin: true,
    structure_tone: 'light',
    structure_bg: '#ffffff',
    structure_side_bg: '#ffffff',
    structure_text: '#0f172a',
    structure_muted: '#64748b',
    structure_item_bg: '#f8fafc',
    structure_item_hover: '#eff6ff',
    structure_border: '#e2e8f0',
    structure_table_bg: '#f1f5f9',
    structure_table_text: '#334155',
    primary_btn: '#1d4ed8',
    primary_btn_hover: '#1e40af',
    primary_btn_text: '#ffffff',
    warning_btn: '#d97706',
    warning_btn_hover: '#b45309',
    warning_btn_text: '#ffffff',
    danger_btn: '#dc2626',
    danger_btn_hover: '#b91c1c'
  },
  {
    key: 'daylight_cobalt',
    name: 'Daylight Crisp & Cobalt',
    description: 'White header & sidebar, Slate table headers, Cobalt buttons, Amber exports',
    is_builtin: true,
    structure_tone: 'light',
    structure_bg: '#ffffff',
    structure_side_bg: '#ffffff',
    structure_text: '#0f172a',
    structure_muted: '#64748b',
    structure_item_bg: '#f1f5f9',
    structure_item_hover: '#eff6ff',
    structure_border: '#e2e8f0',
    structure_table_bg: '#f1f5f9',
    structure_table_text: '#334155',
    primary_btn: '#2563eb',
    primary_btn_hover: '#1d4ed8',
    primary_btn_text: '#ffffff',
    warning_btn: '#d97706',
    warning_btn_hover: '#b45309',
    warning_btn_text: '#ffffff',
    danger_btn: '#dc2626',
    danger_btn_hover: '#b91c1c'
  },
  {
    key: 'emerald_executive',
    name: 'Emerald Executive',
    description: 'Forest Emerald header & sidebar, crisp white cards, Pine primary actions',
    is_builtin: true,
    structure_tone: 'dark',
    structure_bg: '#064e3b',
    structure_side_bg: '#064e3b',
    structure_text: '#ffffff',
    structure_muted: '#a7f3d0',
    structure_item_bg: 'rgba(255, 255, 255, 0.08)',
    structure_item_hover: 'rgba(255, 255, 255, 0.16)',
    structure_border: '#047857',
    structure_table_bg: '#065f46',
    structure_table_text: '#ffffff',
    primary_btn: '#059669',
    primary_btn_hover: '#047857',
    primary_btn_text: '#ffffff',
    warning_btn: '#d97706',
    warning_btn_hover: '#b45309',
    warning_btn_text: '#ffffff',
    danger_btn: '#dc2626',
    danger_btn_hover: '#b91c1c'
  },
  {
    key: 'midnight_navy',
    name: 'Midnight Navy Command',
    description: 'Deep Navy frame & table headers, white workspace cards, Electric Blue CTAs',
    is_builtin: true,
    structure_tone: 'dark',
    structure_bg: '#0f172a',
    structure_side_bg: '#0f172a',
    structure_text: '#ffffff',
    structure_muted: '#94a3b8',
    structure_item_bg: 'rgba(255, 255, 255, 0.07)',
    structure_item_hover: 'rgba(255, 255, 255, 0.15)',
    structure_border: '#1e293b',
    structure_table_bg: '#1e293b',
    structure_table_text: '#f8fafc',
    primary_btn: '#2563eb',
    primary_btn_hover: '#1d4ed8',
    primary_btn_text: '#ffffff',
    warning_btn: '#d97706',
    warning_btn_hover: '#b45309',
    warning_btn_text: '#ffffff',
    danger_btn: '#dc2626',
    danger_btn_hover: '#b91c1c'
  },
  {
    key: 'teal_meridian',
    name: 'Teal Meridian',
    description: 'Ocean Teal structure frame, Jade table headers, Teal action buttons',
    is_builtin: true,
    structure_tone: 'dark',
    structure_bg: '#134e4a',
    structure_side_bg: '#134e4a',
    structure_text: '#ffffff',
    structure_muted: '#99f6e4',
    structure_item_bg: 'rgba(255, 255, 255, 0.08)',
    structure_item_hover: 'rgba(255, 255, 255, 0.16)',
    structure_border: '#115e59',
    structure_table_bg: '#115e59',
    structure_table_text: '#ffffff',
    primary_btn: '#0d9488',
    primary_btn_hover: '#0f766e',
    primary_btn_text: '#ffffff',
    warning_btn: '#d97706',
    warning_btn_hover: '#b45309',
    warning_btn_text: '#ffffff',
    danger_btn: '#dc2626',
    danger_btn_hover: '#b91c1c'
  },
  {
    key: 'indigo_command',
    name: 'Indigo Command',
    description: 'Royal Indigo frame & table headers, white cards, Vivid Indigo buttons',
    is_builtin: true,
    structure_tone: 'dark',
    structure_bg: '#1e1b4b',
    structure_side_bg: '#1e1b4b',
    structure_text: '#ffffff',
    structure_muted: '#c7d2fe',
    structure_item_bg: 'rgba(255, 255, 255, 0.08)',
    structure_item_hover: 'rgba(255, 255, 255, 0.16)',
    structure_border: '#312e81',
    structure_table_bg: '#312e81',
    structure_table_text: '#ffffff',
    primary_btn: '#4f46e5',
    primary_btn_hover: '#4338ca',
    primary_btn_text: '#ffffff',
    warning_btn: '#d97706',
    warning_btn_hover: '#b45309',
    warning_btn_text: '#ffffff',
    danger_btn: '#dc2626',
    danger_btn_hover: '#b91c1c'
  }
];

function normalizeHexColor(hex, fallback = '#2563eb') {
  if (typeof hex !== 'string') return fallback;
  let s = hex.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
}

function hexToRgb(hex) {
  const clean = normalizeHexColor(hex, '#2563eb').slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function hexLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const chan = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function autoContrastText(hex) {
  return hexLuminance(hex) > 0.36 ? '#0f172a' : '#ffffff';
}

function shadeHex(hex, amount = -0.14) {
  const { r, g, b } = hexToRgb(hex);
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const adj = c => (amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return '#' + [clamp(adj(r)), clamp(adj(g)), clamp(adj(b))]
    .map(n => n.toString(16).padStart(2, '0'))
    .join('');
}

function hexToRgba(hex, alpha = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildCompleteRoleTheme(input = {}, isBuiltin = false) {
  const structBg = normalizeHexColor(input.structure_bg || input.structureBg, '#0f172a');
  const isLightStruct = hexLuminance(structBg) > 0.36;
  const tone = isLightStruct ? 'light' : 'dark';
  const primaryBtn = normalizeHexColor(input.primary_btn || input.primaryBtn, '#2563eb');
  const warningBtn = normalizeHexColor(input.warning_btn || input.warningBtn, '#d97706');
  const dangerBtn = normalizeHexColor(input.danger_btn || input.dangerBtn, '#dc2626');
  const structTableBg = normalizeHexColor(
    input.structure_table_bg || input.structureTableBg,
    isLightStruct ? '#f1f5f9' : shadeHex(structBg, 0.06)
  );
  const cleanKey = String(input.key || ('custom_' + Date.now()))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || ('custom_' + Date.now());

  return {
    key: cleanKey,
    name: String(input.name || cleanKey).trim().slice(0, 80),
    description: String(input.description || input.desc || `${structBg} frame · ${primaryBtn} CTA · ${warningBtn} warn`).trim().slice(0, 140),
    is_builtin: Boolean(isBuiltin || input.is_builtin),
    structure_tone: tone,
    structure_bg: structBg,
    structure_side_bg: normalizeHexColor(input.structure_side_bg, structBg),
    structure_text: input.structure_text || (isLightStruct ? '#0f172a' : '#ffffff'),
    structure_muted: input.structure_muted || (isLightStruct ? '#64748b' : 'rgba(255, 255, 255, 0.72)'),
    structure_item_bg: input.structure_item_bg || (isLightStruct ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'),
    structure_item_hover: input.structure_item_hover || (isLightStruct ? hexToRgba(primaryBtn, 0.1) : 'rgba(255, 255, 255, 0.16)'),
    structure_border: input.structure_border || (isLightStruct ? '#e2e8f0' : shadeHex(structBg, 0.12)),
    structure_table_bg: structTableBg,
    structure_table_text: input.structure_table_text || (hexLuminance(structTableBg) > 0.36 ? '#334155' : '#ffffff'),
    primary_btn: primaryBtn,
    primary_btn_hover: input.primary_btn_hover ? normalizeHexColor(input.primary_btn_hover, shadeHex(primaryBtn, -0.14)) : shadeHex(primaryBtn, -0.14),
    primary_btn_text: autoContrastText(primaryBtn),
    warning_btn: warningBtn,
    warning_btn_hover: input.warning_btn_hover ? normalizeHexColor(input.warning_btn_hover, shadeHex(warningBtn, -0.14)) : shadeHex(warningBtn, -0.14),
    warning_btn_text: autoContrastText(warningBtn),
    danger_btn: dangerBtn,
    danger_btn_hover: input.danger_btn_hover ? normalizeHexColor(input.danger_btn_hover, shadeHex(dangerBtn, -0.14)) : shadeHex(dangerBtn, -0.14)
  };
}

function getThemeCatalog(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const custom = Array.isArray(s.custom_themes) ? s.custom_themes : [];
  const builtins = DEFAULT_ROLE_THEMES.map(t => buildCompleteRoleTheme(t, true));
  const byKey = new Map();
  builtins.forEach(t => byKey.set(t.key, t));
  custom.forEach(ct => {
    if (!ct || !ct.key) return;
    const built = buildCompleteRoleTheme(ct, byKey.has(ct.key) ? byKey.get(ct.key).is_builtin : false);
    byKey.set(built.key, built);
  });
  return Array.from(byKey.values());
}

function resolveEffectiveTheme(settings, userThemeKey = '') {
  const s = settings && typeof settings === 'object' ? settings : {};
  const catalog = getThemeCatalog(s);
  const byKey = new Map(catalog.map(t => [t.key, t]));
  const defKey = (s.default_theme_key && byKey.has(s.default_theme_key)) ? s.default_theme_key : 'cobalt_emerald';
  const pickedKey = (userThemeKey && userThemeKey !== 'default' && byKey.has(userThemeKey)) ? userThemeKey : defKey;
  return byKey.get(pickedKey) || catalog[0];
}

const FONT_FAMILIES = {
  jakarta: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  inter: "'Inter', sans-serif",
  poppins: "'Poppins', sans-serif",
  roboto: "'Roboto', sans-serif",
  outfit: "'Outfit', sans-serif",
  montserrat: "'Montserrat', sans-serif",
  opensans: "'Open Sans', sans-serif",
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monospace: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"
};

function getThemeCss(settings, userThemeKey = '') {
  const s = settings || {};
  const theme = resolveEffectiveTheme(s, userThemeKey);
  const fontKey = s.font_family || 'jakarta';
  const fontFamily = FONT_FAMILIES[fontKey] || FONT_FAMILIES.jakarta;
  const isLightChrome = theme.structure_tone === 'light';
  const itemText = isLightChrome ? '#334155' : theme.structure_text;
  const subText = isLightChrome ? '#475569' : theme.structure_muted;
  const ctrlBg = isLightChrome ? '#f8fafc' : 'rgba(255, 255, 255, 0.14)';
  const ctrlBorder = isLightChrome ? '#cbd5e1' : 'rgba(255, 255, 255, 0.25)';

  return `
    :root {
      --app-font: ${fontFamily};
      --theme-struct-bg: ${theme.structure_bg};
      --theme-struct-side-bg: ${theme.structure_side_bg};
      --theme-struct-text: ${theme.structure_text};
      --theme-struct-muted: ${theme.structure_muted};
      --theme-struct-item-bg: ${theme.structure_item_bg};
      --theme-struct-item-hover: ${theme.structure_item_hover};
      --theme-struct-item-text: ${itemText};
      --theme-struct-sub-text: ${subText};
      --theme-struct-border: ${theme.structure_border};
      --theme-struct-table-bg: ${theme.structure_table_bg};
      --theme-struct-table-text: ${theme.structure_table_text};
      --theme-struct-ctrl-bg: ${ctrlBg};
      --theme-struct-ctrl-border: ${ctrlBorder};
      --theme-btn-primary: ${theme.primary_btn};
      --theme-btn-primary-hover: ${theme.primary_btn_hover};
      --theme-btn-primary-text: ${theme.primary_btn_text};
      --theme-btn-primary-tint: ${hexToRgba(theme.primary_btn, 0.10)};
      --theme-accent-blue: #1d4ed8;
      --theme-accent-blue-hover: #1e40af;
      --theme-accent-blue-tint: rgba(29, 78, 216, 0.10);
      --theme-accent-green: #059669;
      --theme-accent-green-hover: #047857;
      --theme-accent-green-tint: rgba(5, 150, 105, 0.10);
      --theme-btn-warn: ${theme.warning_btn};
      --theme-btn-warn-hover: ${theme.warning_btn_hover};
      --theme-btn-warn-text: ${theme.warning_btn_text};
      --theme-btn-danger: ${theme.danger_btn};
      --theme-btn-danger-hover: ${theme.danger_btn_hover};
      --theme-focus-ring: ${hexToRgba(theme.primary_btn, 0.22)};
      --brand-primary: ${theme.primary_btn};
      --brand-hover: ${theme.primary_btn_hover};
      --brand-accent: #059669;
      --brand-glow: ${hexToRgba(theme.primary_btn, 0.24)};
      --sp-primary: ${theme.primary_btn};
      --sp-primary-hover: ${theme.primary_btn_hover};
      --sp-primary-contrast: ${theme.primary_btn_text};
      --sp-success: #059669;
      --sp-warning: ${theme.warning_btn};
      --sp-danger: ${theme.danger_btn};
      --sp-danger-hover: ${theme.danger_btn_hover};
      --sp-focus-ring: ${hexToRgba(theme.primary_btn, 0.22)};
      --header-gradient: ${theme.structure_bg};
      --header-text-color: ${theme.structure_text};
    }
    html[data-chrome-tone="light"][data-theme="dark"],
    html[data-chrome-tone="light"] body.dark {
      --theme-struct-bg: #0f172a;
      --theme-struct-side-bg: #131c2e;
      --theme-struct-text: #f8fafc;
      --theme-struct-muted: #94a3b8;
      --theme-struct-item-bg: #1e293b;
      --theme-struct-item-hover: #24334a;
      --theme-struct-item-text: #e2e8f0;
      --theme-struct-sub-text: #cbd5e1;
      --theme-struct-border: #26354a;
      --theme-struct-table-bg: #1e293b;
      --theme-struct-table-text: #e2e8f0;
      --theme-struct-ctrl-bg: #1e293b;
      --theme-struct-ctrl-border: #334155;
    }
    body, button, input, select, textarea, .card, .dt, .zy-sidenav, .page-title, h1, h2, h3, h4 {
      font-family: var(--app-font) !important;
    }
  `;
}

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendInjectedHtml(res, filePath, req = null) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    const settings = readDb('settings') || {};
    const themeCatalog = getThemeCatalog(settings);
    const defaultThemeKey = (settings.default_theme_key && themeCatalog.some(t => t.key === settings.default_theme_key))
      ? settings.default_theme_key
      : 'cobalt_emerald';

    let userThemeKey = '';
    let userThemeMode = '';
    let userLang = 'en';
    let isOwnerSession = false;
    if (req) {
      try {
        const sUser = getSessionUser(req);
        if (sUser && sUser.username) {
          const sRole = String(sUser.role || '').toLowerCase();
          if (sRole === 'owner' || sRole === 'admin') isOwnerSession = true;
          const found = findUserAnywhere(sUser.username);
          if (found && found.user) {
            if (found.user.theme_key && themeCatalog.some(t => t.key === found.user.theme_key)) {
              userThemeKey = found.user.theme_key;
            }
            if (found.user.theme_mode === 'dark' || found.user.theme_mode === 'light' || found.user.theme_mode === 'system') {
              userThemeMode = found.user.theme_mode;
            }
            if (found.user.language === 'roman_ur' || found.user.language === 'en') {
              userLang = found.user.language;
            }
          }
        }
      } catch (_) {}
    }

    const effectiveTheme = resolveEffectiveTheme(settings, userThemeKey);
    const css = getThemeCss(settings, userThemeKey);
    const safeSettings = {
      site_name: settings.site_name || 'HUMAX SMS',
      logo_url: settings.logo_url || '/static/img/humex-sms-logo.png',
      theme_mode: settings.theme_mode || 'light',
      font_family: settings.font_family || 'jakarta',
      default_theme_key: defaultThemeKey,
      theme_catalog: themeCatalog,
      footer_text: settings.footer_text || `© ${new Date().getFullYear()} ${settings.site_name || 'HUMAX SMS'}. All rights reserved.`
    };

    const siteNameEsc = escHtml(safeSettings.site_name);
    const logoUrlEsc = escHtml(safeSettings.logo_url);

    // Determine clean page title dynamically on the server
    const baseName = path.basename(filePath).toLowerCase();
    let pageTitle = `${siteNameEsc} | Login`;
    if (baseName.includes('index')) pageTitle = `Owner Panel — ${siteNameEsc}`;
    else if (baseName.includes('agent')) pageTitle = `Agent Panel — ${siteNameEsc}`;
    else if (baseName.includes('client')) pageTitle = `Client Panel — ${siteNameEsc}`;
    else if (baseName.includes('dashboard')) pageTitle = `Dashboard — ${siteNameEsc}`;

    // Cleanly replace title and favicon in HTML before sending
    content = content.replace(/<title>[\s\S]*?<\/title>/i, `<title>${pageTitle}</title>`);
    content = content.replace(/<link[^>]*rel=["']icon["'][^>]*>/i, `<link rel="icon" type="image/svg+xml" href="${logoUrlEsc}">`);
    content = content.replace(/HUMEX SMS|Humex SMS|HUMAX SMS|Humax SMS/g, siteNameEsc);
    content = content.replace(/<span class="zy-panel-badge">[\s\S]*?<\/span>/g, `<span class="zy-panel-badge"><img src="${logoUrlEsc}" class="zy-badge-logo" alt="${siteNameEsc}"> <span class="zy-badge-name">${siteNameEsc}</span></span>`);
    content = content.replace(/id="login-logo-img"[^>]*src="[^"]*"/i, `id="login-logo-img" src="${logoUrlEsc}"`);
    content = content.replace(/<div class="zy-avatar-lg"[^>]*>[\s\S]*?<\/div>/g, `<div class="zy-avatar-lg" style="background-color: #ffffff;"><img src="${logoUrlEsc}" alt="${siteNameEsc}" class="zy-ava-dp-img" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;background-color:#ffffff;"></div>`);
    content = content.replace(/<span class="zy-ava"[^>]*>[\s\S]*?<\/span>/g, `<span class="zy-ava" title="Profile" style="background-color: #ffffff;"><img src="${logoUrlEsc}" alt="${siteNameEsc}" class="zy-ava-dp-img" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;background-color:#ffffff;"></span>`);

    if (content.includes('<html')) {
      content = content.replace(/<html([^>]*)>/i, `<html$1 data-chrome-tone="${effectiveTheme.structure_tone}" data-role-theme="${escHtml(effectiveTheme.key)}">`);
    }

    const userThemePayload = { theme_key: userThemeKey, theme_mode: userThemeMode, language: userLang };
    const isProdEnv = process.env.NODE_ENV === 'production';
    const guardEnabled = isProdEnv && process.env.CLIENT_GUARD_ENABLED === 'true';
    const protectOwner = process.env.GUARD_PROTECT_OWNER === 'true';
    const isLoginPage = baseName.includes('login');
    const guardActive = guardEnabled && !isLoginPage && (!isOwnerSession || protectOwner);
    const prodGuardHtml = guardActive
      ? `\n  <script>window.__PROD_GUARD__=${JSON.stringify({ enabled: true })};</script>\n  <script src="/static/js/shared-prod-guard.js"></script>`
      : '';

    // Synchronous head injection right at top of <head> to eliminate FOUC and lag
    const injection = `${prodGuardHtml}
  <script>
    window.__BRAND_SETTINGS__ = ${JSON.stringify(safeSettings)};
    window.__USER_THEME__ = ${JSON.stringify(userThemePayload)};
    try { localStorage.setItem('app_brand_settings', JSON.stringify(window.__BRAND_SETTINGS__)); } catch(e){}
  </script>
  <style id="zero-fouc-shield">
    .zy-header, .adminui .zy-header,
    .zy-header-row, .adminui .zy-header-row {
      background: var(--theme-struct-bg, #ffffff) !important;
      color: var(--theme-struct-text, #0f172a) !important;
      border-bottom: 1.5px solid var(--theme-struct-border, #e2e8f0) !important;
    }
    .zy-side, .adminui .zy-side,
    .zy-sidenav, .adminui .zy-sidenav,
    .zy-side-head, .adminui .zy-side-head,
    .zy-side-foot, .adminui .zy-side-foot {
      background: var(--theme-struct-side-bg, #ffffff) !important;
      background-color: var(--theme-struct-side-bg, #ffffff) !important;
      color: var(--theme-struct-text, #0f172a) !important;
    }
    .zy-main { background-color: var(--sp-bg-canvas, #f8fafc) !important; }
    .zy-panel-badge {
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      font-size: 16px !important;
      font-weight: 800 !important;
      color: var(--theme-struct-text, #0f172a) !important;
      letter-spacing: 0.5px !important;
    }
    .zy-badge-logo {
      height: 32px !important;
      width: auto !important;
      max-width: 140px !important;
      object-fit: contain !important;
      display: inline-block !important;
      vertical-align: middle !important;
    }
    @media (max-width: 768px) {
      .zy-badge-logo { height: 26px !important; max-width: 110px !important; }
    }
    .zy-user .zy-ava, .adminui .zy-user .zy-ava, .zy-avatar-circle {
      width: 38px !important; height: 38px !important; min-width: 38px !important;
      border-radius: 50% !important; background: #ffffff !important;
      border: 2px solid var(--theme-btn-primary, #2563eb) !important;
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      box-shadow: 0 2px 8px var(--theme-focus-ring, rgba(37, 99, 235, 0.25)) !important;
      flex-shrink: 0 !important; overflow: hidden !important; padding: 1px !important;
    }
    .zy-user .zy-ava img, .adminui .zy-user .zy-ava img, .zy-user .zy-ava-dp-img {
      width: 100% !important; height: 100% !important; border-radius: 50% !important;
      object-fit: cover !important; display: block !important; filter: none !important;
    }
    .zy-avatar-lg {
      width: 48px !important; height: 48px !important; min-width: 48px !important;
      border-radius: 50% !important; background: #ffffff !important;
      border: 2px solid var(--theme-btn-primary, #2563eb) !important;
      overflow: hidden !important; display: flex !important; align-items: center !important;
      justify-content: center !important; padding: 2px !important;
      box-shadow: 0 3px 10px var(--theme-focus-ring, rgba(37, 99, 235, 0.2)) !important;
    }
    .zy-avatar-lg img {
      width: 100% !important; height: 100% !important; border-radius: 50% !important;
      object-fit: cover !important; display: block !important; filter: none !important;
    }
  </style>
  <style id="dynamic-brand-styles">${css}</style>
`;
    if (content.includes('<head>')) {
      content = content.replace('<head>', `<head>\n${injection}`);
    } else if (content.includes('</head>')) {
      content = content.replace('</head>', `${injection}\n</head>`);
    } else {
      content = injection + content;
    }

    if (process.env.NODE_ENV === 'production') {
      content = content.replace(
        /((?:src|href)=["']\/static\/(?:js|css)\/[^"']+\.(?:js|css))(["'])/g,
        `$1?v=${ASSET_BUILD_VER}$2`
      );
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.send(content);
  } catch (err) {
    console.error('sendInjectedHtml error:', err);
    res.sendFile(filePath);
  }
}

const PANELS = {
  owner: path.join(STATIC_DIR, 'index.html'),
  admin: path.join(STATIC_DIR, 'index.html'),
  agent: path.join(STATIC_DIR, 'agent.html'),
  client: path.join(STATIC_DIR, 'client.html')
};

// ── Auth APIs & Session Management ──────────────────────────────
const activeSessions = new Map();
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const SESSION_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4h

function hashSessionToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token).digest('hex');
}

function findSessionDbUser(session) {
  if (!session) return null;
  const role = String(session.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin') {
    const users = readDb('users') || [];
    return users.find(u => Number(u.id) === Number(session.id) || String(u.username || '').toLowerCase() === String(session.username || '').toLowerCase()) || null;
  }
  if (role === 'agent') {
    const agents = readDb('agents') || [];
    return agents.find(a => Number(a.id) === Number(session.id) || String(a.username || '').toLowerCase() === String(session.username || '').toLowerCase()) || null;
  }
  if (role === 'client') {
    const clients = readDb('clients') || [];
    return clients.find(c => Number(c.id) === Number(session.id) || String(c.username || '').toLowerCase() === String(session.username || '').toLowerCase()) || null;
  }
  return null;
}

function loadPersistedSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      const now = Date.now();
      let pruned = false;
      for (const [hashedToken, sess] of Object.entries(data)) {
        const withinWindow = sess && now - (sess.created || now) < SESSION_MAX_AGE_MS && now - (sess.lastActive || now) < SESSION_IDLE_TIMEOUT_MS;
        const dbUser = withinWindow ? findSessionDbUser(sess) : null;
        const isDisabled = dbUser && (dbUser.status === 'suspended' || dbUser.status === 'inactive' || dbUser.status === 'deactivated' || dbUser.status === 'disabled');
        if (withinWindow && dbUser && !isDisabled) {
          sess.id = dbUser.id;
          activeSessions.set(hashedToken, sess);
        } else {
          pruned = true;
        }
      }
      if (pruned) savePersistedSessions();
    }
  } catch (e) {
    console.warn('Error loading sessions:', e.message);
  }
}

function savePersistedSessions() {
  try {
    const obj = {};
    const now = Date.now();
    for (const [hashedToken, sess] of activeSessions.entries()) {
      if (now - (sess.created || now) < SESSION_MAX_AGE_MS && now - (sess.lastActive || now) < SESSION_IDLE_TIMEOUT_MS) {
        obj[hashedToken] = sess;
      }
    }
    atomicWriteFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('Error saving sessions:', e.message);
  }
}

loadPersistedSessions();

function parseCookies(req) {
  const list = {};
  const rc = req && req.headers && req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts.shift().trim();
      const val = decodeURIComponent(parts.join('='));
      if (key) list[key] = val;
    });
  }
  return list;
}

function getSessionToken(req) {
  const auth = (req && req.headers && req.headers['authorization']) || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const xSession = (req && req.headers && (req.headers['x-session-token'] || req.headers['x-auth-token'])) || '';
  if (xSession) return String(xSession).trim();
  const cookies = parseCookies(req);
  return cookies['humex_session_token'] || cookies['alpha_session_token'] || cookies['session_token'] || null;
}

function getSessionUser(req) {
  const rawToken = getSessionToken(req);
  if (!rawToken) return null;
  const hashedToken = hashSessionToken(rawToken);
  if (hashedToken && activeSessions.has(hashedToken)) {
    const session = activeSessions.get(hashedToken);
    const now = Date.now();
    if (now - (session.created || now) > SESSION_MAX_AGE_MS || now - (session.lastActive || now) > SESSION_IDLE_TIMEOUT_MS) {
      activeSessions.delete(hashedToken);
      savePersistedSessions();
      return null;
    }

    // Verify account exists and is active in DB (immediately revoke deleted/orphaned accounts)
    const dbUser = findSessionDbUser(session);
    if (!dbUser || dbUser.status === 'suspended' || dbUser.status === 'inactive' || dbUser.status === 'deactivated' || dbUser.status === 'disabled') {
      activeSessions.delete(hashedToken);
      savePersistedSessions();
      return null;
    }

    session.id = dbUser.id;
    session.lastActive = now;
    return session;
  }
  return null;
}

const ROLE_HOME_URL = {
  owner: '/ints/owner/SMSDashboard',
  admin: '/ints/owner/SMSDashboard',
  agent: '/ints/agent/SMSDashboard',
  client: '/ints/client/SMSDashboard'
};

// ── Strict Role Guard Middleware for Express Routes ────────────
function requireRole(allowedRoles) {
  const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.redirect('/ints/login');
    }
    const userRole = (user.role || '').toLowerCase();
    const isOwner = userRole === 'owner' || userRole === 'admin';
    if (!normalizedAllowed.includes(userRole) && !(isOwner && normalizedAllowed.includes('owner'))) {
      return res.redirect(ROLE_HOME_URL[userRole] || '/ints/login');
    }
    next();
  };
}

// ── Strict API Auth & Role Middleware ───────────────────────────
function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.sessionUser = user;
  next();
}

function requireApiRole(allowedRoles) {
  const allowed = allowedRoles.map(r => r.toLowerCase());
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    const userRole = (user.role || '').toLowerCase();
    const isOwner = userRole === 'owner' || userRole === 'admin';
    if (!allowed.includes(userRole) && !(isOwner && allowed.includes('owner'))) {
      return res.status(403).json({ error: 'Forbidden. Your role does not have permission.' });
    }
    req.sessionUser = user;
    next();
  };
}

// ── Role Page Routes with Strict Server-Side Isolation (/ints/ namespace) ───────────
app.get('/ints/login', (req, res) => {
  // If navigating directly to login, always deliver the login screen freshly
  const isHttps = isRequestHttps(req);
  const sec = isHttps ? '; Secure; Partitioned' : '';
  const sameSite = isHttps ? 'None' : 'Lax';
  res.setHeader('Set-Cookie', [
    `humex_session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=${sameSite}${sec}`,
    `humex_session_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=${sameSite}${sec}`,
    `alpha_session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=${sameSite}${sec}`,
    `alpha_session_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=${sameSite}${sec}`,
    `session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=${sameSite}${sec}`
  ]);
  sendInjectedHtml(res, path.join(STATIC_DIR, 'login.html'), req);
});

// Health check endpoints (public, 200 OK for dev server, PM2, Nginx & monitoring probes)
app.get(['/health', '/ping'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Any direct access to /login or / redirects immediately to /ints/login
app.get('/login', (req, res) => {
  res.redirect('/ints/login');
});

app.get('/', (req, res) => {
  const user = getSessionUser(req);
  if (user) {
    const role = (user.role || '').toLowerCase();
    return res.redirect(ROLE_HOME_URL[role] || '/ints/owner/SMSDashboard');
  }
  return res.redirect('/ints/login');
});

// Non-ints panel routes: Direct access without /ints redirects to /ints/login
app.get(['/owner', '/dashboard', '/agent', '/client'], (req, res) => {
  const user = getSessionUser(req);
  if (user) {
    const role = (user.role || '').toLowerCase();
    return res.redirect(ROLE_HOME_URL[role] || '/ints/login');
  }
  return res.redirect('/ints/login');
});

app.get('/ints', (req, res) => res.redirect('/ints/login'));

app.get('/ints/:role', (req, res) => {
  const targetRole = (req.params.role || '').toLowerCase();
  const user = getSessionUser(req);
  if (!user) {
    return res.redirect('/ints/login');
  }
  const userRole = (user.role || '').toLowerCase();
  const isOwnerOrAdmin = r => r === 'admin' || r === 'owner';
  if (userRole !== targetRole && !(isOwnerOrAdmin(userRole) && isOwnerOrAdmin(targetRole))) {
    return res.redirect(ROLE_HOME_URL[userRole] || '/ints/login');
  }
  if (PANELS[targetRole]) {
    return res.redirect(`/ints/${targetRole}/SMSDashboard`);
  }
  res.redirect('/ints/login');
});

app.get('/ints/:role/:page', (req, res) => {
  const targetRole = (req.params.role || '').toLowerCase();
  const user = getSessionUser(req);
  if (!user) {
    return res.redirect('/ints/login');
  }
  const userRole = (user.role || '').toLowerCase();
  const isOwnerOrAdmin = r => r === 'admin' || r === 'owner';
  if (userRole !== targetRole && !(isOwnerOrAdmin(userRole) && isOwnerOrAdmin(targetRole))) {
    return res.redirect(ROLE_HOME_URL[userRole] || '/ints/login');
  }
  if (PANELS[targetRole]) {
    return sendInjectedHtml(res, PANELS[targetRole], req);
  }
  res.redirect('/ints/login');
});

function isUsernameTaken(newUsername, excludeId = null, currentTable = null) {
  if (!newUsername) return false;
  const raw = String(newUsername).trim().toLowerCase();
  const clean = raw.replace(/[\s-]+/g, '_');
  const pure = clean.replace(/[^a-z0-9]/g, '');
  if (!clean) return false;

  // Protect Owner & Admin fixed handles across entire system
  const isEditingOwner = (excludeId === 1 || String(excludeId) === '1') && currentTable === 'users';
  if (!isEditingOwner) {
    if (clean === 'kamran_bhatti' || pure === 'kamranbhatti' || clean === 'owner' || clean === 'admin') {
      return true;
    }
  }

  const tables = ['users', 'agents', 'clients', 'registration_requests'];
  for (const tbl of tables) {
    const rows = readDb(tbl) || [];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (!r || !r.username) continue;
      const exRaw = String(r.username).trim().toLowerCase();
      const exClean = exRaw.replace(/[\s-]+/g, '_');
      const exPure = exClean.replace(/[^a-z0-9]/g, '');
      if (exClean === clean || (pure && exPure === pure) || exRaw === raw) {
        if (excludeId !== null && currentTable === tbl && (r.id === excludeId || String(r.id) === String(excludeId))) {
          continue;
        }
        return true;
      }
    }
  }
  return false;
}

app.get('/api/check-username', (req, res) => {
  const u = String(req.query.username || '').trim();
  const excludeId = req.query.exclude_id ? Number(req.query.exclude_id) : null;
  const table = req.query.table ? String(req.query.table).trim() : null;
  if (!u) {
    return res.json({ available: false, exists: false, error: 'Username is required', message: 'Username is required' });
  }
  const taken = isUsernameTaken(u, excludeId, table);
  if (taken) {
    return res.json({
      available: false,
      exists: true,
      error: 'This username already exists',
      message: 'This username already exists. Please choose a different username.'
    });
  }
  return res.json({
    available: true,
    exists: false,
    message: 'Username is available'
  });
});

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let index = 0;
  const clean = (str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const output = new Uint8Array(((clean.length * 5) / 8) | 0);
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function verifyTotp(token, secret, window = 1) {
  if (!token || !secret) return false;
  try {
    const key = base32Decode(secret);
    if (!key || key.length === 0) return false;
    const epoch = Math.floor(Date.now() / 1000);
    const timeStep = 30;
    const currentCounter = Math.floor(epoch / timeStep);

    for (let w = -window; w <= window; w++) {
      const counter = currentCounter + w;
      const buf = Buffer.alloc(8);
      buf.writeBigInt64BE(BigInt(counter), 0);
      const hmac = crypto.createHmac('sha1', key).update(buf).digest();
      const offset = hmac[hmac.length - 1] & 0xf;
      const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
      if (code === String(token).trim()) return true;
    }
  } catch (e) {
    console.error('verifyTotp error:', e);
  }
  return false;
}

function generateBase32Secret(len = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(len);
  let res = '';
  for (let i = 0; i < len; i++) {
    res += alphabet[bytes[i] % 32];
  }
  return res;
}

function findUserAnywhere(identifier) {
  if (!identifier) return null;
  const q = String(identifier).trim().toLowerCase();
  const tables = ['users', 'agents', 'clients'];
  for (const tbl of tables) {
    const rows = readDb(tbl) || [];
    const found = rows.find(x => {
      if (!x) return false;
      const u = String(x.username || '').trim().toLowerCase();
      const e = String(x.email || '').trim().toLowerCase();
      return u === q || e === q || (u === 'kamran_bhatti' && (q === 'kamran' || q === 'owner'));
    });
    if (found) {
      const defaultRole = tbl === 'agents' ? 'Agent' : tbl === 'clients' ? 'Client' : 'Owner';
      return { user: found, table: tbl, role: found.role || defaultRole };
    }
  }
  return null;
}

function updateUserRecord(table, userId, updates) {
  const rows = readDb(table) || [];
  const idx = rows.findIndex(x => x && (x.id === userId || String(x.id) === String(userId)));
  if (idx !== -1) {
    rows[idx] = { ...rows[idx], ...updates };
    writeDb(table, rows);
    return rows[idx];
  }
  return null;
}

function safeUser(u) {
  if (!u || typeof u !== 'object') return u;
  if (Array.isArray(u)) return u.map(safeUser);
  const copy = { ...u };
  for (const k of Object.keys(copy)) {
    const lk = k.toLowerCase();
    if (
      lk === 'password' ||
      lk === 'two_fa_secret' ||
      lk === 'two_fa_backup_codes' ||
      lk === 'pending_2fa_secret' ||
      lk.includes('token') ||
      lk.includes('secret') ||
      lk.includes('otp')
    ) {
      delete copy[k];
    }
  }
  return copy;
}

// ── Global API Guard: deny by default + role matrix ─────────────
function normRole(r) { r = String(r || '').toLowerCase(); return r === 'admin' ? 'owner' : r; }
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// First matching rule wins. Roles are lower-case; 'owner' includes the legacy 'admin'.
const API_RULES = [
  { p: /^\/(backup|login-panels|cr-api-connections|whitenoise-connections|whitenoise-excel|firewall|owner|providers|payout-rates|permissions)(\/|$)/, roles: ['owner'] },
  { p: /^\/(reports|dashboard|cli-routes)(\/|$)/, roles: ['owner'] },
  { p: /^\/numbers\/(upload|import-to-range|bulk-range-import|smart-sheet-preview|smart-sheet-commit|bulk-delete-many|download|test|blacklist)(\/.*)?$/, roles: ['owner'] },
  { m: new Set(['POST']), p: /^\/numbers$/, roles: ['owner'] },
  { m: new Set(['DELETE']), p: /^\/numbers\/[^/]+$/, roles: ['owner'] },
  { p: /^\/numbers\/(bulk-allocate|allocation-history|blocked)(\/.*)?$/, roles: ['owner', 'agent'] },
  { m: WRITE_METHODS, p: /^\/(audit-logs|login-activity)(\/|$)/, roles: ['owner'] },
  { p: /^\/rate-limits(\/|$)/, roles: ['owner'] },
  { m: WRITE_METHODS, p: /^\/(settings|services|registration-requests|payterms|monthly-cycle|app-links|announcements)(\/|$)/, roles: ['owner'] },
  { m: WRITE_METHODS, p: /^\/numbers\/(sms-ranges|rate-card)(\/.*)?$/, roles: ['owner'] },
  { m: WRITE_METHODS, p: /^\/number-transfers(\/|$)/, roles: ['owner'] },
  { m: new Set(['POST']), p: /^\/notifications$/, roles: ['owner'] },
  { m: new Set(['PATCH', 'DELETE']), p: /^\/payout-requests(\/|$)/, roles: ['owner', 'agent'] },
  { m: new Set(['POST']), p: /^\/payout-requests(\/|$)/, roles: ['owner', 'agent', 'client'] },
  { m: WRITE_METHODS, p: /^\/payments(\/|$)/, roles: ['owner', 'agent'] },
  { p: /^\/agent\/(client-rates|pkr-target)(\/|$)/, roles: ['agent'] },
  { m: new Set(['GET']), p: /^\/client\/rate-card$/, roles: ['client', 'agent'] }
];
// Client is default-deny: only these routes exist for them.
const CLIENT_ALLOW = [
  { p: /^\/(auth|user|account|notifications|support-tickets|chat)(\/|$)/ },
  { m: new Set(['GET']), p: /^\/(settings|announcements|payterms|monthly-cycle|app-links|live-access)(\/|$)/ },
  { m: new Set(['GET']), p: /^\/numbers$/ },
  { m: new Set(['GET']), p: /^\/numbers\/sms-ranges$/ },
  { m: new Set(['GET']), p: /^\/numbers\/rate-card$/ },
  { m: new Set(['GET']), p: /^\/numbers\/allocation-policy$/ },
  { m: new Set(['GET']), p: /^\/numbers\/range-return-batches$/ },
  { m: new Set(['POST']), p: /^\/numbers\/return-by-date$/ },
  { m: new Set(['POST']), p: /^\/numbers\/\d+\/whitenoise-fetch$/ },
  { m: new Set(['GET']), p: /^\/client\/rate-card$/ },
  { m: new Set(['POST']), p: /^\/numbers\/(agent-allocate|request)$/ },
  { m: new Set(['POST']), p: /^\/numbers\/(\d+\/)?return$/ },
  { m: new Set(['GET']), p: /^\/agent-requests(\/\d+)?$/ },
  { m: new Set(['GET', 'POST']), p: /^\/client-requests(\/\d+)?$/ },
  { m: new Set(['GET']), p: /^\/sms\/(logs|export|client-logs|daily-stats|period-stats|client-stats|stats)$/ },
  { m: new Set(['GET', 'POST']), p: /^\/cdr2(\/|$)/ },
  { m: new Set(['GET', 'PATCH']), p: /^\/clients(\/\d+)?$/ },
  { m: new Set(['GET']), p: /^\/client\/\d+\// },
  { m: new Set(['GET']), p: /^\/(credit-notes|statements)(\/|$)/ },
  { m: new Set(['GET', 'POST']), p: /^\/payout-requests(\/|$)/ },
  { m: new Set(['GET']), p: /^\/payments(\/|$)/ }
];
function ruleHit(list, p, method) { return list.some(r => (!r.m || r.m.has(method)) && r.p.test(p)); }

function getInboundToken() {
  return process.env.INBOUND_TOKEN ? String(process.env.INBOUND_TOKEN) : '';
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

app.use('/api', (req, res, next) => {
  const p = req.path;
  const method = req.method.toUpperCase();

  // 0. Public health check / ping
  if ((p === '/health' || p === '/ping') && method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  // 1. Public auth endpoints
  if (p === '/auth/login' || p === '/auth/logout' || p === '/auth/me' || p === '/auth/captcha') {
    return next();
  }
  // 2. Branding for the login page (the route itself filters what an anonymous caller may see)
  if ((p === '/settings' || p === '/settings/min-payout' || p === '/payterms') && (method === 'GET' || method === 'HEAD')) return next();

  // 3. Inbound carrier webhook: a shared secret is REQUIRED
  if (p === '/sms/inbound' || p === '/inbound' || p === '/sms/receive') {
    const expected = getInboundToken();
    if (!expected) {
      console.error('[SECURITY] Inbound webhook refused: INBOUND_TOKEN is not configured.');
      return res.status(503).json({ status: 'error', error: 'Inbound webhook is disabled until INBOUND_TOKEN is configured.' });
    }
    const sent = String(req.headers['x-inbound-token'] || '');
    if (!sent || !safeEqual(sent, expected)) return res.status(403).json({ status: 'error', error: 'Forbidden. Invalid inbound token.' });
    return next();
  }

  // 4. Everything else needs a session
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized. Please log in.' });

  // 5b. CSRF origin check for cookie-authenticated state-changing browser requests
  const hasExplicitAuthHeader = Boolean(
    (req.headers['authorization'] && String(req.headers['authorization']).startsWith('Bearer ')) ||
    req.headers['x-session-token'] ||
    req.headers['x-auth-token']
  );
  if (WRITE_METHODS.has(method) && !hasExplicitAuthHeader) {
    const reqOrigin = req.headers.origin;
    const reqReferer = req.headers.referer;
    const effectiveHosts = getEffectiveHosts(req);
    const checkUrlHost = (rawUrl) => {
      try {
        const u = new URL(rawUrl);
        return effectiveHosts.has(u.host.toLowerCase()) || ALLOWED_ORIGINS.has(`${u.protocol}//${u.host}`.toLowerCase());
      } catch (_) {
        return false;
      }
    };
    if (reqOrigin && !checkUrlHost(reqOrigin)) {
      return res.status(403).json({ error: 'Forbidden. Invalid CSRF origin.' });
    }
    if (!reqOrigin && reqReferer && !checkUrlHost(reqReferer)) {
      return res.status(403).json({ error: 'Forbidden. Invalid CSRF referer.' });
    }
  }

  req.sessionUser = user;
  const role = normRole(user.role);

  // 6. Client: allow-list only
  if (role === 'client' && !ruleHit(CLIENT_ALLOW, p, method)) return res.status(403).json({ error: 'Forbidden for your role.' });

  // 7. Owner / Agent: rule table
  for (const r of API_RULES) {
    if ((!r.m || r.m.has(method)) && r.p.test(p)) {
      if (!r.roles.includes(role)) return res.status(403).json({ error: 'Forbidden. Your role cannot do this.' });
      break;
    }
  }
  next();
});

// ── In-Memory Math Captcha Challenge Store ───────────────────────
const activeCaptchas = new Map();
function cleanExpiredCaptchas() {
  const now = Date.now();
  for (const [id, c] of activeCaptchas.entries()) {
    if (now > c.expires) activeCaptchas.delete(id);
  }
}
setInterval(cleanExpiredCaptchas, 5 * 60 * 1000);

app.get('/api/auth/captcha', (req, res) => {
  cleanExpiredCaptchas();
  const n1 = crypto.randomInt(1, 13);
  const n2 = crypto.randomInt(1, 13);
  const answer = n1 + n2;
  const id = crypto.randomBytes(16).toString('hex');
  activeCaptchas.set(id, { answer, expires: Date.now() + 10 * 60 * 1000 });
  res.json({ id, question: `What is ${n1} + ${n2} =` });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, two_fa_code, captcha_id, captcha_answer } = req.body || {};
  const u = (username || '').trim();
  const p = (password || '').trim();

  if (!u || !p) {
    return res.status(400).json({ success: false, error: 'Username and password are required', detail: 'Username and password are required' });
  }

  // Strict math captcha verification (always required)
  cleanExpiredCaptchas();
  if (!captcha_id || captcha_answer === undefined || String(captcha_answer).trim() === '') {
    return res.status(400).json({ success: false, error: 'Please enter the correct answer to the math captcha.', detail: 'Missing captcha' });
  }
  const capRecord = activeCaptchas.get(String(captcha_id));
  if (!capRecord || Date.now() > capRecord.expires) {
    if (capRecord) activeCaptchas.delete(String(captcha_id));
    return res.status(400).json({ success: false, error: 'Captcha expired. Please refresh and try again.', detail: 'Captcha expired' });
  }
  const parsedAns = parseInt(String(captcha_answer).trim(), 10);
  if (isNaN(parsedAns) || parsedAns !== capRecord.answer) {
    activeCaptchas.delete(String(captcha_id));
    return res.status(400).json({ success: false, error: 'Incorrect captcha answer. Please try again.', detail: 'Invalid captcha' });
  }
  // Captcha is single-use: consume immediately upon verification
  activeCaptchas.delete(String(captcha_id));

  const clientIp = req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  if (isIpBlocked(clientIp)) {
    logFirewallEvent(clientIp, 'Login Blocked IP', '/api/auth/login');
    return res.status(403).json({ success: false, error: 'Access denied — IP blocked', detail: 'Access denied — IP blocked' });
  }

  // Rate limit: max 10 attempts per minute per IP
  if (isRateLimited('login:' + clientIp, 10, 60 * 1000)) {
    return res.status(429).json({ success: false, error: 'Too many login attempts. Please wait 1 minute before trying again.', detail: 'Rate limit exceeded' });
  }

  // Exact or normalized username lookup across role tables
  const cleanU = u.toLowerCase().replace(/[\s-]+/g, '_');
  const users = readDb('users') || [];
  let user = users.find(x => {
    if (!x || !x.username) return false;
    const name = String(x.username).trim().toLowerCase();
    return name === cleanU || name.replace(/_/g, '') === cleanU.replace(/_/g, '') ||
           (name === 'kamran_bhatti' && (cleanU === 'kamran' || cleanU === 'kamran_bhatti' || cleanU === 'owner' || cleanU === 'admin'));
  });
  let source = 'users';

  if (!user) {
    const agents = readDb('agents') || [];
    user = agents.find(x => x && x.username && String(x.username).trim().toLowerCase() === cleanU);
    if (user) source = 'agents';
  }

  if (!user) {
    const clients = readDb('clients') || [];
    user = clients.find(x => x && x.username && String(x.username).trim().toLowerCase() === cleanU);
    if (user) source = 'clients';
  }

  // Lockout keys: IP+user and global per-account lockout (not bypassable by IP spoofing)
  const isOwnerOrAdmin = user && (
    (source === 'users' && (String(user.role || '').toLowerCase() === 'owner' || String(user.role || '').toLowerCase() === 'admin' || user.id === 1)) ||
    cleanU === 'kamran_bhatti' || cleanU === 'kamran' || cleanU === 'owner' || cleanU === 'admin'
  );

  const userLockKey = user
    ? ('login_user:' + clientIp + ':' + user.id)
    : ('login_user:' + clientIp + ':unknown:' + cleanU);
  const acctLockKey = user
    ? ('login_acct:' + source + ':' + user.id)
    : ('login_acct:unknown:' + cleanU);

  const maxLoginAttempts = isOwnerOrAdmin ? 10 : 5;
  const userBucket = rateLimitBuckets.get(userLockKey);
  const acctBucket = rateLimitBuckets.get(acctLockKey);
  if (
    (userBucket && (Date.now() - userBucket.start < 15 * 60 * 1000) && userBucket.count >= maxLoginAttempts) ||
    (acctBucket && (Date.now() - acctBucket.start < 15 * 60 * 1000) && acctBucket.count >= maxLoginAttempts)
  ) {
    return res.status(429).json({ success: false, error: 'Too many failed login attempts. Please wait 15 minutes before trying again.', detail: 'Rate limit exceeded' });
  }

  // Password Verification: strict bcrypt verification
  let passwordValid = false;
  if (user && user.password) {
    if (verifyPassword(p, user.password)) {
      passwordValid = true;
    }
  }

  if (passwordValid && user.password && !user.password.startsWith('$2a$') && !user.password.startsWith('$2b$')) {
    // Automatically upgrade plaintext to bcrypt hash upon successful login
    updateUserRecord(source, user.id, { password: hashPassword(p) });
  }

  if (passwordValid) {
    if (user.status === 'suspended' || user.status === 'inactive' || user.status === 'deactivated') {
      return res.status(403).json({ success: false, error: 'Account inactive or suspended', detail: 'Account inactive or suspended' });
    }

    // ── TWO-FACTOR AUTHENTICATION (2FA) CHECK ──
    if (user.two_fa && user.two_fa_secret) {
      if (!two_fa_code) {
        if (isRateLimited('login_2fa_prompt:' + source + ':' + user.id, 10, 15 * 60 * 1000)) {
          return res.status(429).json({ success: false, error: 'Too many 2FA challenges. Please wait 15 minutes.', detail: 'Rate limit exceeded' });
        }
        return res.json({
          success: false,
          require_2fa: true,
          message: 'Enter your 2FA code.'
        });
      }
      const is2faValid = verifyTotp(two_fa_code, user.two_fa_secret) ||
        (Array.isArray(user.two_fa_backup_codes) && user.two_fa_backup_codes.includes(String(two_fa_code).trim()));
      if (!is2faValid) {
        isRateLimited(userLockKey, maxLoginAttempts, 15 * 60 * 1000);
        isRateLimited(acctLockKey, maxLoginAttempts, 15 * 60 * 1000);
        return res.status(401).json({
          success: false,
          require_2fa: true,
          error: 'Invalid 2FA code. Please check your Authenticator app.'
        });
      }
    }

    // Unambiguous Role Resolution (Strict 3-Tier: Owner, Agent, Client)
    let role = 'Owner';
    if (source === 'agents') {
      role = 'Agent';
    } else if (source === 'clients') {
      role = 'Client';
    } else {
      role = 'Owner';
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashSessionToken(sessionToken);
    const userPayload = {
      id: user.id || 1,
      username: user.username,
      role: role,
      email: user.email || '',
      two_fa: !!user.two_fa,
      source: source,
      agent_id: user.agent_id || null,
      commission_rate: user.commission_rate || 5.0,
      theme_key: user.theme_key || '',
      theme_mode: (user.theme_mode === 'dark' || user.theme_mode === 'light' || user.theme_mode === 'system') ? user.theme_mode : ''
    };

    activeSessions.set(hashedToken, {
      ...userPayload,
      created: Date.now(),
      lastActive: Date.now()
    });
    savePersistedSessions();

    const isHttps = isRequestHttps(req);
    const sec = isHttps ? '; Secure; Partitioned' : '';
    const sameSite = isHttps ? 'None' : 'Lax';

    // Set secure HTTP session cookies with HttpOnly protection (iframe friendly)
    res.setHeader('Set-Cookie', [
      `humex_session_token=${sessionToken}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=86400${sec}`,
      `humex_session_role=${role}; Path=/; SameSite=${sameSite}; Max-Age=86400${sec}`,
      `session_token=${sessionToken}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=86400${sec}`
    ]);

    rateLimitBuckets.delete(userLockKey);
    rateLimitBuckets.delete(acctLockKey);
    rateLimitBuckets.delete('login_2fa_prompt:' + source + ':' + user.id);
    logAudit(user.username, 'Login Success', `Logged in as ${role}`, 'Auth');

    return res.json({
      success: true,
      user: userPayload,
      role: role,
      username: user.username,
      id: user.id || 1,
      agent_id: user.agent_id || null,
      commission_rate: user.commission_rate || 5.0
    });
  }

  isRateLimited(userLockKey, maxLoginAttempts, 15 * 60 * 1000);
  isRateLimited(acctLockKey, maxLoginAttempts, 15 * 60 * 1000);
  logAudit(u, 'Login Failed', 'Invalid username or password', 'Auth');
  return res.status(401).json({ success: false, error: 'Invalid username or password', detail: 'Invalid username or password' });
});

// ── USER PROFILE & SECURITY APIS ────────────────────────────────
app.get('/api/user/profile', (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const found = findUserAnywhere(sessionUser.username);
  if (!found) return res.status(404).json({ success: false, error: 'User not found' });

  const u = found.user;
  const themeCatalog = getThemeCatalog(readDb('settings') || {});
  const validUserThemeKey = (u.theme_key && themeCatalog.some(t => t.key === u.theme_key)) ? u.theme_key : '';
  res.json({
    success: true,
    user: {
      id: u.id,
      username: u.username,
      role: found.role,
      full_name: u.full_name || u.name || '',
      email: u.email || '',
      phone: u.phone || u.contact || '',
      teams: u.teams || '',
      theme_mode: (u.theme_mode === 'dark' || u.theme_mode === 'light' || u.theme_mode === 'system') ? u.theme_mode : '',
      theme_key: validUserThemeKey,
      two_fa: !!u.two_fa,
      two_fa_backup_count: Array.isArray(u.two_fa_backup_codes) ? u.two_fa_backup_codes.length : 0,
      status: u.status || 'active'
    }
  });
});

app.post('/api/user/profile/update', (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const found = findUserAnywhere(sessionUser.username);
  if (!found) return res.status(404).json({ success: false, error: 'User not found' });

  const { full_name, phone, teams, email, theme_mode, theme_key, language } = req.body || {};
  const updates = {};
  const changedFields = [];
  if (full_name !== undefined) {
    updates.full_name = String(full_name).trim();
    changedFields.push('full_name');
  }
  if (phone !== undefined) {
    updates.phone = String(phone).trim();
    changedFields.push('phone');
  }
  if (teams !== undefined) {
    updates.teams = String(teams).trim();
    changedFields.push('teams');
  }
  if (email !== undefined) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (cleanEmail && (!cleanEmail.includes('@') || !cleanEmail.includes('.'))) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }
    updates.email = cleanEmail;
    changedFields.push('email');
  }
  if (theme_mode !== undefined) {
    const cleanTheme = String(theme_mode).trim().toLowerCase();
    if (!['light', 'dark', 'system'].includes(cleanTheme)) {
      return res.status(400).json({ success: false, error: 'Invalid theme preference' });
    }
    updates.theme_mode = cleanTheme;
  }
  if (language !== undefined) {
    const cleanLang = String(language).trim().toLowerCase();
    if (!['en', 'roman_ur'].includes(cleanLang)) {
      return res.status(400).json({ success: false, error: 'Invalid language preference' });
    }
    updates.language = cleanLang;
  }
  if (theme_key !== undefined) {
    const rawKey = String(theme_key || '').trim();
    if (!rawKey || rawKey === 'default' || rawKey === 'system_default') {
      updates.theme_key = '';
    } else {
      const catalog = getThemeCatalog(readDb('settings') || {});
      if (!catalog.some(t => t.key === rawKey)) {
        return res.status(400).json({ success: false, error: 'Selected theme is not published by Owner.' });
      }
      updates.theme_key = rawKey;
    }
  }

  updateUserRecord(found.table, found.user.id, updates);
  if (changedFields.length > 0) {
    logAudit(sessionUser.username, 'Profile Updated', `Updated ${changedFields.join(', ')}`, 'Profile');
  }
  res.json({
    success: true,
    message: 'Profile updated successfully',
    user: {
      full_name: updates.full_name !== undefined ? updates.full_name : (found.user.full_name || found.user.name || ''),
      email: updates.email !== undefined ? updates.email : (found.user.email || ''),
      phone: updates.phone !== undefined ? updates.phone : (found.user.phone || found.user.contact || ''),
      teams: updates.teams !== undefined ? updates.teams : (found.user.teams || ''),
      theme_mode: updates.theme_mode !== undefined ? updates.theme_mode : (found.user.theme_mode || ''),
      theme_key: updates.theme_key !== undefined ? updates.theme_key : (found.user.theme_key || ''),
      language: updates.language !== undefined ? updates.language : (found.user.language || 'en')
    }
  });
});

// ── 2FA SETUP & TOGGLE ──────────────────────────────────────────
app.post('/api/user/2fa/setup', async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const found = findUserAnywhere(sessionUser.username);
  if (!found) return res.status(404).json({ success: false, error: 'User not found' });

  const { password } = req.body || {};
  if (!password || !verifyPassword(password, found.user.password)) {
    return res.status(400).json({ success: false, error: 'Please enter your correct account password' });
  }

  const secret = generateBase32Secret(20);
  const settings = readDb('settings') || {};
  const appName = settings.site_name || 'HUMAX SMS';
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(appName)}:${encodeURIComponent(found.user.username)}?secret=${secret}&issuer=${encodeURIComponent(appName)}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    updateUserRecord(found.table, found.user.id, { pending_2fa_secret: secret });

    res.json({
      success: true,
      secret: secret,
      qr: qrDataUrl
    });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate 2FA QR code' });
  }
});

app.post('/api/user/2fa/enable', (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const found = findUserAnywhere(sessionUser.username);
  if (!found) return res.status(404).json({ success: false, error: 'User not found' });

  const { code } = req.body || {};
  const secret = found.user.pending_2fa_secret;
  if (!secret) {
    return res.status(400).json({ success: false, error: 'No 2FA setup in progress. Please click Set up 2FA first.' });
  }

  if (!verifyTotp(code, secret)) {
    return res.status(400).json({ success: false, error: 'Invalid 6-digit code. Check your Google Authenticator app.' });
  }

  const backupCodes = [
    `BK-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    `BK-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    `BK-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  ];

  updateUserRecord(found.table, found.user.id, {
    two_fa: true,
    two_fa_secret: secret,
    two_fa_backup_codes: backupCodes,
    pending_2fa_secret: null
  });

  logAudit(sessionUser.username, '2FA Enabled', 'Two-Factor Authentication successfully enabled', 'Security');

  res.json({
    success: true,
    message: 'Two-Factor Authentication is now ENABLED!',
    backup_codes: backupCodes
  });
});

app.post('/api/user/2fa/disable', (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const found = findUserAnywhere(sessionUser.username);
  if (!found) return res.status(404).json({ success: false, error: 'User not found' });

  const { password, code } = req.body || {};
  if (!password || !verifyPassword(password, found.user.password)) {
    return res.status(400).json({ success: false, error: 'Invalid password' });
  }

  const isValidCode = verifyTotp(code, found.user.two_fa_secret) ||
    (Array.isArray(found.user.two_fa_backup_codes) && found.user.two_fa_backup_codes.includes(String(code).trim()));

  if (!isValidCode) {
    return res.status(400).json({ success: false, error: 'Invalid password or code.' });
  }

  updateUserRecord(found.table, found.user.id, {
    two_fa: false,
    two_fa_secret: null,
    two_fa_backup_codes: []
  });

  logAudit(sessionUser.username, '2FA Disabled', 'Two-Factor Authentication disabled', 'Security');
  res.json({ success: true, message: 'Two-Factor Authentication has been DISABLED' });
});

app.post('/api/user/password/change', (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const found = findUserAnywhere(sessionUser.username);
  if (!found) return res.status(404).json({ success: false, error: 'User not found' });

  const { current_password, new_password } = req.body || {};
  if (!current_password || !verifyPassword(current_password, found.user.password)) {
    return res.status(400).json({ success: false, error: 'Current password is incorrect' });
  }
  if (!new_password || String(new_password).trim().length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
  }

  updateUserRecord(found.table, found.user.id, { password: hashPassword(String(new_password).trim()) });
  logAudit(sessionUser.username, 'Password Changed', 'User updated account password', 'Security');
  res.json({ success: true, message: 'Password updated successfully!' });
});

function handleSessionLogout(req, res) {
  const token = getSessionToken(req);
  if (token) {
    const hashed = hashSessionToken(token);
    activeSessions.delete(hashed);
    savePersistedSessions();
  }
  const isHttps = isRequestHttps(req);
  const sec = isHttps ? '; Secure; Partitioned' : '';
  const sameSite = isHttps ? 'None' : 'Lax';
  res.setHeader('Set-Cookie', [
    `humex_session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=${sameSite}${sec}`,
    `humex_session_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=${sameSite}${sec}`,
    `alpha_session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=${sameSite}${sec}`,
    `alpha_session_role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=${sameSite}${sec}`,
    `session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=${sameSite}${sec}`
  ]);
  res.json({ success: true, message: 'Logged out successfully' });
}

app.post('/api/auth/logout', handleSessionLogout);
app.post('/api/logout', handleSessionLogout);

app.get('/api/auth/me', (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const wnAccess = hasWhitenoiseAccess(sessionUser);
  const appLinksAccess = hasAppLinksAccess(sessionUser);
  const liveAccessEnabled = hasLiveAccess(sessionUser);
  const found = findUserAnywhere(sessionUser.username);
  const dbUser = (found && found.user) || {};
  const catalog = getThemeCatalog(readDb('settings') || {});
  const validUserThemeKey = (dbUser.theme_key && catalog.some(t => t.key === dbUser.theme_key)) ? dbUser.theme_key : '';
  res.json({
    success: true,
    id: sessionUser.id,
    username: sessionUser.username,
    role: sessionUser.role,
    agent_id: sessionUser.agent_id || null,
    alloc_mode: sessionUser.alloc_mode || null,
    alloc_daily_limit: sessionUser.alloc_daily_limit ?? null,
    alloc_total_limit: sessionUser.alloc_total_limit ?? null,
    theme_key: validUserThemeKey,
    theme_mode: (dbUser.theme_mode === 'dark' || dbUser.theme_mode === 'light' || dbUser.theme_mode === 'system') ? dbUser.theme_mode : '',
    whitenoise_access: wnAccess,
    app_links_access: appLinksAccess,
    live_access_enabled: liveAccessEnabled,
    cdr2_terms_accepted: Boolean(dbUser.cdr2_terms_accepted_at),
    cdr2_terms_accepted_at: dbUser.cdr2_terms_accepted_at || null,
    permissions: sessionUser.role === 'Owner' ? ['all'] : [sessionUser.role.toLowerCase()]
  });
});

app.post('/api/account/change-password', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const b = req.body || {};
  const current_password = b.current_password || b.currentPassword || b.oldPassword || b.old_password;
  const new_password = b.new_password || b.newPassword;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (String(new_password).trim().length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }
  const table = sessionUser.source || (sessionUser.role === 'Agent' ? 'agents' : sessionUser.role === 'Client' ? 'clients' : 'users');
  const data = readDb(table);
  const user = data.find(x => Number(x.id) === Number(sessionUser.id));
  if (!user || !verifyPassword(current_password, user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  user.password = hashPassword(new_password);
  writeDb(table, data);
  logAudit(sessionUser.username, 'Password Changed', 'User changed own password', 'Auth');
  res.json({ success: true });
});

// ── Scoped SMS Helper (Strict 3-Tier) ─────────────────────────────
function getScopedSmsList(req, fromDate = null) {
  const sessionUser = req.sessionUser || getSessionUser(req);
  if (!sessionUser) return [];
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgent = sRole === 'agent';
  const isClient = sRole === 'client';

  const queryFrom = fromDate || (req.query && (req.query.date_from || req.query.from || req.query.dt1));
  let list = readSmsWithArchive(queryFrom);

  if (isOwner) {
    const qAgentId = req.query.agent_id;
    const qClientId = req.query.client_id;
    if (qAgentId && qAgentId !== 'undefined' && qAgentId !== 'null') {
      list = list.filter(s => Number(s.agent_id) === Number(qAgentId));
    }
    if (qClientId && qClientId !== 'undefined' && qClientId !== 'null') {
      list = list.filter(s => Number(s.client_id) === Number(qClientId));
    }
  } else if (isAgent) {
    const myId = Number(sessionUser.id);
    list = list.filter(s => Number(s.agent_id) === myId);
    const qClientId = req.query.client_id;
    if (qClientId && qClientId !== 'undefined' && qClientId !== 'null') {
      list = list.filter(s => Number(s.client_id) === Number(qClientId));
    }
  } else if (isClient) {
    const myId = Number(sessionUser.id);
    const myUname = String(sessionUser.username || '').trim().toLowerCase();
    // Strictly match active client_id (never leak deleted client records even if username was recreated)
    list = list.filter(s =>
      !s.client_deleted && (
        (s.client_id != null && s.client_id !== '' && Number(s.client_id) === myId) ||
        ((s.client_id == null || s.client_id === '') && s.client_username && String(s.client_username).trim().toLowerCase() === myUname)
      )
    );
  } else {
    list = [];
  }
  return list;
}

// ── Dashboard Stats ───────────────────────────────────────────
app.get('/api/dashboard/stats', (req, res) => {
  const numbers = readDb('numbers') || [];
  const sms = readDb('sms_log') || [];
  const wnStats = readDb('whitenoise_daily_stats') || [];
  const users = readDb('users') || [];
  const reg_req = readDb('registration_requests') || [];
  const pay_req = readDb('payout_requests') || [];
  const blocked = readDb('blocked_ips') || [];

  const { todaySet, yesterdaySet, weekStartStr, monthStartStr, yearStartStr } = getDateRangeBuckets();

  let apiTodayCount = 0;
  let apiYesterdayCount = 0;
  let apiWeekCount = 0;
  let apiMonthCount = 0;
  let apiYearCount = 0;
  let apiTotalSms = 0;
  let wnTodayCount = 0;
  let wnYesterdayCount = 0;
  let wnWeekCount = 0;
  let wnMonthCount = 0;
  let wnYearCount = 0;
  let wnTotalSms = 0;
  let revenueToday = 0;

  for (const s of sms) {
    const isWnRow = Boolean(
      s && (
        s.is_whitenoise ||
        String(s.source || '').toLowerCase() === 'whitenoise' ||
        String(s.provider || '').toLowerCase().includes('whitenoise') ||
        String(s.payout_schedule || '').toLowerCase() === 'monthly30_5'
      )
    );
    if (isWnRow) wnTotalSms++;
    else apiTotalSms++;
    const dStr = extractDateStr(s);
    if (!dStr) continue;
    if (todaySet.has(dStr)) {
      if (isWnRow) wnTodayCount++;
      else apiTodayCount++;
      revenueToday += (Number(s.profit || s.carrier_revenue) || 0);
    } else if (yesterdaySet.has(dStr)) {
      if (isWnRow) wnYesterdayCount++;
      else apiYesterdayCount++;
    }
    if (dStr >= weekStartStr) {
      if (isWnRow) wnWeekCount++;
      else apiWeekCount++;
    }
    if (dStr >= monthStartStr) {
      if (isWnRow) wnMonthCount++;
      else apiMonthCount++;
    }
    if (dStr >= yearStartStr) {
      if (isWnRow) wnYearCount++;
      else apiYearCount++;
    }
  }

  for (const st of wnStats) {
    const c = Math.max(0, Math.round(Number(st.sms_count) || 0));
    const dStr = String(st.date_ymd || '').slice(0, 10);
    if (!c) continue;
    wnTotalSms += c;
    if (dStr) {
      if (todaySet.has(dStr)) {
        wnTodayCount += c;
        revenueToday += (Number(st.owner_profit_usd || st.owner_revenue_usd) || 0);
      } else if (yesterdaySet.has(dStr)) {
        wnYesterdayCount += c;
      }
      if (dStr >= weekStartStr) wnWeekCount += c;
      if (dStr >= monthStartStr) wnMonthCount += c;
      if (dStr >= yearStartStr) wnYearCount += c;
    }
  }

  const todayCount = apiTodayCount + wnTodayCount;
  const yesterdayCount = apiYesterdayCount + wnYesterdayCount;
  const weekCount = apiWeekCount + wnWeekCount;
  const monthCount = apiMonthCount + wnMonthCount;
  const yearCount = apiYearCount + wnYearCount;

  const delivered = sms.filter(s => s.status === 'delivered');
  const totalAllSms = apiTotalSms + wnTotalSms;
  const deliveredAll = delivered.length + wnStats.reduce((sum, st) => sum + Math.max(0, Math.round(Number(st.sms_count) || 0)), 0);
  const success_rate = totalAllSms ? Math.round((deliveredAll / totalAllSms) * 1000) / 10 : 0;

  const trafficData = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.now() - i * 3600000);
    const hourKey = d.toISOString().slice(0, 13);
    trafficData.push(sms.filter(s => (s.timestamp || '').slice(0, 13) === hourKey).length);
  }

  const profitData = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dayKey = d.toISOString().slice(0, 10);
    const daySum = sms
      .filter(s => extractDateStr(s) === dayKey)
      .reduce((acc, s) => acc + (Number(s.profit || s.carrier_revenue) || 0), 0) +
      wnStats
        .filter(st => String(st.date_ymd || '').slice(0, 10) === dayKey)
        .reduce((acc, st) => acc + (Number(st.owner_profit_usd || st.owner_revenue_usd) || 0), 0);
    profitData.push(Math.round(daySum * 100) / 100);
  }

  const appCounts = {};
  sms.forEach(s => {
    const app = s.app || 'WhatsApp';
    appCounts[app] = (appCounts[app] || 0) + 1;
  });

  // Reconciled Number Counts (3-Tier: Owner -> Agent -> Client)
  const unallocated = numbers.filter(n => !n.agent_id && !n.client_id);
  const allocated = numbers.filter(n => n.agent_id || n.client_id);
  const allocated_to_agents = numbers.filter(n => n.agent_id && !n.client_id);
  const allocated_to_clients = numbers.filter(n => n.client_id);

  res.json({
    total_numbers: numbers.length,
    active_numbers: numbers.filter(n => n.status === 'active').length,
    unallocated_numbers: unallocated.length,
    unallocated: unallocated.length,
    allocated_numbers: allocated.length,
    allocated: allocated.length,
    allocated_to_agents: allocated_to_agents.length,
    allocated_to_clients: allocated_to_clients.length,
    total_sms: totalAllSms,
    sms_today: todayCount,
    total_sms_today: todayCount,
    today_sms: todayCount,
    api_today_sms: apiTodayCount,
    api_yesterday_sms: apiYesterdayCount,
    api_week_sms: apiWeekCount,
    api_month_sms: apiMonthCount,
    api_total_sms: apiTotalSms,
    whitenoise_today_sms: wnTodayCount,
    whitenoise_yesterday_sms: wnYesterdayCount,
    whitenoise_week_sms: wnWeekCount,
    whitenoise_month_sms: wnMonthCount,
    whitenoise_total_sms: wnTotalSms,
    yesterday_sms: yesterdayCount,
    yesterday: yesterdayCount,
    this_week: weekCount,
    this_week_sms: weekCount,
    this_month: monthCount,
    this_month_sms: monthCount,
    this_year: yearCount,
    this_year_sms: yearCount,
    revenue_today: Math.round(revenueToday * 100) / 100,
    delivered_sms: deliveredAll,
    success_rate: success_rate,
    total_users: users.length,
    traffic_24h: trafficData,
    profit_30d: profitData,
    app_distribution: appCounts,
    pending_requests: reg_req.filter(x => x.status === 'pending').length + pay_req.filter(x => x.status === 'pending').length,
    blocked_ips_count: blocked.length
  });
});

// ── Daily Stats Endpoint (/api/sms/daily-stats) ───────────────
app.get('/api/sms/daily-stats', (req, res) => {
  const sms = getScopedSmsList(req);
  const { todaySet, yesterdaySet, weekStartStr, monthStartStr, yearStartStr } = getDateRangeBuckets();

  let todayCount = 0;
  let yesterdayCount = 0;
  let weekCount = 0;
  let monthCount = 0;
  let yearCount = 0;

  for (const s of sms) {
    const dStr = extractDateStr(s);
    if (!dStr) continue;
    if (todaySet.has(dStr)) todayCount++;
    else if (yesterdaySet.has(dStr)) yesterdayCount++;

    if (dStr >= weekStartStr) weekCount++;
    if (dStr >= monthStartStr) monthCount++;
    if (dStr >= yearStartStr) yearCount++;
  }

  const weeklyTraffic = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const count = sms.filter(s => extractDateStr(s) === dateStr).length;
    weeklyTraffic.push(count);
  }

  res.json({
    today: todayCount,
    yesterday: yesterdayCount,
    this_week: weekCount,
    this_month: monthCount,
    this_year: yearCount,
    year: yearCount,
    all_time: sms.length,
    weekly_traffic: weeklyTraffic
  });
});

// ── Period Stats Endpoint (/api/sms/period-stats) ─────────────
app.get('/api/sms/period-stats', (req, res) => {
  const now = new Date();
  const nowUtc = now.getTime();

  const sessionUser = req.sessionUser || getSessionUser(req) || {};
  const sRole = (sessionUser.role || '').toLowerCase();
  const userId = sessionUser.id != null ? String(sessionUser.id) : '0';
  const qAgt = req.query.agent_id || '';
  const qCli = req.query.client_id || '';
  const cacheKey = `${userId}:${sRole}:${qAgt}:${qCli}`;

  const nowMs = Date.now();
  const cached = periodStatsCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs && req.query.fresh !== '1') {
    return res.json(cached.data);
  }

  // 1. Today & Yesterday: calendar day in UTC + local
  const todayStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const todayStartMs = todayStartUtc.getTime();
  const todayDateStr = todayStartUtc.toISOString().slice(0, 10);
  const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todaySet = new Set([todayDateStr, localTodayStr]);

  const yestUtcStr = new Date(todayStartMs - 86400000).toISOString().slice(0, 10);
  const yestLocalObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestLocalStr = `${yestLocalObj.getFullYear()}-${String(yestLocalObj.getMonth() + 1).padStart(2, '0')}-${String(yestLocalObj.getDate()).padStart(2, '0')}`;
  const yesterdaySet = new Set([yestUtcStr, yestLocalStr]);
  yesterdaySet.delete(todayDateStr);
  yesterdaySet.delete(localTodayStr);

  // 2. Weekly SMS: calendar week Monday 00:00 UTC to now
  const dayOffset = (now.getUTCDay() + 6) % 7;
  const mondayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset, 0, 0, 0, 0));
  const weekStartMs = mondayUtc.getTime();
  const weekStartStr = mondayUtc.toISOString().slice(0, 10);

  // Rolling 7d / 30d bounds
  const last7StartMs = todayStartMs - 6 * 86400000;
  const last7StartStr = new Date(last7StartMs).toISOString().slice(0, 10);
  const last30StartMs = todayStartMs - 29 * 86400000;
  const last30StartStr = new Date(last30StartMs).toISOString().slice(0, 10);

  const weeklyBuckets = [];
  const weeklyLabels = [];
  const weeklyBucketIndex = {};
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(todayStartMs - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    weeklyBucketIndex[key] = weeklyBuckets.length;
    weeklyBuckets.push(0);
    weeklyLabels.push(`${DAY_NAMES[dt.getUTCDay()]} ${dt.getUTCDate()}`);
  }

  // 3. Monthly SMS: calendar month
  const monthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthStartMs = monthStartUtc.getTime();
  const monthStartStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

  // 4. Yearly SMS: calendar year (reads archives for the current year)
  const yearStartUtc = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  const yearStartMs = yearStartUtc.getTime();
  const yearStartStr = `${now.getUTCFullYear()}-01-01`;

  const smsList = getScopedSmsList(req, yearStartStr);
  const wnVirtualList = getScopedWhitenoiseStatsAsVirtualSms(sessionUser, {
    agent_id: qAgt || undefined,
    client_id: qCli || undefined
  });

  let apiTodayCount = 0;
  let apiYesterdayCount = 0;
  let apiWeekCount = 0;
  let apiLast7Count = 0;
  let apiLast30Count = 0;
  let apiMonthCount = 0;
  let apiYearCount = 0;

  let wnTodayCount = 0;
  let wnYesterdayCount = 0;
  let wnWeekCount = 0;
  let wnLast7Count = 0;
  let wnLast30Count = 0;
  let wnMonthCount = 0;
  let wnYearCount = 0;

  let earningsSum = 0;
  let profitTodaySum = 0;
  let profitWeekSum = 0;
  const topAccessMap = new Map();

  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgent = sRole === 'agent';
  const isClient = sRole === 'client';

  const getRoleAmount = (rec) => {
    if (isOwner) {
      return Number(rec.owner_amount != null ? rec.owner_amount : (rec.profit != null ? rec.profit : (rec.carrier_revenue != null ? rec.carrier_revenue : 0))) || 0;
    }
    if (isAgent) {
      return Number(rec.agent_amount != null ? rec.agent_amount : (rec.payout != null ? rec.payout : 0)) || 0;
    }
    if (isClient) {
      return Number(rec.client_amount != null ? rec.client_amount : (rec.client_payout != null ? rec.client_payout : (rec.payout != null ? rec.payout : 0))) || 0;
    }
    return Number(rec.payout || rec.profit || 0) || 0;
  };

  const combinedList = [...smsList, ...wnVirtualList];

  for (const s of combinedList) {
    if (!s) continue;
    const isWnRow = Boolean(
      s.is_whitenoise ||
      String(s.source || '').toLowerCase() === 'whitenoise' ||
      String(s.provider || '').toLowerCase().includes('whitenoise') ||
      String(s.payout_schedule || '').toLowerCase() === 'monthly30_5'
    );
    const weight = (s.sms_count != null && Number(s.sms_count) > 0) ? Math.round(Number(s.sms_count)) : 1;
    const dStr = extractDateStr(s);
    let sMs = null;
    const raw = s.timestamp || s.date || '';
    if (raw) {
      if (typeof raw === 'number') {
        sMs = raw < 1e11 ? raw * 1000 : raw;
      } else if (/^\d{10,13}$/.test(raw)) {
        const n = Number(raw);
        sMs = n < 1e11 ? n * 1000 : n;
      } else {
        const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + (raw.length <= 19 ? 'Z' : '');
        const p = Date.parse(iso);
        if (!isNaN(p)) sMs = p;
        else {
          const d = new Date(raw);
          if (!isNaN(d.getTime())) sMs = d.getTime();
        }
      }
    }

    const isToday = (dStr && todaySet.has(dStr)) || (sMs !== null && sMs >= todayStartMs && sMs <= nowUtc + 86400000);
    const isYesterday = !isToday && ((dStr && yesterdaySet.has(dStr)) || (sMs !== null && sMs >= todayStartMs - 86400000 && sMs < todayStartMs));
    const isWeek = (sMs !== null) ? (sMs >= weekStartMs && sMs <= nowUtc + 86400000) : (dStr && dStr >= weekStartStr);
    const isLast7 = (sMs !== null) ? (sMs >= last7StartMs && sMs <= nowUtc + 86400000) : (dStr && dStr >= last7StartStr);
    const isLast30 = (sMs !== null) ? (sMs >= last30StartMs && sMs <= nowUtc + 86400000) : (dStr && dStr >= last30StartStr);
    const isMonth = (sMs !== null) ? (sMs >= monthStartMs && sMs <= nowUtc + 86400000) : (dStr && dStr >= monthStartStr);
    const isYear = (sMs !== null) ? (sMs >= yearStartMs && sMs <= nowUtc + 86400000) : (dStr && dStr >= yearStartStr);

    const amt = getRoleAmount(s);

    if (isToday) {
      if (isWnRow) wnTodayCount += weight;
      else apiTodayCount += weight;
      profitTodaySum += amt;
      if (!isWnRow) {
        let rawCli = String(s.cli || s.app || s.sender || '—').trim() || '—';
        if (isClient && rawCli !== '—') {
          rawCli = rawCli.slice(0, 1) + 'XXXXX';
        }
        const rangeLabel = String(s.range || s.range_name || s.country || '—').trim() || '—';
        const accessKey = `${rawCli}|||${rangeLabel}`;
        topAccessMap.set(accessKey, (topAccessMap.get(accessKey) || 0) + weight);
      }
    }
    if (isYesterday) {
      if (isWnRow) wnYesterdayCount += weight;
      else apiYesterdayCount += weight;
    }
    if (isWeek) {
      if (isWnRow) wnWeekCount += weight;
      else apiWeekCount += weight;
      profitWeekSum += amt;
    }
    if (isLast7) {
      if (isWnRow) wnLast7Count += weight;
      else apiLast7Count += weight;
    }
    if (isLast30) {
      if (isWnRow) wnLast30Count += weight;
      else apiLast30Count += weight;
    }
    if (isMonth) {
      if (isWnRow) wnMonthCount += weight;
      else apiMonthCount += weight;
    }
    if (isYear) {
      if (isWnRow) wnYearCount += weight;
      else apiYearCount += weight;
      earningsSum += amt;
    }

    if (dStr && weeklyBucketIndex[dStr] !== undefined) {
      weeklyBuckets[weeklyBucketIndex[dStr]] += weight;
    } else if (sMs !== null && sMs >= last7StartMs && sMs <= nowUtc + 86400000) {
      const k = new Date(sMs).toISOString().slice(0, 10);
      if (weeklyBucketIndex[k] !== undefined) weeklyBuckets[weeklyBucketIndex[k]] += weight;
    }
  }

  const todayCount = apiTodayCount + wnTodayCount;
  const yesterdayCount = apiYesterdayCount + wnYesterdayCount;
  const weekCount = apiWeekCount + wnWeekCount;
  const last7Count = apiLast7Count + wnLast7Count;
  const last30Count = apiLast30Count + wnLast30Count;
  const monthCount = apiMonthCount + wnMonthCount;
  const yearCount = apiYearCount + wnYearCount;

  const topAccessToday = Array.from(topAccessMap.entries())
    .map(([k, total]) => {
      const [cli, range] = k.split('|||');
      return { cli, range, total };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const fxRate = getUsdToPkrRate();
  let earningsPkrSum = 0;
  let profitTodayPkrSum = 0;
  let profitWeekPkrSum = 0;
  for (const s of combinedList) {
    if (!s) continue;
    const dStr2 = extractDateStr(s);
    const pkrAmt = isClient
      ? (s.client_amount_pkr != null ? Number(s.client_amount_pkr) : (getRoleAmount(s) * (Number(s.fx_usd_to_pkr) || fxRate)))
      : (getRoleAmount(s) * (Number(s.fx_usd_to_pkr) || fxRate));
    if (dStr2 && todaySet.has(dStr2)) profitTodayPkrSum += pkrAmt;
    if (dStr2 && dStr2 >= weekStartStr) profitWeekPkrSum += pkrAmt;
    if (dStr2 && dStr2 >= yearStartStr) earningsPkrSum += pkrAmt;
  }

  const agentTargetInfo = isAgent ? getAgentClientWeeklyPkrStats(sessionUser.id) : null;

  const result = {
    today: todayCount,
    yesterday: yesterdayCount,
    week: weekCount,
    last_7_days: last7Count,
    last_30_days: last30Count,
    month: monthCount,
    year: yearCount,
    api_today: apiTodayCount,
    api_yesterday: apiYesterdayCount,
    api_week: apiWeekCount,
    api_last_7_days: apiLast7Count,
    api_last_30_days: apiLast30Count,
    api_month: apiMonthCount,
    api_year: apiYearCount,
    whitenoise_today: wnTodayCount,
    whitenoise_yesterday: wnYesterdayCount,
    whitenoise_week: wnWeekCount,
    whitenoise_last_7_days: wnLast7Count,
    whitenoise_last_30_days: wnLast30Count,
    whitenoise_month: wnMonthCount,
    whitenoise_year: wnYearCount,
    total_today_sms: todayCount,
    earnings: Math.round(earningsSum * 10000) / 10000,
    profit_today: Math.round(profitTodaySum * 10000) / 10000,
    profit_week: Math.round(profitWeekSum * 10000) / 10000,
    usd_to_pkr_rate: fxRate,
    earnings_pkr: round2(earningsPkrSum),
    profit_today_pkr: round2(profitTodayPkrSum),
    profit_week_pkr: round2(profitWeekPkrSum),
    ...(agentTargetInfo ? agentTargetInfo : {}),
    today_sms: todayCount,
    yesterday_sms: yesterdayCount,
    weekly_sms: weekCount,
    monthly_sms: monthCount,
    yearly_sms: yearCount,
    weekly_traffic: weeklyBuckets,
    weekly_labels: weeklyLabels,
    top_access_today: topAccessToday
  };

  periodStatsCache.set(cacheKey, { expiresAt: nowMs + 30000, data: result });
  res.json(result);
});

// ── Providers List Endpoint (/api/providers) ──────────────────
app.get('/api/providers', requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  try {
    const ranges = readDb('sms_ranges') || [];
    const numbers = readDb('numbers') || [];
    const crConns = readDb('cr_api_connections') || [];
    const wnConns = readDb('whitenoise_connections') || [];
    const loginPanels = readDb('login_panels') || [];
    const provSet = new Set();

    // Dynamically add providers from connected CR API panels (panel_name is the provider)
    crConns.forEach(c => {
      const name = (c.panel_name || '').trim();
      if (name && name !== 'CR API Panel' && name !== 'Manual' && name !== '—') {
        provSet.add(name);
      } else if (name) {
        provSet.add(name);
      }
    });

    // Dynamically add providers from Web Scraping Login Panels
    loginPanels.forEach(lp => {
      const name = (lp.panel_name || lp.name || '').trim();
      if (name && name !== 'Manual' && name !== '—') provSet.add(name);
    });

    // Dynamically add providers from Whitenoise connections
    wnConns.forEach(w => {
      const name = (w.provider_tag || w.name || 'Whitenoise').trim();
      if (name) provSet.add(name);
    });

    // Dynamically add providers from active SMS ranges
    ranges.forEach(r => {
      const p = (r.provider || '').trim();
      if (p && p !== 'Manual' && p !== '—') provSet.add(p);
    });

    // Dynamically add providers from existing numbers
    numbers.forEach(n => {
      const p = (n.provider || '').trim();
      if (p && p !== 'Manual' && p !== '—') provSet.add(p);
    });

    const list = Array.from(provSet).sort().map((name, idx) => ({ id: idx + 1, name, provider_name: name }));
    res.json({ data: list, total: list.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Payout Rates Endpoint (/api/payout-rates) ─────────────────
app.get('/api/payout-rates', requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  let data = readDb('payout_rates');
  if (!data || Array.isArray(data) || !data.service_rates) {
    data = {
      owner_to_agent: { default_rate: 0.05, description: 'Owner pays agent per OTP delivered', currency: 'USD' },
      agent_to_client: { default_rate: 0.03, description: 'Agent pays client per OTP delivered', currency: 'USD' },
      service_rates: {
        WhatsApp: { owner_to_agent: 0.05, agent_to_client: 0.03 },
        Telegram: { owner_to_agent: 0.04, agent_to_client: 0.025 },
        Google: { owner_to_agent: 0.06, agent_to_client: 0.035 },
        Facebook: { owner_to_agent: 0.045, agent_to_client: 0.028 },
        Amazon: { owner_to_agent: 0.055, agent_to_client: 0.032 },
        Aadhaar: { owner_to_agent: 0.08, agent_to_client: 0.05 },
        TikTok: { owner_to_agent: 0.04, agent_to_client: 0.025 }
      }
    };
    writeDb('payout_rates', data);
  }
  res.json(data);
});

app.post('/api/payout-rates', requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  const current = readDb('payout_rates') || {};
  const payload = req.body || {};
  for (const [key, val] of Object.entries(payload)) {
    if (key === 'service_rates' && typeof val === 'object' && val !== null) {
      current.service_rates = current.service_rates || {};
      Object.assign(current.service_rates, val);
    } else {
      current[key] = val;
    }
  }
  writeDb('payout_rates', current);
  res.json({ success: true, data: current });
});

// ── DIRECT ARRAY ENDPOINTS ────────────────────────────────────

// 1. SMS Ranges (Must return Array directly)
app.get('/api/numbers/sms-ranges', (req, res) => {
  const _viewer = req.sessionUser;
  const role = _viewer && _viewer.role ? String(_viewer.role).toLowerCase() : '';

  const allRanges = readDb('sms_ranges') || [];
  const numbers = readDb('numbers') || [];
  const allRequests = readDb('number_requests') || [];
  const allHistory = readDb('allocation_history') || [];
  const isOwner = role === 'owner' || role === 'admin';
  const isAgent = role === 'agent';
  const isClient = role === 'client';
  const wnAllowed = isOwner || hasWhitenoiseAccess(_viewer);
  const wnTags = getWhitenoiseProviderTags();
  const ranges = wnAllowed ? allRanges : allRanges.filter(r => !isWhitenoiseRecord(r, null, wnTags));
  const publishedOnly = req.query.published_only === '1' || req.query.published_only === 'true' || req.query.scope === 'client_rate_card';

  if (isClient && publishedOnly) {
    const clients = readDb('clients') || [];
    const clRec = clients.find(c => Number(c.id) === Number(_viewer.id)) || _viewer;
    const myAgentId = clRec.agent_id || _viewer.agent_id || null;
    const fx = getUsdToPkrRate();
    const acrList = myAgentId ? getAgentClientRates(myAgentId) : [];

    const out = [];
    for (const r of ranges) {
      const rangeName = r.range_name || r.name || r.country || 'Range';
      const acr = acrList.find(x => Number(x.range_id) === Number(r.id)) ||
                  acrList.find(x => String(x.range_name || '').trim().toLowerCase() === rangeName.trim().toLowerCase());
      if (!acr || acr.published === false || !(Number(acr.client_rate_pkr) > 0)) continue;

      const isWnRng = isWhitenoiseRecord(r, null, wnTags);
      const ptInfo = resolveRangeActivePayterms(r, isWnRng);
      const quota = getClientRangeQuota(_viewer.id, r.id, rangeName, { numbers, requests: allRequests, history: allHistory });
      const allowedQty = normalizeAllowedQuantities(acr.allowed_quantities).filter(q => q <= CLIENT_RANGE_DAILY_NUMBERS_MAX);
      const effAllowedQty = allowedQty.length ? allowedQty : [CLIENT_RANGE_DAILY_NUMBERS_MAX];
      const rangeNums = numbers.filter(n => n && matchesRangeRef(n, r.id, rangeName));
      const poolAvailable = rangeNums.filter(n =>
        myAgentId ? (Number(n.agent_id) === Number(myAgentId) && !n.client_id) : (!n.agent_id && !n.client_id)
      ).length;

      const visRangeName = scrubWhitenoiseName(rangeName, isOwner);
      out.push({
        id: r.id,
        range_name: visRangeName,
        name: visRangeName,
        country: r.country || '',
        prefix: r.prefix || '',
        provider: maskProviderLabel(r.provider || '', isOwner, wnTags),
        is_whitenoise: isWnRng,
        payterm: ptInfo.primary_payterm,
        active_payterms: ptInfo.active_payterms,
        currency: 'PKR',
        rate: round2(acr.client_rate_pkr),
        payout: round2(acr.client_rate_pkr),
        client_rate_pkr: round2(acr.client_rate_pkr),
        usd_to_pkr_rate: fx,
        allowed_quantities: effAllowedQty,
        daily_request_limit: 1,
        ...quota,
        requests_today: quota.today_numbers,
        requested_today: !quota.can_request_now,
        can_request_today: quota.can_request_now,
        available: poolAvailable,
        free_count: poolAvailable,
        unassigned_count: poolAvailable,
        agent_free_count: poolAvailable,
        total_count: rangeNums.length,
        numbers_count: rangeNums.length
      });
    }
    return res.json(out);
  }

  const enriched = ranges.map(r => {
    const rangeName = r.range_name || r.name || r.country || 'Range';
    const visRangeName = scrubWhitenoiseName(rangeName, isOwner);
    const isWnRng = isWhitenoiseRecord(r, null, wnTags);
    const ptInfo = resolveRangeActivePayterms(r, isWnRng);
    const agentRate = getRangeAgentRate(r, ptInfo.primary_payterm) || Number(r.rate || r.payout || 0.01);

    const rangeNums = numbers.filter(n => n && matchesRangeRef(n, r.id, rangeName));
    const totalCount = rangeNums.length;
    const ownerFreeCount = rangeNums.filter(n => !n.agent_id && !n.client_id).length;
    const heldCount = totalCount - ownerFreeCount;

    const base = {
      ...r,
      range_name: visRangeName,
      name: visRangeName,
      provider: maskProviderLabel(r.provider || '', isOwner, wnTags),
      is_whitenoise: isWnRng,
      payterm: ptInfo.primary_payterm,
      active_payterms: ptInfo.active_payterms,
      payterms: ptInfo.payterms,
      unassigned_count: ownerFreeCount,
      free_count: ownerFreeCount,
      owner_free_count: ownerFreeCount,
      available: ownerFreeCount,
      held_count: heldCount,
      total_count: totalCount,
      numbers_count: totalCount
    };

    if (isOwner) {
      return base;
    } else {
      // Agent sees Owner's real free pool + Agent's own held/free breakdown & pending status
      // (never leaks owner buy_rate or internal margins)
      const { cost, buy_rate, carrier_rate, company_rate, company_cost, ...rest } = base;
      let agentExtras = {};
      if (isAgent && _viewer && _viewer.id != null) {
        const aid = Number(_viewer.id);
        const agentFreeCount = rangeNums.filter(n => Number(n.agent_id) === aid && !n.client_id).length;
        const agentClientHeldCount = rangeNums.filter(n => Number(n.agent_id) === aid && Boolean(n.client_id)).length;
        const agentTotalHeld = agentFreeCount + agentClientHeldCount;
        const agPendingReqs = allRequests.filter(reqItem =>
          reqItem &&
          String(reqItem.requester_role || '').toLowerCase() === 'agent' &&
          Number(reqItem.agent_id || reqItem.requester_id) === aid &&
          String(reqItem.status || '').toLowerCase() === 'pending' &&
          matchesRangeRef(reqItem, r.id, rangeName)
        );
        agentExtras = {
          available: ownerFreeCount,
          owner_free_count: ownerFreeCount,
          free_count: ownerFreeCount,
          agent_free_count: agentFreeCount,
          agent_client_held_count: agentClientHeldCount,
          agent_held_count: agentTotalHeld,
          held_count: agentTotalHeld,
          pending_request_count: agPendingReqs.length,
          has_pending_request: agPendingReqs.length > 0,
          pending_qty: agPendingReqs.reduce((sum, x) => sum + (parseInt(x.quantity, 10) || 0), 0)
        };
      }
      return {
        ...rest,
        ...agentExtras,
        rate: agentRate,
        agent_rate: agentRate,
        currency: r.currency || 'USD'
      };
    }
  });

  res.json(enriched);
});

app.get('/api/rates/agent-card', requireAuth, (req, res) => {
  const _viewer = req.sessionUser;
  const _isOwner = normRole(_viewer?.role) === 'owner';
  const wnAllowed = _isOwner || hasWhitenoiseAccess(_viewer);
  const wnTags = getWhitenoiseProviderTags();
  const allRanges = readDb('sms_ranges') || [];
  const ranges = wnAllowed ? allRanges : allRanges.filter(r => !isWhitenoiseRecord(r, null, wnTags));

  const card = ranges.map(r => {
    const isWnRng = isWhitenoiseRecord(r, null, wnTags);
    const ptInfo = resolveRangeActivePayterms(r, isWnRng);
    const weeklyRate = ptInfo.payterms['Weekly'] !== undefined ? Number(ptInfo.payterms['Weekly']) : null;
    const monthlyRate = ptInfo.payterms['Monthly'] !== undefined ? Number(ptInfo.payterms['Monthly']) : null;
    const primaryRate = Number(ptInfo.payterms[ptInfo.primary_payterm] ?? r.payout ?? r.rate ?? 0);

    return {
      id: r.id,
      range_name: r.range_name || r.name || r.country || 'Range',
      country: r.country,
      prefix: r.prefix,
      provider: maskProviderLabel(r.provider || '', _isOwner, wnTags),
      is_whitenoise: isWnRng,
      agent_rate: primaryRate,
      weekly_rate: weeklyRate,
      monthly_rate: monthlyRate,
      weekly_term: 'Weekly (7/3)',
      monthly_term: 'Monthly (30/5) {W}',
      active_payterms: ptInfo.active_payterms,
      payterms: ptInfo.payterms,
      currency: r.currency || 'USD',
      payterm: ptInfo.primary_payterm
    };
  });
  res.json({ success: true, ranges: card });
});

// ── Isolated Per-Agent Client Rate Set & PKR Rate Card ──────────
app.get('/api/agent/client-rates', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  if (normRole(sessionUser.role) !== 'agent') {
    return res.status(403).json({ error: 'Forbidden. Agent account required.' });
  }
  const agentId = Number(sessionUser.id);
  const wnAllowed = hasWhitenoiseAccess(sessionUser);
  const wnTags = getWhitenoiseProviderTags();
  const allRanges = readDb('sms_ranges') || [];
  const ranges = wnAllowed ? allRanges : allRanges.filter(r => !isWhitenoiseRecord(r, null, wnTags));
  const numbers = readDb('numbers') || [];
  const acrList = getAgentClientRates(agentId);
  const fx = getUsdToPkrRate();
  const weeklyStats = getAgentClientWeeklyPkrStats(agentId);

  const items = ranges.map(r => {
    const rangeName = r.range_name || r.name || r.country || 'Range';
    const isWnRng = isWhitenoiseRecord(r, null, wnTags);
    const ptInfo = resolveRangeActivePayterms(r, isWnRng);
    const effPayterm = ptInfo.primary_payterm;
    const agentRateUsd = getRangeAgentRate(r, effPayterm);
    const agentRatePkr = round2(agentRateUsd * fx);
    const acr = acrList.find(x => Number(x.range_id) === Number(r.id)) ||
                acrList.find(x => String(x.range_name || '').trim().toLowerCase() === rangeName.trim().toLowerCase());
    const clientRatePkr = (acr && Number(acr.client_rate_pkr) > 0) ? round2(acr.client_rate_pkr) : null;
    const isConfigured = Boolean(acr && acr.published !== false && clientRatePkr !== null && clientRatePkr > 0);
    const marginPkr = (clientRatePkr !== null && agentRatePkr > 0) ? round2(agentRatePkr - clientRatePkr) : null;
    const poolAvailable = numbers.filter(n =>
      (n.range_id ? Number(n.range_id) === Number(r.id) : (n.range_name === rangeName)) &&
      Number(n.agent_id) === agentId && !n.client_id
    ).length;

    return {
      range_id: r.id,
      range_name: rangeName,
      country: r.country || '',
      prefix: r.prefix || '',
      provider: r.provider || '',
      is_whitenoise: isWnRng,
      active: r.active !== false,
      payterm: effPayterm,
      active_payterms: ptInfo.active_payterms,
      payterms: ptInfo.payterms,
      max_sms_day: r.max_sms_day ?? r.otp_limit ?? null,
      memo: r.memo || '',
      cli_list: r.cli_list || (Array.isArray(r.clis) && r.clis.length ? r.clis.join(', ') : (r.cli || 'All CLIs')),
      agent_rate_usd: agentRateUsd,
      agent_rate_pkr: agentRatePkr,
      has_agent_rate: agentRateUsd > 0,
      client_rate_pkr: clientRatePkr,
      client_rate_usd_eq: clientRatePkr !== null ? round6(clientRatePkr / fx) : null,
      margin_pkr: marginPkr,
      published: acr ? acr.published !== false : false,
      configured: isConfigured,
      allowed_quantities: acr ? normalizeAllowedQuantities(acr.allowed_quantities) : [25],
      daily_request_limit: acr ? Math.max(1, parseInt(acr.daily_request_limit, 10) || 1) : 1,
      pool_available: poolAvailable,
      updated_at: acr ? (acr.updated_at || acr.created || '') : ''
    };
  });

  // Pending / unconfigured ranges appear at the TOP for quick Agent setup
  items.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? 1 : -1;
    return Number(b.range_id) - Number(a.range_id);
  });

  const pendingCount = items.filter(i => !i.configured).length;
  res.json({
    success: true,
    agent_id: agentId,
    usd_to_pkr_rate: fx,
    pending_count: pendingCount,
    configured_count: items.length - pendingCount,
    weekly_target: weeklyStats,
    ranges: items
  });
});

function handleSaveAgentClientRates(req, res) {
  const sessionUser = req.sessionUser;
  if (normRole(sessionUser.role) !== 'agent') {
    return res.status(403).json({ error: 'Forbidden. Only Agents can set their Client PKR rates.' });
  }
  const agentId = Number(sessionUser.id);
  const fx = getUsdToPkrRate();
  const ranges = readDb('sms_ranges') || [];
  let allRates = getAllAgentClientRates();

  const rawItems = Array.isArray(req.body?.items)
    ? req.body.items
    : [{ ...req.body, range_id: req.params.rangeId ? Number(req.params.rangeId) : req.body?.range_id }];

  if (!rawItems.length) {
    return res.status(400).json({ error: 'At least one range rate item is required.' });
  }

  const nowIso = new Date().toISOString();
  const savedItems = [];

  for (const raw of rawItems) {
    const reqRangeId = raw.range_id != null ? Number(raw.range_id) : null;
    const reqRangeName = String(raw.range_name || '').trim().toLowerCase();
    const rng = ranges.find(r => (reqRangeId && Number(r.id) === reqRangeId)) ||
                ranges.find(r => reqRangeName && String(r.range_name || r.name || '').trim().toLowerCase() === reqRangeName);
    if (!rng) {
      return res.status(404).json({ error: `Range not found (range_id: ${raw.range_id || 'N/A'})` });
    }

    const clientRatePkr = round2(raw.client_rate_pkr);
    if (!Number.isFinite(clientRatePkr) || clientRatePkr <= 0) {
      return res.status(400).json({ error: `Valid positive PKR rate is required for "${rng.range_name || rng.name}".` });
    }

    const wnTags = getWhitenoiseProviderTags();
    const isWnRng = isWhitenoiseRecord(rng, null, wnTags);
    const ptInfo = resolveRangeActivePayterms(rng, isWnRng);
    const agentRateUsd = getRangeAgentRate(rng, ptInfo.primary_payterm);
    const agentRatePkr = round2(agentRateUsd * fx);
    if (agentRateUsd > 0 && clientRatePkr >= agentRatePkr) {
      return res.status(400).json({
        error: `Client PKR rate (${clientRatePkr} PKR) for "${rng.range_name || rng.name}" must be strictly less than your Agent payout (${agentRatePkr} PKR = $${agentRateUsd} USD @ ${fx} PKR/$).`
      });
    }

    const allowedQty = normalizeAllowedQuantities(raw.allowed_quantities);
    const dailyLimit = Math.max(1, parseInt(raw.daily_request_limit, 10) || 1);
    const published = raw.published !== false;
    const rName = rng.range_name || rng.name || rng.country || 'Range';

    const existingIdx = allRates.findIndex(x => x && Number(x.agent_id) === agentId && Number(x.range_id) === Number(rng.id));
    const rec = {
      id: existingIdx !== -1 ? allRates[existingIdx].id : nextId(allRates, 'agent_client_rates'),
      agent_id: agentId,
      agent_username: sessionUser.username,
      range_id: Number(rng.id),
      range_name: rName,
      client_rate_pkr: clientRatePkr,
      client_rate_usd_eq: round6(clientRatePkr / fx),
      allowed_quantities: allowedQty,
      daily_request_limit: dailyLimit,
      published,
      fx_usd_to_pkr_at_save: fx,
      updated_at: nowIso,
      created: existingIdx !== -1 ? (allRates[existingIdx].created || nowIso) : nowIso
    };
    if (existingIdx !== -1) {
      allRates[existingIdx] = rec;
    } else {
      allRates.unshift(rec);
    }
    savedItems.push(rec);
  }

  writeDb('agent_client_rates', allRates);
  logAudit(sessionUser.username, 'Agent Client Rate Set', `Updated ${savedItems.length} PKR client rate(s)`, 'Rates');
  res.json({
    success: true,
    usd_to_pkr_rate: fx,
    saved_count: savedItems.length,
    item: savedItems[0],
    items: savedItems
  });
}

app.put('/api/agent/client-rates', requireAuth, handleSaveAgentClientRates);
app.post('/api/agent/client-rates', requireAuth, handleSaveAgentClientRates);
app.put('/api/agent/client-rates/:rangeId', requireAuth, handleSaveAgentClientRates);

app.delete('/api/agent/client-rates/:rangeId', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  if (normRole(sessionUser.role) !== 'agent') {
    return res.status(403).json({ error: 'Forbidden. Agent account required.' });
  }
  const agentId = Number(sessionUser.id);
  const rangeId = Number(req.params.rangeId);
  let allRates = getAllAgentClientRates();
  const before = allRates.length;
  allRates = allRates.filter(x => !(x && Number(x.agent_id) === agentId && Number(x.range_id) === rangeId));
  if (allRates.length !== before) {
    writeDb('agent_client_rates', allRates);
  }
  res.json({ success: true, removed: before - allRates.length });
});

app.put('/api/agent/pkr-target', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  if (normRole(sessionUser.role) !== 'agent') {
    return res.status(403).json({ error: 'Forbidden. Agent account required.' });
  }
  const target = Number(req.body?.weekly_pkr_target);
  if (!Number.isFinite(target) || target < 0) {
    return res.status(400).json({ error: 'weekly_pkr_target must be 0 or a positive PKR amount.' });
  }
  const enforceMode = req.body?.weekly_pkr_enforce_mode === 'block' ? 'block' : 'warn';
  const agents = readDb('agents') || [];
  const idx = agents.findIndex(a => Number(a.id) === Number(sessionUser.id));
  if (idx === -1) return res.status(404).json({ error: 'Agent account not found.' });
  agents[idx].weekly_pkr_target = round2(target);
  agents[idx].weekly_pkr_enforce_mode = enforceMode;
  writeDb('agents', agents);
  res.json({ success: true, ...getAgentClientWeeklyPkrStats(sessionUser.id) });
});

app.get('/api/client/rate-card', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const role = normRole(sessionUser.role);
  if (role !== 'client' && role !== 'agent') {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  let targetAgentId = Number(sessionUser.id);
  if (role === 'client') {
    const clients = readDb('clients') || [];
    const cl = clients.find(c => Number(c.id) === Number(sessionUser.id)) || sessionUser;
    targetAgentId = Number(cl.agent_id || sessionUser.agent_id || 0);
  }

  const wnAllowed = hasWhitenoiseAccess(sessionUser);
  const wnTags = getWhitenoiseProviderTags();
  const allRanges = readDb('sms_ranges') || [];
  const ranges = wnAllowed ? allRanges : allRanges.filter(r => !isWhitenoiseRecord(r, null, wnTags));
  const numbers = readDb('numbers') || [];
  const allRequests = readDb('number_requests') || [];
  const allHistory = readDb('allocation_history') || [];
  const acrList = targetAgentId ? getAgentClientRates(targetAgentId) : [];
  const fx = getUsdToPkrRate();

  const card = [];
  for (const r of ranges) {
    const rangeName = r.range_name || r.name || r.country || 'Range';
    const isWnRng = isWhitenoiseRecord(r, null, wnTags);
    const ptInfo = resolveRangeActivePayterms(r, isWnRng);
    const acr = acrList.find(x => Number(x.range_id) === Number(r.id)) ||
                acrList.find(x => String(x.range_name || '').trim().toLowerCase() === rangeName.trim().toLowerCase());
    if (!acr || acr.published === false || !(Number(acr.client_rate_pkr) > 0)) continue;

    const rawAllowed = normalizeAllowedQuantities(acr.allowed_quantities).filter(q => q <= CLIENT_RANGE_DAILY_NUMBERS_MAX);
    const allowedQty = rawAllowed.length ? rawAllowed : [CLIENT_RANGE_DAILY_NUMBERS_MAX];
    const poolAvailable = numbers.filter(n =>
      n && matchesRangeRef(n, r.id, rangeName) &&
      (targetAgentId ? (Number(n.agent_id) === Number(targetAgentId) && !n.client_id) : (!n.agent_id && !n.client_id))
    ).length;

    const quota = role === 'client'
      ? getClientRangeQuota(sessionUser.id, r.id, rangeName, { numbers, requests: allRequests, history: allHistory })
      : {
          daily_numbers_limit: CLIENT_RANGE_DAILY_NUMBERS_MAX,
          today_numbers: 0,
          daily_remaining: CLIENT_RANGE_DAILY_NUMBERS_MAX,
          max_hold_limit: CLIENT_RANGE_ACTIVE_HOLD_MAX,
          held_count: 0,
          pending_qty: 0,
          pending_request_count: 0,
          has_pending_request: false,
          hold_remaining: CLIENT_RANGE_ACTIVE_HOLD_MAX,
          weekly_adds_limit: CLIENT_RANGE_WEEKLY_ADDS_MAX,
          weekly_adds_used: 0,
          weekly_adds_remaining: CLIENT_RANGE_WEEKLY_ADDS_MAX,
          next_weekly_slot_at: null,
          max_requestable_now: CLIENT_RANGE_DAILY_NUMBERS_MAX,
          can_request_now: true,
          block_reason: null
        };

    const baseClientPkr = round2(acr.client_rate_pkr);
    const agBaseUsd = getRangeAgentRate(r, ptInfo.primary_payterm);
    const paytermsPkr = {};
    for (const ptKey of ptInfo.active_payterms) {
      const rawUsd = ptInfo.payterms[ptKey] !== undefined ? Number(ptInfo.payterms[ptKey]) : null;
      if (rawUsd !== null && Number.isFinite(rawUsd) && rawUsd > 0 && agBaseUsd > 0) {
        paytermsPkr[ptKey] = round2(baseClientPkr * (rawUsd / agBaseUsd));
      } else {
        paytermsPkr[ptKey] = baseClientPkr;
      }
    }

    const visRangeName = scrubWhitenoiseName(rangeName, false);
    card.push({
      id: r.id,
      range_id: r.id,
      range_name: visRangeName,
      name: visRangeName,
      country: r.country || '',
      prefix: r.prefix || '',
      is_whitenoise: isWnRng,
      active: r.active !== false,
      payterm: ptInfo.primary_payterm,
      active_payterms: ptInfo.active_payterms,
      payterms_pkr: paytermsPkr,
      max_sms_day: r.max_sms_day ?? r.otp_limit ?? null,
      memo: r.memo || '',
      cli_list: r.cli_list || (Array.isArray(r.clis) && r.clis.length ? r.clis.join(', ') : (r.cli || 'All CLIs')),
      currency: 'PKR',
      rate: baseClientPkr,
      payout: baseClientPkr,
      client_rate_pkr: baseClientPkr,
      allowed_quantities: allowedQty,
      daily_request_limit: 1,
      ...quota,
      requests_today: quota.today_numbers,
      requested_today: !quota.can_request_now,
      can_request_today: quota.can_request_now,
      available: poolAvailable,
      free_count: poolAvailable,
      agent_free_count: poolAvailable
    });
  }

  res.json({
    success: true,
    currency: 'PKR',
    usd_to_pkr_rate: fx,
    payterm_schedules: PAYTERM_DEFINITIONS,
    per_range_limits: {
      daily_numbers_max: CLIENT_RANGE_DAILY_NUMBERS_MAX,
      active_hold_max: CLIENT_RANGE_ACTIVE_HOLD_MAX,
      weekly_adds_max: CLIENT_RANGE_WEEKLY_ADDS_MAX
    },
    ranges: card
  });
});

app.post('/api/numbers/sms-ranges', (req, res) => {
  if (req.body.payterms !== undefined) {
    if (typeof req.body.payterms !== 'object' || req.body.payterms === null || Array.isArray(req.body.payterms)) {
      return res.status(400).json({ error: 'payterms must be an object' });
    }
    const masterList = getMasterPayterms();
    const migrated = {};
    for (const [k, v] of Object.entries(req.body.payterms)) {
      const normK = normalizePaytermKey(k);
      if (!masterList.includes(normK)) {
        return res.status(400).json({ error: `Invalid payterm "${k}". Allowed payterms: ${masterList.join(', ')}` });
      }
      if (v !== '' && v !== null && v !== undefined && v !== 'NA' && v !== 'N/A' && !isNaN(Number(v))) {
        migrated[normK] = Number(v);
      }
    }
    req.body.payterms = migrated;
  }
  if (req.body.payterm !== undefined) {
    const norm = normalizePaytermKey(req.body.payterm);
    const masterList = getMasterPayterms();
    if (!masterList.includes(norm)) {
      return res.status(400).json({ error: `Invalid payterm "${req.body.payterm}". Allowed payterms: ${masterList.join(', ')}` });
    }
    req.body.payterm = norm;
  }
  const ranges = readDb('sms_ranges') || [];
  const rangeName = (req.body.range_name || req.body.name || req.body.country || 'Range').trim();
  const isWnRng = isWhitenoiseRecord({ ...req.body, range_name: rangeName });
  const ptInfo = resolveRangeActivePayterms({ ...req.body, range_name: rangeName }, isWnRng);
  const ptMeta = getPaytermMeta(ptInfo.primary_payterm);
  const inactivityDays = Math.max(0, Math.min(365, parseInt(req.body.inactivity_days, 10) || 0));
  const rawRangeStatus = String(req.body.range_status || req.body.status || '').trim().toLowerCase();
  const rangeStatus = rawRangeStatus === 'blocked' ? 'blocked' : (req.body.active === false ? 'blocked' : 'active');
  const entry = {
    id: nextId(ranges, 'sms_ranges'),
    ...req.body,
    range_name: rangeName,
    name: rangeName,
    payterm: ptMeta.key,
    active_payterms: ptInfo.active_payterms,
    payterms: ptInfo.payterms,
    payout_schedule: ptMeta.schedule,
    cycle_days: ptMeta.cycle_days,
    hold_days: ptMeta.hold_days,
    inactivity_days: inactivityDays,
    range_status: rangeStatus,
    status: rangeStatus,
    ...(isWnRng ? { is_whitenoise: true } : {}),
    active: rangeStatus !== 'blocked',
    created: new Date().toISOString()
  };
  ranges.unshift(entry);
  writeDb('sms_ranges', ranges);
  if (inactivityDays > 0 && typeof scanInactiveNumbers === 'function') {
    scanInactiveNumbers();
  }
  logAudit('Admin', 'Create SMS Range', `Created range "${entry.range_name}" (#${entry.id})`, 'Numbers');
  res.json(entry);
});

app.patch('/api/numbers/sms-ranges/:id', (req, res) => {
  if (req.body.payterms !== undefined) {
    if (typeof req.body.payterms !== 'object' || req.body.payterms === null || Array.isArray(req.body.payterms)) {
      return res.status(400).json({ error: 'payterms must be an object' });
    }
    const masterList = getMasterPayterms();
    const migrated = {};
    for (const [k, v] of Object.entries(req.body.payterms)) {
      const normK = normalizePaytermKey(k);
      if (!masterList.includes(normK)) {
        return res.status(400).json({ error: `Invalid payterm "${k}". Allowed payterms: ${masterList.join(', ')}` });
      }
      if (v !== '' && v !== null && v !== undefined && v !== 'NA' && v !== 'N/A' && !isNaN(Number(v))) {
        migrated[normK] = Number(v);
      }
    }
    req.body.payterms = migrated;
  }
  if (req.body.payterm !== undefined) {
    const norm = normalizePaytermKey(req.body.payterm);
    const masterList = getMasterPayterms();
    if (!masterList.includes(norm)) {
      return res.status(400).json({ error: `Invalid payterm "${req.body.payterm}". Allowed payterms: ${masterList.join(', ')}` });
    }
    req.body.payterm = norm;
  }
  const ranges = readDb('sms_ranges') || [];
  const id = Number(req.params.id);
  const idx = ranges.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Range not found' });
  const rangeName = (req.body.range_name || req.body.name || ranges[idx].range_name || ranges[idx].name || '').trim();
  const mergedForPt = { ...ranges[idx], ...req.body, range_name: rangeName };
  if (req.body.payterms !== undefined && req.body.active_payterms === undefined) {
    delete mergedForPt.active_payterms;
  }
  const isWnRng = isWhitenoiseRecord(mergedForPt);
  const ptInfo = resolveRangeActivePayterms(mergedForPt, isWnRng);
  const ptMeta = getPaytermMeta(ptInfo.primary_payterm);
  const nextInactivityDays = req.body.inactivity_days !== undefined
    ? Math.max(0, Math.min(365, parseInt(req.body.inactivity_days, 10) || 0))
    : Math.max(0, parseInt(ranges[idx].inactivity_days, 10) || 0);
  const rawSt = String(req.body.range_status !== undefined ? req.body.range_status : (req.body.status !== undefined ? req.body.status : '')).trim().toLowerCase();
  let nextRangeStatus = ranges[idx].range_status || (ranges[idx].active === false ? 'blocked' : 'active');
  if (rawSt === 'blocked' || rawSt === 'active') {
    nextRangeStatus = rawSt;
  } else if (req.body.active !== undefined) {
    nextRangeStatus = req.body.active === false ? 'blocked' : 'active';
  }
  ranges[idx] = {
    ...ranges[idx],
    ...req.body,
    range_name: rangeName || ranges[idx].country || 'Range',
    name: rangeName || ranges[idx].country || 'Range',
    payterm: ptMeta.key,
    active_payterms: ptInfo.active_payterms,
    payterms: ptInfo.payterms,
    payout_schedule: ptMeta.schedule,
    cycle_days: ptMeta.cycle_days,
    hold_days: ptMeta.hold_days,
    inactivity_days: nextInactivityDays,
    range_status: nextRangeStatus,
    status: nextRangeStatus,
    active: nextRangeStatus !== 'blocked',
    ...(isWnRng ? { is_whitenoise: true } : {})
  };
  writeDb('sms_ranges', ranges);

  // Synchronize range_name into numbers database if changed
  if (rangeName) {
    let numbers = readDb('numbers') || [];
    let changed = false;
    numbers.forEach(n => {
      if (n.range_id && Number(n.range_id) === id) {
        n.range_name = rangeName;
        changed = true;
      }
    });
    if (changed) writeDb('numbers', numbers);
  }

  if (typeof scanInactiveNumbers === 'function') {
    scanInactiveNumbers();
  }

  res.json(ranges[idx]);
});

app.delete('/api/numbers/sms-ranges/:id', (req, res) => {
  const ranges = readDb('sms_ranges') || [];
  const id = Number(req.params.id);
  const targetRange = ranges.find(r => r.id === id);
  const filtered = ranges.filter(r => r.id !== id);
  writeDb('sms_ranges', filtered);

  let deletedNumbers = 0;
  let numbers = readDb('numbers') || [];
  const initLen = numbers.length;
  const targetCountry = (targetRange?.country || '').trim().toLowerCase();
  const targetProvider = (targetRange?.provider || 'Manual').trim().toLowerCase();
  const targetName = (targetRange?.range_name || '').trim().toLowerCase();

  // Cascade delete all numbers belonging to this deleted range
  numbers = numbers.filter(n => {
    // 1. Direct range_id match
    if (n.range_id && Number(n.range_id) === id) return false;
    // 2. Direct range_name match
    if (targetName && n.range_name && n.range_name.trim().toLowerCase() === targetName) return false;
    // 3. If range_id is not set, match country and provider if no other active range uses them
    if (!n.range_id && targetCountry && targetProvider) {
      const c = (n.country || '').trim().toLowerCase();
      const p = (n.provider || '').trim().toLowerCase();
      if (c === targetCountry && p === targetProvider) return false;
    }
    return true;
  });
  deletedNumbers = initLen - numbers.length;
  writeDb('numbers', numbers);

  logAudit('Owner', 'Delete SMS Range', `Deleted range #${id} and ${deletedNumbers} numbers`, 'Ranges');
  res.json({ success: true, deleted_numbers: deletedNumbers });
});

// Import to existing or new range
app.post('/api/numbers/import-to-range', (req, res) => {
  try {
    const payload = req.body || {};
    const numbersText = payload.numbers || '';
    const lines = numbersText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) {
      return res.status(400).json({ error: 'No numbers provided' });
    }

    const ranges = readDb('sms_ranges') || [];
    let rangeId = payload.range_id;
    let newRange = payload.new_range;
    let rng = null;

    if (newRange) {
      const isWnNew = isWhitenoiseRecord(newRange);
      const effNewPt = isWnNew ? 'Monthly' : normalizePaytermKey(newRange.payterm || newRange.payout_schedule || 'Weekly');
      const newMeta = getPaytermMeta(effNewPt);
      const payout = parseFloat(newRange.payout || 0) || 0;
      const otpLimit = parseInt(newRange.otp_limit || 0, 10) || 0;
      const cost = parseFloat(newRange.cost || 0) || 0;
      const entry = {
        id: nextId(ranges, 'sms_ranges'),
        country: newRange.country || '',
        provider: newRange.provider || 'Manual',
        prefix: newRange.prefix || '',
        range_name: (newRange.name || newRange.range_name || newRange.country || 'Range').trim(),
        name: (newRange.name || newRange.range_name || newRange.country || 'Range').trim(),
        cost: cost,
        payterm: newMeta.key,
        payout_schedule: newMeta.schedule,
        cycle_days: newMeta.cycle_days,
        hold_days: newMeta.hold_days,
        ...(isWnNew ? { is_whitenoise: true } : {}),
        payout: payout,
        otp_limit: otpLimit,
        active: true,
        created: new Date().toISOString()
      };
      ranges.unshift(entry);
      writeDb('sms_ranges', ranges);
      rangeId = entry.id;

      const rateCard = readDb('rate_card') || [];
      rateCard.unshift({
        id: nextId(rateCard, 'rate_card'),
        country: entry.country,
        provider: entry.provider,
        buy_rate: entry.cost,
        sell_rate: payout,
        margin: `${entry.cost ? Math.round((1 - payout / entry.cost) * 100) : 0}%`,
        active: true,
        created: new Date().toISOString()
      });
      writeDb('rate_card', rateCard);
      rng = entry;
    } else {
      rng = ranges.find(r => r.id === Number(rangeId));
      if (!rng) {
        return res.status(404).json({ error: 'Range not found — select a range or create a new one' });
      }
    }

    const countryOverride = (payload.country_override || '').trim();
    const numbers = readDb('numbers') || [];
    const added = [];
    const baseId = nextId(numbers, 'numbers');

    // Filter out common CSV/text headers like 'number', 'phone', 'msisdn'
    const validLines = lines.filter(l => !/^(number|phone|msisdn|mobile|phone\s*number)$/i.test(l));
    if (!validLines.length) {
      return res.status(400).json({ error: 'No valid phone numbers found in input' });
    }

    // Build digit lookup map of existing numbers in system
    const existingMap = new Map();
    for (const item of numbers) {
      const d = String(item.number || '').replace(/\D/g, '');
      if (d) existingMap.set(d, item);
    }

    const seenInBatch = new Set();
    const duplicates = [];
    const targetRangeId = Number(rng.id);
    const targetRangeName = rng.range_name || rng.name || rng.country || 'Range';
    const isWnTargetRng = isWhitenoiseRecord(rng);

    for (let i = 0; i < validLines.length; i++) {
      const num = validLines[i];
      const digits = String(num).replace(/\D/g, '');
      if (!digits) continue;

      // Check duplicate within the submitted list
      if (seenInBatch.has(digits)) {
        duplicates.push({ number: num, reason: 'Duplicate in submitted list' });
        continue;
      }
      seenInBatch.add(digits);

      // Check duplicate in database
      const existing = existingMap.get(digits);
      if (existing) {
        if (Number(existing.range_id) === targetRangeId) {
          duplicates.push({ number: num, reason: 'Already exists in this range' });
        } else {
          const otherRange = existing.range_name || existing.country || `Range #${existing.range_id}`;
          duplicates.push({ number: num, reason: `Already in range "${otherRange}"` });
        }
        continue;
      }

      const importNowIso = new Date().toISOString();
      added.push({
        id: baseId + added.length,
        number: num,
        range_id: rng.id,
        range_name: targetRangeName,
        prefix: rng.prefix || '',
        app: 'Unassigned',
        status: 'active',
        agent_id: null,
        client_id: null,
        user: 'unallocated',
        country: countryOverride || rng.country || '',
        provider: rng.provider || 'Manual',
        ...(isWnTargetRng ? { is_whitenoise: true, payterm: 'Monthly', client_payterm: 'Monthly', payout_schedule: 'monthly30_5', cycle_days: 30, hold_days: 5 } : {}),
        otp_limit: rng.otp_limit || 0,
        created_at: importNowIso,
        created: importNowIso,
        allocated_at: importNowIso,
        last_sms: null,
        sms_count: 0,
        notes: ''
      });
      existingMap.set(digits, { range_id: rng.id, range_name: targetRangeName });
    }

    if (added.length > 0) {
      numbers.push(...added);
      writeDb('numbers', numbers);
      logAudit('Admin', 'Import Numbers', `Imported ${added.length} numbers to range "${targetRangeName}" (skipped ${duplicates.length} duplicate(s))`, 'Numbers');
    }

    res.json({
      success: true,
      imported: added.length,
      skipped_duplicates: duplicates.length,
      duplicates_detail: duplicates,
      range_id: rangeId,
      range_name: targetRangeName,
      message: added.length > 0
        ? `Imported ${added.length} number(s).${duplicates.length ? ` Skipped ${duplicates.length} duplicate(s).` : ''}`
        : `No numbers imported. All ${duplicates.length} number(s) were duplicates.`
    });
  } catch (err) {
    console.error('import-to-range error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk range import from CSV / TXT
app.post('/api/numbers/bulk-range-import', upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ detail: 'No file uploaded' });
    }
    const text = req.file.buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) {
      return res.status(400).json({ detail: 'File is empty' });
    }

    const providerName = (req.body.provider_name || 'Provider').trim();
    const mode = req.body.mode || 'iprn';
    const overrideCost = parseFloat(req.body.override_cost || 0) || 0;
    const payoutSchedule = req.body.payout_schedule || 'weekly';
    const overridePayout = parseFloat(req.body.override_payout || 0) || 0;
    const otpLimit = parseInt(req.body.otp_limit || 0, 10) || 0;

    const rows = [];
    for (const line of lines) {
      if (line.includes(',')) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 3) {
          rows.push({ country: parts[0], provider: parts[1] || providerName, number: parts[2] });
        } else if (parts.length === 2) {
          rows.push({ country: parts[0], provider: providerName, number: parts[1] });
        } else {
          rows.push({ country: 'Unknown', provider: providerName, number: parts[0] });
        }
      } else {
        rows.push({ country: 'Unknown', provider: providerName, number: line });
      }
    }

    if (!rows.length) {
      return res.status(400).json({ detail: 'No valid numbers found in file' });
    }

    const groups = {};
    for (const r of rows) {
      const key = `${r.country}||${r.provider}`;
      if (!groups[key]) groups[key] = { country: r.country, provider: r.provider, numbers: [] };
      groups[key].numbers.push(r.number);
    }

    const ranges = readDb('sms_ranges') || [];
    const rateCard = readDb('rate_card') || [];
    const numbersDb = readDb('numbers') || [];
    const createdRanges = [];
    let totalAdded = 0;

    const monthDay = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    for (const key of Object.keys(groups)) {
      const grp = groups[key];
      const provPart = (grp.provider && grp.provider !== 'Manual' && grp.provider !== grp.country) ? ` ${grp.provider}` : '';
      const rangeName = `${grp.country}${provPart} SSP ${monthDay}`;
      const isWnGrp = isWhitenoiseRecord({ provider: grp.provider, range_name: rangeName });
      const grpPt = isWnGrp ? 'Monthly' : normalizePaytermKey(payoutSchedule || 'Weekly');
      const grpMeta = getPaytermMeta(grpPt);
      const rngEntry = {
        id: nextId(ranges, 'sms_ranges'),
        country: grp.country,
        provider: grp.provider || 'Manual',
        prefix: '',
        range_name: rangeName,
        name: rangeName,
        cost: overrideCost,
        payterm: grpMeta.key,
        payout_schedule: grpMeta.schedule,
        cycle_days: grpMeta.cycle_days,
        hold_days: grpMeta.hold_days,
        ...(isWnGrp ? { is_whitenoise: true } : {}),
        payout: overridePayout,
        otp_limit: otpLimit,
        active: true,
        created: new Date().toISOString()
      };
      ranges.unshift(rngEntry);
      createdRanges.push(rngEntry);

      rateCard.unshift({
        id: nextId(rateCard, 'rate_card'),
        country: grp.country,
        provider: grp.provider,
        buy_rate: overrideCost,
        sell_rate: overridePayout,
        margin: `${overrideCost ? Math.round((1 - overridePayout / overrideCost) * 100) : 0}%`,
        active: true,
        created: new Date().toISOString()
      });

      const existingDigits = new Set(numbersDb.map(n => String(n.number || '').replace(/\D/g, '')).filter(Boolean));
      const seenBatch = new Set();

      for (let i = 0; i < grp.numbers.length; i++) {
        const num = grp.numbers[i];
        const digits = String(num).replace(/\D/g, '');
        if (!digits) continue;
        if (existingDigits.has(digits) || seenBatch.has(digits)) {
          continue;
        }
        seenBatch.add(digits);
        existingDigits.add(digits);

        const bulkImpNowIso = new Date().toISOString();
        numbersDb.push({
          id: nextId(numbersDb, 'numbers') + totalAdded,
          number: num,
          range_id: rngEntry.id,
          range_name: rngEntry.range_name,
          prefix: rngEntry.prefix || '',
          app: 'Unassigned',
          status: 'active',
          agent_id: null,
          client_id: null,
          user: 'unallocated',
          country: grp.country,
          provider: grp.provider,
          ...(isWnGrp ? { is_whitenoise: true, payterm: 'Monthly', client_payterm: 'Monthly', payout_schedule: 'monthly30_5', cycle_days: 30, hold_days: 5 } : {}),
          otp_limit: otpLimit,
          created_at: bulkImpNowIso,
          created: bulkImpNowIso,
          allocated_at: bulkImpNowIso,
          last_sms: null,
          sms_count: 0,
          notes: ''
        });
        totalAdded++;
      }
    }

    writeDb('sms_ranges', ranges);
    writeDb('rate_card', rateCard);
    writeDb('numbers', numbersDb);

    logAudit('Admin', 'Bulk Range Import', `Created ${createdRanges.length} range(s), imported ${totalAdded} numbers`, 'Numbers');
    res.json({
      ranges_created: createdRanges.length,
      numbers_imported: totalAdded,
      ranges: createdRanges.map(r => ({
        name: r.range_name,
        country: r.country,
        provider: r.provider,
        cost: r.cost,
        payout_schedule: r.payout_schedule,
        payout: r.payout
      }))
    });
  } catch (err) {
    console.error('bulk-range-import error:', err);
    res.status(500).json({ detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
//  SMART MULTI-COUNTRY / MULTI-RANGE EXCEL NUMBER SHEET IMPORTER
//  - Handles multi-sheet, multi-column matrix, tabular, section-headed & single-column files
//  - Global deduplication against live numbers.json + within uploaded file
//  - Auto-matches each group to Owner's existing sms_ranges (prioritizing Whitenoise {W} ranges)
//  - Selective 1-click commit per range group OR bulk commit all matched groups
// ══════════════════════════════════════════════════════════════════
const SMART_IMPORT_PREVIEW_CACHE = new Map();
const SMART_IMPORT_TTL_MS = 30 * 60 * 1000;

function pruneSmartImportCache() {
  const now = Date.now();
  for (const [k, v] of SMART_IMPORT_PREVIEW_CACHE.entries()) {
    if (!v || (now - v.created_at) > SMART_IMPORT_TTL_MS) {
      SMART_IMPORT_PREVIEW_CACHE.delete(k);
    }
  }
  if (SMART_IMPORT_PREVIEW_CACHE.size > 30) {
    const oldest = [...SMART_IMPORT_PREVIEW_CACHE.entries()].sort((a, b) => a[1].created_at - b[1].created_at);
    while (SMART_IMPORT_PREVIEW_CACHE.size > 25 && oldest.length) {
      SMART_IMPORT_PREVIEW_CACHE.delete(oldest.shift()[0]);
    }
  }
}

function extractSmartPhoneCandidate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'boolean') return null;
  let str = '';
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return null;
    if (Math.abs(val - Math.trunc(val)) > 1e-6) return null; // decimals like rates/prices are not phone numbers
    str = Math.trunc(val).toString();
  } else {
    str = String(val).trim();
  }
  if (!str) return null;
  // Reject dates (2026-11-18, 18/11/2026, 18.11.2026) and URLs
  if (/^https?:\/\//i.test(str) || /^\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/.test(str)) return null;
  // Reject strings with letters (except scientific notation like 9.23E+11)
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(str)) {
    const n = Number(str);
    if (!Number.isFinite(n) || n <= 0) return null;
    str = Math.trunc(n).toString();
  } else if (/[a-zA-Z]/.test(str)) {
    return null;
  }
  const digits = str.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 16) return null;
  // Reject obvious date-like 8-digit values only if original string had dots like 18.11.2026
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(str)) return null;
  const display = str.startsWith('+') ? `+${digits}` : digits;
  return { display, digits };
}

function isLikelyRangeHeaderText(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number' || typeof val === 'boolean') return false;
  const s = String(val).trim();
  if (!s || s.length < 2 || s.length > 90) return false;
  if (extractSmartPhoneCandidate(s)) return false;
  if (!/[a-zA-Z]/.test(s)) return false;
  if (/^(#|sr\.?|s\.?no\.?|no\.?|id|index|total|subtotal|grand\s*total|sum|count|date|status|notes?|remarks?|number|phone|msisdn|did|mobile|phone\s*number|sms\s*number|tel)$/i.test(s)) {
    return false;
  }
  return true;
}

function normRangeMatchKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\{w\}/g, ' ')
    .replace(/\(w\)/g, ' ')
    .replace(/\[w\]/g, ' ')
    .replace(/\b(whitenoise|monthly|weekly|ssp|sms|range|route|virtual|mobile|numbers?|list)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findBestRangeMatch(groupLabel, digitsList, ownerRanges, filenameHint = '') {
  if (!Array.isArray(ownerRanges) || !ownerRanges.length) {
    return { suggested_range_id: null, suggested_range_name: null, match_confidence: 'none', match_reason: '' };
  }
  const rawLabel = String(groupLabel || '').trim().toLowerCase();
  const normLabel = normRangeMatchKey(groupLabel);
  const labelTokens = normLabel.split(/\s+/).filter(t => t.length >= 2);
  const fileMentionsWn = /whitenoise|kamran|monthly|\{w\}/i.test(`${filenameHint} ${groupLabel}`);

  // Compute dominant prefix samples (first 100 digits)
  const sampleDigits = (digitsList || []).slice(0, 100);
  let best = null;
  let bestScore = 0;
  let bestReason = '';

  for (const rng of ownerRanges) {
    if (!rng) continue;
    const rName = String(rng.range_name || rng.name || '').trim();
    const rCountry = String(rng.country || '').trim();
    const rPrefix = String(rng.prefix || '').replace(/\D/g, '');
    const rawRName = rName.toLowerCase();
    const normRName = normRangeMatchKey(rName);
    const normRCountry = normRangeMatchKey(rCountry);
    const rTokens = new Set([...normRName.split(/\s+/), ...normRCountry.split(/\s+/)].filter(t => t.length >= 2));

    let score = 0;
    const reasons = [];

    if (rawLabel && rawRName && rawLabel === rawRName) {
      score += 110;
      reasons.push('Exact range name');
    } else if (normLabel && normRName && normLabel === normRName) {
      score += 95;
      reasons.push('Name match');
    } else if (normLabel && normRName && (normRName.includes(normLabel) || normLabel.includes(normRName))) {
      score += 65;
      reasons.push('Name contains match');
    } else if (normLabel && normRCountry && (normLabel === normRCountry || normLabel.includes(normRCountry) || normRCountry.includes(normLabel))) {
      score += 55;
      reasons.push('Country match');
    }

    if (labelTokens.length && rTokens.size) {
      let overlap = 0;
      for (const t of labelTokens) {
        if (rTokens.has(t)) overlap++;
      }
      if (overlap > 0) {
        const ratio = overlap / Math.max(labelTokens.length, 1);
        const tokenPts = Math.round(ratio * 45) + (overlap * 8);
        score += Math.min(55, tokenPts);
        if (!reasons.length) reasons.push('Keyword match');
      }
    }

    if (rPrefix && rPrefix.length >= 2 && sampleDigits.length > 0) {
      let prefHits = 0;
      for (const d of sampleDigits) {
        if (d.startsWith(rPrefix)) prefHits++;
      }
      const prefRatio = prefHits / sampleDigits.length;
      if (prefRatio >= 0.7) {
        score += 48 + Math.min(12, rPrefix.length * 2);
        reasons.push(`Prefix +${rPrefix} (${Math.round(prefRatio * 100)}%)`);
      } else if (prefRatio >= 0.35) {
        score += 22;
        reasons.push(`Partial prefix +${rPrefix}`);
      }
    }

    if (score > 0 && isWhitenoiseRecord(rng)) {
      if (fileMentionsWn) score += 16;
      else score += 6;
    }

    if (score > bestScore) {
      bestScore = score;
      best = rng;
      bestReason = reasons.join(' · ');
    }
  }

  if (!best || bestScore < 35) {
    return { suggested_range_id: null, suggested_range_name: null, match_confidence: 'none', match_reason: '' };
  }
  const conf = bestScore >= 85 ? 'high' : (bestScore >= 55 ? 'medium' : 'low');
  return {
    suggested_range_id: best.id,
    suggested_range_name: best.range_name || best.name || best.country || `Range #${best.id}`,
    match_confidence: conf,
    match_reason: bestReason
  };
}

function parseSmartNumberSheetBuffer(buffer, filename = 'numbers.xlsx') {
  const cleanStem = String(filename || 'Sheet').replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim() || 'Uploaded Sheet';
  const ext = String(filename || '').toLowerCase();
  const rawGroups = new Map(); // groupKey -> { label, sheet_name, entries: [{ display, digits }] }

  const pushEntry = (label, sheetName, cand) => {
    const cleanLabel = String(label || '').trim() || cleanStem;
    const key = cleanLabel.toLowerCase();
    if (!rawGroups.has(key)) {
      rawGroups.set(key, { label: cleanLabel, sheet_name: sheetName || cleanStem, entries: [] });
    }
    rawGroups.get(key).entries.push(cand);
  };

  if (ext.endsWith('.txt')) {
    const lines = buffer.toString('utf-8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let currentLabel = cleanStem;
    for (const line of lines) {
      if (line.includes(',') || line.includes('\t') || line.includes(';')) {
        const parts = line.split(/[,;\t]+/).map(p => p.trim()).filter(Boolean);
        let foundCand = null;
        let foundText = '';
        for (const p of parts) {
          const c = extractSmartPhoneCandidate(p);
          if (c && !foundCand) foundCand = c;
          else if (!c && isLikelyRangeHeaderText(p) && !foundText) foundText = p;
        }
        if (foundCand) {
          pushEntry(foundText || currentLabel, 'TXT', foundCand);
          continue;
        }
      }
      const c = extractSmartPhoneCandidate(line);
      if (c) {
        pushEntry(currentLabel, 'TXT', c);
      } else if (isLikelyRangeHeaderText(line)) {
        currentLabel = line;
      }
    }
    return [...rawGroups.values()];
  }

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];

  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!Array.isArray(matrix) || !matrix.length) continue;

    const isGenericSheet = /^sheet\s*\d*$/i.test(String(sheetName || '').trim());
    const fallbackLabel = isGenericSheet ? cleanStem : String(sheetName).trim();

    // Strategy 1: Explicit tabular header row (Range/Country column + Number/Phone column)
    let headerRowIdx = -1;
    let numColIdx = -1;
    let rangeColIdx = -1;
    const scanLimit = Math.min(matrix.length, 6);
    for (let r = 0; r < scanLimit; r++) {
      const row = matrix[r] || [];
      let nCol = -1;
      let gCol = -1;
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '').trim().toLowerCase();
        if (!cell) continue;
        if (nCol === -1 && /^(number|numbers|phone|phone\s*number|msisdn|did|mobile|sms\s*number|tel|destination\s*number|cli)$/.test(cell)) {
          nCol = c;
        } else if (gCol === -1 && /^(range|range\s*name|country|country\s*name|route|operator|carrier|network|destination|origin|name|group|service|title)$/.test(cell)) {
          gCol = c;
        }
      }
      if (nCol !== -1) {
        headerRowIdx = r;
        numColIdx = nCol;
        rangeColIdx = gCol;
        break;
      }
    }

    if (headerRowIdx !== -1 && numColIdx !== -1) {
      let lastLabel = fallbackLabel;
      for (let r = headerRowIdx + 1; r < matrix.length; r++) {
        const row = matrix[r] || [];
        const cand = extractSmartPhoneCandidate(row[numColIdx]);
        if (!cand) continue;
        const lblRaw = rangeColIdx !== -1 ? String(row[rangeColIdx] ?? '').trim() : '';
        if (lblRaw && !extractSmartPhoneCandidate(lblRaw)) lastLabel = lblRaw;
        pushEntry(lblRaw || lastLabel || fallbackLabel, sheetName, cand);
      }
      continue;
    }

    // Determine max column count across rows
    let maxCols = 0;
    for (const row of matrix) {
      if (Array.isArray(row) && row.length > maxCols) maxCols = row.length;
    }

    // Strategy 2: Two-column (or N-column) unheaded paired rows: (RangeLabel, PhoneNumber) on the same row
    // Detect if there is a single dominant number column paired with a text label column
    const colPhoneCounts = new Array(maxCols).fill(0);
    const colTextCounts = new Array(maxCols).fill(0);
    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r] || [];
      for (let c = 0; c < maxCols; c++) {
        const v = row[c];
        if (v === '' || v === null || v === undefined) continue;
        if (extractSmartPhoneCandidate(v)) colPhoneCounts[c]++;
        else if (isLikelyRangeHeaderText(v)) colTextCounts[c]++;
      }
    }
    const phoneCols = colPhoneCounts.map((cnt, idx) => ({ idx, cnt })).filter(x => x.cnt > 0);
    const textOnlyCols = colTextCounts
      .map((cnt, idx) => ({ idx, cnt }))
      .filter(x => x.cnt >= 2 && colPhoneCounts[x.idx] === 0);

    if (phoneCols.length === 1 && textOnlyCols.length >= 1) {
      const pIdx = phoneCols[0].idx;
      // Pick the text-only column with most entries (most likely Range/Country name)
      const gIdx = textOnlyCols.sort((a, b) => b.cnt - a.cnt)[0].idx;
      let lastLabel = fallbackLabel;
      for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r] || [];
        const cand = extractSmartPhoneCandidate(row[pIdx]);
        const txt = String(row[gIdx] ?? '').trim();
        if (txt && isLikelyRangeHeaderText(txt)) lastLabel = txt;
        if (cand) {
          pushEntry(txt && isLikelyRangeHeaderText(txt) ? txt : lastLabel, sheetName, cand);
        }
      }
      continue;
    }

    // Strategy 3: Multi-column Range-per-Column matrix OR single/multi-column with section headers
    // Each column with phone numbers uses its column header (and any mid-column section headers)
    for (let c = 0; c < maxCols; c++) {
      if (colPhoneCounts[c] === 0) continue;
      let currentLabel = fallbackLabel;
      for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r] || [];
        const cellVal = row[c];
        if (cellVal === '' || cellVal === null || cellVal === undefined) continue;
        const cand = extractSmartPhoneCandidate(cellVal);
        if (cand) {
          pushEntry(currentLabel, sheetName, cand);
        } else if (isLikelyRangeHeaderText(cellVal)) {
          currentLabel = String(cellVal).trim();
        }
      }
    }
  }

  return [...rawGroups.values()];
}

app.post('/api/numbers/smart-sheet-preview', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (normRole(req.sessionUser.role) !== 'owner') {
      return res.status(403).json({ error: 'Owner access required.' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please upload an Excel (.xlsx / .xls), CSV, or TXT file.' });
    }
    const filename = req.file.originalname || 'numbers.xlsx';
    const rawGroups = parseSmartNumberSheetBuffer(req.file.buffer, filename);
    if (!rawGroups.length) {
      return res.status(400).json({
        error: 'No valid phone numbers found in this file. Make sure the sheet contains 7–16 digit phone numbers.'
      });
    }

    const numbersDb = readDb('numbers') || [];
    const ownerRanges = (readDb('sms_ranges') || []).filter(r => r && r.active !== false);
    const existingMap = new Map();
    for (const item of numbersDb) {
      const d = String(item.number || '').replace(/\D/g, '');
      if (d) {
        existingMap.set(d, {
          range_id: item.range_id ?? null,
          range_name: item.range_name || item.country || (item.range_id ? `Range #${item.range_id}` : 'Existing Pool')
        });
      }
    }

    const seenInFile = new Set();
    let totalInFile = 0;
    let totalNew = 0;
    let totalExisting = 0;
    let totalDupInFile = 0;

    const processedGroups = [];
    rawGroups.forEach((grp, idx) => {
      const newNumbers = [];
      const newDigits = [];
      const existingSamples = [];
      let existingCount = 0;
      let dupInFileCount = 0;

      for (const entry of grp.entries) {
        totalInFile++;
        if (seenInFile.has(entry.digits)) {
          dupInFileCount++;
          totalDupInFile++;
          continue;
        }
        seenInFile.add(entry.digits);
        const foundExisting = existingMap.get(entry.digits);
        if (foundExisting) {
          existingCount++;
          totalExisting++;
          if (existingSamples.length < 5) {
            existingSamples.push({ number: entry.display, existing_range: foundExisting.range_name });
          }
          continue;
        }
        newNumbers.push(entry.display);
        newDigits.push(entry.digits);
        totalNew++;
      }

      const match = findBestRangeMatch(
        grp.label,
        newDigits.length ? newDigits : grp.entries.map(e => e.digits),
        ownerRanges,
        filename
      );

      const groupKey = `grp_${idx + 1}`;
      processedGroups.push({
        group_key: groupKey,
        label: grp.label,
        sheet_name: grp.sheet_name,
        total_count: grp.entries.length,
        new_count: newNumbers.length,
        existing_count: existingCount,
        duplicate_in_file_count: dupInFileCount,
        sample_new: newNumbers.slice(0, 8),
        sample_existing: existingSamples,
        suggested_range_id: match.suggested_range_id,
        suggested_range_name: match.suggested_range_name,
        match_confidence: match.match_confidence,
        match_reason: match.match_reason,
        imported: false,
        imported_count: 0,
        imported_range_name: '',
        _new_numbers: newNumbers
      });
    });

    pruneSmartImportCache();
    const previewToken = crypto.randomBytes(18).toString('hex');
    SMART_IMPORT_PREVIEW_CACHE.set(previewToken, {
      token: previewToken,
      owner_id: Number(req.sessionUser.id),
      filename,
      created_at: Date.now(),
      groups: processedGroups
    });

    const rangesPayload = ownerRanges
      .slice()
      .sort((a, b) => {
        const aW = isWhitenoiseRecord(a) ? 0 : 1;
        const bW = isWhitenoiseRecord(b) ? 0 : 1;
        if (aW !== bW) return aW - bW;
        return String(a.range_name || a.name || '').localeCompare(String(b.range_name || b.name || ''));
      })
      .map(r => ({
        id: r.id,
        range_name: r.range_name || r.name || r.country || `Range #${r.id}`,
        country: r.country || '',
        prefix: r.prefix || '',
        provider: r.provider || '',
        is_whitenoise: isWhitenoiseRecord(r),
        payterm: isWhitenoiseRecord(r) ? 'Monthly' : (r.payterm || 'Weekly')
      }));

    res.json({
      success: true,
      preview_token: previewToken,
      filename,
      summary: {
        total_in_file: totalInFile,
        verified_new: totalNew,
        already_exists: totalExisting,
        duplicates_in_file: totalDupInFile,
        groups_count: processedGroups.length,
        matched_groups_count: processedGroups.filter(g => g.suggested_range_id != null && g.new_count > 0).length
      },
      groups: processedGroups.map(({ _new_numbers, ...pub }) => pub),
      owner_ranges: rangesPayload
    });
  } catch (err) {
    console.error('smart-sheet-preview error:', err);
    res.status(400).json({ error: `Could not read this file: ${err.message}` });
  }
});

app.post('/api/numbers/smart-sheet-commit', requireAuth, (req, res) => {
  try {
    if (normRole(req.sessionUser.role) !== 'owner') {
      return res.status(403).json({ error: 'Owner access required.' });
    }
    const body = req.body || {};
    const token = String(body.preview_token || '').trim();
    pruneSmartImportCache();
    const cached = SMART_IMPORT_PREVIEW_CACHE.get(token);
    if (!cached || Number(cached.owner_id) !== Number(req.sessionUser.id)) {
      return res.status(404).json({ error: 'Preview session expired or not found. Please upload and verify the file again.' });
    }

    const reqItems = Array.isArray(body.items) && body.items.length
      ? body.items
      : (body.group_key && body.target_range_id ? [{ group_key: body.group_key, target_range_id: body.target_range_id }] : []);

    if (!reqItems.length) {
      return res.status(400).json({ error: 'Please select a target range and group to import.' });
    }

    const ranges = readDb('sms_ranges') || [];
    const numbersDb = readDb('numbers') || [];
    const existingDigits = new Set(
      numbersDb.map(n => String(n.number || '').replace(/\D/g, '')).filter(Boolean)
    );

    let totalInserted = 0;
    let totalSkipped = 0;
    const results = [];
    let baseId = nextId(numbersDb, 'numbers');
    const nowIso = new Date().toISOString();

    for (const item of reqItems) {
      const gKey = String(item.group_key || '').trim();
      const targetRangeId = Number(item.target_range_id);
      const grp = cached.groups.find(g => g.group_key === gKey);
      if (!grp) {
        results.push({ group_key: gKey, error: 'Group not found in preview', inserted: 0, skipped_existing: 0 });
        continue;
      }
      const rng = ranges.find(r => Number(r.id) === targetRangeId);
      if (!rng) {
        results.push({ group_key: gKey, error: 'Target range not found', inserted: 0, skipped_existing: 0 });
        continue;
      }

      const targetRangeName = rng.range_name || rng.name || rng.country || `Range #${rng.id}`;
      const isWnTarget = isWhitenoiseRecord(rng);
      const grpPt = isWnTarget ? 'Monthly' : normalizePaytermKey(rng.payterm || rng.payout_schedule || 'Weekly');
      const grpMeta = getPaytermMeta(grpPt);
      let insertedHere = 0;
      let skippedHere = 0;

      for (const rawNum of (grp._new_numbers || [])) {
        const digits = String(rawNum || '').replace(/\D/g, '');
        if (!digits) continue;
        if (existingDigits.has(digits)) {
          skippedHere++;
          continue;
        }
        existingDigits.add(digits);
        numbersDb.push({
          id: baseId++,
          number: rawNum,
          range_id: rng.id,
          range_name: targetRangeName,
          prefix: rng.prefix || '',
          app: 'Unassigned',
          status: 'active',
          agent_id: null,
          client_id: null,
          user: 'unallocated',
          country: rng.country || grp.label || '',
          provider: rng.provider || (isWnTarget ? 'Whitenoise' : 'Manual'),
          payterm: grpMeta.key,
          client_payterm: grpMeta.key,
          payout_schedule: grpMeta.schedule,
          cycle_days: grpMeta.cycle_days,
          hold_days: grpMeta.hold_days,
          ...(isWnTarget ? { is_whitenoise: true } : {}),
          otp_limit: rng.otp_limit || 0,
          created_at: nowIso,
          created: nowIso,
          allocated_at: nowIso,
          last_sms: null,
          sms_count: 0,
          notes: `Smart Sheet Import (${cached.filename})`
        });
        insertedHere++;
      }

      grp.imported = true;
      grp.imported_count = (grp.imported_count || 0) + insertedHere;
      grp.imported_range_id = rng.id;
      grp.imported_range_name = targetRangeName;
      totalInserted += insertedHere;
      totalSkipped += skippedHere;

      results.push({
        group_key: gKey,
        label: grp.label,
        target_range_id: rng.id,
        target_range_name: targetRangeName,
        inserted: insertedHere,
        skipped_existing: skippedHere
      });
    }

    if (totalInserted > 0) {
      writeDb('numbers', numbersDb);
      const summaryDesc = results
        .filter(r => r.inserted > 0)
        .map(r => `${r.inserted} -> ${r.target_range_name}`)
        .join(', ');
      logAudit('Admin', 'Smart Sheet Import', `Imported ${totalInserted} new number(s) from "${cached.filename}" (${summaryDesc})`, 'Numbers');
    }

    res.json({
      success: true,
      inserted: totalInserted,
      skipped_existing: totalSkipped,
      results,
      message: totalInserted > 0
        ? `Added ${totalInserted} verified new number(s).${totalSkipped ? ` Skipped ${totalSkipped} already existing.` : ''}`
        : `No new numbers added.${totalSkipped ? ` All ${totalSkipped} number(s) already exist in the system.` : ''}`
    });
  } catch (err) {
    console.error('smart-sheet-commit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
//  APPS LINKS DIRECTORY (Owner CRUD + Excel Import + Top/Low Priority + Per-User Access)
// ══════════════════════════════════════════════════════════════════
function normalizeSafeHttpUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  // Auto-prepend https:// for common bare domains like play.google.com/... or www.example.com
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    if (/^(www\.|play\.google\.com|apps\.apple\.com|[a-z0-9-]+\.[a-z]{2,}\/)/i.test(s)) {
      s = `https://${s}`;
    } else {
      return null;
    }
  }
  try {
    const parsed = new URL(s);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function sortAppLinksList(list) {
  return (list || []).slice().sort((a, b) => {
    const ap = a.pinned_top ? 0 : 1;
    const bp = b.pinned_top ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ao = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999999;
    const bo = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999999;
    if (ao !== bo) return ao - bo;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function parseAppLinksExcelBuffer(buffer, filename = 'services.xlsx') {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  const extracted = [];
  const seenKeys = new Set();

  const pushApp = (nameRaw, urlRaw, categoryRaw = '', notesRaw = '') => {
    const name = String(nameRaw || '').trim();
    const safeUrl = normalizeSafeHttpUrl(urlRaw);
    if (!name || !safeUrl) return;
    if (/^(app|app\s*name|service|service\s*name|name|title|link|url|play\s*store)$/i.test(name)) return;
    const dedupKey = `${name.toLowerCase()}||${safeUrl.toLowerCase()}`;
    if (seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);
    extracted.push({
      name: name.slice(0, 140),
      url: safeUrl,
      category: String(categoryRaw || '').trim().slice(0, 60),
      notes: String(notesRaw || '').trim().slice(0, 240)
    });
  };

  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);

    // Collect cell text + hyperlink target for every cell in sheet
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const rowCells = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const text = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : '';
        const link = cell && cell.l && cell.l.Target ? String(cell.l.Target).trim() : '';
        rowCells.push({ text, link });
      }
      rows.push(rowCells);
    }

    // Detect optional header row
    let headerIdx = -1;
    let nameCol = -1;
    let urlCol = -1;
    let catCol = -1;
    let notesCol = -1;

    for (let r = 0; r < Math.min(rows.length, 5); r++) {
      const row = rows[r];
      let nC = -1, uC = -1, cC = -1, ntC = -1;
      row.forEach((cell, idx) => {
        const t = cell.text.toLowerCase();
        if (!t) return;
        if (nC === -1 && /^(app|app\s*name|application|service|service\s*name|name|title|platform)$/.test(t)) nC = idx;
        else if (uC === -1 && /^(link|url|app\s*link|store\s*link|play\s*store|play\s*store\s*link|download|download\s*link|website|href)$/.test(t)) uC = idx;
        else if (cC === -1 && /^(category|type|group|tag)$/.test(t)) cC = idx;
        else if (ntC === -1 && /^(notes?|description|remarks?|info)$/.test(t)) ntC = idx;
      });
      if (nC !== -1 && (uC !== -1 || rows.slice(r + 1).some(rw => rw[nC] && rw[nC].link))) {
        headerIdx = r;
        nameCol = nC;
        urlCol = uC;
        catCol = cC;
        notesCol = ntC;
        break;
      }
    }

    const startRow = headerIdx !== -1 ? headerIdx + 1 : 0;
    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.length) continue;

      if (nameCol !== -1) {
        const nCell = row[nameCol] || { text: '', link: '' };
        const uCell = urlCol !== -1 ? (row[urlCol] || { text: '', link: '' }) : { text: '', link: '' };
        const urlVal = normalizeSafeHttpUrl(uCell.link) || normalizeSafeHttpUrl(uCell.text) || normalizeSafeHttpUrl(nCell.link);
        const catVal = catCol !== -1 ? (row[catCol]?.text || '') : '';
        const noteVal = notesCol !== -1 ? (row[notesCol]?.text || '') : '';
        if (nCell.text && urlVal) {
          pushApp(nCell.text, urlVal, catVal, noteVal);
          continue;
        }
      }

      // Smart row scan fallback: works for embedded hyperlinks OR any (Name, URL) column pair
      let foundUrl = null;
      let urlCellIdx = -1;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell.link && normalizeSafeHttpUrl(cell.link)) {
          foundUrl = normalizeSafeHttpUrl(cell.link);
          urlCellIdx = c;
          // If the cell itself has a readable non-URL text, use it directly as app name!
          if (cell.text && !normalizeSafeHttpUrl(cell.text)) {
            pushApp(cell.text, foundUrl, '', '');
            foundUrl = null;
            break;
          }
          break;
        }
        if (cell.text && normalizeSafeHttpUrl(cell.text)) {
          foundUrl = normalizeSafeHttpUrl(cell.text);
          urlCellIdx = c;
          break;
        }
      }
      if (foundUrl) {
        let bestName = '';
        for (let c = 0; c < row.length; c++) {
          if (c === urlCellIdx) continue;
          const t = row[c].text;
          if (t && !normalizeSafeHttpUrl(t) && !/^\d+$/.test(t)) {
            bestName = t;
            break;
          }
        }
        if (!bestName) {
          try {
            const u = new URL(foundUrl);
            bestName = u.searchParams.get('id') || u.hostname.replace(/^www\./, '');
          } catch (_) {
            bestName = 'App Link';
          }
        }
        pushApp(bestName, foundUrl, '', '');
      }
    }
  }

  return extracted;
}

app.get('/api/app-links', requireAuth, (req, res) => {
  const role = normRole(req.sessionUser.role);
  if (!hasAppLinksAccess(req.sessionUser)) {
    return res.status(403).json({ error: 'Apps Links access is not enabled for your account.' });
  }
  const allLinks = sortAppLinksList(readDb('app_links') || []);
  const items = role === 'owner' ? allLinks : allLinks.filter(item => item.visible !== false);
  res.json({
    success: true,
    data: items,
    total: items.length,
    visible_count: allLinks.filter(item => item.visible !== false).length,
    hidden_count: allLinks.filter(item => item.visible === false).length
  });
});

app.post('/api/app-links', requireAuth, (req, res) => {
  if (normRole(req.sessionUser.role) !== 'owner') {
    return res.status(403).json({ error: 'Only Owner can add App Links.' });
  }
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const safeUrl = normalizeSafeHttpUrl(body.url);
  if (!name) return res.status(400).json({ error: 'App name is required.' });
  if (!safeUrl) return res.status(400).json({ error: 'Please enter a valid http:// or https:// link.' });

  const list = readDb('app_links') || [];
  const maxOrder = list.reduce((mx, x) => Math.max(mx, Number(x.sort_order) || 0), 0);
  const nowIso = new Date().toISOString();
  const item = {
    id: nextId(list, 'app_links'),
    name: name.slice(0, 140),
    url: safeUrl,
    category: String(body.category || '').trim().slice(0, 60),
    notes: String(body.notes || '').trim().slice(0, 240),
    visible: body.visible !== false,
    pinned_top: Boolean(body.pinned_top),
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : (maxOrder + 10),
    created_at: nowIso,
    updated_at: nowIso
  };
  list.push(item);
  writeDb('app_links', sortAppLinksList(list));
  logAudit('Admin', 'App Link Added', `Added app link "${item.name}"`, 'Apps Links');
  res.json({ success: true, data: item });
});

app.post('/api/app-links/import-excel', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (normRole(req.sessionUser.role) !== 'owner') {
      return res.status(403).json({ error: 'Only Owner can import App Links.' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please upload an Excel (.xlsx / .xls) or CSV file.' });
    }
    const parsed = parseAppLinksExcelBuffer(req.file.buffer, req.file.originalname || 'services.xlsx');
    if (!parsed.length) {
      return res.status(400).json({ error: 'No valid App Name + http/https Link rows found in this file.' });
    }

    const list = sortAppLinksList(readDb('app_links') || []);
    const byName = new Map();
    list.forEach(item => byName.set(String(item.name || '').trim().toLowerCase(), item));

    let maxOrder = list.reduce((mx, x) => Math.max(mx, Number(x.sort_order) || 0), 0);
    let baseId = nextId(list, 'app_links');
    const nowIso = new Date().toISOString();
    const defaultVisible = String(req.body?.default_visible ?? 'true') !== 'false';
    let added = 0;
    let updated = 0;

    for (const row of parsed) {
      const key = row.name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        existing.url = row.url;
        if (row.category) existing.category = row.category;
        if (row.notes) existing.notes = row.notes;
        existing.updated_at = nowIso;
        updated++;
      } else {
        maxOrder += 10;
        const entry = {
          id: baseId++,
          name: row.name,
          url: row.url,
          category: row.category || '',
          notes: row.notes || '',
          visible: defaultVisible,
          pinned_top: false,
          sort_order: maxOrder,
          created_at: nowIso,
          updated_at: nowIso
        };
        list.push(entry);
        byName.set(key, entry);
        added++;
      }
    }

    const sorted = sortAppLinksList(list);
    writeDb('app_links', sorted);
    logAudit('Admin', 'App Links Excel Import', `Imported ${added} new, updated ${updated} from "${req.file.originalname || 'services.xlsx'}"`, 'Apps Links');
    res.json({
      success: true,
      added,
      updated,
      total: sorted.length,
      data: sorted,
      message: `Imported ${added} new app link(s)${updated ? ` and updated ${updated} existing` : ''}.`
    });
  } catch (err) {
    console.error('app-links import-excel error:', err);
    res.status(400).json({ error: `Could not read Excel file: ${err.message}` });
  }
});

app.post('/api/app-links/reorder', requireAuth, (req, res) => {
  if (normRole(req.sessionUser.role) !== 'owner') {
    return res.status(403).json({ error: 'Only Owner can reorder App Links.' });
  }
  const body = req.body || {};
  let list = sortAppLinksList(readDb('app_links') || []);
  const nowIso = new Date().toISOString();

  if (Array.isArray(body.ordered_ids) && body.ordered_ids.length) {
    const byId = new Map(list.map(x => [Number(x.id), x]));
    const reordered = [];
    for (const rawId of body.ordered_ids) {
      const it = byId.get(Number(rawId));
      if (it) {
        reordered.push(it);
        byId.delete(Number(rawId));
      }
    }
    for (const leftover of byId.values()) reordered.push(leftover);
    reordered.forEach((it, idx) => {
      it.sort_order = (idx + 1) * 10;
      it.updated_at = nowIso;
    });
    writeDb('app_links', reordered);
    return res.json({ success: true, data: reordered });
  }

  const targetId = Number(body.id);
  const action = String(body.action || '').trim().toLowerCase();
  const idx = list.findIndex(x => Number(x.id) === targetId);
  if (idx === -1) return res.status(404).json({ error: 'App link not found.' });

  const [item] = list.splice(idx, 1);
  if (action === 'top') {
    item.pinned_top = true;
    list.unshift(item);
  } else if (action === 'bottom' || action === 'low') {
    item.pinned_top = false;
    list.push(item);
  } else if (action === 'up') {
    const newIdx = Math.max(0, idx - 1);
    list.splice(newIdx, 0, item);
  } else if (action === 'down') {
    const newIdx = Math.min(list.length, idx + 1);
    list.splice(newIdx, 0, item);
  } else {
    return res.status(400).json({ error: 'Invalid reorder action. Use top, up, down, or low.' });
  }

  // Re-normalize sort_order sequentially while preserving pinned_top consistency for top/low moves
  if (action === 'up' || action === 'down') {
    const neighbor = list[action === 'up' ? Math.min(list.length - 1, Math.max(0, idx - 1) + 1) : Math.max(0, Math.min(list.length - 1, idx + 1) - 1)];
    if (neighbor && Boolean(neighbor.pinned_top) !== Boolean(item.pinned_top)) {
      item.pinned_top = Boolean(neighbor.pinned_top);
    }
  }
  list.forEach((it, i) => {
    it.sort_order = (i + 1) * 10;
    it.updated_at = nowIso;
  });
  const sorted = sortAppLinksList(list);
  writeDb('app_links', sorted);
  res.json({ success: true, data: sorted });
});

app.patch('/api/app-links/:id', requireAuth, (req, res) => {
  if (normRole(req.sessionUser.role) !== 'owner') {
    return res.status(403).json({ error: 'Only Owner can edit App Links.' });
  }
  const id = Number(req.params.id);
  const list = readDb('app_links') || [];
  const item = list.find(x => Number(x.id) === id);
  if (!item) return res.status(404).json({ error: 'App link not found.' });

  const body = req.body || {};
  if ('name' in body) {
    const cleanName = String(body.name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'App name cannot be empty.' });
    item.name = cleanName.slice(0, 140);
  }
  if ('url' in body) {
    const safeUrl = normalizeSafeHttpUrl(body.url);
    if (!safeUrl) return res.status(400).json({ error: 'Please enter a valid http:// or https:// link.' });
    item.url = safeUrl;
  }
  if ('category' in body) item.category = String(body.category || '').trim().slice(0, 60);
  if ('notes' in body) item.notes = String(body.notes || '').trim().slice(0, 240);
  if ('visible' in body) item.visible = Boolean(body.visible);
  if ('pinned_top' in body) item.pinned_top = Boolean(body.pinned_top);
  if ('sort_order' in body && Number.isFinite(Number(body.sort_order))) item.sort_order = Number(body.sort_order);
  item.updated_at = new Date().toISOString();

  const sorted = sortAppLinksList(list);
  writeDb('app_links', sorted);
  res.json({ success: true, data: item });
});

app.delete('/api/app-links/:id', requireAuth, (req, res) => {
  if (normRole(req.sessionUser.role) !== 'owner') {
    return res.status(403).json({ error: 'Only Owner can delete App Links.' });
  }
  const id = Number(req.params.id);
  const list = readDb('app_links') || [];
  const idx = list.findIndex(x => Number(x.id) === id);
  if (idx === -1) return res.status(404).json({ error: 'App link not found.' });
  const [removed] = list.splice(idx, 1);
  writeDb('app_links', sortAppLinksList(list));
  logAudit('Admin', 'App Link Deleted', `Deleted app link "${removed.name}"`, 'Apps Links');
  res.json({ success: true, id });
});

// Simple number list upload
app.post('/api/numbers/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const text = req.file.buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const country = (req.body.country || 'US').trim();
    const numbers = readDb('numbers') || [];
    const added = [];
    const baseId = nextId(numbers, 'numbers');
    const existingDigits = new Set(numbers.map(n => String(n.number || '').replace(/\D/g, '')).filter(Boolean));
    const seenBatch = new Set();
    let skippedDuplicates = 0;

    for (let i = 0; i < lines.length; i++) {
      const num = lines[i];
      const digits = String(num).replace(/\D/g, '');
      if (!digits) continue;
      if (existingDigits.has(digits) || seenBatch.has(digits)) {
        skippedDuplicates++;
        continue;
      }
      seenBatch.add(digits);
      existingDigits.add(digits);

      const uploadNowIso = new Date().toISOString();
      added.push({
        id: baseId + added.length,
        number: num,
        app: 'Unassigned',
        status: 'active',
        user: 'unallocated',
        country: country,
        provider: 'Manual',
        created_at: uploadNowIso,
        created: uploadNowIso,
        allocated_at: uploadNowIso,
        last_sms: null,
        sms_count: 0,
        notes: ''
      });
    }

    if (added.length > 0) {
      numbers.push(...added);
      writeDb('numbers', numbers);
      logAudit('Admin', 'Upload Numbers', `Uploaded ${added.length} numbers (skipped ${skippedDuplicates} duplicates)`, 'Numbers');
    }
    res.json({
      imported: added.length,
      skipped_duplicates: skippedDuplicates,
      total: numbers.length,
      success: true
    });
  } catch (err) {
    console.error('upload numbers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Rate Card (Must return Array directly)
app.get('/api/numbers/rate-card', (req, res) => {
  const card = readDb('rate_card') || [];
  const _viewer = req.sessionUser || getSessionUser(req);
  const _role = normRole(_viewer && _viewer.role);
  if (_role === 'owner') return res.json(card);
  const wnTags = getWhitenoiseProviderTags();
  // Agent & Client: Isolated payout rate only (Never leaks owner buy_rate, internal provider names, or profit margins)
  res.json(card.map(c => ({
    id: c.id,
    range_name: c.range_name || c.name || c.country,
    name: c.range_name || c.name || c.country,
    country: c.country,
    prefix: c.prefix || '',
    provider: maskProviderLabel(c.provider || '', false, wnTags),
    sell_rate: c.sell_rate != null ? c.sell_rate : (c.payout != null ? c.payout : 0.01),
    rate: c.sell_rate != null ? c.sell_rate : (c.payout != null ? c.payout : 0.01),
    payout: c.sell_rate != null ? c.sell_rate : (c.payout != null ? c.payout : 0.01),
    payterm: c.payterm || 'Weekly',
    active: c.active !== false
  })));
});

app.post('/api/numbers/rate-card', (req, res) => {
  const card = readDb('rate_card') || [];
  const item = { id: nextId(card, 'rate_card'), ...req.body, active: true, created: new Date().toISOString() };
  card.unshift(item);
  writeDb('rate_card', card);
  res.json(item);
});

app.patch('/api/numbers/rate-card/:id', (req, res) => {
  const card = readDb('rate_card') || [];
  const id = Number(req.params.id);
  const idx = card.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  card[idx] = { ...card[idx], ...req.body };
  writeDb('rate_card', card);
  res.json(card[idx]);
});

app.delete('/api/numbers/rate-card/:id', (req, res) => {
  const card = readDb('rate_card') || [];
  const id = Number(req.params.id);
  writeDb('rate_card', card.filter(c => c.id !== id));
  res.json({ success: true });
});

// ── C5: Owner Warning List & Reconciliation Endpoints ──────────
app.get('/api/numbers/no-rate-ranges', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const isOwner = normRole(sessionUser.role) === 'owner';
  if (!isOwner) return res.status(403).json({ error: 'Forbidden. Owner only.' });

  const ranges = readDb('sms_ranges') || [];
  const numbers = readDb('numbers') || [];
  const noRateList = [];

  for (const r of ranges) {
    const cost = Number(r.company_cost ?? r.cost ?? r.buy_rate ?? 0);
    const payout = (r.payterms && Object.values(r.payterms).some(v => v !== 'NA' && Number(v) > 0)) || (Number(r.payout) > 0);
    if (!cost || !payout) {
      noRateList.push({
        id: r.id,
        range_name: r.range_name || r.name,
        country: r.country,
        provider: r.provider,
        cost: cost,
        has_payout: Boolean(payout),
        affected_numbers_count: numbers.filter(n => Number(n.range_id) === Number(r.id)).length
      });
    }
  }
  res.json({ success: true, count: noRateList.length, ranges: noRateList });
});

app.get('/api/finance/reconciliation', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const isOwner = normRole(sessionUser.role) === 'owner';
  if (!isOwner) return res.status(403).json({ error: 'Forbidden. Owner only.' });

  const fxRate = getUsdToPkrRate();
  const wnVirtual = (readDb('whitenoise_daily_stats') || []).map(st => statRowToVirtualSms(st, fxRate));
  const allSms = [...readSmsWithArchive(), ...wnVirtual];
  let totalCompany = 0;
  let totalOwner = 0;
  let totalAgent = 0;
  let totalClient = 0;
  let totalSmsCount = 0;

  for (const s of allSms) {
    totalSmsCount += (Number(s.sms_count) > 0 ? Math.round(Number(s.sms_count)) : 1);
    totalCompany += (Number(s.company_rate) || 0);
    totalOwner += (Number(s.owner_amount) || 0);
    totalAgent += (Number(s.agent_amount) || 0);
    totalClient += (Number(s.client_amount) || 0);
  }

  totalCompany = Math.round(totalCompany * 1000000) / 1000000;
  const totalDistributed = Math.round((totalOwner + totalAgent + totalClient) * 1000000) / 1000000;
  const isReconciled = Math.abs(totalCompany - totalDistributed) < 0.001;

  res.json({
    success: true,
    total_sms: totalSmsCount,
    company_revenue: totalCompany,
    owner_amount: Math.round(totalOwner * 1000000) / 1000000,
    agent_amount: Math.round(totalAgent * 1000000) / 1000000,
    client_amount: Math.round(totalClient * 1000000) / 1000000,
    total_distributed: totalDistributed,
    reconciled: isReconciled
  });
});

// ── Separated Weekly (API) vs Monthly ({W} / Whitenoise) Wallet Calculator ──
function getPayoutRequestType(p) {
  if (!p) return 'weekly';
  const pt = String(p.payout_type || '').trim().toLowerCase();
  if (pt === 'monthly' || pt === 'whitenoise') return 'monthly';
  const sched = String(p.schedule || p.payterm || p.term || '').trim().toLowerCase();
  if (sched.includes('monthly') || sched.includes('30/5') || p.is_whitenoise) return 'monthly';
  return 'weekly';
}

function computeUserSplitWallets(sessionUser, allPayoutsOverride = null) {
  const sRole = (sessionUser?.role || '').toLowerCase();
  const userId = Number(sessionUser?.id);
  const myUsername = String(sessionUser?.username || '').trim().toLowerCase();
  const allSms = readSmsWithArchive();
  const wnStatsVirtual = getScopedWhitenoiseStatsAsVirtualSms(sessionUser);
  const allPayouts = Array.isArray(allPayoutsOverride) ? allPayoutsOverride : (readDb('payout_requests') || []);
  const fxRate = getUsdToPkrRate();

  let earned = 0;
  let earnedPkr = 0;
  let scopedSms = [];
  if (sRole === 'client') {
    scopedSms = [
      ...allSms.filter(s => !s.client_deleted && ((s.client_id != null && s.client_id !== '' && Number(s.client_id) === userId) || ((s.client_id == null || s.client_id === '') && s.client_username && s.client_username.toLowerCase() === myUsername))),
      ...wnStatsVirtual
    ];
    earned = scopedSms.reduce((sum, s) => sum + (Number(s.client_amount) || 0), 0);
    earnedPkr = scopedSms.reduce((sum, s) => sum + (s.client_amount_pkr != null ? Number(s.client_amount_pkr) : (Number(s.client_amount) || 0) * (Number(s.fx_usd_to_pkr) || fxRate)), 0);
  } else if (sRole === 'agent') {
    scopedSms = [
      ...allSms.filter(s => (s.agent_username && s.agent_username.toLowerCase() === myUsername) || Number(s.agent_id) === userId),
      ...wnStatsVirtual
    ];
    earned = scopedSms.reduce((sum, s) => sum + (Number(s.agent_amount) || 0), 0);
    earnedPkr = earned * fxRate;
  } else if (sRole === 'owner' || sRole === 'admin') {
    scopedSms = [...allSms, ...wnStatsVirtual];
    earned = scopedSms.reduce((sum, s) => sum + (Number(s.owner_amount) || 0), 0);
    earnedPkr = earned * fxRate;
  }

  const holdSummary = computeUserHoldSummary(scopedSms, sRole, fxRate);

  const userPayouts = allPayouts.filter(p => {
    if (!p) return false;
    const pRole = String(p.role || p.recipient_role || '').toLowerCase();
    const pUser = String(p.recipient_username || p.username || p.user || '').trim().toLowerCase();
    if (pUser) {
      return pUser === myUsername;
    }
    if (sRole === 'client') return (pRole === 'client' || !pRole) && (Number(p.client_id || p.user_id) === userId);
    if (sRole === 'agent') return (pRole === 'agent' || !pRole) && (Number(p.agent_id || p.user_id) === userId);
    return false;
  });

  const isPaidStatus = p => {
    const st = String(p.status || '').toLowerCase();
    return st === 'completed' || st === 'paid';
  };
  const isPendingStatus = p => {
    const st = String(p.status || '').toLowerCase();
    return st === 'pending' || st === 'approved';
  };
  const payoutUsd = p => {
    if (String(p.currency || 'USD').toUpperCase() === 'PKR') {
      if (p.amount_usd != null) return Number(p.amount_usd) || 0;
      const fx = Number(p.fx_usd_to_pkr) || fxRate;
      return (Number(p.amount) || 0) / fx;
    }
    return Number(p.amount) || 0;
  };
  const payoutPkr = p => {
    if (String(p.currency || 'USD').toUpperCase() === 'PKR') {
      return Number(p.amount) || 0;
    }
    return (Number(p.amount) || 0) * (Number(p.fx_usd_to_pkr) || fxRate);
  };

  const weeklyPayouts = userPayouts.filter(p => getPayoutRequestType(p) === 'weekly');
  const monthlyPayouts = userPayouts.filter(p => getPayoutRequestType(p) === 'monthly');

  const weeklyPaidUsd = weeklyPayouts.filter(isPaidStatus).reduce((sum, p) => sum + payoutUsd(p), 0);
  const weeklyPendingUsd = weeklyPayouts.filter(isPendingStatus).reduce((sum, p) => sum + payoutUsd(p), 0);
  const weeklyPaidPkr = weeklyPayouts.filter(isPaidStatus).reduce((sum, p) => sum + payoutPkr(p), 0);
  const weeklyPendingPkr = weeklyPayouts.filter(isPendingStatus).reduce((sum, p) => sum + payoutPkr(p), 0);

  const monthlyPaidUsd = monthlyPayouts.filter(isPaidStatus).reduce((sum, p) => sum + payoutUsd(p), 0);
  const monthlyPendingUsd = monthlyPayouts.filter(isPendingStatus).reduce((sum, p) => sum + payoutUsd(p), 0);
  const monthlyPaidPkr = monthlyPayouts.filter(isPaidStatus).reduce((sum, p) => sum + payoutPkr(p), 0);
  const monthlyPendingPkr = monthlyPayouts.filter(isPendingStatus).reduce((sum, p) => sum + payoutPkr(p), 0);

  const totalPaid = weeklyPaidUsd + monthlyPaidUsd;
  const pendingHold = weeklyPendingUsd + monthlyPendingUsd;
  const totalPaidPkr = weeklyPaidPkr + monthlyPaidPkr;
  const pendingHoldPkr = weeklyPendingPkr + monthlyPendingPkr;

  const balance = Math.round((earned - totalPaid) * 10000) / 10000;
  const availableBalance = Math.max(0, Math.round((earned - totalPaid - pendingHold) * 10000) / 10000);
  const balancePkr = round2(earnedPkr - totalPaidPkr);
  const availableBalancePkr = Math.max(0, round2(earnedPkr - totalPaidPkr - pendingHoldPkr));

  const userRec = findUserAnywhere(sessionUser?.username)?.user;
  const dbBalance = userRec && userRec.balance !== undefined ? Number(userRec.balance) : balance;
  const dbBalancePkr = userRec && userRec.balance_pkr !== undefined ? Number(userRec.balance_pkr) : round2(dbBalance * fxRate);

  const wkTerm = holdSummary.by_payterm.Weekly || { sms_count: 0, cleared_usd: 0, held_usd: 0, cleared_pkr: 0, held_pkr: 0 };
  const moTerm = holdSummary.by_payterm.Monthly || { sms_count: 0, cleared_usd: 0, held_usd: 0, cleared_pkr: 0, held_pkr: 0 };

  const weeklyEarnedUsd = round4((Number(wkTerm.cleared_usd) || 0) + (Number(wkTerm.held_usd) || 0));
  const weeklyEarnedPkr = round2((Number(wkTerm.cleared_pkr) || 0) + (Number(wkTerm.held_pkr) || 0));

  const monthlyClearedUsd = round4(Number(moTerm.cleared_usd) || 0);
  const monthlyHeldUsd = round4(Number(moTerm.held_usd) || 0);
  const monthlyEarnedUsd = round4(monthlyClearedUsd + monthlyHeldUsd);
  const monthlyClearedPkr = round2(Number(moTerm.cleared_pkr) || 0);
  const monthlyHeldPkr = round2(Number(moTerm.held_pkr) || 0);
  const monthlyEarnedPkr = round2(monthlyClearedPkr + monthlyHeldPkr);

  // Unpaid Monthly {W} ledger share currently sitting inside dbBalance
  const monthlyUnpaidLedgerUsd = Math.max(0, round4(monthlyEarnedUsd - monthlyPaidUsd));
  const monthlyUnpaidLedgerPkr = Math.max(0, round2(monthlyEarnedPkr - monthlyPaidPkr));

  // Monthly {W} available NOW = ONLY matured/cleared Monthly earnings minus Monthly paid & pending (never unmatured held funds!)
  const monthlyAvailableUsd = Math.max(0, round4(Math.min(
    monthlyClearedUsd - monthlyPaidUsd - monthlyPendingUsd,
    Math.max(0, dbBalance - weeklyPendingUsd - monthlyPendingUsd)
  )));
  const monthlyAvailablePkr = Math.max(0, round2(Math.min(
    monthlyClearedPkr - monthlyPaidPkr - monthlyPendingPkr,
    Math.max(0, dbBalancePkr - weeklyPendingPkr - monthlyPendingPkr)
  )));

  // Weekly (API) portion of DB balance strictly excludes ALL Monthly {W} funds (held OR cleared)!
  const weeklyDbPortionUsd = Math.max(0, round4(dbBalance - monthlyUnpaidLedgerUsd));
  const weeklyDbPortionPkr = Math.max(0, round2(dbBalancePkr - monthlyUnpaidLedgerPkr));
  const weeklyAvailableUsd = Math.max(0, round4(weeklyDbPortionUsd - weeklyPendingUsd));
  const weeklyAvailablePkr = Math.max(0, round2(weeklyDbPortionPkr - weeklyPendingPkr));

  const monthlyClearDate = moTerm.next_release_at
    ? String(moTerm.next_release_at).slice(0, 10)
    : (holdSummary.monthly_cycle?.clear_date || '');

  const weekly_wallet = {
    payout_type: 'weekly',
    schedule: 'Weekly (7/3)',
    sms_count: Number(wkTerm.sms_count || 0),
    earned_usd: weeklyEarnedUsd,
    earned_pkr: weeklyEarnedPkr,
    cleared_usd: round4(Number(wkTerm.cleared_usd) || 0),
    held_usd: round4(Number(wkTerm.held_usd) || 0),
    cleared_pkr: round2(Number(wkTerm.cleared_pkr) || 0),
    held_pkr: round2(Number(wkTerm.held_pkr) || 0),
    paid_usd: round4(weeklyPaidUsd),
    paid_pkr: round2(weeklyPaidPkr),
    pending_usd: round4(weeklyPendingUsd),
    pending_pkr: round2(weeklyPendingPkr),
    balance_usd: weeklyDbPortionUsd,
    balance_pkr: weeklyDbPortionPkr,
    available_usd: weeklyAvailableUsd,
    available_pkr: weeklyAvailablePkr
  };

  const monthly_wallet = {
    payout_type: 'monthly',
    schedule: 'Monthly (30/5) {W}',
    sms_count: Number(moTerm.sms_count || 0),
    earned_usd: monthlyEarnedUsd,
    earned_pkr: monthlyEarnedPkr,
    cleared_usd: monthlyClearedUsd,
    held_usd: monthlyHeldUsd,
    cleared_pkr: monthlyClearedPkr,
    held_pkr: monthlyHeldPkr,
    paid_usd: round4(monthlyPaidUsd),
    paid_pkr: round2(monthlyPaidPkr),
    pending_usd: round4(monthlyPendingUsd),
    pending_pkr: round2(monthlyPendingPkr),
    balance_usd: monthlyUnpaidLedgerUsd,
    balance_pkr: monthlyUnpaidLedgerPkr,
    available_usd: monthlyAvailableUsd,
    available_pkr: monthlyAvailablePkr,
    is_matured: sRole === 'client' ? monthlyAvailablePkr > 0 : monthlyAvailableUsd > 0,
    cycle_start: holdSummary.monthly_cycle?.start_date || '',
    cycle_end: holdSummary.monthly_cycle?.end_date || '',
    clear_date: monthlyClearDate
  };

  return {
    fxRate,
    earned,
    earnedPkr,
    totalPaid,
    pendingHold,
    totalPaidPkr,
    pendingHoldPkr,
    balance,
    availableBalance,
    balancePkr,
    availableBalancePkr,
    dbBalance,
    dbBalancePkr,
    holdSummary,
    userPayouts,
    weekly_wallet,
    monthly_wallet
  };
}

// ── C4: Payments & Stamped Balance Engine (Username & Role Base) ──
app.get(['/api/payments', '/api/payments/balance', '/api/payments/summary'], requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const userId = Number(sessionUser.id);

  const w = computeUserSplitWallets(sessionUser);

  res.json({
    success: true,
    role: sessionUser.role,
    username: sessionUser.username,
    user_id: userId,
    preferred_currency: sRole === 'client' ? 'PKR' : 'USD',
    usd_to_pkr_rate: w.fxRate,
    total_earned: Math.round(w.earned * 10000) / 10000,
    total_paid: Math.round(w.totalPaid * 10000) / 10000,
    pending_hold: Math.round(w.pendingHold * 10000) / 10000,
    available_balance: w.availableBalance,
    balance: w.balance,
    main_balance: Math.round(w.dbBalance * 10000) / 10000,
    ledger_balance: w.balance,
    total_earned_pkr: round2(w.earnedPkr),
    total_paid_pkr: round2(w.totalPaidPkr),
    pending_hold_pkr: round2(w.pendingHoldPkr),
    available_balance_pkr: w.availableBalancePkr,
    balance_pkr: w.balancePkr,
    main_balance_pkr: round2(w.dbBalancePkr),
    weekly_wallet: w.weekly_wallet,
    monthly_wallet: w.monthly_wallet,
    payterm_schedules: PAYTERM_DEFINITIONS,
    hold_summary: w.holdSummary,
    monthly_cycle: w.holdSummary.monthly_cycle,
    monthly30_5: getMonthly30_5ScheduleInfo(w.holdSummary),
    whitenoise_access: hasWhitenoiseAccess(sessionUser),
    ...(sRole === 'agent' ? { weekly_target: getAgentClientWeeklyPkrStats(userId) } : {}),
    payouts: w.userPayouts
  });
});

app.post('/api/payments', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgent = sRole === 'agent';

  if (!isOwner && !isAgent) {
    return res.status(403).json({ error: 'Access denied. Clients cannot record payments.' });
  }

  const { recipient_id, recipient_username, recipient_role, amount, notes, method, currency } = req.body || {};
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    return res.status(400).json({ error: 'Valid payment amount is required' });
  }

  // Find recipient by username or id
  let targetUser = null;
  let targetRole = recipient_role;
  if (recipient_username) {
    const found = findUserAnywhere(recipient_username);
    if (found) {
      targetUser = found.user;
      targetRole = found.role;
    }
  } else if (recipient_id) {
    const rLower = String(recipient_role || '').toLowerCase();
    let tables = ['users', 'agents', 'clients'];
    if (rLower === 'client') {
      tables = ['clients', 'agents', 'users'];
    } else if (rLower === 'agent') {
      tables = ['agents', 'clients', 'users'];
    }
    for (const tbl of tables) {
      const rows = readDb(tbl) || [];
      const f = rows.find(x => x && Number(x.id) === Number(recipient_id));
      if (f) {
        targetUser = f;
        targetRole = f.role || (tbl === 'agents' ? 'Agent' : tbl === 'clients' ? 'Client' : 'Owner');
        break;
      }
    }
  }

  if (!targetUser) {
    return res.status(404).json({ error: 'Recipient user not found. Please provide a valid username or ID.' });
  }

  const finalUsername = targetUser.username;
  const finalRole = targetRole || (recipient_role || 'Client');

  if (isOwner && finalRole.toLowerCase() === 'client') {
    return res.status(403).json({ error: 'Forbidden. Client PKR payouts are managed exclusively by their Agent.' });
  }

  if (isAgent) {
    if (finalRole.toLowerCase() !== 'client') {
      return res.status(403).json({ error: 'Agents can only record payouts for Clients.' });
    }
    if (Number(targetUser.agent_id) !== Number(sessionUser.id)) {
      return res.status(403).json({ error: 'Access denied. This client does not belong to your account.' });
    }
  }

  const fx = getUsdToPkrRate();
  const payCurrency = String(currency || 'USD').toUpperCase();
  const curBal = Number(targetUser.balance || 0);
  const curBalPkr = targetUser.balance_pkr != null ? Number(targetUser.balance_pkr) : round2(curBal * fx);
  const usdDeduct = payCurrency === 'PKR' ? round6(numAmount / fx) : numAmount;
  const pkrDeduct = payCurrency === 'PKR' ? round2(numAmount) : round2(numAmount * fx);

  if (payCurrency === 'PKR') {
    if (curBalPkr + 1e-6 < pkrDeduct) {
      return res.status(400).json({ error: `Insufficient PKR balance. Recipient only has Rs. ${cleanMoneyStr(curBalPkr, 4)} PKR available.` });
    }
  } else if (curBal < numAmount) {
    return res.status(400).json({ error: `Insufficient balance. Recipient only has $${cleanMoneyStr(curBal, 4)} available.` });
  }

  const payouts = readDb('payout_requests') || [];
  const targetId = targetUser.id;
  const rec = {
    id: nextId(payouts, 'payout_requests'),
    user: finalUsername,
    username: finalUsername,
    role: finalRole,
    user_id: targetId,
    recipient_username: finalUsername,
    recipient_role: finalRole,
    client_id: finalRole.toLowerCase() === 'client' ? targetId : null,
    agent_id: finalRole.toLowerCase() === 'agent' ? targetId : (targetUser.agent_id || null),
    amount: numAmount,
    amount_usd: usdDeduct,
    currency: payCurrency,
    fx_usd_to_pkr: fx,
    method: method || (payCurrency === 'PKR' ? 'Bank / JazzCash / Easypaisa' : 'USDT'),
    notes: notes || '',
    paid_by_username: sessionUser.username,
    paid_by_role: sessionUser.role,
    status: 'completed',
    created: new Date().toISOString(),
    paid_at: new Date().toISOString()
  };
  payouts.unshift(rec);
  writeDb('payout_requests', payouts);

  // Synchronize balance reduction on recipient
  const tbl = finalRole.toLowerCase() === 'agent' ? 'agents' : (finalRole.toLowerCase() === 'client' ? 'clients' : 'users');
  const records = readDb(tbl) || [];
  const idx = records.findIndex(r => r && (r.id === targetUser.id || r.username === targetUser.username));
  if (idx !== -1) {
    const curBalRec = Number(records[idx].balance || 0);
    records[idx].balance = Math.max(0, Math.round((curBalRec - usdDeduct) * 1000000) / 1000000);
    if (tbl === 'clients' || records[idx].balance_pkr != null) {
      const recPkr = records[idx].balance_pkr != null ? Number(records[idx].balance_pkr) : round2(curBalRec * fx);
      records[idx].balance_pkr = Math.max(0, round2(recPkr - pkrDeduct));
    }
    writeDb(tbl, records);
  }

  logAudit(sessionUser.username, 'Record Payout', `Paid ${numAmount} ${payCurrency} to ${finalRole} ${finalUsername}`, 'Payments');
  res.json({ success: true, payment: rec });
});

// ── Financial Statements & Credit Notes ──────────────────────
app.get('/api/statements', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgent = sRole === 'agent';
  const isClient = sRole === 'client';

  const currency = (req.query.currency || 'USD').toUpperCase();
  let reqAgentId = req.query.agent_id ? Number(req.query.agent_id) : (isAgent ? Number(sessionUser.id) : null);
  let reqClientId = req.query.client_id ? Number(req.query.client_id) : (isClient ? Number(sessionUser.id) : null);

  if (isClient) {
    reqAgentId = null;
    reqClientId = Number(sessionUser.id);
  } else if (isAgent) {
    reqAgentId = Number(sessionUser.id);
    if (reqClientId) {
      const cls = readDb('clients') || [];
      const targetCl = cls.find(c => Number(c.id) === reqClientId);
      if (!targetCl || Number(targetCl.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Forbidden. You can only view statements for your own clients.' });
      }
    }
  }

  const fxRate = getUsdToPkrRate();
  const wnStatsAll = (readDb('whitenoise_daily_stats') || []).map(st => statRowToVirtualSms(st, fxRate));
  const allSms = [...readSmsWithArchive(), ...wnStatsAll];
  const allPayouts = readDb('payout_requests') || [];

  let relevantSms = [];
  if (reqClientId) {
    relevantSms = allSms.filter(s => Number(s.client_id) === reqClientId && ((s.currency || 'USD').toUpperCase() === currency));
  } else if (reqAgentId) {
    relevantSms = allSms.filter(s => Number(s.agent_id) === reqAgentId && ((s.currency || 'USD').toUpperCase() === currency));
  } else if (isOwner) {
    relevantSms = allSms.filter(s => ((s.currency || 'USD').toUpperCase() === currency));
  }

  const monthMap = {};
  for (const s of relevantSms) {
    const m = (s.date || (s.timestamp ? s.timestamp.slice(0, 7) : '')).slice(0, 7) || 'Current';
    if (!monthMap[m]) monthMap[m] = { month: m, credit: 0, debit: 0, count: 0, currency };
    const amt = reqClientId ? (Number(s.client_amount) || 0) : (reqAgentId ? (Number(s.agent_amount) || 0) : (Number(s.owner_amount) || 0));
    const cnt = (Number(s.sms_count) > 0) ? Math.round(Number(s.sms_count)) : 1;
    monthMap[m].credit += amt;
    monthMap[m].count += cnt;
  }

  const payouts = allPayouts.filter(p => {
    if (reqClientId) return Number(p.client_id || p.user_id) === reqClientId;
    if (reqAgentId) return Number(p.agent_id || p.user_id) === reqAgentId;
    return true;
  });
  for (const p of payouts) {
    const m = (p.paid_at || p.created || '').slice(0, 7) || 'Current';
    if (!monthMap[m]) monthMap[m] = { month: m, credit: 0, debit: 0, count: 0, currency };
    monthMap[m].debit += (Number(p.amount) || 0);
  }

  const result = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month)).map(item => ({
    ...item,
    credit: Math.round(item.credit * 10000) / 10000,
    debit: Math.round(item.debit * 10000) / 10000,
    balance: Math.round((item.credit - item.debit) * 10000) / 10000
  }));

  res.json({ success: true, currency, data: result });
});

function canAccessCreditNote(sessionUser, note) {
  if (!sessionUser || !note) return false;
  const sRole = normRole(sessionUser.role);
  if (sRole === 'owner') return String(note.role || '').toLowerCase() !== 'client';
  const uid = Number(sessionUser.id);
  const uname = String(sessionUser.username || '').trim().toLowerCase();
  const nUname = String(note.username || note.user || '').trim().toLowerCase();
  if (sRole === 'agent') {
    return Number(note.agent_id) === uid || Number(note.user_id) === uid || (uname && nUname === uname);
  }
  if (sRole === 'client') {
    return Number(note.client_id) === uid || Number(note.user_id) === uid || (uname && nUname === uname);
  }
  return false;
}

app.get('/api/credit-notes', requireAuth, (req, res) => {
  let notes = readDb('credit_notes') || [];
  notes = notes.filter(n => canAccessCreditNote(req.sessionUser, n));
  res.json({ success: true, data: notes });
});

app.get('/api/credit-notes/:id/pdf', requireAuth, (req, res) => {
  const notes = readDb('credit_notes') || [];
  const id = Number(req.params.id);
  const note = notes.find(n => n.id === id || String(n.id) === String(req.params.id));
  if (!note) {
    return res.status(404).send('Credit note not found');
  }
  if (!canAccessCreditNote(req.sessionUser, note)) {
    return res.status(403).send('Forbidden. You cannot access this credit note.');
  }

  const siteName = escHtml((readDb('settings') || {}).site_name || 'HUMAX SMS');
  const voucherNo = escHtml(`CN-${String(note.id).padStart(5, '0')}`);
  const dateStr = escHtml((note.date || note.created || new Date().toISOString()).slice(0, 10));
  const amountStr = cleanMoneyStr(Number(note.amount || 0), 2);
  const cur = escHtml(note.currency || 'USD');
  const statusStr = escHtml(note.status || 'Settled');
  const recipientStr = escHtml(note.username || (note.agent_id ? 'Agent #' + note.agent_id : 'Account Holder'));
  const roleStr = escHtml(note.role || 'Partner');
  const accountIdStr = escHtml(note.agent_id || note.user_id || '—');
  const termStr = escHtml(note.term || 'Weekly');
  const reasonStr = escHtml(note.reason || 'SMS Wholesale Revenue');
  const descReasonStr = escHtml(note.reason || 'Settlement voucher');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Credit Note #${voucherNo}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; background: #fff; max-width: 760px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 24px; margin-bottom: 24px; }
    .logo { font-size: 26px; font-weight: 800; letter-spacing: 1px; color: #0f172a; }
    .logo span { color: #10b981; }
    .meta { text-align: right; font-size: 13px; color: #64748b; line-height: 1.6; }
    .badge { display: inline-block; padding: 4px 12px; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-top: 8px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; font-size: 13px; }
    .info-box strong { display: block; font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; }
    th { background: #f1f5f9; text-align: left; padding: 12px 14px; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; }
    td { padding: 14px; border-bottom: 1px solid #e2e8f0; }
    .total-box { display: flex; justify-content: flex-end; margin-top: 10px; }
    .total-card { width: 280px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; font-size: 14px; }
    .total-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .total-final { font-size: 18px; font-weight: 800; color: #059669; border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 8px; }
    .footer { margin-top: 50px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 20px; display: flex; justify-content: flex-end;">
    <button onclick="window.print()" style="padding: 8px 18px; background: #0f172a; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">Print / Save as PDF</button>
  </div>
  <div class="header">
    <div>
      <div class="logo">HUMAX <span>SMS</span></div>
      <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Wholesale SMS Platform &amp; Carrier Settlement</div>
      <span class="badge">Official Settlement Credit Note</span>
    </div>
    <div class="meta">
      <div><strong>Voucher:</strong> #${voucherNo}</div>
      <div><strong>Date:</strong> ${dateStr}</div>
      <div><strong>Currency:</strong> ${cur}</div>
      <div><strong>Status:</strong> ${statusStr}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <strong>Issued To</strong>
      <div style="font-size: 15px; font-weight: 700; color: #0f172a;">${recipientStr}</div>
      <div>Role: ${roleStr}</div>
      <div>Account ID: #${accountIdStr}</div>
    </div>
    <div class="info-box">
      <strong>Terms &amp; Settlement</strong>
      <div>Payment Term: <b>${termStr}</b></div>
      <div>Transaction Type: Credit Note Settlement</div>
      <div>Settled Via: ${reasonStr}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Reference</th>
        <th>Payterm</th>
        <th style="text-align: right;">Amount (${cur})</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Wholesale SMS Commission &amp; Payout</strong><br><span style="font-size: 12px; color: #64748b;">${descReasonStr}</span></td>
        <td>#${voucherNo}</td>
        <td>${termStr}</td>
        <td style="text-align: right; font-weight: 700;">$${amountStr}</td>
      </tr>
    </tbody>
  </table>

  <div class="total-box">
    <div class="total-card">
      <div class="total-row"><span>Gross Payout:</span><span>$${amountStr}</span></div>
      <div class="total-row"><span>Deductions:</span><span>$0.00</span></div>
      <div class="total-row total-final"><span>Total Credit:</span><span>$${amountStr} ${cur}</span></div>
    </div>
  </div>

  <div class="footer">
    This is an electronically generated financial statement voucher issued by ${siteName}. No signature is required.
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 3. Blacklist (Must return Array directly)
app.get('/api/numbers/blacklist', (req, res) => {
  const list = readDb('blacklist') || [];
  res.json(list);
});

app.post('/api/numbers/blacklist', (req, res) => {
  const list = readDb('blacklist') || [];
  const item = { id: nextId(list, 'blacklist'), ...req.body, active: true, created: new Date().toISOString() };
  list.unshift(item);
  writeDb('blacklist', list);
  res.json(item);
});

app.delete('/api/numbers/blacklist/:id', (req, res) => {
  const list = readDb('blacklist') || [];
  const id = Number(req.params.id);
  writeDb('blacklist', list.filter(b => b.id !== id));
  res.json({ success: true });
});

// 4. Blocked IPs (Must return Array directly)
app.get('/api/firewall/blocked-ips', (req, res) => {
  const blocked = readDb('blocked_ips') || [];
  res.json(blocked);
});

app.post('/api/firewall/block-ip', (req, res) => {
  const blocked = readDb('blocked_ips') || [];
  const ip = (req.body.ip || '').trim();
  if (!ip) return res.status(400).json({ error: 'IP is required' });
  const entry = { id: nextId(blocked, 'blocked_ips'), ip, reason: req.body.reason || 'Manual block', blocked_at: new Date().toISOString() };
  blocked.unshift(entry);
  writeDb('blocked_ips', blocked);
  res.json(entry);
});

app.post('/api/firewall/blocked-ips', (req, res) => {
  const blocked = readDb('blocked_ips') || [];
  const entry = { id: nextId(blocked, 'blocked_ips'), ...req.body, blocked_at: new Date().toISOString() };
  blocked.unshift(entry);
  writeDb('blocked_ips', blocked);
  res.json(entry);
});

app.delete('/api/firewall/blocked-ips/:id', (req, res) => {
  const blocked = readDb('blocked_ips') || [];
  const id = Number(req.params.id);
  writeDb('blocked_ips', blocked.filter(b => b.id !== id));
  res.json({ success: true });
});

// 5. Allocation History (Paginated or raw array)
app.get('/api/numbers/allocation-history', (req, res) => {
  let data = readDb('allocation_history') || [];
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser?.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgent = sRole === 'agent';

  if (!isOwner && isAgent) {
    data = data.filter(h => {
      const fromMe = String(h.from_user || '').toLowerCase() === String(sessionUser.username || '').toLowerCase() ||
                     (h.from_user_id && Number(h.from_user_id) === Number(sessionUser.id)) ||
                     (h.agent_id && Number(h.agent_id) === Number(sessionUser.id)) ||
                     (h.to_user && String(h.to_user).toLowerCase() === String(sessionUser.username || '').toLowerCase());
      return fromMe;
    });
  }

  if (req.query.format === 'array' || (!req.query.page && !req.query.limit && req.query.raw === '1')) {
    return res.json(data);
  }
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const start = (page - 1) * limit;
  res.json({ data: data.slice(start, start + limit), total: data.length });
});

// 7. Services (Array - clean metadata tags without fixed auto rates)
app.get('/api/services', (req, res) => {
  let svc = readDb('services');
  if (!Array.isArray(svc) || svc.length === 0) {
    svc = [
      { id: 1, name: "WhatsApp", icon: "fab fa-whatsapp", color: "#25d366", description: "WhatsApp OTP verification", active: true },
      { id: 2, name: "Telegram", icon: "fab fa-telegram", color: "#2aabee", description: "Telegram OTP verification", active: true },
      { id: 3, name: "Google", icon: "fab fa-google", color: "#4285f4", description: "Google account verification", active: true },
      { id: 4, name: "Facebook", icon: "fab fa-facebook", color: "#1877f2", description: "Facebook OTP numbers", active: true },
      { id: 5, name: "Amazon", icon: "fab fa-amazon", color: "#ff9900", description: "Amazon account verification", active: true },
      { id: 6, name: "TikTok", icon: "fab fa-tiktok", color: "#010101", description: "TikTok account verification", active: true }
    ];
    writeDb('services', svc);
  }
  const cleanSvc = svc.map(s => {
    if (!s || typeof s !== 'object') return s;
    const { payout_rate, ...rest } = s;
    return rest;
  });
  const q = String(req.query.search || '').trim().toLowerCase();
  const statusQ = String(req.query.status || '').trim().toLowerCase();
  let out = cleanSvc;
  if (q) {
    out = out.filter(s =>
      String(s.name || '').toLowerCase().includes(q) ||
      String(s.description || '').toLowerCase().includes(q)
    );
  }
  if (statusQ === 'true' || statusQ === 'active') out = out.filter(s => s.active !== false);
  else if (statusQ === 'false' || statusQ === 'inactive') out = out.filter(s => s.active === false);
  res.json(out);
});

app.post('/api/services', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Service name is required' });
  const svc = readDb('services') || [];
  const item = {
    id: nextId(svc, 'services'),
    name,
    icon: String(req.body?.icon || 'fas fa-mobile-screen').trim(),
    color: String(req.body?.color || '#334155').trim(),
    description: String(req.body?.description || '').trim(),
    active: req.body?.active !== false,
    created: new Date().toISOString()
  };
  svc.push(item);
  writeDb('services', svc);
  res.json(item);
});

app.patch('/api/services/:id', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const svc = readDb('services') || [];
  const idStr = String(req.params.id);
  const idx = svc.findIndex(s => String(s.id) === idStr);
  if (idx === -1) return res.status(404).json({ error: 'Service not found' });
  const { payout_rate, ...safeBody } = req.body || {};
  const { payout_rate: _oldRate, ...base } = svc[idx];
  svc[idx] = { ...base, ...safeBody, id: svc[idx].id };
  writeDb('services', svc);
  res.json(svc[idx]);
});

app.delete('/api/services/:id', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const svc = readDb('services') || [];
  const idStr = String(req.params.id);
  const idx = svc.findIndex(s => String(s.id) === idStr);
  if (idx === -1) return res.status(404).json({ error: 'Service not found' });
  const deleted = svc.splice(idx, 1)[0];
  writeDb('services', svc);
  res.json({ success: true, id: deleted.id });
});

// 8. CLI Routes (Array) - Owner only
app.get('/api/cli-routes', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  let routes = readDb('cli_routes') || [];
  const { search, status, service } = req.query;
  if (search) {
    const q = String(search).toLowerCase();
    routes = routes.filter(r =>
      (r.cli && String(r.cli).toLowerCase().includes(q)) ||
      (r.country && String(r.country).toLowerCase().includes(q)) ||
      (r.description && String(r.description).toLowerCase().includes(q)) ||
      (r.provider && String(r.provider).toLowerCase().includes(q)) ||
      (r.service && String(r.service).toLowerCase().includes(q))
    );
  }
  if (status) {
    routes = routes.filter(r => String(r.status).toLowerCase() === String(status).toLowerCase());
  }
  if (service) {
    routes = routes.filter(r => String(r.service).toLowerCase() === String(service).toLowerCase());
  }
  res.json(routes);
});

app.get('/api/cli-routes/export', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const routes = readDb('cli_routes') || [];
  const headers = ['id', 'cli', 'country', 'description', 'status', 'created'];
  const csvRows = [headers.join(',')];
  for (const r of routes) {
    const row = headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`);
    csvRows.push(row.join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="cli-routes.csv"');
  res.send(csvRows.join('\n'));
});

app.get('/api/cli-routes/:id', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const routes = readDb('cli_routes') || [];
  const idStr = String(req.params.id);
  const route = routes.find(r => String(r.id) === idStr);
  if (!route) return res.status(404).json({ error: 'CLI route not found' });
  res.json(route);
});

app.post('/api/cli-routes', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const cli = String(req.body?.cli || '').trim();
  if (!cli) return res.status(400).json({ error: 'CLI number is required' });
  const routes = readDb('cli_routes') || [];
  const item = {
    id: nextId(routes, 'cli_routes'),
    cli,
    country: String(req.body?.country || 'Global').trim(),
    description: String(req.body?.description || '').trim(),
    status: String(req.body?.status || 'active').trim(),
    created: new Date().toISOString()
  };
  routes.push(item);
  writeDb('cli_routes', routes);
  res.json({ success: true, ...item });
});

app.patch('/api/cli-routes/:id', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const routes = readDb('cli_routes') || [];
  const idStr = String(req.params.id);
  const idx = routes.findIndex(r => String(r.id) === idStr);
  if (idx === -1) {
    return res.status(404).json({ error: 'CLI route not found' });
  }
  const { payout_rate, rate, ...safeUpdates } = req.body || {};
  routes[idx] = { ...routes[idx], ...safeUpdates, id: routes[idx].id };
  writeDb('cli_routes', routes);
  res.json({ success: true, ...routes[idx] });
});

app.put('/api/cli-routes/:id', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const routes = readDb('cli_routes') || [];
  const idStr = String(req.params.id);
  const idx = routes.findIndex(r => String(r.id) === idStr);
  if (idx === -1) {
    return res.status(404).json({ error: 'CLI route not found' });
  }
  const { payout_rate, rate, ...safeUpdates } = req.body || {};
  routes[idx] = { ...routes[idx], ...safeUpdates, id: routes[idx].id };
  writeDb('cli_routes', routes);
  res.json({ success: true, ...routes[idx] });
});

app.delete('/api/cli-routes/:id', requireAuth, (req, res) => {
  const sRole = (req.sessionUser.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const routes = readDb('cli_routes') || [];
  const idStr = String(req.params.id);
  const idx = routes.findIndex(r => String(r.id) === idStr);
  if (idx === -1) {
    return res.status(404).json({ error: 'CLI route not found' });
  }
  const deleted = routes.splice(idx, 1)[0];
  writeDb('cli_routes', routes);
  res.json({ success: true, message: 'CLI route deleted', id: deleted.id });
});


// 9. Support Tickets (Array) - Scoped to Own Tickets (Owner sees all)
app.get('/api/support-tickets', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const tickets = readDb('support_tickets') || [];
  if (isOwner) {
    return res.json(tickets);
  }
  const myUser = String(sessionUser.username || '').toLowerCase();
  const filtered = tickets.filter(t => {
    const tUser = String(t.username || t.user || t.created_by || '').toLowerCase();
    const tId = t.user_id || t.userId;
    return tUser === myUser || (tId && Number(tId) === Number(sessionUser.id));
  });
  res.json(filtered);
});

app.post('/api/support-tickets', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const tickets = readDb('support_tickets') || [];
  const item = {
    id: nextId(tickets, 'support_tickets'),
    ...req.body,
    username: sessionUser.username,
    user: sessionUser.username,
    role: sessionUser.role,
    user_id: sessionUser.id,
    status: 'open',
    created: new Date().toISOString()
  };
  tickets.unshift(item);
  writeDb('support_tickets', tickets);
  if (String(sessionUser.role || '').toLowerCase() !== 'owner' && String(sessionUser.role || '').toLowerCase() !== 'admin') {
    sendInstantNotification({
      recipient_role: 'owner',
      title: `New Support Ticket #${item.id}`,
      message: `${sessionUser.role} ${sessionUser.username} opened a ticket: "${String(item.subject || 'Support Inquiry').slice(0, 90)}"`,
      type: 'info',
      category: 'system',
      action_page: 'support-tickets',
      actor_role: sessionUser.role,
      actor_name: sessionUser.username,
      metadata: { ticket_id: item.id }
    });
  }
  res.json(item);
});

app.patch('/api/support-tickets/:id', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const tickets = readDb('support_tickets') || [];
  const id = Number(req.params.id);
  const idx = tickets.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });
  const t = tickets[idx];
  const myUser = String(sessionUser.username || '').toLowerCase();
  const tUser = String(t.username || t.user || t.created_by || '').toLowerCase();
  if (!isOwner && tUser !== myUser) {
    return res.status(403).json({ error: 'Forbidden. You can only update your own tickets.' });
  }
  if (!isOwner) {
    const safePatch = {};
    if (req.body && req.body.subject !== undefined) safePatch.subject = String(req.body.subject).slice(0, 200);
    if (req.body && req.body.message !== undefined) safePatch.message = String(req.body.message).slice(0, 5000);
    if (req.body && req.body.priority !== undefined) safePatch.priority = String(req.body.priority).slice(0, 32);
    if (req.body && Array.isArray(req.body.replies)) safePatch.replies = req.body.replies;
    tickets[idx] = { ...tickets[idx], ...safePatch, id: tickets[idx].id };
  } else {
    tickets[idx] = { ...tickets[idx], ...req.body, id: tickets[idx].id };
  }
  writeDb('support_tickets', tickets);
  if (isOwner && tUser && tUser !== myUser) {
    const targetR = String(t.role || 'agent').toLowerCase();
    sendInstantNotification({
      recipient_role: targetR === 'client' ? 'client' : 'agent',
      recipient_id: t.user_id || null,
      recipient_username: t.username || t.user || '',
      title: `Support Ticket #${t.id} Updated`,
      message: `Owner updated your support ticket "${String(tickets[idx].subject || '#' + t.id).slice(0, 80)}" (Status: ${tickets[idx].status || 'open'}).`,
      type: 'info',
      category: 'system',
      action_page: targetR === 'client' ? 'news' : 'notifications',
      status: tickets[idx].status || 'open',
      actor_role: 'Owner',
      actor_name: sessionUser.username || 'Owner',
      metadata: { ticket_id: t.id }
    });
  }
  res.json(tickets[idx]);
});

// 10. Hierarchy (Array) - Direct 3-Tier (Owner -> Agents -> Clients), Sanitized with safeUser
app.get('/api/hierarchy', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgent = sRole === 'agent';

  if (!isOwner && !isAgent) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const users = readDb('users') || [];
  const agents = readDb('agents') || [];
  const clients = readDb('clients') || [];

  if (isAgent) {
    const myAgent = agents.find(a => (a.username && String(a.username).toLowerCase() === String(sessionUser.username).toLowerCase()) || Number(a.id) === Number(sessionUser.id));
    if (!myAgent) return res.json([]);
    const myClients = clients.filter(c => Number(c.agent_id) === Number(myAgent.id) || (c.agent_username && String(c.agent_username).toLowerCase() === String(myAgent.username).toLowerCase()));
    return res.json([{
      owner: null,
      agents: [{
        ...safeUser(myAgent),
        clients: myClients.map(safeUser)
      }]
    }]);
  }

  // Strict Owner Privacy Wall: Owner sees ONLY Direct Agents (NEVER Agent's private Clients)
  const ownerRec = users.find(u => (u.role || '').toLowerCase() === 'owner' || u.username === 'Kamran_Bhatti') || { id: 1, username: 'Kamran_Bhatti', role: 'Owner', status: 'active' };
  const agentNodes = agents.map(ag => ({
    ...safeUser(ag)
  }));

  res.json([{
    owner: safeUser(ownerRec),
    agents: agentNodes
  }]);
});

function hasAccountHistory(tableName, targetId, username) {
  const tid = Number(targetId);
  const uName = String(username || '').toLowerCase();

  const smsLog = readDb('sms_log') || [];
  const hasSms = smsLog.some(s => {
    if (!s) return false;
    if (tableName === 'agents' && Number(s.agent_id) === tid) return true;
    if (tableName === 'clients' && (Number(s.client_id) === tid || (s.user && String(s.user).toLowerCase() === uName))) return true;
    return false;
  });
  if (hasSms) return true;

  const numbers = readDb('numbers') || [];
  const hasNum = numbers.some(n => {
    if (!n) return false;
    if (tableName === 'agents' && Number(n.agent_id) === tid) return true;
    if (tableName === 'clients' && (Number(n.client_id) === tid || (n.user && String(n.user).toLowerCase() === uName))) return true;
    return false;
  });
  if (hasNum) return true;

  const transfers = readDb('number_transfers') || [];
  const hasTransfer = transfers.some(t => {
    if (!t) return false;
    return Number(t.to_user_id) === tid || Number(t.from_user_id) === tid;
  });
  if (hasTransfer) return true;

  const payouts = readDb('payout_requests') || [];
  const hasPayout = payouts.some(p => {
    if (!p) return false;
    return Number(p.user_id) === tid || (p.username && String(p.username).toLowerCase() === uName);
  });
  if (hasPayout) return true;

  return false;
}

// Complete cascade cleanup & tombstoning when an Agent, Client, or User account is deleted.
// Ensures deleted account IDs and usernames NEVER leak clients, numbers, balances, requests,
// SMS/CDR logs, payouts, notifications, or chat history onto any newly created account.
function cleanupDeletedAccountData(tableName, target, opts = {}) {
  if (!target || !['agents', 'clients', 'users'].includes(tableName)) return;
  const tid = Number(target.id);
  const uName = String(target.username || '').trim();
  const uLc = uName.toLowerCase();
  const roleKey = tableName === 'agents' ? 'agent' : (tableName === 'clients' ? 'client' : String(target.role || 'user').toLowerCase());
  const tombstoneTag = `__deleted_${roleKey}_${tid}_${Date.now()}`;
  const nowIso = new Date().toISOString();

  // 1. Lock ID counter so this ID can NEVER be reused
  bumpIdCounter(tableName, tid);

  // 2. Revoke active sessions for this account immediately
  try {
    let sessChanged = false;
    for (const [tok, sess] of Array.from(activeSessions.entries())) {
      if (!sess) continue;
      const sRole = String(sess.role || '').toLowerCase();
      if (sRole === roleKey && (Number(sess.id) === tid || (uLc && String(sess.username || '').toLowerCase() === uLc))) {
        activeSessions.delete(tok);
        sessChanged = true;
      }
    }
    if (sessChanged) savePersistedSessions();
  } catch (e) { console.error('[CLEANUP] sessions error:', e.message); }

  // 3. If deleting an Agent, cascade-delete all subordinate Clients under that Agent first
  if (tableName === 'agents') {
    const clients = readDb('clients') || [];
    const subClients = clients.filter(c =>
      c && (Number(c.agent_id) === tid || (uLc && String(c.agent_username || '').toLowerCase() === uLc))
    );
    for (const sub of subClients) {
      cleanupDeletedAccountData('clients', sub, { parentAgentDeleted: true });
    }
    if (subClients.length > 0) {
      const subIdSet = new Set(subClients.map(c => Number(c.id)));
      writeDb('clients', clients.filter(c => !subIdSet.has(Number(c.id))));
    }
  }

  // 4. Release numbers back to upstream pool cleanly
  try {
    const numbers = readDb('numbers') || [];
    let numChanged = false;
    const updatedNumbers = numbers.map(n => {
      if (!n) return n;
      if (tableName === 'agents') {
        const matchAg = Number(n.agent_id) === tid || (uLc && String(n.agent_username || n.agent_name || '').toLowerCase() === uLc);
        if (!matchAg) return n;
        numChanged = true;
        return {
          ...n,
          agent_id: null,
          agent_name: '',
          agent_username: '',
          client_id: null,
          client_name: '',
          client_username: '',
          user: '',
          client_rate: null,
          client_payout: null,
          client_rate_pkr: null,
          client_payterm: null,
          assigned_at: null,
          assigned_date: null,
          client_assigned_at: null,
          allocated_at: null,
          status: 'active',
          updated_at: nowIso
        };
      }
      if (tableName === 'clients') {
        const matchCl = Number(n.client_id) === tid
          || (uLc && (String(n.client_username || n.client_name || '').toLowerCase() === uLc || String(n.user || '').toLowerCase() === uLc));
        if (!matchCl) return n;
        numChanged = true;
        if (opts.parentAgentDeleted) {
          return {
            ...n,
            agent_id: null,
            agent_name: '',
            agent_username: '',
            client_id: null,
            client_name: '',
            client_username: '',
            user: '',
            client_rate: null,
            client_payout: null,
            client_rate_pkr: null,
            client_payterm: null,
            assigned_at: null,
            assigned_date: null,
            client_assigned_at: null,
            allocated_at: null,
            status: 'active',
            updated_at: nowIso
          };
        }
        return {
          ...n,
          client_id: null,
          client_name: '',
          client_username: '',
          user: '',
          client_rate: null,
          client_payout: null,
          client_rate_pkr: null,
          client_payterm: null,
          client_assigned_at: null,
          status: n.agent_id ? 'assigned' : 'active',
          updated_at: nowIso
        };
      }
      return n;
    });
    if (numChanged) writeDb('numbers', updatedNumbers);
  } catch (e) { console.error('[CLEANUP] numbers error:', e.message); }

  // 5. Remove agent_client_rates and bank_accounts for deleted Agent
  if (tableName === 'agents') {
    try {
      const rates = readDb('agent_client_rates') || [];
      const keptRates = rates.filter(r => !(r && (Number(r.agent_id) === tid || (uLc && String(r.agent_username || '').toLowerCase() === uLc))));
      if (keptRates.length !== rates.length) writeDb('agent_client_rates', keptRates);
    } catch (_) {}
    try {
      const banks = readDb('bank_accounts') || [];
      const keptBanks = banks.filter(b => !(b && (Number(b.agent_id) === tid || (uLc && String(b.username || '').toLowerCase() === uLc))));
      if (keptBanks.length !== banks.length) writeDb('bank_accounts', keptBanks);
    } catch (_) {}
  }

  // 6. Remove number_requests, payout_requests, credit_notes, notifications, support_tickets, transfers, history
  const pruneTable = (dbName, matcher) => {
    try {
      const rows = readDb(dbName);
      if (!Array.isArray(rows) || !rows.length) return;
      const kept = rows.filter(row => !matcher(row));
      if (kept.length !== rows.length) writeDb(dbName, kept);
    } catch (_) {}
  };

  if (tableName === 'agents') {
    pruneTable('number_requests', r => r && (
      Number(r.agent_id) === tid ||
      (String(r.requester_role || '').toLowerCase() === 'agent' && (Number(r.requester_id) === tid || (uLc && String(r.requester_username || '').toLowerCase() === uLc))) ||
      (uLc && String(r.agent_username || '').toLowerCase() === uLc)
    ));
    pruneTable('payout_requests', p => p && (
      Number(p.agent_id) === tid ||
      (String(p.role || p.recipient_role || '').toLowerCase() === 'agent' && (Number(p.user_id) === tid || (uLc && String(p.username || p.user || '').toLowerCase() === uLc)))
    ));
    pruneTable('credit_notes', c => c && (
      Number(c.agent_id) === tid ||
      (String(c.role || '').toLowerCase() === 'agent' && (Number(c.user_id) === tid || (uLc && String(c.username || '').toLowerCase() === uLc)))
    ));
    pruneTable('notifications', n => n && String(n.recipient_role || '').toLowerCase() === 'agent' && (
      Number(n.recipient_id) === tid || (uLc && String(n.recipient_username || '').toLowerCase() === uLc)
    ));
    pruneTable('support_tickets', t => t && String(t.role || '').toLowerCase() === 'agent' && (
      Number(t.user_id) === tid || (uLc && String(t.username || '').toLowerCase() === uLc)
    ));
    pruneTable('allocation_history', h => h && (
      Number(h.agent_id) === tid ||
      (String(h.to_role || '').toLowerCase() === 'agent' && (Number(h.to_user_id) === tid || Number(h.target_id) === tid || (uLc && String(h.to_user || '').toLowerCase() === uLc))) ||
      (uLc && String(h.from_user || '').toLowerCase() === uLc)
    ));
    pruneTable('number_transfers', t => t && (
      (String(t.to_role || '').toLowerCase() === 'agent' && (Number(t.to_user_id) === tid || (uLc && String(t.to_username || '').toLowerCase() === uLc))) ||
      (String(t.from_role || '').toLowerCase() === 'agent' && (Number(t.from_user_id) === tid || (uLc && String(t.from_username || '').toLowerCase() === uLc)))
    ));
  } else if (tableName === 'clients') {
    pruneTable('number_requests', r => r && (
      Number(r.client_id) === tid ||
      (String(r.requester_role || '').toLowerCase() === 'client' && (Number(r.requester_id) === tid || (uLc && String(r.requester_username || '').toLowerCase() === uLc))) ||
      (uLc && String(r.client_username || '').toLowerCase() === uLc)
    ));
    pruneTable('payout_requests', p => p && (
      Number(p.client_id) === tid ||
      (String(p.role || p.recipient_role || '').toLowerCase() === 'client' && (Number(p.user_id) === tid || (uLc && String(p.username || p.user || '').toLowerCase() === uLc)))
    ));
    pruneTable('credit_notes', c => c && (
      Number(c.client_id) === tid ||
      (String(c.role || '').toLowerCase() === 'client' && (Number(c.user_id) === tid || (uLc && String(c.username || '').toLowerCase() === uLc)))
    ));
    pruneTable('notifications', n => n && String(n.recipient_role || '').toLowerCase() === 'client' && (
      Number(n.recipient_id) === tid || (uLc && String(n.recipient_username || '').toLowerCase() === uLc)
    ));
    pruneTable('support_tickets', t => t && String(t.role || '').toLowerCase() === 'client' && (
      Number(t.user_id) === tid || (uLc && String(t.username || '').toLowerCase() === uLc)
    ));
    pruneTable('allocation_history', h => h && (
      String(h.to_role || '').toLowerCase() === 'client' && (Number(h.to_user_id) === tid || Number(h.target_id) === tid || (uLc && String(h.to_user || '').toLowerCase() === uLc))
    ));
    pruneTable('number_transfers', t => t && (
      (String(t.to_role || '').toLowerCase() === 'client' && (Number(t.to_user_id) === tid || (uLc && String(t.to_username || '').toLowerCase() === uLc))) ||
      (String(t.from_role || '').toLowerCase() === 'client' && (Number(t.from_user_id) === tid || (uLc && String(t.from_username || '').toLowerCase() === uLc)))
    ));
  }

  // 7. Clean Live Chat conversations/memberships so a recreated account never sees dead chats
  try {
    const memberKey = `${roleKey}:${tid}`;
    const convs = readDb('chat_conversations') || [];
    if (Array.isArray(convs) && convs.length) {
      const removedConvIds = new Set();
      const nextConvs = [];
      let convChanged = false;
      for (const c of convs) {
        if (!c) continue;
        const parts = Array.isArray(c.participants) ? c.participants : [];
        const hasMember = parts.some(p =>
          p && (String(p.key || '') === memberKey || (String(p.role || '').toLowerCase() === roleKey && (Number(p.id) === tid || (uLc && String(p.username || '').toLowerCase() === uLc))))
        );
        if (!hasMember) {
          nextConvs.push(c);
          continue;
        }
        convChanged = true;
        if (c.type === 'group') {
          const keptParts = parts.filter(p =>
            !(p && (String(p.key || '') === memberKey || (String(p.role || '').toLowerCase() === roleKey && (Number(p.id) === tid || (uLc && String(p.username || '').toLowerCase() === uLc)))))
          );
          if (keptParts.length > 0) {
            nextConvs.push({ ...c, participants: keptParts });
          } else {
            removedConvIds.add(Number(c.id));
          }
        } else {
          removedConvIds.add(Number(c.id));
        }
      }
      if (convChanged) {
        writeDb('chat_conversations', nextConvs);
        if (removedConvIds.size > 0) {
          const msgs = readDb('chat_messages') || [];
          const keptMsgs = msgs.filter(m => !removedConvIds.has(Number(m.conversation_id)));
          if (keptMsgs.length !== msgs.length) writeDb('chat_messages', keptMsgs);
        }
      }
    }
  } catch (e) { console.error('[CLEANUP] chat error:', e.message); }

  // 8. Preserve deleted Client real name + unique ID for Agent historical CDR while blocking recreated accounts from inheriting old data;
  //    still tombstone deleted Agents on legacy records cleanly.
  try {
    const sms = readDb('sms_log') || [];
    let smsChanged = false;
    for (let i = 0; i < sms.length; i++) {
      const s = sms[i];
      if (!s) continue;
      if (tableName === 'agents') {
        if (Number(s.agent_id) === tid || (uLc && String(s.agent_username || '').toLowerCase() === uLc)) {
          s.agent_id = null;
          s.agent_username = tombstoneTag;
          s.agent_deleted = true;
          smsChanged = true;
        }
      } else if (tableName === 'clients') {
        const matchesClient = (s.client_id != null && Number(s.client_id) === tid) ||
          ((s.client_id == null || s.client_id === '') && uLc && (String(s.client_username || '').toLowerCase() === uLc || String(s.user || '').toLowerCase() === uLc));
        if (matchesClient) {
          // Keep unique client_id & real username for Agent historical CDR, but mark client_deleted=true
          // so any recreated client (which gets a new unique ID) NEVER sees old rows.
          s.client_id = tid;
          s.client_username = uName || s.client_username || `Client_${tid}`;
          s.client_name = uName || s.client_name || s.client_username;
          s.client_deleted = true;
          s.client_deleted_at = nowIso;
          smsChanged = true;
        }
      }
    }
    if (smsChanged) writeDb('sms_log', sms);
  } catch (e) { console.error('[CLEANUP] sms_log error:', e.message); }

  try {
    const wnStats = readDb('whitenoise_daily_stats') || [];
    let wnChanged = false;
    for (let i = 0; i < wnStats.length; i++) {
      const st = wnStats[i];
      if (!st) continue;
      if (tableName === 'agents' && (Number(st.agent_id) === tid || (uLc && String(st.agent_username || '').toLowerCase() === uLc))) {
        st.agent_id = null;
        st.agent_username = tombstoneTag;
        st.agent_deleted = true;
        wnChanged = true;
      } else if (tableName === 'clients') {
        const matchesClient = (st.client_id != null && Number(st.client_id) === tid) ||
          ((st.client_id == null || st.client_id === '') && uLc && (String(st.client_username || st.client_name || '').toLowerCase() === uLc));
        if (matchesClient) {
          st.client_id = tid;
          st.client_username = uName || st.client_username || st.client_name || `Client_${tid}`;
          st.client_name = st.client_username;
          st.client_deleted = true;
          st.client_deleted_at = nowIso;
          wnChanged = true;
        }
      }
    }
    if (wnChanged) writeDb('whitenoise_daily_stats', wnStats);
  } catch (e) { console.error('[CLEANUP] wn_stats error:', e.message); }

  try {
    const ledger = readDb('number_ownership_ledger') || [];
    let ledChanged = false;
    for (let i = 0; i < ledger.length; i++) {
      const rec = ledger[i];
      if (!rec) continue;
      if (tableName === 'agents' && (Number(rec.agent_id) === tid || (uLc && String(rec.agent_username || '').toLowerCase() === uLc))) {
        rec.agent_id = null;
        rec.agent_username = tombstoneTag;
        if (!rec.ended_at) rec.ended_at = nowIso;
        ledChanged = true;
      } else if (tableName === 'clients' && (Number(rec.client_id) === tid || (uLc && String(rec.client_username || '').toLowerCase() === uLc))) {
        rec.client_deleted = true;
        rec.client_deleted_at = nowIso;
        if (!rec.ended_at) rec.ended_at = nowIso;
        ledChanged = true;
      }
    }
    if (ledChanged) writeDb('number_ownership_ledger', ledger);
  } catch (e) { console.error('[CLEANUP] ownership_ledger error:', e.message); }
}

// ── PAGINATED OBJECT ENDPOINTS { data: [...], total: ... } ───
function registerPaginatedCrud(routePath, tableName) {
  const isAccountTable = ['users', 'agents', 'clients'].includes(tableName);

  app.get(`/api/${routePath}`, requireAuth, (req, res) => {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    // Strict Table-Level Access Guards
    if (['users', 'rate_limits', 'firewall_events'].includes(tableName) && !isOwner) {
      return res.status(403).json({ error: 'Access denied. Owner permissions required.' });
    }

    let data = readDb(tableName);
    if (!Array.isArray(data)) data = [];

    if (tableName === 'audit_logs') {
      if (!isOwner) {
        const u = String(sessionUser.username || '').toLowerCase();
        data = data.filter(item => {
          const act = String(item.actor || item.username || item.user || '').toLowerCase();
          return act === u;
        });
      }
    } else if (tableName === 'login_activity') {
      if (!isOwner) {
        const u = String(sessionUser.username || '').toLowerCase();
        data = data.filter(item => {
          const lu = String(item.username || item.user || '').toLowerCase();
          return (item.user_id != null && Number(item.user_id) === Number(sessionUser.id)) || (u && lu === u);
        });
      }
    }

    // RBAC filtering based on authenticated sessionUser
    if (tableName === 'agents') {
      if (isAgent) {
        data = data.filter(a => Number(a.id) === Number(sessionUser.id));
      } else if (isClient) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    } else if (tableName === 'clients') {
      if (isOwner) {
        return res.status(403).json({ error: 'Access denied. Client accounts are strictly private to their managing Agent.' });
      }
      if (isAgent) {
        data = data.filter(c => Number(c.agent_id) === Number(sessionUser.id));
      } else if (isClient) {
        data = data.filter(c => Number(c.id) === Number(sessionUser.id));
      }
    } else if (tableName === 'numbers') {
      if (isAgent) {
        data = data.filter(n => Number(n.agent_id) === Number(sessionUser.id));
      } else if (isClient) {
        data = data.filter(n => Number(n.client_id) === Number(sessionUser.id) || (n.user && String(n.user).toLowerCase() === String(sessionUser.username).toLowerCase()));
      }
      if (!isOwner && !hasWhitenoiseAccess(sessionUser)) {
        const wnRangesMap = buildRangesLookupMap();
        const wnTags = getWhitenoiseProviderTags();
        data = data.filter(n => !isWhitenoiseRecord(n, wnRangesMap, wnTags));
      }
    } else if (tableName === 'number_transfers') {
      if (isAgent) {
        data = data.filter(t => Number(t.to_user_id) === Number(sessionUser.id) || Number(t.from_user_id) === Number(sessionUser.id));
      } else if (isClient) {
        data = data.filter(t => Number(t.to_user_id) === Number(sessionUser.id));
      }
    } else if (tableName === 'payout_requests') {
      if (isOwner) {
        data = data.filter(p => String(p.role || p.recipient_role || '').toLowerCase() !== 'client');
      } else if (isAgent) {
        const myU = String(sessionUser.username || '').toLowerCase();
        const myClientIds = new Set((readDb('clients') || []).filter(c => Number(c.agent_id) === Number(sessionUser.id)).map(c => Number(c.id)));
        data = data.filter(p => {
          const u = String(p.username || p.user || '').toLowerCase();
          const pRole = String(p.role || p.recipient_role || '').toLowerCase();
          return u === myU ||
            Number(p.user_id) === Number(sessionUser.id) ||
            Number(p.agent_id) === Number(sessionUser.id) ||
            (pRole === 'client' && myClientIds.has(Number(p.client_id || p.user_id)));
        });
      } else if (isClient) {
        const myU = String(sessionUser.username || '').toLowerCase();
        data = data.filter(p => {
          const u = String(p.username || p.user || '').toLowerCase();
          return u === myU || Number(p.client_id) === Number(sessionUser.id) || Number(p.user_id) === Number(sessionUser.id);
        });
      }
    } else if (tableName === 'bank_accounts') {
      if (isAgent) {
        data = data.filter(b => Number(b.agent_id) === Number(sessionUser.id));
      } else if (isClient) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    // Filter by query parameters if applicable
    const { role, agent_id, search, status } = req.query;
    if (role) {
      data = data.filter(d => (d.role || '').toLowerCase() === role.toLowerCase());
    }
    if (tableName === 'numbers') {
      const allClients = (agent_id || req.query.client_id || search) ? (readDb('clients') || []) : [];
      const allAgents = search ? (readDb('agents') || []) : [];
      const allRanges = (req.query.range || search) ? (readDb('sms_ranges') || []) : [];

      if (agent_id && (isOwner || (isAgent && String(sessionUser.id) === String(agent_id)))) {
        const agClientIds = new Set(
          allClients.filter(c => String(c.agent_id) === String(agent_id)).map(c => String(c.id))
        );
        const agClientUsers = new Set(
          allClients.filter(c => String(c.agent_id) === String(agent_id) && c.username).map(c => String(c.username).toLowerCase())
        );
        data = data.filter(d => {
          if (String(d.agent_id) === String(agent_id)) return true;
          if (d.client_id && agClientIds.has(String(d.client_id))) return true;
          const u = String(d.client_username || d.user || '').toLowerCase();
          if (u && agClientUsers.has(u)) return true;
          return false;
        });
      }

      if (req.query.client_id) {
        const targetClId = String(req.query.client_id);
        const targetCl = allClients.find(c => String(c.id) === targetClId);
        const targetClUser = targetCl && targetCl.username ? String(targetCl.username).toLowerCase() : '';
        data = data.filter(d => {
          if (String(d.client_id) === targetClId) return true;
          if (targetClUser) {
            const u = String(d.client_username || d.client_name || d.user || '').toLowerCase();
            if (u === targetClUser) return true;
          }
          return false;
        });
      }

      if (status) {
        const stLower = String(status).trim().toLowerCase();
        if (stLower === 'unassigned' || stLower === 'free' || stLower === 'pool') {
          data = data.filter(d => !d.client_id && !d.agent_id);
        } else if (stLower === 'assigned' || stLower === 'allocated') {
          data = data.filter(d => Boolean(d.client_id || d.agent_id));
        } else {
          data = data.filter(d => (d.status || 'active').toLowerCase() === stLower);
        }
      }

      if (req.query.range) {
        const rawRange = String(req.query.range).trim();
        const rId = Number(rawRange);
        const rLower = rawRange.toLowerCase();
        const targetRange = Number.isFinite(rId) && rawRange !== ''
          ? allRanges.find(r => Number(r.id) === rId)
          : allRanges.find(r => String(r.range_name || r.name || '').trim().toLowerCase() === rLower);
        if (targetRange) {
          const tId = Number(targetRange.id);
          const tCountry = (targetRange.country || '').trim().toLowerCase();
          const tProvider = (targetRange.provider || 'Manual').trim().toLowerCase();
          const tName = (targetRange.range_name || targetRange.name || '').trim().toLowerCase();
          data = data.filter(d => {
            if (d.range_id != null && Number(d.range_id) === tId) return true;
            if (tName) {
              const dn = (d.range_name || d.range_label || '').trim().toLowerCase();
              if (dn && dn === tName) return true;
            }
            if (!d.range_id && tCountry && tProvider) {
              const c = (d.country || '').trim().toLowerCase();
              const p = (d.provider || '').trim().toLowerCase();
              return c === tCountry && p === tProvider;
            }
            return false;
          });
        } else if (Number.isFinite(rId) && rawRange !== '') {
          data = data.filter(d => d.range_id != null && Number(d.range_id) === rId);
        } else {
          data = data.filter(d =>
            String(d.range_name || d.range_label || d.country || '').toLowerCase().includes(rLower)
          );
        }
      }

      if (search) {
        const q = String(search).trim().toLowerCase();
        if (q) {
          const agMap = new Map(allAgents.map(a => [String(a.id), String(a.username || '').toLowerCase()]));
          const clMap = new Map(allClients.map(c => [String(c.id), String(c.username || '').toLowerCase()]));
          const rngMap = new Map(allRanges.map(r => [String(r.id), `${r.range_name || r.name || ''} ${r.prefix || ''} ${r.country || ''}`.toLowerCase()]));
          data = data.filter(d => {
            if (String(d.number || '').toLowerCase().includes(q)) return true;
            if (String(d.prefix || '').toLowerCase().includes(q)) return true;
            if (String(d.range_name || d.range_label || '').toLowerCase().includes(q)) return true;
            if (String(d.country || '').toLowerCase().includes(q)) return true;
            if (isOwner && String(d.provider || '').toLowerCase().includes(q)) return true;
            if (!isOwner && String(d.client_username || d.client_name || d.user || '').toLowerCase().includes(q)) return true;
            if (String(d.agent_username || d.agent_name || '').toLowerCase().includes(q)) return true;
            if (d.agent_id && (agMap.get(String(d.agent_id)) || '').includes(q)) return true;
            if (!isOwner && d.client_id && (clMap.get(String(d.client_id)) || '').includes(q)) return true;
            if (d.range_id && (rngMap.get(String(d.range_id)) || '').includes(q)) return true;
            return false;
          });
        }
      }
    } else {
      if (agent_id && (isOwner || (isAgent && String(sessionUser.id) === String(agent_id)))) {
        data = data.filter(d => String(d.agent_id) === String(agent_id));
      }
      if (status) {
        data = data.filter(d => (d.status || '').toLowerCase() === status.toLowerCase());
      }
      if (search) {
        const q = search.toLowerCase();
        data = data.filter(d => JSON.stringify(d).toLowerCase().includes(q));
      }
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const rawLimit = String(req.query.limit || '').trim().toLowerCase();
    const isAll = rawLimit === 'all' || rawLimit === '0' || rawLimit === '-1';
    const maxLimit = tableName === 'numbers' ? 500000 : 10000;
    const parsedLimit = parseInt(req.query.limit, 10) || 1000;
    const limit = isAll ? data.length : Math.max(1, Math.min(maxLimit, parsedLimit));
    const totalPages = isAll ? 1 : Math.max(1, Math.ceil(data.length / Math.max(1, limit)));
    const safePage = isAll ? 1 : Math.min(page, totalPages);
    const start = isAll ? 0 : (safePage - 1) * limit;

    let slice = data.slice(start, start + limit);
    if (tableName === 'clients') {
      const allAgents = readDb('agents') || [];
      const agMap = new Map(allAgents.map(a => [Number(a.id), a.username]));
      slice = slice.map(item => {
        if (!item) return item;
        const copy = { ...item };
        if (!copy.agent_username && copy.agent_id) copy.agent_username = agMap.get(Number(copy.agent_id)) || `agent_${copy.agent_id}`;
        return isOwner ? safeClientForOwner(copy) : safeUser(copy);
      });
    } else if (tableName === 'payout_requests') {
      slice = slice.map(item => {
        if (!item) return item;
        const ts = item.timestamp || item.created || item.created_at || item.date || new Date().toISOString();
        return { ...item, timestamp: ts, created: ts };
      });
    } else if (tableName === 'numbers' && !isOwner) {
      const wnTags = getWhitenoiseProviderTags();
      slice = slice.map(item => sanitizeNumberForRole(item, false, wnTags));
    } else if (tableName === 'numbers' && isOwner) {
      // Owner visibility stops at the Agent tier: resolve managing Agent name and hide private Client names
      const allAgents = readDb('agents') || [];
      const allClients = readDb('clients') || [];
      const agById = new Map(allAgents.map(a => [Number(a.id), a.username || a.name || `Agent #${a.id}`]));
      const clToAg = new Map(allClients.map(c => [Number(c.id), Number(c.agent_id)]));
      slice = slice.map(item => {
        if (!item) return item;
        const copy = { ...item };
        const effAgId = copy.agent_id != null ? Number(copy.agent_id) : (copy.client_id != null ? clToAg.get(Number(copy.client_id)) : null);
        if (effAgId && agById.has(effAgId)) {
          copy.agent_id = effAgId;
          copy.agent_username = agById.get(effAgId);
          copy.agent_name = agById.get(effAgId);
        }
        copy.client_username = '';
        copy.client_name = '';
        copy.user = '';
        return copy;
      });
    } else if (tableName === 'agents') {
      // Compute live Clients, Numbers, and Today OTP counts for every Agent row
      const allClients = readDb('clients') || [];
      const allNumbers = readDb('numbers') || [];
      const allSms = readDb('sms_log') || [];
      const todayUtc = new Date().toISOString().slice(0, 10);

      const clientCountByAg = new Map();
      const clientIdToAgId = new Map();
      const clientUserToAgId = new Map();
      for (const c of allClients) {
        if (!c || c.agent_id == null) continue;
        const agId = Number(c.agent_id);
        clientCountByAg.set(agId, (clientCountByAg.get(agId) || 0) + 1);
        clientIdToAgId.set(Number(c.id), agId);
        if (c.username) clientUserToAgId.set(String(c.username).trim().toLowerCase(), agId);
      }

      const numCountByAg = new Map();
      const numDigitsToAgId = new Map();
      for (const n of allNumbers) {
        if (!n) continue;
        const agId = n.agent_id != null ? Number(n.agent_id) : (n.client_id != null ? clientIdToAgId.get(Number(n.client_id)) : null);
        if (agId) {
          numCountByAg.set(agId, (numCountByAg.get(agId) || 0) + 1);
          const dg = String(n.number || '').replace(/\D/g, '');
          if (dg) numDigitsToAgId.set(dg, agId);
        }
      }

      const agUserToId = new Map((readDb('agents') || []).map(a => [String(a.username || '').trim().toLowerCase(), Number(a.id)]));
      const todayOtpByAg = new Map();
      for (const s of allSms) {
        if (!s || s.record_type === 'excel_stat') continue;
        const ts = String(s.timestamp || s.date || s.created || '');
        if (!ts.startsWith(todayUtc)) continue;
        let agId = s.agent_id != null ? Number(s.agent_id) : null;
        if (!agId && s.agent_username) agId = agUserToId.get(String(s.agent_username).trim().toLowerCase()) || null;
        if (!agId && s.client_id != null) agId = clientIdToAgId.get(Number(s.client_id)) || null;
        if (!agId && (s.client_username || s.user)) agId = clientUserToAgId.get(String(s.client_username || s.user).trim().toLowerCase()) || null;
        if (!agId && s.number) agId = numDigitsToAgId.get(String(s.number).replace(/\D/g, '')) || null;
        if (agId) {
          todayOtpByAg.set(agId, (todayOtpByAg.get(agId) || 0) + 1);
        }
      }

      slice = slice.map(item => {
        const safe = safeUser(item);
        const agId = Number(safe.id);
        return {
          ...safe,
          clients_count: clientCountByAg.get(agId) || 0,
          numbers_assigned: numCountByAg.get(agId) || 0,
          today_otp: todayOtpByAg.get(agId) || 0
        };
      });
    } else if (isAccountTable) {
      slice = slice.map(item => safeUser(item));
    }

    res.json({
      data: slice,
      total: data.length,
      page: safePage,
      limit: isAll ? data.length : limit,
      total_pages: totalPages
    });
  });

  app.post(`/api/${routePath}`, requireAuth, (req, res) => {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    if (tableName === 'users') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied. Only Owner can create users.' });
      }
      const reqRole = (req.body && req.body.role ? String(req.body.role).trim().toLowerCase() : '');
      if (reqRole === 'client') {
        return res.status(403).json({ error: 'Access denied. Clients can ONLY be created by Agents.' });
      }
      if (reqRole !== 'agent') {
        return res.status(400).json({ error: 'Owner creates Agents only. Secondary Owner accounts are disabled.' });
      }
    }
    if (tableName === 'agents' && !isOwner) {
      return res.status(403).json({ error: 'Access denied. Only Owner can create agents.' });
    }
    if (tableName === 'clients') {
      if (!isAgent) {
        return res.status(403).json({ error: 'Access denied. Clients can ONLY be created by Agents.' });
      }
    }
    if (tableName === 'bank_accounts') {
      if (isClient) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      if (!req.body || !req.body.currency || !req.body.bank_name) {
        return res.status(400).json({ error: 'Currency and bank name required' });
      }
      if (isAgent) {
        req.body.agent_id = sessionUser.id;
      }
    }

    let data = readDb(tableName);
    if (!Array.isArray(data)) data = [];

    // Numbers validation: Owner-only creation, reject with 409 if same number (digits only) exists, 400 if missing
    if (tableName === 'numbers') {
      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied. Only Owner can add numbers.' });
      }
      const rawNumber = req.body ? req.body.number : undefined;
      if (rawNumber === undefined || rawNumber === null || String(rawNumber).trim() === '' || !String(rawNumber).replace(/\D/g, '')) {
        return res.status(400).json({ error: 'Number is required' });
      }
      const digits = String(rawNumber).replace(/\D/g, '');
      const existing = data.find(n => n && String(n.number || '').replace(/\D/g, '') === digits);
      if (existing) {
        const rName = existing.range_name || existing.country || `Range #${existing.range_id || ''}`;
        return res.status(409).json({
          error: 'Number already exists',
          detail: `Number already exists in system${existing.range_name ? ` (assigned to range "${existing.range_name}")` : ''}`,
          existing_range: rName
        });
      }
    }

    // Duplicate username check across all account types
    if (req.body && req.body.username) {
      if (isUsernameTaken(req.body.username, null, tableName)) {
        return res.status(400).json({ error: 'This username already exists', detail: 'This username already exists. Please choose a different username.' });
      }
    }

    // Enforce hard limit of maximum 3 Agents in the system
    if (tableName === 'agents') {
      if (data.length >= 3) {
        return res.status(400).json({ error: 'Maximum limit of 3 Agents reached. No more agents can be created.' });
      }
    }

    // Owner protection: No new Owner can be created + enforce max 3 Agents when creating via /api/users
    if (tableName === 'users') {
      const reqRole = (req.body && req.body.role ? String(req.body.role).trim().toLowerCase() : '');
      if (reqRole === 'owner' || reqRole === 'admin') {
        return res.status(400).json({ error: 'New Owner cannot be created. Kamran_Bhatti is the fixed Owner of the project.' });
      }
      if (reqRole === 'agent') {
        const existingAgents = readDb('agents') || [];
        if (existingAgents.length >= 3) {
          return res.status(400).json({ error: 'Maximum limit of 3 Agents reached. No more agents can be created.' });
        }
      }
    }

    const nowIso = new Date().toISOString();
    const item = { id: nextId(data, tableName), ...req.body, created: nowIso, timestamp: nowIso, created_at: nowIso };

    // Strictly enforce role and zero initial balance on creation
    if (tableName === 'agents') {
      item.role = 'Agent';
      item.balance = 0;
      item.whitenoise_access = Boolean(req.body && req.body.whitenoise_access);
      item.app_links_access = Boolean(req.body && req.body.app_links_access);
      delete item.manager_id;
      delete item.manager_username;
    } else if (tableName === 'clients') {
      const agentHasWn = hasWhitenoiseAccess(sessionUser);
      const agentHasAppLinks = hasAppLinksAccess(sessionUser);
      if (req.body && req.body.whitenoise_access === true && !agentHasWn) {
        return res.status(403).json({ error: 'Forbidden. CDR 2 / Monthly Route access is not enabled for your account.' });
      }
      if (req.body && req.body.app_links_access === true && !agentHasAppLinks) {
        return res.status(403).json({ error: 'Forbidden. Apps Links access is not enabled for your account.' });
      }
      item.role = 'Client';
      item.balance = 0;
      item.agent_id = sessionUser.id;
      item.agent_username = sessionUser.username;
      item.whitenoise_access = agentHasWn ? Boolean(req.body && req.body.whitenoise_access) : false;
      item.app_links_access = agentHasAppLinks ? Boolean(req.body && req.body.app_links_access) : false;
      delete item.manager_id;
      delete item.manager_username;
    } else if (tableName === 'payout_requests') {
      item.amount = Math.round(Math.max(0, Number(item.amount) || 0) * 100) / 100;
      if (!Number.isFinite(item.amount) || item.amount <= 0) {
        return res.status(400).json({ error: 'Valid payout amount is required' });
      }

      const rawPType = String(req.body?.payout_type || item.payout_type || 'weekly').trim().toLowerCase();
      const payoutType = (rawPType === 'monthly' || rawPType === 'whitenoise') ? 'monthly' : 'weekly';
      item.payout_type = payoutType;
      item.payterm = payoutType === 'monthly' ? 'Monthly' : 'Weekly';
      item.schedule = payoutType === 'monthly' ? 'Monthly (30/5) {W}' : 'Weekly (7/3)';

      const fx = getUsdToPkrRate();
      const settings = readDb('settings') || {};
      const reqCurrency = (isClient && (!item.currency || String(item.currency).trim().toUpperCase() === 'PKR'))
        ? 'PKR'
        : String(item.currency || 'USD').trim().toUpperCase();

      if (reqCurrency === 'PKR') {
        const minPayoutPkr = getMinPayoutPkr();
        if (!isOwner && minPayoutPkr > 0 && item.amount < minPayoutPkr) {
          return res.status(400).json({ error: `Payment low. Minimum payout is Rs. ${cleanMoneyStr(minPayoutPkr, 4)} PKR.` });
        }
      } else {
        const minPayout = Number(settings.min_payout || 0);
        if (!isOwner && minPayout > 0 && item.amount < minPayout) {
          return res.status(400).json({ error: `Payment low. Minimum payout is $${cleanMoneyStr(minPayout, 2)}.` });
        }
      }

      if (!isOwner) {
        delete item.paid_at;
        delete item.paid_by_username;
        delete item.paid_by_role;
        item.username = sessionUser.username;
        item.user = sessionUser.username;
        item.role = sessionUser.role;
        item.recipient_role = sessionUser.role;
        item.user_id = sessionUser.id;
        item.status = 'pending';
        delete item.manager_id;
        delete item.agent_id;
        delete item.client_id;
      } else {
        item.username = item.username || item.user || sessionUser.username;
        item.user = item.user || item.username;
        item.role = item.role || item.recipient_role || sessionUser.role;
        item.user_id = item.user_id || sessionUser.id;
        item.status = item.status || 'pending';
      }
      item.currency = reqCurrency;
      item.fx_usd_to_pkr = fx;
      item.amount_usd = reqCurrency === 'PKR' ? round6(item.amount / fx) : item.amount;

      if (isAgent) {
        item.agent_id = sessionUser.id;
        item.agent_username = sessionUser.username;
      } else if (isClient) {
        const cls = readDb('clients') || [];
        const c = cls.find(x => Number(x.id) === Number(sessionUser.id) || String(x.username).toLowerCase() === String(sessionUser.username).toLowerCase());
        item.client_id = sessionUser.id;
        item.client_username = sessionUser.username;
        if (c?.agent_id) item.agent_id = c.agent_id;
      }

      // Strictly separated Weekly (API) vs Monthly (30/5 {W}) balance validation
      if (!isOwner) {
        const splitWallets = computeUserSplitWallets(sessionUser, data);
        if (payoutType === 'monthly') {
          const mw = splitWallets.monthly_wallet;
          const canUseMonthly = hasWhitenoiseAccess(sessionUser) || mw.earned_usd > 0 || mw.earned_pkr > 0;
          if (!canUseMonthly) {
            return res.status(403).json({ error: 'Monthly (30/5) {W} payout is not enabled for your account.' });
          }
          const availMonthly = reqCurrency === 'PKR' ? mw.available_pkr : mw.available_usd;
          const heldMonthly = reqCurrency === 'PKR' ? mw.held_pkr : mw.held_usd;
          if (availMonthly <= 0) {
            if (heldMonthly > 0) {
              const heldStr = reqCurrency === 'PKR' ? `Rs. ${cleanMoneyStr(heldMonthly, 2)} PKR` : `$${cleanMoneyStr(heldMonthly, 2)}`;
              return res.status(400).json({
                error: `Monthly (30/5) {W} cycle is not completed yet. Your held balance (${heldStr}) unlocks on ${mw.clear_date || 'the monthly clear date'}.`
              });
            }
            return res.status(400).json({ error: 'No matured Monthly (30/5) {W} balance available for payout.' });
          }
          if (item.amount > availMonthly + 1e-6) {
            const availStr = reqCurrency === 'PKR' ? `Rs. ${cleanMoneyStr(availMonthly, 4)} PKR` : `$${cleanMoneyStr(availMonthly, 2)}`;
            return res.status(400).json({ error: `Insufficient matured Monthly (30/5) {W} balance. Available now: ${availStr}` });
          }
        } else {
          const ww = splitWallets.weekly_wallet;
          const availWeekly = reqCurrency === 'PKR' ? ww.available_pkr : ww.available_usd;
          if (item.amount > availWeekly + 1e-6) {
            if (reqCurrency === 'PKR') {
              return res.status(400).json({ error: `Insufficient Weekly (API) PKR balance. Available balance: Rs. ${cleanMoneyStr(availWeekly, 4)} PKR` });
            }
            return res.status(400).json({ error: `Insufficient Weekly (API) balance. Available balance: $${cleanMoneyStr(availWeekly, 2)}` });
          }
        }
      }

      if (isClient && item.agent_id && payoutType === 'weekly') {
        const agTarget = getAgentClientWeeklyPkrStats(item.agent_id);
        if (agTarget && agTarget.weekly_pkr_enforce_mode === 'block' && agTarget.weekly_pkr_target > 0) {
          const requestedPkr = reqCurrency === 'PKR' ? item.amount : round2(item.amount * fx);
          const weekClientPayoutsPkr = data.reduce((acc, p) => {
            if (!p || String(p.role || p.recipient_role || '').toLowerCase() !== 'client') return acc;
            if (Number(p.agent_id) !== Number(item.agent_id)) return acc;
            if (String(p.status || '').toLowerCase() === 'rejected') return acc;
            if (getPayoutRequestType(p) === 'monthly') return acc;
            const tsStr = String(p.timestamp || p.created || '').slice(0, 10);
            if (tsStr && tsStr < agTarget.week_start) return acc;
            const pAmt = String(p.currency || 'PKR').toUpperCase() === 'PKR'
              ? Number(p.amount || 0)
              : Number(p.amount || 0) * (Number(p.fx_usd_to_pkr) || fx);
            return acc + pAmt;
          }, 0);
          if (agTarget.weekly_pkr_used >= agTarget.weekly_pkr_target || (weekClientPayoutsPkr + requestedPkr) > agTarget.weekly_pkr_target) {
            return res.status(400).json({
              error: `Weekly PKR budget cap reached (Rs. ${cleanMoneyStr(agTarget.weekly_pkr_target, 4)} PKR). Client payout requests are blocked until Monday UTC.`
            });
          }
        }
      }

      item.timestamp = item.timestamp || item.created || new Date().toISOString();
    }

    // Hash password if supplied
    if (item.password) {
      item.password = hashPassword(item.password);
    }

    data.unshift(item);
    writeDb(tableName, data);
    logAudit(sessionUser.username || 'Owner', `Create ${tableName}`, `Created item #${item.id}`, tableName);

    // Live real-time notifications for new payout / payment requests
    if (tableName === 'payout_requests') {
      const reqCur = String(item.currency || 'USD').toUpperCase();
      const dispAmt = reqCur === 'PKR' ? `Rs. ${cleanMoneyStr(Number(item.amount || 0), 2)} PKR` : `$${cleanMoneyStr(Number(item.amount || 0), 2)}`;
      const methodLabel = item.method || item.payment_method || item.bank_name || 'Direct Transfer';
      const cycleTag = item.payout_type === 'monthly' ? 'Monthly {W}' : 'Weekly (API)';
      if (isClient && item.agent_id) {
        sendInstantNotification({
          recipient_role: 'agent',
          recipient_id: Number(item.agent_id),
          title: `New Client ${cycleTag} Payment Request (${dispAmt})`,
          message: `Client ${sessionUser.username} submitted ${cycleTag} payment request #${item.id} for ${dispAmt} via ${methodLabel}.`,
          type: 'payout',
          category: 'payments',
          action_page: 'client-payment-requests',
          status: 'pending',
          actor_role: 'Client',
          actor_name: sessionUser.username,
          metadata: { payout_id: item.id, payout_type: item.payout_type, client_id: sessionUser.id, amount: item.amount, currency: reqCur }
        });
      } else if (isAgent) {
        sendInstantNotification({
          recipient_role: 'owner',
          title: `New Agent ${cycleTag} Payout Request (${dispAmt})`,
          message: `Agent ${sessionUser.username} submitted ${cycleTag} payout request #${item.id} for ${dispAmt} via ${methodLabel}.`,
          type: 'payout',
          category: 'payments',
          action_page: 'payout-requests',
          status: 'pending',
          actor_role: 'Agent',
          actor_name: sessionUser.username,
          metadata: { payout_id: item.id, payout_type: item.payout_type, agent_id: sessionUser.id, amount: item.amount, currency: reqCur }
        });
      }
    }

    const safeItem = isAccountTable ? safeUser(item) : { ...item };
    res.json(safeItem);
  });

  app.get(`/api/${routePath}/:id`, requireAuth, (req, res, next) => {
    const rawId = req.params.id;
    if (['sms-ranges', 'rate-card', 'blacklist', 'bulk', 'download', 'stats', 'earnings', 'adjust-balance', 'allocation-policy', 'no-rate-ranges', 'allocation-history', 'range-return-batches', 'blocked'].includes(rawId)) {
      return next();
    }
    let data = readDb(tableName);
    if (!Array.isArray(data)) return res.status(404).json({ error: 'Item not found' });
    const id = Number(rawId);
    const item = data.find(x => x.id === id || String(x.id) === String(rawId));
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    // Verify item ownership
    if (!isOwner) {
      if (tableName === 'users') {
        const targetUserId = Number(item.id);
        const myUserId = Number(sessionUser.id);
        const myUsername = String(sessionUser.username || '').toLowerCase();
        const targetUsername = String(item.username || '').toLowerCase();
        if (targetUserId !== myUserId && targetUsername !== myUsername) {
          return res.status(403).json({ error: 'Access denied.' });
        }
      }
      if (tableName === 'bank_accounts') {
        if (isAgent && Number(item.agent_id) !== Number(sessionUser.id)) {
          return res.status(403).json({ error: 'Forbidden. You cannot view this bank account.' });
        }
        if (isClient) return res.status(403).json({ error: 'Access denied.' });
      }
      if (tableName === 'agents') {
        if (isAgent && Number(item.id) !== Number(sessionUser.id) && String(item.username || '').toLowerCase() !== String(sessionUser.username).toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden. You can only view your own agent profile.' });
        }
        if (isClient) return res.status(403).json({ error: 'Access denied.' });
      }
      if (tableName === 'clients') {
        if (isAgent && Number(item.agent_id) !== Number(sessionUser.id) && String(item.agent_username || '').toLowerCase() !== String(sessionUser.username).toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden. You cannot view this client.' });
        }
        if (isClient && Number(item.id) !== Number(sessionUser.id) && String(item.username || '').toLowerCase() !== String(sessionUser.username).toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden. You can only view your own profile.' });
        }
      }
      if (tableName === 'numbers') {
        if (isAgent && Number(item.agent_id) !== Number(sessionUser.id)) {
          return res.status(403).json({ error: 'Forbidden. You cannot access this number.' });
        }
        if (isClient && Number(item.client_id) !== Number(sessionUser.id) && (item.user && item.user.toLowerCase() !== sessionUser.username.toLowerCase())) {
          return res.status(403).json({ error: 'Forbidden. You cannot access this number.' });
        }
        if (!hasWhitenoiseAccess(sessionUser) && isWhitenoiseRecord(item, buildRangesLookupMap())) {
          return res.status(403).json({ error: 'Forbidden. CDR 2 access is not enabled for your account.' });
        }
      }
    } else if (tableName === 'clients') {
      return res.status(403).json({ error: 'Access denied. Client accounts are strictly private to their managing Agent.' });
    } else if (tableName === 'payout_requests') {
      if (String(item.role || item.recipient_role || '').toLowerCase() === 'client') {
        return res.status(403).json({ error: 'Forbidden. Client PKR payouts are managed exclusively by their Agent.' });
      }
    }

    let safeItem = isAccountTable ? safeUser(item) : { ...item };
    if (tableName === 'numbers' && !isOwner) {
      safeItem = sanitizeNumberForRole(safeItem, false);
    }
    res.json(safeItem);
  });

  app.patch(`/api/${routePath}/:id`, requireAuth, (req, res) => {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    if (tableName === 'clients' && isOwner) {
      return res.status(403).json({ error: 'Access denied. Client accounts are strictly private and managed exclusively by their Agent.' });
    }

    // Strict non-Owner protection: check forbidden fields
    const FORBIDDEN_NON_OWNER_PATCH_FIELDS = [
      'payout', 'client_payout', 'agent_rate', 'client_rate',
      'company_rate', 'company_cost', 'cost', 'carrier_rate', 'buy_rate',
      'sell_rate', 'commission_rate', 'commission_percent', 'payterm',
      'client_payterm', 'balance', 'role', 'agent_id',
      'client_id', 'permissions', 'is_owner', 'two_fa', 'two_fa_secret',
      'two_fa_backup_codes', 'pending_2fa_secret', 'password_hash'
    ];
    if (!isOwner && req.body && typeof req.body === 'object') {
      const hasForbiddenField = FORBIDDEN_NON_OWNER_PATCH_FIELDS.some(k => (k in req.body) || req.body[k] !== undefined);
      if (hasForbiddenField) {
        return res.status(403).json({ error: 'Forbidden. Non-owner cannot modify financial, rate, security, role, or hierarchy fields.' });
      }
      if (sRole === 'client' && tableName === 'clients' && req.body.status !== undefined) {
        return res.status(403).json({ error: 'Forbidden. Clients cannot change their own account status.' });
      }
      const touchesAllocPolicy = ['alloc_mode', 'alloc_daily_limit', 'alloc_total_limit'].some(k => req.body[k] !== undefined);
      if (touchesAllocPolicy) {
        const cfg = readDb('settings') || {};
        const allowAgt = cfg.allow_agent_alloc_config !== false;
        const canConfigDownline = (sRole === 'agent' && tableName === 'clients' && allowAgt);
        if (!canConfigDownline) {
          return res.status(403).json({ error: 'Forbidden. Your account does not have authority to change number allocation mode or limits.' });
        }
      }
    }

    if (req.body && typeof req.body === 'object' && ['users', 'agents', 'clients'].includes(tableName)) {
      if (req.body.alloc_mode !== undefined && req.body.alloc_mode !== '' && req.body.alloc_mode !== null) {
        const cleanMode = String(req.body.alloc_mode).trim().toLowerCase();
        if (cleanMode !== 'request' && cleanMode !== 'self_allocate') {
          return res.status(400).json({ error: 'alloc_mode must be either "request" or "self_allocate".' });
        }
        req.body.alloc_mode = cleanMode;
      }
      if (req.body.alloc_daily_limit !== undefined && req.body.alloc_daily_limit !== '' && req.body.alloc_daily_limit !== null) {
        const dl = Number(req.body.alloc_daily_limit);
        if (isNaN(dl) || dl < 0) return res.status(400).json({ error: 'alloc_daily_limit must be 0 or a positive integer.' });
        req.body.alloc_daily_limit = Math.floor(dl);
      }
      if (req.body.alloc_total_limit !== undefined && req.body.alloc_total_limit !== '' && req.body.alloc_total_limit !== null) {
        const tl = Number(req.body.alloc_total_limit);
        if (isNaN(tl) || tl < 0) return res.status(400).json({ error: 'alloc_total_limit must be 0 or a positive integer.' });
        req.body.alloc_total_limit = Math.floor(tl);
      }
    }

    let data = readDb(tableName);
    if (!Array.isArray(data)) return res.json({});
    const id = Number(req.params.id);
    const idx = data.findIndex(x => x.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    const isAgent = sRole === 'agent';
    const existing = data[idx];

    // Ownership check on modification
    if (!isOwner) {
      if (tableName === 'users') {
        return res.status(403).json({ error: 'Access denied. Only Owner can modify users.' });
      }
      if (tableName === 'agents') {
        return res.status(403).json({ error: 'Forbidden. Only Owner can modify agent accounts.' });
      }
      if (tableName === 'clients') {
        const isClient = sRole === 'client';
        const canEdit = (isAgent && Number(existing.agent_id) === Number(sessionUser.id)) ||
                        (isClient && Number(existing.id) === Number(sessionUser.id));
        if (!canEdit) {
          return res.status(403).json({ error: 'Forbidden. You can only modify your own clients.' });
        }
        if (req.body && ('whitenoise_access' in req.body)) {
          if (!isAgent || !hasWhitenoiseAccess(sessionUser)) {
            return res.status(403).json({ error: 'Forbidden. You do not have permission to change Whitenoise access.' });
          }
          req.body.whitenoise_access = Boolean(req.body.whitenoise_access);
        }
        if (req.body && ('app_links_access' in req.body)) {
          if (!isAgent || !hasAppLinksAccess(sessionUser)) {
            return res.status(403).json({ error: 'Forbidden. You do not have permission to change Apps Links access.' });
          }
          req.body.app_links_access = Boolean(req.body.app_links_access);
        }
      } else if (req.body && ('whitenoise_access' in req.body || 'app_links_access' in req.body)) {
        return res.status(403).json({ error: 'Forbidden. Only Owner/authorized Agent may manage feature access.' });
      }
      if (tableName === 'numbers') {
        const canEdit = (isAgent && Number(existing.agent_id) === Number(sessionUser.id));
        if (!canEdit) {
          return res.status(403).json({ error: 'Forbidden. You cannot modify this number.' });
        }
      }
      if (tableName === 'payout_requests') {
        const reqTargetRole = String(existing.role || existing.recipient_role || '').trim().toLowerCase();
        const isSelfRequest = (reqTargetRole === sRole && Number(existing.user_id) === Number(sessionUser.id)) ||
          String(existing.username || existing.user || '').trim().toLowerCase() === String(sessionUser.username || '').trim().toLowerCase() ||
          reqTargetRole === 'agent';
        const clientRec = reqTargetRole === 'client'
          ? (readDb('clients') || []).find(c => Number(c.id) === Number(existing.client_id || existing.user_id))
          : null;
        const ownsClient = (existing.agent_id != null && Number(existing.agent_id) === Number(sessionUser.id))
          || (clientRec && Number(clientRec.agent_id) === Number(sessionUser.id));
        if (!isAgent || !ownsClient || isSelfRequest) {
          return res.status(403).json({ error: 'Forbidden. Agents cannot approve/manage their own payout requests and can only manage downline client payouts.' });
        }
      }
    } else if (tableName === 'clients') {
      return res.status(403).json({ error: 'Access denied. Client accounts are strictly private and managed exclusively by their Agent.' });
    } else if (tableName === 'payout_requests') {
      const reqTargetRole = String(existing.role || existing.recipient_role || '').trim().toLowerCase();
      if (reqTargetRole === 'client') {
        return res.status(403).json({ error: 'Forbidden. Client PKR payouts are managed exclusively by their Agent.' });
      }
    }

    // Strict 2FA Guard on Agent Password / 2FA changes — even Owner CANNOT bypass Agent's live 2FA
    if (tableName === 'agents' && existing && existing.two_fa && existing.two_fa_secret) {
      const wantsPasswordChange = req.body && req.body.password !== undefined && String(req.body.password).trim() !== '';
      const wants2faChange = req.body && (
        ('two_fa' in req.body && Boolean(req.body.two_fa) !== Boolean(existing.two_fa)) ||
        ('two_fa_secret' in req.body) ||
        ('two_fa_backup_codes' in req.body)
      );
      if (wantsPasswordChange || wants2faChange) {
        const providedOtp = String(
          req.body.two_fa_code || req.body.agent_totp_code || req.body.otp_code || ''
        ).trim().replace(/\s+/g, '');
        const otpValid = providedOtp.length === 6 && verifyTotp(providedOtp, existing.two_fa_secret, 1);
        if (!otpValid) {
          return res.status(403).json({
            error: 'Agent 2FA verification required. Enter the live 6-digit code from this Agent\'s Authenticator app to change password or modify 2FA.',
            require_agent_2fa: true
          });
        }
      }
    }

    // Duplicate username check when updating username
    if (req.body && req.body.username) {
      if (isUsernameTaken(req.body.username, id, tableName)) {
        return res.status(400).json({ error: 'This username already exists', detail: 'This username already exists. Please choose a different username.' });
      }
    }

    // Owner protection: Fixed Kamran_Bhatti, cannot promote others to Owner
    if (tableName === 'users') {
      if (existing && (existing.username === 'Kamran_Bhatti' || existing.id === 1 || existing.role === 'Owner')) {
        if (req.body.username && req.body.username !== 'Kamran_Bhatti') {
          return res.status(400).json({ error: 'Owner username is fixed (Kamran_Bhatti) and cannot be changed.' });
        }
        if (req.body.role && req.body.role !== 'Owner') {
          return res.status(400).json({ error: 'Owner role cannot be changed.' });
        }
        if (req.body.status && req.body.status !== 'active') {
          return res.status(400).json({ error: 'Owner account cannot be suspended.' });
        }
      } else {
        const reqRole = (req.body && req.body.role ? String(req.body.role).trim().toLowerCase() : '');
        if (reqRole === 'owner' || reqRole === 'admin') {
          return res.status(400).json({ error: 'Cannot promote user to Owner. Kamran_Bhatti is the fixed Owner.' });
        }
      }
    }

    if (tableName === 'numbers') {
      // Protection: Non-owner cannot modify payout, rates, or chain on numbers
      const rateOrChainKeys = ['payout', 'client_payout', 'agent_rate', 'client_rate', 'company_rate', 'cost', 'company_cost', 'carrier_rate', 'agent_id', 'client_id', 'status'];
      if (!isOwner && rateOrChainKeys.some(k => req.body[k] !== undefined)) {
        return res.status(403).json({ error: 'Forbidden. Rates and allocation chain cannot be modified via PATCH.' });
      }
    }

    const updates = { ...req.body };
    delete updates.two_fa_code;
    delete updates.agent_totp_code;
    delete updates.otp_code;
    // Block manual balance overrides on Agents — Agent balances are strictly auto-earned from SMS traffic
    const isTargetAgent = tableName === 'agents' || (tableName === 'users' && String(existing?.role || '').toLowerCase() === 'agent');
    if (isTargetAgent && ('balance' in updates || 'balance_pkr' in updates)) {
      const requestedBal = Number(updates.balance);
      const currentBal = Number(existing?.balance || 0);
      if ('balance' in updates && !isNaN(requestedBal) && Math.abs(requestedBal - currentBal) > 0.000001) {
        return res.status(403).json({ error: 'Agent balances are earned automatically from SMS traffic and cannot be manually modified.' });
      }
      delete updates.balance;
      delete updates.balance_pkr;
    }
    if (['agents', 'clients'].includes(tableName) && ('whitenoise_access' in updates)) {
      updates.whitenoise_access = Boolean(updates.whitenoise_access);
    }
    if (['agents', 'clients'].includes(tableName) && ('app_links_access' in updates)) {
      updates.app_links_access = Boolean(updates.app_links_access);
    }
    if (updates.password) {
      if (['users', 'agents', 'clients'].includes(tableName)) {
        const cleanPass = String(updates.password).trim();
        if (cleanPass.length < 6) {
          return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }
        updates.password = hashPassword(cleanPass);
      } else {
        updates.password = hashPassword(updates.password);
      }
    }

    if (tableName === 'payout_requests') {
      const prevStatus = String(existing?.status || '').trim().toLowerCase();
      const nextStatus = updates.status !== undefined ? String(updates.status).trim().toLowerCase() : '';
      if (nextStatus === 'rejected') {
        return res.status(400).json({ error: 'Payout requests cannot be rejected. Keep as Pending or mark as Paid.' });
      }
      if ((prevStatus === 'paid' || prevStatus === 'completed') && (nextStatus === 'paid' || nextStatus === 'completed' || updates.amount !== undefined || updates.status !== undefined)) {
        return res.status(409).json({ error: `Payout request #${existing.id} is already ${prevStatus} and cannot be paid or modified again.` });
      }
      if (nextStatus === 'pending') {
        updates.status = 'pending';
        updates.pending_marked_at = new Date().toISOString();
        updates.pending_marked_by = sessionUser.username;
      }
    }

    if (tableName === 'payout_requests' && (updates.status === 'paid' || updates.status === 'completed')) {
      const prevStatus = existing ? existing.status : null;
      if (prevStatus !== 'paid' && prevStatus !== 'completed') {
        const amt = Number(existing.amount || updates.amount || 0);
        const existingCur = String(existing.currency || 'USD').toUpperCase();
        const fx = Number(existing.fx_usd_to_pkr) || getUsdToPkrRate();
        const usdAmt = existingCur === 'PKR' ? (existing.amount_usd != null ? Number(existing.amount_usd) : round6(amt / fx)) : amt;
        const pkrAmt = existingCur === 'PKR' ? round2(amt) : round2(amt * fx);
        const targetUsername = String(existing.username || existing.user || '').trim().toLowerCase();
        const targetRole = String(existing.role || existing.recipient_role || '').trim().toLowerCase();
        let targetTable = null;
        if (targetRole === 'agent') targetTable = 'agents';
        else if (targetRole === 'client') targetTable = 'clients';

        if (targetTable) {
          const records = readDb(targetTable) || [];
          const uIdx = records.findIndex(r => r && targetUsername && String(r.username).trim().toLowerCase() === targetUsername);
          if (uIdx !== -1) {
            const currentBal = Number(records[uIdx].balance || 0);
            const currentBalPkr = records[uIdx].balance_pkr != null ? Number(records[uIdx].balance_pkr) : round2(currentBal * fx);
            if (existingCur === 'PKR') {
              if (currentBalPkr + 1e-6 < pkrAmt) {
                return res.status(409).json({ error: `Insufficient user PKR balance (Rs. ${cleanMoneyStr(currentBalPkr, 4)}) for payout of Rs. ${cleanMoneyStr(pkrAmt, 4)}` });
              }
              records[uIdx].balance_pkr = Math.max(0, round2(currentBalPkr - pkrAmt));
              records[uIdx].balance = Math.max(0, Math.round((currentBal - usdAmt) * 1000000) / 1000000);
            } else {
              if (currentBal + 1e-9 < amt) {
                return res.status(409).json({ error: `Insufficient user balance ($${cleanMoneyStr(currentBal, 2)}) for payout of $${cleanMoneyStr(amt, 2)}` });
              }
              records[uIdx].balance = Math.max(0, Math.round((currentBal - amt) * 100) / 100);
              if (targetTable === 'clients' || records[uIdx].balance_pkr != null) {
                records[uIdx].balance_pkr = Math.max(0, round2(currentBalPkr - pkrAmt));
              }
            }
            writeDb(targetTable, records);
          } else {
            return res.status(409).json({ error: 'Target user not found for payout deduction' });
          }
        }
        updates.paid_at = new Date().toISOString();
        updates.paid_by_username = sessionUser.username;
        updates.paid_by_role = sessionUser.role;

        // Automatically record into credit_notes
        try {
          const creditNotes = readDb('credit_notes') || [];
          creditNotes.unshift({
            id: nextId(creditNotes, 'credit_notes'),
            date: new Date().toISOString(),
            created: new Date().toISOString(),
            agent_id: existing.agent_id || (targetRole === 'agent' ? existing.user_id : null),
            client_id: existing.client_id || (targetRole === 'client' ? existing.user_id : null),
            user_id: existing.user_id || null,
            username: existing.username || existing.user,
            role: existing.role || targetRole,
            payout_request_id: existing.id,
            amount: amt,
            amount_usd: usdAmt,
            currency: existingCur,
            fx_usd_to_pkr: fx,
            term: existing.payterm || existing.term || 'Weekly',
            reason: `Payout #${existing.id} (${existing.method || 'Direct'})`,
            status: 'settled'
          });
          writeDb('credit_notes', creditNotes);
        } catch (cnErr) {
          console.error('Failed to log credit note:', cnErr);
        }

        const displayAmt = existingCur === 'PKR' ? `Rs. ${cleanMoneyStr(pkrAmt, 4)} PKR` : `$${cleanMoneyStr(amt, 2)}`;
        // Instant notification to requester
        sendInstantNotification({
          recipient_role: targetRole,
          recipient_id: existing.user_id || null,
          recipient_username: existing.username || existing.user,
          title: `Payout Approved & Paid (${displayAmt})`,
          message: `Your payout request #${existing.id} for ${displayAmt} has been approved and paid by ${sessionUser.username}.`,
          type: 'payout',
          category: 'payments',
          action_page: targetRole === 'client' ? 'payout-requests' : 'payment-requests',
          status: 'paid',
          actor_role: sessionUser.role,
          actor_name: sessionUser.username,
          metadata: { payout_id: existing.id, amount: amt, currency: existingCur }
        });
        if (targetRole === 'agent') {
          sendInstantNotification({
            recipient_role: 'owner',
            title: `Agent Payout #${existing.id} Paid (${displayAmt})`,
            message: `Payout request #${existing.id} for Agent ${existing.username || existing.user} (${displayAmt}) has been marked paid.`,
            type: 'payout',
            category: 'payments',
            action_page: 'payout-requests',
            status: 'paid',
            actor_role: sessionUser.role,
            actor_name: sessionUser.username,
            metadata: { payout_id: existing.id }
          });
        }
      }
    } else if (tableName === 'payout_requests' && updates.status === 'pending') {
      const targetRole = String(existing?.role || existing?.recipient_role || '').trim().toLowerCase();
      const existingCur = String(existing?.currency || 'USD').toUpperCase();
      const dispAmt = existingCur === 'PKR' ? `Rs. ${cleanMoneyStr(Number(existing?.amount || 0), 2)} PKR` : `$${cleanMoneyStr(Number(existing?.amount || 0), 2)}`;
      const pendingNote = updates.notes || updates.reason || '';
      sendInstantNotification({
        recipient_role: targetRole,
        recipient_id: existing?.user_id || null,
        recipient_username: existing?.username || existing?.user,
        title: `Payout Request #${existing?.id} Marked Pending`,
        message: `Your payout request #${existing?.id} for ${dispAmt} is in Pending / Processing queue (${sessionUser.username})${pendingNote ? ` — ${pendingNote}` : ''}.`,
        type: 'payout',
        category: 'payments',
        action_page: targetRole === 'client' ? 'payout-requests' : 'payment-requests',
        status: 'pending',
        actor_role: sessionUser.role,
        actor_name: sessionUser.username,
        metadata: { payout_id: existing?.id, amount: existing?.amount, currency: existingCur }
      });
    }

    data[idx] = { ...data[idx], ...updates };
    writeDb(tableName, data);
    logAudit(sessionUser.username || 'Owner', `Update ${tableName}`, `Updated item #${id}`, tableName);

    const safeItem = (tableName === 'clients' && isOwner)
      ? safeClientForOwner(data[idx])
      : (isAccountTable ? safeUser(data[idx]) : { ...data[idx] });
    res.json(safeItem);
  });

  app.delete(`/api/${routePath}/:id`, requireAuth, (req, res) => {
    let data = readDb(tableName);
    if (!Array.isArray(data)) return res.json({ success: true });
    const rawId = String(req.params.id);
    const numId = Number(req.params.id);

    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    if (tableName === 'clients' && isOwner) {
      return res.status(403).json({ error: 'Access denied. Client accounts are strictly private and managed exclusively by their Agent.' });
    }
    if ((tableName === 'numbers' || tableName === 'announcements') && !isOwner) {
      return res.status(403).json({ error: `Forbidden. Only Owner can delete ${tableName}.` });
    }

    const target = data.find(x => x.id === numId || String(x.id) === rawId);
    if (target) {
      if (tableName === 'payout_requests' && isOwner && String(target.role || target.recipient_role || '').toLowerCase() === 'client') {
        return res.status(403).json({ error: 'Forbidden. Client PKR payouts are managed exclusively by their Agent.' });
      }
      if (tableName === 'bank_accounts') {
        if (!isOwner) {
          if (isAgent && Number(target.agent_id) !== Number(sessionUser.id)) {
            return res.status(403).json({ error: 'Forbidden. You can only delete your own bank accounts.' });
          }
          if (isClient) return res.status(403).json({ error: 'Access denied.' });
        }
      }
      if (tableName === 'agents') {
        if (!isOwner) {
          return res.status(403).json({ error: 'Forbidden. Only Owner can delete agent accounts.' });
        }
      }
      if (tableName === 'clients') {
        if (isOwner) {
          return res.status(403).json({ error: 'Access denied. Client accounts are strictly private and managed exclusively by their Agent.' });
        }
        if (!isAgent || Number(target.agent_id) !== Number(sessionUser.id)) {
          return res.status(403).json({ error: 'Forbidden. You can only manage your own clients.' });
        }
      }
      if (tableName === 'users' && !isOwner) {
        return res.status(403).json({ error: 'Access denied. Only Owner can delete users.' });
      }
      if (tableName === 'payout_requests' && !isOwner) {
        const reqTargetRole = String(target.role || target.recipient_role || '').trim().toLowerCase();
        const isSelfReq = Number(target.user_id) === Number(sessionUser.id) ||
          String(target.username || target.user || '').trim().toLowerCase() === String(sessionUser.username || '').trim().toLowerCase() ||
          reqTargetRole === 'agent';
        const clientRec = reqTargetRole === 'client'
          ? (readDb('clients') || []).find(c => Number(c.id) === Number(target.client_id || target.user_id))
          : null;
        const ownsClient = (target.agent_id != null && Number(target.agent_id) === Number(sessionUser.id))
          || (clientRec && Number(clientRec.agent_id) === Number(sessionUser.id));
        if (!isAgent || !ownsClient || isSelfReq) {
          return res.status(403).json({ error: 'Forbidden. You can only delete downline client payout requests.' });
        }
      }

      // Owner protection: Cannot delete Owner
      if (tableName === 'users') {
        if (target.username === 'Kamran_Bhatti' || target.id === 1 || (target.role || '').toLowerCase() === 'owner') {
          return res.status(400).json({ error: 'Owner account is fixed and cannot be deleted.' });
        }
      }

      // Deactivation required before deleting an account with history
      if (['users', 'agents', 'clients'].includes(tableName)) {
        if (hasAccountHistory(tableName, target.id, target.username)) {
          const isDeactivated = (target.status || '').toLowerCase() === 'inactive' || (target.status || '').toLowerCase() === 'deactivated';
          if (!isDeactivated) {
            return res.status(400).json({ error: 'Cannot delete account with existing history unless it is first deactivated (status inactive).' });
          }
        }
      }
    }

    // Cascade-clean & tombstone all related records when deleting Agent/Client/User
    if (target && ['agents', 'clients', 'users'].includes(tableName)) {
      cleanupDeletedAccountData(tableName, target);
    }

    const filtered = data.filter(x => {
      if (!isNaN(numId) && x.id === numId) return false;
      if (String(x.id) === rawId) return false;
      if (tableName === 'numbers' && String(x.number) === rawId) return false;
      return true;
    });
    writeDb(tableName, filtered);
    logAudit(sessionUser.username || 'Owner', `Delete ${tableName}`, `Deleted item #${rawId}${target && target.username ? ` (${target.username})` : ''}`, tableName);
    res.json({ success: true });
  });
}

registerPaginatedCrud('numbers', 'numbers');

// Number diagnostic and verification endpoint
app.post('/api/numbers/test', (req, res) => {
  try {
    const rawNumber = String(req.body.number || '').trim();
    const testType = String(req.body.test_type || 'ping').trim().toLowerCase();

    if (!rawNumber) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    const digitsOnly = rawNumber.replace(/\D/g, '');
    if (digitsOnly.length < 6) {
      return res.status(400).json({ success: false, error: 'Invalid phone number format: too short' });
    }

    const numbers = readDb('numbers') || [];
    const ranges = readDb('sms_ranges') || [];

    const foundNum = numbers.find(n => {
      const nDigits = String(n.number || '').replace(/\D/g, '');
      return nDigits === digitsOnly || String(n.number).trim() === rawNumber;
    });

    let provider = foundNum?.provider || '';
    let country = foundNum?.country || '';

    if (!provider) {
      const matchingRange = ranges.find(r => r.prefix && digitsOnly.startsWith(String(r.prefix).replace(/\D/g, '')));
      if (matchingRange) {
        provider = matchingRange.provider || '';
        country = matchingRange.country || '';
      }
    }

    if (!provider) {
      provider = 'Direct Route (Tier 1)';
    }

    logAudit('Admin', 'Test Number', `Tested ${rawNumber} [${testType}] -> ${provider}`, 'Numbers');

    return res.json({
      success: true,
      number: rawNumber,
      test_type: testType,
      provider: provider,
      country: country || 'International',
      status: 'active',
      valid: true,
      message: `${testType.toUpperCase()} test completed successfully on ${rawNumber}`
    });
  } catch (err) {
    console.error('Number test error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Bulk number delete & unassign endpoints
app.post('/api/numbers/bulk-delete-many', (req, res) => {
  try {
    const numberIds = req.body.number_ids || req.body.ids || [];
    if (!Array.isArray(numberIds) || !numberIds.length) {
      return res.status(400).json({ error: 'No number IDs provided' });
    }
    let numbers = readDb('numbers') || [];
    const initialCount = numbers.length;
    const idSet = new Set(numberIds.map(String));
    numbers = numbers.filter(n => !idSet.has(String(n.id)) && !idSet.has(String(n.number)));
    writeDb('numbers', numbers);
    const deleted = initialCount - numbers.length;

    logAudit('Admin', 'Bulk Delete Numbers', `Deleted ${deleted} numbers`, 'Numbers');
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('bulk-delete-many error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/numbers/bulk-unassign-many', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    if (!isOwner && !isAgent) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const numberIds = req.body.number_ids || req.body.ids || [];
    let numbers = readDb('numbers') || [];
    const idSet = new Set(numberIds.map(String));

    let count = 0;
    numbers = numbers.map(n => {
      if (idSet.has(String(n.id)) || idSet.has(String(n.number))) {
        if (isAgent) {
          if (Number(n.agent_id) !== Number(sessionUser.id)) return n;
          count++;
          // Agent unallocates from Client back into Agent pool (agent_id remains)
          return { ...n, client_id: null, client_name: '', client_username: '', user: '', status: 'assigned' };
        } else if (isOwner) {
          count++;
          // Owner recalls downward into Owner pool
          return { ...n, agent_id: null, client_id: null, client_name: '', client_username: '', user: '', status: 'active' };
        }
      }
      return n;
    });
    writeDb('numbers', numbers);

    res.json({ success: true, revoked: count, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/numbers/revoke', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    if (!isOwner && !isAgent) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const { user_id, number, count: reqCount } = req.body || {};
    const targetUserId = Number(user_id);
    if (!targetUserId && !number) {
      return res.status(400).json({ error: 'user_id or number is required' });
    }
    let numbers = readDb('numbers') || [];
    if (!isOwner) {
      if (number) {
        const prefix = String(number).replace('*', '');
        const matching = numbers.filter(n => n.number === number || String(n.number).startsWith(prefix));
        const inScope = matching.some(n => Number(n.agent_id) === Number(sessionUser.id));
        if (matching.length > 0 && !inScope) {
          return res.status(403).json({ error: 'Forbidden. You cannot revoke numbers outside your scope.' });
        }
      }
      if (targetUserId) {
        const clients = readDb('clients') || [];
        const targetClient = clients.find(c => Number(c.id) === targetUserId);
        if (!targetClient || Number(targetClient.agent_id) !== Number(sessionUser.id)) {
          return res.status(403).json({ error: 'Forbidden. You can only revoke numbers from your own clients.' });
        }
      }
    }
    let revokedCount = 0;
    const revokedByTarget = new Map();

    numbers = numbers.map(n => {
      if (reqCount && revokedCount >= reqCount) return n;
      if (number && n.number !== number && !String(n.number).startsWith(String(number).replace('*', ''))) return n;
      if (isAgent && Number(n.agent_id) !== Number(sessionUser.id)) return n;

      const matchesUser = targetUserId
        ? (isAgent
            ? Number(n.client_id) === targetUserId
            : (Number(n.client_id) === targetUserId || Number(n.agent_id) === targetUserId))
        : true;
      if (!matchesUser) return n;

      revokedCount++;
      const rName = n.range_name || n.country || 'Direct';
      if (isAgent && n.client_id) {
        const k = `client:${n.client_id}`;
        const prev = revokedByTarget.get(k) || { role: 'client', id: Number(n.client_id), username: n.client_username || n.user || '', count: 0, ranges: new Set() };
        prev.count++;
        prev.ranges.add(rName);
        revokedByTarget.set(k, prev);
      } else if (!isAgent && n.agent_id) {
        const k = `agent:${n.agent_id}`;
        const prev = revokedByTarget.get(k) || { role: 'agent', id: Number(n.agent_id), username: n.agent_username || '', count: 0, ranges: new Set() };
        prev.count++;
        prev.ranges.add(rName);
        revokedByTarget.set(k, prev);
      }

      if (isAgent) {
        return { ...n, client_id: null, client_name: '', client_username: '', user: '', status: 'assigned' };
      } else {
        return { ...n, agent_id: null, client_id: null, client_name: '', client_username: '', user: '', assigned_at: null, assigned_date: null, status: 'active' };
      }
    });

    writeDb('numbers', numbers);
    for (const info of revokedByTarget.values()) {
      const rngTxt = Array.from(info.ranges).slice(0, 3).join(', ') || 'Direct';
      sendInstantNotification({
        recipient_role: info.role,
        recipient_id: info.id,
        recipient_username: info.username,
        title: `Numbers Recalled (-${info.count}) — ${rngTxt}`,
        message: `${info.count} number(s) in range "${rngTxt}" were recalled from your panel by ${isAgent ? (sessionUser.username || 'Agent') : 'Owner'}.`,
        type: 'revocation',
        category: 'numbers',
        action_page: info.role === 'client' ? 'my-numbers' : 'my-sms-numbers',
        count: info.count,
        range_name: rngTxt,
        status: 'recalled',
        actor_role: isAgent ? 'Agent' : 'Owner',
        actor_name: sessionUser.username || (isAgent ? 'Agent' : 'Owner')
      });
    }
    res.json({ success: true, revoked: revokedCount, count: revokedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/numbers/:id/unassign', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    if (!isOwner && !isAgent) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const rawId = String(req.params.id);
    let numbers = readDb('numbers') || [];
    const idx = numbers.findIndex(n => String(n.id) === rawId || String(n.number) === rawId);
    if (idx !== -1) {
      const n = numbers[idx];
      const rngTxt = n.range_name || n.country || 'Direct';
      if (isAgent) {
        if (Number(n.agent_id) !== Number(sessionUser.id)) {
          return res.status(403).json({ error: 'Forbidden. You can only unassign numbers from your own pool.' });
        }
        const prevClientId = n.client_id ? Number(n.client_id) : null;
        const prevClientUser = n.client_username || n.user || '';
        numbers[idx] = { ...n, client_id: null, client_name: '', client_username: '', user: '', status: 'assigned' };
        writeDb('numbers', numbers);
        if (prevClientId) {
          sendInstantNotification({
            recipient_role: 'client',
            recipient_id: prevClientId,
            recipient_username: prevClientUser,
            title: `Number Recalled (-1) — ${rngTxt}`,
            message: `Number ${n.number} in range "${rngTxt}" was unassigned from your panel by ${sessionUser.username || 'Agent'}.`,
            type: 'revocation',
            category: 'numbers',
            action_page: 'my-numbers',
            count: 1,
            range_name: rngTxt,
            status: 'recalled',
            actor_role: 'Agent',
            actor_name: sessionUser.username || 'Agent'
          });
        }
      } else if (isOwner) {
        const prevAgentId = n.agent_id ? Number(n.agent_id) : null;
        numbers[idx] = { ...n, agent_id: null, client_id: null, client_name: '', client_username: '', user: '', assigned_at: null, assigned_date: null, status: 'active' };
        writeDb('numbers', numbers);
        if (prevAgentId) {
          sendInstantNotification({
            recipient_role: 'agent',
            recipient_id: prevAgentId,
            title: `Number Recalled (-1) — ${rngTxt}`,
            message: `Number ${n.number} in range "${rngTxt}" was recalled from your pool by Owner.`,
            type: 'revocation',
            category: 'numbers',
            action_page: 'my-sms-numbers',
            count: 1,
            range_name: rngTxt,
            status: 'recalled',
            actor_role: 'Owner',
            actor_name: sessionUser.username || 'Owner'
          });
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit Move Number Endpoint
app.post(['/api/numbers/:id/move', '/api/numbers/move'], requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    const numId = req.params.id ? String(req.params.id) : String(req.body.number_id || req.body.id || '');
    const toClientId = Number(req.body.to_client_id || req.body.target_id || req.body.client_id);
    if (!toClientId) return res.status(400).json({ error: 'Target to_client_id is required' });

    if (req.body.payterm) {
      const norm = normalizePaytermKey(req.body.payterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid payterm "${req.body.payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
      req.body.payterm = norm;
    }
    if (req.body.client_payterm) {
      const norm = normalizePaytermKey(req.body.client_payterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid client_payterm "${req.body.client_payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
      req.body.client_payterm = norm;
    }

    let numbers = readDb('numbers') || [];
    const n = numbers.find(x => String(x.id) === numId || String(x.number) === numId);
    if (!n) return res.status(404).json({ error: 'Number not found' });

    const clients = readDb('clients') || [];
    const targetClient = clients.find(c => Number(c.id) === toClientId);
    if (!targetClient) return res.status(404).json({ error: 'Target client not found' });

    if (isAgent) {
      if (Number(n.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Forbidden. You can only move numbers within your own pool.' });
      }
      if (Number(targetClient.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Forbidden. Target client must belong to your account.' });
      }
    } else if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const fromClientId = n.client_id;
    const fromClientName = n.client_name || n.user || '';

    const rawMoveRate = req.body.client_rate !== undefined ? req.body.client_rate : req.body.client_payout;
    const moveRanges = readDb('sms_ranges') || [];
    const moveRng = moveRanges.find(r => Number(r.id) === Number(n.range_id)) || moveRanges.find(r => r.range_name === n.range_name);
    const moveAgRate = Number(n.agent_rate || 0) || getRangeAgentRate(moveRng, n.payterm || 'Weekly');
    const moveResolved = resolveClientRatePair({
      agentId: targetClient.agent_id || n.agent_id || (isAgent ? sessionUser.id : null),
      rangeId: n.range_id || (moveRng && moveRng.id),
      rangeName: n.range_name || (moveRng && moveRng.range_name),
      payterm: req.body.client_payterm || n.client_payterm || n.payterm || 'Weekly',
      agentRateUsd: moveAgRate,
      explicitClientRate: (rawMoveRate !== undefined && rawMoveRate !== null && !isNaN(Number(rawMoveRate))) ? rawMoveRate : null,
      clientRecord: targetClient
    });
    if (moveResolved.error) {
      return res.status(400).json({ error: moveResolved.error });
    }
    n.client_rate = moveResolved.client_rate;
    n.client_payout = moveResolved.client_rate;
    n.client_rate_pkr = moveResolved.client_rate_pkr;
    n.client_currency = moveResolved.client_currency;
    n.fx_usd_to_pkr = moveResolved.fx_usd_to_pkr;
    n.rate_source = moveResolved.source;

    n.client_id = toClientId;
    n.client_name = targetClient.username;
    n.client_username = targetClient.username;
    n.user = targetClient.username;
    n.status = 'assigned';
    n.assigned_at = new Date().toISOString();
    n.assigned_date = n.assigned_at;

    writeDb('numbers', numbers);

    const transfers = readDb('number_transfers') || [];
    transfers.unshift({
      id: nextId(transfers, 'number_transfers'),
      from_user_id: fromClientId,
      from_username: fromClientName,
      from_role: 'Client',
      to_user_id: toClientId,
      to_username: targetClient.username,
      to_role: 'Client',
      number_ids: [n.id],
      timestamp: new Date().toISOString(),
      action: 'move',
      status: 'completed'
    });
    writeDb('number_transfers', transfers);

    res.json({ success: true, number: n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit Return Number Endpoint (Holder returns number to upstream holder)
app.post(['/api/numbers/:id/return', '/api/numbers/return', '/api/numbers/bulk-return'], requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    const rawIds = req.params.id ? [String(req.params.id)] : (req.body.number_ids || (req.body.number_id ? [String(req.body.number_id)] : (req.body.id ? [String(req.body.id)] : []))).map(String);
    if (!rawIds.length) return res.status(400).json({ error: 'No number IDs provided' });
    const idSet = new Set(rawIds);

    let numbers = readDb('numbers') || [];
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();

    // Clients cannot self-return Whitenoise / Monthly Route numbers — they must contact their Agent
    if (isClient) {
      const hasWnToReturn = numbers.some(n => {
        if (!n) return false;
        if (!idSet.has(String(n.id)) && !idSet.has(String(n.number))) return false;
        if (Number(n.client_id) !== Number(sessionUser.id)) return false;
        return isWhitenoiseRecord(n, wnRangesMap, wnTags);
      });
      if (hasWnToReturn) {
        return res.status(400).json({ error: 'Monthly Route numbers cannot be returned directly. Please contact your Agent.' });
      }
    }

    let count = 0;

    numbers = numbers.map(n => {
      if (!idSet.has(String(n.id)) && !idSet.has(String(n.number))) return n;

      if (isClient) {
        if (Number(n.client_id) !== Number(sessionUser.id)) return n;
        count++;
        // Client returns to Agent pool
        return { ...n, client_id: null, client_name: '', client_username: '', user: '', status: n.status === 'blocked' ? 'blocked' : 'assigned' };
      } else if (isAgent) {
        if (Number(n.agent_id) !== Number(sessionUser.id)) return n;
        count++;
        // Agent returns directly to Owner pool
        return { ...n, agent_id: null, client_id: null, client_name: '', client_username: '', user: '', status: n.status === 'blocked' ? 'blocked' : 'active' };
      }
      return n;
    });

    writeDb('numbers', numbers);
    res.json({ success: true, returned: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Date-grouped active number batches strictly for a SINGLE range (Client or Agent)
app.get('/api/numbers/range-return-batches', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = String(sessionUser?.role || '').toLowerCase();
    const isClient = sRole === 'client';
    const isAgent = sRole === 'agent';
    if (!isClient && !isAgent) {
      return res.status(403).json({ error: 'Only Client or Agent accounts can return range numbers.' });
    }

    const rangeId = req.query.range_id ? Number(req.query.range_id) : null;
    const rangeName = String(req.query.range_name || '').trim();
    if (!rangeId && !rangeName) {
      return res.status(400).json({ error: 'range_id or range_name is required.' });
    }

    const ranges = readDb('sms_ranges') || [];
    const matchedRng = (rangeId && ranges.find(r => Number(r.id) === rangeId))
      || (rangeName && ranges.find(r => String(r.range_name || r.name || '').trim().toLowerCase() === rangeName.toLowerCase()))
      || null;
    const effRangeId = matchedRng ? Number(matchedRng.id) : rangeId;
    const effRangeName = (matchedRng && (matchedRng.range_name || matchedRng.name)) || rangeName || `Range #${effRangeId}`;
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const isWnTarget = (matchedRng && isWhitenoiseRecord(matchedRng, wnRangesMap, wnTags)) || isWhitenoiseText(effRangeName);
    if (isClient && isWnTarget) {
      return res.status(400).json({ error: 'Monthly Route numbers cannot be returned directly. Please contact your Agent.' });
    }

    const numbers = readDb('numbers') || [];
    const heldInRange = numbers.filter(n => {
      if (!n) return false;
      if (isClient && Number(n.client_id) !== Number(sessionUser.id)) return false;
      if (isAgent && Number(n.agent_id) !== Number(sessionUser.id)) return false;
      return matchesRangeRef(n, effRangeId, effRangeName);
    });

    const groups = new Map();
    for (const n of heldInRange) {
      const rawTs = isClient
        ? (n.client_assigned_at || n.assigned_at || n.assigned_date || n.allocated_at || n.created || '')
        : (n.assigned_at || n.assigned_date || n.allocated_at || n.created || '');
      const dateStr = /^\d{4}-\d{2}-\d{2}/.test(String(rawTs)) ? String(rawTs).slice(0, 10) : 'Unknown';
      if (!groups.has(dateStr)) {
        groups.set(dateStr, { date: dateStr, count: 0, nums: [], payterms: new Set(), assigned_to_clients: 0 });
      }
      const g = groups.get(dateStr);
      g.count++;
      g.nums.push(String(n.number || n.id));
      const pt = n.client_payterm || n.payterm || '';
      if (pt) g.payterms.add(pt);
      if (isAgent && n.client_id) g.assigned_to_clients++;
    }

    const batches = Array.from(groups.values())
      .map(g => {
        g.nums.sort();
        return {
          date: g.date,
          count: g.count,
          sample_start: g.nums[0] || '',
          sample_end: g.nums[g.nums.length - 1] || '',
          payterms: Array.from(g.payterms),
          assigned_to_clients: g.assigned_to_clients
        };
      })
      .sort((a, b) => (a.date === 'Unknown' ? 1 : (b.date === 'Unknown' ? -1 : b.date.localeCompare(a.date))));

    const validDates = batches.map(b => b.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

    res.json({
      success: true,
      range_id: effRangeId,
      range_name: effRangeName,
      total_held: heldInRange.length,
      min_date: validDates[0] || '',
      max_date: validDates[validDates.length - 1] || '',
      batches
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Return numbers strictly for a SINGLE range filtered by selected assignment date(s) or date-to-date range
app.post('/api/numbers/return-by-date', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = String(sessionUser?.role || '').toLowerCase();
    const isClient = sRole === 'client';
    const isAgent = sRole === 'agent';
    if (!isClient && !isAgent) {
      return res.status(403).json({ error: 'Only Client or Agent accounts can return range numbers.' });
    }

    const { range_id, range_name, dates, from_date, to_date } = req.body || {};
    const rangeId = range_id ? Number(range_id) : null;
    const rangeName = String(range_name || '').trim();
    if (!rangeId && !rangeName) {
      return res.status(400).json({ error: 'range_id or range_name is required.' });
    }

    const dateSet = new Set(
      (Array.isArray(dates) ? dates : [])
        .map(d => String(d || '').trim())
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) || d === 'Unknown')
    );
    const cleanFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(from_date || '').trim()) ? String(from_date).trim() : '';
    const cleanTo = /^\d{4}-\d{2}-\d{2}$/.test(String(to_date || '').trim()) ? String(to_date).trim() : '';

    if (dateSet.size === 0 && !cleanFrom && !cleanTo) {
      return res.status(400).json({ error: 'Please select at least one date or a valid From/To date range.' });
    }
    if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
      return res.status(400).json({ error: 'From Date cannot be later than To Date.' });
    }

    const ranges = readDb('sms_ranges') || [];
    const matchedRng = (rangeId && ranges.find(r => Number(r.id) === rangeId))
      || (rangeName && ranges.find(r => String(r.range_name || r.name || '').trim().toLowerCase() === rangeName.toLowerCase()))
      || null;
    const effRangeId = matchedRng ? Number(matchedRng.id) : rangeId;
    const effRangeName = (matchedRng && (matchedRng.range_name || matchedRng.name)) || rangeName || `Range #${effRangeId}`;
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const isWnTarget = (matchedRng && isWhitenoiseRecord(matchedRng, wnRangesMap, wnTags)) || isWhitenoiseText(effRangeName);
    if (isClient && isWnTarget) {
      return res.status(400).json({ error: 'Monthly Route numbers cannot be returned directly. Please contact your Agent.' });
    }

    let numbers = readDb('numbers') || [];
    const returnedIds = [];
    const returnedDates = new Set();
    let remainingInRange = 0;
    let upstreamAgentId = null;

    numbers = numbers.map(n => {
      if (!n) return n;
      const ownedByUser = isClient
        ? Number(n.client_id) === Number(sessionUser.id)
        : Number(n.agent_id) === Number(sessionUser.id);
      if (!ownedByUser) return n;
      if (!matchesRangeRef(n, effRangeId, effRangeName)) return n;

      const rawTs = isClient
        ? (n.client_assigned_at || n.assigned_at || n.assigned_date || n.allocated_at || n.created || '')
        : (n.assigned_at || n.assigned_date || n.allocated_at || n.created || '');
      const dateStr = /^\d{4}-\d{2}-\d{2}/.test(String(rawTs)) ? String(rawTs).slice(0, 10) : 'Unknown';

      let matchesDate = false;
      if (dateSet.size > 0) {
        matchesDate = dateSet.has(dateStr);
      } else if (dateStr !== 'Unknown') {
        const geFrom = !cleanFrom || dateStr >= cleanFrom;
        const leTo = !cleanTo || dateStr <= cleanTo;
        matchesDate = geFrom && leTo;
      }

      if (!matchesDate) {
        remainingInRange++;
        return n;
      }

      returnedIds.push(n.id);
      returnedDates.add(dateStr);
      if (isClient) {
        if (n.agent_id) upstreamAgentId = Number(n.agent_id);
        return {
          ...n,
          client_id: null,
          client_name: '',
          client_username: '',
          user: '',
          client_assigned_at: null,
          status: n.agent_id ? 'assigned' : 'active'
        };
      }
      return {
        ...n,
        agent_id: null,
        agent_name: '',
        agent_username: '',
        client_id: null,
        client_name: '',
        client_username: '',
        user: '',
        assigned_at: null,
        assigned_date: null,
        client_assigned_at: null,
        status: 'active'
      };
    });

    if (returnedIds.length === 0) {
      return res.status(400).json({ error: `No active numbers matched the selected date(s) in range "${effRangeName}".` });
    }

    writeDb('numbers', numbers);

    const nowIso = new Date().toISOString();
    const datesArr = Array.from(returnedDates).sort();
    try {
      const transfers = readDb('number_transfers') || [];
      transfers.unshift({
        id: nextId(transfers, 'number_transfers'),
        from_user_id: sessionUser.id,
        from_username: sessionUser.username,
        from_role: isClient ? 'Client' : 'Agent',
        to_user_id: isClient ? upstreamAgentId : 1,
        to_username: isClient ? 'Agent Pool' : 'Owner Pool',
        to_role: isClient ? 'Agent' : 'Owner',
        range_id: effRangeId,
        range_name: effRangeName,
        dates_returned: datesArr,
        number_ids: returnedIds,
        count: returnedIds.length,
        timestamp: nowIso,
        action: 'return_by_date',
        status: 'completed'
      });
      writeDb('number_transfers', transfers);
    } catch (_) {}

    logAudit(sessionUser.username, 'Return Range Numbers by Date', `Returned ${returnedIds.length} number(s) from "${effRangeName}" (${datesArr.join(', ')})`, 'Numbers');

    sendInstantNotification({
      recipient_role: isClient ? (upstreamAgentId ? 'agent' : 'owner') : 'owner',
      recipient_id: isClient ? (upstreamAgentId || null) : null,
      title: `${isClient ? 'Client' : 'Agent'} Returned ${returnedIds.length} Numbers`,
      message: `${isClient ? 'Client' : 'Agent'} ${sessionUser.username} returned ${returnedIds.length} number(s) in range "${effRangeName}" (Dates: ${datesArr.join(', ')}).`,
      type: 'revocation',
      category: 'numbers',
      action_page: isClient ? 'numbers' : 'numbers',
      status: 'returned',
      count: returnedIds.length,
      range_id: effRangeId,
      range_name: effRangeName,
      actor_role: isClient ? 'Client' : 'Agent',
      actor_name: sessionUser.username,
      metadata: { dates: datesArr, returned: returnedIds.length }
    });

    res.json({
      success: true,
      returned: returnedIds.length,
      returned_count: returnedIds.length,
      range_id: effRangeId,
      range_name: effRangeName,
      dates_returned: datesArr,
      remaining_in_range: remainingInRange
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single number assign (Direct 3-Tier: Owner -> Agent -> Client)
app.post('/api/numbers/:id/assign', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    if (!isOwner && !isAgent) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    if (req.body.payterm) {
      const norm = normalizePaytermKey(req.body.payterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid payterm "${req.body.payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
    }
    if (req.body.client_payterm) {
      const norm = normalizePaytermKey(req.body.client_payterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid client_payterm "${req.body.client_payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
    }

    const rawId = String(req.params.id);
    let numbers = readDb('numbers') || [];
    const n = numbers.find(x => String(x.id) === rawId || String(x.number) === rawId);
    if (!n) return res.status(404).json({ error: 'Number not found' });

    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const isWnNumber = isWhitenoiseRecord(n, wnRangesMap, wnTags);
    if (isWnNumber && !hasWhitenoiseAccess(sessionUser)) {
      return res.status(403).json({ error: isOwner ? 'Forbidden. Whitenoise access is not enabled for your account.' : 'Forbidden. Monthly Route (CDR 2) access is not enabled for your account.' });
    }

    const targetType = (req.body.target_type || 'client').toLowerCase();
    const targetId = Number(req.body.target_id || req.body.client_id);
    const notes = req.body.notes || '';
    if (!targetId) return res.status(400).json({ error: 'target_id is required' });

    if (isOwner) {
      if (Boolean(n.agent_id) || Boolean(n.client_id)) {
        return res.status(400).json({ error: 'Number is held downline. Recall it to Owner pool first before assigning.' });
      }
      if (targetType !== 'agent') {
        return res.status(400).json({ error: 'Owner can only assign numbers directly to Agents. Flow is Owner -> Agent -> Client.' });
      }
    } else if (isAgent) {
      if (Number(n.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Forbidden. You can only assign numbers inside your own pool.' });
      }
      if (targetType !== 'client') {
        return res.status(400).json({ error: 'Agent can only assign numbers to Clients.' });
      }
    }

    let toUsername = '';
    let toRole = '';

    if (targetType === 'agent') {
      if (!isOwner) return res.status(403).json({ error: 'Only Owner can assign numbers to Agents.' });
      const agents = readDb('agents') || [];
      const ag = agents.find(a => Number(a.id) === targetId);
      if (!ag) return res.status(404).json({ error: 'Agent not found' });
      if (isWnNumber && !hasWhitenoiseAccess({ role: 'Agent', id: ag.id, whitenoise_access: ag.whitenoise_access })) {
        return res.status(403).json({ error: `Agent "${ag.username}" does not have Whitenoise access enabled.` });
      }
      const payterm = isWnNumber ? 'Monthly' : normalizePaytermKey(req.body.payterm || n.payterm || 'Weekly');
      const ptMeta = getPaytermMeta(payterm);
      const ranges = readDb('sms_ranges') || [];
      const rng = ranges.find(r => Number(r.id) === Number(n.range_id)) || ranges.find(r => r.range_name === n.range_name);
      const fixedAgentRate = getRangeAgentRate(rng, ptMeta.key);

      n.agent_id = targetId;
      n.client_id = null;
      n.client_name = '';
      n.client_username = '';
      n.user = '';
      n.payterm = ptMeta.key;
      n.payout_schedule = ptMeta.schedule;
      n.cycle_days = ptMeta.cycle_days;
      n.hold_days = ptMeta.hold_days;
      if (isWnNumber) {
        n.is_whitenoise = true;
      }
      n.agent_rate = fixedAgentRate;
      n.payout = fixedAgentRate;
      toUsername = ag.username;
      toRole = 'Agent';
    } else {
      const clients = readDb('clients') || [];
      const cl = clients.find(c => Number(c.id) === targetId);
      if (!cl) return res.status(404).json({ error: 'Client not found' });

      const effectiveAgentId = cl.agent_id || null;
      if (isAgent && Number(cl.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Forbidden. You can only assign to your own clients.' });
      }
      if (isWnNumber && !hasWhitenoiseAccess({ role: 'Client', id: cl.id, agent_id: effectiveAgentId, whitenoise_access: cl.whitenoise_access })) {
        return res.status(403).json({ error: isOwner ? `Client "${cl.username}" (or their parent Agent) does not have Whitenoise access enabled.` : `Client "${cl.username}" does not have CDR 2 / Monthly Route access enabled.` });
      }

      const ranges = readDb('sms_ranges') || [];
      const rng = ranges.find(r => Number(r.id) === Number(n.range_id)) || ranges.find(r => r.range_name === n.range_name);
      const rngPtInfo = rng ? resolveRangeActivePayterms(rng, isWnNumber) : null;
      const rawReqPt = req.body.client_payterm || req.body.payterm;
      const clientPayterm = isWnNumber
        ? 'Monthly'
        : normalizePaytermKey(rawReqPt || (rngPtInfo ? rngPtInfo.primary_payterm : (n.client_payterm || n.payterm || 'Weekly')));
      if (rngPtInfo && rawReqPt && !isWnNumber && !rngPtInfo.active_payterms.includes(clientPayterm)) {
        return res.status(400).json({ error: `Payterm "${clientPayterm}" is not available on range "${rng.range_name || rng.name}". Allowed: ${rngPtInfo.active_payterms.join(', ')}.` });
      }
      // Enforce max 50 active numbers per range per client
      const curHeldInRange = numbers.filter(x =>
        x && Number(x.client_id) === Number(targetId) &&
        Number(x.id) !== Number(n.id) &&
        matchesRangeRef(x, n.range_id || (rng && rng.id), n.range_name || (rng && rng.range_name))
      ).length;
      if (curHeldInRange + 1 > CLIENT_RANGE_ACTIVE_HOLD_MAX) {
        return res.status(400).json({ error: `Client "${cl.username}" already holds ${curHeldInRange}/${CLIENT_RANGE_ACTIVE_HOLD_MAX} numbers in this range (max ${CLIENT_RANGE_ACTIVE_HOLD_MAX} per range).` });
      }
      const ptMeta = getPaytermMeta(clientPayterm);
      const agentRate = (n.agent_rate !== undefined && n.agent_rate !== null && Number(n.agent_rate) > 0)
        ? Number(n.agent_rate)
        : getRangeAgentRate(rng, isWnNumber ? 'Monthly' : (rngPtInfo ? rngPtInfo.primary_payterm : (n.payterm || 'Weekly')));

      const rawClientRate = req.body.client_rate !== undefined ? req.body.client_rate : req.body.client_payout;
      const ratePair = resolveClientRatePair({
        agentId: effectiveAgentId || (isAgent ? Number(sessionUser.id) : n.agent_id || null),
        rangeId: n.range_id || (rng && rng.id),
        rangeName: n.range_name || (rng && rng.range_name),
        payterm: ptMeta.key,
        agentRateUsd: agentRate,
        explicitClientRate: (rawClientRate !== undefined && rawClientRate !== null && !isNaN(Number(rawClientRate))) ? rawClientRate : null,
        clientRecord: cl
      });
      if (ratePair.error) {
        return res.status(400).json({ error: ratePair.error });
      }

      n.agent_id = effectiveAgentId || (isAgent ? Number(sessionUser.id) : n.agent_id || null);
      n.client_id = targetId;
      n.client_name = cl.username;
      n.client_username = cl.username;
      n.user = cl.username;
      if (isWnNumber) {
        n.payterm = 'Monthly';
        n.is_whitenoise = true;
      }
      n.client_payterm = ptMeta.key;
      n.payout_schedule = ptMeta.schedule;
      n.cycle_days = ptMeta.cycle_days;
      n.hold_days = ptMeta.hold_days;
      n.client_rate = ratePair.client_rate;
      n.client_payout = ratePair.client_rate;
      n.client_rate_pkr = ratePair.client_rate_pkr;
      n.client_currency = ratePair.client_currency;
      n.fx_usd_to_pkr = ratePair.fx_usd_to_pkr;
      n.rate_source = ratePair.source;
      toUsername = cl.username;
      toRole = 'Client';
    }

    n.status = 'assigned';
    n.assigned_at = new Date().toISOString();
    n.assigned_date = n.assigned_at;
    n.notes = notes;
    writeDb('numbers', numbers);

    // Instant Notification with Range, Payterm & Rate details
    if (targetType === 'client') {
      const rngLabel = n.range_name || n.country || 'Direct';
      const termLabel = formatNotifPayterm(n.client_payterm || n.payterm, !!n.is_whitenoise);
      const rateLabel = formatNotifRate(n.client_rate_pkr, 'PKR') || formatNotifRate(n.client_rate, 'USD');
      sendInstantNotification({
        recipient_role: 'client',
        recipient_id: targetId,
        recipient_username: toUsername,
        title: `Number Added (+1) — ${rngLabel}`,
        message: `1 number (${n.number}) added to your panel in range "${rngLabel}" on ${termLabel} term${rateLabel ? ` at ${rateLabel}` : ''} by ${sessionUser.username || 'Agent'}.`,
        type: 'allocation',
        category: 'numbers',
        action_page: 'my-numbers',
        payterm: termLabel,
        rate_label: rateLabel,
        status: 'added',
        count: 1,
        range_id: n.range_id,
        range_name: rngLabel,
        actor_role: 'Agent',
        actor_name: sessionUser.username || 'Agent'
      });
    } else if (targetType === 'agent') {
      const rngLabel = n.range_name || n.country || 'Direct';
      const termLabel = formatNotifPayterm(n.payterm, !!n.is_whitenoise);
      const rateLabel = formatNotifRate(n.agent_rate || n.payout, 'USD');
      sendInstantNotification({
        recipient_role: 'agent',
        recipient_id: targetId,
        recipient_username: toUsername,
        title: `Number Allocated (+1) — ${rngLabel}`,
        message: `Owner allocated 1 number (${n.number}) in range "${rngLabel}" on ${termLabel} term${rateLabel ? ` at ${rateLabel}` : ''}.`,
        type: 'allocation',
        category: 'numbers',
        action_page: 'my-sms-numbers',
        payterm: termLabel,
        rate_label: rateLabel,
        status: 'allocated',
        count: 1,
        range_id: n.range_id,
        range_name: rngLabel,
        actor_role: 'Owner',
        actor_name: 'Kamran_Bhatti'
      });
    }

    const transfers = readDb('number_transfers') || [];
    transfers.unshift({
      id: nextId(transfers, 'number_transfers'),
      from_user_id: null,
      from_username: sessionUser.username || 'Owner',
      from_role: sessionUser.role || 'Owner',
      to_user_id: targetId,
      to_username: toUsername,
      to_role: toRole,
      count: 1,
      number_ids: [n.id],
      service: n.app || '',
      notes: notes,
      timestamp: new Date().toISOString(),
      status: 'completed'
    });
    writeDb('number_transfers', transfers);
    logAudit(sessionUser.username || 'Owner', 'Assign Number', `${n.number} -> ${toRole} '${toUsername}'`, 'Numbers');

    res.json({ success: true, ...n, data: n });
  } catch (err) {
    console.error('Assign number error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk assign selected numbers (Direct 3-Tier: Owner -> Agent -> Client)
app.post('/api/numbers/bulk-assign-many', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    if (!isOwner && !isAgent) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    if (req.body.payterm) {
      const norm = normalizePaytermKey(req.body.payterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid payterm "${req.body.payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
      req.body.payterm = norm;
    }
    if (req.body.client_payterm) {
      const norm = normalizePaytermKey(req.body.client_payterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid client_payterm "${req.body.client_payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
      req.body.client_payterm = norm;
    }

    const rawNumberIds = (req.body.number_ids || []).map(Number);
    if (!rawNumberIds.length) return res.status(400).json({ error: 'No numbers selected' });

    const targetType = (req.body.target_type || 'client').toLowerCase();
    const targetId = Number(req.body.target_id || req.body.client_id);
    const notes = req.body.notes || '';
    if (!targetId) return res.status(400).json({ error: 'target_id is required' });

    let numbers = readDb('numbers') || [];
    const assignableIds = rawNumberIds;

    if (isOwner) {
      const outsidePool = assignableIds.some(id => {
        const num = numbers.find(n => Number(n.id) === id);
        return !num || num.agent_id != null || num.client_id != null;
      });
      if (outsidePool) {
        return res.status(400).json({ error: 'Selected numbers contain numbers held downline. Recall them first.' });
      }
      if (targetType !== 'agent') {
        return res.status(400).json({ error: 'Owner can only assign numbers directly to Agents. Flow is Owner -> Agent -> Client.' });
      }
    } else if (isAgent) {
      const outsidePool = assignableIds.some(id => {
        const num = numbers.find(n => Number(n.id) === id);
        return !num || Number(num.agent_id) !== Number(sessionUser.id);
      });
      if (outsidePool) {
        return res.status(403).json({ error: 'Forbidden. You can only assign numbers inside your own pool.' });
      }
      if (targetType !== 'client') {
        return res.status(400).json({ error: 'Agent can only assign numbers to Clients.' });
      }
    }

    const hasBlockedSelected = assignableIds.some(id => {
      const num = numbers.find(n => Number(n.id) === id);
      return num && String(num.status || '').toLowerCase() === 'blocked';
    });
    if (hasBlockedSelected) {
      return res.status(400).json({ error: 'Blocked numbers cannot be allocated. Unblock them first from Blocked Numbers.' });
    }

    const numberIds = new Set(assignableIds);
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const hasWnSelected = numbers.some(n => numberIds.has(Number(n.id)) && isWhitenoiseRecord(n, wnRangesMap, wnTags));
    if (hasWnSelected && !hasWhitenoiseAccess(sessionUser)) {
      return res.status(403).json({ error: isOwner ? 'Forbidden. Whitenoise access is not enabled for your account.' : 'Forbidden. Monthly Route (CDR 2) access is not enabled for your account.' });
    }

    let toUsername = '';
    let toRole = '';
    let parentAgentId = null;

    if (targetType === 'agent') {
      if (!isOwner) return res.status(403).json({ error: 'Only Owner can assign numbers to Agents.' });
      const agents = readDb('agents') || [];
      const ag = agents.find(a => Number(a.id) === targetId);
      if (!ag) return res.status(404).json({ error: 'Agent not found' });
      if (hasWnSelected && !hasWhitenoiseAccess({ role: 'Agent', id: ag.id, whitenoise_access: ag.whitenoise_access })) {
        return res.status(403).json({ error: `Agent "${ag.username}" does not have Whitenoise access enabled.` });
      }
      toUsername = ag.username;
      toRole = 'Agent';
    } else {
      const clients = readDb('clients') || [];
      const cl = clients.find(c => Number(c.id) === targetId);
      if (!cl) return res.status(404).json({ error: 'Client not found' });
      toUsername = cl.username;
      toRole = 'Client';
      parentAgentId = cl.agent_id || null;

      if (isAgent && Number(cl.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Forbidden. You can only assign to your own clients.' });
      }
      if (hasWnSelected && !hasWhitenoiseAccess({ role: 'Client', id: cl.id, agent_id: parentAgentId, whitenoise_access: cl.whitenoise_access })) {
        return res.status(403).json({ error: isOwner ? `Client "${cl.username}" (or their parent Agent) does not have Whitenoise access enabled.` : `Client "${cl.username}" does not have CDR 2 / Monthly Route access enabled.` });
      }
    }

    let clientRateToSet = null;
    let clientPaytermToSet = normalizePaytermKey(req.body.client_payterm || req.body.payterm || 'Weekly');
    let bulkClientRecord = null;
    if (targetType === 'client') {
      bulkClientRecord = (readDb('clients') || []).find(c => Number(c.id) === targetId) || null;
      const rawClientRate = req.body.client_rate !== undefined ? req.body.client_rate : req.body.client_payout;
      if (rawClientRate !== undefined && rawClientRate !== null && !isNaN(Number(rawClientRate))) {
        clientRateToSet = Number(rawClientRate);
        for (const numObj of numbers) {
          if (numberIds.has(Number(numObj.id))) {
            const agRate = Number(numObj.agent_rate || 0);
            if (agRate > 0 && clientRateToSet >= agRate) {
              return res.status(400).json({
                error: `Client rate ($${clientRateToSet}) must be strictly less than agent rate ($${agRate}) for number ${numObj.number || numObj.id}.`
              });
            }
          }
        }
      }
    }

    const bulkRanges = readDb('sms_ranges') || [];
    const explicitBulkPayterm = req.body.client_payterm || req.body.payterm || null;

    // Enforce strict active payterms & max 50 held per range per client
    if (targetType === 'client' && bulkClientRecord) {
      const perRangeCounts = new Map();
      for (const n of numbers) {
        if (!numberIds.has(Number(n.id))) continue;
        const rObj = bulkRanges.find(r => Number(r.id) === Number(n.range_id)) || bulkRanges.find(r => r.range_name === n.range_name);
        const isWn = isWhitenoiseRecord(n, wnRangesMap, wnTags);
        if (explicitBulkPayterm && rObj) {
          const ptInfo = resolveRangeActivePayterms(rObj, isWn);
          if (!ptInfo.active_payterms.includes(normalizePaytermKey(explicitBulkPayterm))) {
            return res.status(400).json({
              error: `Payterm "${explicitBulkPayterm}" is not active on range "${rObj.range_name || rObj.name}". Allowed: ${ptInfo.active_payterms.join(', ')}.`
            });
          }
        }
        const key = n.range_id ? `id:${n.range_id}` : `name:${String(n.range_name || '').trim().toLowerCase()}`;
        if (!perRangeCounts.has(key)) perRangeCounts.set(key, { rid: n.range_id, rname: n.range_name || (rObj && rObj.range_name) || '', add: 0 });
        perRangeCounts.get(key).add++;
      }
      for (const info of perRangeCounts.values()) {
        const curHeld = numbers.filter(x => x && Number(x.client_id) === Number(targetId) && !numberIds.has(Number(x.id)) && matchesRangeRef(x, info.rid, info.rname)).length;
        if (curHeld + info.add > CLIENT_RANGE_ACTIVE_HOLD_MAX) {
          return res.status(400).json({
            error: `Client "${bulkClientRecord.username}" cannot hold more than ${CLIENT_RANGE_ACTIVE_HOLD_MAX} numbers in "${info.rname || 'this range'}" (currently ${curHeld} held, trying to add ${info.add}).`
          });
        }
      }
    }

    let updatedCount = 0;
    const assignedIds = [];
    const bulkAssignedIso = new Date().toISOString();

    numbers = numbers.map(n => {
      if (numberIds.has(Number(n.id))) {
        updatedCount++;
        assignedIds.push(n.id);
        const isWn = isWhitenoiseRecord(n, wnRangesMap, wnTags);
        const rObj = bulkRanges.find(r => Number(r.id) === Number(n.range_id)) || bulkRanges.find(r => r.range_name === n.range_name);
        const ptInfo = rObj ? resolveRangeActivePayterms(rObj, isWn) : { active_payterms: [isWn ? 'Monthly' : 'Weekly'], primary_payterm: isWn ? 'Monthly' : 'Weekly' };
        if (targetType === 'agent') {
          const candTerm = normalizePaytermKey(req.body.payterm || n.payterm || ptInfo.primary_payterm);
          const effPayterm = isWn ? 'Monthly' : (ptInfo.active_payterms.includes(candTerm) ? candTerm : ptInfo.primary_payterm);
          const ptMeta = getPaytermMeta(effPayterm);
          const agRate = isWn ? getRangeAgentRate(rObj, 'Monthly') : (n.agent_rate || getRangeAgentRate(rObj, ptMeta.key));
          return {
            ...n,
            agent_id: targetId,
            client_id: null,
            client_name: '',
            client_username: '',
            user: '',
            payterm: ptMeta.key,
            payout_schedule: ptMeta.schedule,
            cycle_days: ptMeta.cycle_days,
            hold_days: ptMeta.hold_days,
            ...(isWn ? { is_whitenoise: true } : {}),
            agent_rate: agRate,
            payout: agRate,
            status: 'assigned',
            assigned_at: bulkAssignedIso,
            assigned_date: bulkAssignedIso,
            notes
          };
        } else {
          const effAgId = parentAgentId || (isAgent ? Number(sessionUser.id) : n.agent_id || null);
          const candClTerm = explicitBulkPayterm ? normalizePaytermKey(explicitBulkPayterm) : normalizePaytermKey(n.payterm || ptInfo.primary_payterm);
          const effPayterm = isWn ? 'Monthly' : (ptInfo.active_payterms.includes(candClTerm) ? candClTerm : ptInfo.primary_payterm);
          const ptMeta = getPaytermMeta(effPayterm);
          const agRate = Number(n.agent_rate || 0) || getRangeAgentRate(rObj, effPayterm);
          const rp = resolveClientRatePair({
            agentId: effAgId,
            rangeId: n.range_id || (rObj && rObj.id),
            rangeName: n.range_name || (rObj && rObj.range_name),
            payterm: ptMeta.key,
            agentRateUsd: agRate,
            explicitClientRate: clientRateToSet,
            clientRecord: bulkClientRecord
          });
          return {
            ...n,
            agent_id: effAgId,
            client_id: targetId,
            client_name: toUsername,
            client_username: toUsername,
            user: toUsername,
            ...(isWn ? { payterm: 'Monthly', is_whitenoise: true } : {}),
            payout_schedule: ptMeta.schedule,
            cycle_days: ptMeta.cycle_days,
            hold_days: ptMeta.hold_days,
            client_rate: clientRateToSet !== null ? clientRateToSet : (rp.source === 'agent_client_rates' ? rp.client_rate : (n.client_rate ?? rp.client_rate)),
            client_payout: clientRateToSet !== null ? clientRateToSet : (rp.source === 'agent_client_rates' ? rp.client_rate : (n.client_payout ?? n.client_rate ?? rp.client_rate)),
            client_rate_pkr: rp.client_rate_pkr,
            client_currency: rp.client_currency,
            fx_usd_to_pkr: rp.fx_usd_to_pkr,
            rate_source: rp.source,
            client_payterm: ptMeta.key,
            status: 'assigned',
            assigned_at: bulkAssignedIso,
            assigned_date: bulkAssignedIso,
            notes
          };
        }
      }
      return n;
    });

    writeDb('numbers', numbers);

    if (updatedCount > 0) {
      const transfers = readDb('number_transfers') || [];
      transfers.unshift({
        id: nextId(transfers, 'number_transfers'),
        from_user_id: null,
        from_username: 'Owner',
        from_role: 'Owner',
        to_user_id: targetId,
        to_username: toUsername,
        to_role: toRole,
        count: updatedCount,
        number_ids: assignedIds,
        notes: notes,
        timestamp: new Date().toISOString(),
        status: 'completed'
      });
      writeDb('number_transfers', transfers);
      logAudit('Owner', 'Bulk Assign Numbers', `${updatedCount} numbers -> ${toRole} '${toUsername}'`, 'Numbers');

      // Instant Notification to Client or Agent with Range, Payterm & Rate
      const affectedNums = numbers.filter(n => numberIds.has(Number(n.id)));
      const rngNames = [...new Set(affectedNums.map(n => n.range_name || n.country || 'Direct'))].filter(Boolean);
      const rngLabel = rngNames.length ? rngNames.join(', ') : 'Direct';
      const firstAff = affectedNums[0] || {};
      const termLabel = formatNotifPayterm(targetType === 'client' ? (firstAff.client_payterm || firstAff.payterm) : firstAff.payterm, !!firstAff.is_whitenoise);
      if (targetType === 'client') {
        const rateLabel = formatNotifRate(firstAff.client_rate_pkr, 'PKR') || formatNotifRate(firstAff.client_rate, 'USD');
        sendInstantNotification({
          recipient_role: 'client',
          recipient_id: targetId,
          recipient_username: toUsername,
          title: `Numbers Added (+${updatedCount}) — ${rngLabel}`,
          message: `${updatedCount} number(s) added to your panel in range "${rngLabel}" on ${termLabel} term${rateLabel ? ` at ${rateLabel}` : ''} by ${sessionUser.username || 'Agent'}.`,
          type: 'allocation',
          category: 'numbers',
          action_page: 'my-numbers',
          payterm: termLabel,
          rate_label: rateLabel,
          status: 'added',
          count: updatedCount,
          range_name: rngLabel,
          actor_role: 'Agent',
          actor_name: sessionUser.username || 'Agent'
        });
      } else if (targetType === 'agent') {
        const rateLabel = formatNotifRate(firstAff.agent_rate || firstAff.payout, 'USD');
        sendInstantNotification({
          recipient_role: 'agent',
          recipient_id: targetId,
          recipient_username: toUsername,
          title: `Numbers Allocated (+${updatedCount}) — ${rngLabel}`,
          message: `Owner allocated ${updatedCount} number(s) in range "${rngLabel}" on ${termLabel} term${rateLabel ? ` at ${rateLabel}` : ''}.`,
          type: 'allocation',
          category: 'numbers',
          action_page: 'my-sms-numbers',
          payterm: termLabel,
          rate_label: rateLabel,
          status: 'allocated',
          count: updatedCount,
          range_name: rngLabel,
          actor_role: 'Owner',
          actor_name: 'Kamran_Bhatti'
        });
      }
    }

    res.json({ success: true, assigned: updatedCount });
  } catch (err) {
    console.error('bulk-assign-many error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Resolve effective number acquisition mode ("request" vs "self_allocate") & quota limits for any user
function resolveAllocationPolicy(sessionUser) {
  const sRole = String(sessionUser?.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const settings = readDb('settings') || {};
  const allowAgtConfig = settings.allow_agent_alloc_config !== false;

  if (isOwner) {
    return {
      mode: 'self_allocate',
      daily_limit: 0,
      total_limit: 0,
      used_today: 0,
      daily_remaining: null,
      total_held: 0,
      pending_requested: 0,
      total_remaining: null,
      can_configure_downline: true,
      allow_agent_alloc_config: allowAgtConfig
    };
  }

  let dbTable = 'users';
  if (sRole === 'agent') dbTable = 'agents';
  else if (sRole === 'client') dbTable = 'clients';

  const records = readDb(dbTable) || [];
  const acct = (Array.isArray(records) ? records.find(x => Number(x.id) === Number(sessionUser.id)) : null) || sessionUser;

  const roleKey = sRole === 'agent' ? 'agent' : 'client';
  const defaultMode = settings[`${roleKey}_alloc_mode`] === 'self_allocate' ? 'self_allocate' : 'request';
  const defaultDaily = Math.max(0, parseInt(settings[`${roleKey}_alloc_daily_limit`], 10) || 0);
  const defaultTotal = Math.max(0, parseInt(settings[`${roleKey}_alloc_total_limit`], 10) || 0);

  const acctMode = acct.alloc_mode === 'self_allocate' || acct.alloc_mode === 'request' ? acct.alloc_mode : null;
  const mode = acctMode || defaultMode;

  const daily_limit = (acct.alloc_daily_limit !== undefined && acct.alloc_daily_limit !== null && acct.alloc_daily_limit !== '')
    ? Math.max(0, parseInt(acct.alloc_daily_limit, 10) || 0)
    : defaultDaily;
  const total_limit = (acct.alloc_total_limit !== undefined && acct.alloc_total_limit !== null && acct.alloc_total_limit !== '')
    ? Math.max(0, parseInt(acct.alloc_total_limit, 10) || 0)
    : defaultTotal;

  const todayIso = new Date().toISOString().slice(0, 10);
  const numbers = readDb('numbers') || [];
  const total_held = Array.isArray(numbers) ? numbers.filter(n => {
    if (!n) return false;
    if (sRole === 'agent') return Number(n.agent_id) === Number(sessionUser.id);
    return Number(n.client_id) === Number(sessionUser.id);
  }).length : 0;

  const requests = readDb('number_requests') || [];
  const myRequests = Array.isArray(requests) ? requests.filter(r => {
    if (!r) return false;
    if (r.requester_role) {
      return String(r.requester_role).toLowerCase() === roleKey && Number(r.requester_id) === Number(sessionUser.id);
    }
    if (sRole === 'client') return Number(r.client_id) === Number(sessionUser.id);
    return Number(r.agent_id) === Number(sessionUser.id) && !r.client_id;
  }) : [];

  const pending_requested = myRequests
    .filter(r => String(r.status || '').toLowerCase() === 'pending')
    .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);

  let used_today = 0;
  if (mode === 'request') {
    used_today = myRequests
      .filter(r => String(r.status || '').toLowerCase() !== 'rejected' && String(r.created || r.timestamp || '').slice(0, 10) === todayIso)
      .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
  } else {
    const history = readDb('allocation_history') || [];
    used_today = Array.isArray(history) ? history.filter(h => {
      if (!h) return false;
      const d = String(h.timestamp || h.created || '').slice(0, 10);
      if (d !== todayIso) return false;
      if (h.to_user_id != null && Number(h.to_user_id) === Number(sessionUser.id) && String(h.to_role || '').toLowerCase() === sRole) return true;
      return String(h.to_user || '').toLowerCase() === String(sessionUser.username || '').toLowerCase()
          && String(h.to_role || '').toLowerCase() === sRole;
    }).reduce((sum, h) => sum + (parseInt(h.count, 10) || 0), 0) : 0;
  }

  const daily_remaining = daily_limit > 0 ? Math.max(0, daily_limit - used_today) : null;
  const total_remaining = total_limit > 0 ? Math.max(0, total_limit - total_held - (mode === 'request' ? pending_requested : 0)) : null;

  return {
    mode,
    daily_limit,
    total_limit,
    used_today,
    daily_remaining,
    total_held,
    pending_requested,
    total_remaining,
    can_configure_downline: sRole === 'agent' && allowAgtConfig,
    allow_agent_alloc_config: allowAgtConfig
  };
}

app.get('/api/numbers/allocation-policy', requireAuth, (req, res) => {
  try {
    const policy = resolveAllocationPolicy(req.sessionUser);
    res.json({ success: true, ...policy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Self Range Allocation Endpoint (Agent / Client when mode === 'self_allocate')
app.post('/api/numbers/agent-allocate', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser?.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    if (!isOwner && !isAgent && !isClient) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const policy = resolveAllocationPolicy(sessionUser);
    if (!isOwner && policy.mode !== 'self_allocate') {
      return res.status(403).json({ error: 'Self-allocate is disabled for your account. Please use Number Request instead.' });
    }

    const { range_name, range_id, count, quantity, payterm } = req.body || {};
    const qty = parseInt(count ?? quantity, 10) || 1;
    if (qty <= 0) return res.status(400).json({ error: 'Quantity must be at least 1' });

    if (!isOwner && !isClient && policy.daily_remaining !== null && qty > policy.daily_remaining) {
      return res.status(400).json({ error: `Daily self-allocate limit exceeded. Remaining today: ${policy.daily_remaining}` });
    }
    if (!isOwner && !isClient && policy.total_remaining !== null && qty > policy.total_remaining) {
      return res.status(400).json({ error: `Overall allocation limit exceeded. Remaining allowed: ${policy.total_remaining}` });
    }

    let numbers = readDb('numbers') || [];
    const rId = range_id ? Number(range_id) : null;
    const cleanRangeName = String(range_name || '').trim().toLowerCase();
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const matchedRng = (rId && wnRangesMap.get(rId)) || (readDb('sms_ranges') || []).find(r => cleanRangeName && String(r.range_name || r.name || '').trim().toLowerCase() === cleanRangeName);
    const wnAllowed = hasWhitenoiseAccess(sessionUser);
    const isWnMatched = (matchedRng && isWhitenoiseRecord(matchedRng, wnRangesMap, wnTags)) || isWhitenoiseText(cleanRangeName);

    if (!isOwner && !wnAllowed && isWnMatched) {
      return res.status(403).json({ error: 'Forbidden. CDR 2 / Monthly Route access is not enabled for your account.' });
    }
    if (isClient && isWnMatched) {
      return res.status(400).json({ error: 'Monthly Route numbers are request-only. Please submit a request to your Agent.' });
    }

    const ptInfo = matchedRng ? resolveRangeActivePayterms(matchedRng, isWnMatched) : { active_payterms: ['Weekly'], primary_payterm: 'Weekly' };
    const targetPayterm = isWnMatched ? 'Monthly' : normalizePaytermKey(payterm || ptInfo.primary_payterm);
    if (matchedRng && payterm && !isWnMatched && !ptInfo.active_payterms.includes(targetPayterm)) {
      return res.status(400).json({ error: `Payterm "${targetPayterm}" is not available on "${matchedRng.range_name || range_name}". Allowed: ${ptInfo.active_payterms.join(', ')}.` });
    }

    if (isClient) {
      const effRid = matchedRng ? Number(matchedRng.id) : rId;
      const effRname = (matchedRng && (matchedRng.range_name || matchedRng.name)) || range_name || '';
      const quota = getClientRangeQuota(sessionUser.id, effRid, effRname, { numbers });
      if (quota.weekly_adds_remaining <= 0) {
        return res.status(429).json({ error: `Weekly limit reached for "${effRname}": max ${CLIENT_RANGE_WEEKLY_ADDS_MAX} additions per week (${quota.weekly_adds_used}/${CLIENT_RANGE_WEEKLY_ADDS_MAX} used).` });
      }
      if (qty > CLIENT_RANGE_DAILY_NUMBERS_MAX || qty > quota.daily_remaining) {
        return res.status(quota.daily_remaining <= 0 ? 429 : 400).json({
          error: `Daily limit for "${effRname}": max ${CLIENT_RANGE_DAILY_NUMBERS_MAX} numbers/day (used ${quota.today_numbers}/${CLIENT_RANGE_DAILY_NUMBERS_MAX}, remaining ${quota.daily_remaining}).`
        });
      }
      if (qty > quota.hold_remaining) {
        return res.status(400).json({
          error: `Active holding limit for "${effRname}": max ${CLIENT_RANGE_ACTIVE_HOLD_MAX} numbers per range (currently ${quota.held_count} held + ${quota.pending_qty} pending). Return numbers first to add more.`
        });
      }
    }

    const effMatchRid = matchedRng ? Number(matchedRng.id) : rId;
    const effMatchRname = (matchedRng && (matchedRng.range_name || matchedRng.name)) || range_name || '';
    const available = numbers.filter(n => {
      if (!n || n.client_id) return false;
      if (String(n.status || '').toLowerCase() === 'blocked') return false;
      if (!isOwner && !wnAllowed && isWhitenoiseRecord(n, wnRangesMap, wnTags)) return false;
      if (!matchesRangeRef(n, effMatchRid, effMatchRname)) return false;

      if (isClient) {
        if (sessionUser.agent_id) {
          return Number(n.agent_id) === Number(sessionUser.agent_id) && !n.client_id;
        }
        return !n.agent_id && !n.client_id;
      }
      return !n.agent_id && !n.client_id;
    });

    if (available.length === 0) {
      return res.status(400).json({
        error: isClient
          ? 'No free numbers are currently available in this range from your Agent. Please choose another range or try again later.'
          : 'No free numbers are currently available in the Owner pool for this range.'
      });
    }

    const toAllocate = available.slice(0, qty);
    const now = new Date().toISOString();

    toAllocate.forEach(n => {
      const isWn = isWhitenoiseRecord(n, wnRangesMap, wnTags);
      const effTerm = isWn ? 'Monthly' : targetPayterm;
      const ptMeta = getPaytermMeta(effTerm);
      if (isClient) {
        n.client_id = sessionUser.id;
        n.client_username = sessionUser.username;
        n.client_name = sessionUser.full_name || sessionUser.username;
        n.user = sessionUser.username;
        n.agent_id = sessionUser.agent_id || n.agent_id || null;
        n.client_payterm = ptMeta.key;
        n.client_assigned_at = now;
      } else if (isAgent) {
        n.agent_id = sessionUser.id;
        n.agent_username = sessionUser.username;
      }
      n.status = 'assigned';
      n.payterm = ptMeta.key;
      n.payout_schedule = ptMeta.schedule;
      n.cycle_days = ptMeta.cycle_days;
      n.hold_days = ptMeta.hold_days;
      if (isWn) {
        if (isClient) n.client_payterm = 'Monthly';
        n.is_whitenoise = true;
      }
      n.assigned_at = now;
      n.assigned_date = now;
      n.updated_at = now;
    });

    writeDb('numbers', numbers);

    const history = readDb('allocation_history') || [];
    const historyEntry = {
      id: nextId(history, 'allocation_history'),
      from_user: isClient ? (sessionUser.agent_id ? 'Agent' : 'Owner') : 'Owner',
      to_user_id: sessionUser.id,
      to_user: sessionUser.username,
      to_role: sessionUser.role,
      range_name: range_name || toAllocate[0]?.range_name || 'General Range',
      count: toAllocate.length,
      sample_start: toAllocate[0]?.number,
      sample_end: toAllocate[toAllocate.length - 1]?.number,
      timestamp: now,
      created: now
    };
    history.unshift(historyEntry);
    writeDb('allocation_history', history);

    logAudit(sessionUser.username, 'Range Self-Allocation', `Self-allocated ${toAllocate.length} numbers from ${historyEntry.range_name}`, 'Numbers');

    res.json({ success: true, allocated: toAllocate.length, range_name: historyEntry.range_name });
  } catch (err) {
    console.error('agent-allocate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk Allocate Numbers (Direct 3-Tier: Owner -> Agent -> Client)
app.post('/api/numbers/bulk-allocate', (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    const sRole = (sessionUser?.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    const targetType = (req.body.target_type || 'client').toLowerCase();
    const targetId = Number(req.body.target_id || req.body.client_id);
    const count = parseInt(req.body.count) || 0;
    const rangeId = req.body.range_id ? Number(req.body.range_id) : null;
    const rangeStart = String(req.body.range_start || '').trim();
    const rangeEnd = String(req.body.range_end || '').trim();
    const notes = req.body.notes || '';

    if (!targetId) return res.status(400).json({ error: 'target_id is required' });

    if (isOwner && targetType !== 'agent') {
      return res.status(403).json({ error: 'Owner can only allocate numbers directly to Agents.' });
    }
    if (isAgent && targetType !== 'client') {
      return res.status(403).json({ error: 'Agents can only allocate numbers to Clients.' });
    }

    const rawPayterm = String(req.body.payterm || '').trim();
    let allocPayterm = null;
    if (rawPayterm && rawPayterm !== 'From range' && rawPayterm !== 'from_range') {
      const norm = normalizePaytermKey(rawPayterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid payterm "${rawPayterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
      allocPayterm = norm;
      req.body.payterm = norm;
    }
    if (req.body.client_payterm) {
      const norm = normalizePaytermKey(req.body.client_payterm);
      if (!isValidPayterm(norm)) {
        return res.status(400).json({ error: `Invalid client_payterm "${req.body.client_payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
      }
      req.body.client_payterm = norm;
    }

    let toUsername = '';
    let toRole = '';
    let parentAgentId = null;
    let targetAgentRec = null;
    let targetClientRec = null;

    if (targetType === 'agent') {
      const agents = readDb('agents') || [];
      const ag = agents.find(a => Number(a.id) === targetId);
      if (!ag) return res.status(404).json({ error: 'Agent not found' });
      targetAgentRec = ag;
      toUsername = ag.username;
      toRole = 'Agent';
    } else {
      const clients = readDb('clients') || [];
      const cl = clients.find(c => Number(c.id) === targetId);
      if (!cl) return res.status(404).json({ error: 'Client not found' });
      if (isAgent && Number(cl.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Client does not belong to your agent account.' });
      }
      targetClientRec = cl;
      toUsername = cl.username;
      toRole = 'Client';
      parentAgentId = cl.agent_id || null;
    }

    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const wnAllowed = hasWhitenoiseAccess(sessionUser);
    let numbers = readDb('numbers') || [];
    let pool = isAgent
      ? numbers.filter(n => Number(n.agent_id) === Number(sessionUser.id) && !n.client_id && String(n.status || '').toLowerCase() !== 'blocked')
      : numbers.filter(n => !n.agent_id && !n.client_id && String(n.status || '').toLowerCase() !== 'blocked');

    let rng = null;
    if (rangeId) {
      const ranges = readDb('sms_ranges') || [];
      rng = ranges.find(r => Number(r.id) === rangeId);
      if (rng) {
        if (!isOwner && !wnAllowed && isWhitenoiseRecord(rng, wnRangesMap, wnTags)) {
          return res.status(403).json({ error: 'Forbidden. Whitenoise access is not enabled for your account.' });
        }
        pool = pool.filter(n => (n.range_id && Number(n.range_id) === rangeId) || (n.country === rng.country && n.provider === rng.provider));
      }
    } else if (rangeStart && rangeEnd) {
      pool = pool.filter(n => {
        const num = String(n.number || '');
        return num >= rangeStart && num <= rangeEnd;
      });
    }

    if (!isOwner && !wnAllowed) {
      pool = pool.filter(n => !isWhitenoiseRecord(n, wnRangesMap, wnTags));
    }

    if (!pool.length) {
      return res.status(400).json({ error: 'No free numbers available for this selection' });
    }

    const allocCount = count > 0 ? Math.min(count, pool.length) : pool.length;
    const selectedNumbers = pool.slice(0, allocCount);
    const hasWnSelected = selectedNumbers.some(n => isWhitenoiseRecord(n, wnRangesMap, wnTags)) || (rng && isWhitenoiseRecord(rng, wnRangesMap, wnTags));

    // Enforce max 50 active held numbers per range per client on bulk allocation
    if (targetType === 'client' && targetClientRec) {
      const perRangeAddCounts = new Map();
      for (const sn of selectedNumbers) {
        const key = sn.range_id ? `id:${sn.range_id}` : `name:${String(sn.range_name || '').trim().toLowerCase()}`;
        if (!perRangeAddCounts.has(key)) perRangeAddCounts.set(key, { rid: sn.range_id, rname: sn.range_name || (rng && rng.range_name) || '', add: 0 });
        perRangeAddCounts.get(key).add++;
      }
      for (const info of perRangeAddCounts.values()) {
        const curHeld = numbers.filter(x => x && Number(x.client_id) === Number(targetId) && matchesRangeRef(x, info.rid, info.rname)).length;
        if (curHeld + info.add > CLIENT_RANGE_ACTIVE_HOLD_MAX) {
          return res.status(400).json({
            error: `Client "${targetClientRec.username}" cannot hold more than ${CLIENT_RANGE_ACTIVE_HOLD_MAX} numbers in "${info.rname || 'this range'}" (currently ${curHeld} held, trying to add ${info.add}).`
          });
        }
      }
    }

    if (hasWnSelected) {
      if (!wnAllowed) {
        return res.status(403).json({ error: 'Forbidden. Whitenoise access is not enabled for your account.' });
      }
      if (targetType === 'agent' && targetAgentRec && !hasWhitenoiseAccess({ role: 'Agent', id: targetAgentRec.id, whitenoise_access: targetAgentRec.whitenoise_access })) {
        return res.status(403).json({ error: `Agent "${targetAgentRec.username}" does not have Whitenoise access enabled.` });
      }
      if (targetType === 'client' && targetClientRec && !hasWhitenoiseAccess({ role: 'Client', id: targetClientRec.id, agent_id: targetClientRec.agent_id, whitenoise_access: targetClientRec.whitenoise_access })) {
        return res.status(403).json({ error: `Client "${targetClientRec.username}" (or their parent Agent) does not have Whitenoise access enabled.` });
      }
    }

    const selectedIds = new Set(selectedNumbers.map(n => n.id));
    const rngLabel = rng ? (rng.range_name || rng.name || rng.country) : (rangeStart && rangeEnd ? `${rangeStart} - ${rangeEnd}` : 'Direct');

    const allRangesBulk = readDb('sms_ranges') || [];
    const explicitBulkRate = (req.body.client_rate !== undefined && req.body.client_rate !== null && !isNaN(Number(req.body.client_rate)))
      ? Number(req.body.client_rate)
      : ((req.body.client_payout !== undefined && req.body.client_payout !== null && !isNaN(Number(req.body.client_payout))) ? Number(req.body.client_payout) : null);

    if (rng) {
      const isWnRangeObj = isWhitenoiseRecord(rng, wnRangesMap, wnTags);
      const rngPtInfo = resolveRangeActivePayterms(rng, isWnRangeObj);
      if (allocPayterm && !rngPtInfo.active_payterms.includes(allocPayterm)) {
        return res.status(400).json({ error: `Payterm "${allocPayterm}" is not active on range "${rng.range_name || rng.name}". Allowed: ${rngPtInfo.active_payterms.join(', ')}.` });
      }
      if (req.body.client_payterm && !rngPtInfo.active_payterms.includes(req.body.client_payterm)) {
        return res.status(400).json({ error: `Client payterm "${req.body.client_payterm}" is not active on range "${rng.range_name || rng.name}". Allowed: ${rngPtInfo.active_payterms.join(', ')}.` });
      }
    }

    const bulkAllocNowIso = new Date().toISOString();
    numbers = numbers.map(n => {
      if (selectedIds.has(n.id)) {
        const isWn = isWhitenoiseRecord(n, wnRangesMap, wnTags) || (rng && isWhitenoiseRecord(rng, wnRangesMap, wnTags));
        const rObj = rng || allRangesBulk.find(r => Number(r.id) === Number(n.range_id)) || allRangesBulk.find(r => r.range_name === n.range_name);
        const ptInfo = rObj ? resolveRangeActivePayterms(rObj, isWn) : { active_payterms: [isWn ? 'Monthly' : 'Weekly'], primary_payterm: isWn ? 'Monthly' : 'Weekly' };
        const candTargetTerm = normalizePaytermKey(allocPayterm || n.payterm || ptInfo.primary_payterm);
        const effTargetTerm = isWn ? 'Monthly' : (ptInfo.active_payterms.includes(candTargetTerm) ? candTargetTerm : ptInfo.primary_payterm);
        const ptMeta = getPaytermMeta(effTargetTerm);
        const paytermUpdate = isWn
          ? { payterm: 'Monthly', is_whitenoise: true, payout_schedule: 'monthly30_5', cycle_days: 30, hold_days: 5 }
          : { payterm: ptMeta.key, payout_schedule: ptMeta.schedule, cycle_days: ptMeta.cycle_days, hold_days: ptMeta.hold_days };
        if (targetType === 'agent') {
          const agRate = getRangeAgentRate(rObj, ptMeta.key);
          return { ...n, ...paytermUpdate, agent_rate: agRate || n.agent_rate, payout: agRate || n.payout, agent_id: targetId, agent_name: toUsername, agent_username: toUsername, client_id: null, client_name: '', client_username: '', user: toUsername, status: 'assigned', assigned_at: bulkAllocNowIso, assigned_date: bulkAllocNowIso, allocated_at: bulkAllocNowIso, notes };
        } else {
          const effAgId = parentAgentId || (isAgent ? Number(sessionUser.id) : n.agent_id || null);
          const candClTerm = normalizePaytermKey(req.body.client_payterm || allocPayterm || n.client_payterm || n.payterm || ptInfo.primary_payterm);
          const effClientPayterm = isWn ? 'Monthly' : (ptInfo.active_payterms.includes(candClTerm) ? candClTerm : ptInfo.primary_payterm);
          const clPtMeta = getPaytermMeta(effClientPayterm);
          const agRate = Number(n.agent_rate || 0) || getRangeAgentRate(rObj, effTargetTerm);
          const rp = resolveClientRatePair({
            agentId: effAgId,
            rangeId: n.range_id || (rObj && rObj.id),
            rangeName: n.range_name || (rObj && rObj.range_name),
            payterm: clPtMeta.key,
            agentRateUsd: agRate,
            explicitClientRate: explicitBulkRate,
            clientRecord: targetClientRec
          });
          return {
            ...n,
            ...paytermUpdate,
            agent_id: effAgId,
            client_id: targetId,
            client_name: toUsername,
            client_username: toUsername,
            user: toUsername,
            client_payterm: clPtMeta.key,
            payout_schedule: clPtMeta.schedule,
            cycle_days: clPtMeta.cycle_days,
            hold_days: clPtMeta.hold_days,
            client_rate: rp.client_rate,
            client_payout: rp.client_rate,
            client_rate_pkr: rp.client_rate_pkr,
            client_currency: rp.client_currency,
            fx_usd_to_pkr: rp.fx_usd_to_pkr,
            rate_source: rp.source,
            status: 'assigned',
            assigned_at: bulkAllocNowIso,
            assigned_date: bulkAllocNowIso,
            client_assigned_at: bulkAllocNowIso,
            allocated_at: bulkAllocNowIso,
            notes
          };
        }
      }
      return n;
    });

    writeDb('numbers', numbers);

    const history = readDb('allocation_history') || [];
    const entry = {
      id: nextId(history, 'allocation_history'),
      from_user: isOwner ? 'Owner' : (sessionUser?.username || 'Agent'),
      to_user: toUsername,
      to_role: toRole,
      target_id: targetId,
      agent_id: targetType === 'agent' ? targetId : null,
      range_id: rangeId,
      range_name: rngLabel,
      payterm: hasWnSelected ? 'Monthly' : (allocPayterm || (rng?.payterm || 'From range')),
      range_start: rangeStart,
      range_end: rangeEnd,
      count: allocCount,
      number_ids: Array.from(selectedIds),
      timestamp: new Date().toISOString(),
      status: 'completed',
      notes: notes
    };
    history.unshift(entry);
    writeDb('allocation_history', history);

    logAudit(isOwner ? 'Owner' : (sessionUser?.username || 'Agent'), 'Bulk Allocate', `Allocated ${allocCount} numbers to ${toRole} '${toUsername}'`, 'Numbers');

    const firstBulk = numbers.find(n => selectedIds.has(n.id)) || {};
    const bulkTermLabel = formatNotifPayterm(
      targetType === 'client' ? (firstBulk.client_payterm || firstBulk.payterm || entry.payterm) : (firstBulk.payterm || entry.payterm),
      Boolean(hasWnSelected || firstBulk.is_whitenoise)
    );
    if (targetType === 'client') {
      const rateLabel = formatNotifRate(firstBulk.client_rate_pkr, 'PKR') || formatNotifRate(firstBulk.client_rate, 'USD');
      sendInstantNotification({
        recipient_role: 'client',
        recipient_id: targetId,
        recipient_username: toUsername,
        title: `Numbers Added (+${allocCount}) — ${rngLabel}`,
        message: `${allocCount} number(s) added to your panel in range "${rngLabel}" on ${bulkTermLabel} term${rateLabel ? ` at ${rateLabel}` : ''} by ${sessionUser?.username || 'Agent'}.`,
        type: 'allocation',
        category: 'numbers',
        action_page: 'my-numbers',
        payterm: bulkTermLabel,
        rate_label: rateLabel,
        status: 'added',
        count: allocCount,
        range_id: rangeId,
        range_name: rngLabel,
        actor_role: 'Agent',
        actor_name: sessionUser?.username || 'Agent'
      });
    } else if (targetType === 'agent') {
      const rateLabel = formatNotifRate(firstBulk.agent_rate || firstBulk.payout, 'USD');
      sendInstantNotification({
        recipient_role: 'agent',
        recipient_id: targetId,
        recipient_username: toUsername,
        title: `Numbers Allocated (+${allocCount}) — ${rngLabel}`,
        message: `Owner allocated ${allocCount} number(s) in range "${rngLabel}" on ${bulkTermLabel} term${rateLabel ? ` at ${rateLabel}` : ''}.`,
        type: 'allocation',
        category: 'numbers',
        action_page: 'my-sms-numbers',
        payterm: bulkTermLabel,
        rate_label: rateLabel,
        status: 'allocated',
        count: allocCount,
        range_id: rangeId,
        range_name: rngLabel,
        actor_role: 'Owner',
        actor_name: 'Kamran_Bhatti'
      });
    }

    res.json({ success: true, allocated: allocCount, to_user: toUsername, ...entry });
  } catch (err) {
    console.error('bulk-allocate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Undo Allocation Endpoint ──────────────────────────────────────
app.post('/api/numbers/allocation-history/:id/undo', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser?.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    if (!isOwner && !isAgent) return res.status(403).json({ error: 'Access denied' });

    const id = Number(req.params.id);
    const history = readDb('allocation_history') || [];
    const entry = history.find(h => Number(h.id) === id);
    if (!entry) return res.status(404).json({ error: 'Allocation record not found' });
    if (entry.status === 'undone') return res.status(400).json({ error: 'This allocation has already been undone.' });

    if (!isOwner) {
      const fromMe = String(entry.from_user || '').toLowerCase() === String(sessionUser.username || '').toLowerCase() ||
                     (entry.from_user_id && Number(entry.from_user_id) === Number(sessionUser.id));
      if (!fromMe) {
        return res.status(403).json({ error: 'Permission denied: You can only undo allocations created by you.' });
      }
    }

    let numbers = readDb('numbers') || [];
    const numIdSet = new Set((entry.number_ids || []).map(Number));
    if (numIdSet.size === 0) {
      return res.status(400).json({ error: 'Cannot undo allocation: No specific number IDs recorded in this allocation entry.' });
    }

    const toRole = String(entry.to_role || '').toLowerCase();

    if (toRole === 'agent' || (!toRole && entry.agent_id)) {
      const downstreamAssigned = numbers.filter(n => numIdSet.has(Number(n.id)) && n.client_id);
      if (downstreamAssigned.length > 0) {
        return res.status(400).json({
          error: `Cannot undo: ${downstreamAssigned.length} number(s) have already been allocated to clients downstream. Revoke them from clients first.`
        });
      }
    }

    let revertedCount = 0;
    numbers = numbers.map(n => {
      if (!numIdSet.has(Number(n.id))) return n;
      revertedCount++;

      if (toRole === 'client' || n.client_id) {
        const agentStillAssigned = Boolean(n.agent_id || entry.agent_id);
        return {
          ...n,
          client_id: null,
          client_name: '',
          client_username: '',
          client_rate: 0,
          user: n.agent_name || n.agent_username || '',
          status: agentStillAssigned ? 'assigned' : 'unassigned'
        };
      } else {
        return {
          ...n,
          client_id: null,
          client_name: '',
          client_username: '',
          client_rate: 0,
          agent_id: null,
          agent_name: '',
          agent_username: '',
          agent_rate: 0,
          user: '',
          status: 'unassigned'
        };
      }
    });

    writeDb('numbers', numbers);
    entry.status = 'undone';
    entry.undone_at = new Date().toISOString();
    entry.undone_by = sessionUser.username;
    writeDb('allocation_history', history);

    // Notify the recipient user
    if (entry.to_user) {
      sendInstantNotification({
        recipient_role: entry.to_role ? String(entry.to_role).toLowerCase() : 'all',
        recipient_username: entry.to_user,
        title: 'Numbers Recalled',
        message: `${revertedCount} number(s) from allocation #${id} were recalled by ${sessionUser.username}.`,
        type: 'warning',
        count: revertedCount,
        actor_role: sessionUser.role,
        actor_name: sessionUser.username
      });
    }

    logAudit(sessionUser.username, 'Undo Allocation', `Undid allocation #${id} (${revertedCount} numbers recalled from ${entry.to_user})`, 'Numbers');
    res.json({ success: true, message: `Successfully recalled ${revertedCount} number(s) back to your pool.`, count: revertedCount });
  } catch (err) {
    console.error('undo allocation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Export Allocation Numbers (TXT / CSV HUMEX SMS standard) ─────────
app.get('/api/numbers/allocation-history/:id/export', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const format = String(req.query.format || 'txt').toLowerCase();
    const history = readDb('allocation_history') || [];
    const entry = history.find(h => Number(h.id) === id);
    if (!entry) return res.status(404).send('Not found');

    const numbers = readDb('numbers') || [];
    const numIdSet = new Set((entry.number_ids || []).map(Number));
    let matched = numbers.filter(n => numIdSet.has(Number(n.id)));
    if (!matched.length && entry.range_id) {
      matched = numbers.filter(n => Number(n.range_id) === Number(entry.range_id)).slice(0, entry.count || 25);
    }

    if (format === 'csv') {
      const header = 'Number,Range,Status,AssignedTo\n';
      const rows = matched.map(n => `"${n.number}","${n.range_name || ''}","${n.status || ''}","${entry.to_user || ''}"`).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="allocation_${id}.csv"`);
      return res.send(header + rows);
    } else {
      const lines = matched.map(n => n.number).join('\n');
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="allocation_${id}.txt"`);
      return res.send(lines);
    }
  } catch (err) {
    res.status(500).send('Export error: ' + err.message);
  }
});



registerPaginatedCrud('agents', 'agents');
registerPaginatedCrud('clients', 'clients');
registerPaginatedCrud('users', 'users');

// ── Balance Adjustment Endpoint with RBAC ──────────────────────
app.post('/api/:table(agents|clients|users)/:id/adjust-balance', requireAuth, (req, res) => {
  const { table, id: rawId } = req.params;
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgent = sRole === 'agent';

  if (table === 'clients' && isOwner) {
    return res.status(403).json({ error: 'Access denied. Client accounts and balances are strictly private to their managing Agent.' });
  }

  const rows = readDb(table) || [];
  const targetId = Number(rawId);
  const idx = rows.findIndex(r => r && (Number(r.id) === targetId || String(r.id) === String(rawId)));
  if (idx === -1) {
    return res.status(404).json({ error: `${table.slice(0, -1)} not found` });
  }

  const target = rows[idx];

  // Block manual balance adjustments on Agent accounts — Agent balances are auto-earned only
  if (table === 'agents' || (table === 'users' && String(target.role || '').toLowerCase() === 'agent')) {
    return res.status(403).json({ error: 'Agent balances are earned automatically from SMS traffic and cannot be manually adjusted.' });
  }

  // RBAC Permission checks: Agent can adjust his downline clients; Owner cannot manually adjust agents
  if (!isOwner) {
    if (table === 'users' || table === 'agents') {
      return res.status(403).json({ error: `Forbidden. Only Owner can adjust ${table.slice(0, -1)} balances.` });
    }
    if (table === 'clients') {
      if (isAgent) {
        if (Number(target.agent_id) !== Number(sessionUser.id) && String(target.agent_username || '').toLowerCase() !== String(sessionUser.username).toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden. You can only adjust balances for your downline clients.' });
        }
      } else {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to adjust balances.' });
      }
    }
  }

  const { operation = 'add', amount = 0, reason = '', currency = '' } = req.body || {};
  const amt = Number(amount);
  if (isNaN(amt) || amt < 0) {
    return res.status(400).json({ error: 'Amount must be a valid non-negative number.' });
  }

  const fx = getUsdToPkrRate();
  const curNorm = String(currency || '').trim().toUpperCase();
  const isPkrClientOp = table === 'clients' && curNorm === 'PKR';
  const before = Number(target.balance || 0);
  const beforePkr = target.balance_pkr != null ? Number(target.balance_pkr) : round2(before * fx);
  let after = before;
  let afterPkr = beforePkr;
  const op = String(operation).toLowerCase();

  if (isPkrClientOp) {
    if (op === 'add') afterPkr = round2(beforePkr + amt);
    else if (op === 'subtract') afterPkr = Math.max(0, round2(beforePkr - amt));
    else if (op === 'set') afterPkr = round2(amt);
    else return res.status(400).json({ error: 'Invalid operation. Must be add, subtract, or set.' });
    after = round6(afterPkr / fx);
  } else {
    if (op === 'add') after = before + amt;
    else if (op === 'subtract') after = Math.max(0, before - amt);
    else if (op === 'set') after = amt;
    else return res.status(400).json({ error: 'Invalid operation. Must be add, subtract, or set.' });
    after = Math.round(after * 100) / 100;
    if (table === 'clients') {
      const deltaUsd = after - before;
      afterPkr = op === 'set' ? round2(after * fx) : Math.max(0, round2(beforePkr + deltaUsd * fx));
    }
  }

  target.balance = after;
  if (table === 'clients') {
    target.balance_pkr = afterPkr;
  }
  rows[idx] = target;
  writeDb(table, rows);

  logAudit(sessionUser.username, `Balance Adjustment (${op})`, `${table} #${target.id} (${target.username}): ${before} -> ${after}${table === 'clients' ? ` (PKR ${beforePkr} -> ${afterPkr})` : ''}. Reason: ${reason}`, 'Finance');

  res.json({
    success: true,
    before,
    after,
    ...(table === 'clients' ? { before_pkr: beforePkr, after_pkr: afterPkr } : {}),
    user: safeUser(target)
  });
});

// ── Owner-only System Announcements & Global Broadcasts ─────────
app.post('/api/announcements', requireAuth, (req, res) => {
  try {
    const sRole = normRole(req.sessionUser && req.sessionUser.role);
    if (sRole !== 'owner') {
      return res.status(403).json({ error: 'Only the System Owner (Kamran_Bhatti) can send broadcasts and announcements.' });
    }
    let announcements = readDb('announcements');
    if (!Array.isArray(announcements)) announcements = [];

    const { title, body, type, is_popup, target_role, recipient_role, role: reqRole } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }

    const now = new Date().toISOString();
    const effectiveTarget = (target_role || recipient_role || reqRole || 'All').toLowerCase();
    const isPopup = is_popup !== false; // Default true for pop-up

    const entry = {
      id: nextId(announcements, 'announcements'),
      title: title.trim(),
      body: body.trim(),
      type: type || 'info',
      role: effectiveTarget === 'all' ? 'All' : (effectiveTarget.charAt(0).toUpperCase() + effectiveTarget.slice(1)),
      target_role: effectiveTarget,
      is_popup: isPopup,
      is_broadcast: true,
      sender_role: 'Owner',
      sender_name: 'Kamran_Bhatti (Owner)',
      created: now,
      created_at: now
    };

    announcements.unshift(entry);
    if (announcements.length > 500) announcements.pop();
    writeDb('announcements', announcements);

    // Also trigger instant notification
    const notif = sendInstantNotification({
      recipient_role: effectiveTarget,
      title: `📢 Announcement from Owner: ${entry.title}`,
      message: entry.body,
      type: entry.type === 'warning' ? 'warning' : 'announcement',
      actor_role: 'Owner',
      actor_name: 'Kamran_Bhatti',
      metadata: {
        is_popup: isPopup,
        announcement_id: entry.id
      }
    });

    // Real-time broadcast specifically for popup modal
    broadcastWs({
      type: 'owner_broadcast',
      data: entry,
      notification: notif
    });

    logAudit('Owner', 'Broadcast Announcement', `Broadcast "${entry.title}" to ${effectiveTarget}`, 'Announcements');

    res.json(entry);
  } catch (err) {
    console.error('POST /api/announcements error:', err);
    res.status(500).json({ error: err.message });
  }
});

registerPaginatedCrud('announcements', 'announcements');
registerPaginatedCrud('audit-logs', 'audit_logs');

// Clear/Wipe Audit Logs (Owner/Admin only)
app.post(['/api/audit-logs/clear', '/api/audit-logs/wipe'], requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('audit_logs', []);
  res.json({ success: true, message: 'Audit logs cleared successfully' });
});
app.delete('/api/audit-logs', requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('audit_logs', []);
  res.json({ success: true, message: 'Audit logs cleared successfully' });
});

// Clear/Wipe Login Activity (Owner/Admin only)
app.post(['/api/login-activity/clear', '/api/login-activity/wipe'], requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('login_activity', []);
  res.json({ success: true, message: 'Login activity cleared successfully' });
});
app.delete('/api/login-activity', requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('login_activity', []);
  res.json({ success: true, message: 'Login activity cleared successfully' });
});

// Clear/Wipe Firewall Events (Owner/Admin only)
app.post(['/api/firewall/events/clear', '/api/firewall/events/wipe'], requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('firewall_events', []);
  res.json({ success: true, message: 'Firewall events cleared successfully' });
});
app.delete('/api/firewall/events', requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('firewall_events', []);
  res.json({ success: true, message: 'Firewall events cleared successfully' });
});

// Clear/Wipe Announcements (Owner/Admin only)
app.post(['/api/announcements/clear', '/api/announcements/wipe'], requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('announcements', []);
  res.json({ success: true, message: 'Announcements cleared successfully' });
});
app.delete('/api/announcements', requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('announcements', []);
  res.json({ success: true, message: 'Announcements cleared successfully' });
});

registerPaginatedCrud('firewall/events', 'firewall_events');
registerPaginatedCrud('rate-limits', 'rate_limits');
registerPaginatedCrud('payout-requests', 'payout_requests');
registerPaginatedCrud('bank-accounts', 'bank_accounts');
registerPaginatedCrud('number-transfers', 'number_transfers');
app.post('/api/number-transfers/:id/cancel', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';

  if (!isOwner) {
    return res.status(403).json({ success: false, error: 'Only Owner can cancel number transfers.' });
  }

  const transferId = Number(req.params.id);
  const transfers = readDb('number_transfers') || [];
  const idx = transfers.findIndex(t => Number(t.id) === transferId);

  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Transfer not found.' });
  }

  transfers[idx].status = 'cancelled';
  transfers[idx].updated_at = new Date().toISOString();
  writeDb('number_transfers', transfers);

  logAudit(sessionUser.username, 'Cancel Transfer', `Cancelled number transfer #${transferId}`, 'Transfers');
  return res.json({ success: true, message: 'Transfer cancelled successfully', transfer: transfers[idx] });
});
registerPaginatedCrud('login-activity', 'login_activity');

// ── Notifications Endpoints (Real-Time Role-Aware) ───────────
app.get('/api/notifications/preferences', (req, res) => {
  try {
    const su = req.sessionUser;
    if (!su) return res.status(401).json({ error: 'Unauthorized' });
    const found = findUserAnywhere(su.username);
    const prefs = normalizeNotificationPrefs(found && found.user && found.user.notification_prefs);
    res.json({ success: true, preferences: prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/preferences', (req, res) => {
  try {
    const su = req.sessionUser;
    if (!su) return res.status(401).json({ error: 'Unauthorized' });
    const found = findUserAnywhere(su.username);
    if (!found || !found.table) return res.status(404).json({ error: 'User account not found' });
    const rows = readDb(found.table) || [];
    const idx = rows.findIndex(r => r && (Number(r.id) === Number(found.user.id) || String(r.username || '').toLowerCase() === String(su.username || '').toLowerCase()));
    if (idx === -1) return res.status(404).json({ error: 'User account not found' });
    const nextPrefs = normalizeNotificationPrefs(req.body && req.body.preferences ? req.body.preferences : req.body);
    rows[idx].notification_prefs = nextPrefs;
    rows[idx].updated_at = new Date().toISOString();
    writeDb(found.table, rows);
    res.json({ success: true, preferences: nextPrefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notifications', (req, res) => {
  try {
    const notifications = readDb('notifications') || [];
    let { role, recipient_username, unread, category, q, scope } = req.query;
    const su = req.sessionUser;
    const sr = normRole(su && su.role);
    let list = Array.isArray(notifications) ? [...notifications] : [];

    if (sr !== 'owner') {
      list = list.filter(n => canAccessNotification(su, n));
    } else {
      const wantAll = scope === 'all' || role === 'all';
      if (!wantAll) {
        const targetRoleFilter = role ? String(role).trim().toLowerCase() : 'owner';
        list = list.filter(n => {
          const nr = String(n.recipient_role ?? n.role ?? '').trim().toLowerCase();
          if (targetRoleFilter === 'owner' || targetRoleFilter === 'admin') {
            return !nr || nr === 'owner' || nr === 'admin' || nr === 'all';
          }
          return nr === targetRoleFilter;
        });
      }
      if (recipient_username) {
        const uname = String(recipient_username).trim().toLowerCase();
        list = list.filter(n => {
          const targetU = n.recipient_username ?? n.username;
          if (!targetU) return true;
          return String(targetU).trim().toLowerCase() === uname;
        });
      }
    }

    const unreadCount = list.filter(n => !n.read).length;

    if (unread === 'true' || unread === '1') {
      list = list.filter(n => !n.read);
    }
    if (category && category !== 'all') {
      const cat = String(category).trim().toLowerCase();
      list = list.filter(n => inferNotifCategory(n.type, n.category || n.metadata?.category) === cat);
    }
    if (q && String(q).trim()) {
      const needle = String(q).trim().toLowerCase();
      list = list.filter(n =>
        String(n.title || '').toLowerCase().includes(needle) ||
        String(n.message || n.body || '').toLowerCase().includes(needle) ||
        String(n.range_name || '').toLowerCase().includes(needle) ||
        String(n.actor_name || '').toLowerCase().includes(needle)
      );
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const start = (page - 1) * limit;

    const sliced = list.slice(start, start + limit).map(n => ({
      ...n,
      category: inferNotifCategory(n.type, n.category || n.metadata?.category)
    }));

    res.json({
      data: sliced,
      unread_count: unreadCount,
      total: list.length
    });
  } catch (err) {
    console.error('GET /api/notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

function canAccessNotification(su, n) {
  if (!su || !n) return false;
  const sr = normRole(su.role);
  if (sr === 'owner') return true;
  const rid = Number(su.id);
  const uname = String(su.username || '').trim().toLowerCase();
  const nr = String(n.recipient_role ?? n.role ?? '').trim().toLowerCase();
  if (nr && nr !== 'all' && nr !== sr) return false;
  const targetId = n.recipient_id ?? n.user_id;
  if (targetId != null && Number(targetId) !== rid) return false;
  const targetUname = n.recipient_username ?? n.username;
  if (targetUname && String(targetUname).trim().toLowerCase() !== uname) return false;
  return true;
}

// Professional Header Notification & Live Activity Feed (Strictly Top 5 for Bell Dropdown)
app.get('/api/notifications/header-feed', (req, res) => {
  try {
    const notifications = readDb('notifications') || [];
    let smsLog = readDb('sms_log') || [];
    const announcements = readDb('announcements') || [];
    const su = req.sessionUser;
    const sr = normRole(su && su.role);
    const isOwner = sr === 'owner';

    const uname = String(su.username || '').trim().toLowerCase();
    const rid = isOwner ? (req.query.recipient_id ? Number(req.query.recipient_id) : null) : Number(su.id);

    // Filter user notifications strictly by role
    let filteredNotifs = Array.isArray(notifications) ? [...notifications] : [];
    if (!isOwner) {
      filteredNotifs = filteredNotifs.filter(n => canAccessNotification(su, n));
    } else {
      filteredNotifs = filteredNotifs.filter(n => {
        const nr = String(n.recipient_role ?? n.role ?? '').trim().toLowerCase();
        return !nr || nr === 'owner' || nr === 'admin' || nr === 'all';
      });
    }
    const unreadCount = filteredNotifs.filter(n => !n.read).length;

    // Strictly scope SMS records by session role & chain (NEVER fall back to all logs when 0 matches)
    let recentSms = [];
    if (sr === 'owner') {
      recentSms = Array.isArray(smsLog) ? [...smsLog] : [];
    } else if (sr === 'agent' && rid) {
      recentSms = (Array.isArray(smsLog) ? smsLog : []).filter(s => Number(s.agent_id) === rid);
    } else if (sr === 'client') {
      recentSms = (Array.isArray(smsLog) ? smsLog : []).filter(s =>
        (rid && Number(s.client_id) === rid) ||
        (uname && ((s.user || '').toLowerCase() === uname || (s.client_username || '').toLowerCase() === uname))
      );
    } else {
      recentSms = [];
    }

    const latestSms = recentSms.slice(0, 8).map(s => {
      if (sr === 'client') {
        return { ...s, cli: serverMaskCli(s.cli || s.app || s.sender) };
      }
      return s;
    });

    // Latest Owner Broadcast (for popup modal on open)
    const latestBroadcast = (Array.isArray(announcements) ? announcements : []).find(a => {
      const aRole = (a.role || a.target_role || 'All').toLowerCase();
      const isOwnerPost = a.sender_role === 'Owner' || a.sender_role === 'Admin' || a.is_broadcast;
      const targetMatches = aRole === 'all' || aRole === sr || sr === 'owner';
      return isOwnerPost && targetMatches && a.is_popup !== false;
    }) || null;

    const foundUser = findUserAnywhere(su.username);
    const prefs = normalizeNotificationPrefs(foundUser && foundUser.user && foundUser.user.notification_prefs);

    res.json({
      notifications: filteredNotifs.slice(0, 5).map(n => ({
        ...n,
        category: inferNotifCategory(n.type, n.category || n.metadata?.category)
      })),
      unread_count: unreadCount,
      total_count: filteredNotifs.length,
      preferences: prefs,
      recent_sms: latestSms,
      latest_broadcast: latestBroadcast
    });
  } catch (err) {
    console.error('GET /api/notifications/header-feed error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications', (req, res) => {
  try {
    const notif = sendInstantNotification(req.body);
    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/:id/read', (req, res) => {
  try {
    const notifications = readDb('notifications') || [];
    const id = Number(req.params.id);
    const notif = notifications.find(n => n.id === id);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    if (!canAccessNotification(req.sessionUser, notif)) {
      return res.status(403).json({ error: 'Forbidden. Cannot mark another user notification as read.' });
    }
    notif.read = true;
    writeDb('notifications', notifications);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/mark-all-read', (req, res) => {
  try {
    let notifications = readDb('notifications') || [];
    const su = req.sessionUser;
    const sr = normRole(su && su.role);
    const { role, recipient_id, recipient_username, scope } = req.body || {};
    const ownerTargetRole = sr === 'owner'
      ? (scope === 'all' ? '' : String(role || 'owner').trim().toLowerCase())
      : '';
    notifications.forEach(n => {
      if (sr !== 'owner') {
        if (canAccessNotification(su, n)) n.read = true;
      } else {
        let match = true;
        const nr = String(n.recipient_role ?? n.role ?? '').trim().toLowerCase();
        if (ownerTargetRole) {
          if (ownerTargetRole === 'owner' || ownerTargetRole === 'admin') {
            if (nr && nr !== 'owner' && nr !== 'admin' && nr !== 'all') match = false;
          } else if (nr !== 'all' && nr !== ownerTargetRole) {
            match = false;
          }
        }
        if (recipient_id && n.recipient_id && Number(n.recipient_id) !== Number(recipient_id)) match = false;
        if (recipient_username && n.recipient_username && n.recipient_username.toLowerCase() !== String(recipient_username).toLowerCase()) match = false;
        if (match) n.read = true;
      }
    });
    writeDb('notifications', notifications);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wipe & Clean Notifications endpoints (Clean & Wipe functionality)
app.all(['/api/notifications/wipe', '/api/notifications/clear'], (req, res) => {
  try {
    let notifications = readDb('notifications') || [];
    let { role, recipient_id, recipient_username, clear_all } = req.body || {};
    const su = req.sessionUser;
    const sr = normRole(su && su.role);
    if (sr !== 'owner') {
      role = sr;
      recipient_id = su ? su.id : null;
      recipient_username = su ? su.username : '';
      clear_all = false;
    } else {
      if (req.query && req.query.clear_all === 'true') clear_all = true;
      if (req.body && req.body.clear_all === true) clear_all = true;
      if (!clear_all && !role && !recipient_id && !recipient_username) {
        role = 'owner';
      }
    }
    const r = (role || '').trim().toLowerCase();
    const uname = (recipient_username || '').trim().toLowerCase();
    const rid = recipient_id ? Number(recipient_id) : null;

    const initialLen = notifications.length;
    if (clear_all && (sr === 'owner')) {
      notifications = [];
    } else if (sr !== 'owner') {
      notifications = notifications.filter(n => !canAccessNotification(su, n));
    } else {
      notifications = notifications.filter(n => {
        const nr = String(n.recipient_role ?? n.role ?? '').trim().toLowerCase();
        let match = false;
        if (r === 'owner' || r === 'admin') {
          if (!nr || nr === 'owner' || nr === 'admin') match = true;
        } else if (r && nr === r) {
          match = true;
        }
        if (rid && n.recipient_id && Number(n.recipient_id) === rid) match = true;
        if (uname && n.recipient_username && n.recipient_username.toLowerCase() === uname) match = true;
        return !match;
      });
    }

    writeDb('notifications', notifications);
    res.json({ success: true, count: initialLen - notifications.length, message: 'Notifications cleared successfully' });
  } catch (err) {
    console.error('Clear notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notifications/:id', (req, res) => {
  try {
    let notifications = readDb('notifications') || [];
    const id = Number(req.params.id);
    const notif = notifications.find(n => n.id === id);
    if (notif && !canAccessNotification(req.sessionUser, notif)) {
      return res.status(403).json({ error: 'Forbidden. Cannot delete another user notification.' });
    }
    const initialLen = notifications.length;
    notifications = notifications.filter(n => n.id !== id);
    if (notifications.length !== initialLen) {
      writeDb('notifications', notifications);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Strict range-level available pool helper (never steals numbers from unrelated ranges)
function getRangeFreePool(numbers, { isAgent, agentId, rangeId, rangeName, country, provider }) {
  const list = Array.isArray(numbers) ? numbers : [];
  const basePool = isAgent
    ? list.filter(n => n && Number(n.agent_id) === Number(agentId) && !n.client_id)
    : list.filter(n => n && !n.agent_id && !n.client_id);

  const rIdNum = rangeId ? Number(rangeId) : null;
  const rNameLow = String(rangeName || '').trim().toLowerCase();
  const cLow = String(country || '').trim().toLowerCase();
  const pLow = String(provider || '').trim().toLowerCase();

  if (!rIdNum && !rNameLow && !(cLow && pLow)) return basePool;

  return basePool.filter(n => {
    if (rIdNum && n.range_id && Number(n.range_id) === rIdNum) return true;
    if (rNameLow) {
      const nRng = String(n.range_name || n.range || n.name || '').trim().toLowerCase();
      if (nRng && nRng === rNameLow) return true;
    }
    if (!rIdNum && cLow && pLow) {
      return String(n.country || '').trim().toLowerCase() === cLow && String(n.provider || '').trim().toLowerCase() === pLow;
    }
    return false;
  });
}

// ── Live Number Requests & Hierarchy Dispatch Control ─────────────
app.get('/api/agent-requests', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    if (!isOwner && !isAgent && !isClient) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const requests = readDb('number_requests') || [];
    let list = Array.isArray(requests) ? [...requests] : [];

    if (isClient) {
      list = list.filter(r => Number(r.client_id) === Number(sessionUser.id));
    } else if (isAgent) {
      list = list.filter(r => Number(r.agent_id) === Number(sessionUser.id));
    }

    const { status, scope } = req.query;
    if (scope === 'downline') {
      if (isAgent) {
        list = list.filter(r => String(r.requester_role || '').toLowerCase() === 'client' || !!r.client_id);
      }
    } else if (scope === 'mine') {
      if (isAgent) {
        list = list.filter(r => (!r.requester_role || String(r.requester_role).toLowerCase() === 'agent') && !r.client_id);
      }
    }

    if (status) {
      list = list.filter(r => (r.status || '').toLowerCase() === String(status).toLowerCase());
    }

    // Enrich each request with exact real-time Free Pool count for that range
    const allNumbers = readDb('numbers') || [];
    const allRanges = readDb('sms_ranges') || [];
    const rangeById = new Map(allRanges.map(rg => [Number(rg.id), rg]));
    const enriched = list.map(r => {
      const rg = r.range_id ? rangeById.get(Number(r.range_id)) : null;
      const pool = getRangeFreePool(allNumbers, {
        isAgent: isAgent && scope !== 'mine',
        agentId: isAgent ? sessionUser.id : null,
        rangeId: r.range_id || (rg && rg.id) || null,
        rangeName: r.range_name || (rg && (rg.range_name || rg.name)) || '',
        country: r.country || (rg && rg.country) || '',
        provider: (rg && rg.provider) || ''
      });
      return { ...r, free_count: pool.length };
    });

    res.json(enriched);
  } catch (err) {
    console.error('GET /api/agent-requests error:', err);
    res.status(500).json({ error: err.message });
  }
});

function handleCreateNumberRequest(req, res) {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    if (!isOwner && !isAgent && !isClient) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const policy = resolveAllocationPolicy(sessionUser);
    if (!isOwner && policy.mode !== 'request') {
      return res.status(403).json({ error: 'Number Request mode is disabled for your account. Use Self-Allocate instead.' });
    }

    const { range_id, range_name, country, app_name, service_name, quantity, urgency, notes, payterm } = req.body || {};
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      return res.status(400).json({ error: 'Please enter a valid quantity of numbers' });
    }

    // Clients have NO cross-range global cap; they are governed strictly per range below.
    if (!isOwner && !isClient && policy.daily_remaining !== null && qty > policy.daily_remaining) {
      return res.status(400).json({ error: `Daily request limit exceeded. Remaining today: ${policy.daily_remaining}` });
    }
    if (!isOwner && !isClient && policy.total_remaining !== null && qty > policy.total_remaining) {
      return res.status(400).json({ error: `Overall number limit exceeded. Remaining allowed: ${policy.total_remaining}` });
    }

    // Derive requester identity securely from session (Direct 3-tier: Owner -> Agent -> Client)
    const requesterRole = isClient ? 'Client' : (isAgent ? 'Agent' : 'Owner');
    const clRecFresh = isClient ? ((readDb('clients') || []).find(c => Number(c.id) === Number(sessionUser.id)) || sessionUser) : null;
    const effectiveClientId = isClient ? sessionUser.id : null;
    const effectiveClientUsername = isClient ? sessionUser.username : '';
    const effectiveAgentId = isClient ? (clRecFresh?.agent_id || sessionUser.agent_id || null) : (isAgent ? sessionUser.id : (Number(req.body.agent_id) || null));
    const effectiveAgentUsername = isClient ? (clRecFresh?.agent_username || sessionUser.agent_username || (effectiveAgentId ? `Agent #${effectiveAgentId}` : '')) : (isAgent ? sessionUser.username : (req.body.agent_username || ''));

    const requests = readDb('number_requests') || [];
    const ranges = readDb('sms_ranges') || [];
    const matchedRng = ranges.find(r => range_id && Number(r.id) === Number(range_id)) ||
                       ranges.find(r => range_name && String(r.range_name || r.name || '').trim().toLowerCase() === String(range_name).trim().toLowerCase()) ||
                       null;
    const resolvedRangeId = matchedRng ? Number(matchedRng.id) : (range_id ? Number(range_id) : null);
    const resolvedRangeName = ((matchedRng && (matchedRng.range_name || matchedRng.name)) || range_name || country || 'General SMS Range').trim();
    const wnTags = getWhitenoiseProviderTags();
    const isWnRange = (matchedRng && isWhitenoiseRecord(matchedRng, null, wnTags)) || isWhitenoiseText(resolvedRangeName);

    if (isWnRange && !isOwner && !hasWhitenoiseAccess(sessionUser)) {
      return res.status(403).json({ error: 'Forbidden. Whitenoise access is not enabled for your account.' });
    }

    const rngPtInfo = matchedRng ? resolveRangeActivePayterms(matchedRng, isWnRange) : { active_payterms: [isWnRange ? 'Monthly' : 'Weekly'], primary_payterm: isWnRange ? 'Monthly' : 'Weekly' };
    const hasExplicitPayterm = payterm !== undefined && payterm !== null && String(payterm).trim() !== '';
    const effectivePayterm = hasExplicitPayterm
      ? normalizePaytermKey(payterm)
      : (isWnRange ? 'Monthly' : (rngPtInfo.primary_payterm || 'Weekly'));
    if (hasExplicitPayterm && !isValidPayterm(effectivePayterm)) {
      return res.status(400).json({ error: `Invalid payterm "${payterm}". Must be one of: ${getMasterPayterms().join(', ')}` });
    }
    if ((matchedRng || isWnRange) && !rngPtInfo.active_payterms.includes(effectivePayterm)) {
      return res.status(400).json({
        error: `Payterm "${effectivePayterm}" is not enabled on range "${resolvedRangeName}". Allowed payterm(s): ${rngPtInfo.active_payterms.join(', ')}.`
      });
    }
    const reqPtMeta = getPaytermMeta(effectivePayterm);

    let stampedClientRatePkr = null;
    let stampedFx = getUsdToPkrRate();
    if (isClient) {
      const acr = effectiveAgentId ? findAgentClientRate(effectiveAgentId, resolvedRangeId, resolvedRangeName) : null;
      if (!acr || acr.published === false || !(Number(acr.client_rate_pkr) > 0)) {
        return res.status(400).json({ error: 'This range is not enabled by your Agent yet.' });
      }
      if (qty > CLIENT_RANGE_DAILY_NUMBERS_MAX) {
        return res.status(400).json({ error: `Daily limit per range is max ${CLIENT_RANGE_DAILY_NUMBERS_MAX} numbers. You requested ${qty}.` });
      }

      const quota = getClientRangeQuota(sessionUser.id, resolvedRangeId, resolvedRangeName, { requests });
      if (quota.weekly_adds_remaining <= 0) {
        return res.status(429).json({
          error: `Weekly limit reached for "${resolvedRangeName}": max ${CLIENT_RANGE_WEEKLY_ADDS_MAX} additions per week (${quota.weekly_adds_used}/${CLIENT_RANGE_WEEKLY_ADDS_MAX} used in last 7 days).`
        });
      }
      if (quota.daily_remaining <= 0 || qty > quota.daily_remaining) {
        return res.status(quota.daily_remaining <= 0 ? 429 : 400).json({
          error: `Daily limit reached for "${resolvedRangeName}": max ${CLIENT_RANGE_DAILY_NUMBERS_MAX} numbers per day (${quota.today_numbers}/${CLIENT_RANGE_DAILY_NUMBERS_MAX} used today, remaining ${quota.daily_remaining}).`
        });
      }
      if (qty > quota.hold_remaining) {
        return res.status(400).json({
          error: `Active holding limit reached for "${resolvedRangeName}": max ${CLIENT_RANGE_ACTIVE_HOLD_MAX} numbers per range (${quota.held_count} held + ${quota.pending_qty} pending). Return numbers in this range first.`
        });
      }
      if (quota.has_pending_request) {
        return res.status(409).json({
          error: `You already have a pending request for "${resolvedRangeName}". Please wait for your Agent to review it before submitting another request.`
        });
      }
      const allowedQty = normalizeAllowedQuantities(acr.allowed_quantities).filter(q => q <= CLIENT_RANGE_DAILY_NUMBERS_MAX);
      const effAllowed = allowedQty.length ? allowedQty : [CLIENT_RANGE_DAILY_NUMBERS_MAX];
      if (!effAllowed.includes(qty) && qty !== Math.min(quota.daily_remaining, quota.hold_remaining)) {
        return res.status(400).json({ error: `Allowed number batch for "${resolvedRangeName}": ${effAllowed.join(' or ')} numbers (max ${CLIENT_RANGE_DAILY_NUMBERS_MAX}/day).` });
      }
      stampedClientRatePkr = getAgentRangeClientPkrRate(acr, reqPtMeta.key);
    } else if (isAgent) {
      const existingAgentPending = requests.find(r =>
        r &&
        String(r.requester_role || '').toLowerCase() === 'agent' &&
        Number(r.agent_id || r.requester_id) === Number(sessionUser.id) &&
        String(r.status || '').toLowerCase() === 'pending' &&
        matchesRangeRef(r, resolvedRangeId, resolvedRangeName)
      );
      if (existingAgentPending) {
        return res.status(409).json({
          error: `You already have a pending request for "${resolvedRangeName}". Please wait for Owner approval before requesting this range again.`
        });
      }
    }

    const now = new Date().toISOString();
    const cleanApp = (app_name || service_name || 'General Application').trim();
    const cleanDisplayActor = isClient ? sessionUser.username : String(effectiveAgentUsername || sessionUser.username || 'User').trim();
    const entry = {
      id: nextId(requests, 'number_requests'),
      requester_role: requesterRole,
      requester_id: sessionUser.id,
      requester_username: sessionUser.username,
      client_id: effectiveClientId,
      client_username: effectiveClientUsername,
      agent_id: effectiveAgentId,
      agent_username: cleanDisplayActor,
      range_id: resolvedRangeId,
      range_name: resolvedRangeName,
      country: ((matchedRng && matchedRng.country) || country || '').trim(),
      app_name: cleanApp,
      payterm: reqPtMeta.key,
      payout_schedule: reqPtMeta.schedule,
      cycle_days: reqPtMeta.cycle_days,
      hold_days: reqPtMeta.hold_days,
      ...(isWnRange ? { is_whitenoise: true } : {}),
      quantity: qty,
      urgency: urgency || 'normal',
      notes: (notes || '').trim(),
      ...(stampedClientRatePkr !== null ? { client_rate_pkr: stampedClientRatePkr, client_currency: 'PKR', fx_usd_to_pkr: stampedFx } : {}),
      status: 'pending',
      created: now,
      timestamp: now
    };

    requests.unshift(entry);
    writeDb('number_requests', requests);

    // Instant WebSocket broadcast for Live Requests Queue
    broadcastWs({
      type: 'agent_number_request',
      data: entry,
      message: `New Number Request: ${requesterRole} ${sessionUser.username} requested ${entry.quantity} numbers in range "${entry.range_name}"`
    });

    // Send instant notification directly up the 3-tier chain (Client -> Agent -> Owner)
    const reqTermLabel = formatNotifPayterm(entry.payterm, Boolean(entry.is_whitenoise));
    if (isClient) {
      const clRateLbl = formatNotifRate(entry.client_rate_pkr, 'PKR');
      sendInstantNotification({
        recipient_role: effectiveAgentId ? 'agent' : 'owner',
        recipient_id: effectiveAgentId || null,
        title: `New Client Number Request (+${entry.quantity})`,
        message: `Client ${sessionUser.username} requested ${entry.quantity} number(s) in range "${entry.range_name}" on ${reqTermLabel} term${clRateLbl ? ` at ${clRateLbl}` : ''}.`,
        type: 'request',
        category: 'requests',
        action_page: effectiveAgentId ? 'client-requests' : 'agent-requests',
        payterm: reqTermLabel,
        rate_label: clRateLbl,
        status: 'pending',
        count: entry.quantity,
        range_id: entry.range_id,
        range_name: entry.range_name,
        actor_role: 'Client',
        actor_name: sessionUser.username,
        metadata: { request_id: entry.id, client_id: sessionUser.id }
      });
    } else {
      sendInstantNotification({
        recipient_role: 'owner',
        recipient_id: null,
        title: `New Agent Number Request (+${entry.quantity})`,
        message: `Agent ${entry.agent_username} requested ${entry.quantity} number(s) in range "${entry.range_name}" on ${reqTermLabel} term for ${cleanApp}.`,
        type: 'request',
        category: 'requests',
        action_page: 'agent-requests',
        payterm: reqTermLabel,
        status: 'pending',
        count: entry.quantity,
        range_id: entry.range_id,
        range_name: entry.range_name,
        actor_role: 'Agent',
        actor_name: entry.agent_username,
        metadata: { request_id: entry.id, agent_id: entry.agent_id, app_name: cleanApp }
      });
    }

    res.json({ success: true, request: entry });
  } catch (err) {
    console.error('POST /api/numbers/request error:', err);
    res.status(500).json({ error: err.message });
  }
}

app.post('/api/agent-requests', requireAuth, (req, res) => {
  const sRole = (req.sessionUser?.role || '').toLowerCase();
  if (sRole === 'client') {
    return res.status(403).json({ error: 'Access denied.' });
  }
  return handleCreateNumberRequest(req, res);
});

app.post(['/api/numbers/request', '/api/client-requests'], requireAuth, handleCreateNumberRequest);

// Fulfill / Accept Request & Dispatch Numbers downline
app.post('/api/agent-requests/:id/fulfill', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    const id = Number(req.params.id);
    const requests = readDb('number_requests') || [];
    const reqItem = requests.find(r => r.id === id);
    if (!reqItem) return res.status(404).json({ error: 'Request not found' });

    const reqRoleLower = String(reqItem.requester_role || (reqItem.client_id ? 'client' : 'agent')).toLowerCase();
    const canFulfill = isOwner
      || (isAgent && Number(reqItem.agent_id) === Number(sessionUser.id) && reqRoleLower === 'client');

    if (!canFulfill) {
      return res.status(403).json({ error: 'Forbidden. You can only fulfill requests submitted by your downline.' });
    }

    const payload = req.body || {};
    const allocCount = parseInt(payload.count || reqItem.quantity, 10) || reqItem.quantity;
    const rangeId = payload.range_id ? Number(payload.range_id) : reqItem.range_id;
    const ranges = readDb('sms_ranges') || [];
    const rng = ranges.find(r => Number(r.id) === Number(rangeId)) || null;
    const rangeLabel = (payload.range_name || (rng && (rng.range_name || rng.name)) || reqItem.range_name || 'Direct Range').trim();
    const prefix = (rng && rng.prefix) || '';
    const country = (rng && rng.country) || reqItem.country || 'International';
    const provider = (rng && rng.provider) || 'Manual';

    let numbers = readDb('numbers') || [];
    let allocatedNumbers = [];

    const isClientReq = reqRoleLower === 'client' && !!reqItem.client_id;
    const reqClientRec = isClientReq ? ((readDb('clients') || []).find(c => Number(c.id) === Number(reqItem.client_id)) || null) : null;
    const effAgentId = reqItem.agent_id || (isAgent ? sessionUser.id : null);
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const hasSelectedWn = Array.isArray(payload.selected_number_ids) && payload.selected_number_ids.some(sid => {
      const found = numbers.find(n => Number(n.id) === Number(sid));
      return found && isWhitenoiseRecord(found, wnRangesMap, wnTags);
    });
    const isWnReq = Boolean(reqItem.is_whitenoise) || (rng && isWhitenoiseRecord(rng, wnRangesMap, wnTags)) || isWhitenoiseText(rangeLabel) || isWhitenoiseText(provider) || hasSelectedWn;

    if (isWnReq) {
      if (isAgent && !hasWhitenoiseAccess(sessionUser)) {
        return res.status(403).json({ error: 'Forbidden. Whitenoise access is not enabled for your account.' });
      }
      if (isClientReq) {
        if (!hasWhitenoiseAccess({ role: 'Client', id: reqItem.client_id, agent_id: effAgentId, whitenoise_access: reqClientRec?.whitenoise_access })) {
          return res.status(403).json({ error: `Client "${reqItem.client_username || reqItem.client_id}" does not have Whitenoise access enabled.` });
        }
      } else if (effAgentId) {
        const agRec = (readDb('agents') || []).find(a => Number(a.id) === Number(effAgentId));
        if (!hasWhitenoiseAccess({ role: 'Agent', id: effAgentId, whitenoise_access: agRec?.whitenoise_access })) {
          return res.status(403).json({ error: `Agent "${reqItem.agent_username || effAgentId}" does not have Whitenoise access enabled.` });
        }
      }
    }

    const fulfillPtInfo = rng ? resolveRangeActivePayterms(rng, isWnReq) : { active_payterms: [isWnReq ? 'Monthly' : 'Weekly'], primary_payterm: isWnReq ? 'Monthly' : 'Weekly' };
    const requestedFulfillPt = normalizePaytermKey(payload.payterm || reqItem.payterm || fulfillPtInfo.primary_payterm);
    if (rng && !fulfillPtInfo.active_payterms.includes(requestedFulfillPt)) {
      return res.status(400).json({ error: `Payterm "${requestedFulfillPt}" is not active on range "${rangeLabel}". Allowed: ${fulfillPtInfo.active_payterms.join(', ')}.` });
    }
    const targetPayterm = isWnReq ? 'Monthly' : (fulfillPtInfo.active_payterms.includes(requestedFulfillPt) ? requestedFulfillPt : fulfillPtInfo.primary_payterm);
    if (isClientReq && reqItem.client_id) {
      const curHeld = numbers.filter(n => n && Number(n.client_id) === Number(reqItem.client_id) && matchesRangeRef(n, rangeId, rangeLabel)).length;
      if (curHeld + allocCount > CLIENT_RANGE_ACTIVE_HOLD_MAX) {
        return res.status(400).json({
          error: `Client "${reqItem.client_username || reqItem.client_id}" cannot hold more than ${CLIENT_RANGE_ACTIVE_HOLD_MAX} numbers in "${rangeLabel}" (currently ${curHeld} held, trying to fulfill ${allocCount}).`
        });
      }
    }
    const targetRecipientName = isClientReq ? reqItem.client_username : reqItem.agent_username;
    const fixedRngAgRate = getRangeAgentRate(rng, targetPayterm);

    const applyAssignment = (n) => {
      const assignNowIso = new Date().toISOString();
      const isWn = isWnReq || isWhitenoiseRecord(n, wnRangesMap, wnTags);
      const effPayterm = isWn ? 'Monthly' : targetPayterm;
      const ptMeta = getPaytermMeta(effPayterm);
      const agRate = Number(n.agent_rate || 0) || (isWn ? getRangeAgentRate(rng, 'Monthly') : fixedRngAgRate);
      if (!isClientReq) {
        return {
          ...n,
          agent_id: effAgentId,
          agent_name: reqItem.agent_username || (isAgent ? sessionUser.username : ''),
          agent_username: reqItem.agent_username || (isAgent ? sessionUser.username : ''),
          agent_rate: agRate || n.agent_rate,
          payout: agRate || n.payout,
          client_id: null,
          client_name: '',
          client_username: '',
          user: targetRecipientName,
          payterm: ptMeta.key,
          payout_schedule: ptMeta.schedule,
          cycle_days: ptMeta.cycle_days,
          hold_days: ptMeta.hold_days,
          ...(isWn ? { is_whitenoise: true } : {}),
          status: 'assigned',
          assigned_at: assignNowIso,
          assigned_date: assignNowIso,
          allocated_at: assignNowIso,
          notes: `Allocated via Request #${reqItem.id}`
        };
      }
      const rp = resolveClientRatePair({
        agentId: effAgentId,
        rangeId: n.range_id || rangeId,
        rangeName: n.range_name || rangeLabel,
        payterm: ptMeta.key,
        agentRateUsd: agRate,
        explicitClientRate: null,
        clientRecord: reqClientRec
      });
      return {
        ...n,
        agent_id: effAgentId,
        agent_name: reqItem.agent_username || (isAgent ? sessionUser.username : ''),
        agent_rate: agRate || n.agent_rate,
        client_id: reqItem.client_id,
        client_name: reqItem.client_username || '',
        client_username: reqItem.client_username || '',
        client_rate: rp.client_rate,
        client_payout: rp.client_rate,
        client_rate_pkr: rp.client_rate_pkr,
        client_currency: rp.client_currency,
        fx_usd_to_pkr: rp.fx_usd_to_pkr,
        rate_source: rp.source,
        user: targetRecipientName,
        payterm: ptMeta.key,
        client_payterm: ptMeta.key,
        payout_schedule: ptMeta.schedule,
        cycle_days: ptMeta.cycle_days,
        hold_days: ptMeta.hold_days,
        ...(isWn ? { is_whitenoise: true } : {}),
        status: 'assigned',
        assigned_at: assignNowIso,
        assigned_date: assignNowIso,
        client_assigned_at: assignNowIso,
        allocated_at: assignNowIso,
        notes: `Allocated via Request #${reqItem.id}`
      };
    };

    if (Array.isArray(payload.selected_number_ids) && payload.selected_number_ids.length > 0) {
      const selectedIdSet = new Set(payload.selected_number_ids.map(Number));
      for (const n of numbers) {
        if (selectedIdSet.has(Number(n.id))) {
          if (n.client_id || (!isClientReq && n.agent_id)) {
            return res.status(400).json({ error: `Number ${n.number} is already allocated.` });
          }
          if (isAgent && Number(n.agent_id) !== Number(sessionUser.id)) {
            return res.status(403).json({ error: `Number ${n.number} does not belong to your agent pool.` });
          }
        }
      }
      numbers = numbers.map(n => {
        if (selectedIdSet.has(Number(n.id))) {
          const updated = applyAssignment(n);
          allocatedNumbers.push(updated);
          return updated;
        }
        return n;
      });
    } else if (payload.numbers_text && String(payload.numbers_text).trim()) {
      const rawLines = String(payload.numbers_text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const validLines = rawLines.filter(l => !/^(number|phone|msisdn|mobile)$/i.test(l));
      const baseNumId = nextId(numbers, 'numbers');
      validLines.forEach((num, idx) => {
        const item = applyAssignment({
          id: baseNumId + idx,
          number: num,
          range_id: rangeId || null,
          range_name: rangeLabel,
          prefix: prefix,
          app: 'Unassigned',
          country: country,
          provider: provider,
          otp_limit: (rng && rng.otp_limit) || 0,
          last_sms: null,
          sms_count: 0
        });
        numbers.push(item);
        allocatedNumbers.push(item);
      });
    } else {
      const pool = getRangeFreePool(numbers, {
        isAgent,
        agentId: isAgent ? sessionUser.id : null,
        rangeId,
        rangeName: rangeLabel,
        country,
        provider
      });

      if (!allocCount || allocCount <= 0) {
        return res.status(400).json({ error: 'Please enter a valid number of DID lines to allocate.' });
      }
      if (pool.length === 0) {
        return res.status(400).json({ error: `No free numbers available in range "${rangeLabel}". Free pool: 0.` });
      }
      if (pool.length < allocCount) {
        return res.status(400).json({ error: `Only ${pool.length} free number(s) available in range "${rangeLabel}". Please enter ${pool.length} or fewer.` });
      }

      const selected = pool.slice(0, allocCount);
      const selectedIds = new Set(selected.map(n => n.id));
      numbers = numbers.map(n => {
        if (selectedIds.has(n.id)) {
          const updated = applyAssignment(n);
          allocatedNumbers.push(updated);
          return updated;
        }
        return n;
      });
    }

    writeDb('numbers', numbers);

    // Generate Stamped File
    const cleanActor = String(targetRecipientName || 'Account').replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanRange = String(rangeLabel || 'Range').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Batch_${cleanActor}_${cleanRange}_${Date.now()}.txt`;
    const filePath = path.join(AGENT_FILES_DIR, filename);

    const fileContent = [
      '================================================================================',
      'HUMAX SMS GATEWAY — OFFICIAL NUMBER ALLOCATION FILE',
      '================================================================================',
      `RECIPIENT       : ${targetRecipientName} (${reqItem.requester_role || 'Agent'})`,
      `REQUEST ID      : #${reqItem.id}`,
      `RANGE NAME      : ${rangeLabel}`,
      `COUNTRY / PREFIX: ${country} (${prefix || 'Standard'})`,
      `TOTAL ALLOCATED : ${allocatedNumbers.length}`,
      `DISPATCHED DATE : ${new Date().toISOString()}`,
      `DISPATCHED BY   : ${sessionUser.username} (${sessionUser.role})`,
      '================================================================================',
      '',
      '--- NUMBERS LIST ---',
      ...allocatedNumbers.map(n => n.number),
      '',
      '================================================================================',
      'END OF BATCH ALLOCATION FILE',
      '================================================================================'
    ].join('\n');

    fs.writeFileSync(filePath, fileContent, 'utf-8');

    // Update request state
    reqItem.status = 'approved';
    reqItem.fulfilled_at = new Date().toISOString();
    reqItem.fulfilled_by = payload.fulfilled_by || sessionUser.username;
    reqItem.requested_quantity = Number(reqItem.quantity || allocatedNumbers.length);
    reqItem.fulfilled_count = allocatedNumbers.length;
    reqItem.partial = allocatedNumbers.length < Number(reqItem.quantity || 0);
    reqItem.fulfilled_range = rangeLabel;
    reqItem.batch_filename = filename;
    writeDb('number_requests', requests);

    // Record in number_transfers
    const transfers = readDb('number_transfers') || [];
    transfers.unshift({
      id: nextId(transfers, 'number_transfers'),
      from_user_id: sessionUser.id,
      from_username: sessionUser.username,
      from_role: sessionUser.role,
      to_user_id: isClientReq ? reqItem.client_id : reqItem.agent_id,
      to_username: targetRecipientName,
      to_role: reqItem.requester_role || 'Agent',
      count: allocatedNumbers.length,
      number_ids: allocatedNumbers.map(n => n.id),
      batch_filename: filename,
      notes: `Fulfillment of Request #${reqItem.id} (${rangeLabel})`,
      timestamp: new Date().toISOString(),
      status: 'completed'
    });
    writeDb('number_transfers', transfers);

    // Record in allocation_history
    const history = readDb('allocation_history') || [];
    history.unshift({
      id: nextId(history, 'allocation_history'),
      from_user: sessionUser.username,
      to_user_id: isClientReq ? reqItem.client_id : reqItem.agent_id,
      to_user: targetRecipientName,
      to_role: reqItem.requester_role || 'Agent',
      range_id: rangeId,
      range_name: rangeLabel,
      count: allocatedNumbers.length,
      batch_filename: filename,
      timestamp: new Date().toISOString(),
      status: 'completed',
      request_id: reqItem.id,
      notes: `Request #${reqItem.id} fulfilled`
    });
    writeDb('allocation_history', history);

    // Send instant live notification to requester (and live confirmation to Owner for Agent requests)
    const notifyRole = isClientReq ? 'client' : 'agent';
    const notifyId = isClientReq ? reqItem.client_id : reqItem.agent_id;
    const firstFulfilled = allocatedNumbers[0] || {};
    const fulTermLabel = formatNotifPayterm(
      isClientReq ? (firstFulfilled.client_payterm || firstFulfilled.payterm || reqItem.payterm) : (firstFulfilled.payterm || reqItem.payterm),
      Boolean(firstFulfilled.is_whitenoise || reqItem.is_whitenoise)
    );
    const fulRateLabel = isClientReq
      ? (formatNotifRate(firstFulfilled.client_rate_pkr || reqItem.client_rate_pkr, 'PKR') || formatNotifRate(firstFulfilled.client_rate, 'USD'))
      : formatNotifRate(firstFulfilled.agent_rate || firstFulfilled.payout, 'USD');

    sendInstantNotification({
      recipient_role: notifyRole,
      recipient_id: notifyId,
      recipient_username: targetRecipientName,
      title: `Request Approved (+${allocatedNumbers.length}) — ${rangeLabel}`,
      message: `Your request #${reqItem.id} was approved! ${allocatedNumbers.length} number(s) added in range "${rangeLabel}" on ${fulTermLabel} term${fulRateLabel ? ` at ${fulRateLabel}` : ''}.`,
      type: 'allocation',
      category: 'numbers',
      action_page: isClientReq ? 'my-numbers' : 'my-sms-numbers',
      payterm: fulTermLabel,
      rate_label: fulRateLabel,
      status: 'approved',
      count: allocatedNumbers.length,
      range_id: rangeId,
      range_name: rangeLabel,
      actor_role: sessionUser.role,
      actor_name: sessionUser.username,
      metadata: { request_id: reqItem.id, filename: filename }
    });

    if (!isClientReq) {
      sendInstantNotification({
        recipient_role: 'owner',
        title: `Agent Request #${reqItem.id} Accepted (+${allocatedNumbers.length})`,
        message: `Dispatched ${allocatedNumbers.length} number(s) in range "${rangeLabel}" (${fulTermLabel}) to Agent ${targetRecipientName}.`,
        type: 'request_approved',
        category: 'requests',
        action_page: 'agent-requests',
        payterm: fulTermLabel,
        rate_label: fulRateLabel,
        status: 'approved',
        count: allocatedNumbers.length,
        range_id: rangeId,
        range_name: rangeLabel,
        actor_role: sessionUser.role,
        actor_name: sessionUser.username,
        metadata: { request_id: reqItem.id, agent_id: reqItem.agent_id }
      });
    }

    broadcastWs({
      type: 'agent_request_updated',
      data: reqItem,
      message: `Request #${reqItem.id} fulfilled: ${allocatedNumbers.length} numbers dispatched to ${targetRecipientName}`
    });

    res.json({
      success: true,
      request: reqItem,
      allocated: allocatedNumbers.length,
      batch_filename: filename
    });
  } catch (err) {
    console.error('fulfill agent-request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reject Number Request
app.post('/api/agent-requests/:id/reject', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    const id = Number(req.params.id);
    const requests = readDb('number_requests') || [];
    const reqItem = requests.find(r => r.id === id);
    if (!reqItem) return res.status(404).json({ error: 'Request not found' });

    const reqRoleLower = String(reqItem.requester_role || (reqItem.client_id ? 'client' : 'agent')).toLowerCase();
    const canReject = isOwner
      || (isAgent && Number(reqItem.agent_id) === Number(sessionUser.id) && reqRoleLower === 'client');

    if (!canReject) {
      return res.status(403).json({ error: 'Forbidden. You can only reject requests submitted by your downline.' });
    }

    const reason = (req.body && req.body.reason) || 'Capacity unavailable at this time';
    reqItem.status = 'rejected';
    reqItem.rejected_at = new Date().toISOString();
    reqItem.rejected_reason = reason;
    writeDb('number_requests', requests);

    const isClientReq = reqRoleLower === 'client' && !!reqItem.client_id;
    const notifyRole = isClientReq ? 'client' : 'agent';
    const notifyId = isClientReq ? reqItem.client_id : reqItem.agent_id;
    const notifyName = isClientReq ? reqItem.client_username : reqItem.agent_username;
    const rejTermLabel = formatNotifPayterm(reqItem.payterm, Boolean(reqItem.is_whitenoise));

    sendInstantNotification({
      recipient_role: notifyRole,
      recipient_id: notifyId,
      recipient_username: notifyName,
      title: `Number Request #${reqItem.id} Rejected`,
      message: `Your request for ${reqItem.quantity} number(s) in range "${reqItem.range_name}" (${rejTermLabel}) was declined. Reason: ${reason}`,
      type: 'request_rejected',
      category: 'requests',
      action_page: isClientReq ? 'sms-overview' : 'sms-ranges',
      payterm: rejTermLabel,
      status: 'rejected',
      count: reqItem.quantity,
      range_name: reqItem.range_name,
      actor_role: sessionUser.role,
      actor_name: sessionUser.username,
      metadata: { request_id: reqItem.id, reason }
    });

    if (!isClientReq) {
      sendInstantNotification({
        recipient_role: 'owner',
        title: `Agent Request #${reqItem.id} Rejected`,
        message: `Request for ${reqItem.quantity} number(s) in "${reqItem.range_name}" by Agent ${notifyName} was rejected. Reason: ${reason}`,
        type: 'request_rejected',
        category: 'requests',
        action_page: 'agent-requests',
        payterm: rejTermLabel,
        status: 'rejected',
        count: reqItem.quantity,
        range_name: reqItem.range_name,
        actor_role: sessionUser.role,
        actor_name: sessionUser.username,
        metadata: { request_id: reqItem.id, agent_id: reqItem.agent_id, reason }
      });
    }

    broadcastWs({
      type: 'agent_request_updated',
      data: reqItem
    });

    res.json({ success: true, request: reqItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download / View Allocation File
app.get('/api/agent-requests/:id/file', requireAuth, (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    const sRole = (sessionUser.role || '').toLowerCase();
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';

    const id = Number(req.params.id);
    const requests = readDb('number_requests') || [];
    const reqItem = requests.find(r => r.id === id);
    if (!reqItem || !reqItem.batch_filename) {
      return res.status(404).json({ error: 'File not found for this request' });
    }

    const canAccess = isOwner ||
      (isAgent && Number(reqItem.agent_id) === Number(sessionUser.id));

    if (!canAccess) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to download this allocation file.' });
    }

    const filePath = path.join(AGENT_FILES_DIR, reqItem.batch_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File does not exist on disk' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reqItem.batch_filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registration Requests (Owner only)
app.get('/api/registration-requests', requireAuth, requireApiRole(['owner']), (req, res) => {
  const data = readDb('registration_requests') || [];
  if (req.query.page || (req.query.limit && req.query.limit !== '10000')) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const start = (page - 1) * limit;
    return res.json({ data: data.slice(start, start + limit), total: data.length });
  }
  res.json(data);
});

app.post('/api/registration-requests', requireAuth, requireApiRole(['owner']), (req, res) => {
  const data = readDb('registration_requests') || [];
  if (req.body && req.body.username && isUsernameTaken(req.body.username)) {
    return res.status(400).json({ error: 'This username already exists', detail: 'This username already exists. Please choose a different username.' });
  }
  const item = { id: nextId(data, 'registration_requests'), ...req.body, status: req.body.status || 'pending', timestamp: new Date().toISOString() };
  data.unshift(item);
  writeDb('registration_requests', data);
  res.json(item);
});

app.patch('/api/registration-requests/:id', requireAuth, requireApiRole(['owner']), (req, res) => {
  const data = readDb('registration_requests') || [];
  const id = Number(req.params.id);
  const idx = data.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Request not found' });
  data[idx] = { ...data[idx], ...req.body };
  writeDb('registration_requests', data);
  res.json(data[idx]);
});

app.delete('/api/registration-requests/:id', requireAuth, requireApiRole(['owner']), (req, res) => {
  const data = readDb('registration_requests') || [];
  const id = Number(req.params.id);
  writeDb('registration_requests', data.filter(x => x.id !== id));
  res.json({ success: true });
});

// CR API Connections
function sanitizeCrApiConn(c) {
  if (!c || typeof c !== 'object') return c;
  const { token, ...rest } = c;
  return {
    ...rest,
    has_token: Boolean(token),
    token_masked: (token && token.length > 8) ? `${token.slice(0, 4)}…${token.slice(-4)}` : (token ? '••••••••' : '—')
  };
}

app.get('/api/cr-api-connections', (req, res) => {
  const data = readDb('cr_api_connections') || [];
  const mapped = data.map(sanitizeCrApiConn);
  if (req.query.page) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const start = (page - 1) * limit;
    return res.json({ data: mapped.slice(start, start + limit), total: mapped.length });
  }
  res.json({ data: mapped, total: mapped.length });
});

app.post('/api/cr-api-connections', (req, res) => {
  const data = readDb('cr_api_connections') || [];
  const { panel_name, panel_url, token } = req.body || {};
  if (!panel_url || !token) {
    return res.status(400).json({ error: 'panel_url and token are required' });
  }

  let validatedUrl;
  try {
    validatedUrl = assertSafeExternalUrl(panel_url, 'Panel URL');
  } catch (urlErr) {
    return res.status(400).json({ error: urlErr.message });
  }

  const cleanUrl = validatedUrl.trim().replace(/\/+$/, '');
  const cleanToken = String(token).trim();
  const cleanName = String(panel_name || 'CR API Panel').trim();

  // Strict duplicate check: token or same panel URL + name
  const dupToken = data.find(c => String(c.token || '').trim() === cleanToken);
  if (dupToken) {
    return res.status(409).json({
      error: `Connection with this API token already exists ("${dupToken.panel_name}")`,
      detail: `This API token is already attached to connection #${dupToken.id} (${dupToken.panel_name}).`
    });
  }

  const dupUrl = data.find(c => String(c.panel_url || '').trim().replace(/\/+$/, '') === cleanUrl && String(c.panel_name || '').trim().toLowerCase() === cleanName.toLowerCase());
  if (dupUrl) {
    return res.status(409).json({
      error: `Connection with URL "${cleanUrl}" and name "${cleanName}" already exists`,
      detail: `A connection matching this panel URL and name is already registered (#${dupUrl.id}).`
    });
  }

  const item = {
    id: nextId(data, 'cr_api_connections'),
    panel_name: cleanName,
    panel_url: cleanUrl,
    token: cleanToken,
    interval: req.body.interval ? Math.max(5, parseInt(req.body.interval)) : 10,
    active: req.body.active !== undefined ? Boolean(req.body.active) : true,
    last_pulled_at: null,
    last_status: 'Connecting...',
    total_pulled: 0,
    created: new Date().toISOString()
  };
  data.push(item);
  writeDb('cr_api_connections', data);
  logAudit('Admin', 'Add CR API Connection', `Connected '${item.panel_name}' (Provider registered)`, 'CR API');
  if (item.active) {
    pollSingleCrApiConnection(item.id, true).catch(e => console.error('CR API poll error:', e));
  }
  res.json(sanitizeCrApiConn(item));
});

app.post('/api/cr-api-connections/:id/pull', async (req, res) => {
  const id = Number(req.params.id);
  const conns = readDb('cr_api_connections') || [];
  const conn = conns.find(c => Number(c.id) === id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  try {
    crApiBackoff.delete(id);
    const pulled = await pollSingleCrApiConnection(id, true);
    const updated = (readDb('cr_api_connections') || []).find(c => Number(c.id) === id);
    res.json({ success: !String(updated?.last_status || '').startsWith('Error'), pulled: pulled || 0, status: updated?.last_status || 'OK' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.patch('/api/cr-api-connections/:id', (req, res) => {
  const data = readDb('cr_api_connections') || [];
  const id = Number(req.params.id);
  const idx = data.findIndex(x => Number(x.id) === id);
  if (idx === -1) return res.status(404).json({ error: 'Connection not found' });
  const updates = {};
  if (req.body.panel_name !== undefined) updates.panel_name = String(req.body.panel_name).trim() || data[idx].panel_name;
  if (req.body.panel_url !== undefined) {
    try {
      updates.panel_url = assertSafeExternalUrl(req.body.panel_url, 'Panel URL').replace(/\/+$/, '');
    } catch (urlErr) {
      return res.status(400).json({ error: urlErr.message });
    }
  }
  if (req.body.token !== undefined && String(req.body.token).trim()) updates.token = String(req.body.token).trim();
  if (req.body.interval !== undefined) updates.interval = Math.max(5, parseInt(req.body.interval) || 10);
  if (req.body.active !== undefined) {
    updates.active = Boolean(req.body.active);
    if (updates.active) crApiBackoff.delete(id);
  }
  data[idx] = { ...data[idx], ...updates };
  writeDb('cr_api_connections', data);
  res.json(sanitizeCrApiConn(data[idx]));
});

function verifyOwnerConnectionDeleteAuth(req, res) {
  const sessionUser = req.sessionUser;
  const users = readDb('users') || [];
  const ownerRec = users.find(u =>
    u && (
      (sessionUser && Number(u.id) === Number(sessionUser.id)) ||
      (sessionUser && String(u.username || '').toLowerCase() === String(sessionUser.username || '').toLowerCase()) ||
      String(u.role || '').toLowerCase() === 'owner'
    )
  );
  if (!ownerRec) {
    res.status(403).json({ error: 'Owner account verification failed.' });
    return false;
  }
  const password = String(req.body?.password || req.headers['x-confirm-password'] || '').trim();
  if (!password) {
    res.status(403).json({ error: 'Owner password is required to permanently delete this connection.' });
    return false;
  }
  if (!verifyPassword(password, ownerRec.password || '')) {
    res.status(403).json({ error: 'Incorrect Owner password. Deletion was cancelled.' });
    return false;
  }
  if (ownerRec.two_fa && ownerRec.two_fa_secret) {
    const code = String(req.body?.two_fa_code || req.body?.code || req.headers['x-confirm-2fa'] || '').trim();
    if (!code) {
      res.status(403).json({ error: 'Please enter your 6-digit 2FA verification code to permanently delete this connection.' });
      return false;
    }
    if (!verifyTotp(code, ownerRec.two_fa_secret)) {
      res.status(403).json({ error: 'Invalid 2FA verification code. Deletion was cancelled.' });
      return false;
    }
  }
  return true;
}

app.delete('/api/cr-api-connections/:id', (req, res) => {
  const data = readDb('cr_api_connections') || [];
  const id = Number(req.params.id);
  const existing = data.find(x => Number(x.id) === id);
  if (!existing) return res.status(404).json({ error: 'API connection not found.' });
  if (existing.active !== false) {
    return res.status(400).json({ error: 'This API connection is currently active. Please stop or pause it before deleting.' });
  }
  if (!verifyOwnerConnectionDeleteAuth(req, res)) return;
  crApiBackoff.delete(id);
  writeDb('cr_api_connections', data.filter(x => Number(x.id) !== id));
  logAudit(req.sessionUser?.username || 'Owner', 'Delete CR API Connection', `Deleted stopped connection #${id} (${existing.panel_name || existing.name || existing.provider || ''})`, 'CR API');
  res.json({ success: true });
});

// Whitenoise Connections (Owner only via API_RULES)
let _cachedOutboundIp = { ip: '', fetchedAt: 0 };
app.get('/api/whitenoise-connections/server-ip', async (req, res) => {
  try {
    const now = Date.now();
    if (_cachedOutboundIp.ip && (now - _cachedOutboundIp.fetchedAt) < 300000) {
      return res.json({ success: true, ip: _cachedOutboundIp.ip });
    }
    const providers = ['https://api.ipify.org?format=json', 'https://ifconfig.me/ip'];
    let foundIp = '';
    for (const u of providers) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch(u, { signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) {
          const txt = (await r.text()).trim();
          try { foundIp = JSON.parse(txt).ip || ''; } catch (_) { foundIp = txt.split(/\s+/)[0]; }
          if (foundIp) break;
        }
      } catch (_) {}
    }
    if (foundIp) _cachedOutboundIp = { ip: foundIp, fetchedAt: now };
    res.json({ success: Boolean(foundIp), ip: foundIp || '' });
  } catch (err) {
    res.json({ success: false, ip: '', error: err.message });
  }
});

function sanitizeWhitenoiseConnectionForResponse(c, matchedCount = 0) {
  const ak = String(c.api_key || '').trim();
  const maskedKey = ak.length > 6 ? `${ak.slice(0, 3)}••••••${ak.slice(-3)}` : (ak ? '••••••' : '—');
  const maskedCookie = (c.web_cookie && c.web_cookie.length > 6)
    ? `${c.web_cookie.slice(0, 4)}••••${c.web_cookie.slice(-4)}`
    : (c.web_cookie ? '••••••' : 'None');
  const { api_key: _ak, web_cookie: _wc, web_password: _wp, ...safeRest } = c;
  return {
    ...safeRest,
    panel_name: c.panel_name || c.name || 'Whitenoise Main',
    web_url: normalizeWhitenoiseWebBaseUrl(c.web_login_url || c.web_url || 'https://whitenoise.one'),
    web_login_url: normalizeWhitenoiseWebBaseUrl(c.web_login_url || c.web_url || 'https://whitenoise.one'),
    web_sms_url: String(c.web_sms_url || `${normalizeWhitenoiseWebBaseUrl(c.web_login_url || c.web_url || 'https://whitenoise.one')}/sms`).trim(),
    web_email: c.web_email || '',
    has_web_password: Boolean(c.web_password),
    poll_interval_sec: c.interval || c.poll_interval_sec || 240,
    pool_interval_sec: c.pool_interval_sec || 540,
    timeout_ms: Number(c.timeout_ms || 15000),
    user_agent: c.user_agent || '',
    api_key_masked: maskedKey,
    cookie_masked: maskedCookie,
    has_api_key: Boolean(c.api_key),
    has_web_cookie: Boolean(c.web_cookie),
    numbers_count: matchedCount
  };
}

app.get('/api/whitenoise-connections', (req, res) => {
  const data = readDb('whitenoise_connections') || [];
  const numbers = readDb('numbers') || [];
  const wnRangesMap = buildRangesLookupMap();
  const wnTags = getWhitenoiseProviderTags();
  const wnNumbers = numbers.filter(n => isWhitenoiseRecord(n, wnRangesMap, wnTags));

  const mapped = data.map(c => {
    const tag = String(c.provider_tag || 'Whitenoise').trim().toLowerCase();
    const matchedCount = wnNumbers.filter(n => {
      const p = String(n.provider || '').toLowerCase();
      return !tag || p.includes(tag) || p.includes('whitenoise');
    }).length;
    return sanitizeWhitenoiseConnectionForResponse(c, matchedCount);
  });

  if (req.query.page) {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const start = (page - 1) * limit;
    return res.json({ data: mapped.slice(start, start + limit), total: mapped.length });
  }
  res.json({ data: mapped, total: mapped.length });
});

app.post('/api/whitenoise-connections', (req, res) => {
  const body = req.body || {};
  const data = readDb('whitenoise_connections') || [];
  const name = String(body.name || body.panel_name || 'Whitenoise Provider').trim();
  const rawMode = String(body.mode || 'hybrid').trim().toLowerCase();
  const mode = ['hybrid', 'web_login', 'api_key'].includes(rawMode) ? rawMode : 'api_key';
  const apiKey = String(body.api_key || '').trim();
  const webCookie = String(body.web_cookie || body.cookie || '').trim();
  const webEmail = String(body.web_email || body.email || '').trim();
  const webPassword = String(body.web_password || body.password || '');
  const baseUrl = String(body.base_url || 'https://api.whitenoise.one').trim().replace(/\/+$/, '');
  const webUrl = normalizeWhitenoiseWebBaseUrl(body.web_login_url || body.web_url || 'https://whitenoise.one');
  const webSmsUrl = String(body.web_sms_url || `${webUrl}/sms`).trim().replace(/\/+$/, '');
  const providerTag = String(body.provider_tag || 'Whitenoise').trim() || 'Whitenoise';

  if (mode === 'api_key' && apiKey.length < 6) {
    return res.status(400).json({ error: 'Valid Whitenoise API Key is required for API Key mode.' });
  }
  if (mode === 'web_login' && !webCookie && !(webEmail && webPassword)) {
    return res.status(400).json({ error: 'Web Panel Login mode requires Whitenoise Email + Password or an APPSID Session Cookie.' });
  }
  if (mode === 'hybrid' && !webCookie && !(webEmail && webPassword) && apiKey.length < 6) {
    return res.status(400).json({ error: 'Hybrid mode requires Email + Password, an APPSID Cookie, and/or an API Key.' });
  }

  const dup = data.find(c =>
    (apiKey && String(c.api_key || '').trim() === apiKey) ||
    (String(c.name || '').trim().toLowerCase() === name.toLowerCase())
  );
  if (dup) {
    return res.status(409).json({ error: `Whitenoise connection "${dup.name}" with matching name or API key already exists.` });
  }

  const convModeRaw = String(body.conversion_mode || 'on_client_match').trim().toLowerCase();
  const conversionMode = ['on_client_match', 'always', 'off'].includes(convModeRaw) ? convModeRaw : 'on_client_match';
  const effInterval = Math.max(5, parseInt(body.interval ?? body.poll_interval_sec, 10) || 240);
  const effPoolInterval = Math.max(60, parseInt(body.pool_interval_sec, 10) || 540);
  const timeoutMs = Math.max(3000, Math.min(60000, parseInt(body.timeout_ms, 10) || 15000));

  const item = {
    id: nextId(data, 'whitenoise_connections'),
    name,
    panel_name: name,
    mode,
    api_key: apiKey,
    web_cookie: webCookie,
    web_email: webEmail,
    web_password: webPassword,
    base_url: baseUrl,
    web_url: webUrl,
    web_login_url: webUrl,
    web_sms_url: webSmsUrl,
    provider_tag: providerTag,
    service_name: String(body.service_name || '').trim(),
    interval: effInterval,
    poll_interval_sec: effInterval,
    client_interval_sec: Math.max(10, parseInt(body.client_interval_sec, 10) || effInterval),
    pool_interval_sec: effPoolInterval,
    timeout_ms: timeoutMs,
    user_agent: String(body.user_agent || '').trim(),
    concurrency: Math.min(10, Math.max(1, parseInt(body.concurrency, 10) || 4)),
    max_numbers_per_cycle: Math.min(200, Math.max(1, parseInt(body.max_numbers_per_cycle, 10) || 20)),
    since: Math.max(60, parseInt(body.since, 10) || 600),
    conversion_mode: conversionMode,
    active: body.active !== undefined ? Boolean(body.active) : true,
    last_pulled_at: null,
    last_status: 'Not polled yet',
    total_pulled: 0,
    total_conversions: 0,
    created: new Date().toISOString()
  };

  data.push(item);
  writeDb('whitenoise_connections', data);
  logAudit(req.sessionUser?.username || 'Owner', 'Add Whitenoise Connection', `Added Whitenoise '${item.name}' (${item.mode}, Monthly 30/5 {W})`, 'Whitenoise');

  res.json(sanitizeWhitenoiseConnectionForResponse(item, 0));
});

app.patch('/api/whitenoise-connections/:id', (req, res) => {
  const data = readDb('whitenoise_connections') || [];
  const id = Number(req.params.id);
  const idx = data.findIndex(x => Number(x.id) === id);
  if (idx === -1) return res.status(404).json({ error: 'Whitenoise connection not found' });

  const body = req.body || {};
  const next = { ...data[idx] };
  if (body.name !== undefined || body.panel_name !== undefined) {
    const nm = String(body.name ?? body.panel_name ?? '').trim();
    if (nm) { next.name = nm; next.panel_name = nm; }
  }
  if (body.mode !== undefined) {
    const rm = String(body.mode).trim().toLowerCase();
    if (['hybrid', 'web_login', 'api_key'].includes(rm)) next.mode = rm;
  }
  if (body.api_key !== undefined && String(body.api_key).trim()) next.api_key = String(body.api_key).trim();
  const rawCk = body.web_cookie ?? body.cookie;
  if (rawCk !== undefined && String(rawCk).trim()) next.web_cookie = String(rawCk).trim();
  const rawEmail = body.web_email ?? body.email;
  if (rawEmail !== undefined) next.web_email = String(rawEmail).trim();
  const rawPass = body.web_password ?? body.password;
  if (rawPass !== undefined && String(rawPass).length > 0) next.web_password = String(rawPass);
  if (body.base_url !== undefined && String(body.base_url).trim()) next.base_url = String(body.base_url).trim().replace(/\/+$/, '');
  if (body.web_login_url !== undefined && String(body.web_login_url).trim()) {
    next.web_login_url = normalizeWhitenoiseWebBaseUrl(body.web_login_url);
    next.web_url = next.web_login_url;
  } else if (body.web_url !== undefined && String(body.web_url).trim()) {
    next.web_url = normalizeWhitenoiseWebBaseUrl(body.web_url);
    next.web_login_url = next.web_url;
  }
  if (body.web_sms_url !== undefined && String(body.web_sms_url).trim()) {
    next.web_sms_url = String(body.web_sms_url).trim().replace(/\/+$/, '');
  }
  if (body.provider_tag !== undefined && String(body.provider_tag).trim()) next.provider_tag = String(body.provider_tag).trim();
  if (body.service_name !== undefined) next.service_name = String(body.service_name).trim();
  if (body.interval !== undefined || body.poll_interval_sec !== undefined) {
    const iv = Math.max(5, parseInt(body.interval ?? body.poll_interval_sec, 10) || next.interval || 240);
    next.interval = iv;
    next.poll_interval_sec = iv;
    next.client_interval_sec = iv;
  }
  if (body.pool_interval_sec !== undefined) {
    next.pool_interval_sec = Math.max(60, parseInt(body.pool_interval_sec, 10) || 540);
  }
  if (body.timeout_ms !== undefined) {
    next.timeout_ms = Math.max(3000, Math.min(60000, parseInt(body.timeout_ms, 10) || 15000));
  }
  if (body.user_agent !== undefined) {
    next.user_agent = String(body.user_agent || '').trim();
  }
  if (body.concurrency !== undefined) next.concurrency = Math.min(10, Math.max(1, parseInt(body.concurrency, 10) || 4));
  if (body.max_numbers_per_cycle !== undefined) next.max_numbers_per_cycle = Math.min(200, Math.max(1, parseInt(body.max_numbers_per_cycle, 10) || 20));
  if (body.since !== undefined) next.since = Math.max(60, parseInt(body.since, 10) || 600);
  if (body.conversion_mode !== undefined) {
    const cm = String(body.conversion_mode).trim().toLowerCase();
    if (['on_client_match', 'always', 'off'].includes(cm)) next.conversion_mode = cm;
  }
  if (body.active !== undefined) next.active = Boolean(body.active);

  data[idx] = next;
  writeDb('whitenoise_connections', data);
  res.json(sanitizeWhitenoiseConnectionForResponse(next));
});

app.delete('/api/whitenoise-connections/:id', (req, res) => {
  const data = readDb('whitenoise_connections') || [];
  const id = Number(req.params.id);
  const existing = data.find(x => Number(x.id) === id);
  if (!existing) return res.status(404).json({ error: 'Whitenoise connection not found.' });
  if (existing.active !== false) {
    return res.status(400).json({ error: 'This Whitenoise connection is currently active. Please stop or pause it before deleting.' });
  }
  if (!verifyOwnerConnectionDeleteAuth(req, res)) return;
  writeDb('whitenoise_connections', data.filter(x => Number(x.id) !== id));
  logAudit(req.sessionUser?.username || 'Owner', 'Delete Whitenoise Connection', `Deleted stopped Whitenoise connection #${id} (${existing.name || ''})`, 'Whitenoise');
  res.json({ success: true });
});

app.post('/api/whitenoise-connections/:id/test-connection', async (req, res) => {
  const id = Number(req.params.id);
  const conns = readDb('whitenoise_connections') || [];
  const conn = conns.find(c => Number(c.id) === id);
  if (!conn) return res.status(404).json({ error: 'Whitenoise connection not found' });

  const checks = [];
  let webOk = false;
  let apiOk = false;
  const hasWebCreds = Boolean(conn.web_cookie || (conn.web_email && conn.web_password));

  if (hasWebCreds) {
    try {
      const wnNums = getNumbersForWhitenoiseConnection(conn);
      const samplePhone = req.body?.phone || (wnNums[0] && wnNums[0].number) || '';
      const webRes = await pollWhitenoiseWebFeed(conn, {
        ingest: false,
        windowMinutes: 1440,
        filterPhone: samplePhone || undefined,
        bypassCooldown: true
      });
      webOk = true;
      const phoneLabel = samplePhone ? ` for ${formatWhitenoisePhone(samplePhone)}` : '';
      checks.push({ channel: 'web_panel', ok: true, detail: `Connected to ${normalizeWhitenoiseWebBaseUrl(conn.web_url)}/sms${phoneLabel} — parsed ${webRes.rows_parsed} SMS row(s).` });
    } catch (err) {
      checks.push({ channel: 'web_panel', ok: false, detail: err.message });
    }
  }

  if (conn.api_key) {
    const wnNums = getNumbersForWhitenoiseConnection(conn);
    const chosenPhone = req.body?.phone || (wnNums[0] && wnNums[0].number) || '';
    if (!chosenPhone) {
      apiOk = true;
      checks.push({
        channel: 'api_key',
        ok: true,
        detail: 'API Key saved. Click "Test" and enter a real Whitenoise API-project phone number to verify live (Whitenoise returns 403 for unassigned numbers).'
      });
    } else {
      const samplePhone = formatWhitenoisePhone(chosenPhone);
      try {
        const apiRes = await callWhitenoiseApi(conn, '/sms/get-phone-last-sms', { phone: samplePhone, since: 600 }, 'POST');
        apiOk = true;
        const cnt = Array.isArray(apiRes?.sms) ? apiRes.sms.length : 0;
        checks.push({ channel: 'api_key', ok: true, detail: `API reachable (${conn.base_url || 'https://api.whitenoise.one'}) — status OK (${cnt} SMS for ${samplePhone}).` });
      } catch (err) {
        checks.push({ channel: 'api_key', ok: false, detail: err.message });
      }
    }
  }

  if (!checks.length) {
    return res.status(400).json({ success: false, error: 'No credentials configured. Add Whitenoise Email/Password, APPSID Cookie, or API Key.', checks });
  }

  const overallOk = webOk || apiOk;
  conn.last_status = overallOk
    ? `Verified (${[webOk ? 'Web OK' : '', apiOk ? 'API OK' : ''].filter(Boolean).join(' + ')})`
    : `Error — ${checks[0].detail.slice(0, 180)}`;
  const all = readDb('whitenoise_connections') || [];
  const idx = all.findIndex(c => Number(c.id) === id);
  if (idx !== -1) { all[idx] = conn; writeDb('whitenoise_connections', all); }

  res.status(overallOk ? 200 : 502).json({
    success: overallOk,
    web_ok: webOk,
    api_ok: apiOk,
    checks,
    error: overallOk ? undefined : checks.map(c => `${c.channel}: ${c.detail}`).join(' | ')
  });
});

app.post('/api/whitenoise-connections/:id/test-number', async (req, res) => {
  const id = Number(req.params.id);
  const conns = readDb('whitenoise_connections') || [];
  const conn = conns.find(c => Number(c.id) === id);
  if (!conn) return res.status(404).json({ error: 'Whitenoise connection not found' });
  const phone = formatWhitenoisePhone(req.body?.phone || req.body?.number || '');
  if (!phone || phone.length < 6) {
    return res.status(400).json({ error: 'Valid phone number is required to test Whitenoise.' });
  }
  const shouldIngest = req.body?.ingest !== false;
  const hasWebCreds = Boolean(conn.web_cookie || (conn.web_email && conn.web_password));
  const mapDisplayRows = (rows) => (rows || []).map(r => ({
    ...r,
    cli: r.src || r.service_name || r.cli || 'Whitenoise',
    sender: r.src || r.service_name || r.sender || 'Whitenoise',
    message: r.text || r.message || '',
    timestamp: r.time || r.time_received || r.time_sent || r.timestamp || ''
  }));

  if (!conn.api_key && !hasWebCreds) {
    return res.status(400).json({ error: 'Connection needs an API Key or Web Panel Login (Email/Password or APPSID Cookie).' });
  }

  let apiErr = null;
  if (conn.api_key && String(conn.mode || '').toLowerCase() !== 'web_login') {
    try {
      const result = await fetchWhitenoiseSinglePhone(conn, phone, {
        bypassCooldown: true,
        onDemand: true,
        includeCount: true,
        ingest: shouldIngest,
        since: parseInt(req.body?.since, 10) || conn.since || 600,
        service_name: req.body?.service_name || conn.service_name || ''
      });
      return res.json({
        success: true,
        phone,
        source: 'whitenoise',
        ingested: result.new_sms || 0,
        messages: mapDisplayRows(result.latest_sms || []),
        ...result
      });
    } catch (err) {
      apiErr = err;
      if (!hasWebCreds) {
        return res.status(502).json({ success: false, error: err.message });
      }
    }
  }

  // Fallback or primary Web Panel Feed test for web_login / hybrid (uses live ?sms_to=%2B...&dup=2)
  try {
    const webRes = await pollWhitenoiseWebFeed(conn, {
      ingest: shouldIngest,
      filterPhone: phone,
      windowMinutes: 1440,
      bypassCooldown: true,
      onDemand: true
    });
    const matched = (webRes.rows || []).filter(r => phoneDigitsVariantsMatch(r.dst, phone));
    return res.json({
      success: true,
      phone,
      source: apiErr ? 'whitenoise_web_fallback' : 'whitenoise_web',
      api_warning: apiErr ? apiErr.message : undefined,
      ingested: webRes.new_sms || 0,
      new_sms: webRes.new_sms || 0,
      fetched_count: matched.length,
      messages: mapDisplayRows(matched)
    });
  } catch (webErr) {
    const combined = apiErr ? `API: ${apiErr.message} | Web: ${webErr.message}` : webErr.message;
    return res.status(502).json({ success: false, error: combined });
  }
});

app.post('/api/whitenoise-connections/:id/pull', async (req, res) => {
  const id = Number(req.params.id);
  const conns = readDb('whitenoise_connections') || [];
  const conn = conns.find(c => Number(c.id) === id);
  if (!conn) return res.status(404).json({ error: 'Whitenoise connection not found' });
  try {
    const pulled = await pollSingleWhitenoiseConnection(id, true);
    const updated = (readDb('whitenoise_connections') || []).find(c => Number(c.id) === id);
    const st = String(updated?.last_status || 'OK');
    const isErr = st.startsWith('Error') || st.startsWith('Warning');
    res.json({
      success: !isErr,
      error: isErr ? st : undefined,
      pulled: pulled || 0,
      checked: pulled || 0,
      conversions: 0,
      status: st,
      total_pulled: updated?.total_pulled || 0
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Login Panels (Web Scraping)
app.get('/api/login-panels', (req, res) => {
  const panels = readDb('login_panels') || [];
  const safe = panels.map(p => {
    const { password, ...rest } = p;
    return { ...rest, has_password: Boolean(password) };
  });
  if (req.query.page) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const start = (page - 1) * limit;
    return res.json({ data: safe.slice(start, start + limit), total: safe.length });
  }
  res.json({ data: safe, total: safe.length });
});

app.post('/api/login-panels', (req, res) => {
  const { name, username, password, panel_url, data_url, interval, rows, columns } = req.body || {};
  if (!username || !panel_url || !data_url || !password) {
    return res.status(400).json({ error: 'Username, password, panel_url, and data_url are required' });
  }
  let safePanelUrl, safeDataUrl;
  try {
    safePanelUrl = assertSafeExternalUrl(panel_url, 'Panel URL');
    safeDataUrl = assertSafeExternalUrl(data_url, 'SMS Data URL');
  } catch (urlErr) {
    return res.status(400).json({ error: urlErr.message });
  }
  const panels = readDb('login_panels') || [];
  let defaultName = name;
  if (!defaultName) {
    try { defaultName = new URL(safePanelUrl).hostname; } catch(e) { defaultName = 'Login Panel'; }
  }
  const newPanel = {
    id: nextId(panels, 'login_panels'),
    name: defaultName,
    username: String(username).trim(),
    password: String(password),
    panel_url: safePanelUrl,
    data_url: safeDataUrl,
    interval: Math.max(10, parseInt(interval) || 15),
    rows: parseInt(rows) || 200,
    columns: columns || null,
    status: 'stopped',
    total_sms: 0,
    last_run: null,
    last_error: '',
    created: new Date().toISOString()
  };
  panels.push(newPanel);
  writeDb('login_panels', panels);
  logAudit('Admin', 'Add Login Panel', `Added panel '${newPanel.name}'`, 'Login Panel');
  const { password: _, ...safe } = newPanel;
  res.json({ ...safe, has_password: true });
});

app.patch('/api/login-panels/:id', (req, res) => {
  const panels = readDb('login_panels') || [];
  const id = Number(req.params.id);
  const idx = panels.findIndex(p => Number(p.id) === id);
  if (idx === -1) return res.status(404).json({ error: 'Login panel not found' });
  const updates = {};
  if (req.body.name !== undefined) updates.name = String(req.body.name).trim() || panels[idx].name;
  if (req.body.username !== undefined) updates.username = String(req.body.username).trim() || panels[idx].username;
  if (req.body.password !== undefined && String(req.body.password).trim()) updates.password = String(req.body.password);
  if (req.body.panel_url !== undefined) {
    try { updates.panel_url = assertSafeExternalUrl(req.body.panel_url, 'Panel URL'); }
    catch (urlErr) { return res.status(400).json({ error: urlErr.message }); }
  }
  if (req.body.data_url !== undefined) {
    try { updates.data_url = assertSafeExternalUrl(req.body.data_url, 'SMS Data URL'); }
    catch (urlErr) { return res.status(400).json({ error: urlErr.message }); }
  }
  if (req.body.interval !== undefined) updates.interval = Math.max(10, parseInt(req.body.interval) || 15);
  if (req.body.rows !== undefined) updates.rows = parseInt(req.body.rows) || 200;
  panels[idx] = { ...panels[idx], ...updates };
  loginPanelCookieCache.delete(id);
  loginPanelBackoff.delete(id);
  writeDb('login_panels', panels);
  const { password: _, ...safe } = panels[idx];
  res.json({ ...safe, has_password: Boolean(panels[idx].password) });
});

app.delete('/api/login-panels/:id', (req, res) => {
  const panels = readDb('login_panels') || [];
  const id = Number(req.params.id);
  const existing = panels.find(p => Number(p.id) === id);
  if (!existing) return res.status(404).json({ error: 'Login panel not found.' });
  if (String(existing.status || '').toLowerCase() === 'running') {
    return res.status(400).json({ error: 'This login panel is currently running. Please stop it before deleting.' });
  }
  if (!verifyOwnerConnectionDeleteAuth(req, res)) return;
  loginPanelCookieCache.delete(id);
  loginPanelBackoff.delete(id);
  writeDb('login_panels', panels.filter(p => Number(p.id) !== id));
  logAudit(req.sessionUser?.username || 'Owner', 'Delete Login Panel', `Deleted stopped panel #${id} (${existing.name || ''})`, 'Login Panel');
  res.json({ success: true });
});

app.post('/api/login-panels/:id/start', (req, res) => {
  const panels = readDb('login_panels') || [];
  const id = Number(req.params.id);
  const panel = panels.find(p => Number(p.id) === id);
  if (!panel) return res.status(404).json({ error: 'Login panel not found' });
  panel.status = 'running';
  panel.last_error = '';
  loginPanelBackoff.delete(id);
  writeDb('login_panels', panels);
  logAudit('Admin', 'Start Login Panel', `Started scraping panel '${panel.name}'`, 'Login Panel');
  pollSingleLoginPanel(panel.id).catch(e => console.error('Start poll error:', e));
  res.json({ success: true, status: 'running' });
});

app.post('/api/login-panels/:id/stop', (req, res) => {
  const panels = readDb('login_panels') || [];
  const id = Number(req.params.id);
  const panel = panels.find(p => Number(p.id) === id);
  if (!panel) return res.status(404).json({ error: 'Login panel not found' });
  panel.status = 'stopped';
  loginPanelBackoff.delete(id);
  writeDb('login_panels', panels);
  logAudit('Admin', 'Stop Login Panel', `Stopped scraping panel '${panel.name}'`, 'Login Panel');
  res.json({ success: true, status: 'stopped' });
});

app.post('/api/login-panels/:id/test', async (req, res) => {
  const panels = readDb('login_panels') || [];
  const id = Number(req.params.id);
  const panel = panels.find(p => Number(p.id) === id);
  if (!panel) return res.status(404).json({ error: 'Login panel not found' });
  try {
    assertSafeExternalUrl(panel.panel_url, 'Panel URL');
    assertSafeExternalUrl(panel.data_url, 'SMS Data URL');
    loginPanelCookieCache.delete(id); // force fresh login check on Test
    const result = await runNodeLoginPanelScraper(panel);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    res.json({
      success: true,
      rows: rows.length,
      preview: rows.slice(0, 15)
    });
  } catch (err) {
    const errorMsg = err.name === 'AbortError' ? 'Connection timed out. Please try again.' : (err.message || 'Scraper failed');
    res.json({ success: false, error: errorMsg });
  }
});

app.post('/api/login-panels/:id/pull', async (req, res) => {
  const panels = readDb('login_panels') || [];
  const id = Number(req.params.id);
  const panel = panels.find(p => Number(p.id) === id);
  if (!panel) return res.status(404).json({ error: 'Login panel not found' });
  try {
    loginPanelBackoff.delete(id);
    const added = await pollSingleLoginPanel(id, true);
    const updated = (readDb('login_panels') || []).find(p => Number(p.id) === id);
    res.json({
      success: !updated?.last_error,
      pulled: added || 0,
      total: updated?.total_sms || 0,
      error: updated?.last_error || ''
    });
  } catch (err) {
    const errorMsg = err.killed ? 'Connection timed out. Please try again.' : (err.message || 'Scraper pull failed');
    res.json({ success: false, error: errorMsg });
  }
});



// ── Agent Endpoints ──────────────────────────────────────────
app.get('/api/agent/:agent_id/earnings', requireAuth, (req, res) => {
  const aid = String(req.params.agent_id);
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isAgentSelf = sRole === 'agent' && String(sessionUser.id) === aid;

  if (!isOwner && !isAgentSelf) {
    return res.status(403).json({ error: 'Forbidden. You can only access your own agent earnings.' });
  }

  const agents = readDb('agents') || [];
  const agent = agents.find(a => String(a.id) === aid);

  const sms = readDb('sms_log') || [];
  const mySms = sms.filter(s => Number(s.agent_id) === Number(aid));

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth(), 0);
  const lastMonthEndStr = lastMonthDate.toISOString().slice(0, 10);
  const lastMonthStartStr = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

  const sumProfit = (records) => Math.round(records.reduce((acc, r) => acc + (Number(r.profit) || 0), 0) * 100) / 100;

  const todaySms = mySms.filter(s => (s.timestamp || '').slice(0, 10) === todayStr);
  const monthSms = mySms.filter(s => (s.timestamp || '').slice(0, 10) >= monthStartStr);
  const lastMonthSms = mySms.filter(s => {
    const ts = (s.timestamp || '').slice(0, 10);
    return ts >= lastMonthStartStr && ts <= lastMonthEndStr;
  });

  // UTC Mon-Sun Weekly Settlement Cycle (Sunday 23:59:59 UTC cutoff -> shifts to Main Balance)
  const diffToMonday = (now.getUTCDay() + 6) % 7;
  const currentWeekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday, 0, 0, 0, 0));
  const currentWeekEnd = new Date(currentWeekStart.getTime() + 7 * 86400000 - 1);
  const currentWeekStartIso = currentWeekStart.toISOString();
  const currentWeekEndIso = currentWeekEnd.toISOString();
  const monStr = currentWeekStartIso.slice(0, 10);
  const sunStr = currentWeekEndIso.slice(0, 10);
  const weekRangeStr = `${monStr} – ${sunStr} UTC`;

  const thisWeekSms = mySms.filter(s => {
    const ts = s.timestamp || s.created_at || s.date || '';
    return ts >= currentWeekStartIso && ts <= currentWeekEndIso;
  });
  const thisWeekEarnings = sumProfit(thisWeekSms);

  const previousSettledSms = mySms.filter(s => {
    const ts = s.timestamp || s.created_at || s.date || '';
    return ts < currentWeekStartIso;
  });
  const previousSettledEarnings = sumProfit(previousSettledSms);

  const allPayouts = readDb('payout_requests') || [];
  const agentPayouts = allPayouts.filter(p => String(p.agent_id) === aid && p.status !== 'rejected');
  const totalPayoutsDeducted = agentPayouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const agentBaseBal = Number(agent?.balance || 0);
  const mainBalance = Math.max(0, Math.round((agentBaseBal + previousSettledEarnings - totalPayoutsDeducted) * 100) / 100);

  const chartData = [];
  const history = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dayStr = d.toISOString().slice(0, 10);
    const daySms = mySms.filter(s => (s.timestamp || '').slice(0, 10) === dayStr);
    const dayEarn = sumProfit(daySms);
    chartData.push(dayEarn);
    if (daySms.length > 0) {
      history.push({
        date: dayStr,
        sms_count: daySms.length,
        rate: agent ? (agent.commission_rate || 5) : 5,
        commission: dayEarn,
        status: i > 0 ? 'paid' : 'pending'
      });
    }
  }

  res.json({
    main_balance: mainBalance,
    balance: mainBalance,
    this_week: thisWeekEarnings,
    week_range: weekRangeStr,
    week_start: monStr,
    week_end: sunStr,
    today: sumProfit(todaySms),
    this_month: sumProfit(monthSms),
    last_month: sumProfit(lastMonthSms),
    all_time: sumProfit(mySms),
    chart_data: chartData,
    history: history.reverse()
  });
});

app.get('/api/agents/:agent_id/weekly-earnings', requireAuth, (req, res) => {
  res.json({ data: [], total: 0 });
});

// ── Client Endpoints ──────────────────────────────────────────
app.get('/api/client/:client_id/stats', requireAuth, (req, res) => {
  const cid = String(req.params.client_id);
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const clients = readDb('clients') || [];
  const client = clients.find(c => String(c.id) === cid);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const isClientSelf = sRole === 'client' && String(sessionUser.id) === cid;
  const isClientAgent = sRole === 'agent' && Number(client.agent_id) === Number(sessionUser.id);

  if (!isOwner && !isClientSelf && !isClientAgent) {
    return res.status(403).json({ error: 'Forbidden. You can only access your own client data.' });
  }

  const numbers = readDb('numbers') || [];
  const numbersAssigned = numbers.filter(n => String(n.client_id) === cid).length;

  if (isOwner) {
    return res.json({
      numbers_assigned: numbersAssigned,
      total_sms: client.total_sms || 0,
      status: client.status || 'active',
      privacy_redacted: true
    });
  }

  const fx = getUsdToPkrRate();
  const balUsd = Number(client.balance || 0);
  const balPkr = client.balance_pkr != null ? Number(client.balance_pkr) : round2(balUsd * fx);
  res.json({
    numbers_assigned: numbersAssigned,
    total_sms: client.total_sms || 0,
    balance: balUsd,
    balance_pkr: balPkr,
    daily_limit: client.daily_limit || 0,
    monthly_limit: client.monthly_limit || 0,
    status: client.status || 'active'
  });
});

app.get('/api/client/:client_id/earnings', requireAuth, (req, res) => {
  const cid = String(req.params.client_id);
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  if (isOwner) {
    return res.status(403).json({ error: 'Forbidden. Client financial earnings are private to their Agent.' });
  }
  const clients = readDb('clients') || [];
  const client = clients.find(c => String(c.id) === cid);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const isClientSelf = sRole === 'client' && String(sessionUser.id) === cid;
  const isClientAgent = sRole === 'agent' && Number(client.agent_id) === Number(sessionUser.id);

  if (!isClientSelf && !isClientAgent) {
    return res.status(403).json({ error: 'Forbidden. You can only access your own client earnings.' });
  }

  const sms = readDb('sms_log') || [];
  const clientSms = sms.filter(s => {
    return String(s.client_id) === cid || String(s.client) === cid || (client && (s.client === client.username || s.user === client.username));
  });

  const fxRate = getUsdToPkrRate();
  const sumClientPayout = (records) => Math.round(records.reduce((acc, r) => acc + (Number(r.client_payout != null ? r.client_payout : (r.client_rate || r.payout || 0)) || 0), 0) * 100) / 100;
  const sumClientPayoutPkr = (records) => round2(records.reduce((acc, r) => {
    if (r && r.client_amount_pkr != null) return acc + (Number(r.client_amount_pkr) || 0);
    const usdAmt = Number(r?.client_payout != null ? r.client_payout : (r?.client_amount != null ? r.client_amount : (r?.client_rate || r?.payout || 0))) || 0;
    return acc + (usdAmt * (Number(r?.fx_usd_to_pkr) || fxRate));
  }, 0));

  const now = new Date();
  const diffToMonday = (now.getUTCDay() + 6) % 7;
  const currentWeekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday, 0, 0, 0, 0));
  const currentWeekEnd = new Date(currentWeekStart.getTime() + 7 * 86400000 - 1);
  const currentWeekStartIso = currentWeekStart.toISOString();
  const currentWeekEndIso = currentWeekEnd.toISOString();
  const monStr = currentWeekStartIso.slice(0, 10);
  const sunStr = currentWeekEndIso.slice(0, 10);
  const weekRangeStr = `${monStr} – ${sunStr} UTC`;

  const thisWeekSms = clientSms.filter(s => {
    const ts = s.timestamp || s.created_at || s.date || '';
    return ts >= currentWeekStartIso && ts <= currentWeekEndIso;
  });
  const thisWeekEarnings = sumClientPayout(thisWeekSms);
  const thisWeekEarningsPkr = sumClientPayoutPkr(thisWeekSms);

  const previousSettledSms = clientSms.filter(s => {
    const ts = s.timestamp || s.created_at || s.date || '';
    return ts < currentWeekStartIso;
  });
  const previousSettledEarnings = sumClientPayout(previousSettledSms);
  const previousSettledEarningsPkr = sumClientPayoutPkr(previousSettledSms);

  const allPayouts = readDb('payout_requests') || [];
  const clientPayouts = allPayouts.filter(p => String(p.client_id) === cid && p.status !== 'rejected');
  const totalPayoutsDeducted = clientPayouts.reduce((sum, p) => {
    if (String(p.currency || 'USD').toUpperCase() === 'PKR') {
      return sum + (p.amount_usd != null ? Number(p.amount_usd) : (Number(p.amount) || 0) / (Number(p.fx_usd_to_pkr) || fxRate));
    }
    return sum + (Number(p.amount) || 0);
  }, 0);
  const totalPayoutsDeductedPkr = clientPayouts.reduce((sum, p) => {
    if (String(p.currency || 'USD').toUpperCase() === 'PKR') return sum + (Number(p.amount) || 0);
    return sum + ((Number(p.amount) || 0) * (Number(p.fx_usd_to_pkr) || fxRate));
  }, 0);
  const pendingPkr = allPayouts
    .filter(p => String(p.client_id) === cid && (p.status === 'pending' || p.status === 'approved'))
    .reduce((sum, p) => {
      if (String(p.currency || 'USD').toUpperCase() === 'PKR') return sum + (Number(p.amount) || 0);
      return sum + ((Number(p.amount) || 0) * (Number(p.fx_usd_to_pkr) || fxRate));
    }, 0);

  const clientBaseBal = Number(client?.balance || 0);
  const mainBalance = Math.max(0, Math.round((clientBaseBal + previousSettledEarnings - totalPayoutsDeducted) * 100) / 100);
  const mainBalancePkr = client?.balance_pkr != null
    ? Math.max(0, round2(client.balance_pkr))
    : Math.max(0, round2((clientBaseBal * fxRate) + previousSettledEarningsPkr - totalPayoutsDeductedPkr));
  const availableBalancePkr = Math.max(0, round2(mainBalancePkr - pendingPkr));

  const todayStr = now.toISOString().slice(0, 10);
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const todaySms = clientSms.filter(s => (s.timestamp || '').slice(0, 10) === todayStr);
  const monthSms = clientSms.filter(s => (s.timestamp || '').slice(0, 10) >= monthStartStr);

  res.json({
    currency: 'PKR',
    usd_to_pkr_rate: fxRate,
    main_balance: mainBalance,
    balance: mainBalance,
    main_balance_pkr: mainBalancePkr,
    balance_pkr: mainBalancePkr,
    available_balance_pkr: availableBalancePkr,
    this_week: thisWeekEarnings,
    this_week_pkr: thisWeekEarningsPkr,
    week_range: weekRangeStr,
    week_start: monStr,
    week_end: sunStr,
    today: sumClientPayout(todaySms),
    today_pkr: sumClientPayoutPkr(todaySms),
    this_month: sumClientPayout(monthSms),
    this_month_pkr: sumClientPayoutPkr(monthSms),
    all_time: sumClientPayout(clientSms),
    all_time_pkr: sumClientPayoutPkr(clientSms)
  });
});

app.get('/api/client/:client_id/numbers', requireAuth, (req, res) => {
  const cid = String(req.params.client_id);
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const clients = readDb('clients') || [];
  const client = clients.find(c => String(c.id) === cid);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const isClientSelf = sRole === 'client' && String(sessionUser.id) === cid;
  const isClientAgent = sRole === 'agent' && Number(client.agent_id) === Number(sessionUser.id);

  if (!isOwner && !isClientSelf && !isClientAgent) {
    return res.status(403).json({ error: 'Forbidden. You cannot view this client numbers.' });
  }

  let numbers = (readDb('numbers') || []).filter(n => String(n.client_id) === cid);
  if (!isOwner && !hasWhitenoiseAccess(sessionUser)) {
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    numbers = numbers.filter(n => !isWhitenoiseRecord(n, wnRangesMap, wnTags));
  }
  if (!isOwner) {
    const wnTags = getWhitenoiseProviderTags();
    numbers = numbers.map(n => sanitizeNumberForRole(n, false, wnTags));
  }
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const start = (page - 1) * limit;
  res.json({ data: numbers.slice(start, start + limit), total: numbers.length });
});

app.get('/api/client/:client_id/transactions', requireAuth, (req, res) => {
  res.json({ data: [], total: 0 });
});

app.get('/api/sms/client-logs', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser && sessionUser.role ? String(sessionUser.role).toLowerCase() : '');
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const enrich = buildSmsEnricher();
  let data = getScopedSmsList(req).map(s => {
    const item = enrich(s);
    if (!isOwner) {
      item.cli = serverMaskCli(item.cli || item.app || item.sender);
      delete item.company_rate;
      delete item.company_cost;
      delete item.owner_amount;
      delete item.profit;
      delete item.admin_profit;
      delete item.gross_margin;
    }
    return item;
  });
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const start = (page - 1) * limit;
  res.json({ data: data.slice(start, start + limit), total: data.length });
});

function serverMaskCli(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '—') return '—';
  return s.slice(0, 1) + 'XXXXX';
}

function cleanSmsHierarchyName(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  const sl = s.toLowerCase();
  if (['—', '-', 'direct', 'general', 'unassigned', 'unallocated', 'test panel', 'unknown', 'none', 'null', 'n/a'].includes(sl)) return '';
  return s;
}

function cleanSmsMetaVal(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  const sl = s.toLowerCase();
  if (['—', '-', 'manual', 'direct', 'general range', 'unknown', 'none', 'null'].includes(sl)) return '';
  return s;
}

function buildSmsEnricher() {
  const agents = readDb('agents') || [];
  const agentMap = {};
  const agentByUsername = {};
  agents.forEach(a => {
    if (!a) return;
    if (a.id != null) agentMap[Number(a.id)] = a;
    if (a.username) agentByUsername[String(a.username).trim().toLowerCase()] = a;
  });

  const clients = readDb('clients') || [];
  const clientMap = {};
  const clientByUsername = {};
  clients.forEach(c => {
    if (!c) return;
    if (c.id != null) clientMap[Number(c.id)] = c;
    if (c.username) clientByUsername[String(c.username).trim().toLowerCase()] = c;
  });

  const numbers = readDb('numbers') || [];
  const numByRaw = new Map();
  const numByDigits = new Map();
  numbers.forEach(n => {
    if (!n || !n.number) return;
    const raw = String(n.number).trim();
    const dig = raw.replace(/\D/g, '');
    if (raw) numByRaw.set(raw, n);
    if (dig) numByDigits.set(dig, n);
  });

  const ranges = readDb('sms_ranges') || [];
  const rangeById = new Map();
  const rangeByName = new Map();
  ranges.forEach(r => {
    if (!r) return;
    if (r.id != null) rangeById.set(Number(r.id), r);
    const rn = String(r.range_name || r.name || '').trim().toLowerCase();
    if (rn) rangeByName.set(rn, r);
  });

  return function enrichSms(s) {
    const item = { ...s };
    const numRaw = String(item.number || '').trim();
    const numDig = numRaw.replace(/\D/g, '');
    const numRec = numByRaw.get(numRaw) || (numDig ? numByDigits.get(numDig) : null) || null;

    const rCandidate = cleanSmsMetaVal(item.range_name || item.range_label || item.range);
    const rng = (item.range_id && rangeById.get(Number(item.range_id)))
      || (rCandidate && rangeByName.get(rCandidate.toLowerCase()))
      || (numRec && numRec.range_id && rangeById.get(Number(numRec.range_id)))
      || (numRec && numRec.range_name && rangeByName.get(String(numRec.range_name).trim().toLowerCase()))
      || null;

    // Provider (backfill from panel_name/company for CR API & Login Panel records when not matched to an internal range)
    const panelProviderFallback = (item.source === 'cr_api' || item.source === 'login_panel' || item.panel_name)
      ? (cleanSmsMetaVal(item.panel_name) || cleanSmsMetaVal(item.company))
      : '';
    const providerVal = cleanSmsMetaVal(item.provider)
      || cleanSmsMetaVal(rng && rng.provider)
      || cleanSmsMetaVal(numRec && numRec.provider)
      || panelProviderFallback
      || '';

    // Range (also upgrade generic 'International' if dial code resolves to a real country)
    const detectedCtry = numDig ? detectCountry(numDig) : '';
    const rawRangeVal = cleanSmsMetaVal(item.range_name || item.range_label || item.range)
      || cleanSmsMetaVal(rng && (rng.range_name || rng.name))
      || cleanSmsMetaVal(numRec && (numRec.range_name || numRec.range_label || numRec.range))
      || cleanSmsMetaVal(item.country)
      || cleanSmsMetaVal(rng && rng.country)
      || cleanSmsMetaVal(numRec && numRec.country)
      || '';
    const rangeVal = (rawRangeVal === 'International' && detectedCtry && detectedCtry !== 'International' && detectedCtry !== '—')
      ? detectedCtry
      : (rawRangeVal || (detectedCtry !== '—' ? detectedCtry : ''));

    const smsType = 'General';

    // Hierarchy: Client -> Agent (preserve historical deleted client names with unique ID!)
    const rawClUname = String(item.client_username || item.client || item.client_name || '').trim();
    const isLegacyTombstone = rawClUname.startsWith('__deleted_client_');
    let clientName = isLegacyTombstone
      ? `Deleted Client #${rawClUname.split('_')[3] || item.client_id || ''}`.trim()
      : (cleanSmsHierarchyName(item.client_username)
        || cleanSmsHierarchyName(item.client)
        || cleanSmsHierarchyName(item.client_name));
    let clientRec = (!item.client_deleted && item.client_id != null && clientMap[Number(item.client_id)]) || null;
    if (!clientName && clientRec) clientName = cleanSmsHierarchyName(clientRec.username || clientRec.name);
    if (!clientName && !item.client_deleted) {
      const uName = cleanSmsHierarchyName(item.user);
      if (uName && clientByUsername[uName.toLowerCase()]) {
        clientRec = clientByUsername[uName.toLowerCase()];
        clientName = cleanSmsHierarchyName(clientRec.username || clientRec.name);
      }
    }
    if (!clientRec && clientName && !item.client_deleted && item.client_id == null) {
      clientRec = clientByUsername[clientName.toLowerCase()] || null;
    }
    const clientIsDeleted = Boolean(
      item.client_deleted ||
      isLegacyTombstone ||
      (item.client_id != null && item.client_id !== '' && !clientMap[Number(item.client_id)])
    );

    let agentName = cleanSmsHierarchyName(item.agent_username)
      || cleanSmsHierarchyName(item.agent)
      || cleanSmsHierarchyName(item.agent_name);
    let agentRec = (item.agent_id != null && agentMap[Number(item.agent_id)]) || null;
    if (!agentName && agentRec) agentName = cleanSmsHierarchyName(agentRec.username || agentRec.name);
    if (!agentName && clientRec && clientRec.agent_id && agentMap[Number(clientRec.agent_id)]) {
      agentRec = agentMap[Number(clientRec.agent_id)];
      agentName = cleanSmsHierarchyName(agentRec.username || agentRec.name);
    }
    if (!agentRec && agentName) {
      agentRec = agentByUsername[agentName.toLowerCase()] || null;
    }

    if (!(Number(item.company_rate) > 0)) {
      const fallbackCoRate = parseRateValue(item.company_payout) || parseRateValue(item.carrier_revenue) || 0;
      if (fallbackCoRate > 0) item.company_rate = fallbackCoRate;
    }
    item.provider = providerVal;
    item.range = rangeVal;
    item.range_name = rangeVal;
    item.range_label = rangeVal;
    item.type = smsType;
    item.client = clientName || '';
    item.client_is_deleted = clientIsDeleted;
    item.client_display = clientName
      ? (clientIsDeleted
        ? `${clientName} (Deleted${item.client_id != null ? ` #${item.client_id}` : ''})`
        : clientName)
      : '';
    item.agent = agentName || '';
    item.number = numRaw;
    item.cli = String(item.cli || item.app || item.sender || '').trim();
    item.message = String(item.message || '');
    return item;
  };
}

function handleSmsLogsQuery(req, res, { whitenoiseOnly = false } = {}) {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser && sessionUser.role ? String(sessionUser.role).toLowerCase() : '');
  const isOwner = sRole === 'owner' || sRole === 'admin';
  const isClient = sRole === 'client';
  const isAgent = sRole === 'agent';

  // Fix 2 & F3: Scoped strictly from session user, seamlessly loading archives
  const dateFrom = req.query.date_from || '';
  const enrichSms = buildSmsEnricher();
  let list = getScopedSmsList(req, dateFrom).map(enrichSms);
  if (whitenoiseOnly) {
    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    list = list.filter(s => isWhitenoiseRecord(s, wnRangesMap, wnTags));
    const wnExcelRows = getScopedWhitenoiseStatsAsVirtualSms(sessionUser, {
      agent_id: isOwner ? req.query.agent_id : null,
      client_id: (isOwner || isAgent) ? req.query.client_id : null
    });
    if (wnExcelRows.length > 0) {
      list = [...wnExcelRows, ...list];
    }
  }

  const {
    date_from,
    date_to,
    period,
    filter_period,
    range,
    search,
    number,
    cli,
    status,
    group_by
  } = req.query;

  const causeFilter = req.query.fcause || req.query.cause || status;
  if (causeFilter) {
    const sLower = String(causeFilter).toLowerCase().trim();
    if (sLower === '1' || sLower === 'success') {
      list = list.filter(s => s.status === 'delivered' || s.status === 'success' || (s.cause || '').toLowerCase() === 'success');
    } else if (sLower === '2' || sLower === 'scrubag') {
      list = list.filter(s => (s.cause || '').toLowerCase() === 'scrubag' || (s.status || '').toLowerCase() === 'scrubag');
    } else if (sLower === '3' || sLower === 'others') {
      list = list.filter(s => s.status !== 'delivered' && s.status !== 'success' && (s.cause || '').toLowerCase() !== 'success' && (s.cause || '').toLowerCase() !== 'scrubag');
    } else if (sLower !== 'all' && sLower !== '') {
      list = list.filter(s => String(s.status).toLowerCase() === sLower || String(s.cause || '').toLowerCase() === sLower);
    }
  }

  if (req.query.provider) {
    const pLower = String(req.query.provider).trim().toLowerCase();
    const wnTags = getWhitenoiseProviderTags();
    list = list.filter(s => String(maskProviderLabel(s.provider || '', isOwner, wnTags)).toLowerCase().includes(pLower));
  }

  // Predefined period filtering (today, yesterday, month, year, etc.)
  const activePeriod = (period || filter_period || '').trim().toLowerCase();
  const { todaySet, yesterdaySet, weekStartStr, monthStartStr, yearStartStr } = getDateRangeBuckets();
  if (activePeriod === 'today' || activePeriod === 'daily') {
    list = list.filter(s => todaySet.has(extractDateStr(s)));
  } else if (activePeriod === 'yesterday') {
    list = list.filter(s => yesterdaySet.has(extractDateStr(s)));
  } else if (activePeriod === 'this_week' || activePeriod === 'week') {
    list = list.filter(s => extractDateStr(s) >= weekStartStr);
  } else if (activePeriod === 'this_month' || activePeriod === 'month') {
    list = list.filter(s => extractDateStr(s) >= monthStartStr);
  } else if (activePeriod === 'this_year' || activePeriod === 'year') {
    list = list.filter(s => extractDateStr(s) >= yearStartStr);
  }

  // Timezone-safe date comparison (handles UTC and PKT UTC+5 day boundaries cleanly)
  const getSmsUtcAndPktTs = (s) => {
    const rawTs = String(s.timestamp || '').replace('T', ' ').replace(/Z$/i, '').slice(0, 19);
    const ms = Date.parse(s.timestamp || s.date || '');
    const pktTs = Number.isFinite(ms) ? new Date(ms + 5 * 3600000).toISOString().replace('T', ' ').slice(0, 19) : rawTs;
    const ds = extractDateStr(s);
    return { rawTs, pktTs, ds };
  };

  if (date_from) {
    let df = String(date_from).trim().replace('T', ' ');
    const isFullDayStart = df.length === 10 || df.endsWith('00:00:00');
    if (df.length === 10) df = df + ' 00:00:00';
    const dfDate = df.slice(0, 10);
    list = list.filter(s => {
      const { rawTs, pktTs, ds } = getSmsUtcAndPktTs(s);
      if (isFullDayStart) {
        return rawTs >= df || pktTs >= df || (ds && ds >= dfDate);
      }
      return (rawTs && rawTs >= df) || (pktTs && pktTs >= df);
    });
  }
  if (date_to) {
    let dt = String(date_to).trim().replace('T', ' ');
    const isFullDayEnd = dt.length === 10 || dt.endsWith('23:59:59');
    if (dt.length === 10) dt = dt + ' 23:59:59';
    const dtDate = dt.slice(0, 10);
    list = list.filter(s => {
      const { rawTs, pktTs, ds } = getSmsUtcAndPktTs(s);
      if (isFullDayEnd) {
        return (rawTs && rawTs <= dt) || (pktTs && pktTs <= dt) || (ds && ds <= dtDate);
      }
      return (rawTs && rawTs <= dt) || (pktTs && pktTs <= dt);
    });
  }
  if (range) {
    const rLower = String(range).toLowerCase();
    list = list.filter(s =>
      String(s.range_id) === String(range) ||
      String(s.range || '').toLowerCase().includes(rLower) ||
      String(s.range_label || '').toLowerCase().includes(rLower) ||
      String(s.range_name || '').toLowerCase().includes(rLower) ||
      String(s.country || '').toLowerCase().includes(rLower)
    );
  }
  if (number) {
    const numOnlyQ = String(number).trim().toLowerCase();
    if (numOnlyQ) {
      list = list.filter(s =>
        phoneDigitsVariantsMatch(s.number, numOnlyQ) ||
        String(s.number || '').toLowerCase().includes(numOnlyQ) ||
        String(s.message || '').toLowerCase().includes(numOnlyQ)
      );
    }
  }
  if (search) {
    const searchQ = String(search).trim().toLowerCase();
    if (searchQ) {
      const tokens = searchQ.split(/\s+/).filter(Boolean);
      const wnTags = getWhitenoiseProviderTags();
      const fmtSearchNum = (v) => (v != null && v !== '' && !Number.isNaN(Number(v)))
        ? `${v} ${cleanMoneyStr(Number(v), 4)}`
        : '';
      list = list.filter(s => {
        const dtNorm = String(s.timestamp || s.date || s.created || '').replace('T', ' ').slice(0, 19);
        const rawCli = String(s.cli || s.app || s.from || s.sender || '');
        const visibleCli = isOwner ? rawCli : serverMaskCli(rawCli);
        const visibleProvider = maskProviderLabel(s.provider || '', isOwner, wnTags);
        const statusLower = String(s.status || '').toLowerCase();
        const causeDisplay = s.cause || (statusLower === 'delivered' || statusLower === 'success' ? 'Success' : (s.status || ''));
        const curText = isClient ? 'pkr' : `${s.currency || '$'} usd`;
        const ptText = (whitenoiseOnly || String(s.payout_schedule || '').toLowerCase() === 'monthly30_5') ? 'monthly (30/5) {w}' : '';
        const convText = s.conversion_sent ? 'sent' : '';
        const parts = [
          dtNorm,
          s.timestamp || '',
          s.date || '',
          visibleProvider,
          s.range_name || '',
          s.range_label || '',
          s.range || '',
          s.country || '',
          s.number || '',
          visibleCli,
          s.message || '',
          causeDisplay,
          s.status || '',
          curText,
          ptText,
          convText
        ];
        if (isOwner) {
          parts.push(
            s.agent || '',
            s.agent_username || '',
            s.agent_name || '',
            fmtSearchNum(s.company_rate),
            fmtSearchNum(s.company_payout),
            fmtSearchNum(s.carrier_revenue),
            fmtSearchNum(s.my_payout),
            fmtSearchNum(s.agent_payout),
            fmtSearchNum(s.agent_rate),
            fmtSearchNum(s.owner_amount),
            fmtSearchNum(s.profit)
          );
        } else if (isAgent) {
          parts.push(
            s.client || '',
            s.client_username || '',
            s.client_name || '',
            fmtSearchNum(s.agent_payout),
            fmtSearchNum(s.agent_rate),
            fmtSearchNum(s.client_payout),
            fmtSearchNum(s.client_amount),
            fmtSearchNum(s.agent_amount)
          );
        } else if (isClient) {
          parts.push(
            fmtSearchNum(s.client_amount_pkr),
            fmtSearchNum(s.client_payout),
            fmtSearchNum(s.client_amount)
          );
        }
        const haystack = parts.join(' ').toLowerCase();
        return tokens.every(t => {
          if (haystack.includes(t)) return true;
          const tDig = t.replace(/\D/g, '');
          if (tDig.length >= 6 && phoneDigitsVariantsMatch(s.number, tDig)) return true;
          return false;
        });
      });
    }
  }
  if (cli) {
    const cliQ = String(cli).trim().toLowerCase();
    list = list.filter(s =>
      String(s.cli || s.app || '').toLowerCase().includes(cliQ)
    );
  }

  // Sort descending by timestamp
  list.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  const isExport = req.query.export === 'csv' || req.path.endsWith('/export');
  const fxRate = getUsdToPkrRate();
  const getSmsClientPkr = (s) => {
    if (s && s.client_amount_pkr != null) return Number(s.client_amount_pkr) || 0;
    const usdAmt = parseFloat(s?.client_payout ?? s?.client_amount ?? s?.client_rate ?? 0) || 0;
    return round2(usdAmt * (Number(s?.fx_usd_to_pkr) || fxRate));
  };

  // ── Group By Logic ──
  if (group_by) {
    const rawKeys = Array.isArray(group_by)
      ? group_by
      : String(group_by).split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

    const validKeys = rawKeys
      .map(k => (k === 'service' ? 'cli' : k))
      .filter(k => ['hour', 'date', 'daily', 'day', 'month', 'year', 'provider', 'range', 'agent', 'client', 'number', 'cli'].includes(k));

    if (validKeys.length > 0) {
      const groups = new Map();

      for (const s of list) {
        const keyParts = {};
        const dStr = extractDateStr(s);
        for (const k of validKeys) {
          if (k === 'hour') {
            const ts = (s.timestamp || s.created || '').replace('T', ' ');
            keyParts.hour = ts.length >= 13 ? ts.slice(0, 13) + ':00' : (dStr ? dStr + ' 00:00' : 'Unknown');
          } else if (k === 'date' || k === 'daily' || k === 'day') {
            keyParts.date = dStr || 'Unknown';
          } else if (k === 'month') {
            keyParts.month = dStr ? dStr.slice(0, 7) : 'Unknown';
          } else if (k === 'year') {
            keyParts.year = dStr ? dStr.slice(0, 4) : 'Unknown';
          } else if (k === 'provider') {
            keyParts.provider = maskProviderLabel(s.provider || '', isOwner);
          } else if (k === 'range') {
            keyParts.range = s.range_name || s.range_label || s.range || '';
          } else if (k === 'client') {
            if (isOwner) {
              keyParts.client = '';
            } else {
              const cid = s.client_id != null && s.client_id !== '' ? Number(s.client_id) : null;
              const baseName = s.client || s.client_username || '';
              if (s.client_is_deleted && baseName) {
                keyParts.client = `${baseName} (Deleted${cid != null ? ` #${cid}` : ''})`;
              } else if (baseName && cid != null) {
                keyParts.client = `${baseName} (#${cid})`;
              } else {
                keyParts.client = baseName;
              }
              keyParts._client_unique_key = cid != null ? `id:${cid}` : `name:${baseName.toLowerCase()}`;
              keyParts.client_id = cid;
              keyParts.client_is_deleted = Boolean(s.client_is_deleted);
            }
          } else if (k === 'agent') {
            keyParts.agent = s.agent || '';
          } else if (k === 'number') {
            keyParts.number = s.number || '';
          } else if (k === 'cli') {
            keyParts.cli = s.cli || s.service || '';
          }
        }

        const mapKey = validKeys.map(k => (k === 'client' && keyParts._client_unique_key) ? `client:${keyParts._client_unique_key}` : `${k}:${keyParts[k]}`).join('|');
        let grp = groups.get(mapKey);
        if (!grp) {
          const cleanParts = { ...keyParts };
          delete cleanParts._client_unique_key;
          grp = {
            ...cleanParts,
            sms_count: 0,
            delivered_count: 0,
            failed_count: 0,
            currency: isClient ? 'PKR' : (s.currency || 'USD'),
            payout: 0,
            payout_pkr: 0,
            agent_payout: 0,
            client_payout: 0,
            client_payout_pkr: 0,
            profit: 0,
            key: validKeys.map(k => keyParts[k]).join(' / ')
          };
          groups.set(mapKey, grp);
        }

        const rowSmsWeight = (s.sms_count != null && Number(s.sms_count) > 0) ? Math.round(Number(s.sms_count)) : 1;
        grp.sms_count += rowSmsWeight;
        if (s.status === 'delivered' || s.status === 'success') {
          grp.delivered_count += rowSmsWeight;
        } else if (s.status === 'failed') {
          grp.failed_count += rowSmsWeight;
        }

        const agp = parseFloat(s.agent_payout ?? s.agent_rate ?? 0) || 0;
        const cp = parseFloat(s.client_payout ?? s.client_amount ?? 0) || 0;
        const cpPkr = getSmsClientPkr(s);
        let rolePayout = 0;
        let prof = 0;
        if (isAgent) {
          rolePayout = agp;
          prof = parseFloat(s.agent_amount ?? Math.max(0, rolePayout - cp)) || 0;
        } else if (isClient) {
          rolePayout = cp;
          prof = 0;
        } else {
          rolePayout = parseFloat(s.company_rate ?? s.company_payout ?? s.carrier_revenue ?? s.payout ?? 0) || 0;
          prof = parseFloat(s.owner_amount ?? s.profit ?? Math.max(0, rolePayout - agp)) || 0;
        }
        grp.payout = Math.round((grp.payout + rolePayout) * 10000) / 10000;
        grp.agent_payout = Math.round((grp.agent_payout + agp) * 10000) / 10000;
        grp.client_payout = Math.round((grp.client_payout + cp) * 10000) / 10000;
        grp.client_payout_pkr = round2(grp.client_payout_pkr + cpPkr);
        grp.payout_pkr = isClient ? grp.client_payout_pkr : round2(grp.payout * fxRate);
        grp.profit = Math.round((grp.profit + prof) * 10000) / 10000;
      }

      const groupedResult = Array.from(groups.values());
      groupedResult.sort((a, b) => b.sms_count - a.sms_count);

      // Global summary totals across all groups
      let totalSms = 0, totalDelivered = 0, totalFailed = 0, totalPayout = 0, totalAgentPayout = 0, totalClientPayout = 0, totalClientPayoutPkr = 0, totalProfit = 0;
      for (const g of groupedResult) {
        totalSms += g.sms_count || 0;
        totalDelivered += g.delivered_count || 0;
        totalFailed += g.failed_count || 0;
        totalPayout += g.payout || 0;
        totalAgentPayout += g.agent_payout || 0;
        totalClientPayout += g.client_payout || 0;
        totalClientPayoutPkr += g.client_payout_pkr || 0;
        totalProfit += g.profit || 0;
      }
      const summary = {
        total_sms: totalSms,
        total_groups: groupedResult.length,
        delivered_count: totalDelivered,
        failed_count: totalFailed,
        currency: isClient ? 'PKR' : 'USD',
        usd_to_pkr_rate: fxRate,
        payout: Math.round(totalPayout * 10000) / 10000,
        payout_pkr: isClient ? round2(totalClientPayoutPkr) : round2(totalPayout * fxRate),
        agent_payout: Math.round(totalAgentPayout * 10000) / 10000,
        client_payout: Math.round(totalClientPayout * 10000) / 10000,
        client_payout_pkr: round2(totalClientPayoutPkr),
        profit: Math.round(totalProfit * 10000) / 10000
      };

      if (isExport) {
        const filename = `sms_cdr_grouped_${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache');
        const secondPayoutLabel = isOwner ? 'AGENT PAYOUT' : 'CLIENT PAYOUT';
        const headers = [...validKeys.map(k => k.toUpperCase()), 'SMS COUNT', 'DELIVERED', 'FAILED', 'CURRENCY', isClient ? 'MY PAYOUT (PKR)' : 'MY PAYOUT'];
        if (!isClient) headers.push(secondPayoutLabel, 'PROFIT');
        res.write(headers.map(h => `"${h}"`).join(',') + '\r\n');
        for (const g of groupedResult) {
          const row = [
            ...validKeys.map(k => {
              if (k === 'cli' && !isOwner) return serverMaskCli(g[k]);
              if (k === 'agent' || k === 'client') return g[k] || '';
              return g[k] || '—';
            }),
            g.sms_count || 0,
            g.delivered_count || 0,
            g.failed_count || 0,
            isClient ? 'PKR' : (g.currency || 'USD'),
            isClient ? cleanMoneyStr(Number(g.client_payout_pkr || 0), 4) : cleanMoneyStr(Number(g.payout || 0), 4)
          ];
          if (!isClient) {
            row.push(cleanMoneyStr(Number(isOwner ? (g.agent_payout || 0) : (g.client_payout || 0)), 4));
            row.push(cleanMoneyStr(Number(g.profit || 0), 4));
          }
          res.write(row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\r\n');
        }
        const footRow = [
          `Total Groups: ${groupedResult.length}`,
          ...Array(Math.max(0, validKeys.length - 1)).fill(''),
          summary.total_sms,
          summary.delivered_count,
          summary.failed_count,
          summary.currency,
          isClient ? cleanMoneyStr(summary.client_payout_pkr, 4) : cleanMoneyStr(summary.payout, 4)
        ];
        if (!isClient) {
          footRow.push(cleanMoneyStr((isOwner ? summary.agent_payout : summary.client_payout), 4));
          footRow.push(cleanMoneyStr(summary.profit, 4));
        }
        res.write(footRow.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\r\n');
        return res.end();
      }

      const rawLimit = String(req.query.limit || '').trim().toLowerCase();
      const isAll = rawLimit === 'all' || rawLimit === '0' || rawLimit === '-1';
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = isAll ? groupedResult.length : Math.max(1, parseInt(req.query.limit, 10) || 500);
      const start = isAll ? 0 : (page - 1) * limit;
      const totalPages = isAll ? 1 : (limit > 0 ? Math.ceil(groupedResult.length / limit) : 1);
      if (isClient) {
        delete summary.profit;
        delete summary.agent_payout;
      }

      const pageSlice = isAll ? groupedResult : groupedResult.slice(start, start + limit);
      const safeGroupedResult = isOwner ? pageSlice : pageSlice.map(g => {
        const copy = { ...g };
        if (isClient) {
          delete copy.profit;
          delete copy.agent_payout;
        }
        if (copy.cli) copy.cli = serverMaskCli(copy.cli);
        return copy;
      });

      return res.json({
        data: safeGroupedResult,
        total: groupedResult.length,
        page,
        limit: isAll ? groupedResult.length : limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
        grouped: true,
        group_keys: validKeys,
        summary
      });
    }
  }

  // ── Ungrouped Summary Totals across full matched list (Multi-Currency Breakdown) ──
  let totalSms = 0, totalDelivered = 0, totalFailed = 0, totalPayout = 0, totalAgentPayout = 0, totalClientPayout = 0, totalClientPayoutPkr = 0, totalProfit = 0;
  const currencies = {
    USD: { in: 0, out: 0, profit: 0, count: 0 },
    EUR: { in: 0, out: 0, profit: 0, count: 0 },
    GBP: { in: 0, out: 0, profit: 0, count: 0 }
  };

  for (const s of list) {
    const rowSmsWeight = (s.sms_count != null && Number(s.sms_count) > 0) ? Math.round(Number(s.sms_count)) : 1;
    totalSms += rowSmsWeight;
    if (s.status === 'delivered' || s.status === 'success') totalDelivered += rowSmsWeight;
    else if (s.status === 'failed') totalFailed += rowSmsWeight;
    const agp = parseFloat(s.agent_payout ?? s.agent_rate ?? 0) || 0;
    const cp = parseFloat(s.client_payout ?? s.client_amount ?? 0) || 0;
    const cpPkr = getSmsClientPkr(s);
    let rolePayout = 0;
    let pr = 0;
    if (isAgent) {
      rolePayout = agp;
      pr = parseFloat(s.agent_amount ?? Math.max(0, rolePayout - cp)) || 0;
    } else if (isClient) {
      rolePayout = cp;
      pr = 0;
    } else {
      rolePayout = parseFloat(s.company_rate ?? s.company_payout ?? s.carrier_revenue ?? s.payout ?? 0) || 0;
      pr = parseFloat(s.owner_amount ?? s.profit ?? Math.max(0, rolePayout - agp)) || 0;
    }
    totalPayout += rolePayout;
    totalAgentPayout += agp;
    totalClientPayout += cp;
    totalClientPayoutPkr += cpPkr;
    totalProfit += pr;

    const cur = String(s.currency || 'USD').toUpperCase();
    if (!currencies[cur]) {
      currencies[cur] = { in: 0, out: 0, profit: 0, count: 0 };
    }
    currencies[cur].in += rolePayout;
    currencies[cur].out += isOwner ? agp : cp;
    currencies[cur].profit += pr;
    currencies[cur].count += rowSmsWeight;
  }

  // Format multi-currency stats for easy frontend consumption
  const multi_currency = {};
  for (const [k, v] of Object.entries(currencies)) {
    multi_currency[k] = {
      in: Math.round(v.in * 10000) / 10000,
      out: Math.round(v.out * 10000) / 10000,
      profit: Math.round(v.profit * 10000) / 10000,
      count: v.count
    };
  }

  const summary = {
    total_sms: totalSms,
    total_groups: 0,
    delivered_count: totalDelivered,
    failed_count: totalFailed,
    currency: isClient ? 'PKR' : 'USD',
    usd_to_pkr_rate: fxRate,
    payout: Math.round(totalPayout * 10000) / 10000,
    payout_pkr: isClient ? round2(totalClientPayoutPkr) : round2(totalPayout * fxRate),
    agent_payout: Math.round(totalAgentPayout * 10000) / 10000,
    client_payout: Math.round(totalClientPayout * 10000) / 10000,
    client_payout_pkr: round2(totalClientPayoutPkr),
    profit: Math.round(totalProfit * 10000) / 10000,
    multi_currency
  };

  if (isExport) {
    const wnTags = getWhitenoiseProviderTags();
    const baseName = whitenoiseOnly ? (isOwner ? 'cdr2_whitenoise' : 'cdr2_monthly') : 'sms_cdr';
    const filename = `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    const useExcelCsv = whitenoiseOnly && list.some(s => s.record_type === 'excel_stat');
    const headers = useExcelCsv
      ? (isOwner
        ? ['Date', 'Range', 'Number', 'Service / CLI', 'SMS Count', 'Agent', 'Rate (USD)', 'Owner Revenue (USD)', 'Agent Payout (USD)', 'Owner Profit (USD)', 'Status']
        : isAgent
        ? ['Date', 'Range', 'Number', 'Service / CLI', 'SMS Count', 'Client', 'Rate (USD)', 'My Payout (USD)', 'Client Payout (USD)', 'My Profit (USD)']
        : ['Date', 'Range', 'Number', 'Service / CLI', 'SMS Count', 'Rate (PKR)', 'My Earnings (PKR)', 'Payterm'])
      : (isOwner
        ? ['Date Time', 'Provider', 'Range', 'Number', 'CLI', 'SMS', 'Agent', 'Currency', 'My Payout', 'Agent Payout', 'Profit', 'Cause']
        : isAgent
        ? ['Date Time', 'Provider', 'Range', 'Number', 'CLI', 'SMS', 'Client', 'Currency', 'My Payout', 'Client Payout', 'My Profit']
        : ['Date Time', 'Provider', 'Range', 'Number', 'CLI', 'SMS', 'Currency', 'My Payout (PKR)', 'Cause']);
    res.write(headers.map(h => `"${h}"`).join(',') + '\r\n');
    for (const s of list) {
      const safeMsg = String(s.message || '');
      const sanitizedMsg = /^[=\+\-@\t\r]/.test(safeMsg) ? "'" + safeMsg : safeMsg;
      const dtStr = useExcelCsv ? (s.date_ymd || extractDateStr(s) || '') : (s.timestamp || '').replace('T', ' ').slice(0, 19);
      const provStr = maskProviderLabel(s.provider || '—', isOwner, wnTags) || '—';
      const rngStr = scrubWhitenoiseName(s.range_name || s.range_label || s.range || s.country || '—', isOwner);
      const cliStr = isOwner ? (s.cli || s.service || '') : serverMaskCli(s.cli || s.service || '');
      const smsCnt = (s.sms_count != null && Number(s.sms_count) > 0) ? Math.round(Number(s.sms_count)) : 1;
      const agpVal = Number(s.agent_payout ?? s.agent_rate ?? 0);
      const cpVal = Number(s.client_payout ?? s.client_amount ?? 0);
      const cpPkrVal = getSmsClientPkr(s);
      const curStr = isClient ? 'PKR' : (s.currency || 'USD');
      const causeStr = s.cause || (s.status === 'delivered' || s.status === 'success' ? 'Success' : (s.status || '—'));
      const clientColVal = s.client_display || s.client || '';
      let row;
      if (useExcelCsv) {
        if (isOwner) {
          const myP = Number(s.company_rate ?? s.owner_revenue_usd ?? 0);
          const prof = Number(s.owner_amount ?? s.profit ?? Math.max(0, myP - agpVal));
          row = [dtStr, rngStr, s.number || '', cliStr, smsCnt, s.agent || '', cleanMoneyStr(Number(s.unit_owner_rate_usd || 0), 4), cleanMoneyStr(myP, 4), cleanMoneyStr(agpVal, 4), cleanMoneyStr(prof, 4), causeStr];
        } else if (isAgent) {
          const prof = Number(s.agent_amount ?? Math.max(0, agpVal - cpVal));
          row = [dtStr, rngStr, s.number || '', cliStr, smsCnt, clientColVal, cleanMoneyStr(Number(s.unit_agent_rate_usd || 0), 4), cleanMoneyStr(agpVal, 4), cleanMoneyStr(cpVal, 4), cleanMoneyStr(prof, 4)];
        } else {
          row = [dtStr, rngStr, s.number || '', cliStr, smsCnt, cleanMoneyStr(Number(s.unit_client_rate_pkr || 0), 2), cleanMoneyStr(cpPkrVal, 2), 'Monthly (30/5) {W}'];
        }
      } else if (isOwner) {
        const myP = Number(s.company_rate ?? s.company_payout ?? s.carrier_revenue ?? 0);
        const prof = Number(s.owner_amount ?? s.profit ?? Math.max(0, myP - agpVal));
        row = [dtStr, provStr, rngStr, s.number || '', cliStr, sanitizedMsg, s.agent || '', curStr, cleanMoneyStr(myP, 4), cleanMoneyStr(agpVal, 4), cleanMoneyStr(prof, 4), causeStr];
      } else if (isAgent) {
        const prof = Number(s.agent_amount ?? Math.max(0, agpVal - cpVal));
        row = [dtStr, provStr, rngStr, s.number || '', cliStr, sanitizedMsg, clientColVal, curStr, cleanMoneyStr(agpVal, 4), cleanMoneyStr(cpVal, 4), cleanMoneyStr(prof, 4)];
      } else {
        row = [dtStr, provStr, rngStr, s.number || '', cliStr, sanitizedMsg, 'PKR', cleanMoneyStr(cpPkrVal, 4), causeStr];
      }
      res.write(row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\r\n');
    }
    const footRow = useExcelCsv
      ? (isOwner
        ? [`Total Rows: ${list.length}`, '', '', '', summary.total_sms, '', '', cleanMoneyStr(summary.payout, 4), cleanMoneyStr(summary.agent_payout, 4), cleanMoneyStr(summary.profit, 4), '']
        : isAgent
        ? [`Total Rows: ${list.length}`, '', '', '', summary.total_sms, '', '', cleanMoneyStr(summary.payout, 4), cleanMoneyStr(summary.client_payout, 4), cleanMoneyStr(summary.profit, 4)]
        : [`Total Rows: ${list.length}`, '', '', '', summary.total_sms, '', cleanMoneyStr(summary.client_payout_pkr, 2), 'Monthly (30/5) {W}'])
      : (isOwner
        ? [`Total SMS: ${summary.total_sms}`, '', '', '', '', '', '', summary.currency, cleanMoneyStr(summary.payout, 4), cleanMoneyStr(summary.agent_payout, 4), cleanMoneyStr(summary.profit, 4), `Delivered: ${summary.delivered_count}`]
        : isAgent
        ? [`Total SMS: ${summary.total_sms}`, '', '', '', '', '', '', summary.currency, cleanMoneyStr(summary.payout, 4), cleanMoneyStr(summary.client_payout, 4), cleanMoneyStr(summary.profit, 4)]
        : [`Total SMS: ${summary.total_sms}`, '', '', '', '', '', 'PKR', cleanMoneyStr(summary.client_payout_pkr, 4), `Delivered: ${summary.delivered_count}`]);
    res.write(footRow.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\r\n');
    return res.end();
  }

  // ── Ungrouped Standard / Server-side Pagination ──
  const rawLimit = String(req.query.limit || '').trim().toLowerCase();
  const isAll = rawLimit === 'all' || rawLimit === '0' || rawLimit === '-1';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = isAll ? list.length : Math.max(1, parseInt(req.query.limit, 10) || 100);
  const start = isAll ? 0 : (page - 1) * limit;
  const totalPages = isAll ? 1 : (limit > 0 ? Math.ceil(list.length / limit) : 1);
  const sliced = isAll ? list : list.slice(start, start + limit);

  const wnTags = getWhitenoiseProviderTags();
  const sanitizedSliced = sliced.map(s => {
    const item = { ...s };
    delete item.ip;

    if (!isOwner) {
      item.cli = serverMaskCli(item.cli || item.app || item.sender);
      if (item.service) item.service = serverMaskCli(item.service);
      item.provider = maskProviderLabel(item.provider || '', false, wnTags);
      if (item.company) item.company = maskProviderLabel(item.company, false, wnTags);
      if (item.source && isWhitenoiseText(item.source)) item.source = 'monthly_route';
      if (item.range_name) item.range_name = scrubWhitenoiseName(item.range_name, false);
      if (item.range_label) item.range_label = scrubWhitenoiseName(item.range_label, false);
      if (item.range) item.range = scrubWhitenoiseName(item.range, false);
      if (item.panel_name && (isWhitenoiseText(item.panel_name) || wnTags.has(String(item.panel_name).trim().toLowerCase()))) {
        item.panel_name = 'Carrier 2';
      }
      delete item.company_rate;
      delete item.company_cost;
      delete item.owner_amount;
      delete item.owner_revenue_usd;
      delete item.owner_profit_usd;
      delete item.unit_owner_rate_usd;
      delete item.profit;
      delete item.admin_profit;
      delete item.gross_margin;
      if (isClient) {
        delete item.agent_amount;
        delete item.agent_rate;
        delete item.agent_payout;
        delete item.agent_payout_usd;
        delete item.agent_profit_usd;
        delete item.unit_agent_rate_usd;
        item.my_payout = Number(item.client_amount != null ? item.client_amount : (item.client_payout || 0));
        item.payout = item.my_payout;
        item.client_amount_pkr = getSmsClientPkr(item);
        item.my_payout_pkr = item.client_amount_pkr;
        item.client_currency = 'PKR';
      } else if (isAgent) {
        item.my_payout = Number(item.agent_payout != null ? item.agent_payout : (item.agent_rate || 0));
        item.payout = item.my_payout;
      }
    } else {
      item.my_payout = Number(item.company_rate != null ? item.company_rate : (item.company_payout != null ? item.company_payout : (item.carrier_revenue || 0)));
      // Owner visibility stops at Agent tier — never expose private Client usernames to Owner
      item.client = '';
      item.client_username = '';
      item.client_name = '';
      item.client_display = '';
      item.user = '';
    }
    if (whitenoiseOnly) {
      item.payterm = 'Monthly';
      item.payout_schedule = 'monthly30_5';
      item.cycle_days = 30;
      item.hold_days = 5;
      item.sms_count = (item.sms_count != null && Number(item.sms_count) > 0) ? Math.round(Number(item.sms_count)) : 1;
      if (isOwner) {
        item.is_whitenoise = true;
        item.conversion_sent = Boolean(item.conversion_sent);
        item.whitenoise_sms_id = item.whitenoise_sms_id ?? null;
      } else {
        delete item.is_whitenoise;
        delete item.whitenoise_sms_id;
        delete item.conversion_sent;
        delete item.batch_id;
      }
    }
    return item;
  });

  const safeSummary = { ...summary };
  if (isClient) {
    delete safeSummary.profit;
    delete safeSummary.agent_payout;
  }

  res.json({
    data: sanitizedSliced,
    total: list.length,
    page,
    limit: isAll ? list.length : limit,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1,
    grouped: false,
    ...(isOwner ? { whitenoise_only: whitenoiseOnly } : { monthly_only: whitenoiseOnly }),
    summary: safeSummary
  });
}

app.get('/api/sms/logs', (req, res) => handleSmsLogsQuery(req, res));
app.get('/api/sms/export', (req, res) => handleSmsLogsQuery(req, res));

// ── CDR 2 (Monthly Route Dedicated Logs, Export, Batch Sync & Single Fetch) ──
app.get('/api/cdr2/logs', requireAuth, (req, res) => {
  if (!hasWhitenoiseAccess(req.sessionUser)) {
    return res.status(403).json({ error: 'Forbidden. CDR 2 access is not enabled for your account.' });
  }
  return handleSmsLogsQuery(req, res, { whitenoiseOnly: true });
});

app.get('/api/cdr2/export', requireAuth, (req, res) => {
  if (!hasWhitenoiseAccess(req.sessionUser)) {
    return res.status(403).json({ error: 'Forbidden. CDR 2 access is not enabled for your account.' });
  }
  return handleSmsLogsQuery(req, res, { whitenoiseOnly: true });
});

const CDR2_TERMS_VERSION = '1.0';
const PKT_OFFSET_MS_SHARED = 5 * 60 * 60 * 1000;

function getPktDateYmd(offsetDays = 0, nowDate = new Date()) {
  const pkt = new Date(nowDate.getTime() + PKT_OFFSET_MS_SHARED + offsetDays * 86400000);
  const y = pkt.getUTCFullYear();
  const m = String(pkt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(pkt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCdr2UploadStatus(nowDate = new Date()) {
  const todayPkt = getPktDateYmd(0, nowDate);
  const yesterdayPkt = getPktDateYmd(-1, nowDate);
  const stats = readDb('whitenoise_daily_stats') || [];
  let latestDate = '';
  let yesterdayUploaded = false;
  let yesterdaySmsTotal = 0;
  for (const row of stats) {
    if (!row || row.rolled_back) continue;
    const dt = String(row.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) continue;
    if (!latestDate || dt > latestDate) latestDate = dt;
    if (dt === yesterdayPkt) {
      yesterdayUploaded = true;
      yesterdaySmsTotal += Number(row.sms_count || 0);
    }
  }
  const pktNow = new Date(nowDate.getTime() + PKT_OFFSET_MS_SHARED);
  const nextNoonPktMs = Date.UTC(
    pktNow.getUTCFullYear(),
    pktNow.getUTCMonth(),
    pktNow.getUTCDate(),
    12, 0, 0
  ) - PKT_OFFSET_MS_SHARED;
  const secondsUntilNoon = Math.max(0, Math.floor((nextNoonPktMs - nowDate.getTime()) / 1000));
  return {
    today_pkt: todayPkt,
    yesterday_pkt: yesterdayPkt,
    yesterday_uploaded: yesterdayUploaded,
    yesterday_sms_total: yesterdaySmsTotal,
    latest_uploaded_date: latestDate || null,
    upload_time_label: '12:00 PM PKT',
    upload_hour_pkt: 12,
    next_upload_iso: new Date(nextNoonPktMs).toISOString(),
    seconds_until_noon: secondsUntilNoon,
    is_past_noon_pkt: pktNow.getUTCHours() >= 12
  };
}

// GET /api/cdr2/status — Daily 12:00 PM PKT report upload status + user's first-time terms state (privacy-safe)
app.get('/api/cdr2/status', requireAuth, (req, res) => {
  if (!hasWhitenoiseAccess(req.sessionUser)) {
    return res.status(403).json({ error: 'Forbidden. CDR 2 access is not enabled for your account.' });
  }
  const found = findUserAnywhere(req.sessionUser.username);
  const dbUser = (found && found.user) || {};
  const isOwner = normRole(req.sessionUser.role) === 'owner';
  const uploadStatus = getCdr2UploadStatus();
  res.json({
    success: true,
    ...uploadStatus,
    terms_version: CDR2_TERMS_VERSION,
    terms_accepted: isOwner ? true : Boolean(dbUser.cdr2_terms_accepted_at),
    terms_accepted_at: dbUser.cdr2_terms_accepted_at || null
  });
});

// POST /api/cdr2/accept-terms — Persist first-time Monthly Route Terms & Conditions acceptance for current user
app.post('/api/cdr2/accept-terms', requireAuth, (req, res) => {
  if (!hasWhitenoiseAccess(req.sessionUser)) {
    return res.status(403).json({ error: 'Forbidden. CDR 2 access is not enabled for your account.' });
  }
  const accepted = Boolean(req.body && req.body.accepted);
  if (!accepted) {
    return res.status(400).json({ error: 'Please confirm that you accept the Monthly Route Terms & Conditions.' });
  }
  const found = findUserAnywhere(req.sessionUser.username);
  if (!found || !found.user || !found.table) {
    return res.status(404).json({ error: 'Account record not found.' });
  }
  const nowIso = new Date().toISOString();
  updateUserRecord(found.table, found.user.id, {
    cdr2_terms_accepted_at: nowIso,
    cdr2_terms_version: CDR2_TERMS_VERSION
  });
  logAudit(req.sessionUser.username, 'CDR 2 Terms Accepted', `Accepted Monthly Route Terms v${CDR2_TERMS_VERSION}`, 'CDR2');
  res.json({
    success: true,
    terms_accepted: true,
    terms_accepted_at: nowIso,
    terms_version: CDR2_TERMS_VERSION
  });
});

// ── Owner-Only Original Whitenoise Portal Quick Credentials ────────────────
function sanitizePortalHttpUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

app.get('/api/owner/whitenoise-portal', requireAuth, (req, res) => {
  if (normRole(req.sessionUser?.role) !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const settings = readDb('settings') || {};
  const portal = (settings && typeof settings.whitenoise_portal_access === 'object' && settings.whitenoise_portal_access)
    ? settings.whitenoise_portal_access
    : {};
  res.json({
    success: true,
    portal: {
      url: String(portal.url || ''),
      username: String(portal.username || ''),
      password: String(portal.password || ''),
      notes: String(portal.notes || ''),
      updated_at: portal.updated_at || null
    }
  });
});

app.put('/api/owner/whitenoise-portal', requireAuth, (req, res) => {
  if (normRole(req.sessionUser?.role) !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const body = req.body || {};
  const rawUrl = String(body.url || '').trim();
  const safeUrl = sanitizePortalHttpUrl(rawUrl);
  if (rawUrl && safeUrl === null) {
    return res.status(400).json({ error: 'Please enter a valid portal URL starting with https:// or http://.' });
  }
  const username = String(body.username || '').trim().slice(0, 160);
  const password = String(body.password || '').slice(0, 200);
  const notes = String(body.notes || '').trim().slice(0, 240);

  const settings = readDb('settings') || {};
  const portalObj = {
    url: safeUrl || '',
    username,
    password,
    notes,
    updated_at: new Date().toISOString()
  };
  settings.whitenoise_portal_access = portalObj;
  writeDb('settings', settings);
  logAudit(req.sessionUser.username, 'Whitenoise Portal Credentials Updated', `Portal URL ${portalObj.url ? 'configured' : 'cleared'}`, 'CDR2');
  res.json({ success: true, portal: portalObj });
});

// ── Live Access (API-Only OTP Feed with Server-Side Masked OTPs + Role Access Control) ──
app.get('/api/live-access', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = normRole(sessionUser && sessionUser.role);
  const cfg = readDb('settings') || {};
  const agentsEnabled = Boolean(cfg.live_access_agents_enabled);
  const clientsEnabled = Boolean(cfg.live_access_clients_enabled);

  if (sRole === 'agent' && !agentsEnabled) {
    return res.status(403).json({ error: 'Live Access is currently disabled for Agents by the Owner.' });
  }
  if (sRole === 'client' && !clientsEnabled) {
    return res.status(403).json({ error: 'Live Access is currently disabled for Clients by the Owner.' });
  }
  if (sRole !== 'owner' && sRole !== 'agent' && sRole !== 'client') {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const smsAll = readDb('sms_log') || [];
  const wnRangesMap = buildRangesLookupMap();
  const wnTags = getWhitenoiseProviderTags();
  const enrichSms = buildSmsEnricher();
  const qSearch = String(req.query.search || '').trim().toLowerCase();
  const qRange = String(req.query.range || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  const needCount = offset + limit + 1;

  const matched = [];
  const sorted = [...smsAll].sort((a, b) => String(b?.timestamp || '').localeCompare(String(a?.timestamp || '')));
  for (const raw of sorted) {
    if (!raw || raw.record_type === 'excel_stat') continue;
    if (isWhitenoiseRecord(raw, wnRangesMap, wnTags)) continue;
    const item = enrichSms(raw);
    const rangeName = String(item.range_name || item.range_label || item.range || item.country || 'International').trim();
    const cliName = String(item.cli || item.app || item.sender || 'SMS').trim();
    const maskedSms = maskOtpInSmsBody(item.message || '', item.otp || '');
    if (qRange && !rangeName.toLowerCase().includes(qRange)) continue;
    if (qSearch) {
      const hay = `${rangeName} ${cliName} ${maskedSms}`.toLowerCase();
      if (!hay.includes(qSearch)) continue;
    }
    matched.push({
      id: item.id,
      range: rangeName,
      cli: cliName,
      sms: maskedSms,
      timestamp: item.timestamp || item.created || ''
    });
    if (matched.length >= needCount) break;
  }

  const hasNext = matched.length > offset + limit;
  const pageData = matched.slice(offset, offset + limit);

  res.json({
    success: true,
    data: pageData,
    page,
    limit,
    has_next: hasNext,
    has_prev: page > 1,
    ...(sRole === 'owner' ? {
      live_access_agents_enabled: agentsEnabled,
      live_access_clients_enabled: clientsEnabled
    } : {})
  });
});

// ── Per-Range Inactivity Auto-Scanner & Blocked Numbers System ───────────────
function scanInactiveNumbers() {
  try {
    const ranges = readDb('sms_ranges') || [];
    const numbers = readDb('numbers') || [];
    if (!Array.isArray(ranges) || !Array.isArray(numbers) || !numbers.length) {
      return { scanned: 0, newly_flagged: 0, total_flagged: 0 };
    }

    const activeRules = new Map();
    const activeRulesByName = new Map();
    for (const r of ranges) {
      if (!r) continue;
      const days = Math.max(0, parseInt(r.inactivity_days, 10) || 0);
      if (days > 0) {
        activeRules.set(Number(r.id), { id: Number(r.id), days, name: String(r.range_name || r.name || '').trim() });
        const rn = String(r.range_name || r.name || '').trim().toLowerCase();
        if (rn) activeRulesByName.set(rn, { id: Number(r.id), days, name: String(r.range_name || r.name || '').trim() });
      }
    }

    if (activeRules.size === 0) {
      let cleared = false;
      for (const n of numbers) {
        if (n && n.inactivity_flagged && String(n.status || '').toLowerCase() !== 'blocked') {
          n.inactivity_flagged = false;
          n.inactivity_flagged_at = null;
          cleared = true;
        }
      }
      if (cleared) writeDb('numbers', numbers);
      const totalBlocked = numbers.filter(n => n && String(n.status || '').toLowerCase() === 'blocked').length;
      return { scanned: numbers.length, newly_flagged: 0, total_flagged: totalBlocked };
    }

    // Build latest SMS timestamp map across sms_log and whitenoise_daily_stats
    const smsLog = readDb('sms_log') || [];
    const lastSmsMsByDigits = new Map();
    for (const s of smsLog) {
      if (!s || !s.number) continue;
      const dg = String(s.number).replace(/\D/g, '');
      if (!dg) continue;
      const t = Date.parse(s.timestamp || s.created || s.date || '');
      if (!Number.isFinite(t)) continue;
      const prev = lastSmsMsByDigits.get(dg) || 0;
      if (t > prev) lastSmsMsByDigits.set(dg, t);
    }
    const wnStats = readDb('whitenoise_daily_stats') || [];
    for (const st of wnStats) {
      if (!st || !st.number || !(Number(st.sms_count || 0) > 0)) continue;
      const dg = String(st.number).replace(/\D/g, '');
      if (!dg) continue;
      const t = Date.parse((st.stat_date || '') + 'T23:59:59Z');
      if (!Number.isFinite(t)) continue;
      const prev = lastSmsMsByDigits.get(dg) || 0;
      if (t > prev) lastSmsMsByDigits.set(dg, t);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let changed = false;
    let newlyFlagged = 0;
    let totalFlagged = 0;

    for (const n of numbers) {
      if (!n) continue;
      const rule = (n.range_id != null && activeRules.get(Number(n.range_id)))
        || activeRulesByName.get(String(n.range_name || n.range_label || '').trim().toLowerCase())
        || null;

      if (!rule) {
        if (n.inactivity_flagged && String(n.status || '').toLowerCase() !== 'blocked') {
          n.inactivity_flagged = false;
          n.inactivity_flagged_at = null;
          changed = true;
        }
        if (String(n.status || '').toLowerCase() === 'blocked') totalFlagged++;
        continue;
      }

      const dg = String(n.number || '').replace(/\D/g, '');
      const logLastMs = dg ? (lastSmsMsByDigits.get(dg) || 0) : 0;
      const storedLastMs = Date.parse(n.last_sms_at || '') || 0;
      const resetMs = Date.parse(n.last_activity_reset_at || '') || 0;
      const lastSmsMs = Math.max(logLastMs, storedLastMs);
      if (logLastMs > storedLastMs) {
        n.last_sms_at = new Date(logLastMs).toISOString();
        changed = true;
      }

      const baselineMs = Math.max(
        lastSmsMs,
        resetMs,
        Date.parse(n.client_assigned_at || n.assigned_at || n.assigned_date || n.created_at || n.created || '') || 0
      );

      const limitMs = rule.days * 86400000;
      const elapsedMs = baselineMs > 0 ? (nowMs - baselineMs) : limitMs;
      const isInactive = elapsedMs >= limitMs;

      if (isInactive) {
        const elapsedDays = Math.max(rule.days, Math.floor(elapsedMs / 86400000));
        if (!n.inactivity_flagged || String(n.status || '').toLowerCase() !== 'blocked') {
          if (!n.inactivity_flagged) newlyFlagged++;
          n.inactivity_flagged = true;
          n.inactivity_flagged_at = n.inactivity_flagged_at || nowIso;
          n.inactivity_days_limit = rule.days;
          n.inactive_days_elapsed = elapsedDays;
          n.status = 'blocked';
          n.blocked_at = n.blocked_at || nowIso;
          n.blocked_reason = `Inactive for ${elapsedDays}d (limit: ${rule.days}d)`;
          changed = true;
        } else if (n.inactive_days_elapsed !== elapsedDays || n.inactivity_days_limit !== rule.days) {
          n.inactivity_days_limit = rule.days;
          n.inactive_days_elapsed = elapsedDays;
          changed = true;
        }
        totalFlagged++;
      } else {
        // Active number (received SMS or newly assigned within limit) stays untouched
        if (n.inactivity_flagged && String(n.status || '').toLowerCase() !== 'blocked') {
          n.inactivity_flagged = false;
          n.inactivity_flagged_at = null;
          n.inactive_days_elapsed = 0;
          changed = true;
        }
        if (String(n.status || '').toLowerCase() === 'blocked') totalFlagged++;
      }
    }

    if (changed) {
      writeDb('numbers', numbers);
    }
    return { scanned: numbers.length, newly_flagged: newlyFlagged, total_flagged: totalFlagged };
  } catch (err) {
    console.error('scanInactiveNumbers error:', err);
    return { scanned: 0, newly_flagged: 0, total_flagged: 0, error: err.message };
  }
}

app.get('/api/numbers/blocked', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = normRole(sessionUser && sessionUser.role);
  const isOwner = sRole === 'owner';
  const isAgent = sRole === 'agent';
  if (!isOwner && !isAgent) {
    return res.status(403).json({ error: 'Forbidden. Owner or Agent permissions required.' });
  }

  const scanStats = scanInactiveNumbers();
  const allNumbers = readDb('numbers') || [];
  const allAgents = readDb('agents') || [];
  const allClients = readDb('clients') || [];
  const allRanges = readDb('sms_ranges') || [];
  const agById = new Map(allAgents.map(a => [Number(a.id), a.username || a.name || `Agent #${a.id}`]));
  const clById = new Map(allClients.map(c => [Number(c.id), { username: c.username || c.name || `Client #${c.id}`, agent_id: Number(c.agent_id) }]));
  const rngById = new Map(allRanges.map(r => [Number(r.id), r]));

  const qRange = String(req.query.range || '').trim().toLowerCase();
  const qSearch = String(req.query.search || '').trim().toLowerCase();

  let list = allNumbers.filter(n => n && (String(n.status || '').toLowerCase() === 'blocked' || n.inactivity_flagged === true));
  if (isAgent) {
    list = list.filter(n => Number(n.agent_id) === Number(sessionUser.id));
  }

  const mapped = list.map(n => {
    const rng = n.range_id != null ? rngById.get(Number(n.range_id)) : null;
    const rangeName = n.range_name || (rng && (rng.range_name || rng.name)) || n.country || 'Unassigned';
    const clInfo = n.client_id != null ? clById.get(Number(n.client_id)) : null;
    const effAgId = n.agent_id != null ? Number(n.agent_id) : (clInfo ? clInfo.agent_id : null);
    const agName = effAgId ? (agById.get(effAgId) || n.agent_username || `Agent #${effAgId}`) : 'Unassigned';
    const base = {
      id: n.id,
      number: n.number,
      prefix: n.prefix || (rng && rng.prefix) || '',
      country: n.country || (rng && rng.country) || '',
      range_id: n.range_id || (rng && rng.id) || null,
      range_name: rangeName,
      status: n.status || 'blocked',
      inactivity_flagged: Boolean(n.inactivity_flagged),
      inactivity_days_limit: Number(n.inactivity_days_limit || (rng && rng.inactivity_days) || 0),
      inactive_days_elapsed: Number(n.inactive_days_elapsed || 0),
      blocked_at: n.blocked_at || n.inactivity_flagged_at || n.updated_at || '',
      blocked_reason: n.blocked_reason || (n.inactivity_flagged ? `Inactive (${n.inactivity_days_limit || 0}d limit)` : 'Blocked'),
      last_sms_at: n.last_sms_at || null,
      assigned_at: n.assigned_at || n.created_at || n.created || '',
      agent_id: effAgId,
      agent_username: agName
    };
    if (!isOwner) {
      base.client_id = n.client_id || null;
      base.client_username = clInfo ? clInfo.username : (n.client_username || '');
    }
    return base;
  }).filter(item => {
    if (qRange && !String(item.range_name || '').toLowerCase().includes(qRange) && String(item.range_id || '') !== qRange) return false;
    if (qSearch) {
      const hay = `${item.number} ${item.range_name} ${item.agent_username} ${item.client_username || ''} ${item.blocked_reason}`.toLowerCase();
      if (!hay.includes(qSearch)) return false;
    }
    return true;
  });

  res.json({
    success: true,
    data: mapped,
    total: mapped.length,
    scan: scanStats
  });
});

app.post('/api/numbers/blocked/scan', requireAuth, (req, res) => {
  const sRole = normRole(req.sessionUser && req.sessionUser.role);
  if (sRole !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const result = scanInactiveNumbers();
  logAudit(req.sessionUser.username, 'Inactivity Scan', `Scanned ${result.scanned} numbers; newly flagged: ${result.newly_flagged}, total blocked: ${result.total_flagged}`, 'Numbers');
  res.json({ success: true, ...result });
});

app.post('/api/numbers/blocked/block', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = normRole(sessionUser && sessionUser.role);
  const isOwner = sRole === 'owner';
  const isAgent = sRole === 'agent';
  if (!isOwner && !isAgent) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const ids = Array.isArray(req.body?.number_ids) ? req.body.number_ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one number to block.' });
  const idSet = new Set(ids);
  const reason = String(req.body?.reason || 'Blocked manually').trim();
  const nowIso = new Date().toISOString();

  const numbers = readDb('numbers') || [];
  let updated = 0;
  for (const n of numbers) {
    if (!n || !idSet.has(Number(n.id))) continue;
    if (isAgent && Number(n.agent_id) !== Number(sessionUser.id)) continue;
    n.status = 'blocked';
    n.inactivity_flagged = true;
    n.blocked_at = nowIso;
    n.blocked_reason = reason;
    n.updated_at = nowIso;
    updated++;
  }
  if (updated > 0) writeDb('numbers', numbers);
  logAudit(sessionUser.username, 'Block Numbers', `Blocked ${updated} number(s)`, 'Numbers');
  res.json({ success: true, blocked: updated });
});

app.post('/api/numbers/blocked/unblock', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = normRole(sessionUser && sessionUser.role);
  if (sRole !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Only Owner can unblock numbers.' });
  }
  const ids = Array.isArray(req.body?.number_ids) ? req.body.number_ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one number to unblock.' });
  const idSet = new Set(ids);
  const nowIso = new Date().toISOString();

  const numbers = readDb('numbers') || [];
  let updated = 0;
  for (const n of numbers) {
    if (!n || !idSet.has(Number(n.id))) continue;
    n.status = (n.agent_id || n.client_id) ? 'assigned' : 'active';
    n.inactivity_flagged = false;
    n.inactivity_flagged_at = null;
    n.blocked_at = null;
    n.blocked_reason = '';
    n.inactive_days_elapsed = 0;
    n.last_activity_reset_at = nowIso;
    n.updated_at = nowIso;
    updated++;
  }
  if (updated > 0) writeDb('numbers', numbers);
  logAudit(sessionUser.username, 'Unblock Numbers', `Unblocked ${updated} number(s)`, 'Numbers');
  res.json({ success: true, unblocked: updated });
});

app.post('/api/numbers/blocked/delete', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = normRole(sessionUser && sessionUser.role);
  const isOwner = sRole === 'owner';
  const isAgent = sRole === 'agent';
  if (!isOwner && !isAgent) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const ids = Array.isArray(req.body?.number_ids) ? req.body.number_ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one blocked number to delete.' });
  const idSet = new Set(ids);

  const numbers = readDb('numbers') || [];
  let deleted = 0;
  const remaining = numbers.filter(n => {
    if (!n || !idSet.has(Number(n.id))) return true;
    const isBlockedOrFlagged = String(n.status || '').toLowerCase() === 'blocked' || n.inactivity_flagged === true;
    if (isAgent) {
      if (Number(n.agent_id) !== Number(sessionUser.id) || !isBlockedOrFlagged) return true;
    }
    deleted++;
    return false;
  });

  if (deleted > 0) {
    writeDb('numbers', remaining);
    logAudit(sessionUser.username, 'Delete Blocked Numbers', `Permanently deleted ${deleted} blocked number(s) from system pool`, 'Numbers');
  }
  res.json({ success: true, deleted });
});

app.put('/api/owner/live-access-config', requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  const settings = readDb('settings') || {};
  const b = req.body || {};
  if (b.live_access_agents_enabled !== undefined) {
    settings.live_access_agents_enabled = Boolean(b.live_access_agents_enabled);
  }
  if (b.live_access_clients_enabled !== undefined) {
    settings.live_access_clients_enabled = Boolean(b.live_access_clients_enabled);
  }
  writeDb('settings', settings);
  const payload = {
    live_access_agents_enabled: Boolean(settings.live_access_agents_enabled),
    live_access_clients_enabled: Boolean(settings.live_access_clients_enabled)
  };
  logAudit(req.sessionUser.username, 'Live Access Config Updated', `Agents=${payload.live_access_agents_enabled}, Clients=${payload.live_access_clients_enabled}`, 'LiveAccess');
  broadcastWs({ type: 'live_access_config_updated', ...payload });
  broadcastWs({ type: 'settings_updated', settings: { ...settings, ...payload } });
  res.json({ success: true, ...payload });
});

// ── Whitenoise Excel-Only Daily Stats Endpoints (Owner Only) ────────────────
function pruneWhitenoisePreviewCache() {
  const now = Date.now();
  for (const [tok, item] of WHITENOISE_PREVIEW_CACHE.entries()) {
    if (now - item.createdAt > WHITENOISE_PREVIEW_TTL_MS) {
      WHITENOISE_PREVIEW_CACHE.delete(tok);
    }
  }
  while (WHITENOISE_PREVIEW_CACHE.size > 25) {
    const oldestKey = WHITENOISE_PREVIEW_CACHE.keys().next().value;
    if (oldestKey) WHITENOISE_PREVIEW_CACHE.delete(oldestKey);
    else break;
  }
}

app.post('/api/whitenoise-excel/preview', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (normRole(req.sessionUser?.role) !== 'owner') {
      return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
    }
    pruneWhitenoisePreviewCache();

    let buffer = null;
    let filename = 'stats.xlsx';
    let previewToken = String(req.body?.preview_token || '').trim();

    if (req.file && req.file.buffer) {
      buffer = req.file.buffer;
      filename = req.file.originalname || 'stats.xlsx';
      previewToken = 'wnp_' + crypto.randomBytes(16).toString('hex');
      WHITENOISE_PREVIEW_CACHE.set(previewToken, {
        buffer,
        filename,
        createdAt: Date.now(),
        ownerId: req.sessionUser.id
      });
    } else if (previewToken && WHITENOISE_PREVIEW_CACHE.has(previewToken)) {
      const cached = WHITENOISE_PREVIEW_CACHE.get(previewToken);
      buffer = cached.buffer;
      filename = cached.filename;
      cached.createdAt = Date.now();
    } else {
      return res.status(400).json({ error: 'Please upload an Excel (.xlsx / .xls / .csv) file.' });
    }

    const sheetName = req.body?.sheet_name ? String(req.body.sheet_name) : undefined;
    let colMap = undefined;
    if (req.body?.col_map) {
      colMap = typeof req.body.col_map === 'string' ? JSON.parse(req.body.col_map) : req.body.col_map;
    }

    const evalRes = evaluateWhitenoiseExcelUpload(buffer, filename, { sheetName, colMap });
    const previewLimit = 500;
    const rowsPreview = evalRes.evaluated_rows.slice(0, previewLimit).map(r => {
      const { existing_snapshot, ...clean } = r;
      return clean;
    });

    res.json({
      success: true,
      preview_token: previewToken,
      filename: evalRes.parsed.filename,
      sheets: evalRes.parsed.sheets,
      selected_sheet: evalRes.parsed.selected_sheet,
      layout: evalRes.parsed.layout,
      headers: evalRes.parsed.headers,
      col_map: evalRes.parsed.col_map,
      date_min: evalRes.date_min,
      date_max: evalRes.date_max,
      distinct_dates: evalRes.distinct_dates || [],
      date_range_collapsed_warning: Boolean(evalRes.parsed.date_range_collapsed_warning),
      per_date_summary: evalRes.per_date_summary || [],
      missing_days_filled: evalRes.missing_days_filled || [],
      missing_dates_remaining: evalRes.missing_dates_remaining || [],
      half_month_coverage: evalRes.half_month_coverage || null,
      warnings: evalRes.parsed.warnings,
      summary: evalRes.summary,
      total_preview_rows: evalRes.evaluated_rows.length,
      truncated: evalRes.evaluated_rows.length > previewLimit,
      rows: rowsPreview
    });
  } catch (err) {
    console.error('POST /api/whitenoise-excel/preview error:', err);
    res.status(400).json({ error: err.message || 'Failed to parse Excel workbook.' });
  }
});

app.get('/api/whitenoise-excel/coverage', requireAuth, (req, res) => {
  if (normRole(req.sessionUser?.role) !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const stats = readDb('whitenoise_daily_stats') || [];
  let monthYm = String(req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(monthYm)) {
    const dates = stats.map(s => s && s.date_ymd).filter(Boolean).sort();
    monthYm = (dates[dates.length - 1] || new Date().toISOString().slice(0, 10)).slice(0, 7);
  }
  const monthsAvailable = Array.from(new Set(
    stats.map(s => s && s.date_ymd ? String(s.date_ymd).slice(0, 7) : '').filter(Boolean)
  )).sort().reverse();
  if (!monthsAvailable.includes(monthYm)) monthsAvailable.unshift(monthYm);

  const coverage = buildWhitenoiseMonthCoverage(monthYm, stats);
  res.json({
    success: true,
    month: monthYm,
    months_available: monthsAvailable,
    coverage
  });
});

app.post('/api/whitenoise-excel/commit', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (normRole(req.sessionUser?.role) !== 'owner') {
      return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
    }
    pruneWhitenoisePreviewCache();

    let buffer = null;
    let filename = 'stats.xlsx';
    const previewToken = String(req.body?.preview_token || '').trim();

    if (req.file && req.file.buffer) {
      buffer = req.file.buffer;
      filename = req.file.originalname || 'stats.xlsx';
    } else if (previewToken && WHITENOISE_PREVIEW_CACHE.has(previewToken)) {
      const cached = WHITENOISE_PREVIEW_CACHE.get(previewToken);
      buffer = cached.buffer;
      filename = cached.filename;
    } else {
      return res.status(400).json({ error: 'Preview expired or missing file. Please re-upload your Excel sheet.' });
    }

    const sheetName = req.body?.sheet_name ? String(req.body.sheet_name) : undefined;
    let colMap = undefined;
    if (req.body?.col_map) {
      colMap = typeof req.body.col_map === 'string' ? JSON.parse(req.body.col_map) : req.body.col_map;
    }

    const evalRes = evaluateWhitenoiseExcelUpload(buffer, filename, { sheetName, colMap });
    if (evalRes.evaluated_rows.length === 0) {
      return res.status(400).json({ error: 'No valid stats rows found in the selected sheet/columns.' });
    }

    const batch = commitWhitenoiseExcelEvaluation(evalRes, req.sessionUser.username || 'Owner');
    if (previewToken) WHITENOISE_PREVIEW_CACHE.delete(previewToken);

    res.json({
      success: true,
      batch,
      summary: evalRes.summary,
      per_date_summary: evalRes.per_date_summary || [],
      missing_days_filled: evalRes.missing_days_filled || [],
      half_month_coverage: evalRes.half_month_coverage || null
    });
  } catch (err) {
    console.error('POST /api/whitenoise-excel/commit error:', err);
    res.status(400).json({ error: err.message || 'Failed to commit Excel stats.' });
  }
});

app.get('/api/whitenoise-excel/batches', requireAuth, (req, res) => {
  if (normRole(req.sessionUser?.role) !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  const batches = readDb('whitenoise_upload_batches') || [];
  const list = batches.map(b => {
    const { inserted_keys, previous_snapshots, ...pub } = b;
    return {
      ...pub,
      can_rollback: !b.rolled_back && ((inserted_keys?.length || 0) > 0 || (previous_snapshots?.length || 0) > 0)
    };
  });
  res.json({ success: true, total: list.length, data: list });
});

app.post('/api/whitenoise-excel/batches/:id/rollback', requireAuth, (req, res) => {
  try {
    if (normRole(req.sessionUser?.role) !== 'owner') {
      return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
    }
    const result = rollbackWhitenoiseBatchById(req.params.id, req.sessionUser.username || 'Owner');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Rollback failed.' });
  }
});

app.get('/api/whitenoise-excel/ownership-ledger', requireAuth, (req, res) => {
  if (normRole(req.sessionUser?.role) !== 'owner') {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }
  let ledger = readDb('number_ownership_ledger') || [];
  const numQ = normalizePhoneDigits(req.query.number || '');
  if (numQ) {
    ledger = ledger.filter(e => String(e.number_digits || '').includes(numQ));
  }
  const sorted = ledger.slice().sort((a, b) => {
    if (a.event_date !== b.event_date) return String(b.event_date || '').localeCompare(String(a.event_date || ''));
    return (Number(b.event_seq) || 0) - (Number(a.event_seq) || 0);
  });
  res.json({ success: true, total: sorted.length, data: sorted.slice(0, 500) });
});

app.post('/api/whitenoise-excel/ownership-event', requireAuth, (req, res) => {
  try {
    if (normRole(req.sessionUser?.role) !== 'owner') {
      return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
    }
    const evt = recordExplicitOwnershipEvent({
      ...(req.body || {}),
      actor: req.sessionUser.username || 'Owner'
    });
    res.json({ success: true, event: evt });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to record ownership event.' });
  }
});

app.post('/api/cdr2/sync', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!hasWhitenoiseAccess(sessionUser)) {
      return res.status(403).json({ error: 'Forbidden. CDR 2 access is not enabled for your account.' });
    }

    const sRole = normRole(sessionUser.role);
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    const conns = (readDb('whitenoise_connections') || []).filter(c => c && c.active !== false);
    if (!conns.length) {
      return res.json({
        success: true,
        checked: 0,
        skipped_cooldown: 0,
        total_scoped_numbers: 0,
        new_sms: 0,
        conversions: 0,
        message: isOwner ? 'No active Whitenoise provider connection configured.' : 'No active Monthly Route provider configured.'
      });
    }

    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    const allNumbers = readDb('numbers') || [];
    let scoped = allNumbers.filter(n => n && isWhitenoiseRecord(n, wnRangesMap, wnTags));

    if (isAgent) {
      const myClients = (readDb('clients') || []).filter(c => Number(c.agent_id) === Number(sessionUser.id));
      const myClientIds = new Set(myClients.map(c => Number(c.id)));
      scoped = scoped.filter(n => Number(n.agent_id) === Number(sessionUser.id) || (n.client_id != null && myClientIds.has(Number(n.client_id))));
    } else if (isClient) {
      scoped = scoped.filter(n =>
        Number(n.client_id) === Number(sessionUser.id) ||
        (n.user && String(n.user).toLowerCase() === String(sessionUser.username).toLowerCase())
      );
    }

    const { range, number, search, client_id, agent_id, max_numbers } = req.body || {};
    const rawNumInput = String(number || '').trim() || (String(search || '').replace(/\D/g, '').length >= 6 ? String(search || '').trim() : '');
    const numDigits = rawNumInput.replace(/\D/g, '');
    const isTargetedFetch = numDigits.length >= 6;

    if (isClient && !isTargetedFetch) {
      return res.status(400).json({ error: 'Please enter your assigned phone number (with or without country code or +) to sync.' });
    }

    if (range && !isTargetedFetch) {
      const rLow = String(range).trim().toLowerCase();
      scoped = scoped.filter(n =>
        String(n.range_id) === String(range) ||
        String(n.range_name || n.country || '').toLowerCase().includes(rLow)
      );
    }

    if (rawNumInput) {
      scoped = scoped.filter(n => phoneDigitsVariantsMatch(n.number, rawNumInput) || String(n.number || '').includes(rawNumInput));
      if (!isOwner && scoped.length === 0) {
        return res.status(403).json({ error: 'Forbidden. Number does not belong to your assigned pool.' });
      }
    }
    if (isOwner && agent_id && !isTargetedFetch) {
      scoped = scoped.filter(n => Number(n.agent_id) === Number(agent_id));
    }
    if ((isOwner || isAgent) && client_id && !isTargetedFetch) {
      scoped = scoped.filter(n => Number(n.client_id) === Number(client_id));
    }

    // Prioritize Client-assigned -> Agent pool -> Unassigned
    scoped.sort((a, b) => {
      const pa = a.client_id ? 3 : (a.agent_id ? 2 : 1);
      const pb = b.client_id ? 3 : (b.agent_id ? 2 : 1);
      return pb - pa;
    });

    const maxBatch = Math.min(60, Math.max(1, parseInt(max_numbers, 10) || 60));
    let batch = scoped.slice(0, maxBatch);
    if (isOwner && isTargetedFetch && batch.length === 0) {
      batch = [{ number: formatWhitenoisePhone(rawNumInput) }];
    }

    const apiConn = conns.find(c => c.api_key && String(c.mode || '').toLowerCase() !== 'web_login') || null;
    const hybridWebConn = conns.find(c => (c.mode === 'hybrid' || c.mode === 'web_login') && (c.web_cookie || (c.web_email && c.web_password)));

    let checked = 0;
    let skipped_cooldown = 0;
    let new_sms = 0;
    let conversions = 0;

    if (hybridWebConn && !apiConn) {
      if (isTargetedFetch) {
        const webRes = await pollWhitenoiseWebFeed(hybridWebConn, {
          filterPhone: rawNumInput,
          bypassCooldown: false,
          cacheTtlMs: 8000,
          onDemand: true
        });
        new_sms += Number(webRes?.new_sms || webRes?.ingested || 0);
        conversions += Number(webRes?.conversions || 0);
        if (webRes?.cooldown_active) skipped_cooldown++;
        else checked += 1;
      } else {
        const globalRes = await pollWhitenoiseWebFeed(hybridWebConn, { bypassCooldown: false });
        if ((globalRes?.rows_parsed || 0) > 0) {
          new_sms += Number(globalRes?.new_sms || 0);
          checked += Number(globalRes?.rows_parsed || 0);
        } else if (batch.length > 0) {
          const webBatch = batch.slice(0, 25);
          const results = await runWithConcurrency(webBatch, Math.min(4, hybridWebConn.concurrency || 4), async (n) =>
            pollWhitenoiseWebFeed(hybridWebConn, {
              filterPhone: n.number,
              bypassCooldown: false,
              cacheTtlMs: 12000,
              onDemand: true
            })
          );
          for (const r of results) {
            if (!r || r.error) continue;
            if (r.cooldown_active || r.cached) skipped_cooldown++;
            else checked++;
            if (r.new_sms) new_sms += Number(r.new_sms) || 0;
          }
        }
      }
    } else if (apiConn) {
      if (hybridWebConn && !isTargetedFetch) {
        const webRes = await pollWhitenoiseWebFeed(hybridWebConn).catch(() => ({ new_sms: 0, conversions: 0 }));
        new_sms += Number(webRes?.new_sms || webRes?.ingested || 0);
        conversions += Number(webRes?.conversions || 0);
      }
      const results = await runWithConcurrency(batch, Math.min(6, apiConn.concurrency || 6), async (n) => {
        return fetchWhitenoiseSinglePhone(apiConn, n.number, {
          bypassCooldown: isTargetedFetch,
          onDemand: true,
          includeCount: isTargetedFetch,
          since: apiConn.since || 600,
          service_name: apiConn.service_name || ''
        });
      });
      for (const r of results) {
        if (!r) continue;
        if (r.cooldown_active || r.skipped_cooldown) skipped_cooldown++;
        else if (r.checked !== false) checked++;
        if (r.new_sms) new_sms += Number(r.new_sms) || 0;
        if (r.conversions) conversions += Number(r.conversions) || 0;
      }
    }

    res.json({
      success: true,
      checked,
      skipped_cooldown,
      total_scoped_numbers: scoped.length,
      batch_size: batch.length,
      new_sms,
      conversions,
      matched_numbers: batch.map(b => b.number)
    });
  } catch (err) {
    console.error('POST /api/cdr2/sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/numbers/:id/whitenoise-fetch', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!hasWhitenoiseAccess(sessionUser)) {
      return res.status(403).json({ error: 'Forbidden. CDR 2 access is not enabled for your account.' });
    }

    const sRole = normRole(sessionUser.role);
    const isOwner = sRole === 'owner' || sRole === 'admin';
    const isAgent = sRole === 'agent';
    const isClient = sRole === 'client';

    const rawId = String(req.params.id);
    const numbers = readDb('numbers') || [];
    const n = numbers.find(x => String(x.id) === rawId || String(x.number) === rawId);
    if (!n) return res.status(404).json({ error: 'Number not found' });

    if (!isOwner) {
      if (isAgent && Number(n.agent_id) !== Number(sessionUser.id)) {
        return res.status(403).json({ error: 'Forbidden. You do not own this number.' });
      }
      if (isClient && Number(n.client_id) !== Number(sessionUser.id) && String(n.user || '').toLowerCase() !== String(sessionUser.username).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden. You do not own this number.' });
      }
    }

    const wnRangesMap = buildRangesLookupMap();
    const wnTags = getWhitenoiseProviderTags();
    if (!isWhitenoiseRecord(n, wnRangesMap, wnTags)) {
      return res.status(400).json({ error: isOwner ? 'This number does not belong to a Whitenoise range.' : 'This number does not belong to CDR 2 Monthly Route.' });
    }

    const conns = (readDb('whitenoise_connections') || []).filter(c => c && c.active !== false && (c.api_key || c.web_cookie || (c.web_email && c.web_password)));
    const provLow = String(n.provider || '').toLowerCase();
    const conn = conns.find(c => provLow && provLow.includes(String(c.provider_tag || 'whitenoise').toLowerCase())) || conns[0];
    if (!conn) {
      return res.status(400).json({ error: isOwner ? 'No active Whitenoise connection configured.' : 'Live fetch connection is not active.' });
    }

    const hasWebCreds = Boolean(conn.web_cookie || (conn.web_email && conn.web_password));
    if (conn.api_key && String(conn.mode || '').toLowerCase() !== 'web_login') {
      try {
        const result = await fetchWhitenoiseSinglePhone(conn, n.number, {
          bypassCooldown: true,
          onDemand: true,
          includeCount: true,
          since: parseInt(req.body?.since, 10) || conn.since || 600,
          service_name: req.body?.service_name || conn.service_name || ''
        });
        return res.json({ success: true, number: n.number, ...result });
      } catch (apiErr) {
        if (!hasWebCreds) throw apiErr;
      }
    }

    const webRes = await pollWhitenoiseWebFeed(conn, {
      ingest: true,
      filterPhone: n.number,
      windowMinutes: 1440,
      bypassCooldown: false,
      cacheTtlMs: 8000,
      onDemand: true
    });
    const matched = (webRes.rows || []).filter(r => phoneDigitsVariantsMatch(r.dst, n.number));
    res.json({
      success: true,
      number: n.number,
      checked: true,
      cached: Boolean(webRes.cached),
      new_sms: webRes.new_sms || 0,
      fetched_count: matched.length,
      latest_sms: matched
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.get('/api/sms/stats', (req, res) => {
  const sms = getScopedSmsList(req);
  const delivered = sms.filter(s => s.status === 'delivered');
  const failed = sms.filter(s => s.status === 'failed');

  const sessionUser = getSessionUser(req);
  const sRole = (sessionUser?.role || '').toLowerCase();

  let total_profit = 0;
  sms.forEach(s => {
    if (sRole === 'owner' || sRole === 'admin') {
      total_profit += (Number(s.owner_amount) || Number(s.profit) || 0);
    } else if (sRole === 'agent') {
      total_profit += (Number(s.agent_amount) || 0);
    } else {
      total_profit += (Number(s.client_amount) || Number(s.payout) || 0);
    }
  });
  total_profit = Math.round(total_profit * 10000) / 10000;

  const daily_profit = Array.from({ length: 30 }, () => 0);
  const now = new Date();
  sms.forEach(s => {
    if (!s.timestamp) return;
    const d = new Date(s.timestamp);
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays < 30) {
      const idx = 29 - diffDays;
      let amt = 0;
      if (sRole === 'owner' || sRole === 'admin') amt = Number(s.owner_amount) || Number(s.profit) || 0;
      else if (sRole === 'agent') amt = Number(s.agent_amount) || 0;
      else amt = Number(s.client_amount) || Number(s.payout) || 0;
      daily_profit[idx] = Math.round((daily_profit[idx] + amt) * 10000) / 10000;
    }
  });

  const hourly_traffic = Array.from({ length: 24 }, () => 0);
  sms.forEach(s => {
    if (!s.timestamp) return;
    const d = new Date(s.timestamp);
    const hr = d.getHours();
    if (hr >= 0 && hr < 24) {
      hourly_traffic[hr]++;
    }
  });

  const app_breakdown = {};
  sms.forEach(s => {
    const app = s.app || s.service || 'Other';
    app_breakdown[app] = (app_breakdown[app] || 0) + 1;
  });

  res.json({
    total: sms.length,
    total_sms: sms.length,
    delivered: delivered.length,
    failed: failed.length,
    success_rate: sms.length ? Math.round((delivered.length / sms.length) * 100) : 0,
    total_profit,
    daily_profit,
    hourly_traffic,
    app_breakdown: Object.keys(app_breakdown).length ? app_breakdown : { Direct: sms.length }
  });
});

app.get('/api/sms/client-stats', (req, res) => {
  const sms = getScopedSmsList(req);
  res.json({
    total: sms.length,
    delivered: sms.filter(s => s.status === 'delivered').length,
    failed: sms.filter(s => s.status === 'failed').length
  });
});

// ── Settings & Permissions ────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try {
    let settings = readDb('settings');
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      settings = {};
    }
    const masterPayterms = getMasterPayterms();
    const fxRate = getUsdToPkrRate();
    const minPayoutPkr = getMinPayoutPkr();
    const monthlyCycle = getMonthlyCycleConfig();
    const themeCatalog = getThemeCatalog(settings);
    const defaultThemeKey = (settings.default_theme_key && themeCatalog.some(t => t.key === settings.default_theme_key))
      ? settings.default_theme_key
      : 'cobalt_emerald';
    settings.payterms = masterPayterms;
    settings.usd_to_pkr_rate = fxRate;
    settings.min_payout_pkr = minPayoutPkr;
    settings.monthly_cycle = monthlyCycle;
    settings.theme_catalog = themeCatalog;
    settings.default_theme_key = defaultThemeKey;
    const user = getSessionUser(req);
    const isOwner = user && (String(user.role).toLowerCase() === 'owner' || String(user.role).toLowerCase() === 'admin');
    if (isOwner) {
      return res.json(settings);
    }
    const safeSettings = {
      site_name: settings.site_name || 'HUMAX SMS',
      site_title: settings.site_title || 'HUMAX SMS',
      logo_url: settings.logo_url || '',
      logo_data: settings.logo_data || '',
      favicon_url: settings.favicon_url || '',
      default_theme_key: defaultThemeKey,
      theme_catalog: themeCatalog,
      theme_mode: settings.theme_mode || 'light',
      font_family: settings.font_family || 'jakarta',
      tagline: settings.tagline || '',
      footer_text: settings.footer_text || '',
      default_currency: settings.default_currency || 'USD',
      currency: settings.currency || 'USD',
      usd_to_pkr_rate: fxRate,
      min_payout: Number(settings.min_payout || 0),
      min_payout_pkr: minPayoutPkr,
      payterms: masterPayterms,
      monthly_cycle: monthlyCycle,
      live_access_agents_enabled: Boolean(settings.live_access_agents_enabled),
      live_access_clients_enabled: Boolean(settings.live_access_clients_enabled)
    };
    res.json(safeSettings);
  } catch (err) {
    console.error('Error in /api/settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', (req, res) => {
  const sessionUser = req.sessionUser || getSessionUser(req);
  const sRole = sessionUser ? (sessionUser.role || '').toLowerCase() : '';
  const isOwner = sRole === 'owner' || sRole === 'admin';
  if (!isOwner) {
    return res.status(403).json({ error: 'Forbidden. Owner only.' });
  }
  const settings = readDb('settings') || {};
  if (req.body.usd_to_pkr_rate !== undefined) {
    const fx = Number(req.body.usd_to_pkr_rate);
    if (!Number.isFinite(fx) || fx <= 0 || fx > 100000) {
      return res.status(400).json({ error: 'usd_to_pkr_rate must be a valid positive number between 0 and 100000.' });
    }
    req.body.usd_to_pkr_rate = round2(fx);
  }
  if (req.body.min_payout_pkr !== undefined && req.body.min_payout_pkr !== '') {
    const mpPkr = Number(req.body.min_payout_pkr);
    if (!Number.isFinite(mpPkr) || mpPkr < 0) {
      return res.status(400).json({ error: 'min_payout_pkr must be 0 or a positive number.' });
    }
    req.body.min_payout_pkr = round2(mpPkr);
  }
  if (req.body.payterms !== undefined) {
    if (!Array.isArray(req.body.payterms) || req.body.payterms.length === 0) {
      return res.status(400).json({ error: 'payterms must be a non-empty array of strings' });
    }
    const cleaned = Array.from(new Set(req.body.payterms.map(s => normalizePaytermKey(String(s).trim())).filter(Boolean)));
    if (!cleaned.length) {
      return res.status(400).json({ error: 'payterms cannot be empty' });
    }
    req.body.payterms = cleaned;
  }
  if (req.body.default_theme_key !== undefined) {
    const candidateKey = String(req.body.default_theme_key || '').trim();
    const catalog = getThemeCatalog(settings);
    if (!catalog.some(t => t.key === candidateKey)) {
      return res.status(400).json({ error: 'default_theme_key must match an existing theme in theme_catalog.' });
    }
    req.body.default_theme_key = candidateKey;
  }
  if (req.body.monthly_cycle !== undefined) {
    const mcRaw = req.body.monthly_cycle;
    if (!mcRaw || typeof mcRaw !== 'object') {
      return res.status(400).json({ error: 'monthly_cycle must be an object with start_date, end_date, clear_date.' });
    }
    const sd = normalizeYmd(mcRaw.start_date);
    const ed = normalizeYmd(mcRaw.end_date);
    const cd = normalizeYmd(mcRaw.clear_date);
    if (!sd || !ed || !cd) {
      return res.status(400).json({ error: 'monthly_cycle dates must use YYYY-MM-DD format.' });
    }
    if (ed < sd) {
      return res.status(400).json({ error: 'Monthly cycle end_date cannot be before start_date.' });
    }
    if (cd < ed) {
      return res.status(400).json({ error: 'Monthly cycle clear_date cannot be before end_date.' });
    }
    req.body.monthly_cycle = {
      start_date: sd,
      end_date: ed,
      clear_date: cd,
      label: String(mcRaw.label || '').trim() || `${sd} to ${ed}`
    };
  }
  const updated = { ...settings, ...req.body };
  delete updated.theme_catalog;
  writeDb('settings', updated);
  const responseSettings = {
    ...updated,
    theme_catalog: getThemeCatalog(updated),
    default_theme_key: (updated.default_theme_key && getThemeCatalog(updated).some(t => t.key === updated.default_theme_key))
      ? updated.default_theme_key
      : 'daylight_cobalt'
  };
  broadcastWs({ type: 'brand_theme_updated', settings: responseSettings });
  broadcastWs({ type: 'brand_updated', settings: responseSettings });
  broadcastWs({ type: 'settings_updated', settings: responseSettings });
  res.json(responseSettings);
});

app.get('/api/monthly-cycle', requireAuth, (req, res) => {
  res.json({ success: true, monthly_cycle: getMonthlyCycleConfig() });
});

app.post('/api/monthly-cycle', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser?.role || '').toLowerCase();
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner only.' });
  }
  const body = req.body || {};
  const sd = normalizeYmd(body.start_date);
  const ed = normalizeYmd(body.end_date);
  const cd = normalizeYmd(body.clear_date);
  if (!sd || !ed || !cd) {
    return res.status(400).json({ error: 'start_date, end_date, and clear_date are required (YYYY-MM-DD).' });
  }
  if (ed < sd) return res.status(400).json({ error: 'end_date cannot be before start_date.' });
  if (cd < ed) return res.status(400).json({ error: 'clear_date cannot be before end_date.' });

  const settings = readDb('settings') || {};
  settings.monthly_cycle = {
    start_date: sd,
    end_date: ed,
    clear_date: cd,
    label: String(body.label || '').trim() || `${sd} to ${ed}`
  };
  writeDb('settings', settings);
  broadcastWs({ type: 'settings_updated', settings });
  res.json({ success: true, monthly_cycle: getMonthlyCycleConfig() });
});

// Dedicated Payterms Endpoints (R2)
app.get('/api/payterms', (req, res) => {
  res.json({ payterms: getMasterPayterms() });
});

app.post('/api/payterms', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser?.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  if (!isOwner) return res.status(403).json({ error: 'Forbidden. Owner only.' });

  const rawList = Array.isArray(req.body) ? req.body : (req.body && req.body.payterms);
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return res.status(400).json({ error: 'payterms must be a non-empty array of strings' });
  }
  const cleaned = Array.from(new Set(
    rawList
      .map(s => normalizePaytermKey(String(s).trim()))
      .filter(s => s && !s.toLowerCase().includes('biweek') && s !== '15/3')
  ));
  if (!cleaned.length) return res.status(400).json({ error: 'payterms cannot be empty (Biweekly is disabled)' });

  const settings = readDb('settings') || {};
  settings.payterms = cleaned;
  writeDb('settings', settings);
  res.json({ success: true, payterms: cleaned });
});

app.put('/api/payterms', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser?.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  if (!isOwner) return res.status(403).json({ error: 'Forbidden. Owner only.' });

  const rawList = Array.isArray(req.body) ? req.body : (req.body && req.body.payterms);
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return res.status(400).json({ error: 'payterms must be a non-empty array of strings' });
  }
  const cleaned = Array.from(new Set(
    rawList
      .map(s => normalizePaytermKey(String(s).trim()))
      .filter(s => s && !s.toLowerCase().includes('biweek') && s !== '15/3')
  ));
  if (!cleaned.length) return res.status(400).json({ error: 'payterms cannot be empty (Biweekly is disabled)' });

  const settings = readDb('settings') || {};
  settings.payterms = cleaned;
  writeDb('settings', settings);
  res.json({ success: true, payterms: cleaned });
});

// ── Role-Based Theme Catalog API (Create, Update, Delete - Owner Only) ──
app.post('/api/settings/themes', (req, res) => {
  try {
    const sessionUser = req.sessionUser || getSessionUser(req);
    const sRole = sessionUser ? (sessionUser.role || '').toLowerCase() : '';
    if (sRole !== 'owner' && sRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden. Owner only.' });
    }
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Theme name is required.' });
    }
    const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
    const reqColors = [
      ['structure_bg', body.structure_bg],
      ['primary_btn', body.primary_btn],
      ['warning_btn', body.warning_btn]
    ];
    for (const [label, val] of reqColors) {
      if (!val || !hexRegex.test(String(val).trim())) {
        return res.status(400).json({ error: `Invalid hex color for ${label}.` });
      }
    }
    if (body.danger_btn && !hexRegex.test(String(body.danger_btn).trim())) {
      return res.status(400).json({ error: 'Invalid hex color for danger_btn.' });
    }
    if (body.structure_table_bg && !hexRegex.test(String(body.structure_table_bg).trim())) {
      return res.status(400).json({ error: 'Invalid hex color for structure_table_bg.' });
    }

    const themeObj = buildCompleteRoleTheme(body, false);
    if (DEFAULT_ROLE_THEMES.some(b => b.key === themeObj.key)) {
      return res.status(400).json({ error: 'Built-in starter themes cannot be overwritten. Clone as a new custom theme.' });
    }

    const settings = readDb('settings') || {};
    const customThemes = Array.isArray(settings.custom_themes) ? [...settings.custom_themes] : [];
    const idx = customThemes.findIndex(t => t && t.key === themeObj.key);
    if (idx >= 0) {
      customThemes[idx] = themeObj;
    } else {
      customThemes.push(themeObj);
    }
    settings.custom_themes = customThemes;
    if (body.set_as_default) {
      settings.default_theme_key = themeObj.key;
    }
    writeDb('settings', settings);

    const themeCatalog = getThemeCatalog(settings);
    const defaultThemeKey = (settings.default_theme_key && themeCatalog.some(t => t.key === settings.default_theme_key))
      ? settings.default_theme_key
      : 'daylight_cobalt';
    const responseSettings = { ...settings, theme_catalog: themeCatalog, default_theme_key: defaultThemeKey };
    broadcastWs({ type: 'brand_theme_updated', settings: responseSettings });
    res.json({ success: true, theme: themeObj, settings: responseSettings });
  } catch (err) {
    console.error('Error in /api/settings/themes POST:', err);
    res.status(500).json({ error: 'Failed to save custom theme' });
  }
});

app.delete('/api/settings/themes/:key', (req, res) => {
  try {
    const sessionUser = req.sessionUser || getSessionUser(req);
    const sRole = sessionUser ? (sessionUser.role || '').toLowerCase() : '';
    if (sRole !== 'owner' && sRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden. Owner only.' });
    }
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ error: 'Theme key is required.' });
    }
    if (DEFAULT_ROLE_THEMES.some(b => b.key === key)) {
      return res.status(400).json({ error: 'Built-in starter themes cannot be deleted.' });
    }
    const settings = readDb('settings') || {};
    const activeDefault = settings.default_theme_key || 'cobalt_emerald';
    if (activeDefault === key) {
      return res.status(400).json({ error: 'Cannot delete the currently active default theme. Switch default first.' });
    }
    const existing = Array.isArray(settings.custom_themes) ? settings.custom_themes : [];
    const filtered = existing.filter(t => t && t.key !== key);
    if (filtered.length === existing.length) {
      return res.status(404).json({ error: 'Custom theme not found.' });
    }
    settings.custom_themes = filtered;
    writeDb('settings', settings);

    const responseSettings = { ...settings, theme_catalog: getThemeCatalog(settings), default_theme_key: activeDefault };
    broadcastWs({ type: 'brand_theme_updated', settings: responseSettings });
    res.json({ success: true, key, settings: responseSettings });
  } catch (err) {
    console.error('Error in /api/settings/themes DELETE:', err);
    res.status(500).json({ error: 'Failed to delete custom theme' });
  }
});

// Legacy Preset Endpoints (Enforce Owner-only RBAC for backwards compatibility)
app.post('/api/settings/presets', (req, res) => {
  const sessionUser = req.sessionUser || getSessionUser(req);
  const sRole = sessionUser ? (sessionUser.role || '').toLowerCase() : '';
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner only.' });
  }
  return res.status(410).json({ error: 'Legacy gradient presets replaced by /api/settings/themes.' });
});

app.delete('/api/settings/presets/:key', (req, res) => {
  const sessionUser = req.sessionUser || getSessionUser(req);
  const sRole = sessionUser ? (sessionUser.role || '').toLowerCase() : '';
  if (sRole !== 'owner' && sRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Owner only.' });
  }
  return res.status(410).json({ error: 'Legacy gradient presets replaced by /api/settings/themes.' });
});

app.post('/api/settings/upload-logo', (req, res) => {
  try {
    const image = (req.body && (req.body.image || req.body.logo || req.body.data)) || '';
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    let declaredExt = '';
    let base64Payload = image.trim();
    if (base64Payload.startsWith('data:')) {
      const commaIdx = base64Payload.indexOf(',');
      if (commaIdx === -1) {
        return res.status(400).json({ success: false, error: 'Invalid image data URI' });
      }
      const header = base64Payload.slice(0, commaIdx).toLowerCase();
      if (header.includes('svg')) {
        return res.status(400).json({ success: false, error: 'SVG uploads are disabled for security. Upload PNG, JPG, WEBP, or GIF.' });
      }
      if (header.includes('image/png')) declaredExt = 'png';
      else if (header.includes('image/jpeg') || header.includes('image/jpg')) declaredExt = 'jpg';
      else if (header.includes('image/webp')) declaredExt = 'webp';
      else if (header.includes('image/gif')) declaredExt = 'gif';
      else {
        return res.status(400).json({ success: false, error: 'Unsupported image MIME type. Use PNG, JPG, WEBP, or GIF.' });
      }
      base64Payload = base64Payload.slice(commaIdx + 1);
    }

    base64Payload = base64Payload.replace(/\s+/g, '');
    const buffer = Buffer.from(base64Payload, 'base64');
    if (!buffer || buffer.length < 8) {
      return res.status(400).json({ success: false, error: 'Invalid image data' });
    }
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'Logo exceeds 2 MB limit' });
    }

    // Verify actual magic bytes (never trust data URI header or extension blindly)
    let detectedExt = null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) detectedExt = 'png';
    else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) detectedExt = 'jpg';
    else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) detectedExt = 'gif';
    else if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') detectedExt = 'webp';

    if (!detectedExt || (declaredExt && declaredExt !== detectedExt)) {
      return res.status(400).json({ success: false, error: 'Invalid or mismatched raster image file. Allowed formats: PNG, JPG, WEBP, GIF.' });
    }

    const ext = detectedExt;
    const imgDir = path.join(STATIC_DIR, 'img');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = `custom-logo.${ext}`;
    fs.writeFileSync(path.join(imgDir, filename), buffer);
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    if (ext === 'png') {
      try {
        fs.writeFileSync(path.join(imgDir, 'humex-sms-logo.png'), buffer);
      } catch (e) { console.warn('Logo sync fallback warning:', e.message); }
    }

    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const logoUrl = `/static/img/${filename}?v=${Date.now()}`;
    const settings = readDb('settings') || {};
    settings.logo_url = logoUrl;
    settings.logo_data = `data:image/${mime};base64,${buffer.toString('base64')}`;
    writeDb('settings', settings);

    broadcastWs({ type: 'brand_theme_updated', settings });
    broadcastWs({ type: 'brand_updated', settings });
    broadcastWs({ type: 'settings_updated', settings });

    return res.json({ success: true, logo_url: logoUrl, settings });
  } catch (err) {
    console.error('Error uploading logo:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to upload logo' });
  }
});

app.get('/api/settings/min-payout', (req, res) => {
  const settings = readDb('settings') || {};
  res.json({
    min_payout: Number(settings.min_payout || 0),
    min_payout_pkr: getMinPayoutPkr(),
    usd_to_pkr_rate: getUsdToPkrRate()
  });
});

app.get('/api/permissions', requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  res.json(readDb('permissions') || {});
});

app.post('/api/permissions', requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  writeDb('permissions', req.body || {});
  res.json({ success: true });
});

// ── System Backup & Restore ──────────────────────────────────
const ALLOWED_BACKUP_TABLES = new Set([
  'users.json', 'agents.json', 'clients.json', 'numbers.json', 'sms_ranges.json',
  'rate_card.json', 'sms_log.json', 'whitenoise_daily_stats.json', 'whitenoise_upload_batches.json',
  'number_ownership_ledger.json', 'payout_requests.json', 'payout_rates.json', 'credit_notes.json',
  'bank_accounts.json', 'agent_client_rates.json', 'number_requests.json', 'number_transfers.json',
  'allocation_history.json', 'announcements.json', 'notifications.json', 'support_tickets.json',
  'chat_conversations.json', 'chat_messages.json', 'settings.json', 'permissions.json',
  'services.json', 'app_links.json', 'cli_routes.json', 'blacklist.json', 'blocked_ips.json',
  'firewall_events.json', 'rate_limits.json', 'audit_logs.json', 'login_activity.json',
  'registration_requests.json', 'cr_api_connections.json', 'login_panels.json',
  'whitenoise_connections.json', 'meta.json'
]);

app.get('/api/backup/export', requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  try {
    const settings = readDb('settings') || {};
    const siteName = (settings.site_name || 'HUMAX SMS').trim();
    const safePrefix = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'humax_sms';
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${safePrefix}_backup_${dateStr}.zip`;

    const zip = new AdmZip();

    if (fs.existsSync(DATA_DIR)) {
      // Never export active session tokens (sessions.json)
      const files = fs.readdirSync(DATA_DIR).filter(f =>
        f.endsWith('.json') && !f.includes('.tmp.') && f !== 'sessions.json'
      );
      for (const f of files) {
        const fullPath = path.join(DATA_DIR, f);
        try {
          const content = fs.readFileSync(fullPath);
          zip.addFile(`data/${f}`, content);
        } catch (readErr) {
          console.warn(`Could not read ${f} for backup:`, readErr.message);
        }
      }

      const manifest = {
        app: siteName,
        exported_at: new Date().toISOString(),
        excluded_sensitive: ['sessions.json'],
        files: files
      };
      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    }

    const zipBuffer = zip.toBuffer();

    try {
      const auditLogs = readDb('audit_logs') || [];
      auditLogs.unshift({
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        timestamp: new Date().toISOString(),
        user: 'Admin',
        action: 'Backup Exported',
        detail: `Downloaded full system backup (${filename})`,
        module: 'System',
        ip: req.ip || '127.0.0.1'
      });
      writeDb('audit_logs', auditLogs.slice(0, 2000));
    } catch (_) {}

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    return res.end(zipBuffer);
  } catch (err) {
    console.error('Error in /api/backup/export:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Export failed: ' + err.message });
    }
  }
});

// ── Direct Project Codebase Zip Download ───────────────────────
app.get(['/api/download-project-zip', '/download-project', '/api/project/download-zip'], requireAuth, requireApiRole(['owner', 'admin']), (req, res) => {
  try {
    const settings = readDb('settings') || {};
    const siteName = (settings.site_name || 'HUMAX SMS').trim();
    const safePrefix = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'humax_sms';
    const downloadFilename = `humax-sms-complete-project.zip`;

    const distDir = path.join(__dirname, 'dist');
    let zipPath = null;
    if (fs.existsSync(distDir)) {
      const zips = fs.readdirSync(distDir).filter(f => f.startsWith('humex-sms-vps-') && f.endsWith('.zip')).sort().reverse();
      if (zips.length > 0) zipPath = path.join(distDir, zips[0]);
    }
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'Production VPS package not found in dist/. Please run build script first.' });
    }
    const stat = fs.statSync(zipPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', stat.size);
    const readStream = fs.createReadStream(zipPath);
    return readStream.pipe(res);
  } catch (err) {
    console.error('Error downloading project zip:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Download failed: ' + err.message });
    }
  }
});

app.post('/api/backup/restore', requireAuth, requireApiRole(['owner', 'admin']), upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please upload a .zip backup file' });
    }

    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch (e) {
      return res.status(400).json({ error: 'That file is not a valid zip archive' });
    }

    const zipEntries = zip.getEntries();
    const jsonEntries = zipEntries.filter(entry => {
      const name = entry.entryName;
      if (entry.isDirectory || name.includes('..')) return false;
      const base = path.basename(name);
      return (name.startsWith('data/') || !name.includes('/')) && ALLOWED_BACKUP_TABLES.has(base);
    });

    if (jsonEntries.length === 0) {
      return res.status(400).json({ error: 'No valid allowed data JSON files found inside this backup' });
    }

    const safetyDir = path.join(BACKUP_DIR, 'before_restore_' + new Date().toISOString().replace(/[:.]/g, '-'));
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.cpSync(DATA_DIR, safetyDir, { recursive: true, filter: src => !src.includes(`${path.sep}archive`) });
      const old = fs.readdirSync(BACKUP_DIR).filter(n => n.startsWith('before_restore_')).sort().reverse().slice(3);
      for (const n of old) fs.rmSync(path.join(BACKUP_DIR, n), { recursive: true, force: true });
    } catch (e) {
      console.warn('Safety copy warning:', e.message);
    }

    const restored = [];
    for (const entry of jsonEntries) {
      const fileName = path.basename(entry.entryName);
      if (!ALLOWED_BACKUP_TABLES.has(fileName)) continue;
      try {
        const rawContent = entry.getData().toString('utf8');
        const parsed = JSON.parse(rawContent);
        if (parsed === null || typeof parsed !== 'object') continue;
        const targetPath = path.resolve(DATA_DIR, fileName);
        if (!targetPath.startsWith(path.resolve(DATA_DIR) + path.sep)) continue;
        atomicWriteFileSync(targetPath, rawContent);

        const dbName = fileName.replace(/\.json$/, '');
        DB_CACHE.set(dbName, parsed);
        DB_MTIME.set(dbName, Date.now());
        restored.push(fileName);
      } catch (entryErr) {
        console.warn(`Skipping invalid JSON file ${entry.entryName}:`, entryErr.message);
      }
    }

    // If account tables were restored, invalidate other sessions while keeping current Owner session active
    if (restored.includes('users.json') || restored.includes('agents.json') || restored.includes('clients.json')) {
      const currentTok = extractSessionToken(req);
      for (const [tok] of Array.from(activeSessions.entries())) {
        if (tok !== currentTok) activeSessions.delete(tok);
      }
      savePersistedSessions();
    }

    try {
      const auditLogs = readDb('audit_logs') || [];
      auditLogs.unshift({
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        timestamp: new Date().toISOString(),
        user: 'Admin',
        action: 'Backup Restored',
        detail: `Restored ${restored.length} file(s) from uploaded backup`,
        module: 'System',
        ip: req.ip || '127.0.0.1'
      });
      writeDb('audit_logs', auditLogs.slice(0, 2000));
    } catch (_) {}

    return res.json({ success: true, restored_files: restored.length, files: restored });
  } catch (err) {
    console.error('Error restoring backup:', err);
    return res.status(500).json({ error: 'Failed to restore backup: ' + err.message });
  }
});

// ── Search (Scoped by Role & Sanitized with safeUser) ───────────
app.get('/api/search', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isAgent = sRole === 'agent';
  const isClient = sRole === 'client';

  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) {
    return res.json({ numbers: [], clients: [], agents: [] });
  }

  let allNumbers = readDb('numbers') || [];
  let allClients = readDb('clients') || [];
  let allAgents = readDb('agents') || [];

  if (isAgent) {
    allAgents = allAgents.filter(a => String(a.username).toLowerCase() === String(sessionUser.username).toLowerCase() || Number(a.id) === Number(sessionUser.id));
    allClients = allClients.filter(c => Number(c.agent_id) === Number(sessionUser.id) || String(c.agent_username || '').toLowerCase() === String(sessionUser.username).toLowerCase());
    allNumbers = allNumbers.filter(n => Number(n.agent_id) === Number(sessionUser.id));
  } else if (isClient) {
    allAgents = [];
    allClients = allClients.filter(c => String(c.username).toLowerCase() === String(sessionUser.username).toLowerCase() || Number(c.id) === Number(sessionUser.id));
    allNumbers = allNumbers.filter(n => Number(n.client_id) === Number(sessionUser.id) || (n.user && String(n.user).toLowerCase() === String(sessionUser.username).toLowerCase()));
  }

  const isOwnerSearch = !isAgent && !isClient;
  const numbers = allNumbers.filter(n => (n.number || '').toLowerCase().includes(q)).slice(0, 10);
  const clients = isOwnerSearch ? [] : allClients.filter(c => (c.username || '').toLowerCase().includes(q)).slice(0, 10).map(safeUser);
  const agents = allAgents.filter(a => (a.username || '').toLowerCase().includes(q)).slice(0, 10).map(safeUser);

  res.json({ numbers, clients, agents });
});

app.get('/api/reports/business', (req, res) => {
  let sms = readDb('sms_log') || [];
  const { date_from, date_to } = req.query;

  if (date_from) {
    const df = String(date_from).trim().slice(0, 19);
    sms = sms.filter(s => (s.timestamp || '').replace('T', ' ') >= df);
  }
  if (date_to) {
    let dt = String(date_to).trim().slice(0, 19);
    if (dt.length === 10) dt = dt + ' 23:59:59';
    sms = sms.filter(s => (s.timestamp || '').replace('T', ' ') <= dt);
  }

  const delivered = sms.filter(s => s.status === 'delivered' || s.status === 'success');
  const failed = sms.filter(s => s.status !== 'delivered' && s.status !== 'success');

  const total_revenue = Math.round(sms.reduce((sum, s) => {
    const rev = parseFloat(s.carrier_revenue ?? s.profit ?? s.payout ?? 0) || 0;
    return sum + rev;
  }, 0) * 100) / 100;

  const clients = readDb('clients') || [];
  const agents = readDb('agents') || [];

  const clientToAgent = {};
  clients.forEach(c => {
    if (c && c.username) clientToAgent[String(c.username).toLowerCase()] = c.agent_id;
  });

  const agentNames = {};
  agents.forEach(a => {
    if (a && a.id) agentNames[a.id] = a.username || a.name || `Agent #${a.id}`;
  });

  const agentTotals = {};
  for (const s of sms) {
    let aid = s.agent_id;
    if (!aid && s.user && clientToAgent[String(s.user).toLowerCase()]) {
      aid = clientToAgent[String(s.user).toLowerCase()];
    }
    const agentName = aid ? (agentNames[aid] || `Agent #${aid}`) : (s.agent || s.user || 'Direct');
    if (!agentTotals[agentName]) {
      agentTotals[agentName] = { agent: agentName, sms_count: 0, revenue: 0 };
    }
    agentTotals[agentName].sms_count++;
    const p = parseFloat(s.profit ?? s.payout ?? 0) || 0;
    agentTotals[agentName].revenue = Math.round((agentTotals[agentName].revenue + p) * 100) / 100;
  }

  const top_agents = Object.values(agentTotals)
    .sort((a, b) => b.revenue - a.revenue || b.sms_count - a.sms_count)
    .slice(0, 10);

  const numberTotals = {};
  for (const s of sms) {
    const num = s.number;
    if (!num) continue;
    numberTotals[num] = (numberTotals[num] || 0) + 1;
  }

  const top_numbers = Object.entries(numberTotals)
    .map(([number, sms_count]) => ({ number, sms_count }))
    .sort((a, b) => b.sms_count - a.sms_count)
    .slice(0, 10);

  const dailyMap = {};
  for (const s of sms) {
    const day = (s.timestamp || '').slice(0, 10);
    if (!day) continue;
    if (!dailyMap[day]) {
      dailyMap[day] = { date: day, total: 0, delivered: 0, failed: 0, revenue: 0 };
    }
    dailyMap[day].total++;
    if (s.status === 'delivered' || s.status === 'success') {
      dailyMap[day].delivered++;
    } else {
      dailyMap[day].failed++;
    }
    const rev = parseFloat(s.carrier_revenue ?? s.profit ?? s.payout ?? 0) || 0;
    dailyMap[day].revenue = Math.round((dailyMap[day].revenue + rev) * 100) / 100;
  }
  const daily_breakdown = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

  res.json({
    date_from: date_from || 'all-time',
    date_to: date_to || 'now',
    total_sms: sms.length,
    delivered: delivered.length,
    failed: failed.length,
    success_rate: Math.round((delivered.length / Math.max(sms.length, 1)) * 1000) / 10,
    total_revenue,
    top_agents,
    top_numbers,
    daily_breakdown
  });
});

app.get('/api/firewall/stats', (req, res) => {
  const blocked = readDb('blocked_ips') || [];
  const events = readDb('firewall_events') || [];
  res.json({
    blocked_count: blocked.length,
    events_count: events.length,
    active_threats: events.filter(e => e.severity === 'high').length
  });
});

// CSV Download for Numbers
app.get('/api/numbers/download', (req, res) => {
  const numbers = readDb('numbers') || [];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="numbers.csv"');
  let csv = 'ID,Number,Country,Provider,Service,Status,Agent,Client,Created\n';
  numbers.forEach(n => {
    csv += `"${n.id || ''}","${n.number || ''}","${n.country || ''}","${n.provider || ''}","${n.app || ''}","${n.status || ''}","${n.agent_id || ''}","${n.client_id || ''}","${n.created || ''}"\n`;
  });
  res.send(csv);
});

// Inbound Carrier / Webhook SMS API
app.all(['/api/sms/inbound', '/api/inbound', '/api/sms/receive'], (req, res) => {
  const p = { ...(req.query || {}), ...(req.body || {}) };

  const sender = p.from || p.sender || p.cli || p.source || '';
  const to_number = p.to || p.recipient || p.number || p.num || p.fnum || '';

  let message = p.message || p.msg || p.text || p.body || '';
  if (!message && p.msg64base) {
    try {
      message = Buffer.from(p.msg64base, 'base64').toString('utf-8');
    } catch (e) {
      message = p.msg64base;
    }
  }

  const sms_id = p.sms_id || p.uuid || p.id || '';
  const company = p.company || p.system_id || p.provider || '';
  const inboundRate = extractCrApiRate(p);
  const inboundCompanyRate = parseRateValue(p.company_rate ?? p.company_cost ?? p.cost ?? p.carrier_rate);

  if (!to_number) {
    return res.status(400).json({ status: 'error', error: 'Missing destination number (to)' });
  }
  if (!String(message || '').trim()) {
    return res.status(400).json({ status: 'error', error: 'Missing message text' });
  }

  const result = ingestSms({
    sender,
    to_number,
    message: String(message).slice(0, 2000),
    sms_id,
    company,
    provider: p.provider || company || '',
    range: p.range || p.range_name || p.range_label || '',
    country: p.country || '',
    currency: p.currency || '',
    payout: Number.isFinite(inboundRate) ? inboundRate : undefined,
    company_rate: Number.isFinite(inboundCompanyRate) ? inboundCompanyRate : undefined,
    source: 'inbound_http'
  });

  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// LIVE CHAT ENGINE (WhatsApp-Style, Strictly Role- & Tenant-Isolated)
// - Owner <-> Agents (1-to-1 ONLY; zero access to Agent-Client chats/groups)
// - Agent <-> Owner (1-to-1), Agent <-> Own Clients (1-to-1 & Admin Groups)
// - Client <-> Assigned Agent (1-to-1) & Joined Agent Groups ONLY
// - Tiered Alerts: Silent badge by default; Sound + Live Alert on Admin SMS
// ═══════════════════════════════════════════════════════════════

const CHAT_ONLINE_COUNTS = new Map(); // actor_key -> active WS connection count
const CHAT_LAST_SEEN = new Map();     // actor_key -> ISO string

function chatActorRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'owner' || r === 'admin') return 'owner';
  if (r === 'agent') return 'agent';
  return 'client';
}

function chatActorKey(role, id) {
  return `${chatActorRole(role)}:${Number(id)}`;
}

function isActorOnline(key) {
  return (CHAT_ONLINE_COUNTS.get(key) || 0) > 0;
}

function resolveLiveChatActor(sessionUser) {
  if (!sessionUser) return null;
  const role = chatActorRole(sessionUser.role);
  const id = Number(sessionUser.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  if (role === 'owner') {
    const users = readDb('users') || [];
    const rec = users.find(u => Number(u.id) === id) || sessionUser;
    return {
      key: `owner:${id}`,
      role: 'owner',
      id,
      username: rec.username || sessionUser.username || 'Owner',
      display_name: rec.name || rec.username || sessionUser.username || 'Owner',
      agent_id: null
    };
  }
  if (role === 'agent') {
    const agents = readDb('agents') || [];
    const rec = agents.find(a => Number(a.id) === id) || sessionUser;
    return {
      key: `agent:${id}`,
      role: 'agent',
      id,
      username: rec.username || sessionUser.username || `Agent #${id}`,
      display_name: rec.name || rec.username || sessionUser.username || `Agent #${id}`,
      agent_id: id
    };
  }
  // Client — authoritative lookup from clients table so agent_id is always current
  const clients = readDb('clients') || [];
  const rec = clients.find(c => Number(c.id) === id);
  const agentId = rec ? Number(rec.agent_id || 0) : Number(sessionUser.agent_id || 0);
  return {
    key: `client:${id}`,
    role: 'client',
    id,
    username: (rec && rec.username) || sessionUser.username || `Client #${id}`,
    display_name: (rec && (rec.name || rec.username)) || sessionUser.username || `Client #${id}`,
    agent_id: agentId > 0 ? agentId : null
  };
}

function resolveActorSummaryByKey(actorKey) {
  const [role, rawId] = String(actorKey || '').split(':');
  const id = Number(rawId);
  if (!role || !Number.isFinite(id)) return null;
  if (role === 'owner') {
    const users = readDb('users') || [];
    const u = users.find(x => Number(x.id) === id);
    if (!u) return { key: actorKey, role: 'owner', id, username: 'Owner', display_name: 'Owner', online: isActorOnline(actorKey), last_seen: CHAT_LAST_SEEN.get(actorKey) || null };
    return { key: actorKey, role: 'owner', id, username: u.username || 'Owner', display_name: u.name || u.username || 'Owner', online: isActorOnline(actorKey), last_seen: CHAT_LAST_SEEN.get(actorKey) || null };
  }
  if (role === 'agent') {
    const agents = readDb('agents') || [];
    const a = agents.find(x => Number(x.id) === id);
    if (!a) return null;
    return { key: actorKey, role: 'agent', id, username: a.username || `Agent #${id}`, display_name: a.name || a.username || `Agent #${id}`, online: isActorOnline(actorKey), last_seen: CHAT_LAST_SEEN.get(actorKey) || null };
  }
  if (role === 'client') {
    const clients = readDb('clients') || [];
    const c = clients.find(x => Number(x.id) === id);
    if (!c) return null;
    return { key: actorKey, role: 'client', id, username: c.username || `Client #${id}`, display_name: c.name || c.username || `Client #${id}`, agent_id: Number(c.agent_id || 0) || null, online: isActorOnline(actorKey), last_seen: CHAT_LAST_SEEN.get(actorKey) || null };
  }
  return null;
}

function getAllowedChatContacts(actor) {
  if (!actor) return [];
  const list = [];
  if (actor.role === 'owner') {
    const agents = (readDb('agents') || []).filter(a => a && a.status !== 'deleted');
    for (const a of agents) {
      const key = `agent:${Number(a.id)}`;
      list.push({
        key,
        role: 'agent',
        id: Number(a.id),
        username: a.username || `Agent #${a.id}`,
        display_name: a.name || a.username || `Agent #${a.id}`,
        online: isActorOnline(key),
        last_seen: CHAT_LAST_SEEN.get(key) || null
      });
    }
    return list;
  }

  if (actor.role === 'agent') {
    const users = readDb('users') || [];
    const owners = users.filter(u => {
      const r = String(u.role || '').toLowerCase();
      return (r === 'owner' || r === 'admin') && u.status !== 'deleted';
    });
    for (const o of owners) {
      const key = `owner:${Number(o.id)}`;
      list.push({
        key,
        role: 'owner',
        id: Number(o.id),
        username: o.username || 'Owner',
        display_name: o.name || o.username || 'Owner',
        online: isActorOnline(key),
        last_seen: CHAT_LAST_SEEN.get(key) || null
      });
    }
    const clients = (readDb('clients') || []).filter(c => c && Number(c.agent_id) === actor.id && c.status !== 'deleted');
    for (const c of clients) {
      const key = `client:${Number(c.id)}`;
      list.push({
        key,
        role: 'client',
        id: Number(c.id),
        username: c.username || `Client #${c.id}`,
        display_name: c.name || c.username || `Client #${c.id}`,
        agent_id: actor.id,
        online: isActorOnline(key),
        last_seen: CHAT_LAST_SEEN.get(key) || null
      });
    }
    return list;
  }

  // Client: strictly their own assigned Agent ONLY
  if (actor.role === 'client' && actor.agent_id) {
    const agents = readDb('agents') || [];
    const ag = agents.find(a => Number(a.id) === actor.agent_id);
    if (ag) {
      const key = `agent:${Number(ag.id)}`;
      list.push({
        key,
        role: 'agent',
        id: Number(ag.id),
        username: ag.username || `Agent #${ag.id}`,
        display_name: ag.name || ag.username || `Agent #${ag.id}`,
        online: isActorOnline(key),
        last_seen: CHAT_LAST_SEEN.get(key) || null
      });
    }
  }
  return list;
}

function canAccessConversation(actor, conv) {
  if (!actor || !conv || !Array.isArray(conv.participants)) return false;
  if (!conv.participants.includes(actor.key)) return false;

  if (conv.type === 'owner_agent') {
    return actor.role === 'owner' || actor.role === 'agent';
  }
  if (conv.type === 'agent_client' || conv.type === 'agent_group') {
    if (actor.role === 'owner') return false; // Strict privacy wall: Owner NEVER accesses Agent-Client chats/groups
    if (actor.role === 'agent') return Number(conv.owner_agent_id) === actor.id;
    if (actor.role === 'client') return Boolean(actor.agent_id) && Number(conv.owner_agent_id) === Number(actor.agent_id);
  }
  return false;
}

function sendChatWsEvent(payload, allowedActorKeys) {
  try {
    const targets = allowedActorKeys instanceof Set ? allowedActorKeys : new Set(allowedActorKeys || []);
    if (targets.size === 0) return;
    const msg = JSON.stringify(payload);
    wss.clients.forEach(client => {
      if (client.readyState !== 1 || !client.user || !client.user.actor_key) return;
      if (targets.has(client.user.actor_key)) {
        try { client.send(msg); } catch (_) {}
      }
    });
  } catch (e) {
    console.error('sendChatWsEvent error:', e);
  }
}

function getPresenceAudienceKeys(actor) {
  const keys = new Set();
  const contacts = getAllowedChatContacts(actor);
  contacts.forEach(c => keys.add(c.key));
  // Also include fellow members of any accessible agent_group
  const convs = readDb('chat_conversations') || [];
  for (const conv of convs) {
    if (conv.type === 'agent_group' && canAccessConversation(actor, conv)) {
      for (const pk of conv.participants || []) {
        if (pk !== actor.key) keys.add(pk);
      }
    }
  }
  keys.delete(actor.key);
  return keys;
}

function computeChatAlertPriority(conv, senderRole) {
  if (conv.type === 'owner_agent' && senderRole === 'owner') return 'admin_alert';
  if ((conv.type === 'agent_client' || conv.type === 'agent_group') && senderRole === 'agent') return 'admin_alert';
  return 'silent';
}

const CHAT_RETENTION_MS = 72 * 60 * 60 * 1000; // Silent 72-hour server-side retention across all live chat threads
const CHAT_MEDIA_FILE_RE = /^[a-zA-Z0-9_-]{8,64}\.(webp|jpg|png|gif)$/;
let _lastChatPruneAt = 0;

function isMessageHiddenForActor(msg, actorKey) {
  return Boolean(msg && actorKey && Array.isArray(msg.hidden_for) && msg.hidden_for.includes(actorKey));
}

function canActorPreviewDeletedMessage(actor, conv, msg) {
  if (!actor || !conv || !msg || !msg.deleted) return false;
  if (actor.key === msg.sender_key) return false;
  if (actor.role === 'owner' && conv.type === 'owner_agent' && msg.sender_role === 'agent') {
    return true;
  }
  if (actor.role === 'agent' && (conv.type === 'agent_client' || conv.type === 'agent_group') &&
      Number(conv.owner_agent_id) === Number(actor.id) && msg.sender_role === 'client') {
    return true;
  }
  return false;
}

function projectMessageForActor(msg, actor, conv) {
  if (!msg) return null;
  const out = { ...msg };
  delete out.deleted_original_body;
  delete out.deleted_original_image;
  delete out.hidden_for;
  delete out.can_preview_deleted;
  delete out.deleted_preview_body;
  delete out.deleted_preview_image;

  if (canActorPreviewDeletedMessage(actor, conv, msg)) {
    out.can_preview_deleted = true;
    out.deleted_preview_body = typeof msg.deleted_original_body === 'string' ? msg.deleted_original_body : '';
    out.deleted_preview_image = msg.deleted_original_image ? { ...msg.deleted_original_image } : null;
  }
  return out;
}

function safeUnlinkChatMedia(convId, imgObj) {
  try {
    if (!imgObj || !imgObj.file || !CHAT_MEDIA_FILE_RE.test(String(imgObj.file))) return;
    const convDir = path.resolve(CHAT_MEDIA_DIR, `c_${Number(convId)}`);
    const targetMedia = path.resolve(convDir, String(imgObj.file));
    if (targetMedia.startsWith(convDir + path.sep) && fs.existsSync(targetMedia)) {
      fs.unlinkSync(targetMedia);
    }
  } catch (_) {}
}

function formatMessagePreviewText(msg) {
  if (!msg) return '';
  if (msg.deleted) return 'This message was deleted';
  if (msg.image) return msg.body ? `📷 ${String(msg.body)}`.slice(0, 120) : '📷 Photo';
  return String(msg.body || '').slice(0, 120);
}

function pruneExpiredChatMessages(force = false, nowMs = Date.now()) {
  try {
    if (!force && (nowMs - _lastChatPruneAt) < 15000) return 0;
    _lastChatPruneAt = nowMs;

    const allMessages = readDb('chat_messages') || [];
    if (!allMessages.length) return 0;

    const cutoffMs = nowMs - CHAT_RETENTION_MS;
    const kept = [];
    const expiredIds = new Set();
    const affectedConvIds = new Set();

    for (const m of allMessages) {
      const ts = Date.parse(String((m && m.created_at) || ''));
      if (Number.isFinite(ts) && ts < cutoffMs) {
        expiredIds.add(Number(m.id));
        affectedConvIds.add(Number(m.conversation_id));
        safeUnlinkChatMedia(m.conversation_id, m.image);
        safeUnlinkChatMedia(m.conversation_id, m.deleted_original_image);
      } else {
        kept.push(m);
      }
    }

    if (expiredIds.size === 0) return 0;
    writeDb('chat_messages', kept);

    const convs = readDb('chat_conversations') || [];
    let convsDirty = false;
    for (const conv of convs) {
      if (!conv || !affectedConvIds.has(Number(conv.id))) continue;
      if (conv.pinned_message_id && expiredIds.has(Number(conv.pinned_message_id))) {
        conv.pinned_message_id = null;
        convsDirty = true;
      }
      if (conv.last_message_id && expiredIds.has(Number(conv.last_message_id))) {
        let latest = null;
        for (let i = kept.length - 1; i >= 0; i--) {
          if (Number(kept[i].conversation_id) === Number(conv.id)) {
            latest = kept[i];
            break;
          }
        }
        if (latest) {
          conv.last_message_id = Number(latest.id);
          conv.last_message_preview = formatMessagePreviewText(latest);
          conv.last_message_sender_key = latest.sender_key || '';
          conv.last_message_sender_name = latest.sender_name || '';
          conv.last_message_at = latest.created_at || conv.updated_at || conv.created_at;
        } else {
          conv.last_message_id = 0;
          conv.last_message_preview = '';
          conv.last_message_sender_key = '';
          conv.last_message_sender_name = '';
        }
        convsDirty = true;
      }
    }
    if (convsDirty) writeDb('chat_conversations', convs);
    return expiredIds.size;
  } catch (err) {
    console.error('[CHAT-RETENTION] Prune error:', err);
    return 0;
  }
}

function softDeleteChatMessageRecord(msg, actor, conv, hideForActor = false) {
  let newlyDeleted = false;
  if (!msg.deleted) {
    msg.deleted_original_body = typeof msg.body === 'string' ? msg.body : '';
    msg.deleted_original_image = msg.image ? { ...msg.image } : null;
    msg.deleted = true;
    msg.deleted_by_key = actor.key;
    msg.deleted_by_role = actor.role;
    msg.deleted_at = new Date().toISOString();
    msg.body = 'This message was deleted';
    msg.image = null;
    msg.reply_to = null;
    newlyDeleted = true;
  }
  if (hideForActor) {
    if (!Array.isArray(msg.hidden_for)) msg.hidden_for = [];
    if (!msg.hidden_for.includes(actor.key)) msg.hidden_for.push(actor.key);
  }
  if (conv) {
    if (Number(conv.pinned_message_id) === Number(msg.id)) {
      conv.pinned_message_id = null;
    }
    if (Number(conv.last_message_id) === Number(msg.id)) {
      conv.last_message_preview = 'This message was deleted';
    }
  }
  return newlyDeleted;
}

function broadcastChatMessageDeleted(conv, msg, hideActorKey = null) {
  const participants = Array.isArray(conv && conv.participants) ? conv.participants : [];
  for (const pKey of participants) {
    const [pRole, pRawId] = String(pKey || '').split(':');
    const pActor = { key: pKey, role: pRole, id: Number(pRawId) };
    const canPreview = canActorPreviewDeletedMessage(pActor, conv, msg);
    const payload = {
      type: 'chat:message_deleted',
      conversation_id: Number(conv.id),
      message_id: Number(msg.id),
      hidden_for_self: Boolean(hideActorKey && hideActorKey === pKey)
    };
    if (canPreview) {
      payload.can_preview_deleted = true;
      payload.deleted_preview_body = typeof msg.deleted_original_body === 'string' ? msg.deleted_original_body : '';
      payload.deleted_preview_image = msg.deleted_original_image ? { ...msg.deleted_original_image } : null;
      payload.deleted_by_role = msg.deleted_by_role || msg.sender_role;
      payload.deleted_at = msg.deleted_at || null;
    }
    sendChatWsEvent(payload, [pKey]);
  }
}

function countUnreadForActor(conv, actorKey, allMessages) {
  const cursors = conv.read_cursors || {};
  const lastReadId = Number(cursors[actorKey] || 0);
  let unread = 0;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (Number(m.conversation_id) !== Number(conv.id)) continue;
    if (Number(m.id) <= lastReadId) break;
    if (isMessageHiddenForActor(m, actorKey)) continue;
    if (m.sender_key !== actorKey && !m.deleted) unread++;
  }
  return unread;
}

// ── Live Chat Group Auto Night/Morning Schedule (PKT Asia/Karachi) ─────────
const DEFAULT_GROUP_CLOSE_MSG = '🌙 Good Night everyone! Group chat is now closed for the night. Rest well and recharge — chat will automatically reopen in the morning. Take care! ✨';
const DEFAULT_GROUP_OPEN_MSG = '☀️ Assalam-o-Alaikum everyone! Good morning & welcome back. The group is now open — wishing you a smooth, productive, and successful day ahead! 🚀';
const SCHEDULE_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function getPktClockParts(nowDate = new Date()) {
  const pkt = new Date(nowDate.getTime() + PKT_OFFSET_MS_SHARED);
  const y = pkt.getUTCFullYear();
  const mo = pkt.getUTCMonth();
  const d = pkt.getUTCDate();
  const hh = pkt.getUTCHours();
  const mm = pkt.getUTCMinutes();
  const ss = pkt.getUTCSeconds();
  const pad = n => String(n).padStart(2, '0');
  const prev = new Date(pkt.getTime() - 86400000);
  const next = new Date(pkt.getTime() + 86400000);
  return {
    year: y,
    monthIdx: mo,
    day: d,
    ymd: `${y}-${pad(mo + 1)}-${pad(d)}`,
    prevYmd: `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`,
    nextYmd: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`,
    hour: hh,
    minute: mm,
    second: ss,
    minutesOfDay: hh * 60 + mm
  };
}

function pktYmdTimeToUtcMs(ymd, timeStr) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, 0) - PKT_OFFSET_MS_SHARED;
}

function normalizeGroupSchedule(raw, existing = null) {
  const prev = (existing && typeof existing === 'object') ? existing : {};
  if (!raw || typeof raw !== 'object') {
    return {
      enabled: Boolean(prev.enabled),
      close_time: SCHEDULE_TIME_RE.test(String(prev.close_time || '')) ? String(prev.close_time) : '23:00',
      open_time: SCHEDULE_TIME_RE.test(String(prev.open_time || '')) ? String(prev.open_time) : '09:00',
      close_message: String(prev.close_message || DEFAULT_GROUP_CLOSE_MSG).trim().slice(0, 500) || DEFAULT_GROUP_CLOSE_MSG,
      open_message: String(prev.open_message || DEFAULT_GROUP_OPEN_MSG).trim().slice(0, 500) || DEFAULT_GROUP_OPEN_MSG,
      timezone: 'Asia/Karachi',
      last_close_cycle: prev.last_close_cycle || null,
      last_open_cycle: prev.last_open_cycle || null
    };
  }
  const enabled = Boolean(raw.enabled);
  const close_time = String(raw.close_time !== undefined ? raw.close_time : (prev.close_time || '23:00')).trim();
  const open_time = String(raw.open_time !== undefined ? raw.open_time : (prev.open_time || '09:00')).trim();
  if (!SCHEDULE_TIME_RE.test(close_time) || !SCHEDULE_TIME_RE.test(open_time)) {
    return { error: 'Please choose valid Close and Open times (HH:MM format).' };
  }
  if (enabled && close_time === open_time) {
    return { error: 'Close time and Open time cannot be the same.' };
  }
  const close_message = String(raw.close_message !== undefined ? raw.close_message : (prev.close_message || DEFAULT_GROUP_CLOSE_MSG)).trim().slice(0, 500) || DEFAULT_GROUP_CLOSE_MSG;
  const open_message = String(raw.open_message !== undefined ? raw.open_message : (prev.open_message || DEFAULT_GROUP_OPEN_MSG)).trim().slice(0, 500) || DEFAULT_GROUP_OPEN_MSG;
  return {
    enabled,
    close_time,
    open_time,
    close_message,
    open_message,
    timezone: 'Asia/Karachi',
    last_close_cycle: prev.last_close_cycle || null,
    last_open_cycle: prev.last_open_cycle || null
  };
}

function evaluateGroupSchedule(schedule, nowDate = new Date()) {
  const norm = normalizeGroupSchedule(null, schedule);
  if (!norm.enabled) {
    return {
      enabled: false,
      is_closed: false,
      close_time: norm.close_time,
      open_time: norm.open_time,
      close_message: norm.close_message,
      open_message: norm.open_message,
      timezone: 'Asia/Karachi',
      reopen_at_iso: null,
      next_close_at_iso: null,
      remaining_seconds: 0,
      cycle_key: null
    };
  }

  const [ch, cm] = norm.close_time.split(':').map(Number);
  const [oh, om] = norm.open_time.split(':').map(Number);
  const closeMin = ch * 60 + cm;
  const openMin = oh * 60 + om;
  const clk = getPktClockParts(nowDate);
  const nowMin = clk.minutesOfDay;
  const nowMs = nowDate.getTime();

  let isClosed = false;
  let reopenMs = null;
  let nextCloseMs = null;
  let cycleKey = null;

  if (closeMin > openMin) {
    // Overnight schedule (e.g., 23:00 -> 09:00)
    if (nowMin >= closeMin) {
      isClosed = true;
      cycleKey = `close:${clk.ymd}:${norm.close_time}`;
      reopenMs = pktYmdTimeToUtcMs(clk.nextYmd, norm.open_time);
    } else if (nowMin < openMin) {
      isClosed = true;
      cycleKey = `close:${clk.prevYmd}:${norm.close_time}`;
      reopenMs = pktYmdTimeToUtcMs(clk.ymd, norm.open_time);
    } else {
      isClosed = false;
      cycleKey = `open:${clk.ymd}:${norm.open_time}`;
      nextCloseMs = pktYmdTimeToUtcMs(clk.ymd, norm.close_time);
    }
  } else {
    // Daytime schedule (e.g., 13:00 -> 15:00)
    if (nowMin >= closeMin && nowMin < openMin) {
      isClosed = true;
      cycleKey = `close:${clk.ymd}:${norm.close_time}`;
      reopenMs = pktYmdTimeToUtcMs(clk.ymd, norm.open_time);
    } else {
      isClosed = false;
      if (nowMin >= openMin) {
        cycleKey = `open:${clk.ymd}:${norm.open_time}`;
        nextCloseMs = pktYmdTimeToUtcMs(clk.nextYmd, norm.close_time);
      } else {
        cycleKey = `open:${clk.prevYmd}:${norm.open_time}`;
        nextCloseMs = pktYmdTimeToUtcMs(clk.ymd, norm.close_time);
      }
    }
  }

  return {
    enabled: true,
    is_closed: isClosed,
    close_time: norm.close_time,
    open_time: norm.open_time,
    close_message: norm.close_message,
    open_message: norm.open_message,
    timezone: 'Asia/Karachi',
    reopen_at_iso: reopenMs ? new Date(reopenMs).toISOString() : null,
    next_close_at_iso: nextCloseMs ? new Date(nextCloseMs).toISOString() : null,
    remaining_seconds: reopenMs ? Math.max(0, Math.floor((reopenMs - nowMs) / 1000)) : 0,
    cycle_key: cycleKey
  };
}

function processGroupSchedulesTick(nowDate = new Date()) {
  try {
    const convs = readDb('chat_conversations') || [];
    if (!convs.length) return false;
    let allMessages = null;
    let convsDirty = false;
    let msgsDirty = false;

    for (const conv of convs) {
      if (!conv || conv.type !== 'agent_group' || !conv.schedule || !conv.schedule.enabled) continue;
      const ev = evaluateGroupSchedule(conv.schedule, nowDate);
      if (!ev.enabled || !ev.cycle_key) continue;

      const shouldPostClose = ev.is_closed && conv.schedule.last_close_cycle !== ev.cycle_key;
      const shouldPostOpen = !ev.is_closed && conv.schedule.last_open_cycle !== ev.cycle_key;
      if (!shouldPostClose && !shouldPostOpen) continue;

      if (!allMessages) allMessages = readDb('chat_messages') || [];
      const agentKey = `agent:${Number(conv.owner_agent_id)}`;
      const adminSummary = resolveActorSummaryByKey(agentKey) || {
        key: agentKey,
        role: 'agent',
        display_name: 'Group Admin',
        username: 'Admin'
      };
      const nowIso = nowDate.toISOString();
      const autoType = shouldPostClose ? 'night_close' : 'morning_open';
      const body = shouldPostClose ? ev.close_message : ev.open_message;

      const msgRecord = {
        id: nextId(allMessages, 'chat_messages'),
        conversation_id: Number(conv.id),
        sender_key: adminSummary.key,
        sender_role: 'agent',
        sender_name: adminSummary.display_name || adminSummary.username || 'Group Admin',
        body,
        reply_to: null,
        deleted: false,
        is_auto_schedule: true,
        auto_type: autoType,
        created_at: nowIso
      };
      allMessages.push(msgRecord);
      msgsDirty = true;

      if (shouldPostClose) conv.schedule.last_close_cycle = ev.cycle_key;
      if (shouldPostOpen) conv.schedule.last_open_cycle = ev.cycle_key;

      if (!conv.read_cursors) conv.read_cursors = {};
      conv.read_cursors[adminSummary.key] = msgRecord.id;
      conv.last_message_id = msgRecord.id;
      conv.last_message_preview = body.slice(0, 120);
      conv.last_message_sender_key = adminSummary.key;
      conv.last_message_sender_name = msgRecord.sender_name;
      conv.last_message_at = nowIso;
      conv.updated_at = nowIso;
      convsDirty = true;

      sendChatWsEvent({
        type: 'chat:message',
        conversation_id: Number(conv.id),
        conversation_type: conv.type,
        conversation_title: conv.title,
        alert_priority: 'admin_alert',
        message: msgRecord
      }, conv.participants || []);

      sendChatWsEvent({
        type: 'chat:group_updated',
        conversation_id: Number(conv.id),
        schedule_changed: true,
        auto_type: autoType
      }, conv.participants || []);
    }

    if (msgsDirty && allMessages) writeDb('chat_messages', allMessages);
    if (convsDirty) writeDb('chat_conversations', convs);
    return convsDirty;
  } catch (err) {
    console.error('[CHAT-SCHEDULE] Tick error:', err);
    return false;
  }
}

function hydrateConversationForActor(conv, actor, allMessages) {
  const unread = countUnreadForActor(conv, actor.key, allMessages);
  const pinnedMsg = conv.pinned_message_id
    ? allMessages.find(m =>
        Number(m.conversation_id) === Number(conv.id) &&
        Number(m.id) === Number(conv.pinned_message_id) &&
        !m.deleted &&
        !isMessageHiddenForActor(m, actor.key)
      ) || null
    : null;

  let visibleLastMsg = null;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (Number(m.conversation_id) !== Number(conv.id)) continue;
    if (isMessageHiddenForActor(m, actor.key)) continue;
    visibleLastMsg = m;
    break;
  }

  let peer = null;
  let title = conv.title || '';
  if (conv.type === 'owner_agent' || conv.type === 'agent_client') {
    const otherKey = (conv.participants || []).find(k => k !== actor.key) || '';
    peer = resolveActorSummaryByKey(otherKey);
    title = (peer && (peer.display_name || peer.username)) || otherKey || 'Direct Chat';
  }

  const members = conv.type === 'agent_group'
    ? (conv.participants || []).map(k => resolveActorSummaryByKey(k)).filter(Boolean)
    : [];

  const scheduleNorm = conv.type === 'agent_group' ? normalizeGroupSchedule(null, conv.schedule) : null;
  const scheduleState = conv.type === 'agent_group' ? evaluateGroupSchedule(scheduleNorm) : null;
  const closedForMember = Boolean(conv.type === 'agent_group' && scheduleState && scheduleState.is_closed && actor.role !== 'agent');
  const adminOnlyLocked = Boolean(conv.type === 'agent_group' && conv.admin_only && actor.role !== 'agent');

  return {
    id: Number(conv.id),
    type: conv.type,
    owner_agent_id: conv.owner_agent_id ? Number(conv.owner_agent_id) : null,
    title,
    description: conv.description || '',
    participants: conv.participants || [],
    members,
    peer,
    admin_only: Boolean(conv.admin_only),
    schedule: scheduleNorm ? {
      enabled: scheduleNorm.enabled,
      close_time: scheduleNorm.close_time,
      open_time: scheduleNorm.open_time,
      close_message: scheduleNorm.close_message,
      open_message: scheduleNorm.open_message,
      timezone: scheduleNorm.timezone
    } : null,
    schedule_state: scheduleState,
    can_manage: conv.type === 'agent_group' && actor.role === 'agent' && Number(conv.owner_agent_id) === actor.id,
    can_send: !adminOnlyLocked && !closedForMember,
    lock_reason: closedForMember ? 'scheduled_closed' : (adminOnlyLocked ? 'admin_only' : null),
    pinned_message_id: pinnedMsg ? Number(pinnedMsg.id) : null,
    pinned_message: pinnedMsg ? {
      id: Number(pinnedMsg.id),
      sender_name: pinnedMsg.sender_name,
      sender_role: pinnedMsg.sender_role,
      body: pinnedMsg.image
        ? (pinnedMsg.body ? `📷 ${String(pinnedMsg.body).slice(0, 130)}` : '📷 Photo')
        : String(pinnedMsg.body || '').slice(0, 140),
      created_at: pinnedMsg.created_at
    } : null,
    read_cursors: conv.read_cursors || {},
    last_message_id: visibleLastMsg ? Number(visibleLastMsg.id) : 0,
    last_message_preview: visibleLastMsg ? formatMessagePreviewText(visibleLastMsg) : '',
    last_message_sender_key: visibleLastMsg ? (visibleLastMsg.sender_key || '') : '',
    last_message_sender_name: visibleLastMsg ? (visibleLastMsg.sender_name || '') : '',
    last_message_at: (visibleLastMsg && visibleLastMsg.created_at) || conv.last_message_at || conv.updated_at || conv.created_at,
    unread_count: unread,
    created_at: conv.created_at,
    updated_at: conv.updated_at
  };
}

// GET /api/chat/bootstrap — strictly scoped inbox + contacts + unread total
app.get('/api/chat/bootstrap', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  pruneExpiredChatMessages();
  processGroupSchedulesTick();

  const contacts = getAllowedChatContacts(actor);
  const allConvs = readDb('chat_conversations') || [];
  const allMessages = readDb('chat_messages') || [];

  const conversations = allConvs
    .filter(c => canAccessConversation(actor, c))
    .map(c => hydrateConversationForActor(c, actor, allMessages))
    .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));

  const total_unread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  res.json({
    me: actor,
    contacts,
    conversations,
    total_unread
  });
});

// POST /api/chat/direct — open or create a 1-to-1 direct conversation (strictly authorized)
app.post('/api/chat/direct', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  pruneExpiredChatMessages();

  const targetKey = String((req.body && req.body.target_key) || '').trim();
  const allowedContacts = getAllowedChatContacts(actor);
  const target = allowedContacts.find(c => c.key === targetKey);
  if (!target) {
    return res.status(403).json({ error: 'You are not allowed to start a direct chat with this user.' });
  }

  let convType = null;
  let ownerAgentId = null;
  if ((actor.role === 'owner' && target.role === 'agent') || (actor.role === 'agent' && target.role === 'owner')) {
    convType = 'owner_agent';
    ownerAgentId = actor.role === 'agent' ? actor.id : target.id;
  } else if ((actor.role === 'agent' && target.role === 'client') || (actor.role === 'client' && target.role === 'agent')) {
    convType = 'agent_client';
    ownerAgentId = actor.role === 'agent' ? actor.id : target.id;
  } else {
    return res.status(403).json({ error: 'Direct chat not permitted between these roles.' });
  }

  const convs = readDb('chat_conversations') || [];
  let conv = convs.find(c =>
    c.type === convType &&
    Array.isArray(c.participants) &&
    c.participants.length === 2 &&
    c.participants.includes(actor.key) &&
    c.participants.includes(target.key)
  );

  if (!conv) {
    const now = new Date().toISOString();
    conv = {
      id: nextId(convs, 'chat_conversations'),
      type: convType,
      owner_agent_id: ownerAgentId,
      title: '',
      description: '',
      participants: [actor.key, target.key],
      admin_only: false,
      pinned_message_id: null,
      read_cursors: { [actor.key]: 0, [target.key]: 0 },
      last_message_id: 0,
      last_message_preview: '',
      last_message_sender_key: '',
      last_message_sender_name: '',
      last_message_at: now,
      created_at: now,
      updated_at: now
    };
    convs.push(conv);
    writeDb('chat_conversations', convs);
  }

  const allMessages = readDb('chat_messages') || [];
  res.json({ conversation: hydrateConversationForActor(conv, actor, allMessages) });
});

// GET /api/chat/conversations/:id/messages — paginated messages + auto-mark-read
app.get('/api/chat/conversations/:id/messages', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  pruneExpiredChatMessages(true);
  processGroupSchedulesTick();

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied to this conversation.' });
  }

  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 100));
  const beforeId = Number(req.query.before_id || 0);
  const allMessages = readDb('chat_messages') || [];
  const convMsgs = allMessages.filter(m =>
    Number(m.conversation_id) === convId && !isMessageHiddenForActor(m, actor.key)
  );

  const filtered = beforeId > 0 ? convMsgs.filter(m => Number(m.id) < beforeId) : convMsgs;
  const page = filtered.slice(-limit).map(m => projectMessageForActor(m, actor, conv));
  const has_more = filtered.length > page.length;

  // Mark read up to latest visible message in this conversation
  const latestId = convMsgs.length ? Number(convMsgs[convMsgs.length - 1].id) : 0;
  if (latestId > 0) {
    if (!conv.read_cursors) conv.read_cursors = {};
    const prevRead = Number(conv.read_cursors[actor.key] || 0);
    if (latestId > prevRead) {
      conv.read_cursors[actor.key] = latestId;
      writeDb('chat_conversations', convs);
      sendChatWsEvent({
        type: 'chat:read',
        conversation_id: convId,
        actor_key: actor.key,
        last_read_id: latestId
      }, conv.participants);
    }
  }

  res.json({
    conversation: hydrateConversationForActor(conv, actor, allMessages),
    messages: page,
    has_more
  });
});

// POST /api/chat/conversations/:id/messages — send sanitized text/emoji/reply message
app.post('/api/chat/conversations/:id/messages', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  pruneExpiredChatMessages();
  processGroupSchedulesTick();

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied to this conversation.' });
  }

  // Enforce Admin-Only & Quiet Hours lock
  if (conv.type === 'agent_group') {
    if (conv.admin_only && actor.role !== 'agent') {
      return res.status(403).json({ error: 'Only your Agent (Group Admin) can send messages in this group.' });
    }
    const schedState = evaluateGroupSchedule(conv.schedule);
    if (schedState.enabled && schedState.is_closed && actor.role !== 'agent') {
      return res.status(403).json({
        error: `This group is currently closed for scheduled quiet hours and will reopen automatically at ${schedState.open_time} PKT.`
      });
    }
  }

  const rawBody = String((req.body && req.body.body) || '').trim();
  if (!rawBody) return res.status(400).json({ error: 'Message cannot be empty.' });
  const body = rawBody.slice(0, 2000);

  const allMessages = readDb('chat_messages') || [];
  let reply_to = null;
  const replyId = Number((req.body && req.body.reply_to_id) || 0);
  if (replyId > 0) {
    const targetMsg = allMessages.find(m => Number(m.id) === replyId && Number(m.conversation_id) === convId && !m.deleted);
    if (targetMsg) {
      const targetSnippet = targetMsg.image
        ? (targetMsg.body ? `📷 ${String(targetMsg.body).slice(0, 110)}` : '📷 Photo')
        : String(targetMsg.body || '').slice(0, 120);
      reply_to = {
        id: Number(targetMsg.id),
        sender_key: targetMsg.sender_key,
        sender_name: targetMsg.sender_name,
        body_snippet: targetSnippet
      };
    }
  }

  const now = new Date().toISOString();
  const msgRecord = {
    id: nextId(allMessages, 'chat_messages'),
    conversation_id: convId,
    sender_key: actor.key,
    sender_role: actor.role,
    sender_name: actor.display_name || actor.username,
    body,
    reply_to,
    deleted: false,
    created_at: now
  };
  allMessages.push(msgRecord);
  writeDb('chat_messages', allMessages);

  // Update conversation preview + sender read cursor
  if (!conv.read_cursors) conv.read_cursors = {};
  conv.read_cursors[actor.key] = msgRecord.id;
  conv.last_message_id = msgRecord.id;
  conv.last_message_preview = body.slice(0, 120);
  conv.last_message_sender_key = actor.key;
  conv.last_message_sender_name = msgRecord.sender_name;
  conv.last_message_at = now;
  conv.updated_at = now;
  writeDb('chat_conversations', convs);

  const alert_priority = computeChatAlertPriority(conv, actor.role);

  // Strictly broadcast ONLY to members of this conversation (NEVER leaks to Owner or other Agents)
  sendChatWsEvent({
    type: 'chat:message',
    conversation_id: convId,
    conversation_type: conv.type,
    conversation_title: conv.type === 'agent_group' ? conv.title : msgRecord.sender_name,
    alert_priority,
    message: msgRecord
  }, conv.participants);

  res.status(201).json({
    message: msgRecord,
    conversation: hydrateConversationForActor(conv, actor, allMessages)
  });
});

// ── Live Chat Fast Binary Image Upload & Authorized Media Serving ──
const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }
});

function detectChatImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { ext: 'png', mime: 'image/png' };
  }
  // WebP: RIFF....WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  // GIF: GIF87a / GIF89a
  const gifSig = buf.subarray(0, 6).toString('ascii');
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return { ext: 'gif', mime: 'image/gif' };
  }
  return null;
}

// POST /api/chat/conversations/:id/messages-media — 1-request fast binary photo send (+ optional caption/reply)
app.post('/api/chat/conversations/:id/messages-media', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  pruneExpiredChatMessages();
  processGroupSchedulesTick();

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied to this conversation.' });
  }
  if (conv.type === 'agent_group') {
    if (conv.admin_only && actor.role !== 'agent') {
      return res.status(403).json({ error: 'Only your Agent (Group Admin) can send messages in this group.' });
    }
    const schedState = evaluateGroupSchedule(conv.schedule);
    if (schedState.enabled && schedState.is_closed && actor.role !== 'agent') {
      return res.status(403).json({
        error: `This group is currently closed for scheduled quiet hours and will reopen automatically at ${schedState.open_time} PKT.`
      });
    }
  }

  chatImageUpload.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image too large (max 8 MB).' });
      }
      return res.status(400).json({ error: uploadErr.message || 'Image upload failed.' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please select a valid image file.' });
    }

    const detected = detectChatImageType(req.file.buffer);
    if (!detected) {
      return res.status(400).json({ error: 'Unsupported image format. Only JPG, PNG, WebP, or GIF allowed.' });
    }

    try {
      const convDir = path.join(CHAT_MEDIA_DIR, `c_${convId}`);
      await fs.promises.mkdir(convDir, { recursive: true });
      const fileName = `${Date.now().toString(36)}_${crypto.randomBytes(10).toString('hex')}.${detected.ext}`;
      const absTarget = path.join(convDir, fileName);
      await fs.promises.writeFile(absTarget, req.file.buffer);

      const rawBody = String((req.body && req.body.body) || '').trim();
      const body = rawBody.slice(0, 2000);
      const clientTempId = String((req.body && req.body.client_temp_id) || '').slice(0, 64) || null;
      const safeW = Math.max(0, Math.min(8000, Math.round(Number(req.body && req.body.width) || 0)));
      const safeH = Math.max(0, Math.min(8000, Math.round(Number(req.body && req.body.height) || 0)));

      const latestConvs = readDb('chat_conversations') || [];
      const latestConv = latestConvs.find(c => Number(c.id) === convId);
      if (!latestConv || !canAccessConversation(actor, latestConv)) {
        try { await fs.promises.unlink(absTarget); } catch (_) {}
        return res.status(403).json({ error: 'Conversation is no longer accessible.' });
      }

      const allMessages = readDb('chat_messages') || [];
      let reply_to = null;
      const replyId = Number((req.body && req.body.reply_to_id) || 0);
      if (replyId > 0) {
        const targetMsg = allMessages.find(m => Number(m.id) === replyId && Number(m.conversation_id) === convId && !m.deleted);
        if (targetMsg) {
          const targetSnippet = targetMsg.image
            ? (targetMsg.body ? `📷 ${String(targetMsg.body).slice(0, 110)}` : '📷 Photo')
            : String(targetMsg.body || '').slice(0, 120);
          reply_to = {
            id: Number(targetMsg.id),
            sender_key: targetMsg.sender_key,
            sender_name: targetMsg.sender_name,
            body_snippet: targetSnippet
          };
        }
      }

      const now = new Date().toISOString();
      const msgRecord = {
        id: nextId(allMessages, 'chat_messages'),
        conversation_id: convId,
        sender_key: actor.key,
        sender_role: actor.role,
        sender_name: actor.display_name || actor.username,
        body,
        image: {
          file: fileName,
          url: `/api/chat/conversations/${convId}/media/${fileName}`,
          mime: detected.mime,
          size: req.file.buffer.length,
          width: safeW || undefined,
          height: safeH || undefined
        },
        reply_to,
        deleted: false,
        created_at: now
      };
      allMessages.push(msgRecord);
      writeDb('chat_messages', allMessages);

      if (!latestConv.read_cursors) latestConv.read_cursors = {};
      latestConv.read_cursors[actor.key] = msgRecord.id;
      latestConv.last_message_id = msgRecord.id;
      latestConv.last_message_preview = body ? (`📷 ${body}`).slice(0, 120) : '📷 Photo';
      latestConv.last_message_sender_key = actor.key;
      latestConv.last_message_sender_name = msgRecord.sender_name;
      latestConv.last_message_at = now;
      latestConv.updated_at = now;
      writeDb('chat_conversations', latestConvs);

      const alert_priority = computeChatAlertPriority(latestConv, actor.role);
      sendChatWsEvent({
        type: 'chat:message',
        conversation_id: convId,
        conversation_type: latestConv.type,
        conversation_title: latestConv.type === 'agent_group' ? latestConv.title : msgRecord.sender_name,
        alert_priority,
        client_temp_id: clientTempId,
        message: msgRecord
      }, latestConv.participants);

      return res.status(201).json({
        message: msgRecord,
        conversation: hydrateConversationForActor(latestConv, actor, allMessages)
      });
    } catch (err) {
      console.error('[CHAT-MEDIA] Save error:', err);
      return res.status(500).json({ error: 'Failed to save image.' });
    }
  });
});

// GET /api/chat/conversations/:id/media/:file — strictly role- & conversation-authorized media download/view
app.get('/api/chat/conversations/:id/media/:file', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const convId = Number(req.params.id);
  const fileName = String(req.params.file || '');
  if (!Number.isFinite(convId) || convId <= 0 || !CHAT_MEDIA_FILE_RE.test(fileName)) {
    return res.status(400).json({ error: 'Invalid media request.' });
  }

  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied to this media.' });
  }

  // If media belongs to a soft-deleted message, restrict access strictly to authorized upline previewers
  const allMessages = readDb('chat_messages') || [];
  const deletedOwnerMsg = allMessages.find(m =>
    Number(m.conversation_id) === convId &&
    m.deleted &&
    m.deleted_original_image &&
    String(m.deleted_original_image.file) === fileName
  );
  if (deletedOwnerMsg && !canActorPreviewDeletedMessage(actor, conv, deletedOwnerMsg)) {
    return res.status(404).json({ error: 'Media not found.' });
  }

  const convDir = path.resolve(CHAT_MEDIA_DIR, `c_${convId}`);
  const absFile = path.resolve(convDir, fileName);
  if (!absFile.startsWith(convDir + path.sep) || !fs.existsSync(absFile)) {
    return res.status(404).json({ error: 'Media not found.' });
  }

  const ext = path.extname(fileName).toLowerCase();
  const mimeMap = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' };
  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  return res.sendFile(absFile);
});

// POST /api/chat/conversations/:id/read — mark conversation read
app.post('/api/chat/conversations/:id/read', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const latestId = Number((req.body && req.body.last_read_id) || conv.last_message_id || 0);
  if (!conv.read_cursors) conv.read_cursors = {};
  const prev = Number(conv.read_cursors[actor.key] || 0);
  if (latestId > prev) {
    conv.read_cursors[actor.key] = latestId;
    writeDb('chat_conversations', convs);
    sendChatWsEvent({
      type: 'chat:read',
      conversation_id: convId,
      actor_key: actor.key,
      last_read_id: latestId
    }, conv.participants);
  }
  res.json({ success: true, last_read_id: Number(conv.read_cursors[actor.key] || 0) });
});

// DELETE /api/chat/conversations/:id/messages/:msgId — soft delete by sender or Group Admin (upline retains audit preview)
app.delete('/api/chat/conversations/:id/messages/:msgId', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const convId = Number(req.params.id);
  const msgId = Number(req.params.msgId);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const allMessages = readDb('chat_messages') || [];
  const msg = allMessages.find(m => Number(m.id) === msgId && Number(m.conversation_id) === convId);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });

  const isGroupAdmin = conv.type === 'agent_group' && actor.role === 'agent' && Number(conv.owner_agent_id) === actor.id;
  if (msg.sender_key !== actor.key && !isGroupAdmin) {
    return res.status(403).json({ error: 'You can only delete your own messages.' });
  }

  const hideSelf = String(req.query.hide_self || '') === '1' || Boolean(req.body && req.body.hide_self);
  softDeleteChatMessageRecord(msg, actor, conv, hideSelf);
  writeDb('chat_messages', allMessages);
  writeDb('chat_conversations', convs);

  broadcastChatMessageDeleted(conv, msg, hideSelf ? actor.key : null);

  res.json({
    success: true,
    message_id: msgId,
    hidden_for_self: hideSelf,
    conversation: hydrateConversationForActor(conv, actor, allMessages)
  });
});

// POST /api/chat/conversations/:id/messages/bulk-delete — multi-select delete/hide for self (own messages soft-deleted with upline preview preserved)
app.post('/api/chat/conversations/:id/messages/bulk-delete', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const rawIds = Array.isArray(req.body && req.body.message_ids) ? req.body.message_ids : [];
  const targetIds = new Set(rawIds.map(x => Number(x)).filter(n => Number.isFinite(n) && n > 0));
  if (targetIds.size === 0) {
    return res.status(400).json({ error: 'Please select at least one message.' });
  }

  const allMessages = readDb('chat_messages') || [];
  const hiddenIds = [];
  const softDeletedMsgs = [];

  for (const msg of allMessages) {
    if (Number(msg.conversation_id) !== convId || !targetIds.has(Number(msg.id))) continue;
    if (!Array.isArray(msg.hidden_for)) msg.hidden_for = [];
    if (!msg.hidden_for.includes(actor.key)) {
      msg.hidden_for.push(actor.key);
    }
    hiddenIds.push(Number(msg.id));

    if (msg.sender_key === actor.key && !msg.deleted) {
      softDeleteChatMessageRecord(msg, actor, conv, true);
      softDeletedMsgs.push(msg);
    }
  }

  if (hiddenIds.length > 0) {
    writeDb('chat_messages', allMessages);
    writeDb('chat_conversations', convs);
    for (const msg of softDeletedMsgs) {
      broadcastChatMessageDeleted(conv, msg, actor.key);
    }
  }

  res.json({
    success: true,
    deleted_count: hiddenIds.length,
    hidden_ids: hiddenIds,
    soft_deleted_ids: softDeletedMsgs.map(m => Number(m.id)),
    conversation: hydrateConversationForActor(conv, actor, allMessages)
  });
});

// POST /api/chat/conversations/:id/clear-history — clears entire conversation history for caller's view ONLY (preserves history for upline/other participant)
app.post('/api/chat/conversations/:id/clear-history', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId);
  if (!conv || !canAccessConversation(actor, conv)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const allMessages = readDb('chat_messages') || [];
  let clearedCount = 0;
  for (const msg of allMessages) {
    if (Number(msg.conversation_id) !== convId) continue;
    if (!Array.isArray(msg.hidden_for)) msg.hidden_for = [];
    if (!msg.hidden_for.includes(actor.key)) {
      msg.hidden_for.push(actor.key);
      clearedCount++;
    }
  }

  if (clearedCount > 0) {
    writeDb('chat_messages', allMessages);
  }

  res.json({
    success: true,
    cleared_count: clearedCount,
    conversation: hydrateConversationForActor(conv, actor, allMessages)
  });
});

// ── Agent-Only Client Group Admin APIs ──────────────────────────
// POST /api/chat/groups — Agent creates a private Client Group (own clients ONLY)
app.post('/api/chat/groups', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor || actor.role !== 'agent') {
    return res.status(403).json({ error: 'Only Agents can create Client Groups.' });
  }

  const title = String((req.body && req.body.title) || '').trim().slice(0, 80);
  const description = String((req.body && req.body.description) || '').trim().slice(0, 240);
  const adminOnly = Boolean(req.body && req.body.admin_only);
  const rawMemberIds = Array.isArray(req.body && req.body.member_client_ids) ? req.body.member_client_ids : [];

  if (!title) return res.status(400).json({ error: 'Group name is required.' });

  const myClients = (readDb('clients') || []).filter(c => c && Number(c.agent_id) === actor.id && c.status !== 'deleted');
  const myClientIdSet = new Set(myClients.map(c => Number(c.id)));

  const participants = [actor.key];
  const seen = new Set(participants);
  for (const rawId of rawMemberIds) {
    const cid = Number(rawId);
    if (!myClientIdSet.has(cid)) {
      return res.status(403).json({ error: 'You can only add your own assigned clients to a group.' });
    }
    const ck = `client:${cid}`;
    if (!seen.has(ck)) {
      seen.add(ck);
      participants.push(ck);
    }
  }
  if (participants.length < 2) {
    return res.status(400).json({ error: 'Please select at least 1 of your clients.' });
  }

  const convs = readDb('chat_conversations') || [];
  const now = new Date().toISOString();
  const readCursors = {};
  participants.forEach(pk => { readCursors[pk] = 0; });

  let scheduleObj = normalizeGroupSchedule(null);
  if (req.body && req.body.schedule !== undefined) {
    const parsedSched = normalizeGroupSchedule(req.body.schedule, null);
    if (parsedSched.error) return res.status(400).json({ error: parsedSched.error });
    scheduleObj = parsedSched;
    if (scheduleObj.enabled) {
      const evInit = evaluateGroupSchedule(scheduleObj);
      if (!evInit.is_closed && evInit.cycle_key) {
        // Pre-mark current open cycle so creating an open-hours schedule does not immediately spam morning greeting
        scheduleObj.last_open_cycle = evInit.cycle_key;
      }
    }
  }

  const groupConv = {
    id: nextId(convs, 'chat_conversations'),
    type: 'agent_group',
    owner_agent_id: actor.id,
    title,
    description,
    participants,
    admin_only: adminOnly,
    schedule: scheduleObj,
    pinned_message_id: null,
    read_cursors: readCursors,
    last_message_id: 0,
    last_message_preview: 'Group created',
    last_message_sender_key: actor.key,
    last_message_sender_name: actor.display_name,
    last_message_at: now,
    created_at: now,
    updated_at: now
  };
  convs.push(groupConv);
  writeDb('chat_conversations', convs);

  if (scheduleObj.enabled) {
    processGroupSchedulesTick();
  }

  const freshConvs = readDb('chat_conversations') || convs;
  const freshGroup = freshConvs.find(c => Number(c.id) === Number(groupConv.id)) || groupConv;
  const allMessages = readDb('chat_messages') || [];
  const hydrated = hydrateConversationForActor(freshGroup, actor, allMessages);

  sendChatWsEvent({
    type: 'chat:group_created',
    conversation_id: freshGroup.id,
    title: freshGroup.title
  }, participants);

  res.status(201).json({ conversation: hydrated });
});

// PATCH /api/chat/groups/:id — Owning Agent updates title, description, or admin_only
app.patch('/api/chat/groups/:id', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor || actor.role !== 'agent') {
    return res.status(403).json({ error: 'Only the owning Agent can manage this group.' });
  }

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId && c.type === 'agent_group' && Number(c.owner_agent_id) === actor.id);
  if (!conv) return res.status(403).json({ error: 'Group not found or access denied.' });

  if (req.body && req.body.title !== undefined) {
    const t = String(req.body.title || '').trim().slice(0, 80);
    if (!t) return res.status(400).json({ error: 'Group name cannot be empty.' });
    conv.title = t;
  }
  if (req.body && req.body.description !== undefined) {
    conv.description = String(req.body.description || '').trim().slice(0, 240);
  }
  if (req.body && req.body.admin_only !== undefined) {
    conv.admin_only = Boolean(req.body.admin_only);
  }
  let scheduleUpdated = false;
  if (req.body && req.body.schedule !== undefined) {
    const prevSched = conv.schedule || null;
    const nextSched = normalizeGroupSchedule(req.body.schedule, prevSched);
    if (nextSched.error) return res.status(400).json({ error: nextSched.error });
    const timingChanged = !prevSched || prevSched.close_time !== nextSched.close_time || prevSched.open_time !== nextSched.open_time || (!prevSched.enabled && nextSched.enabled);
    if (nextSched.enabled && timingChanged) {
      const evNow = evaluateGroupSchedule(nextSched);
      if (!evNow.is_closed && evNow.cycle_key) {
        // Avoid firing an immediate morning greeting when admin configures schedule during daytime open hours
        nextSched.last_open_cycle = evNow.cycle_key;
        nextSched.last_close_cycle = null;
      } else {
        // Currently inside closed window: allow night message to post immediately once
        nextSched.last_close_cycle = null;
      }
    }
    conv.schedule = nextSched;
    scheduleUpdated = true;
  }
  conv.updated_at = new Date().toISOString();
  writeDb('chat_conversations', convs);

  if (scheduleUpdated && conv.schedule && conv.schedule.enabled) {
    processGroupSchedulesTick();
  }

  const freshConvs = readDb('chat_conversations') || convs;
  const freshConv = freshConvs.find(c => Number(c.id) === convId) || conv;
  const allMessages = readDb('chat_messages') || [];
  sendChatWsEvent({
    type: 'chat:group_updated',
    conversation_id: convId,
    title: freshConv.title,
    description: freshConv.description,
    admin_only: freshConv.admin_only,
    pinned_message_id: freshConv.pinned_message_id,
    schedule_changed: scheduleUpdated
  }, freshConv.participants);

  res.json({ conversation: hydrateConversationForActor(freshConv, actor, allMessages) });
});

// POST /api/chat/groups/:id/members — Owning Agent adds or removes own Clients
app.post('/api/chat/groups/:id/members', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor || actor.role !== 'agent') {
    return res.status(403).json({ error: 'Only the owning Agent can manage group members.' });
  }

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId && c.type === 'agent_group' && Number(c.owner_agent_id) === actor.id);
  if (!conv) return res.status(403).json({ error: 'Group not found or access denied.' });

  const myClients = (readDb('clients') || []).filter(c => c && Number(c.agent_id) === actor.id && c.status !== 'deleted');
  const myClientIdSet = new Set(myClients.map(c => Number(c.id)));

  const addIds = Array.isArray(req.body && req.body.add_client_ids) ? req.body.add_client_ids : [];
  const removeIds = Array.isArray(req.body && req.body.remove_client_ids) ? req.body.remove_client_ids : [];

  const partSet = new Set(conv.participants || [actor.key]);
  const addedKeys = [];
  for (const rawId of addIds) {
    const cid = Number(rawId);
    if (!myClientIdSet.has(cid)) {
      return res.status(403).json({ error: 'Cannot add a client that does not belong to you.' });
    }
    const ck = `client:${cid}`;
    if (!partSet.has(ck)) {
      partSet.add(ck);
      addedKeys.push(ck);
      if (!conv.read_cursors) conv.read_cursors = {};
      conv.read_cursors[ck] = Number(conv.last_message_id || 0);
    }
  }

  const removedKeys = [];
  for (const rawId of removeIds) {
    const cid = Number(rawId);
    const ck = `client:${cid}`;
    if (partSet.has(ck)) {
      partSet.delete(ck);
      removedKeys.push(ck);
    }
  }

  // Always keep owning Agent in the group
  partSet.add(actor.key);
  conv.participants = Array.from(partSet);
  conv.updated_at = new Date().toISOString();
  writeDb('chat_conversations', convs);

  if (removedKeys.length) {
    sendChatWsEvent({ type: 'chat:group_removed', conversation_id: convId }, removedKeys);
  }
  sendChatWsEvent({ type: 'chat:group_updated', conversation_id: convId }, conv.participants);

  const allMessages = readDb('chat_messages') || [];
  res.json({ conversation: hydrateConversationForActor(conv, actor, allMessages) });
});

// POST /api/chat/groups/:id/pin — Owning Agent pins or unpins a message
app.post('/api/chat/groups/:id/pin', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor || actor.role !== 'agent') {
    return res.status(403).json({ error: 'Only the owning Agent can pin messages.' });
  }

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const conv = convs.find(c => Number(c.id) === convId && c.type === 'agent_group' && Number(c.owner_agent_id) === actor.id);
  if (!conv) return res.status(403).json({ error: 'Group not found or access denied.' });

  const msgId = req.body && req.body.message_id ? Number(req.body.message_id) : null;
  const allMessages = readDb('chat_messages') || [];
  if (msgId) {
    const exists = allMessages.find(m => Number(m.id) === msgId && Number(m.conversation_id) === convId && !m.deleted);
    if (!exists) return res.status(404).json({ error: 'Message not found in this group.' });
    conv.pinned_message_id = msgId;
  } else {
    conv.pinned_message_id = null;
  }
  conv.updated_at = new Date().toISOString();
  writeDb('chat_conversations', convs);

  sendChatWsEvent({
    type: 'chat:group_updated',
    conversation_id: convId,
    pinned_message_id: conv.pinned_message_id
  }, conv.participants);

  res.json({ conversation: hydrateConversationForActor(conv, actor, allMessages) });
});

// DELETE /api/chat/groups/:id — Owning Agent deletes group
app.delete('/api/chat/groups/:id', requireAuth, (req, res) => {
  const actor = resolveLiveChatActor(req.sessionUser);
  if (!actor || actor.role !== 'agent') {
    return res.status(403).json({ error: 'Only the owning Agent can delete this group.' });
  }

  const convId = Number(req.params.id);
  const convs = readDb('chat_conversations') || [];
  const idx = convs.findIndex(c => Number(c.id) === convId && c.type === 'agent_group' && Number(c.owner_agent_id) === actor.id);
  if (idx === -1) return res.status(403).json({ error: 'Group not found or access denied.' });

  const removed = convs.splice(idx, 1)[0];
  writeDb('chat_conversations', convs);

  const allMessages = readDb('chat_messages') || [];
  const remaining = allMessages.filter(m => Number(m.conversation_id) !== convId);
  if (remaining.length !== allMessages.length) {
    writeDb('chat_messages', remaining);
  }
  try {
    const groupMediaDir = path.resolve(CHAT_MEDIA_DIR, `c_${convId}`);
    if (fs.existsSync(groupMediaDir)) fs.rmSync(groupMediaDir, { recursive: true, force: true });
  } catch (_) {}

  sendChatWsEvent({ type: 'chat:group_removed', conversation_id: convId }, removed.participants || []);
  res.json({ success: true, deleted_id: convId });
});

// ── WebSockets ────────────────────────────────────────────────

function getReqIp(req) {
  if (!req) return '127.0.0.1';
  if (req.ip) return req.ip;
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    return xff.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}

server.prependListener('upgrade', (req, socket) => {
  const ip = getReqIp(req);
  if (isIpBlocked(ip)) {
    logFirewallEvent(ip, 'WebSocket Handshake Blocked', req.url || '/ws');
    try {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
    } catch (_) {}
  }
});

const wsConnPerIp = new Map();
function wsOriginAllowed(req) {
  const origin = req && req.headers && req.headers.origin;
  if (!origin) return true; // non-browser clients
  try {
    const parsedHost = new URL(origin).host.toLowerCase();
    if (getEffectiveHosts(req).has(parsedHost)) return true;
  } catch (e) { return false; }
  return String(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).includes(origin.toLowerCase());
}
wss.on('connection', (ws, req) => {
  const ip = getReqIp(req);
  if (isIpBlocked(ip)) {
    logFirewallEvent(ip, 'WebSocket Blocked IP Attempt', '/ws');
    try { ws.close(1008, 'ip blocked'); } catch (e) { /* ignore */ }
    return;
  }
  const user = req ? getSessionUser(req) : null;
  if (!user || !wsOriginAllowed(req)) { try { ws.close(1008, 'unauthorized'); } catch (e) { /* ignore */ } return; }
  const open = wsConnPerIp.get(ip) || 0;
  if (open >= 10) { try { ws.close(1013, 'too many connections'); } catch (e) { /* ignore */ } return; }
  wsConnPerIp.set(ip, open + 1);

  const actor = resolveLiveChatActor(user);
  const actorKey = actor ? actor.key : chatActorKey(user.role, user.id);

  // The live-feed routing in broadcastWs relies on this (Owner: all; others: only their own id)
  ws.user = {
    id: user.id,
    role: user.role,
    username: user.username,
    agent_id: actor ? actor.agent_id : (user.agent_id || null),
    actor_key: actorKey
  };

  // Live Chat presence tracking (strictly scoped to allowed peers)
  const prevOnlineCount = CHAT_ONLINE_COUNTS.get(actorKey) || 0;
  CHAT_ONLINE_COUNTS.set(actorKey, prevOnlineCount + 1);
  if (prevOnlineCount === 0 && actor) {
    const audience = getPresenceAudienceKeys(actor);
    sendChatWsEvent({ type: 'chat:presence', actor_key: actorKey, online: true, last_seen: null }, audience);
  }

  const now = new Date().toISOString();
  ws.send(JSON.stringify({ type: 'connected', time: now, timestamp: now, actor_key: actorKey }));

  // Live Chat inbound WebSocket signals (typing & read receipts)
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw || ''));
      if (!msg || typeof msg !== 'object') return;
      const curActor = resolveLiveChatActor(user);
      if (!curActor) return;

      if (msg.type === 'chat:typing') {
        const convId = Number(msg.conversation_id);
        const convs = readDb('chat_conversations') || [];
        const conv = convs.find(c => Number(c.id) === convId);
        if (!conv || !canAccessConversation(curActor, conv)) return;
        if (conv.type === 'agent_group' && conv.admin_only && curActor.role !== 'agent') return;
        const others = (conv.participants || []).filter(k => k !== curActor.key);
        sendChatWsEvent({
          type: 'chat:typing',
          conversation_id: convId,
          actor_key: curActor.key,
          sender_name: curActor.display_name || curActor.username,
          is_typing: Boolean(msg.is_typing)
        }, others);
        return;
      }

      if (msg.type === 'chat:read') {
        const convId = Number(msg.conversation_id);
        const lastReadId = Number(msg.last_read_id || 0);
        if (!convId || !lastReadId) return;
        const convs = readDb('chat_conversations') || [];
        const conv = convs.find(c => Number(c.id) === convId);
        if (!conv || !canAccessConversation(curActor, conv)) return;
        if (!conv.read_cursors) conv.read_cursors = {};
        if (lastReadId > Number(conv.read_cursors[curActor.key] || 0)) {
          conv.read_cursors[curActor.key] = lastReadId;
          writeDb('chat_conversations', convs);
          sendChatWsEvent({
            type: 'chat:read',
            conversation_id: convId,
            actor_key: curActor.key,
            last_read_id: lastReadId
          }, conv.participants);
        }
      }
    } catch (_) { /* ignore malformed ws frames */ }
  });

  ws.on('error', () => { /* ignore unhandled socket drops */ });
  const interval = setInterval(() => {
    if (ws.readyState === 1) {
      const ts = new Date().toISOString();
      const live = liveTrafficStats();
      const cachedLog = DB_CACHE.get('sms_log');
      const totalCount = Array.isArray(cachedLog) ? cachedLog.length : (readDb('sms_log') || []).length;
      ws.send(JSON.stringify({
        type: 'heartbeat',
        time: ts,
        timestamp: ts,
        mps: live.mps,
        total: totalCount,
        success_rate: live.success_rate,
        dlr: live.dlr
      }));
    }
  }, 3000);
  ws.on('close', () => {
    clearInterval(interval);
    wsConnPerIp.set(ip, Math.max(0, (wsConnPerIp.get(ip) || 1) - 1));
    const nextOnlineCount = Math.max(0, (CHAT_ONLINE_COUNTS.get(actorKey) || 1) - 1);
    if (nextOnlineCount === 0) {
      CHAT_ONLINE_COUNTS.delete(actorKey);
      const seenTs = new Date().toISOString();
      CHAT_LAST_SEEN.set(actorKey, seenTs);
      const curActor = resolveLiveChatActor(user);
      if (curActor) {
        const audience = getPresenceAudienceKeys(curActor);
        sendChatWsEvent({ type: 'chat:presence', actor_key: actorKey, online: false, last_seen: seenTs }, audience);
      }
    } else {
      CHAT_ONLINE_COUNTS.set(actorKey, nextOnlineCount);
    }
  });
});

// ── Read-Only Owner Orphans Report (Fix 12) ───────────────────
app.get('/api/reports/orphans', requireAuth, (req, res) => {
  const sessionUser = req.sessionUser;
  const sRole = (sessionUser.role || '').toLowerCase();
  const isOwner = sRole === 'owner' || sRole === 'admin';
  if (!isOwner) {
    return res.status(403).json({ error: 'Forbidden. Owner permissions required.' });
  }

  const agents = readDb('agents') || [];
  const clients = readDb('clients') || [];
  const numbers = readDb('numbers') || [];

  const agentIds = new Set(agents.map(a => Number(a.id)));
  const clientIds = new Set(clients.map(c => Number(c.id)));

  const orphanedClients = clients.filter(c => {
    return c.agent_id && !agentIds.has(Number(c.agent_id));
  });
  const orphanedNumbers = numbers.filter(n => {
    const hasMissingClient = n.client_id && !clientIds.has(Number(n.client_id));
    const hasMissingAgent = n.agent_id && !agentIds.has(Number(n.agent_id));
    return hasMissingClient || hasMissingAgent;
  });

  res.json({
    success: true,
    summary: {
      orphaned_clients_count: orphanedClients.length,
      orphaned_numbers_count: orphanedNumbers.length
    },
    orphaned_clients: orphanedClients.map(safeUser),
    orphaned_numbers: orphanedNumbers
  });
});

// ── CRITICAL: Safe API 404 handler (Must ALWAYS return JSON, never HTML) ─────
app.all(['/api/*', '/crapi/*'], (req, res) => {
  console.warn(`[404 NOT FOUND] ${req.method} ${req.originalUrl || req.url || req.path}`);
  res.status(404).json({ error: 'Endpoint not found', path: req.path, method: req.method });
});

// Fallback for HTML routing
app.use((req, res) => {
  if (req.accepts('html')) {
    sendInjectedHtml(res, path.join(STATIC_DIR, 'index.html'), req);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Centralized JSON error handler (prevents unhandled PayloadTooLargeError / SyntaxError HTML dumps)
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    return res.status(413).json({
      error: 'Request payload is too large. Please upload a smaller batch or split the file.',
      code: 'PAYLOAD_TOO_LARGE'
    });
  }
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({
      error: 'Invalid JSON request payload.',
      code: 'INVALID_JSON'
    });
  }
  console.error('[EXPRESS ERROR]', err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  return res.status(err.status || err.statusCode || 500).json({
    error: 'Internal server error'
  });
});

// ── Read-Only Orphaned Numbers Check (Fix 12: Do NOT delete automatically) ──
function cleanupOrphanedNumbers() {
  try {
    const ranges = readDb('sms_ranges') || [];
    if (!Array.isArray(ranges) || ranges.length === 0) return;
    const validRangeIds = new Set(ranges.map(r => Number(r.id)));
    const numbers = readDb('numbers') || [];
    if (!Array.isArray(numbers) || numbers.length === 0) return;
    const orphanCount = numbers.filter(n => n.range_id && !validRangeIds.has(Number(n.range_id))).length;
    if (orphanCount > 0) {
      console.log(`[Audit Check] Notice: ${orphanCount} number(s) reference non-existent ranges (read-only audit, preserved).`);
    }
  } catch (err) {
    console.error('cleanupOrphanedNumbers error:', err);
  }
}

const BIND_HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, BIND_HOST, () => {
  runPaytermMigration();
  seedOwnershipLedgerIfEmpty();
  cleanupOrphanedNumbers();
  scanInactiveNumbers();
  const inactivityScanTimer = setInterval(() => scanInactiveNumbers(), 5 * 60 * 1000);
  if (inactivityScanTimer && typeof inactivityScanTimer.unref === 'function') inactivityScanTimer.unref();
  processGroupSchedulesTick();
  const groupSchedTimer = setInterval(() => processGroupSchedulesTick(), 15000);
  if (groupSchedTimer && typeof groupSchedTimer.unref === 'function') groupSchedTimer.unref();
  pruneExpiredChatMessages(true);
  const chatRetentionTimer = setInterval(() => pruneExpiredChatMessages(true), 15 * 60 * 1000);
  if (chatRetentionTimer && typeof chatRetentionTimer.unref === 'function') chatRetentionTimer.unref();
  console.log(`[HUMEX SMS] Server running on http://${BIND_HOST}:${PORT}`);
  console.log(`  ➜  Local:   http://localhost:${PORT}/`);
  console.log(`  ➜  Network: http://${BIND_HOST}:${PORT}/`);
});
