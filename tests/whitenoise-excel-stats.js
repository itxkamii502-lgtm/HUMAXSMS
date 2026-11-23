// End-to-end integration test for Whitenoise (CDR 2) Excel-Only Daily Stats & Date-Dependent Ownership Engine
import XLSX from 'xlsx';
import { check, summary, makeFixture, startServer, readJson, fs } from './lib.js';

function approx(a, b, eps = 0.0005) {
  return Math.abs(Number(a) - Number(b)) <= eps;
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
  let data = null;
  const txt = await res.text();
  try { data = JSON.parse(txt); } catch (e) { data = txt; }
  return { status: res.status, data };
}

(async () => {
  const now = new Date().toISOString();
  const dir = makeFixture({
    settings: {
      company_name: 'HUMAX SMS',
      timezone: 'Asia/Karachi',
      usd_to_pkr_rate: 280,
      min_payout_pkr: 500,
      whitenoise_cycle_start_day: 1,
      whitenoise_cycle_end_day: 30,
      whitenoise_settlement_day: 5
    },
    agents: [
      { id: 1, username: 'agent_one', password: 'agentpass1', role: 'Agent', status: 'active', balance: 0, whitenoise_access: true, created: now },
      { id: 2, username: 'agent_direct', password: 'agentpass2', role: 'Agent', status: 'active', balance: 0, whitenoise_access: false, created: now }
    ],
    clients: [
      { id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', balance: 0, balance_pkr: 0, whitenoise_access: true, created: now },
      { id: 2, username: 'client_two', password: 'clientpass2', role: 'Client', agent_id: 1, status: 'active', balance: 0, balance_pkr: 0, whitenoise_access: true, created: now },
      { id: 3, username: 'client_three', password: 'clientpass3', role: 'Client', agent_id: 2, status: 'active', balance: 0, balance_pkr: 0, whitenoise_access: false, created: now }
    ],
    sms_ranges: [
      {
        id: 10,
        range_name: 'USA Whitenoise Monthly',
        name: 'USA Whitenoise Monthly',
        country: 'USA',
        provider: 'Whitenoise',
        prefix: '1555',
        cost: 0.04,       // Owner revenue USD per SMS
        payout: 0.025,    // Agent gross payout USD per SMS
        client_rate_pkr: 4.2, // Client PKR per SMS (4.2 / 280 = $0.015 USD; Agent net profit = $0.010 USD; Owner net profit = $0.015 USD)
        payterm: 'monthly30_5',
        payout_schedule: 'monthly30_5',
        currency: 'USD'
      }
    ],
    agent_client_rates: [
      {
        id: 1,
        agent_id: 1,
        range_id: 10,
        range_name: 'USA Whitenoise Monthly',
        client_rate_pkr: 4.2
      }
    ],
    numbers: [
      {
        id: 101,
        number: '15550001111',
        country: 'USA',
        provider: 'Whitenoise',
        range_id: 10,
        range_name: 'USA Whitenoise Monthly',
        status: 'assigned',
        agent_id: 1,
        client_id: 1,
        user: 'client_one',
        owner_cost_usd: 0.04,
        agent_rate_usd: 0.025,
        client_rate_pkr: 4.2,
        payout_schedule: 'monthly30_5',
        created: now
      },
      {
        id: 102,
        number: '15550002222',
        country: 'USA',
        provider: 'Whitenoise',
        range_id: 10,
        range_name: 'USA Whitenoise Monthly',
        status: 'assigned',
        agent_id: 1,
        client_id: 2,
        user: 'client_two',
        owner_cost_usd: 0.04,
        agent_rate_usd: 0.025,
        client_rate_pkr: 4.2,
        payout_schedule: 'monthly30_5',
        created: now
      }
    ],
    // Seed historical date-dependent ownership transitions:
    // - 15550001111 belonged to client_one on 2026-11-15..18, then moved to client_two on 2026-11-19
    // - 15550002222 belonged to client_one on morning of 2026-11-19 (seq 10) AND shifted to client_two on SAME date 2026-11-19 (seq 11)
    number_ownership_ledger: [
      {
        id: 1,
        event_seq: 1,
        event_date: '2026-11-15',
        number_id: 101,
        number_digits: '15550001111',
        range_id: 10,
        range_name: 'USA Whitenoise Monthly',
        agent_id: 1,
        agent_name: 'agent_one',
        client_id: 1,
        client_name: 'client_one',
        owner_cost_usd: 0.04,
        agent_rate_usd: 0.025,
        client_rate_pkr: 4.2,
        fx_usd_to_pkr: 280,
        action: 'assigned',
        actor: 'Kamran_Bhatti',
        created_at: '2026-11-15T05:00:00.000Z'
      },
      {
        id: 2,
        event_seq: 2,
        event_date: '2026-11-19',
        number_id: 101,
        number_digits: '15550001111',
        range_id: 10,
        range_name: 'USA Whitenoise Monthly',
        agent_id: 1,
        agent_name: 'agent_one',
        client_id: 2,
        client_name: 'client_two',
        owner_cost_usd: 0.04,
        agent_rate_usd: 0.025,
        client_rate_pkr: 4.2,
        fx_usd_to_pkr: 280,
        action: 'transferred',
        actor: 'agent_one',
        created_at: '2026-11-19T06:00:00.000Z'
      },
      {
        id: 3,
        event_seq: 10,
        event_date: '2026-11-19',
        number_id: 102,
        number_digits: '15550002222',
        range_id: 10,
        range_name: 'USA Whitenoise Monthly',
        agent_id: 1,
        agent_name: 'agent_one',
        client_id: 1,
        client_name: 'client_one',
        owner_cost_usd: 0.04,
        agent_rate_usd: 0.025,
        client_rate_pkr: 4.2,
        fx_usd_to_pkr: 280,
        action: 'assigned',
        actor: 'agent_one',
        created_at: '2026-11-19T04:00:00.000Z'
      },
      {
        id: 4,
        event_seq: 11,
        event_date: '2026-11-19',
        number_id: 102,
        number_digits: '15550002222',
        range_id: 10,
        range_name: 'USA Whitenoise Monthly',
        agent_id: 1,
        agent_name: 'agent_one',
        client_id: 2,
        client_name: 'client_two',
        owner_cost_usd: 0.04,
        agent_rate_usd: 0.025,
        client_rate_pkr: 4.2,
        fx_usd_to_pkr: 280,
        action: 'transferred',
        actor: 'agent_one',
        created_at: '2026-11-19T14:00:00.000Z'
      }
    ]
  });

  const port = 3461;
  const srv = await startServer(dir, port);
  try {
    const owner = await srv.login('Kamran_Bhatti', 'ownerpass1');
    const agent = await srv.login('agent_one', 'agentpass1');
    const client1 = await srv.login('client_one', 'clientpass1');
    const client2 = await srv.login('client_two', 'clientpass2');
    const client3 = await srv.login('client_three', 'clientpass3');
    check('Logins succeed for Owner, Agent, Clients', owner.ok && agent.ok && client1.ok && client2.ok && client3.ok);

    // ------------------------------------------------------------------
    // TEST 1: RBAC — non-Owners cannot access /api/whitenoise-excel/*
    // ------------------------------------------------------------------
    const agBatches = await srv.api('GET', '/api/whitenoise-excel/batches', { cookie: agent.cookie });
    const clBatches = await srv.api('GET', '/api/whitenoise-excel/batches', { cookie: client1.cookie });
    const cl3Cdr2 = await srv.api('GET', '/api/cdr2/logs', { cookie: client3.cookie });
    check('RBAC: Agent & Client blocked (403) from /api/whitenoise-excel/batches', agBatches.status === 403 && clBatches.status === 403, `ag=${agBatches.status} cl=${clBatches.status}`);
    check('RBAC: Client without whitenoise_access blocked (403) from /api/cdr2/logs', cl3Cdr2.status === 403, `status=${cl3Cdr2.status}`);

    // ------------------------------------------------------------------
    // TEST 2: Multi-sheet .xlsx auto-selection, Dry-Run Preview & Atomic Commit (15-17.11.2026.xlsx)
    // ------------------------------------------------------------------
    const wb1517 = buildWorkbookBuffer({
      Summary: [
        ['Report Period', '15.11.2026 - 17.11.2026'],
        ['Total SMS', 15]
      ],
      DailyDetails: [
        ['Date', 'Phone Number', 'Service / CLI', 'SMS Count'],
        ['16.11.2026', '+15550001111', 'WhatsApp', 5],
        ['17.11.2026', '15550001111', 'Telegram', 10],
        ['17.11.2026', '+19998887777', 'UnmatchedApp', 3] // Unknown number not in inventory
      ]
    });

    const prev1 = await uploadExcel(srv.base, '/api/whitenoise-excel/preview', owner.cookie, '15-17.11.2026.xlsx', wb1517);
    check('Preview 15-17 returns 200 and auto-selects DailyDetails sheet', prev1.status === 200 && prev1.data?.selected_sheet === 'DailyDetails', JSON.stringify(prev1.data));
    check('Preview 15-17 detects 3 new rows, 0 updated, 1 unknown number, +18 SMS delta',
      prev1.data?.summary?.new_rows === 3 &&
      prev1.data?.summary?.updated_rows === 0 &&
      prev1.data?.summary?.unchanged_rows === 0 &&
      prev1.data?.summary?.unknown_numbers === 1 &&
      prev1.data?.summary?.net_sms_delta === 18,
      JSON.stringify(prev1.data?.summary)
    );

    const comm1 = await srv.api('POST', '/api/whitenoise-excel/commit', {
      cookie: owner.cookie,
      body: {
        preview_token: prev1.data.preview_token,
        sheet_name: prev1.data.selected_sheet,
        col_map: prev1.data.col_map
      }
    });
    check('Commit 15-17 succeeds and creates batch #1', comm1.status === 200 && comm1.data?.success && comm1.data?.batch?.id === 1, JSON.stringify(comm1.data));

    // Verify wallets after Batch 1 (15 matched SMS on 15550001111 -> client_one):
    // Owner revenue = 15 * 0.04 = $0.60, Owner net profit = 15 * 0.015 = $0.225
    // Agent gross payout = 15 * 0.025 = $0.375, Client USD = 15 * 0.015 = $0.225 (63.00 PKR)
    // Agent net profit (agent.balance) = $0.375 - $0.225 = $0.1500 USD
    let agentsDb = readJson(dir, 'agents');
    let clientsDb = readJson(dir, 'clients');
    check('Batch 1 updates Agent net balance (+$0.1500) and Client 1 PKR (+63.00)',
      approx(agentsDb.find(a => a.id === 1).balance, 0.15) &&
      approx(clientsDb.find(c => c.id === 1).balance_pkr, 63.0, 0.01) &&
      approx(clientsDb.find(c => c.id === 2).balance_pkr, 0, 0.01),
      `ag=${agentsDb[0].balance} c1=${clientsDb[0].balance_pkr} c2=${clientsDb[1].balance_pkr}`
    );

    // ------------------------------------------------------------------
    // TEST 3: Re-uploading identical 15-17 sheet produces 0 duplicates & 0 double billing
    // ------------------------------------------------------------------
    const prevDup = await uploadExcel(srv.base, '/api/whitenoise-excel/preview', owner.cookie, '15-17.11.2026.xlsx', wb1517);
    check('Re-upload identical sheet: 0 new, 0 updated, 3 unchanged, 0 SMS delta',
      prevDup.status === 200 &&
      prevDup.data?.summary?.new_rows === 0 &&
      prevDup.data?.summary?.updated_rows === 0 &&
      prevDup.data?.summary?.unchanged_rows === 3 &&
      prevDup.data?.summary?.net_sms_delta === 0,
      JSON.stringify(prevDup.data?.summary)
    );
    const commDup = await srv.api('POST', '/api/whitenoise-excel/commit', {
      cookie: owner.cookie,
      body: { preview_token: prevDup.data.preview_token }
    });
    agentsDb = readJson(dir, 'agents');
    clientsDb = readJson(dir, 'clients');
    const statsAfterDup = readJson(dir, 'whitenoise_daily_stats');
    check('Re-upload commit causes 0 duplicate rows & 0 balance drift',
      commDup.status === 200 &&
      statsAfterDup.length === 3 &&
      approx(agentsDb.find(a => a.id === 1).balance, 0.15) &&
      approx(clientsDb.find(c => c.id === 1).balance_pkr, 63.0, 0.01),
      `rows=${statsAfterDup.length} ag=${agentsDb[0].balance} c1=${clientsDb[0].balance_pkr}`
    );

    // ------------------------------------------------------------------
    // TEST 4: Cumulative 15-19 sheet with cross-day transfer & same-day shift
    //   - Day 16 unchanged (5) -> client_one
    //   - Day 17 updated (+4: 10 -> 14) -> still client_one!
    //   - Day 18 new (6 SMS on 15550001111) -> client_one!
    //   - Day 19 new (8 SMS on 15550001111) -> transferred on 2026-11-19 -> client_two!
    //   - Day 19 new (4 SMS on 15550002222) -> same-day shift client_one -> client_two -> latest active (client_two) wins!
    // ------------------------------------------------------------------
    const wb1519 = buildWorkbookBuffer({
      DailyDetails: [
        ['Date', 'Number', 'Service', 'Count'],
        ['16.11.2026', '+15550001111', 'WhatsApp', 5],
        ['17.11.2026', '+15550001111', 'Telegram', 14], // delta +4 -> client_one
        ['18.11.2026', '15550001111', 'WhatsApp', 6],   // new +6 -> client_one
        ['19.11.2026', '15550001111', 'WhatsApp', 8],   // new +8 -> client_two
        ['19.11.2026', '15550002222', 'Google', 4]      // new +4 -> client_two (same-day shift latest wins)
      ]
    });

    const prev1519 = await uploadExcel(srv.base, '/api/whitenoise-excel/preview', owner.cookie, '15-19.11.2026.xlsx', wb1519);
    check('Preview 15-19 computes exact delta (+22 SMS: 3 new, 1 updated, 1 unchanged)',
      prev1519.status === 200 &&
      prev1519.data?.summary?.new_rows === 3 &&
      prev1519.data?.summary?.updated_rows === 1 &&
      prev1519.data?.summary?.unchanged_rows === 1 &&
      prev1519.data?.summary?.net_sms_delta === 22,
      JSON.stringify(prev1519.data?.summary)
    );

    const comm1519 = await srv.api('POST', '/api/whitenoise-excel/commit', {
      cookie: owner.cookie,
      body: { preview_token: prev1519.data.preview_token }
    });
    check('Commit 15-19 succeeds', comm1519.status === 200 && comm1519.data?.success);

    // client_one total: 5 + 14 + 6 = 25 SMS -> 105.00 PKR ($0.375 USD)
    // client_two total: 8 + 4 = 12 SMS -> 50.40 PKR ($0.180 USD)
    // agent_one total: 37 SMS -> gross payout $0.9250, net profit $0.3700 USD
    agentsDb = readJson(dir, 'agents');
    clientsDb = readJson(dir, 'clients');
    check('Date-dependent ownership + same-day shift: client_one=105.00 PKR (25 SMS), client_two=50.40 PKR (12 SMS), agent_one net=$0.3700 (37 SMS)',
      approx(clientsDb.find(c => c.id === 1).balance_pkr, 105.0, 0.01) &&
      approx(clientsDb.find(c => c.id === 2).balance_pkr, 50.4, 0.01) &&
      approx(agentsDb.find(a => a.id === 1).balance, 0.37, 0.0005),
      `c1=${clientsDb[0].balance_pkr} c2=${clientsDb[1].balance_pkr} ag=${agentsDb[0].balance}`
    );

    // ------------------------------------------------------------------
    // TEST 5: Date-Pivot Matrix .xlsx Auto-Unpivot (columns = dates)
    // ------------------------------------------------------------------
    const wbPivot = buildWorkbookBuffer({
      Matrix: [
        ['Number', 'Service', '18.11.2026', '19.11.2026'],
        ['+15550001111', 'Signal', 2, 3]
      ]
    });
    const prevPivot = await uploadExcel(srv.base, '/api/whitenoise-excel/preview', owner.cookie, 'pivot.xlsx', wbPivot);
    check('Pivot matrix .xlsx auto-unpivots date columns (2 new rows, +5 SMS, 18th->client_one, 19th->client_two)',
      prevPivot.status === 200 &&
      prevPivot.data?.layout === 'date_pivot' &&
      prevPivot.data?.summary?.new_rows === 2 &&
      prevPivot.data?.summary?.net_sms_delta === 5 &&
      prevPivot.data?.rows?.some(r => r.date_ymd === '2026-11-18' && r.client_name === 'client_one' && r.sms_count === 2) &&
      prevPivot.data?.rows?.some(r => r.date_ymd === '2026-11-19' && r.client_name === 'client_two' && r.sms_count === 3),
      JSON.stringify(prevPivot.data?.rows)
    );

    // ------------------------------------------------------------------
    // TEST 6: CDR 2 API, Monthly (30/5) {W} Payments, Reconciliation & Strict Privacy
    // ------------------------------------------------------------------
    const ownerCdr2 = await srv.api('GET', '/api/cdr2/logs?from=2026-11-01&to=2026-11-30', { cookie: owner.cookie });
    const agentCdr2 = await srv.api('GET', '/api/cdr2/logs?from=2026-11-01&to=2026-11-30', { cookie: agent.cookie });
    const c1Cdr2 = await srv.api('GET', '/api/cdr2/logs?from=2026-11-01&to=2026-11-30', { cookie: client1.cookie });
    const c2Cdr2 = await srv.api('GET', '/api/cdr2/logs?from=2026-11-01&to=2026-11-30', { cookie: client2.cookie });

    check('Owner CDR 2 summary has weighted sms_count (40 total incl. 3 unknown, rev=$1.48, agent_payout=$0.925, profit=$0.555)',
      ownerCdr2.status === 200 &&
      ownerCdr2.data?.summary?.total_sms === 40 &&
      approx(ownerCdr2.data?.summary?.payout, 1.48, 0.001) &&
      approx(ownerCdr2.data?.summary?.agent_payout, 0.925, 0.001) &&
      approx(ownerCdr2.data?.summary?.profit, 0.555, 0.001),
      JSON.stringify(ownerCdr2.data?.summary)
    );
    check('Agent CDR 2 sees 37 SMS, gross payout $0.9250, net profit $0.3700, and NO owner_revenue_usd / whitenoise leak',
      agentCdr2.status === 200 &&
      agentCdr2.data?.summary?.total_sms === 37 &&
      approx(agentCdr2.data?.summary?.payout, 0.925, 0.001) &&
      approx(agentCdr2.data?.summary?.profit, 0.37, 0.001) &&
      !JSON.stringify(agentCdr2.data).toLowerCase().includes('whitenoise') &&
      agentCdr2.data?.data?.every(r => r.owner_revenue_usd === undefined && r.owner_profit_usd === undefined),
      JSON.stringify(agentCdr2.data?.summary)
    );
    check('Client 1 CDR 2 sees ONLY Nov 16-18 (25 SMS, Rs. 105) & Client 2 sees ONLY Nov 19 (12 SMS, Rs. 50.40) with zero leak',
      c1Cdr2.status === 200 &&
      c1Cdr2.data?.summary?.total_sms === 25 &&
      approx(c1Cdr2.data?.summary?.client_payout_pkr, 105.0, 0.01) &&
      c2Cdr2.status === 200 &&
      c2Cdr2.data?.summary?.total_sms === 12 &&
      approx(c2Cdr2.data?.summary?.client_payout_pkr, 50.4, 0.01) &&
      !JSON.stringify(c1Cdr2.data).toLowerCase().includes('whitenoise') &&
      c1Cdr2.data?.data?.every(r => r.owner_revenue_usd === undefined && r.agent_payout_usd === undefined),
      `c1=${JSON.stringify(c1Cdr2.data?.summary)} c2=${JSON.stringify(c2Cdr2.data?.summary)}`
    );

    // Check Monthly 30/5 {W} hold bucket in /api/payments
    const c1Pay = await srv.api('GET', '/api/payments', { cookie: client1.cookie });
    const agPay = await srv.api('GET', '/api/payments', { cookie: agent.cookie });
    const c1M = c1Pay.data?.monthly30_5;
    const agM = agPay.data?.monthly30_5;
    check('Monthly 30/5 {W} hold summary reflects weighted SMS counts (client_one=25 SMS/105 PKR, agent_one=37 SMS/$0.37 net)',
      c1Pay.status === 200 && c1M?.sms_count === 25 && approx(c1M?.held_pkr, 105.0, 0.01) &&
      agPay.status === 200 && agM?.sms_count === 37 && approx(agM?.held_usd, 0.37, 0.001),
      `c1M=${JSON.stringify(c1M)} agM=${JSON.stringify(agM)}`
    );

    // Check Owner reconciliation
    const recon = await srv.api('GET', '/api/finance/reconciliation', { cookie: owner.cookie });
    check('Owner /api/finance/reconciliation reconciles cleanly with whitenoise_daily_stats (40 SMS, $1.48 rev)',
      recon.status === 200 &&
      recon.data?.reconciled === true &&
      recon.data?.total_sms === 40 &&
      approx(recon.data?.company_revenue, 1.48, 0.001),
      JSON.stringify(recon.data)
    );

    // Check CSV export strips whitenoise & internal columns for Client
    const c1Csv = await srv.api('GET', '/api/cdr2/export?from=2026-11-01&to=2026-11-30', { cookie: client1.cookie });
    check('Client CDR 2 CSV export contains SMS Count & PKR without whitenoise/owner leaks',
      c1Csv.status === 200 &&
      typeof c1Csv.data === 'string' &&
      c1Csv.data.includes('SMS Count') &&
      c1Csv.data.includes('"105"') &&
      !c1Csv.data.toLowerCase().includes('whitenoise') &&
      !c1Csv.data.includes('Owner Revenue'),
      String(c1Csv.data).slice(0, 260)
    );

    // ------------------------------------------------------------------
    // TEST 7: 1-Click Batch Rollback restores exact pre-batch counts & balances
    // ------------------------------------------------------------------
    const batchesRes = await srv.api('GET', '/api/whitenoise-excel/batches', { cookie: owner.cookie });
    const latestBatchId = comm1519.data.batch.id;
    check('GET /api/whitenoise-excel/batches lists all 3 committed batches',
      batchesRes.status === 200 && Array.isArray(batchesRes.data?.data) && batchesRes.data.data.length === 3,
      `len=${batchesRes.data?.data?.length}`
    );

    const rbRes = await srv.api('POST', `/api/whitenoise-excel/batches/${latestBatchId}/rollback`, { cookie: owner.cookie });
    agentsDb = readJson(dir, 'agents');
    clientsDb = readJson(dir, 'clients');
    const statsAfterRb = readJson(dir, 'whitenoise_daily_stats');
    const nov17Row = statsAfterRb.find(s => s.date_ymd === '2026-11-17' && s.number_digits === '15550001111');
    check('1-Click Rollback of 15-19 batch restores exact pre-batch state (Nov 17=10 SMS, client_one=63 PKR, client_two=0 PKR, agent=$0.15)',
      rbRes.status === 200 &&
      rbRes.data?.success === true &&
      statsAfterRb.length === 3 &&
      nov17Row?.sms_count === 10 &&
      approx(clientsDb.find(c => c.id === 1).balance_pkr, 63.0, 0.01) &&
      approx(clientsDb.find(c => c.id === 2).balance_pkr, 0, 0.01) &&
      approx(agentsDb.find(a => a.id === 1).balance, 0.15, 0.0005),
      `rows=${statsAfterRb.length} nov17=${nov17Row?.sms_count} c1=${clientsDb[0].balance_pkr} c2=${clientsDb[1].balance_pkr} ag=${agentsDb[0].balance}`
    );

    const rbAgain = await srv.api('POST', `/api/whitenoise-excel/batches/${latestBatchId}/rollback`, { cookie: owner.cookie });
    check('Double rollback of same batch is rejected cleanly (400)', rbAgain.status === 400);

    // ------------------------------------------------------------------
    // TEST 10: CDR 2 3-Box Panel Access (Agent sets URL/User/Pass -> All Agent Clients see it)
    // ------------------------------------------------------------------
    const paBadUrl = await srv.api('PUT', '/api/cdr2/panel-access', {
      cookie: agent.cookie,
      body: { url: 'javascript:alert(1)', username: 'u1', password: 'p1' }
    });
    const paClientPut403 = await srv.api('PUT', '/api/cdr2/panel-access', {
      cookie: client1.cookie,
      body: { url: 'https://evil.example.com', username: 'x', password: 'y' }
    });
    const paSave = await srv.api('PUT', '/api/cdr2/panel-access', {
      cookie: agent.cookie,
      body: { url: 'panel.example.com/login', username: 'team_user', password: 'StrongPass#99' }
    });
    const paC1Get = await srv.api('GET', '/api/cdr2/panel-access', { cookie: client1.cookie });
    const paC2Get = await srv.api('GET', '/api/cdr2/panel-access', { cookie: client2.cookie });
    const paNoWn403 = await srv.api('GET', '/api/cdr2/panel-access', { cookie: client3.cookie });
    check('CDR 2 Panel Access: Agent saves 3 boxes, all enabled Clients see exact URL/User/Pass, bad URL=400, Client PUT/disabled=403',
      paBadUrl.status === 400 &&
      paClientPut403.status === 403 &&
      paSave.status === 200 &&
      paSave.data?.panel?.url === 'https://panel.example.com/login' &&
      paC1Get.status === 200 &&
      paC1Get.data?.panel?.url === 'https://panel.example.com/login' &&
      paC1Get.data?.panel?.username === 'team_user' &&
      paC1Get.data?.panel?.password === 'StrongPass#99' &&
      paC2Get.status === 200 &&
      paC2Get.data?.panel?.username === 'team_user' &&
      paC2Get.data?.panel?.password === 'StrongPass#99' &&
      paNoWn403.status === 403,
      JSON.stringify({ badUrl: paBadUrl.status, cPut: paClientPut403.status, save: paSave.data, c1: paC1Get.data, c2: paC2Get.data, noWn: paNoWn403.status })
    );

    const ok = summary('Whitenoise Excel Daily Stats');
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('TEST CRASH:', err);
    await srv.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    process.exit(1);
  }
})();
