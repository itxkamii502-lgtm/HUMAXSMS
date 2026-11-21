import { check, makeFixture, startServer, sleep, readJson } from './lib.js';

export async function stageB() {
  console.log('\n=== STAGE B: 3-tier hierarchy, holder pool & move ===');
  const dir = makeFixture();
  const srv = await startServer(dir, 3921);
  const { api, login } = srv;

  try {
    const owner = await login('Kamran_Bhatti', 'ownerpass1');
    const agent1 = await login('agent_one', 'agentpass1');
    const agent2 = await login('agent_direct', 'agentpass2');
    const client1 = await login('client_one', 'clientpass1');
    const client2 = await login('client_two', 'clientpass2');

    const ow = (m, u, body) => api(m, u, { cookie: owner.cookie, body });
    const ag = (m, u, body) => api(m, u, { cookie: agent1.cookie, body });
    const ag2 = (m, u, body) => api(m, u, { cookie: agent2.cookie, body });

    // ── B0: Account Creation Rules (Direct 3-Tier: Owner -> Agent -> Client) ──
    const createMgr = await ow('POST', '/api/users', { username: 'mgr_new', password: 'password123', role: 'Manager' });
    check('B0 Owner cannot create Manager (role permanently removed)', createMgr.status >= 400);

    const ownerCreateClient = await ow('POST', '/api/users', { username: 'cl_bad', password: 'password123', role: 'Client' });
    check('B0 Owner cannot create Client via /api/users', ownerCreateClient.status === 403);

    const ownerCreateClientDirect = await ow('POST', '/api/clients', { username: 'cl_bad2', password: 'password123' });
    check('B0 Owner cannot create Client via /api/clients (403)', ownerCreateClientDirect.status === 403);

    const ownerCreateAgent = await ow('POST', '/api/agents', { username: 'agent_by_owner', password: 'password123' });
    check('B0 Owner can create Agent directly', ownerCreateAgent.status === 200 && ownerCreateAgent.data.username === 'agent_by_owner');

    // Agent creates ONLY Clients
    const agentCreateClient = await ag('POST', '/api/clients', { username: 'client_by_agent', password: 'password123' });
    check('B0 Agent can create Client', agentCreateClient.status === 200 && Number(agentCreateClient.data.agent_id) === 1);

    const agentCreateAgent = await ag('POST', '/api/agents', { username: 'ag_ag_bad', password: 'password123' });
    check('B0 Agent cannot create Agent (403)', agentCreateAgent.status === 403);

    // Exactly one Owner
    const fakeOwner = await ow('POST', '/api/users', { username: 'new_owner', password: 'password123', role: 'Owner' });
    check('B0 New Owner cannot be created', fakeOwner.status >= 400);

    // ── B1: Account Deletion & Deactivation Protection (Strict Agent-Owned Client Privacy) ──
    const ag2DelCl403 = await ag2('DELETE', `/api/clients/${agentCreateClient.data.id}`);
    check('B1 Non-owning Agent cannot delete another Agent client (403)', ag2DelCl403.status === 403);

    const owPatchCl403 = await ow('PATCH', `/api/clients/${agentCreateClient.data.id}`, { status: 'inactive' });
    const owDelCl403 = await ow('DELETE', `/api/clients/${agentCreateClient.data.id}`);
    check('B1 Owner is strictly blocked (403) from modifying or deleting Agent clients', owPatchCl403.status === 403 && owDelCl403.status === 403);

    const deactCl = await ag('PATCH', `/api/clients/${agentCreateClient.data.id}`, { status: 'inactive' });
    check('B1 Agent can deactivate own Client', deactCl.status === 200 && deactCl.data.status === 'inactive');

    const deactLogin = await login('client_by_agent', 'password123');
    check('B1 Deactivated account cannot log in', !deactLogin.ok);

    // Account with history cannot be deleted by owning Agent unless first deactivated
    await api('POST', '/api/sms/inbound', { body: { from: 'Apple', to: '233500000005', message: 'Auth Code 555555', sms_id: 'b1-hist-1' }, headers: { 'x-inbound-token': 'inbound-secret' } });
    await sleep(1800);
    const agDelActiveWithHist = await ag('DELETE', '/api/clients/1');
    check('B1 Agent cannot delete active Client with history (400)', agDelActiveWithHist.status === 400);

    await ag('PATCH', '/api/clients/1', { status: 'inactive' });
    const agDelDeactWithHist = await ag('DELETE', '/api/clients/1');
    check('B1 Owning Agent can delete deactivated Client with history (200)', agDelDeactWithHist.status === 200);

    const allSmsAfter = readJson(dir, 'sms_log');
    check('B1 Client SMS history kept and never auto-removed', allSmsAfter.some(s => s.message && s.message.includes('555555')));

    const delOwner = await ow('DELETE', '/api/users/1');
    check('B1 Owner cannot delete Kamran_Bhatti', delOwner.status >= 400);

    // ── B2: Number Pools (ONE HOLDER, 3-Tier Direct: Owner -> Agent -> Client) ──
    // Owner cannot assign directly to Client
    const owAssignClDirect = await ow('POST', '/api/numbers/1/assign', { target_type: 'client', target_id: 2 });
    check('B2 Owner cannot assign number directly to Client (400)', owAssignClDirect.status === 400);

    // Number 1 is in Owner pool. Owner assigns it directly to Agent 1.
    const owAssignAg = await ow('POST', '/api/numbers/1/assign', { target_type: 'agent', target_id: 1 });
    check('B2 Owner assigns number directly to Agent 1 pool', owAssignAg.status === 200 && Number(owAssignAg.data.agent_id) === 1 && owAssignAg.data.client_id === null);

    // Owner cannot give away number that is already held downline
    const owAssignAgain = await ow('POST', '/api/numbers/1/assign', { target_type: 'agent', target_id: 2 });
    check('B2 Owner cannot re-assign number held by Agent 1 (400)', owAssignAgain.status === 400);

    // Agent 2 cannot assign Agent 1's number
    const ag2Assign = await ag2('POST', '/api/numbers/1/assign', { target_type: 'client', target_id: 3 });
    check('B2 Agent cannot assign number outside their pool (403)', ag2Assign.status === 403);

    // Agent 1 assigns Number 1 to Client 2
    const agAssignCl = await ag('POST', '/api/numbers/1/assign', { target_type: 'client', target_id: 2 });
    check('B2 Agent 1 assigns number to Client 2', agAssignCl.status === 200 && Number(agAssignCl.data.client_id) === 2);

    // Owner gives number 2 directly to Agent 2
    const owAssignAg2 = await ow('POST', '/api/numbers/2/assign', { target_type: 'agent', target_id: 2 });
    check('B2 Owner gives number directly to Agent 2', owAssignAg2.status === 200 && Number(owAssignAg2.data.agent_id) === 2);

    // ── B3: Unallocate & Return directly to Owner Master Pool ──
    const agUnalloc = await ag('POST', '/api/numbers/1/unassign');
    const num1AfterUnalloc = (readJson(dir, 'numbers')).find(n => n.id === 1);
    check('B3 Agent unallocates number back into Agent pool', agUnalloc.status === 200 && num1AfterUnalloc.client_id === null && Number(num1AfterUnalloc.agent_id) === 1);

    const agReturn = await ag('POST', '/api/numbers/1/return');
    const num1AfterAgReturn = (readJson(dir, 'numbers')).find(n => n.id === 1);
    check('B3 Agent returns number directly to Owner Master Pool', agReturn.status === 200 && num1AfterAgReturn.agent_id === null && num1AfterAgReturn.client_id === null);

    // ── B4: MOVE Number Directly from Client A to Client B ──
    await api('POST', '/api/sms/inbound', { body: { from: 'Google', to: '233500000005', message: 'Before Move Code 1111', sms_id: 'move-pre-1' }, headers: { 'x-inbound-token': 'inbound-secret' } });
    await sleep(200);

    const moveRes = await ag('POST', '/api/numbers/5/move', { to_client_id: 2 });
    check('B4 Agent moves number directly to Client 2', moveRes.status === 200 && Number(moveRes.data.number.client_id) === 2);

    await api('POST', '/api/sms/inbound', { body: { from: 'Google', to: '233500000005', message: 'After Move Code 2222', sms_id: 'move-post-1' }, headers: { 'x-inbound-token': 'inbound-secret' } });
    await sleep(200);

    const cl2Sms = await api('GET', '/api/sms/logs', { cookie: client2.cookie });
    const cl2Messages = ((cl2Sms.data && cl2Sms.data.data) || []).map(s => s.message);
    check('B4 Client 2 gets new SMS after move', cl2Messages.some(m => m && m.includes('2222')));
    check('B4 Client 2 NEVER sees old SMS from before move', !cl2Messages.some(m => m && m.includes('1111')));

    const owSms = await ow('GET', '/api/sms/logs');
    const owMessages = ((owSms.data && owSms.data.data) || []).map(s => s.message);
    check('B4 Owner sees all SMS before and after move', owMessages.some(m => m && m.includes('1111')) && owMessages.some(m => m && m.includes('2222')));

    // ── B5: Unallocated SMS logging ──
    const unallocSms = await api('POST', '/api/sms/inbound', { body: { from: 'Amazon', to: '233500000009', message: 'Unallocated OTP 999999', sms_id: 'unalloc-1' }, headers: { 'x-inbound-token': 'inbound-secret' } });
    check('B5 Unallocated number SMS is logged successfully', unallocSms.status === 200 && unallocSms.data.logged === true);
    await sleep(200);

    const latestLog = (readJson(dir, 'sms_log')).find(s => s.message && s.message.includes('999999'));
    check('B5 Unallocated SMS row keeps agent_id and client_id null', latestLog && latestLog.agent_id === null && latestLog.client_id === null);

    const owLogsAfter = await ow('GET', '/api/sms/logs');
    const owHasUnalloc = ((owLogsAfter.data && owLogsAfter.data.data) || []).some(s => s.message && s.message.includes('999999'));
    check('B5 Unallocated SMS visible to Owner', owHasUnalloc);

    const agLogsAfter = await ag('GET', '/api/sms/logs');
    const agHasUnalloc = ((agLogsAfter.data && agLogsAfter.data.data) || []).some(s => s.message && s.message.includes('999999'));
    check('B5 Unallocated SMS hidden from Agent', !agHasUnalloc);

  } finally {
    await srv.stop();
  }
}
