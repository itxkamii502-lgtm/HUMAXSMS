// Whitenoise Provider Integration + Permission-Gated CDR 2 + Monthly (30/5) {W} Tests
import http from 'http';
import { makeFixture, startServer, check, summary, readJson, fs, sleep } from './lib.js';

const MOCK_PORT = 4411;
const TEST_PORT = 4412;

const recordedConversions = [];
const recordedSmsFetches = [];
let mockMessagesByPhone = {};
let mockHtmlRows = [];

const mockWnServer = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  let rawBody = '';
  req.on('data', chunk => { rawBody += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) {}

    if (urlObj.pathname === '/sms/get-phone-last-sms' && req.method === 'POST') {
      const phone = String(body.phone || '').replace(/^\+/, '');
      recordedSmsFetches.push({ phone: String(body.phone || ''), body, apiKey: req.headers['x-api-key'] || '' });
      const sms = mockMessagesByPhone[String(body.phone || '')] || mockMessagesByPhone[phone] || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sms }));
      return;
    }

    if (urlObj.pathname === '/sms/get-phone-sms-count' && req.method === 'POST') {
      const phone = String(body.phone || '').replace(/^\+/, '');
      const sms = mockMessagesByPhone[String(body.phone || '')] || mockMessagesByPhone[phone] || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', count: sms.length }));
      return;
    }

    if (urlObj.pathname === '/sms/register-sms-conversion' && req.method === 'POST') {
      recordedConversions.push({
        sms_id: body.sms_id,
        phone: body.phone,
        service_name: body.service_name || '',
        api_key: req.headers['x-api-key'] || ''
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', conversion: true }));
      return;
    }

    if (urlObj.pathname === '/web/sms' && req.method === 'GET') {
      const trs = mockHtmlRows.map((r, idx) =>
        `<tr><td>${idx + 1}</td><td>${r.service || r.src}</td><td>${r.src}</td><td>${r.dst}</td><td>smsc-1</td><td>${r.text}</td><td>Whitenoise</td><td>${r.time}</td><td>${r.time}</td></tr>`
      ).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><table><thead><tr><th>#</th><th>Service</th><th>Source</th><th>Destination</th><th>SMSC</th><th>Text</th><th>Provider</th><th>Time sent</th><th>Time received</th></tr></thead><tbody>${trs}</tbody></table></body></html>`);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
});

await new Promise(resolve => mockWnServer.listen(MOCK_PORT, '127.0.0.1', resolve));

const dir = makeFixture();
const srv = await startServer(dir, TEST_PORT);

try {
  // 1. Login as Owner and create Whitenoise connection
  const own = await srv.login('Kamran_Bhatti', 'ownerpass1');
  check('Owner login succeeds', own.ok);

  const wnSecretKey = 'wn_secret_key_123456';
  const wnWebCookie = 'wn_session=secret_cookie_val_999';
  const createConn = await srv.api('POST', '/api/whitenoise-connections', {
    cookie: own.cookie,
    body: {
      name: 'Whitenoise Main',
      mode: 'hybrid',
      api_key: wnSecretKey,
      web_cookie: wnWebCookie,
      base_url: `http://127.0.0.1:${MOCK_PORT}`,
      web_url: `http://127.0.0.1:${MOCK_PORT}/web`,
      provider_tag: 'Whitenoise',
      conversion_mode: 'on_client_match',
      interval: 10,
      concurrency: 4
    }
  });
  check('Owner creates Whitenoise connection (200)', createConn.status === 200 && !!createConn.data?.id);
  const connId = createConn.data?.id;

  // Check secret masking on GET
  const listConns = await srv.api('GET', '/api/whitenoise-connections', { cookie: own.cookie });
  const rawConnJson = JSON.stringify(listConns.data);
  check('GET /api/whitenoise-connections masks api_key and omits web_cookie secret',
    listConns.status === 200 &&
    !rawConnJson.includes(wnSecretKey) &&
    !rawConnJson.includes(wnWebCookie) &&
    listConns.data?.data?.[0]?.has_api_key === true &&
    listConns.data?.data?.[0]?.has_web_cookie === true
  );

  // Non-Owner cannot access whitenoise connections
  const ag1Init = await srv.login('agent_one', 'agentpass1');
  const agBlocked = await srv.api('GET', '/api/whitenoise-connections', { cookie: ag1Init.cookie });
  check('Agent blocked (403) from /api/whitenoise-connections', agBlocked.status === 403);

  // 2. Create a Whitenoise SMS Range & verify Monthly (30/5) {W} forced lock even if Weekly sent
  const wnRangeRes = await srv.api('POST', '/api/numbers/sms-ranges', {
    cookie: own.cookie,
    body: {
      range_name: 'UK Whitenoise Test',
      country: 'United Kingdom',
      provider: 'Whitenoise',
      prefix: '44',
      payterm: 'Weekly',
      payout: 0.02,
      cost: 0.04,
      currency: 'USD'
    }
  });
  check('Owner creates Whitenoise range and backend forces Monthly (30/5) {W} payterm',
    wnRangeRes.status === 200 &&
    wnRangeRes.data?.payterm === 'Monthly' &&
    wnRangeRes.data?.payout_schedule === 'monthly30_5' &&
    wnRangeRes.data?.cycle_days === 30 &&
    wnRangeRes.data?.hold_days === 5 &&
    wnRangeRes.data?.is_whitenoise === true
  );
  const wnRangeId = wnRangeRes.data?.id;

  // Create Whitenoise numbers (agent_only: 447700100001 for agent_one; client_matched: 447700100002 for agent_one -> client_one; unassigned: 447700100003; agent_two pool: 447700100004)
  const addNums = await srv.api('POST', '/api/numbers/import-to-range', {
    cookie: own.cookie,
    body: {
      numbers: ['447700100001', '447700100002', '447700100003', '447700100004'].join('\n'),
      range_id: wnRangeId
    }
  });
  check('Bulk add Whitenoise numbers succeeds', addNums.status === 200 && addNums.data?.imported === 4);

  const allNumsRes = await srv.api('GET', '/api/numbers?limit=200', { cookie: own.cookie });
  const wnNums = (allNumsRes.data?.data || []).filter(n => String(n.provider || '').toLowerCase().includes('whitenoise'));
  const numAgPool = wnNums.find(n => n.number === '447700100001');
  const numClient = wnNums.find(n => n.number === '447700100002');
  const numUnassigned = wnNums.find(n => n.number === '447700100003');
  const numAg2 = wnNums.find(n => n.number === '447700100004');
  check('Whitenoise numbers auto-tagged Monthly (30/5) {W} on creation',
    Boolean(numAgPool && numClient && numUnassigned && numAg2 && numClient.payterm === 'Monthly' && numClient.payout_schedule === 'monthly30_5')
  );

  // Assign WN numbers BEFORE enabling whitenoise_access -> should be blocked (403)
  const assignAg1Blocked = await srv.api('POST', '/api/numbers/bulk-assign-many', {
    cookie: own.cookie,
    body: {
      number_ids: [numAgPool.id, numClient.id],
      target_type: 'agent',
      target_id: 1,
      payterm: 'Weekly',
      agent_rate: 0.02
    }
  });
  check('Owner blocked (403) from assigning Whitenoise numbers to Agent without whitenoise_access', assignAg1Blocked.status === 403);

  // 3. Test Permission Matrix BEFORE enabling whitenoise_access
  const meAg1Before = await srv.api('GET', '/api/auth/me', { cookie: ag1Init.cookie });
  check('Default agent_one has whitenoise_access=false in /api/auth/me',
    meAg1Before.status === 200 && meAg1Before.data?.whitenoise_access === false
  );

  const cdr2Ag1Denied = await srv.api('GET', '/api/cdr2/logs', { cookie: ag1Init.cookie });
  const syncAg1Denied = await srv.api('POST', '/api/cdr2/sync', { cookie: ag1Init.cookie, body: {} });
  const fetchAg1Denied = await srv.api('POST', `/api/numbers/${numAgPool.id}/whitenoise-fetch`, { cookie: ag1Init.cookie, body: {} });
  check('Non-WN Agent gets 403 on /api/cdr2/logs, /api/cdr2/sync, and /api/numbers/:id/whitenoise-fetch',
    cdr2Ag1Denied.status === 403 && syncAg1Denied.status === 403 && fetchAg1Denied.status === 403
  );

  const rangesAg1Hidden = await srv.api('GET', '/api/numbers/sms-ranges', { cookie: ag1Init.cookie });
  const wnRangesHiddenForAg1 = (Array.isArray(rangesAg1Hidden.data) ? rangesAg1Hidden.data : (rangesAg1Hidden.data?.data || []))
    .filter(r => String(r.provider || '').toLowerCase().includes('whitenoise'));
  check('Non-WN Agent cannot see Whitenoise ranges in /api/numbers/sms-ranges', wnRangesHiddenForAg1.length === 0);

  // Test Client inheritance rule: Client whitenoise_access=true (set by owning Agent) while Parent Agent whitenoise_access=false -> still denied!
  await srv.api('PATCH', '/api/clients/1', { cookie: ag1Init.cookie, body: { whitenoise_access: true } });
  const cl1 = await srv.login('client_one', 'clientpass1');
  const meCl1NoParent = await srv.api('GET', '/api/auth/me', { cookie: cl1.cookie });
  const cdr2Cl1NoParent = await srv.api('GET', '/api/cdr2/logs', { cookie: cl1.cookie });
  check('Client with whitenoise_access=true whose parent Agent lacks access is still denied (parent inheritance)',
    meCl1NoParent.data?.whitenoise_access === false && cdr2Cl1NoParent.status === 403
  );

  // 4. Enable whitenoise_access for agent_one ONLY (agent_two stays false), then agent_one enables client_one
  const patchAg1 = await srv.api('PATCH', '/api/agents/1', { cookie: own.cookie, body: { whitenoise_access: true } });
  check('Owner enables whitenoise_access on agent_one', patchAg1.status === 200 && patchAg1.data?.whitenoise_access === true);
  await srv.api('PATCH', '/api/clients/1', { cookie: ag1Init.cookie, body: { whitenoise_access: true } });

  const meAg1After = await srv.api('GET', '/api/auth/me', { cookie: ag1Init.cookie });
  const meCl1AfterParent = await srv.api('GET', '/api/auth/me', { cookie: cl1.cookie });
  check('agent_one & client_one now report whitenoise_access=true live in /api/auth/me',
    meAg1After.data?.whitenoise_access === true && meCl1AfterParent.data?.whitenoise_access === true
  );

  // Owner now assigns numAgPool & numClient to agent_one (with Weekly attempted -> backend forces Monthly10)
  const assignAg1 = await srv.api('POST', '/api/numbers/bulk-assign-many', {
    cookie: own.cookie,
    body: {
      number_ids: [numAgPool.id, numClient.id],
      target_type: 'agent',
      target_id: 1,
      payterm: 'Weekly',
      agent_rate: 0.02
    }
  });
  check('Owner assigning Whitenoise numbers to permitted agent_one succeeds', assignAg1.status === 200);

  // Assigning numAg2 to agent_two (no whitenoise_access) remains blocked (403)
  const assignAg2Blocked = await srv.api('POST', '/api/numbers/bulk-assign-many', {
    cookie: own.cookie,
    body: { number_ids: [numAg2.id], target_type: 'agent', target_id: 3, payterm: 'Weekly', agent_rate: 0.02 }
  });
  check('Owner blocked (403) from assigning Whitenoise number to non-WN agent_two', assignAg2Blocked.status === 403);

  // client_two (under agent_one) still has whitenoise_access=false -> denied!
  const cl2 = await srv.login('client_two', 'clientpass2');
  const cdr2Cl2Denied = await srv.api('GET', '/api/cdr2/logs', { cookie: cl2.cookie });
  check('WN Agent + Non-WN Client (client_two) is still denied (403) from CDR 2', cdr2Cl2Denied.status === 403);

  // agent_two still lacks whitenoise_access -> denied!
  const ag2 = await srv.login('agent_two', 'agentpass3');
  const cdr2Ag2Denied = await srv.api('GET', '/api/cdr2/logs', { cookie: ag2.cookie });
  check('Non-WN Agent (agent_two) still gets 403 on CDR 2', cdr2Ag2Denied.status === 403);

  // 5. Agent_one configures PKR Client Rate & assigns numClient to client_one -> Monthly (30/5) {W} forced even if client_payterm='Weekly'
  const setRate = await srv.api('PUT', '/api/agent/client-rates', {
    cookie: ag1Init.cookie,
    body: { range_id: wnRangeId, client_rate_pkr: 3.5, allowed_quantities: [25, 50], published: true }
  });
  check('WN Agent sets Client PKR rate for Whitenoise range', setRate.status === 200);

  const assignToCl1WeeklyBad = await srv.api('POST', '/api/numbers/bulk-assign-many', {
    cookie: ag1Init.cookie,
    body: {
      number_ids: [numClient.id],
      target_type: 'client',
      target_id: 1,
      client_payterm: 'Weekly',
      payterm: 'Weekly'
    }
  });
  check('Weekly payterm is strictly rejected (400) on Whitenoise number allocation to client_one', assignToCl1WeeklyBad.status === 400);

  const assignToCl1 = await srv.api('POST', '/api/numbers/bulk-assign-many', {
    cookie: ag1Init.cookie,
    body: {
      number_ids: [numClient.id],
      target_type: 'client',
      target_id: 1,
      client_payterm: 'Monthly'
    }
  });
  check('Agent allocates Whitenoise number to client_one', assignToCl1.status === 200);
  const numsAfterClAssign = readJson(dir, 'numbers');
  const updatedNumCl = numsAfterClAssign.find(x => Number(x.id) === Number(numClient.id));
  check('Monthly (30/5) {W} stamped on Whitenoise number allocation to client_one',
    updatedNumCl && updatedNumCl.payterm === 'Monthly' && updatedNumCl.client_payterm === 'Monthly' && updatedNumCl.payout_schedule === 'monthly30_5'
  );

  // 6. Populate Mock Whitenoise API & test pull + conditional conversions + deduplication
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  mockMessagesByPhone = {
    '447700100001': [
      { id: 1001, src: 'Google', dst: '447700100001', text: 'Your Google code is 111222', time: nowStr, country: 'UK', service_name: 'Google' }
    ],
    '447700100002': [
      { id: 1002, src: 'WhatsApp', dst: '447700100002', text: 'WhatsApp code: 987-654', time: nowStr, country: 'UK', service_name: 'WhatsApp' }
    ],
    '447700100003': [
      { id: 1003, src: 'Telegram', dst: '447700100003', text: 'Telegram OTP: 555000', time: nowStr, country: 'UK', service_name: 'Telegram' }
    ]
  };

  // Owner pulls via test-number for all 3 numbers
  await srv.api('POST', `/api/whitenoise-connections/${connId}/test-number`, { cookie: own.cookie, body: { phone: '447700100001' } });
  await srv.api('POST', `/api/whitenoise-connections/${connId}/test-number`, { cookie: own.cookie, body: { phone: '447700100002' } });
  await srv.api('POST', `/api/whitenoise-connections/${connId}/test-number`, { cookie: own.cookie, body: { phone: '447700100003' } });
  await sleep(150);

  // Verify conversion registered ONLY for client-matched number 447700100002 (sms_id: 1002)!
  check('Conditional conversion (on_client_match) fires ONLY for client-assigned number (sms_id=1002)',
    recordedConversions.length === 1 &&
    Number(recordedConversions[0].sms_id) === 1002 &&
    String(recordedConversions[0].phone || '').replace(/^\+/, '') === '447700100002'
  );

  // Verify deduplication: pulling 447700100002 again creates 0 new SMS and 0 extra conversion
  const dupTest = await srv.api('POST', `/api/whitenoise-connections/${connId}/test-number`, { cookie: own.cookie, body: { phone: '447700100002' } });
  await sleep(100);
  check('Duplicate Whitenoise SMS id is deduplicated cleanly (new_sms === 0, no duplicate conversion)',
    dupTest.status === 200 && dupTest.data?.new_sms === 0 && recordedConversions.length === 1
  );

  // 7. Test CDR 2 isolation & role scoping + Client PKR + Live Fetch OTP
  const cdr2Owner = await srv.api('GET', '/api/cdr2/logs', { cookie: own.cookie });
  const cdr2Agent1 = await srv.api('GET', '/api/cdr2/logs', { cookie: ag1Init.cookie });
  const cdr2Client1 = await srv.api('GET', '/api/cdr2/logs', { cookie: cl1.cookie });

  check('Owner CDR 2 sees all 3 Whitenoise SMS with Monthly (30/5) {W} payterm',
    cdr2Owner.status === 200 &&
    (cdr2Owner.data?.data || []).length === 3 &&
    (cdr2Owner.data?.data || []).every(s => s.payterm === 'Monthly' && s.payout_schedule === 'monthly30_5')
  );

  check('agent_one CDR 2 sees ONLY its 2 Whitenoise SMS (447700100001 & 447700100002, not unassigned 447700100003)',
    cdr2Agent1.status === 200 &&
    (cdr2Agent1.data?.data || []).length === 2
  );

  check('client_one CDR 2 sees ONLY its 1 Whitenoise SMS (447700100002) with client_amount_pkr = 3.5',
    cdr2Client1.status === 200 &&
    (cdr2Client1.data?.data || []).length === 1 &&
    Number(cdr2Client1.data?.data?.[0]?.client_amount_pkr) === 3.5 &&
    Number(cdr2Client1.data?.summary?.client_payout_pkr) === 3.5
  );

  // Verify Standard CDR (/api/sms/logs) does NOT leak into or break from CDR 2, and CDR 2 excludes non-Whitenoise SMS
  // Insert a regular non-Whitenoise inbound SMS
  await srv.api('POST', '/api/inbound', {
    headers: { 'X-Inbound-Token': 'inbound-secret' },
    body: { sender: 'PayPal', number: '233500000005', message: 'PayPal OTP 4455', sms_id: 'reg-1' }
  });
  const cdr2AfterReg = await srv.api('GET', '/api/cdr2/logs', { cookie: own.cookie });
  check('CDR 2 strictly excludes non-Whitenoise SMS (remains 3 records)',
    (cdr2AfterReg.data?.data || []).length === 3
  );

  // Test Client live Fetch OTP on owned number (success) vs unowned number (403)
  mockMessagesByPhone['447700100002'].push({
    id: 1004, src: 'Signal', dst: '447700100002', text: 'Signal code: 332211', time: nowStr, country: 'UK', service_name: 'Signal'
  });
  const clFetchOwned = await srv.api('POST', `/api/numbers/${numClient.id}/whitenoise-fetch`, { cookie: cl1.cookie, body: {} });
  const clFetchOther = await srv.api('POST', `/api/numbers/${numAgPool.id}/whitenoise-fetch`, { cookie: cl1.cookie, body: {} });
  await sleep(100);
  check('Client can Fetch OTP on own Whitenoise number (new_sms=1) and is blocked (403) on unowned number',
    clFetchOwned.status === 200 && clFetchOwned.data?.new_sms === 1 && clFetchOther.status === 403
  );

  // Verify Client /api/payments includes Monthly (30/5) {W} schedule metadata, hold_summary & whitenoise_access
  const clPayments = await srv.api('GET', '/api/payments', { cookie: cl1.cookie });
  check('Client /api/payments includes monthly30_5 schedule metadata, hold_summary & whitenoise_access=true',
    clPayments.status === 200 &&
    clPayments.data?.whitenoise_access === true &&
    Boolean(clPayments.data?.monthly30_5?.next_release_date) &&
    Boolean(clPayments.data?.hold_summary)
  );

  // Test Hybrid Mode B web HTML pull
  mockHtmlRows = [
    { time: nowStr, dst: '447700100002', src: 'Meta', text: 'Meta verification code: 778899' }
  ];
  const pullRes = await srv.api('POST', `/api/whitenoise-connections/${connId}/pull`, { cookie: own.cookie, body: {} });
  check('Owner manual pull (hybrid Mode B HTML) succeeds and ingests Web SMS',
    pullRes.status === 200 && pullRes.data?.success === true
  );
  const cdr2AfterPull = await srv.api('GET', '/api/cdr2/logs', { cookie: cl1.cookie });
  check('Client CDR 2 includes SMS from both Mode A API (2) and Mode B HTML feed (1)',
    (cdr2AfterPull.data?.data || []).length >= 3
  );

  // Test CSV export on /api/cdr2/export
  const expCl1 = await srv.api('GET', '/api/cdr2/export?export=csv', { cookie: cl1.cookie });
  check('/api/cdr2/export returns 200 CSV for permitted client',
    expCl1.status === 200 && typeof expCl1.data === 'string' && expCl1.data.includes('447700100002')
  );

  // Test Client POST /api/cdr2/sync requires a special number (400 if empty), while Agent/Owner auto-pool sync works with {}
  const syncCl1Empty = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: {} });
  const syncAg1Pool = await srv.api('POST', '/api/cdr2/sync', { cookie: ag1Init.cookie, body: {} });
  const syncOwnPool = await srv.api('POST', '/api/cdr2/sync', { cookie: own.cookie, body: {} });
  check('Client POST /api/cdr2/sync requires special number (400 if empty), while Agent & Owner auto-pool sync succeeds (200)',
    syncCl1Empty.status === 400 &&
    syncAg1Pool.status === 200 && syncAg1Pool.data?.success === true &&
    syncOwnPool.status === 200 && syncOwnPool.data?.success === true
  );

  // 8. Country-code-optional & plus-optional targeted live sync (+44..., 44..., 0044..., 077..., 77...) & 403 unowned
  mockMessagesByPhone['447700100002'].push({
    id: 1005, src: 'Apple', dst: '447700100002', text: 'Apple ID code: 441199', time: nowStr, country: 'UK', service_name: 'Apple'
  });
  const syncNoCc = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '07700100002' } });
  const syncWithPlus = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '+447700100002' } });
  const syncPlainCc = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '447700100002' } });
  const syncZeroZero = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '00447700100002' } });
  const syncBare = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '7700100002' } });
  const syncUnowned = await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '447700100001' } });
  check('Client live sync works in all formats (without CC, with CC, with +, 00-prefix, bare) and blocks unowned (403)',
    syncNoCc.status === 200 &&
    syncNoCc.data?.new_sms === 1 &&
    Array.isArray(syncNoCc.data?.matched_numbers) &&
    syncNoCc.data.matched_numbers.includes('447700100002') &&
    syncWithPlus.status === 200 && syncWithPlus.data?.matched_numbers?.includes('447700100002') &&
    syncPlainCc.status === 200 && syncPlainCc.data?.matched_numbers?.includes('447700100002') &&
    syncZeroZero.status === 200 && syncZeroZero.data?.matched_numbers?.includes('447700100002') &&
    syncBare.status === 200 && syncBare.data?.matched_numbers?.includes('447700100002') &&
    syncUnowned.status === 403
  );

  // 8b. Agent/Owner missing-number sync on Client's assigned number propagates to Client's CDR 2 Show Report
  mockMessagesByPhone['447700100002'].push({
    id: 10055, src: 'TikTok', dst: '447700100002', text: 'TikTok code: 553311', time: nowStr, country: 'UK', service_name: 'TikTok'
  });
  const agSyncClientMissing = await srv.api('POST', '/api/cdr2/sync', { cookie: ag1Init.cookie, body: { number: '7700100002' } });
  const clReportAfterAgSync = await srv.api('GET', '/api/cdr2/logs?number=7700100002', { cookie: cl1.cookie });
  const foundTikTok = (clReportAfterAgSync.data?.data || []).find(r => String(r.message || '').includes('553311'));
  check('Agent syncing missing Client number (without CC) immediately delivers SMS into Client CDR 2 Show Report with PKR payout',
    agSyncClientMissing.status === 200 &&
    agSyncClientMissing.data?.new_sms === 1 &&
    Boolean(foundTikTok) &&
    Number(foundTikTok.client_id) === 1 &&
    Number(foundTikTok.client_amount_pkr) > 0
  );

  // 9. Strict non-Owner privacy: Owner sees Whitenoise; Agent & Client MUST NOT see "whitenoise" in visible provider/range/source/CSV
  const clRangesRes = await srv.api('GET', '/api/numbers/sms-ranges', { cookie: cl1.cookie });
  const clNumsRes = await srv.api('GET', `/api/numbers?client_id=1`, { cookie: cl1.cookie });
  const agNumsRes = await srv.api('GET', `/api/numbers?agent_id=1`, { cookie: ag1Init.cookie });
  const cdr2OwnerJson = JSON.stringify(cdr2Owner.data || {});
  const visFieldsLeak = (arr) => (arr || []).some(x => {
    const s = [x.provider, x.company, x.panel_name, x.source, x.range_name, x.range_label, x.range, x.name].filter(Boolean).join(' ').toLowerCase();
    return s.includes('whitenoise');
  });
  const expCl1Clean = await srv.api('GET', '/api/cdr2/export?export=csv', { cookie: cl1.cookie });
  const expAg1Clean = await srv.api('GET', '/api/cdr2/export?export=csv', { cookie: ag1Init.cookie });
  check('Strict provider privacy: Owner sees Whitenoise while Agent & Client responses/CSVs never leak "whitenoise"',
    cdr2OwnerJson.toLowerCase().includes('whitenoise') &&
    !visFieldsLeak(cdr2Agent1.data?.data) &&
    !visFieldsLeak(cdr2Client1.data?.data) &&
    !visFieldsLeak(clNumsRes.data?.data) &&
    !visFieldsLeak(agNumsRes.data?.data) &&
    !visFieldsLeak(Array.isArray(clRangesRes.data) ? clRangesRes.data : clRangesRes.data?.data) &&
    typeof expCl1Clean.data === 'string' && !expCl1Clean.data.toLowerCase().includes('whitenoise') &&
    typeof expAg1Clean.data === 'string' && !expAg1Clean.data.toLowerCase().includes('whitenoise')
  );

  // 10. Assigned Date stamp verification
  check('Number assignment stamps assigned_at & assigned_date on number record',
    Boolean(updatedNumCl?.assigned_at && updatedNumCl?.assigned_date)
  );

  // 11. Admin Monthly Cycle Window config + clears_at + /api/payments cycle metadata
  const todayYmd = new Date().toISOString().slice(0, 10);
  const startYmd = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const endYmd = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  const clearYmd = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10);
  const mcPost = await srv.api('POST', '/api/monthly-cycle', {
    cookie: own.cookie,
    body: { start_date: startYmd, end_date: endYmd, clear_date: clearYmd }
  });
  check('Owner configures Admin Monthly Cycle Window (POST /api/monthly-cycle)',
    mcPost.status === 200 &&
    mcPost.data?.monthly_cycle?.start_date === startYmd &&
    mcPost.data?.monthly_cycle?.end_date === endYmd &&
    mcPost.data?.monthly_cycle?.clear_date === clearYmd
  );

  mockMessagesByPhone['447700100002'].push({
    id: 1006, src: 'Uber', dst: '447700100002', text: 'Uber code: 771122', time: `${todayYmd} 12:00:00`, country: 'UK', service_name: 'Uber'
  });
  await srv.api('POST', '/api/cdr2/sync', { cookie: cl1.cookie, body: { number: '7700100002' } });
  const clPayAfterMc = await srv.api('GET', '/api/payments', { cookie: cl1.cookie });
  const ownLogsAfterMc = await srv.api('GET', '/api/cdr2/logs?limit=50', { cookie: own.cookie });
  const uberSms = (ownLogsAfterMc.data?.data || []).find(s => Number(s.whitenoise_sms_id) === 1006 || String(s.message || '').includes('771122'));
  check('Monthly Cycle window stamps clears_at on new CDR 2 SMS and reflects in /api/payments',
    Boolean(uberSms && String(uberSms.clears_at || '').startsWith(clearYmd)) &&
    clPayAfterMc.status === 200 &&
    clPayAfterMc.data?.monthly_cycle?.clear_date === clearYmd &&
    clPayAfterMc.data?.monthly30_5?.clear_date === clearYmd &&
    Number(clPayAfterMc.data?.monthly30_5?.held_pkr || 0) > 0
  );
} finally {
  await srv.stop();
  mockWnServer.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

if (!summary('Whitenoise Integration')) {
  process.exit(1);
}
