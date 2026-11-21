import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture, startServer, check, summary, readJson } from './lib.js';

const PORT = 3512;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function run() {
  const nowIso = new Date().toISOString();
  const dir = makeFixture({
    sms_ranges: [
      {
        id: 1,
        range_name: 'Audit Ghana Weekly',
        name: 'Audit Ghana Weekly',
        country: 'Ghana',
        provider: 'Direct',
        prefix: '233',
        company_cost: 0.01,
        cost: 0.01,
        rate: 0.02,
        payout: 0.02,
        currency: 'USD',
        payterm: 'Weekly',
        payterms: { Weekly: 0.02 },
        active: true
      },
      {
        id: 2,
        range_name: 'Whitenoise USA Monthly',
        name: 'Whitenoise USA Monthly',
        country: 'USA',
        provider: 'Whitenoise',
        is_whitenoise: true,
        prefix: '1212',
        company_cost: 0.02,
        cost: 0.02,
        rate: 0.04,
        payout: 0.04,
        currency: 'USD',
        payterm: 'Monthly',
        payterms: { Monthly: 0.04 },
        active: true
      }
    ],
    agents: [
      { id: 1, username: 'agent_one', password: 'agentpass1', role: 'Agent', status: 'active', whitenoise_access: true, created: nowIso }
    ],
    clients: [
      { id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', whitenoise_access: true, created: nowIso },
      { id: 2, username: 'client_two', password: 'clientpass2', role: 'Client', agent_id: 1, status: 'active', whitenoise_access: true, created: nowIso }
    ],
    numbers: [
      // 6 free in Owner Master Pool
      ...Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        number: `23355000100${i}`,
        country: 'Ghana',
        provider: 'Direct',
        range_id: 1,
        range_name: 'Audit Ghana Weekly',
        status: 'active',
        agent_id: null,
        client_id: null,
        user: '',
        created: nowIso
      })),
      // 3 free in Agent #1 Pool
      ...Array.from({ length: 3 }, (_, i) => ({
        id: i + 7,
        number: `23355000200${i}`,
        country: 'Ghana',
        provider: 'Direct',
        range_id: 1,
        range_name: 'Audit Ghana Weekly',
        status: 'assigned',
        agent_id: 1,
        agent_username: 'agent_one',
        client_id: null,
        user: '',
        created: nowIso
      })),
      // 1 held by Client #1 under Agent #1
      {
        id: 10,
        number: '233550003001',
        country: 'Ghana',
        provider: 'Direct',
        range_id: 1,
        range_name: 'Audit Ghana Weekly',
        status: 'assigned',
        agent_id: 1,
        agent_username: 'agent_one',
        client_id: 1,
        client_username: 'client_one',
        user: 'client_one',
        created: nowIso
      }
    ]
  });

  const srv = await startServer(dir, PORT);
  try {
    const owL = await srv.login('Kamran_Bhatti', 'ownerpass1');
    const agL = await srv.login('agent_one', 'agentpass1');
    const cl1L = await srv.login('client_one', 'clientpass1');
    check('Owner, Agent, and Client log in cleanly', Boolean(owL.ok && agL.ok && cl1L.ok));
    const asUser = (cookie) => (method, url, body) => srv.api(method, url, { cookie, body });
    const ow = asUser(owL.cookie);
    const ag = asUser(agL.cookie);
    const cl1 = asUser(cl1L.cookie);

    // Agent publishes PKR client rates on both ranges (allowed batches [10, 25])
    const r1Pub = await ag('POST', '/api/agent/client-rates', {
      range_id: 1,
      range_name: 'Audit Ghana Weekly',
      client_rate_pkr: 4.5,
      allowed_quantities: [10, 25],
      published: true
    });
    const r2Pub = await ag('POST', '/api/agent/client-rates', {
      range_id: 2,
      range_name: 'Whitenoise USA Monthly',
      client_rate_pkr: 9.0,
      allowed_quantities: [10, 25],
      published: true
    });
    check('Agent publishes PKR rates for Standard & Whitenoise ranges', r1Pub.status === 200 && r2Pub.status === 200);

    // 1. Accurate Free / Held Pool Counts across Owner, Agent, Client
    const ownRanges = await ow('GET', '/api/numbers/sms-ranges');
    const ownStd = (ownRanges.data || []).find(r => Number(r.id) === 1);
    check('Owner sees exact Total=10, Free=6, Held=4 on Audit Ghana Weekly',
      ownStd && ownStd.total_count === 10 && ownStd.free_count === 6 && ownStd.held_count === 4,
      JSON.stringify(ownStd));

    const agRanges = await ag('GET', '/api/numbers/sms-ranges');
    const agStd = (agRanges.data || []).find(r => Number(r.id) === 1);
    const agWn = (agRanges.data || []).find(r => Number(r.id) === 2);
    check('Agent sees real Owner Free Pool=6, Agent Held=4, Agent Free=3',
      agStd && agStd.owner_free_count === 6 && agStd.available === 6 && agStd.agent_held_count === 4 && agStd.agent_free_count === 3,
      JSON.stringify(agStd));
    check('Agent sees real 0 Free Pool on empty Whitenoise range (never fake 1500)',
      agWn && agWn.owner_free_count === 0 && agWn.available === 0,
      JSON.stringify(agWn));

    const clCard = await cl1('GET', '/api/client/rate-card');
    const clStd = (clCard.data?.ranges || []).find(r => Number(r.range_id) === 1);
    const clWn = (clCard.data?.ranges || []).find(r => Number(r.range_id) === 2);
    check('Client Rate Card sees exact Agent Free Pool=3 and Held=1',
      clStd && clStd.available === 3 && clStd.agent_free_count === 3 && clStd.held_count === 1,
      JSON.stringify(clStd));
    check('Client Rate Card scrubs raw "Whitenoise" from range name',
      clWn && !String(clWn.range_name || '').toLowerCase().includes('whitenoise'),
      JSON.stringify(clWn && clWn.range_name));

    // 2. Duplicate Pending Request Blocking (Agent & Client)
    const agReq1 = await ag('POST', '/api/numbers/request', {
      range_id: 1,
      range_name: 'Audit Ghana Weekly',
      quantity: 2,
      payterm: 'Weekly'
    });
    check('Agent 1st request succeeds (200)', agReq1.status === 200 && agReq1.data?.success);

    const agRangesPend = await ag('GET', '/api/numbers/sms-ranges');
    const agStdPend = (agRangesPend.data || []).find(r => Number(r.id) === 1);
    check('Agent range flags has_pending_request=true after 1st request',
      agStdPend && agStdPend.has_pending_request === true);

    const agReq2 = await ag('POST', '/api/numbers/request', {
      range_id: 1,
      range_name: 'Audit Ghana Weekly',
      quantity: 2,
      payterm: 'Weekly'
    });
    check('Agent duplicate pending request on same range blocked (409)',
      agReq2.status === 409 && /pending request/i.test(agReq2.data?.error || ''),
      `${agReq2.status}: ${JSON.stringify(agReq2.data)}`);

    const clReq1 = await cl1('POST', '/api/numbers/request', {
      range_id: 1,
      range_name: 'Audit Ghana Weekly',
      quantity: 10,
      payterm: 'Weekly'
    });
    check('Client 1st request (10/25 daily) succeeds (200)', clReq1.status === 200 && clReq1.data?.success);

    const clCardPend = await cl1('GET', '/api/client/rate-card');
    const clStdPend = (clCardPend.data?.ranges || []).find(r => Number(r.range_id) === 1);
    check('Client Rate Card flags block_reason=pending_request & can_request_now=false',
      clStdPend && clStdPend.has_pending_request === true && clStdPend.block_reason === 'pending_request' && clStdPend.can_request_now === false,
      JSON.stringify(clStdPend));

    const clReq2 = await cl1('POST', '/api/numbers/request', {
      range_id: 1,
      range_name: 'Audit Ghana Weekly',
      quantity: 10,
      payterm: 'Weekly'
    });
    check('Client duplicate pending request on same range blocked (409)',
      clReq2.status === 409 && /pending request/i.test(clReq2.data?.error || ''),
      `${clReq2.status}: ${JSON.stringify(clReq2.data)}`);

    // 3. Self-Allocate Empty Pool Clean Message
    await ow('PATCH', '/api/agents/1', { alloc_mode: 'self_allocate', daily_limit: 5, total_limit: 50 });
    const saEmpty = await ag('POST', '/api/numbers/agent-allocate', {
      range_id: 2,
      range_name: 'Whitenoise USA Monthly',
      count: 1,
      payterm: 'Monthly'
    });
    check('Self-allocate on 0-stock range returns 400 with clean message',
      saEmpty.status === 400 && /no free numbers/i.test(saEmpty.data?.error || ''),
      `${saEmpty.status}: ${JSON.stringify(saEmpty.data)}`);

    // 4. Protected Owner API Connection Delete (CR API, Whitenoise, Login Panels)
    const crAdd = await ow('POST', '/api/cr-api-connections', {
      panel_name: 'Protected CR API',
      panel_url: 'https://example.invalid/api',
      token: 'tok-test-123',
      interval: 10
    });
    const crId = crAdd.data?.id;
    check('Owner adds CR API connection', Boolean(crId));

    const crDelActive = await ow('DELETE', `/api/cr-api-connections/${crId}`, { password: 'ownerpass1' });
    check('Active CR API connection delete blocked (400)', crDelActive.status === 400);

    await ow('PATCH', `/api/cr-api-connections/${crId}`, { active: false });
    const crDelNoPwd = await ow('DELETE', `/api/cr-api-connections/${crId}`, {});
    check('Stopped CR API delete without Owner password blocked (403)', crDelNoPwd.status === 403);

    const crDelBadPwd = await ow('DELETE', `/api/cr-api-connections/${crId}`, { password: 'WrongPassword!' });
    check('Stopped CR API delete with wrong password blocked (403)', crDelBadPwd.status === 403);

    const crDelOk = await ow('DELETE', `/api/cr-api-connections/${crId}`, { password: 'ownerpass1' });
    check('Stopped CR API delete with valid Owner password succeeds (200)', crDelOk.status === 200 && crDelOk.data?.success);

    const lpAdd = await ow('POST', '/api/login-panels', {
      name: 'Protected Scraper',
      username: 'u@test.local',
      password: 'secret',
      panel_url: 'https://example.invalid',
      data_url: 'https://example.invalid/sms'
    });
    const lpId = lpAdd.data?.id;
    check('Owner adds Login Panel', Boolean(lpId));

    await ow('PATCH', `/api/login-panels/${lpId}`, { status: 'running' });
    const lpDelRun = await ow('DELETE', `/api/login-panels/${lpId}`, { password: 'ownerpass1' });
    check('Running Login Panel delete blocked (400)', lpDelRun.status === 400);

    await ow('POST', `/api/login-panels/${lpId}/stop`, {});
    const lpDelNoPwd = await ow('DELETE', `/api/login-panels/${lpId}`, {});
    check('Stopped Login Panel delete without Owner password blocked (403)', lpDelNoPwd.status === 403);

    const lpDelOk = await ow('DELETE', `/api/login-panels/${lpId}`, { password: 'ownerpass1' });
    check('Stopped Login Panel delete with valid Owner password succeeds (200)', lpDelOk.status === 200 && lpDelOk.data?.success);

    // 5. Client A -> Client B Transfer Ledger Integrity
    const moveRes = await ag('POST', '/api/numbers/10/move', { to_client_id: 2 });
    check('Agent moves number #10 from Client A to Client B cleanly (200)', moveRes.status === 200 && moveRes.data?.success);
    const ledger = readJson(dir, 'number_ownership_ledger') || [];
    const transferEvt = ledger.find(e => e.action === 'transfer' && Number(e.client_id) === 2);
    check('Ownership ledger automatically recorded transfer event for Client B', Boolean(transferEvt));

    // 6. Frontend Contract Checks (Modals locked, no fake 1500, clean error humanizer)
    const htmlFiles = ['index.html', 'agent.html', 'client.html'].map(f =>
      fs.readFileSync(path.join(ROOT, 'humex-sms', 'static', f), 'utf8')
    );
    check('No HTML modal overlay closes on backdrop click',
      htmlFiles.every(h => !h.includes('id="modal-overlay" onclick="closeModal()"')));

    const engineFiles = ['owner-engine.js', 'agent-engine.js', 'client-engine.js'].map(f =>
      fs.readFileSync(path.join(ROOT, 'humex-sms', 'static', 'js', f), 'utf8')
    );
    check('No engine JS closes modal on backdrop click',
      engineFiles.every(src => !src.includes('if (e.target === overlay) closeModal()')));

    const agentPagesSrc = fs.readFileSync(path.join(ROOT, 'humex-sms', 'static', 'js', 'agent-pages.js'), 'utf8');
    check('Fake ?? 1500 pool fallback removed from agent-pages.js', !agentPagesSrc.includes('?? 1500'));

    const clientEngineSrc = fs.readFileSync(path.join(ROOT, 'humex-sms', 'static', 'js', 'client-engine.js'), 'utf8');
    check('Raw "API Error ${response.status}:" removed from client-engine.js', !clientEngineSrc.includes('API Error ${response.status}'));

    const themeSrc = fs.readFileSync(path.join(ROOT, 'humex-sms', 'static', 'js', 'shared-brand-theme.js'), 'utf8');
    const m = themeSrc.match(/function zyHumanizeError[\s\S]*?\n  \}/);
    check('zyHumanizeError defined in shared-brand-theme.js', Boolean(m));
    if (m) {
      const fn = new Function(`${m[0]}; return zyHumanizeError;`)();
      const s1 = fn('API Error 400: {"error":"No free numbers available right now."}', 400);
      const s2 = fn('HTTP 430: Request Header Fields Too Large', 430);
      const s3 = fn('<!DOCTYPE html><html><body>500</body></html>', 500);
      check('zyHumanizeError strips raw JSON + 400 prefix cleanly', s1 === 'No free numbers available right now.', s1);
      check('zyHumanizeError turns raw 430 error into clean English', !/430/.test(s2) && s2.length > 10, s2);
      check('zyHumanizeError replaces raw HTML 500 page with clean message', !/500|html/i.test(s3) && s3.length > 10, s3);
    }
  } finally {
    await srv.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  const ok = summary('Modals, Pools, Pending Locks & API Protection Audit');
  process.exit(ok ? 0 : 1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
