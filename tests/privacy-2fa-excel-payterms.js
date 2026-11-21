// Comprehensive End-to-End Test Suite for:
// 1. Whitenoise Monthly-only / Standard Weekly-only + Biweekly removal + {W} visual markers
// 2. Mobile 20% non-dashboard zoom-out & Compact Owner CDR 2
// 3. Multi-Day Excel Date-to-Date parsing, Missing-Day Gap Detection, Cumulative 1-15 / 16-End Coverage & Multi-Sheet parsing
// 4. 2FA-Protected Agent Password Change & 2FA Lock (even Owner cannot bypass)
// 5. Strict Agent Privacy From Owner (Clients hidden from Owner + Live Chat Isolation)
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { makeFixture, startServer, check, summary } from './lib.js';

const TEST_PORT = 4455;

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0, index = 0;
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

function generateCurrentTotp(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Math.floor(Date.now() / 1000) / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

function buildWorkbookBuffer(sheetsObj) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheetsObj)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadExcel(base, endpoint, cookie, filename, buffer, extraFields = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  for (const [k, v] of Object.entries(extraFields)) {
    if (v !== undefined && v !== null) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const res = await fetch(base + endpoint, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: form
  });
  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: res.status, data };
}

(async () => {
  console.log('\n=== Privacy Wall, 2FA Lock, Multi-Day Excel Reconciliation & Payterm Rules ===');
  const now = new Date().toISOString();
  const AGENT_2FA_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DP';

  const dir = makeFixture({
    settings: {
      company_name: 'HUMAX SMS',
      timezone: 'Asia/Karachi',
      usd_to_pkr_rate: 280,
      min_payout_pkr: 500,
      payterms: ['Weekly', 'Monthly']
    },
    agents: [
      {
        id: 1,
        username: 'agent_one',
        password: 'agentpass1',
        role: 'Agent',
        status: 'active',
        balance: 0,
        whitenoise_access: true,
        two_fa: true,
        two_fa_secret: AGENT_2FA_SECRET,
        created: now
      },
      {
        id: 2,
        username: 'agent_two',
        password: 'agentpass2',
        role: 'Agent',
        status: 'active',
        balance: 0,
        whitenoise_access: false,
        two_fa: false,
        created: now
      }
    ],
    clients: [
      { id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', balance: 0, balance_pkr: 0, whitenoise_access: true, created: now },
      { id: 2, username: 'client_two', password: 'clientpass2', role: 'Client', agent_id: 2, status: 'active', balance: 0, balance_pkr: 0, whitenoise_access: false, created: now }
    ],
    sms_ranges: [
      {
        id: 1,
        range_name: 'Ghana Standard Weekly',
        name: 'Ghana Standard Weekly',
        country: 'Ghana',
        provider: 'Orange',
        prefix: '2335',
        cost: 0.03,
        company_cost: 0.03,
        payout: 0.02,
        payterm: 'Weekly',
        active_payterms: ['Weekly'],
        payterms: { Weekly: 0.02 },
        currency: 'USD'
      },
      {
        id: 10,
        range_name: 'USA Monthly Route',
        name: 'USA Monthly Route',
        country: 'USA',
        provider: 'Whitenoise',
        prefix: '1555',
        cost: 0.04,
        company_cost: 0.04,
        payout: 0.025,
        client_rate_pkr: 4.2,
        payterm: 'Monthly',
        active_payterms: ['Monthly'],
        payterms: { Monthly: 0.025 },
        currency: 'USD'
      }
    ],
    agent_client_rates: [
      { id: 1, agent_id: 1, range_id: 1, range_name: 'Ghana Standard Weekly', client_rate_pkr: 3.5, allowed_quantities: [25] },
      { id: 2, agent_id: 1, range_id: 10, range_name: 'USA Monthly Route', client_rate_pkr: 4.2, allowed_quantities: [25] }
    ],
    numbers: [
      {
        id: 101,
        number: '15550001111',
        country: 'USA',
        provider: 'Whitenoise',
        range_id: 10,
        range_name: 'USA Monthly Route',
        status: 'assigned',
        agent_id: 1,
        client_id: 1,
        user: 'client_one',
        owner_cost_usd: 0.04,
        agent_rate_usd: 0.025,
        client_rate_pkr: 4.2,
        payterm: 'Monthly',
        payout_schedule: 'monthly30_5',
        created: now
      },
      {
        id: 102,
        number: '23350001111',
        country: 'Ghana',
        provider: 'Orange',
        range_id: 1,
        range_name: 'Ghana Standard Weekly',
        status: 'assigned',
        agent_id: 1,
        client_id: null,
        user: '',
        payterm: 'Weekly',
        created: now
      }
    ],
    number_ownership_ledger: [
      {
        id: 1,
        seq: 1,
        number_id: 101,
        number: '15550001111',
        effective_date: '2026-10-01',
        owner_role: 'client',
        agent_id: 1,
        agent_username: 'agent_one',
        client_id: 1,
        client_username: 'client_one',
        recorded_at: '2026-10-01T00:00:00.000Z'
      }
    ]
  });

  const srv = await startServer(dir, TEST_PORT);
  const base = `http://127.0.0.1:${TEST_PORT}`;

  async function loginWith2fa(username, password, secret) {
    const capRes = await srv.api('GET', '/api/auth/captcha');
    const cap = capRes.data || {};
    const m = String(cap.question || '').match(/(\d+)\s*([+\-*])\s*(\d+)/);
    const ans = m ? (m[2] === '+' ? Number(m[1]) + Number(m[3]) : m[2] === '-' ? Number(m[1]) - Number(m[3]) : Number(m[1]) * Number(m[3])) : 0;
    const r = await srv.api('POST', '/api/auth/login', {
      body: {
        username,
        password,
        captcha_id: cap.id,
        captcha_answer: String(ans),
        two_fa_code: generateCurrentTotp(secret)
      }
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const tok = sc.map(c => c.split(';')[0]).find(c => c.startsWith('humex_session_token=') || c.startsWith('alpha_session_token='));
    return { ok: r.status === 200 && !!tok, cookie: tok || '', res: r };
  }

  try {
    const owLogin = await srv.login('Kamran_Bhatti', 'ownerpass1');
    const ag1Login = await loginWith2fa('agent_one', 'agentpass1', AGENT_2FA_SECRET);
    const ag2Login = await srv.login('agent_two', 'agentpass2');
    const cl1Login = await srv.login('client_one', 'clientpass1');
    check('Logins succeed for Owner, 2FA Agent 1, Agent 2 & Client 1', owLogin.ok && ag1Login.ok && ag2Login.ok && cl1Login.ok);

    const ow = (m, u, b) => srv.api(m, u, { cookie: owLogin.cookie, body: b });
    const ag1 = (m, u, b) => srv.api(m, u, { cookie: ag1Login.cookie, body: b });
    const ag2 = (m, u, b) => srv.api(m, u, { cookie: ag2Login.cookie, body: b });
    const cl1 = (m, u, b) => srv.api(m, u, { cookie: cl1Login.cookie, body: b });

    // ── REQ 1: PAYTERMS (NO BIWEEKLY, WHITENOISE = MONTHLY ONLY, STANDARD = WEEKLY ONLY) ──
    const ptGet = await ow('GET', '/api/payterms');
    check('1a GET /api/payterms returns ONLY ["Weekly", "Monthly"] (no Biweekly)',
      ptGet.status === 200 && JSON.stringify(ptGet.data?.payterms) === '["Weekly","Monthly"]'
    );

    const ptPostBi = await ow('POST', '/api/payterms', { payterms: ['Biweekly', '15/3'] });
    check('1b POST /api/payterms with only Biweekly/15/3 rejected (400)', ptPostBi.status === 400);

    const badReqBi = await cl1('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Standard Weekly', quantity: 25, payterm: 'Biweekly' });
    const badReqStdMonthly = await cl1('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Standard Weekly', quantity: 25, payterm: 'Monthly' });
    const badReqWnWeekly = await cl1('POST', '/api/numbers/request', { range_id: 10, range_name: 'USA Monthly Route', quantity: 25, payterm: 'Weekly' });
    check('1c Requests with Biweekly, Monthly on Standard range, or Weekly on Whitenoise range are ALL rejected (400)',
      badReqBi.status === 400 && badReqStdMonthly.status === 400 && badReqWnWeekly.status === 400
    );

    // ── REQ 2 & 3: MOBILE 20% SUBPAGE ZOOM-OUT & COMPACT OWNER CDR 2 (STATIC CONTRACT) ──
    const cssSrc = fs.readFileSync(path.resolve('humex-sms/static/css/humex-panel.css'), 'utf8');
    const routerSrc = fs.readFileSync(path.resolve('humex-sms/static/js/shared-url-router.js'), 'utf8');
    const ownerShellSrc = fs.readFileSync(path.resolve('humex-sms/static/js/owner-shell.js'), 'utf8');
    const clientPagesSrc = fs.readFileSync(path.resolve('humex-sms/static/js/client-pages.js'), 'utf8');
    check('2a Mobile 20% zoom-out applies ONLY to non-dashboard subpages (zy-is-subpage -> zoom: 0.8; zy-is-dashboard -> zoom: 1)',
      routerSrc.includes('syncBodyPageClass') &&
      routerSrc.includes('zy-is-subpage') &&
      routerSrc.includes('zy-is-dashboard') &&
      cssSrc.includes('body.zy-is-subpage #page-content') &&
      cssSrc.includes('zoom: 0.8') &&
      cssSrc.includes('body.zy-is-dashboard #page-content')
    );
    check('2b Client My Numbers & Ranges distinguish {W} Monthly Route cleanly & include Route Type filter',
      clientPagesSrc.includes('zy-wn-route-tag') &&
      clientPagesSrc.includes('{W} Monthly Route') &&
      clientPagesSrc.includes('num-route-type')
    );
    check('3a Owner CDR 2 applies compact filter bar (.zy-owner-cdr2-compact) and omits Client group-by / Client column',
      ownerShellSrc.includes('zy-owner-cdr2-compact') &&
      !ownerShellSrc.includes("cdr2GroupBy === 'client'") &&
      ownerShellSrc.includes('zyLoadWhitenoiseCoverageStrip')
    );

    // ── REQ 4: MULTI-DAY EXCEL DATE-TO-DATE + MISSING-DAY GAP FILL + 1-15 / 16-END COVERAGE ──
    // Upload 1: Days 1..10 and Day 12 (Day 11 intentionally missing!) — 10 SMS/day = 110 SMS across 11 distinct dates
    const rowsUpload1 = [['Date', 'Number', 'SMS Count']];
    for (let d = 1; d <= 12; d++) {
      if (d === 11) continue; // Missing day gap!
      rowsUpload1.push([`2026-11-${String(d).padStart(2, '0')}`, '15550001111', 10]);
    }
    const buf1 = buildWorkbookBuffer({ Report: rowsUpload1 });
    const prev1 = await uploadExcel(base, '/api/whitenoise-excel/preview', owLogin.cookie, 'nov-1-to-12-gap.xlsx', buf1);
    check('4a Multi-day Excel (days 1-10 & 12) preserves all 11 distinct dates (never collapses to 1 date)',
      prev1.status === 200 &&
      Array.isArray(prev1.data?.distinct_dates) &&
      prev1.data.distinct_dates.length === 11 &&
      prev1.data.distinct_dates.includes('2026-11-01') &&
      prev1.data.distinct_dates.includes('2026-11-12') &&
      !prev1.data.distinct_dates.includes('2026-11-11') &&
      Number(prev1.data.summary?.net_sms_delta) === 110,
      JSON.stringify(prev1.data?.summary)
    );

    const comm1 = await uploadExcel(base, '/api/whitenoise-excel/commit', owLogin.cookie, 'nov-1-to-12-gap.xlsx', buf1);
    check('4b Commit 1 credits 110 SMS ($2.75 Agent USD) across 11 distinct days',
      comm1.status === 200 && comm1.data?.success === true && Number(comm1.data?.batch?.net_sms_delta) === 110
    );

    const covMid = await ow('GET', '/api/whitenoise-excel/coverage?month=2026-11');
    const covMidObj = covMid.data?.coverage || covMid.data || {};
    check('4c Coverage API detects missing Day 11 in 1-15 half-month window (11 uploaded, 2026-11-11 missing)',
      covMid.status === 200 &&
      covMidObj?.period_1_15?.uploaded_days === 11 &&
      Array.isArray(covMidObj?.period_1_15?.missing_dates) &&
      covMidObj.period_1_15.missing_dates.includes('2026-11-11') &&
      covMidObj?.period_16_end?.uploaded_days === 0,
      JSON.stringify({ p1: covMidObj?.period_1_15?.uploaded_days, miss: covMidObj?.period_1_15?.missing_dates, p2: covMidObj?.period_16_end?.uploaded_days })
    );

    // Upload 2: Cumulative 1-15 verification sheet (days 1..15, 10 SMS/day) — fills missing Day 11 + Days 13, 14, 15; Days 1..10 & 12 have delta 0!
    const rowsUpload2 = [['Date', 'Number', 'SMS Count']];
    for (let d = 1; d <= 15; d++) {
      rowsUpload2.push([`2026-11-${String(d).padStart(2, '0')}`, '15550001111', 10]);
    }
    const buf2 = buildWorkbookBuffer({ Verification_1_15: rowsUpload2 });
    const prev2 = await uploadExcel(base, '/api/whitenoise-excel/preview', owLogin.cookie, 'nov-1-to-15-verify.xlsx', buf2);
    const day11Summary = (prev2.data?.per_date_summary || []).find(r => r.date_ymd === '2026-11-11');
    const day05Summary = (prev2.data?.per_date_summary || []).find(r => r.date_ymd === '2026-11-05');
    check('4d Cumulative 1-15 check detects missing Day 11 gap-fill, zero-delta on already uploaded days, and exact 40 SMS delta',
      prev2.status === 200 &&
      Array.isArray(prev2.data?.missing_days_filled) &&
      prev2.data.missing_days_filled.includes('2026-11-11') &&
      day11Summary?.status === 'missing_day_filled' &&
      day11Summary?.delta_sms === 10 &&
      day05Summary?.status === 'verified_match' &&
      day05Summary?.delta_sms === 0 &&
      Number(prev2.data?.summary?.net_sms_delta) === 40,
      JSON.stringify({ filled: prev2.data?.missing_days_filled, day11: day11Summary, day05: day05Summary, sum: prev2.data?.summary })
    );

    const comm2 = await uploadExcel(base, '/api/whitenoise-excel/commit', owLogin.cookie, 'nov-1-to-15-verify.xlsx', buf2);
    const covFull15 = await ow('GET', '/api/whitenoise-excel/coverage?month=2026-11');
    const covFull15Obj = covFull15.data?.coverage || covFull15.data || {};
    check('4e Commit 2 credits ONLY exact 40 SMS delta & 1-15 half-month coverage reaches 15/15 (0 missing)',
      comm2.status === 200 &&
      Number(comm2.data?.batch?.net_sms_delta) === 40 &&
      covFull15.status === 200 &&
      covFull15Obj?.period_1_15?.uploaded_days === 15 &&
      covFull15Obj?.period_1_15?.missing_dates?.length === 0 &&
      covFull15Obj?.period_16_end?.uploaded_days === 0
    );

    // Multi-sheet date-named workbook (sheet names carry the dates, no Date column inside)
    const bufMultiSheet = buildWorkbookBuffer({
      '16.11.2026': [['Number', 'SMS Count'], ['15550001111', 5]],
      '17.11.2026': [['Number', 'SMS Count'], ['15550001111', 7]]
    });
    const prevMulti = await uploadExcel(base, '/api/whitenoise-excel/preview', owLogin.cookie, 'nov-16-17-sheets.xlsx', bufMultiSheet);
    check('4f Multi-sheet date-named workbook parses into 2 distinct dates (2026-11-16 & 2026-11-17)',
      prevMulti.status === 200 &&
      prevMulti.data?.distinct_dates?.length === 2 &&
      prevMulti.data.distinct_dates.includes('2026-11-16') &&
      prevMulti.data.distinct_dates.includes('2026-11-17') &&
      Number(prevMulti.data?.summary?.net_sms_delta) === 12
    );

    // ── REQ 5: 2FA-PROTECTED AGENT PASSWORD CHANGE & 2FA LOCK (EVEN OWNER CANNOT BYPASS) ──
    const pwNoOtp = await ow('PATCH', '/api/agents/1', { password: 'NewOwnerSetPass1!' });
    check('5a Owner CANNOT change 2FA-enabled Agent password without live 6-digit OTP (403 + require_agent_2fa)',
      pwNoOtp.status === 403 && pwNoOtp.data?.require_agent_2fa === true
    );

    const pwWrongOtp = await ow('PATCH', '/api/agents/1', { password: 'NewOwnerSetPass1!', two_fa_code: '000000' });
    check('5b Owner CANNOT change 2FA-enabled Agent password with wrong OTP (403)',
      pwWrongOtp.status === 403 && pwWrongOtp.data?.require_agent_2fa === true
    );

    const disable2faNoOtp = await ow('PATCH', '/api/agents/1', { two_fa: false });
    check('5c Owner CANNOT disable Agent 2FA without live Agent OTP (403)',
      disable2faNoOtp.status === 403 && disable2faNoOtp.data?.require_agent_2fa === true
    );

    const validOtp = generateCurrentTotp(AGENT_2FA_SECRET);
    const pwWithOtp = await ow('PATCH', '/api/agents/1', { password: 'NewOwnerSetPass1!', two_fa_code: validOtp });
    const ag1NewLogin = await loginWith2fa('agent_one', 'NewOwnerSetPass1!', AGENT_2FA_SECRET);
    check('5d Owner WITH valid live 6-digit Agent TOTP succeeds (200) and Agent logs in with new password + 2FA',
      pwWithOtp.status === 200 && ag1NewLogin.ok
    );

    // ── REQ 6: STRICT AGENT PRIVACY FROM OWNER + LIVE CHAT ISOLATION ──
    const owGetCl = await ow('GET', '/api/clients');
    const owGetCl1 = await ow('GET', '/api/clients/1');
    const owPatchCl1 = await ow('PATCH', '/api/clients/1', { status: 'inactive' });
    const owDelCl1 = await ow('DELETE', '/api/clients/1');
    check('6a Owner gets 403 on GET/PATCH/DELETE /api/clients and /api/clients/:id',
      owGetCl.status === 403 && owGetCl1.status === 403 && owPatchCl1.status === 403 && owDelCl1.status === 403
    );

    const owHier = await ow('GET', '/api/hierarchy');
    const hierClients = (owHier.data?.[0]?.agents || []).flatMap(a => a.clients || []);
    const owSearch = await ow('GET', '/api/search?q=client');
    check('6b Owner /api/hierarchy omits clients completely & /api/search returns zero clients',
      owHier.status === 200 &&
      hierClients.length === 0 &&
      owSearch.status === 200 &&
      Array.isArray(owSearch.data?.clients) &&
      owSearch.data.clients.length === 0
    );

    // Live Chat Isolation: Agent 1 <-> Client 1 direct chat & Agent 1 private group
    const ag1Fresh = (m, u, b) => srv.api(m, u, { cookie: ag1NewLogin.cookie, body: b });
    const directRes = await ag1Fresh('POST', '/api/chat/direct', { target_key: 'client:1' });
    const directConvId = directRes.data?.conversation?.id;
    check('6c Agent 1 opens private direct chat with Client 1', directRes.status === 200 && !!directConvId);

    const sendDirect = await ag1Fresh('POST', `/api/chat/conversations/${directConvId}/messages`, { body: 'Private Agent-Client msg' });
    check('6d Agent 1 sends message to Client 1', sendDirect.status === 200 || sendDirect.status === 201, JSON.stringify({ status: sendDirect.status, data: sendDirect.data }));

    const groupRes = await ag1Fresh('POST', '/api/chat/groups', { title: 'Agent 1 Private Group', member_client_ids: [1] });
    const groupConvId = groupRes.data?.conversation?.id || groupRes.data?.group?.id || groupRes.data?.id;
    check('6e Agent 1 creates private Client group', (groupRes.status === 200 || groupRes.status === 201) && !!groupConvId, JSON.stringify(groupRes.data));

    const owReadDirect = await ow('GET', `/api/chat/conversations/${directConvId}/messages`);
    const owSendDirect = await ow('POST', `/api/chat/conversations/${directConvId}/messages`, { body: 'Snooping' });
    const owReadGroup = await ow('GET', `/api/chat/conversations/${groupConvId}/messages`);
    const owSendGroup = await ow('POST', `/api/chat/conversations/${groupConvId}/messages`, { body: 'Snooping group' });
    check('6f Owner is strictly 403 blocked from reading or posting in Agent-Client direct chats and Agent Groups',
      owReadDirect.status === 403 && owSendDirect.status === 403 && owReadGroup.status === 403 && owSendGroup.status === 403
    );

    const ag2ReadDirect = await ag2('GET', `/api/chat/conversations/${directConvId}/messages`);
    const ag2SendDirect = await ag2('POST', `/api/chat/conversations/${directConvId}/messages`, { body: 'Cross-agent snooping' });
    const ag2ReadGroup = await ag2('GET', `/api/chat/conversations/${groupConvId}/messages`);
    const ag2SendGroup = await ag2('POST', `/api/chat/conversations/${groupConvId}/messages`, { body: 'Cross-agent group' });
    check('6g Agent 2 is strictly 403 blocked from reading or posting in Agent 1 direct chats and Agent 1 Groups',
      ag2ReadDirect.status === 403 && ag2SendDirect.status === 403 && ag2ReadGroup.status === 403 && ag2SendGroup.status === 403
    );

  } finally {
    await srv.stop();
  }

  const ok = summary('PRIVACY + 2FA + MULTI-DAY EXCEL + PAYTERMS');
  process.exit(ok ? 0 : 1);
})();
