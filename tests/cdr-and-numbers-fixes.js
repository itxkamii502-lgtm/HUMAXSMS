// Integration & Regression Tests: CDR Column Cleanup (no Type/IP), >10,000 Numbers & CDR Pagination, and Owner My Numbers Filtering
import fs from 'fs';
import path from 'path';
import { makeFixture, startServer, check, summary } from './lib.js';

const TEST_PORT = 4431;
const TOTAL_NUMS = 12500;
const TOTAL_SMS = 11200;
const today = new Date().toISOString().slice(0, 10);

const numbersFixture = [];
for (let i = 1; i <= TOTAL_NUMS; i++) {
  const isRange2 = i > 7000;
  const isNoRangeIdFallback = i === 6999; // Range 1 matched by range_name only
  const isAgent1Direct = i >= 1 && i <= 200;
  const isClient1OnlyNoAgentField = i >= 201 && i <= 250; // client_id: 1 (under agent 1), agent_id: null
  const isClient2 = i >= 251 && i <= 300;
  const isInactive = i === 12499;
  numbersFixture.push({
    id: i,
    number: String(447000000000 + i),
    country: isRange2 ? 'UK' : 'Ghana',
    provider: isRange2 ? 'Vodafone' : 'Orange',
    prefix: isRange2 ? '44' : '233',
    range_id: isNoRangeIdFallback ? null : (isRange2 ? 2 : 1),
    range_name: isRange2 ? 'UK Vodafone NS1' : 'Ghana Orange NS2',
    status: isInactive ? 'inactive' : 'active',
    agent_id: isAgent1Direct ? 1 : (isClient2 ? 2 : null),
    client_id: isClient1OnlyNoAgentField ? 1 : (isClient2 ? 2 : null),
    user: isClient1OnlyNoAgentField ? 'client_one' : (isClient2 ? 'client_two' : ''),
    created: `${today}T00:00:00.000Z`
  });
}

const smsFixture = [];
for (let i = 1; i <= TOTAL_SMS; i++) {
  const sec = String(i % 60).padStart(2, '0');
  const min = String(Math.floor(i / 60) % 60).padStart(2, '0');
  const hr = String(Math.floor(i / 3600) % 24).padStart(2, '0');
  const numIdx = (i % 120) + 1;
  const isAgent1 = i <= 6000;
  const isClient1 = i <= 3000;
  smsFixture.push({
    id: i,
    timestamp: `${today} ${hr}:${min}:${sec}`,
    date: today,
    provider: 'Orange',
    range_id: 1,
    range_name: 'Ghana Orange NS2',
    country: 'Ghana',
    type: 'General',
    number: String(447000000000 + numIdx),
    cli: 'WhatsApp',
    message: `Your OTP code is ${100000 + (i % 899999)}`,
    agent_id: isAgent1 ? 1 : 2,
    agent: isAgent1 ? 'agent_one' : 'agent_two',
    client_id: isClient1 ? 1 : 2,
    client: isClient1 ? 'client_one' : 'client_two',
    currency: 'USD',
    company_rate: 0.02,
    agent_payout: 0.015,
    client_payout: 0.01,
    client_amount_pkr: 3.0,
    owner_amount: 0.005,
    agent_amount: 0.005,
    status: 'delivered',
    cause: 'Success',
    ip: '203.0.113.77'
  });
}

