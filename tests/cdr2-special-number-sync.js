// Focused Integration & UI Test: Whitenoise CDR 2 Dedicated Special Number Sync Box & Owner/Agent -> Client Flow
import http from 'http';
import fs from 'fs';
import path from 'path';
import { makeFixture, startServer, check, summary, sleep } from './lib.js';

const MOCK_PORT = 4439;
const TEST_PORT = 4440;

const mockMessagesByPhone = {
  '447700100002': [],
  '447700100001': []
};

const mockWnServer = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  let rawBody = '';
  req.on('data', chunk => { rawBody += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) {}
    if (urlObj.pathname === '/sms/get-phone-last-sms' && req.method === 'POST') {
      const phone = String(body.phone || '').replace(/^\+/, '');
      const sms = mockMessagesByPhone[String(body.phone || '')] || mockMessagesByPhone[phone] || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sms }));
      return;
    }
    if (urlObj.pathname === '/sms/register-sms-conversion' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', conversion: true }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
});

await new Promise(resolve => mockWnServer.listen(MOCK_PORT, '127.0.0.1', resolve));

const today = new Date().toISOString().slice(0, 10);
const nowStr = `${today} 12:15:00`;

const dir = makeFixture({
  agents: [
    { id: 1, username: 'agent_one', password: 'agentpass1', role: 'Agent', status: 'active', balance: 0, whitenoise_access: true, created: `${today}T00:00:00.000Z` }
  ],
  clients: [
    { id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', balance: 0, balance_pkr: 0, whitenoise_access: true, created: `${today}T00:00:00.000Z` }
  ],
  sms_ranges: [
    {
      id: 1,
      range_name: 'UK Whitenoise Special',
      name: 'UK Whitenoise Special',
      country: 'United Kingdom',
      provider: 'Whitenoise',
      prefix: '44',
      payterm: 'Monthly',
      payout_schedule: 'monthly30_5',
      cycle_days: 30,
      hold_days: 5,
      is_whitenoise: true,
      cost: 0.04,
      payout: 0.02,
      currency: 'USD'
    }
  ],
  numbers: [
    {
      id: 1,
      number: '447700100001',
      country: 'United Kingdom',
      provider: 'Whitenoise',
      prefix: '44',
      range_id: 1,
      range_name: 'UK Whitenoise Special',
      status: 'active',
      agent_id: 1,
      client_id: null,
      payterm: 'Monthly',
      payout_schedule: 'monthly30_5',
      is_whitenoise: true,
      created: `${today}T00:00:00.000Z`
    },
    {
      id: 2,
      number: '447700100002',
      country: 'United Kingdom',
      provider: 'Whitenoise',
      prefix: '44',
      range_id: 1,
      range_name: 'UK Whitenoise Special',
      status: 'active',
      // Intentionally omit agent_id to verify Agent still scopes their Client's number!
      agent_id: null,
      client_id: 1,
      user: 'client_one',
      client_rate_pkr: 5.5,
      payterm: 'Monthly',
      payout_schedule: 'monthly30_5',
      is_whitenoise: true,
      created: `${today}T00:00:00.000Z`
    }
  ],
  whitenoise_connections: [
    {
      id: 1,
      name: 'WN Test Mock',
      mode: 'api',
      api_key: 'mock_key_123',
      base_url: `http://127.0.0.1:${MOCK_PORT}`,
      provider_tag: 'Whitenoise',
      conversion_mode: 'on_client_match',
      status: 'active',
      interval: 600,
      client_interval_sec: 600,
      pool_interval_sec: 600,
      concurrency: 2,
      created: `${today}T00:00:00.000Z`
    }
  ]
});

const srv = await startServer(dir, TEST_PORT);

try {
  const own = await srv.login('owner', 'ownerpass1');
  const ag1 = await srv.login('agent_one', 'agentpass1');
  const cl1 = await srv.login('client_one', 'clientpass1');

  // 1. Client empty POST /api/cdr2/sync MUST return 400 (requires special number)
  const clEmpty = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: {} });
  check('Client POST /api/cdr2/sync without number returns 400 with clear prompt',
    clEmpty.status === 400 && /phone number/i.test(String(clEmpty.data?.error || ''))
  );

  // 2. Owner auto-pool sync pulls Client's assigned number & SMS shows in Client's Show Report
  mockMessagesByPhone['447700100002'].push({
    id: 9001, src: 'WhatsApp', dst: '447700100002', text: 'Owner-pool code: 112233', time: nowStr, country: 'UK', service_name: 'WhatsApp'
  });
  const ownPool = await srv.api('POST', '/api/cdr2/sync', { cookie: own.cookie, body: {} });
  const clLogs1 = await srv.api('GET', '/api/cdr2/logs', { cookie: cl1.cookie });
  const sms1 = (clLogs1.data?.data || []).find(r => String(r.message || '').includes('112233'));
  check('Owner auto-pool sync pulls SMS for Client number and delivers it to Client CDR 2 Show Report',
    ownPool.status === 200 && ownPool.data?.new_sms === 1 && Boolean(sms1) && Number(sms1.client_id) === 1 && Number(sms1.client_amount_pkr) === 5.5
  );

  // 3. Agent auto-pool sync scopes BOTH Agent pool & Client-assigned numbers (even when agent_id is null on number record)
  const agPool = await srv.api('POST', '/api/cdr2/sync', { cookie: ag1.cookie, body: {} });
  check('Agent auto-pool sync succeeds and includes Client-assigned numbers (total_scoped_numbers=2)',
    agPool.status === 200 && agPool.data?.success === true && Number(agPool.data?.total_scoped_numbers) === 2
  );

  // 4. Agent special-number sync for missing Client number (without country code, bypasses cooldown) delivers to Client Show Report
  mockMessagesByPhone['447700100002'].push({
    id: 9003, src: 'Signal', dst: '447700100002', text: 'Agent-special code: 778899', time: nowStr, country: 'UK', service_name: 'Signal'
  });
  const agSpecial = await srv.api('POST', '/api/cdr2/sync', { cookie: ag1.cookie, body: { number: '7700100002' } });
  const clLogs3 = await srv.api('GET', '/api/cdr2/logs?number=7700100002', { cookie: cl1.cookie });
  const sms3 = (clLogs3.data?.data || []).find(r => String(r.message || '').includes('778899'));
  check('Agent special-number sync (without country code) pulls missing Client SMS into Client Show Report',
    agSpecial.status === 200 && agSpecial.data?.new_sms === 1 && Boolean(sms3) && Number(sms3.client_id) === 1
  );

  // 5. Client special-number sync works in ALL 5 formats (+CC, CC, 00CC, 0-local, bare local) and blocks unowned (403)
  const formats = ['+447700100002', '447700100002', '00447700100002', '07700100002', '7700100002'];
  let allFormatsOk = true;
  for (let i = 0; i < formats.length; i++) {
    const code = 300001 + i;
    mockMessagesByPhone['447700100002'].push({
      id: 9100 + i, src: 'TestSvc', dst: '447700100002', text: `Format test ${formats[i]}: ${code}`, time: nowStr, country: 'UK', service_name: 'TestSvc'
    });
    const r = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: formats[i] } });
    if (r.status !== 200 || r.data?.new_sms !== 1 || !r.data?.matched_numbers?.includes('447700100002')) {
      allFormatsOk = false;
    }
  }
  const clUnowned = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '+447700100001' } });
  check('Client special-number sync succeeds for all 5 formats (+CC, CC, 00CC, 0-local, bare) and blocks unowned (403)',
    allFormatsOk && clUnowned.status === 403
  );

  // 6. Client CDR 2 GET /api/cdr2/logs matches special number filter in all formats
  const clQPlus = await srv.api('GET', `/api/cdr2/logs?number=${encodeURIComponent('+447700100002')}`, { cookie: cl1.cookie });
  const clQBare = await srv.api('GET', `/api/cdr2/logs?number=${encodeURIComponent('7700100002')}`, { cookie: cl1.cookie });
  const clQZero = await srv.api('GET', `/api/cdr2/logs?number=${encodeURIComponent('07700100002')}`, { cookie: cl1.cookie });
  check('Client Show Report (?number=) returns all 7 synced messages across +CC, bare, and 0-local formats',
    (clQPlus.data?.data || []).length === 7 &&
    (clQBare.data?.data || []).length === 7 &&
    (clQZero.data?.data || []).length === 7
  );

  // 7. Static UI verification across Owner, Agent, Client CDR 2
  const root = process.cwd();
  const ownerJs = fs.readFileSync(path.join(root, 'humex-sms/static/js/owner-shell.js'), 'utf8');
  const agentJs = fs.readFileSync(path.join(root, 'humex-sms/static/js/agent-pages.js'), 'utf8');
  const clientJs = fs.readFileSync(path.join(root, 'humex-sms/static/js/client-pages.js'), 'utf8');
  check('Owner, Agent, and Client CDR 2 each have separate #cdr2-sync-number box & #btn-sync-cdr2-number distinct from #cdr2-search',
    ownerJs.includes('id="cdr2-sync-number"') && ownerJs.includes('id="btn-sync-cdr2-number"') && ownerJs.includes('id="cdr2-search"') &&
    agentJs.includes('id="cdr2-sync-number"') && agentJs.includes('id="btn-sync-cdr2-number"') && agentJs.includes('id="cdr2-search"') &&
    clientJs.includes('id="cdr2-sync-number"') && clientJs.includes('id="btn-sync-cdr2-number"') && clientJs.includes('id="cdr2-search"')
  );

  await sleep(50);
} finally {
  await srv.stop();
  mockWnServer.close();
}

process.exit(summary('CDR 2 Special Number Sync & Auto-Poll Propagation') ? 0 : 1);
