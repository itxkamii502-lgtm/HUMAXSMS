import fs from 'fs';
import path from 'path';
import { makeFixture, startServer, check, summary, readJson } from './lib.js';

const PORT = 3499;

function writeJson(dir, name, data) {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}

async function run() {
  const nowIso = new Date().toISOString();
  const dir = makeFixture({
    sms_ranges: [
      {
        id: 1,
        range_name: 'Ghana Weekly Only',
        name: 'Ghana Weekly Only',
        country: 'Ghana',
        provider: 'Orange',
        prefix: '233',
        cost: 0.03,
        company_cost: 0.03,
        payout: 0.02,
        payterm: 'Weekly',
        active_payterms: ['Weekly'],
        payterms: { Weekly: 0.02 },
        currency: 'USD'
      },
      {
        id: 2,
        range_name: 'Kenya Monthly Only',
        name: 'Kenya Monthly Only',
        country: 'Kenya',
        provider: 'Whitenoise',
        prefix: '254',
        cost: 0.04,
        company_cost: 0.04,
        payout: 0.025,
        payterm: 'Monthly',
        active_payterms: ['Monthly'],
        payterms: { Monthly: 0.025 },
        currency: 'USD'
      },
      {
        id: 3,
        range_name: 'Nigeria Weekly Route',
        name: 'Nigeria Weekly Route',
        country: 'Nigeria',
        provider: 'MTN',
        prefix: '234',
        cost: 0.03,
        company_cost: 0.03,
        payout: 0.02,
        payterm: 'Weekly',
        active_payterms: ['Weekly'],
        payterms: { Weekly: 0.02 },
        currency: 'USD'
      }
    ],
    numbers: [
      // 80 numbers in Range 1 assigned to agent_one
      ...Array.from({ length: 80 }, (_, idx) => ({
        id: idx + 1,
        number: `23350000${String(idx + 1).padStart(4, '0')}`,
        country: 'Ghana',
        provider: 'Orange',
        range_id: 1,
        range_name: 'Ghana Weekly Only',
        payterm: 'Weekly',
        status: 'assigned',
        agent_id: 1,
        agent_username: 'agent_one',
        client_id: null,
        user: '',
        created: nowIso
      })),
      // 2 free numbers in Owner pool for Agent A test
      { id: 901, number: '233599990001', country: 'Ghana', provider: 'Orange', range_id: 1, range_name: 'Ghana Weekly Only', payterm: 'Weekly', status: 'available', agent_id: null, client_id: null, user: '', created: nowIso },
      { id: 902, number: '233599990002', country: 'Ghana', provider: 'Orange', range_id: 1, range_name: 'Ghana Weekly Only', payterm: 'Weekly', status: 'available', agent_id: null, client_id: null, user: '', created: nowIso },
      // 60 numbers in Range 2 assigned to agent_one
      ...Array.from({ length: 60 }, (_, idx) => ({
        id: 100 + idx + 1,
        number: `25470000${String(idx + 1).padStart(4, '0')}`,
        country: 'Kenya',
        provider: 'Whitenoise',
        range_id: 2,
        range_name: 'Kenya Monthly Only',
        payterm: 'Monthly',
        status: 'assigned',
        agent_id: 1,
        agent_username: 'agent_one',
        client_id: null,
        user: '',
        created: nowIso
      })),
      // 40 numbers in Range 3 assigned to agent_one
      ...Array.from({ length: 40 }, (_, idx) => ({
        id: 200 + idx + 1,
        number: `23480000${String(idx + 1).padStart(4, '0')}`,
        country: 'Nigeria',
        provider: 'MTN',
        range_id: 3,
        range_name: 'Nigeria Weekly Route',
        payterm: 'Weekly',
        status: 'assigned',
        agent_id: 1,
        agent_username: 'agent_one',
        client_id: null,
        user: '',
        created: nowIso
      }))
    ]
  });

  let srv = await startServer(dir, PORT);
  const reloginAll = async () => {
    const owLogin = await srv.login('Kamran_Bhatti', 'ownerpass1');
    const ag1Login = await srv.login('agent_one', 'agentpass1');
    return {
      ow: (m, u, b) => srv.api(m, u, { cookie: owLogin.cookie, body: b }),
      ag1: (m, u, b) => srv.api(m, u, { cookie: ag1Login.cookie, body: b }),
      owLogin,
      ag1Login
    };
  };

  try {
    let { ow, ag1, owLogin } = await reloginAll();
    check('Owner logged in cleanly', owLogin.ok);

    // ═══════════════════════════════════════════════════════════
    // PART 1: DELETED AGENT & CLIENT ZERO DATA LEAKAGE + MONOTONIC IDs
    // ═══════════════════════════════════════════════════════════
    const createAgA = await ow('POST', '/api/agents', {
      username: 'agent_temp_alpha',
      password: 'Password123!',
      email: 'alpha@test.local',
      status: 'active'
    });
    const agAId = createAgA.data?.id;
    check('1a Created Agent A cleanly', createAgA.status === 200 && Number(agAId) > 0);

    const agALogin = await srv.login('agent_temp_alpha', 'Password123!');
    check('1b Agent A logged in', agALogin.ok);
    const agA = (m, u, b) => srv.api(m, u, { cookie: agALogin.cookie, body: b });

    // Create 2 clients under Agent A
    const createCl1 = await agA('POST', '/api/clients', { username: 'alpha_cl_one', password: 'Password123!', status: 'active' });
    const createCl2 = await agA('POST', '/api/clients', { username: 'alpha_cl_two', password: 'Password123!', status: 'active' });
    const cl1Id = createCl1.data?.id;
    const cl2Id = createCl2.data?.id;
    check('1c Created 2 clients under Agent A', createCl1.status === 200 && createCl2.status === 200 && cl1Id && cl2Id);

    // Publish rate under Agent A, Owner assigns numbers 901 & 902 to Agent A, Agent A assigns to clients, deliver live SMS
    const saveAgARate = await agA('PUT', '/api/agent/client-rates', { range_id: 1, client_rate_pkr: 3.0, allowed_quantities: [25] });
    check('1d Agent A saved client PKR rate', saveAgARate.status === 200);

    const assignToAgA = await ow('POST', '/api/numbers/bulk-assign-many', { number_ids: [901, 902], target_type: 'agent', target_id: agAId });
    const assignToCl1 = await agA('POST', '/api/numbers/901/assign', { target_type: 'client', target_id: cl1Id });
    const assignToCl2 = await agA('POST', '/api/numbers/902/assign', { target_type: 'client', target_id: cl2Id });
    const smsToCl1 = await srv.api('POST', '/api/sms/inbound', {
      headers: { 'x-inbound-token': 'inbound-secret' },
      body: { to: '233599990001', from: 'WhatsApp', text: 'OTP 111222', sms_id: 'del-leak-sms-1' }
    });
    check('1d2 Assigned numbers & delivered inbound SMS to Agent A clients',
      assignToAgA.status === 200 && assignToCl1.status === 200 && assignToCl2.status === 200 && smsToCl1.status === 200);

    // Deactivate Agent A then Owner deletes Agent A
    const deactAgA = await ow('PATCH', `/api/agents/${agAId}`, { status: 'inactive' });
    const delAgA = await ow('DELETE', `/api/agents/${agAId}`);
    check('1e Owner deactivated & deleted Agent A cleanly', deactAgA.status === 200 && delAgA.status === 200 && delAgA.data.success === true);

    // Verify Agent A's 2 clients are ALSO deleted, numbers released to Owner pool, and SMS logs tombstoned
    const clientsAfterDel = readJson(dir, 'clients');
    const numsAfterDel = readJson(dir, 'numbers');
    const ratesAfterDel = readJson(dir, 'agent_client_rates');
    const smsAfterDel = readJson(dir, 'sms_log');
    const n901 = numsAfterDel.find(n => n.id === 901);
    const s901 = smsAfterDel.find(s => s.sms_id === 'del-leak-sms-1');
    check('1f Deleting Agent A cascaded cleanup to clients, numbers, rates & tombstoned sms_log',
      !clientsAfterDel.some(c => Number(c.agent_id) === Number(agAId)) &&
      n901 && n901.agent_id === null && n901.client_id === null && n901.status === 'active' &&
      !ratesAfterDel.some(r => Number(r.agent_id) === Number(agAId)) &&
      s901 && s901.agent_id === null && s901.client_id === null && String(s901.agent_username).startsWith('__deleted_agent_'));

    // Create brand-new Agent B with a DIFFERENT name
    const createAgB = await ow('POST', '/api/agents', {
      username: 'agent_brand_new_beta',
      password: 'Password123!',
      email: 'beta@test.local',
      status: 'active'
    });
    const agBId = createAgB.data?.id;
    check('1g New Agent B gets a strictly higher non-reused ID', createAgB.status === 200 && Number(agBId) > Number(agAId));

    const agBLogin = await srv.login('agent_brand_new_beta', 'Password123!');
    const agB = (m, u, b) => srv.api(m, u, { cookie: agBLogin.cookie, body: b });
    const agBClients = await agB('GET', '/api/clients');
    const agBNums = await agB('GET', `/api/numbers?agent_id=${agBId}`);
    const agBSms = await agB('GET', '/api/sms/logs?limit=50');
    const agBRates = await agB('GET', '/api/agent/client-rates');
    check('1h New Agent B starts 100% clean (0 clients, 0 numbers, 0 SMS, 0 configured rates)',
      (agBClients.data?.data || agBClients.data || []).length === 0 &&
      (agBNums.data?.data || []).length === 0 &&
      (agBSms.data?.data || []).length === 0 &&
      Number(agBRates.data?.configured_count || 0) === 0);

    // Same test for Client: delete & recreate with EXACT SAME username
    await ag1('PUT', '/api/agent/client-rates', { range_id: 1, client_rate_pkr: 3.5, allowed_quantities: [25] });
    const createTempCl = await ag1('POST', '/api/clients', { username: 'reuse_client_name', password: 'Password123!', status: 'active' });
    const tempClId = createTempCl.data?.id;
    check('1i Created temporary client under agent_one', createTempCl.status === 200 && tempClId > 0);

    // Assign number 80 & deliver 1 live SMS to reuse_client_name
    const assignN80 = await ag1('POST', '/api/numbers/80/assign', { target_type: 'client', target_id: tempClId });
    const smsN80 = await srv.api('POST', '/api/sms/inbound', {
      headers: { 'x-inbound-token': 'inbound-secret' },
      body: { to: '233500000080', from: 'Google', text: 'Code 555666', sms_id: 'del-cl-sms-1' }
    });
    check('1i2 Assigned number 80 & delivered SMS to reuse_client_name', assignN80.status === 200 && smsN80.status === 200);

    // Deactivate & owning Agent deletes reuse_client_name (Owner is strictly 403 blocked!)
    const owBlockedCl = await ow('DELETE', `/api/clients/${tempClId}`);
    const deactTempCl = await ag1('PATCH', `/api/clients/${tempClId}`, { status: 'inactive' });
    const delTempCl = await ag1('DELETE', `/api/clients/${tempClId}`);
    check('1j Owning Agent deactivated & deleted temporary client cleanly (Owner blocked 403)', owBlockedCl.status === 403 && deactTempCl.status === 200 && delTempCl.status === 200 && delTempCl.data.success === true);

    // Enable whitenoise_access on agent_one so Monthly {W} Range 2 is visible in Part 2 & 3
    await ow('PATCH', '/api/agents/1', { whitenoise_access: true });

    // Recreate client with EXACT SAME username (with whitenoise_access for Range 2)
    const recreateCl = await ag1('POST', '/api/clients', { username: 'reuse_client_name', password: 'Password123!', status: 'active', whitenoise_access: true });
    const newClId = recreateCl.data?.id;
    check('1k Recreated client with same username gets strictly higher ID', recreateCl.status === 200 && Number(newClId) > Number(tempClId));

    let newClLogin = await srv.login('reuse_client_name', 'Password123!');
    let newCl = (m, u, b) => srv.api(m, u, { cookie: newClLogin.cookie, body: b });
    const newClNums = await newCl('GET', `/api/numbers?client_id=${newClId}`);
    const newClSms = await newCl('GET', '/api/sms/logs?limit=50');
    const newClBal = await newCl('GET', '/api/payments/balance');
    check('1l Recreated client with same username sees ZERO old numbers, ZERO old SMS, 0 balance',
      (newClNums.data?.data || []).length === 0 &&
      (newClSms.data?.data || []).length === 0 &&
      Number(newClBal.data?.balance_pkr || 0) === 0);

    // ═══════════════════════════════════════════════════════════
    // PART 2: STRICT ACTIVE PAYTERMS (OWNER -> AGENT -> CLIENT)
    // ═══════════════════════════════════════════════════════════
    await ag1('PUT', '/api/agent/client-rates', { range_id: 2, client_rate_pkr: 4.0, allowed_quantities: [25] });
    await ag1('PUT', '/api/agent/client-rates', { range_id: 3, client_rate_pkr: 3.2, allowed_quantities: [25] });

    const agRanges = await ag1('GET', '/api/numbers/sms-ranges');
    const agR1 = (agRanges.data || []).find(r => r.id === 1);
    const agR2 = (agRanges.data || []).find(r => r.id === 2);
    const agR3 = (agRanges.data || []).find(r => r.id === 3);
    check('2a Agent ranges API returns strict payterms (Standard = Weekly-only, Whitenoise = Monthly-only, zero Biweekly)',
      agR1 && JSON.stringify(agR1.active_payterms) === '["Weekly"]' && agR1.payterms.Weekly === 0.02 && agR1.payterms.Monthly === undefined &&
      agR2 && JSON.stringify(agR2.active_payterms) === '["Monthly"]' && agR2.payterms.Monthly === 0.025 && agR2.payterms.Weekly === undefined &&
      agR3 && JSON.stringify(agR3.active_payterms) === '["Weekly"]' && !agR3.active_payterms.includes('Biweekly'));

    const clCard = await newCl('GET', '/api/client/rate-card');
    const clR1 = (clCard.data?.ranges || []).find(r => r.range_id === 1);
    const clR2 = (clCard.data?.ranges || []).find(r => r.range_id === 2);
    check('2b Client rate card returns ONLY active payterms_pkr (inactive payterms omitted for N/A)',
      clR1 && JSON.stringify(clR1.active_payterms) === '["Weekly"]' && clR1.payterms_pkr.Weekly === 3.5 && clR1.payterms_pkr.Monthly === undefined && clR1.payterms_pkr.Biweekly === undefined &&
      clR2 && JSON.stringify(clR2.active_payterms) === '["Monthly"]' && clR2.payterms_pkr.Monthly === 4.0 && clR2.payterms_pkr.Weekly === undefined && clR2.payterms_pkr.Biweekly === undefined);

    const badPt1 = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 25, payterm: 'Monthly' });
    check('2c Requesting Monthly on Weekly-only range rejected (400)', badPt1.status === 400);

    const badPt2 = await newCl('POST', '/api/numbers/request', { range_id: 2, range_name: 'Kenya Monthly Only', quantity: 25, payterm: 'Weekly' });
    check('2d Requesting Weekly on Monthly-only Whitenoise range rejected (400)', badPt2.status === 400);

    const badPtAg = await ag1('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 10, payterm: 'Biweekly' });
    check('2e Agent requesting removed payterm Biweekly on Weekly-only range rejected (400)', badPtAg.status === 400);

    // ═══════════════════════════════════════════════════════════
    // PART 3 & 4: CLIENT PER-RANGE LIMITS (25/day, 50 held, 3/week,
    //             UNLIMITED CROSS-RANGE) + DATE-TO-DATE RANGE RETURN
    // ═══════════════════════════════════════════════════════════
    const overDaily = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 50, payterm: 'Weekly' });
    check('3a Requesting 50 in one day on a range is blocked (400; daily max is 25)', overDaily.status === 400);

    // Day 1: Request 25 on Range 1 (Weekly) -> OK (200)
    const req1R1 = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 25, payterm: 'Weekly' });
    check('3b Day 1: Request 25 on Range 1 accepted (200)', req1R1.status === 200);

    // Same day 2nd request on SAME Range 1 -> blocked (429)
    const dupDayR1 = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 1, payterm: 'Weekly' });
    check('3c Same day 2nd request on SAME Range 1 blocked (429)', dupDayR1.status === 429);

    // Same day request 25 on DIFFERENT Range 2 (Monthly {W}) AND Range 3 (Weekly) -> BOTH allowed (unlimited cross-range!)
    const req1R2 = await newCl('POST', '/api/numbers/request', { range_id: 2, range_name: 'Kenya Monthly Only', quantity: 25, payterm: 'Monthly' });
    const req1R3 = await newCl('POST', '/api/numbers/request', { range_id: 3, range_name: 'Nigeria Weekly Route', quantity: 25, payterm: 'Weekly' });
    check('3d Unlimited cross-range: same-day 25 on Range 2 and Range 3 BOTH accepted (200)', req1R2.status === 200 && req1R3.status === 200);

    // Fulfill req1R1 and req1R2 so Client holds 25 in Range 1 and 25 in Range 2
    const ful1 = await ag1('POST', `/api/agent-requests/${req1R1.data.request.id}/fulfill`, { count: 25 });
    const ful2 = await ag1('POST', `/api/agent-requests/${req1R2.data.request.id}/fulfill`, { count: 25 });
    check('3e Agent fulfilled Range 1 (25) & Range 2 (25) cleanly', ful1.status === 200 && ful2.status === 200);

    // Backdate Day 1's Range 1 numbers & request to 2 days ago (Date A) and restart server to flush cache
    const dateA = new Date(Date.now() - 2 * 86400000).toISOString();
    const dateAStr = dateA.slice(0, 10);
    const dateB = new Date(Date.now() - 1 * 86400000).toISOString();
    const dateBStr = dateB.slice(0, 10);

    await srv.stop();
    const reqsDisk1 = readJson(dir, 'number_requests');
    const r1First = reqsDisk1.find(r => r.id === req1R1.data.request.id);
    r1First.created = dateA;
    r1First.created_at = dateA;
    writeJson(dir, 'number_requests', reqsDisk1);

    const numsDisk1 = readJson(dir, 'numbers');
    numsDisk1.filter(n => Number(n.client_id) === Number(newClId) && Number(n.range_id) === 1).forEach(n => {
      n.assigned_at = dateA;
      n.assigned_date = dateA;
      n.client_assigned_at = dateA;
      n.allocated_at = dateA;
    });
    writeJson(dir, 'numbers', numsDisk1);

    srv = await startServer(dir, PORT);
    ({ ow, ag1 } = await reloginAll());
    newClLogin = await srv.login('reuse_client_name', 'Password123!');
    newCl = (m, u, b) => srv.api(m, u, { cookie: newClLogin.cookie, body: b });

    // Day 2: Request 25 more on Range 1 -> accepted (now 2nd add in 7 days, total 50 held after fulfill)
    const req2R1 = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 25, payterm: 'Weekly' });
    check('3f Day 2: Request 25 more on Range 1 accepted (200)', req2R1.status === 200);
    const ful1b = await ag1('POST', `/api/agent-requests/${req2R1.data.request.id}/fulfill`, { count: 25 });
    check('3g Fulfilled 2nd batch of 25 on Range 1 (now 50 active held)', ful1b.status === 200);

    // Backdate 2nd batch of Range 1 numbers & request to yesterday (Date B) and restart server
    await srv.stop();
    const reqsDisk2 = readJson(dir, 'number_requests');
    const r1Second = reqsDisk2.find(r => r.id === req2R1.data.request.id);
    r1Second.created = dateB;
    r1Second.created_at = dateB;
    writeJson(dir, 'number_requests', reqsDisk2);

    const numsDisk2 = readJson(dir, 'numbers');
    numsDisk2.filter(n => Number(n.client_id) === Number(newClId) && Number(n.range_id) === 1 && n.client_assigned_at !== dateA).forEach(n => {
      n.assigned_at = dateB;
      n.assigned_date = dateB;
      n.client_assigned_at = dateB;
      n.allocated_at = dateB;
    });
    writeJson(dir, 'numbers', numsDisk2);

    srv = await startServer(dir, PORT);
    ({ ow, ag1 } = await reloginAll());
    newClLogin = await srv.login('reuse_client_name', 'Password123!');
    newCl = (m, u, b) => srv.api(m, u, { cookie: newClLogin.cookie, body: b });

    // Day 3 while holding 50 in Range 1 -> request blocked due to MAX 50 HOLD CAP!
    const blockedHold = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 25, payterm: 'Weekly' });
    check('3h Request blocked when client already holds 50 numbers in Range 1 (400)', blockedHold.status === 400);

    // Check GET /api/numbers/range-return-batches for Range 1 -> must show ONLY Range 1's 2 date batches (25 on Date A, 25 on Date B)
    const batchesRes = await newCl('GET', '/api/numbers/range-return-batches?range_id=1');
    const batchA = (batchesRes.data?.batches || []).find(b => b.date === dateAStr);
    const batchB = (batchesRes.data?.batches || []).find(b => b.date === dateBStr);
    check('4a GET /api/numbers/range-return-batches lists 2 separate date batches (25 on Date A, 25 on Date B) strictly for Range 1',
      batchesRes.status === 200 && batchesRes.data.total_held === 50 &&
      batchesRes.data.batches.length === 2 && batchA && batchA.count === 25 && batchB && batchB.count === 25);

    // Return ONLY Date A's 25 numbers in Range 1
    const retDateA = await newCl('POST', '/api/numbers/return-by-date', { range_id: 1, dates: [dateAStr] });
    check('4b POST /api/numbers/return-by-date returns ONLY Date A (25 numbers)',
      retDateA.status === 200 && retDateA.data.returned_count === 25);

    // Verify Date B's 25 numbers in Range 1 AND all 25 numbers in Range 2 remain untouched!
    const numsAfterRetA = readJson(dir, 'numbers');
    const r1Remaining = numsAfterRetA.filter(n => Number(n.client_id) === Number(newClId) && Number(n.range_id) === 1);
    const r2Remaining = numsAfterRetA.filter(n => Number(n.client_id) === Number(newClId) && Number(n.range_id) === 2);
    check('4c Date B (25 in Range 1) and ALL of Range 2 (25) remain untouched after returning Date A of Range 1',
      r1Remaining.length === 25 && r1Remaining.every(n => String(n.assigned_at).startsWith(dateBStr)) && r2Remaining.length === 25);

    // Now holding 25 in Range 1 -> 3rd addition in 7 days (Today) is ALLOWED!
    const req3R1 = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 25, payterm: 'Weekly' });
    check('4d 3rd addition within 7 days on Range 1 accepted (200)', req3R1.status === 200);
    const ful1c = await ag1('POST', `/api/agent-requests/${req3R1.data.request.id}/fulfill`, { count: 25 });
    check('4e Fulfilled 3rd addition on Range 1', ful1c.status === 200);

    // Simulate next UTC day by backdating req3R1 to 3 days ago, restart server, return Date B's 25 numbers
    await srv.stop();
    const reqsDisk3 = readJson(dir, 'number_requests');
    const r1Third = reqsDisk3.find(r => r.id === req3R1.data.request.id);
    const dateC = new Date(Date.now() - 3 * 86400000).toISOString();
    r1Third.created = dateC;
    r1Third.created_at = dateC;
    writeJson(dir, 'number_requests', reqsDisk3);

    srv = await startServer(dir, PORT);
    ({ ow, ag1 } = await reloginAll());
    newClLogin = await srv.login('reuse_client_name', 'Password123!');
    newCl = (m, u, b) => srv.api(m, u, { cookie: newClLogin.cookie, body: b });

    const retDateB = await newCl('POST', '/api/numbers/return-by-date', { range_id: 1, dates: [dateBStr] });
    check('4f Returned Date B (25) so holding is 25/50 and daily is 0/25', retDateB.status === 200 && retDateB.data.returned_count === 25);

    // 4th addition within the same 7-day rolling week MUST BE BLOCKED (429)!
    const blockedWeekly = await newCl('POST', '/api/numbers/request', { range_id: 1, range_name: 'Ghana Weekly Only', quantity: 25, payterm: 'Weekly' });
    check('4g 4th addition within 7-day week on Range 1 strictly blocked (429)', blockedWeekly.status === 429);

    // Verify rate card exposes weekly_limit block_reason cleanly
    const clCardFinal = await newCl('GET', '/api/client/rate-card');
    const clR1Final = (clCardFinal.data?.ranges || []).find(r => r.range_id === 1);
    check('4h Client rate card reports held_count=25, weekly_adds_used=3, block_reason=weekly_limit',
      clR1Final && clR1Final.held_count === 25 && clR1Final.weekly_adds_used === 3 && clR1Final.block_reason === 'weekly_limit' && clR1Final.can_request_now === false);

    // Agent can also use range-return-batches & return-by-date for unassigned pool numbers
    const agBatches = await ag1('GET', '/api/numbers/range-return-batches?range_id=1');
    check('4i Agent can inspect unassigned pool date batches strictly for Range 1',
      agBatches.status === 200 && agBatches.data.total_held > 0 && Array.isArray(agBatches.data.batches) && agBatches.data.batches.length >= 1);

  } finally {
    await srv.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  summary('account-cleanup-range-rules.js');
}

run().catch(e => { console.error(e); process.exit(1); });