const dir = makeFixture({
  sms_ranges: [
    { id: 1, range_name: 'Ghana Orange NS2', name: 'Ghana Orange NS2', country: 'Ghana', provider: 'Orange', prefix: '233', cost: 0.02, payout: 0.015, currency: 'USD' },
    { id: 2, range_name: 'UK Vodafone NS1', name: 'UK Vodafone NS1', country: 'UK', provider: 'Vodafone', prefix: '44', cost: 0.03, payout: 0.02, currency: 'USD' }
  ],
  agents: [
    { id: 1, username: 'agent_one', password: 'agentpass1', role: 'Agent', status: 'active', balance: 50, created: `${today}T00:00:00.000Z` },
    { id: 2, username: 'agent_two', password: 'agentpass2', role: 'Agent', status: 'active', balance: 20, created: `${today}T00:00:00.000Z` }
  ],
  clients: [
    { id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', balance: 10, balance_pkr: 2800, created: `${today}T00:00:00.000Z` },
    { id: 2, username: 'client_two', password: 'clientpass2', role: 'Client', agent_id: 2, status: 'active', balance: 10, balance_pkr: 2800, created: `${today}T00:00:00.000Z` }
  ],
  numbers: numbersFixture,
  sms_log: smsFixture
});

const srv = await startServer(dir, TEST_PORT);

try {
  const own = await srv.login('owner', 'ownerpass1');
  const ag1 = await srv.login('agent_one', 'agentpass1');
  const cl1 = await srv.login('client_one', 'clientpass1');

  // ── 1. Numbers >10,000 cap removed & true server-side pagination ──
  const page1 = await srv.api('GET', '/api/numbers?page=1&limit=25', { cookie: own.cookie });
  check('Numbers page 1 returns total=12500, total_pages=500, 25 rows',
    page1.status === 200 &&
    page1.data.total === TOTAL_NUMS &&
    page1.data.total_pages === 500 &&
    page1.data.page === 1 &&
    page1.data.data.length === 25
  );

  const page500 = await srv.api('GET', '/api/numbers?page=500&limit=25', { cookie: own.cookie });
  check('Numbers page 500 reaches records past 10,000 (number #12500 present)',
    page500.status === 200 &&
    page500.data.data.length === 25 &&
    page500.data.data.some(n => n.id === TOTAL_NUMS && n.number === String(447000000000 + TOTAL_NUMS))
  );

  const over10k = await srv.api('GET', '/api/numbers?limit=15000', { cookie: own.cookie });
  check('Numbers limit=15000 is NOT clamped to 10,000 (returns all 12,500)',
    over10k.status === 200 && over10k.data.data.length === TOTAL_NUMS && over10k.data.total === TOTAL_NUMS
  );

  // ── 2. Server-side Owner My Numbers Filters ──
  const r1 = await srv.api('GET', '/api/numbers?range=1&limit=25', { cookie: own.cookie });
  check('Range=1 filter returns all 7,000 Range 1 numbers (incl. range_name fallback)',
    r1.status === 200 && r1.data.total === 7000
  );

  const r2 = await srv.api('GET', '/api/numbers?range=2&limit=25', { cookie: own.cookie });
  check('Range=2 filter returns all 5,500 Range 2 numbers',
    r2.status === 200 && r2.data.total === 5500
  );

  const agFilter = await srv.api('GET', '/api/numbers?agent_id=1&limit=25', { cookie: own.cookie });
  check('Agent=1 filter matches 200 direct + 50 via client_one (total=250)',
    agFilter.status === 200 && agFilter.data.total === 250
  );

  const clFilter = await srv.api('GET', '/api/numbers?client_id=1&limit=25', { cookie: own.cookie });
  check('Client=1 filter matches exact 50 client_one numbers',
    clFilter.status === 200 && clFilter.data.total === 50
  );

  const stFree = await srv.api('GET', '/api/numbers?status=unassigned&limit=25', { cookie: own.cookie });
  check('Status=unassigned returns exact 12,200 Master Pool (free) numbers',
    stFree.status === 200 && stFree.data.total === (TOTAL_NUMS - 300)
  );

  const stAssigned = await srv.api('GET', '/api/numbers?status=assigned&limit=25', { cookie: own.cookie });
  check('Status=assigned returns exact 300 assigned numbers',
    stAssigned.status === 200 && stAssigned.data.total === 300
  );

  const stInactive = await srv.api('GET', '/api/numbers?status=inactive&limit=25', { cookie: own.cookie });
  check('Status=inactive returns exact 1 inactive number',
    stInactive.status === 200 && stInactive.data.total === 1 && stInactive.data.data[0].id === 12499
  );

  const searchNum = await srv.api('GET', `/api/numbers?search=${447000000000 + 12345}&limit=25`, { cookie: own.cookie });
  check('Search finds number #12345 (beyond 10,000)',
    searchNum.status === 200 && searchNum.data.total === 1 && searchNum.data.data[0].id === 12345
  );

  const searchAgent = await srv.api('GET', '/api/numbers?search=agent_one&limit=25', { cookie: own.cookie });
  check('Search by agent username returns matching numbers',
    searchAgent.status === 200 && searchAgent.data.total === 200
  );

  // ── 3. CDR >10,000 Pagination, Grouped Pagination, and NO IP / Type exposure ──
  const cdrPage1 = await srv.api('GET', `/api/sms/logs?date_from=${today} 00:00:00&date_to=${today} 23:59:59&page=1&limit=25`, { cookie: own.cookie });
  check('Owner CDR page 1 returns total=11200, total_pages=448, and strips ip field',
    cdrPage1.status === 200 &&
    cdrPage1.data.total === TOTAL_SMS &&
    cdrPage1.data.total_pages === 448 &&
    cdrPage1.data.data.length === 25 &&
    cdrPage1.data.data.every(r => !('ip' in r))
  );

  const cdrAll = await srv.api('GET', `/api/sms/logs?date_from=${today} 00:00:00&date_to=${today} 23:59:59&limit=all`, { cookie: own.cookie });
  check('Owner CDR limit=all returns ALL 11,200 rows (no 10,000 truncation)',
    cdrAll.status === 200 && cdrAll.data.data.length === TOTAL_SMS && cdrAll.data.total === TOTAL_SMS
  );

  const cdrGrpP1 = await srv.api('GET', `/api/sms/logs?date_from=${today} 00:00:00&date_to=${today} 23:59:59&group_by=number&page=1&limit=25`, { cookie: own.cookie });
  const cdrGrpP2 = await srv.api('GET', `/api/sms/logs?date_from=${today} 00:00:00&date_to=${today} 23:59:59&group_by=number&page=2&limit=25`, { cookie: own.cookie });
  const g1Nums = new Set((cdrGrpP1.data.data || []).map(g => g.number));
  const g2Nums = (cdrGrpP2.data.data || []).map(g => g.number);
  check('Grouped CDR paginates across 120 groups (page 1 & page 2 distinct, total_pages=5)',
    cdrGrpP1.status === 200 &&
    cdrGrpP1.data.total === 120 &&
    cdrGrpP1.data.total_pages === 5 &&
    cdrGrpP1.data.data.length === 25 &&
    cdrGrpP2.data.data.length === 25 &&
    g2Nums.every(n => !g1Nums.has(n))
  );

  // ── 4. CDR CSV Exports omit Type and IP across all 3 roles ──
  const expOwn = await srv.api('GET', `/api/sms/export?date_from=${today}&date_to=${today}`, { cookie: own.cookie });
  const expAg = await srv.api('GET', `/api/sms/export?date_from=${today}&date_to=${today}`, { cookie: ag1.cookie });
  const expCl = await srv.api('GET', `/api/sms/export?date_from=${today}&date_to=${today}`, { cookie: cl1.cookie });

  const ownHdr = String(expOwn.data || '').split('\n')[0] || '';
  const agHdr = String(expAg.data || '').split('\n')[0] || '';
  const clHdr = String(expCl.data || '').split('\n')[0] || '';

  check('Owner CDR CSV header omits "Type" and "IP", and body leaks no IP',
    expOwn.status === 200 &&
    !ownHdr.includes('"Type"') &&
    !ownHdr.includes('"IP"') &&
    !String(expOwn.data).includes('203.0.113.77')
  );
  check('Agent CDR CSV header omits "Type" and "IP", and body leaks no IP',
    expAg.status === 200 &&
    !agHdr.includes('"Type"') &&
    !agHdr.includes('"IP"') &&
    !String(expAg.data).includes('203.0.113.77')
  );
  check('Client CDR CSV header omits "Type" and "IP", and body leaks no IP',
    expCl.status === 200 &&
    !clHdr.includes('"Type"') &&
    !clHdr.includes('"IP"') &&
    !String(expCl.data).includes('203.0.113.77')
  );

  // ── 5. Static frontend assertions ──
  const sharedKit = fs.readFileSync(path.resolve('humex-sms/static/js/shared-ui-kit.js'), 'utf8');
  const ownerShell = fs.readFileSync(path.resolve('humex-sms/static/js/owner-shell.js'), 'utf8');
  const agentPages = fs.readFileSync(path.resolve('humex-sms/static/js/agent-pages.js'), 'utf8');
  const clientPages = fs.readFileSync(path.resolve('humex-sms/static/js/client-pages.js'), 'utf8');

  check('shared-ui-kit.js exposes window.ZYT2', sharedKit.includes('window.ZYT2 = ZYT2'));
  check('No hardcoded limitVal === "all" ? 10000 remains in Owner/Agent/Client CDR',
    !ownerShell.includes("limitVal === 'all' ? 10000") &&
    !agentPages.includes("limitVal === 'all' ? 10000") &&
    !clientPages.includes("limitVal === 'all' ? 10000")
  );
  check('Owner, Agent, Client CDR ungrouped tables omit Type and IP columns',
    !ownerShell.includes("'Type',\n        'Number'") &&
    !ownerShell.includes("'Cause',\n        'IP'") &&
    !agentPages.includes("'Range', 'Type', 'Number'") &&
    !clientPages.includes("'Range', 'Type', 'Number'") &&
    !clientPages.includes("'Cause', 'IP'")
  );
} finally {
  srv.stop();
}

summary('CDR & My Numbers Fixes');
