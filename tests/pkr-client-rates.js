import fs from 'fs';
import { makeFixture, startServer, check, summary, readJson } from './lib.js';

const PORT = 3491;

async function run() {
  const dir = makeFixture({
    sms_ranges: [
      { id: 1, range_name: 'Ghana Orange NS2', name: 'Ghana Orange NS2', country: 'Ghana', provider: 'Orange', prefix: '233', cost: 0.03, company_cost: 0.03, payout: 0.02, payterms: { Weekly: 0.02 }, currency: 'USD' },
      { id: 2, range_name: 'Kenya Safaricom P1', name: 'Kenya Safaricom P1', country: 'Kenya', provider: 'Safaricom', prefix: '254', cost: 0.025, company_cost: 0.025, payout: 0.015, payterms: { Weekly: 0.015 }, currency: 'USD' },
      { id: 3, range_name: 'Unpriced Pending Range', name: 'Unpriced Pending Range', country: 'Nigeria', provider: 'MTN', prefix: '234', cost: 0.02, company_cost: 0.02, payout: 0.01, payterms: { Weekly: 0.01 }, currency: 'USD' }
    ],
    clients: [
      {
        id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, agent_username: 'agent_one',
        status: 'active', balance: 0, balance_pkr: 0,
        bank_name: 'HBL', account_number: '123456789', iban: 'PK36HABB000000123456789', wallet: '03001234567', email: 'c1@example.com', phone: '+923001234567',
        created: new Date().toISOString()
      },
      {
        id: 2, username: 'client_two', password: 'clientpass2', role: 'Client', agent_id: 1, agent_username: 'agent_one',
        status: 'active', balance: 0, balance_pkr: 0, created: new Date().toISOString()
      },
      {
        id: 3, username: 'client_three', password: 'clientpass3', role: 'Client', agent_id: 2, agent_username: 'agent_direct',
        status: 'active', balance: 0, balance_pkr: 0, created: new Date().toISOString()
      }
    ],
    numbers: [
      { id: 1, number: '233500000001', country: 'Ghana', provider: 'Orange', range_id: 1, range_name: 'Ghana Orange NS2', status: 'assigned', agent_id: 1, client_id: null, user: '', created: new Date().toISOString() },
      { id: 2, number: '233500000002', country: 'Ghana', provider: 'Orange', range_id: 1, range_name: 'Ghana Orange NS2', status: 'assigned', agent_id: 1, client_id: null, user: '', created: new Date().toISOString() },
      { id: 3, number: '254700000003', country: 'Kenya', provider: 'Safaricom', range_id: 2, range_name: 'Kenya Safaricom P1', status: 'assigned', agent_id: 1, client_id: null, user: '', created: new Date().toISOString() },
      { id: 4, number: '233500000004', country: 'Ghana', provider: 'Orange', range_id: 1, range_name: 'Ghana Orange NS2', status: 'assigned', agent_id: 2, client_id: null, user: '', created: new Date().toISOString() }
    ]
  });

  const srv = await startServer(dir, PORT);
  try {
    const owLogin = await srv.login('Kamran_Bhatti', 'ownerpass1');
    const ag1Login = await srv.login('agent_one', 'agentpass1');
    const ag2Login = await srv.login('agent_direct', 'agentpass2');
    const cl1Login = await srv.login('client_one', 'clientpass1');
    const cl3Login = await srv.login('client_three', 'clientpass3');

    check('All test actors logged in cleanly', owLogin.ok && ag1Login.ok && ag2Login.ok && cl1Login.ok && cl3Login.ok);

    const ow = (m, u, b) => srv.api(m, u, { cookie: owLogin.cookie, body: b });
    const ag1 = (m, u, b) => srv.api(m, u, { cookie: ag1Login.cookie, body: b });
    const ag2 = (m, u, b) => srv.api(m, u, { cookie: ag2Login.cookie, body: b });
    const cl1 = (m, u, b) => srv.api(m, u, { cookie: cl1Login.cookie, body: b });
    const cl3 = (m, u, b) => srv.api(m, u, { cookie: cl3Login.cookie, body: b });

    // 1. Owner global USD -> PKR exchange rate setting (default 280 -> update to 285 -> restore 280)
    const setDef = await cl1('GET', '/api/settings');
    check('1a Default usd_to_pkr_rate is 280 for Client/Agent', setDef.status === 200 && Number(setDef.data.usd_to_pkr_rate) === 280);

    const agSetFx = await ag1('POST', '/api/settings', { usd_to_pkr_rate: 290 });
    check('1b Non-Owner cannot edit usd_to_pkr_rate (403)', agSetFx.status === 403);

    const owSetFx = await ow('POST', '/api/settings', { usd_to_pkr_rate: 285, min_payout_pkr: 100 });
    const setUpdated = await cl1('GET', '/api/settings');
    check('1c Owner updates usd_to_pkr_rate to 285 and Client reads updated rate', owSetFx.status === 200 && Number(setUpdated.data.usd_to_pkr_rate) === 285);

    // Reset FX back to 280 for exact round-number assertions below
    await ow('POST', '/api/settings', { usd_to_pkr_rate: 280, min_payout_pkr: 2 });

    // 2. Client Rate Card hides unconfigured ranges
    const cl1CardEmpty = await cl1('GET', '/api/client/rate-card');
    const cl1RangesPubEmpty = await cl1('GET', '/api/numbers/sms-ranges?published_only=1');
    check('2a Client sees ZERO ranges before Agent publishes PKR rates',
      cl1CardEmpty.status === 200 && Array.isArray(cl1CardEmpty.data.ranges) && cl1CardEmpty.data.ranges.length === 0 &&
      cl1RangesPubEmpty.status === 200 && Array.isArray(cl1RangesPubEmpty.data) && cl1RangesPubEmpty.data.length === 0);

    // Client tries to request an unconfigured range -> 400
    const reqUnpriced = await cl1('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Orange NS2', quantity: 25 });
    check('2b Client request for unpublished range rejected (400)', reqUnpriced.status === 400);

    // 3. Agent Client Rate Set: Margin Guard + Per-Agent Isolation + Unconfigured Sort First
    const ag1RatesInit = await ag1('GET', '/api/agent/client-rates');
    const r1Init = (ag1RatesInit.data.ranges || []).find(r => r.range_id === 1);
    check('3a Agent /api/agent/client-rates lists all 3 ranges with pending_count === 3',
      ag1RatesInit.status === 200 && ag1RatesInit.data.pending_count === 3 && r1Init && r1Init.agent_rate_pkr === 5.6);

    // Margin Guard: Agent 1 payout is $0.02 * 280 = 5.60 PKR; saving 5.60 or 6.00 must FAIL (400)
    const badMarginEq = await ag1('PUT', '/api/agent/client-rates', { range_id: 1, client_rate_pkr: 5.6, allowed_quantities: [25, 50] });
    const badMarginHi = await ag1('PUT', '/api/agent/client-rates', { range_id: 1, client_rate_pkr: 6.2, allowed_quantities: [25, 50] });
    check('3b Margin Guard rejects client_rate_pkr >= agent_rate_pkr (400)', badMarginEq.status === 400 && badMarginHi.status === 400);

    // Owner/Client cannot access /api/agent/client-rates (403)
    const owBlocked = await ow('GET', '/api/agent/client-rates');
    const clBlocked = await cl1('GET', '/api/agent/client-rates');
    check('3c Owner and Client are blocked from /api/agent/client-rates (403)', owBlocked.status === 403 && clBlocked.status === 403);

    // Agent 1 publishes Range 1 @ 3.50 PKR & Range 2 @ 2.80 PKR; Agent 2 publishes Range 1 @ 2.10 PKR
    const saveAg1R1 = await ag1('PUT', '/api/agent/client-rates', { range_id: 1, client_rate_pkr: 3.5, allowed_quantities: [25, 50], daily_request_limit: 1 });
    const saveAg1R2 = await ag1('PUT', '/api/agent/client-rates', { range_id: 2, client_rate_pkr: 2.8, allowed_quantities: [25, 50], daily_request_limit: 1 });
    const saveAg2R1 = await ag2('PUT', '/api/agent/client-rates', { range_id: 1, client_rate_pkr: 2.1, allowed_quantities: [50], daily_request_limit: 1 });
    check('3d Agent 1 & Agent 2 save independent PKR client rates', saveAg1R1.status === 200 && saveAg1R2.status === 200 && saveAg2R1.status === 200);

    // Verify unconfigured range (#3) sorts FIRST for Agent 1
    const ag1RatesAfter = await ag1('GET', '/api/agent/client-rates');
    check('3e Unconfigured range stays sorted at TOP for Agent',
      ag1RatesAfter.data.pending_count === 1 && ag1RatesAfter.data.ranges[0].range_id === 3 && ag1RatesAfter.data.ranges[0].configured === false);

    // Verify strict Agent-Client rate card isolation
    const cl1Card = await cl1('GET', '/api/client/rate-card');
    const cl3Card = await cl3('GET', '/api/client/rate-card');
    const cl1R1 = cl1Card.data.ranges.find(r => r.range_id === 1);
    const cl3R1 = cl3Card.data.ranges.find(r => r.range_id === 1);
    check('3f Agent rates never mix & enriched rate card exposes active payterms_pkr/held_count without provider or Agent USD leak',
      cl1Card.data.ranges.length === 2 && cl1R1.client_rate_pkr === 3.5 &&
      cl3Card.data.ranges.length === 1 && cl3R1.client_rate_pkr === 2.1 &&
      cl1R1.agent_rate === undefined && cl1R1.company_cost === undefined && cl1R1.provider === undefined &&
      cl1R1.payterm === 'Weekly' && cl1R1.held_count === 0 &&
      cl1R1.payterms_pkr && cl1R1.payterms_pkr.Weekly === 3.5 && cl1R1.payterms_pkr.Monthly === undefined);

    // Weekly PKR target
    const targetRes = await ag1('PUT', '/api/agent/pkr-target', { weekly_pkr_target: 5000, weekly_pkr_enforce_mode: 'warn' });
    check('3g Agent sets weekly_pkr_target = 5000 PKR', targetRes.status === 200 && targetRes.data.weekly_pkr_target === 5000);

    // 4. Client Number Request batch size (max 25/day per range, unlimited across ranges)
    const badQtyReq = await cl1('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Orange NS2', quantity: 10 });
    check('4a Client request with disallowed quantity 10 rejected (400)', badQtyReq.status === 400);

    const okReqR1 = await cl1('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Orange NS2', quantity: 25, notes: 'Batch 25' });
    check('4b Client request with 25 on Range 1 accepted and stamped in PKR',
      okReqR1.status === 200 && okReqR1.data.request.client_rate_pkr === 3.5 && okReqR1.data.request.client_currency === 'PKR');

    const dupReqR1 = await cl1('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Orange NS2', quantity: 25 });
    check('4c Second request same day on SAME range blocked (429)', dupReqR1.status === 429);

    const okReqR2 = await cl1('POST', '/api/numbers/request', { range_id: 2, range_name: 'Kenya Safaricom P1', quantity: 25 });
    check('4d Client request same day on DIFFERENT published range (#2) allowed (200)', okReqR2.status === 200);

    // Refresh client_one rate card shows requested_today=true on R1 & R2
    const cl1CardPostReq = await cl1('GET', '/api/client/rate-card');
    check('4e Client rate card flags requested_today=true after submission',
      cl1CardPostReq.data.ranges.every(r => r.requested_today === true && r.can_request_today === false));

    // 5. Auto-inherited PKR rate on single assign, bulk-allocate, and request fulfill (no re-typing client_rate)
    const assignNum1 = await ag1('POST', '/api/numbers/1/assign', { target_type: 'client', target_id: 1 });
    check('5a Single assign auto-inherits client_rate_pkr=3.5 without typing rate',
      assignNum1.status === 200 && assignNum1.data.client_rate_pkr === 3.5 && assignNum1.data.rate_source === 'agent_client_rates');

    const bulkAllocR2 = await ag1('POST', '/api/numbers/bulk-allocate', { target_type: 'client', target_id: 1, range_id: 2, count: 1 });
    check('5b Bulk allocate auto-inherits client_rate_pkr=2.8 for Range 2', bulkAllocR2.status === 200);
    const numsAfterBulk = readJson(dir, 'numbers');
    const num3 = numsAfterBulk.find(n => n.id === 3);
    check('5c Allocated number #3 carries client_rate_pkr=2.8 on disk', num3 && num3.client_rate_pkr === 2.8 && num3.client_currency === 'PKR');

    // 6. Inbound SMS Dual-Currency Stamping & Strict USD Ledger Invariant
    const smsRes = await srv.api('POST', '/api/sms/inbound', {
      headers: { 'x-inbound-token': 'inbound-secret' },
      body: { to: '233500000001', from: 'WhatsApp', text: 'Your OTP is 849201', sms_id: 'pkr-test-sms-1' }
    });
    check('6a Inbound SMS delivered cleanly', smsRes.status === 200);
    const owLogsRes = await ow('GET', '/api/sms/logs?limit=10');
    const cl1LogsRes = await cl1('GET', '/api/sms/logs?limit=10');
    const log1 = (owLogsRes.data.data || []).find(s => s.sms_id === 'pkr-test-sms-1');
    const clLog1 = (cl1LogsRes.data.data || []).find(s => s.sms_id === 'pkr-test-sms-1');
    const sumUsd = log1 ? Math.round((log1.owner_amount + log1.agent_amount + log1.client_amount) * 1000000) / 1000000 : -1;
    check('6b SMS stamps 3.50 PKR for client AND keeps USD 3-tier invariant',
      log1 && clLog1 &&
      log1.client_currency === 'PKR' &&
      log1.client_rate_pkr === 3.5 &&
      log1.client_amount_pkr === 3.5 &&
      log1.fx_usd_to_pkr === 280 &&
      clLog1.client_amount_pkr === 3.5 &&
      clLog1.company_rate === undefined &&
      Math.abs(sumUsd - log1.company_rate) < 1e-6);

    const cl1Bal = await cl1('GET', '/api/payments/balance');
    check('6c Client /api/payments/balance returns earned 3.50 PKR',
      cl1Bal.status === 200 && cl1Bal.data.balance_pkr === 3.5 && cl1Bal.data.preferred_currency === 'PKR');

    const cl1GrpLogs = await cl1('GET', '/api/sms/logs?group_by=range');
    const cl1CsvExport = await cl1('GET', '/api/sms/export');
    check('6d Client /api/sms/logs & /api/sms/export return PKR summary, grouped PKR payout, and PKR CSV export',
      cl1LogsRes.data.summary?.currency === 'PKR' &&
      cl1LogsRes.data.summary?.client_payout_pkr === 3.5 &&
      cl1GrpLogs.data.summary?.client_payout_pkr === 3.5 &&
      cl1GrpLogs.data.data?.[0]?.client_payout_pkr === 3.5 &&
      cl1CsvExport.status === 200 &&
      typeof cl1CsvExport.data === 'string' &&
      (cl1CsvExport.data.includes('MY PAYOUT (PKR)') || cl1CsvExport.data.includes('My Payout (PKR)')));

    // 7. Client submits PKR payout request & Agent approves it (Owner privacy enforced!)
    const clPayoutReq = await cl1('POST', '/api/payout-requests', { amount: 2.5, currency: 'PKR', method: 'JazzCash', wallet: '03001234567' });
    check('7a Client submits 2.50 PKR payout request',
      clPayoutReq.status === 200 && clPayoutReq.data.currency === 'PKR' && clPayoutReq.data.status === 'pending');

    // Owner vs Agent Strict Privacy Boundary (Owner stops at Agents; zero Client visibility)
    const owClients = await ow('GET', '/api/clients');
    const owClientById = await ow('GET', '/api/clients/1');
    const owHierarchy = await ow('GET', '/api/hierarchy');
    const owHClients = (owHierarchy.data?.[0]?.agents || []).flatMap(a => a.clients || []);
    const owEarnings403 = await ow('GET', '/api/client/1/earnings');
    const owPayouts = await ow('GET', '/api/payout-requests');
    const owPatchClPayout = await ow('PATCH', `/api/payout-requests/${clPayoutReq.data.id}`, { status: 'paid' });

    check('7b Owner is strictly blocked (403) from /api/clients, /api/clients/:id, /api/client/:id/earnings & sees zero clients in /api/hierarchy',
      owClients.status === 403 && owClientById.status === 403 && owHClients.length === 0 && owEarnings403.status === 403);

    check('7c Owner cannot view or approve Client PKR payout requests (403)',
      !(owPayouts.data.data || []).some(p => Number(p.id) === Number(clPayoutReq.data.id)) &&
      owPatchClPayout.status === 403);

    // Agent sees FULL Client details & approves Client PKR payout
    const agClients = await ag1('GET', '/api/clients');
    const agC1 = (agClients.data.data || []).find(c => c.id === 1);
    const agApprovePayout = await ag1('PATCH', `/api/payout-requests/${clPayoutReq.data.id}`, { status: 'paid' });
    const cl1BalAfterPay = await cl1('GET', '/api/payments/balance');
    const cl1EarnAfterPay = await cl1('GET', '/api/client/1/earnings');
    const cl1CreditNotes = await cl1('GET', '/api/credit-notes');
    const paidNote = (cl1CreditNotes.data.data || []).find(n => Number(n.payout_request_id) === Number(clPayoutReq.data.id));

    check('7d Agent sees full Client bank/wallet & approves PKR payout cleanly (balance 3.5 -> 1.0 PKR + PKR Credit Note)',
      agC1 && agC1.iban === 'PK36HABB000000123456789' && agC1.wallet === '03001234567' &&
      agApprovePayout.status === 200 &&
      cl1BalAfterPay.data.balance_pkr === 1 &&
      cl1EarnAfterPay.status === 200 &&
      cl1EarnAfterPay.data.main_balance_pkr === 1 &&
      cl1EarnAfterPay.data.today_pkr === 3.5 &&
      paidNote && paidNote.currency === 'PKR' && paidNote.amount === 2.5,
      JSON.stringify({ agC1_iban: agC1?.iban, agC1_wallet: agC1?.wallet, agApprove: agApprovePayout.status, agApproveErr: agApprovePayout.data, balAfter: cl1BalAfterPay.data?.balance_pkr, earnPkr: cl1EarnAfterPay.data?.main_balance_pkr, paidNote }));

    // 7e. Weekly Client PKR Target 'block' enforcement on Client payout requests
    await ow('POST', '/api/settings', { min_payout_pkr: 0.5 });
    const blockCapRes = await ag1('PUT', '/api/agent/pkr-target', { weekly_pkr_target: 3.0, weekly_pkr_enforce_mode: 'block' });
    const overCapReq = await cl1('POST', '/api/payout-requests', { amount: 1.0, currency: 'PKR', method: 'JazzCash', wallet: '03001234567' });
    const raisedCapRes = await ag1('PUT', '/api/agent/pkr-target', { weekly_pkr_target: 5000, weekly_pkr_enforce_mode: 'block' });
    const withinCapReq = await cl1('POST', '/api/payout-requests', { amount: 1.0, currency: 'PKR', method: 'JazzCash', wallet: '03001234567' });
    check('7e Weekly Client PKR Target block mode rejects over-cap Client payout (400) and allows within-cap payout (200)',
      blockCapRes.status === 200 &&
      overCapReq.status === 400 &&
      raisedCapRes.status === 200 &&
      withinCapReq.status === 200,
      JSON.stringify({ overCapStatus: overCapReq.status, overCapErr: overCapReq.data, withinCapStatus: withinCapReq.status, withinCapErr: withinCapReq.data }));

    // 7f. Agent custom client_min_payout_pkr overrides global 2800 for own clients only
    await ow('POST', '/api/settings', { min_payout_pkr: 2800 });
    const cl1BeforeOverride = await cl1('GET', '/api/settings');
    const ag1SetMin = await ag1('PUT', '/api/agent/pkr-target', { client_min_payout_pkr: 500 });
    const cl1AfterOverride = await cl1('GET', '/api/settings');
    const cl1MinEndpoint = await cl1('GET', '/api/settings/min-payout');
    const cl3StillDefault = await cl3('GET', '/api/settings');
    const cl1LowPayout = await cl1('POST', '/api/payout-requests', { amount: 100, currency: 'PKR', method: 'JazzCash', wallet: '03001234567' });
    check('7f Agent custom client_min_payout_pkr (500) overrides global 2800 for own Client only & enforces on payout',
      cl1BeforeOverride.data?.min_payout_pkr === 2800 &&
      ag1SetMin.status === 200 && ag1SetMin.data?.client_min_payout_pkr === 500 &&
      cl1AfterOverride.data?.min_payout_pkr === 500 &&
      cl1MinEndpoint.data?.min_payout_pkr === 500 &&
      cl3StillDefault.data?.min_payout_pkr === 2800 &&
      cl1LowPayout.status === 400 && String(cl1LowPayout.data?.error || '').includes('500'),
      JSON.stringify({ before: cl1BeforeOverride.data?.min_payout_pkr, ag1Set: ag1SetMin.data, after: cl1AfterOverride.data?.min_payout_pkr, cl3: cl3StillDefault.data?.min_payout_pkr, lowErr: cl1LowPayout.data }));

    const ok = summary('PKR CLIENT RATE CARD & PRIVACY SUITE');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await srv.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
