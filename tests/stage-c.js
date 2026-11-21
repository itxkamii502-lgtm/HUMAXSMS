import { check, makeFixture, startServer, sleep, readJson } from './lib.js';

export async function stageC() {
  console.log('\n=== STAGE C: 3-tier rates, ledger & payments ===');
  const dir = makeFixture();
  const srv = await startServer(dir, 3922);
  const { api, login } = srv;

  try {
    const owner = await login('Kamran_Bhatti', 'ownerpass1');
    const agent1 = await login('agent_one', 'agentpass1');
    const client1 = await login('client_one', 'clientpass1');

    const ow = (m, u, body) => api(m, u, { cookie: owner.cookie, body });
    const ag = (m, u, body) => api(m, u, { cookie: agent1.cookie, body });
    const cl = (m, u, body) => api(m, u, { cookie: client1.cookie, body });

    // ── C1: Setup Range with company cost & payterms ──
    const createRangeRes = await ow('POST', '/api/numbers/sms-ranges', {
      range_name: 'Test Ledger Range',
      country: 'TestCountry',
      provider: 'TestTel',
      prefix: '23355',
      company_cost: 0.02,
      cost: 0.02,
      payout: 0.012,
      payterms: { 'Weekly': 0.012 }
    });
    check('C1 Owner creates range with company cost and payterms', createRangeRes.status === 200 && Number(createRangeRes.data.company_cost) === 0.02);

    await ow('PATCH', '/api/numbers/sms-ranges/1', { company_cost: 0.02, cost: 0.02, payout: 0.012, payterms: { 'Weekly': 0.012 } });

    const clRanges = await cl('GET', '/api/numbers/sms-ranges');
    const clRangeItem = (clRanges.data || []).find(r => r.id === createRangeRes.data.id);
    check('C1 Non-owner does not see company cost or cost in ranges', clRangeItem && clRangeItem.company_cost === undefined && clRangeItem.cost === undefined);

    // ── C2: Direct Rate Inheritance & Allocation Cap ──
    // Owner assigns Number 1 directly to Agent 1 -> inherits fixed agent_rate 0.012 from Range payterms
    const assignAgRes = await ow('POST', '/api/numbers/1/assign', { target_type: 'agent', target_id: 1, payterm: 'Weekly' });
    check('C2 Number assigned by Owner to Agent receives fixed agent_rate 0.012', assignAgRes.status === 200 && Number(assignAgRes.data.agent_rate) === 0.012);

    // Agent attempts to allocate with client_rate 0.015 (exceeding agent_rate 0.012) -> MUST BE REFUSED
    const badCapRes = await ag('POST', '/api/numbers/1/assign', { target_type: 'client', target_id: 1, client_rate: 0.015 });
    check('C2 client_rate 0.015 exceeds agent_rate 0.012 refused (400)', badCapRes.status === 400);

    // Agent attempts to PATCH number payout -> MUST BE REFUSED
    const agPatchPayout = await ag('PATCH', '/api/numbers/1', { payout: 0.05 });
    check('C2 Agent PATCH of number payout refused (403)', agPatchPayout.status === 403);

    // Non-owner PATCH forbidden fields -> MUST BE REFUSED (403)
    const agPatchClRate = await ag('PATCH', '/api/clients/1', { client_rate: 0.02 });
    check('C2 Agent PATCH /api/clients/:id with client_rate refused (403)', agPatchClRate.status === 403);

    const agPatchClBalance = await ag('PATCH', '/api/clients/1', { balance: 500 });
    check('C2 Agent PATCH /api/clients/:id with balance refused (403)', agPatchClBalance.status === 403);

    const agPatchClPerms = await ag('PATCH', '/api/clients/1', { permissions: ['all'], is_owner: true });
    check('C2 Agent PATCH /api/clients/:id with permissions/is_owner refused (403)', agPatchClPerms.status === 403);

    // Owner CAN PATCH agent_rate on agent
    const owPatchAgRate = await ow('PATCH', '/api/agents/1', { agent_rate: 0.015 });
    check('C2 Owner PATCH /api/agents/:id with agent_rate allowed (200)', owPatchAgRate.status === 200);

    // Numbers POST validation
    const postNoNumber = await ow('POST', '/api/numbers', { country: 'Ghana' });
    check('C2 POST /api/numbers with missing number returns 400', postNoNumber.status === 400);

    const postEmptyNumber = await ow('POST', '/api/numbers', { number: '   ' });
    check('C2 POST /api/numbers with empty number returns 400', postEmptyNumber.status === 400);

    const postDupNumber = await ow('POST', '/api/numbers', { number: '233500000001' });
    check('C2 POST /api/numbers with duplicate number returns 409', postDupNumber.status === 409);

    const postDupFormatted = await ow('POST', '/api/numbers', { number: '+233 (500) 000-001' });
    check('C2 POST /api/numbers with duplicate formatted number returns 409', postDupFormatted.status === 409);

    const postValidNumber = await ow('POST', '/api/numbers', { number: '233500999888', country: 'Ghana' });
    check('C2 POST /api/numbers with valid new number returns 200', postValidNumber.status === 200 && postValidNumber.data.number === '233500999888');

    // Agent allocates with client_rate 0.010 <= 0.012 -> ALLOWED
    const goodCapRes = await ag('POST', '/api/numbers/1/assign', { target_type: 'client', target_id: 1, client_rate: 0.010, client_payterm: 'Weekly' });
    check('C2 Agent allocates with client_rate 0.010 <= 0.012 allowed', goodCapRes.status === 200 && Number(goodCapRes.data.client_rate) === 0.010);

    // ── C3: 3-TIER LEDGER STAMPING ──
    // company_rate = 0.02, agent_rate = 0.012, client_rate = 0.010
    // => client_amount = 0.010, agent_amount = 0.002 (0.012 - 0.010), owner_amount = 0.008 (0.020 - 0.012)
    const inboundRes = await api('POST', '/api/sms/inbound', {
      body: { from: 'WhatsApp', to: '233500000001', message: 'Your WhatsApp Code 123456', sms_id: 'ledger-req-1' },
      headers: { 'x-inbound-token': 'inbound-secret' }
    });
    check('C3 Inbound SMS processed on configured number', inboundRes.status === 200 && inboundRes.data.logged === true);
    await sleep(250);

    const logs = readJson(dir, 'sms_log');
    const testSms = logs.find(s => s.sms_id === 'ledger-req-1');
    check('C3 Stamped entry exists', !!testSms);
    check('C3 client_amount === 0.010', testSms && Number(testSms.client_amount) === 0.010, `got ${testSms?.client_amount}`);
    check('C3 agent_amount === 0.002', testSms && Number(testSms.agent_amount) === 0.002, `got ${testSms?.agent_amount}`);
    check('C3 owner_amount === 0.008', testSms && Number(testSms.owner_amount) === 0.008, `got ${testSms?.owner_amount}`);

    // ── C4: History Unchanged After Rate Change ──
    await ow('PATCH', '/api/numbers/sms-ranges/1', { company_cost: 0.03, payout: 0.018, payterms: { 'Weekly': 0.018 } });
    const logsAfterRateChange = readJson(dir, 'sms_log');
    const testSmsAfterRate = logsAfterRateChange.find(s => s.sms_id === 'ledger-req-1');
    check('C4 Historical SMS amounts unchanged after later range rate update',
      testSmsAfterRate && Number(testSmsAfterRate.owner_amount) === 0.008 && Number(testSmsAfterRate.agent_amount) === 0.002 && Number(testSmsAfterRate.client_amount) === 0.010);

    // ── C5: Move Number Keeps Old Amounts ──
    const moveRes = await ag('POST', '/api/numbers/1/move', { to_client_id: 2, client_rate: 0.008 });
    check('C5 Number moved from Client 1 to Client 2', moveRes.status === 200);

    const logsAfterMove = readJson(dir, 'sms_log');
    const oldRow = logsAfterMove.find(s => s.sms_id === 'ledger-req-1');
    check('C5 Moving number keeps Client 1 old stamped row and amounts untouched', oldRow && Number(oldRow.client_id) === 1 && Number(oldRow.client_amount) === 0.010);

    // ── C6: Unallocated SMS = owner_amount = company_rate ──
    // Reset Range 1 company_cost back to 0.02 for clear assertion
    await ow('PATCH', '/api/numbers/sms-ranges/1', { company_cost: 0.02, cost: 0.02 });
    const unallocSms = await api('POST', '/api/sms/inbound', {
      body: { from: 'Twitter', to: '233500000010', message: 'Twitter OTP 777777', sms_id: 'ledger-unalloc-1' },
      headers: { 'x-inbound-token': 'inbound-secret' }
    });
    check('C6 Unallocated SMS received', unallocSms.status === 200 && unallocSms.data.logged === true);
    await sleep(250);

    const logsAfterUnalloc = readJson(dir, 'sms_log');
    const unallocRow = logsAfterUnalloc.find(s => s.sms_id === 'ledger-unalloc-1');
    check('C6 Unallocated SMS owner_amount === company_rate (0.02) and agent/client 0',
      unallocRow && Number(unallocRow.owner_amount) === 0.02 && Number(unallocRow.agent_amount) === 0 && Number(unallocRow.client_amount) === 0);

    // ── C7: Warning List & Reconciliation ──
    const noRateRes = await ow('GET', '/api/numbers/no-rate-ranges');
    check('C7 Owner can fetch no-rate ranges warning list', noRateRes.status === 200 && Array.isArray(noRateRes.data.ranges));

    const reconRes = await ow('GET', '/api/finance/reconciliation');
    check('C7 Financial reconciliation view is balanced (company === owner + agent + client)', reconRes.status === 200 && reconRes.data.reconciled === true);

    // ── C8: Payments & Balance ──
    const clBalRes = await cl('GET', '/api/payments/balance');
    check('C8 Client 1 balance equals stamped amount (0.010)', clBalRes.status === 200 && Number(clBalRes.data.balance) === 0.01);

    const payRecRes = await ag('POST', '/api/payments', { recipient_id: 1, recipient_role: 'Client', amount: 0.005 });
    check('C8 Agent records payout to Client', payRecRes.status === 200 && payRecRes.data.payment.amount === 0.005);

    const clBalAfter = await cl('GET', '/api/payments/balance');
    check('C8 Client 1 balance updated to remaining balance (0.005)', clBalAfter.status === 200 && Number(clBalAfter.data.balance) === 0.005);

  } finally {
    await srv.stop();
  }
}
