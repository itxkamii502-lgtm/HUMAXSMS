#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import { WebSocket } from 'ws';
import { makeFixture, startServer } from './lib.js';

const PORT = 3997;

function connectWs(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: cookie } });
    const events = [];
    ws.on('message', (raw) => {
      try {
        const d = JSON.parse(String(raw));
        if (d.type && String(d.type).startsWith('chat:')) events.push(d);
      } catch (_) {}
    });
    ws.once('open', () => resolve({ ws, events }));
    ws.once('error', reject);
  });
}

function waitForEvent(events, pred, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      const hit = events.find(pred);
      if (hit || Date.now() - start > timeoutMs) {
        clearInterval(t);
        resolve(hit || null);
      }
    }, 30);
  });
}

async function main() {
  const dir = makeFixture();
  const srv = await startServer(dir, PORT);
  const req = async (url, opts = {}, cookie = '') => {
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    const r = await srv.api(method, url, { body, cookie });
    return { status: r.status, json: r.data, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
  };

  const sockets = [];
  try {
    // 1. Login Owner, Agent A (id=1), Agent B (id=2), Client 1 (agent_id=1), Client 3 (agent_id=2)
    const ownerLogin = await srv.login('Kamran_Bhatti', 'ownerpass1');
    assert(ownerLogin.ok, `Owner login failed: ${JSON.stringify(ownerLogin.res.data)}`);
    const ownerCookie = ownerLogin.cookie;

    const agALogin = await srv.login('agent_one', 'agentpass1');
    assert(agALogin.ok, `Agent A login failed`);
    const agACookie = agALogin.cookie;
    const agAId = 1;

    const agBLogin = await srv.login('agent_direct', 'agentpass2');
    assert(agBLogin.ok, `Agent B login failed`);
    const agBCookie = agBLogin.cookie;
    const agBId = 2;

    const cl1Login = await srv.login('client_one', 'clientpass1');
    assert(cl1Login.ok, `Client 1 login failed`);
    const cl1Cookie = cl1Login.cookie;
    const cl1Id = 1;

    const cl2Login = await srv.login('client_three', 'clientpass3');
    assert(cl2Login.ok, `Client 3 login failed`);
    const cl2Cookie = cl2Login.cookie;
    const cl2Id = 3;

    // Connect live WebSockets for all 5 actors
    const ownerWs = await connectWs(ownerCookie); sockets.push(ownerWs.ws);
    const agAWs = await connectWs(agACookie); sockets.push(agAWs.ws);
    const agBWs = await connectWs(agBCookie); sockets.push(agBWs.ws);
    const cl1Ws = await connectWs(cl1Cookie); sockets.push(cl1Ws.ws);
    const cl2Ws = await connectWs(cl2Cookie); sockets.push(cl2Ws.ws);

    // 2. Owner bootstrap sees Agents ONLY (no clients)
    const ownerBoot = await req('/api/chat/bootstrap', {}, ownerCookie);
    assert.strictEqual(ownerBoot.status, 200);
    assert(ownerBoot.json.contacts.every(c => c.role === 'agent'), 'Owner contacts must ONLY be agents');
    assert(ownerBoot.json.contacts.some(c => c.key === `agent:${agAId}`));

    // Owner CANNOT create groups
    const ownerGrpTry = await req('/api/chat/groups', {
      method: 'POST',
      body: JSON.stringify({ title: 'Forbidden Group', member_client_ids: [cl1Id] })
    }, ownerCookie);
    assert.strictEqual(ownerGrpTry.status, 403, 'Owner must NOT be able to create groups');

    // 3. Owner <-> Agent A 1-to-1 chat & alert_priority check
    const oaDirect = await req('/api/chat/direct', {
      method: 'POST',
      body: JSON.stringify({ target_key: `agent:${agAId}` })
    }, ownerCookie);
    assert.strictEqual(oaDirect.status, 200);
    const oaConvId = oaDirect.json.conversation.id;

    // Owner sends message -> Agent A must get alert_priority === 'admin_alert'
    const ownerSend = await req(`/api/chat/conversations/${oaConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Hello Agent Alpha 🔥' })
    }, ownerCookie);
    assert.strictEqual(ownerSend.status, 201);
    const agARecv = await waitForEvent(agAWs.events, e => e.type === 'chat:message' && e.conversation_id === oaConvId);
    assert(agARecv, 'Agent A did not receive Owner message over WS');
    assert.strictEqual(agARecv.alert_priority, 'admin_alert', 'Owner -> Agent message must trigger admin_alert');

    // Agent A replies to Owner -> Owner gets alert_priority === 'silent'
    const agReply = await req(`/api/chat/conversations/${oaConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Received Boss!', reply_to_id: ownerSend.json.message.id })
    }, agACookie);
    assert.strictEqual(agReply.status, 201);
    assert.strictEqual(agReply.json.message.reply_to.id, ownerSend.json.message.id, 'Quote reply must attach');
    const ownerRecv = await waitForEvent(ownerWs.events, e => e.type === 'chat:message' && e.message.id === agReply.json.message.id);
    assert(ownerRecv, 'Owner did not receive Agent reply over WS');
    assert.strictEqual(ownerRecv.alert_priority, 'silent', 'Agent -> Owner message must be silent');

    // 4. Agent A creates Client Group with Client 1 ONLY
    // First confirm Agent A CANNOT include Agent B's Client 2
    const crossAddTry = await req('/api/chat/groups', {
      method: 'POST',
      body: JSON.stringify({ title: 'Cross Try', member_client_ids: [cl1Id, cl2Id] })
    }, agACookie);
    assert.strictEqual(crossAddTry.status, 403, 'Agent A must NOT add Agent B client');

    const grpCreate = await req('/api/chat/groups', {
      method: 'POST',
      body: JSON.stringify({ title: 'Alpha VIP Clients', description: 'Rate updates', member_client_ids: [cl1Id], admin_only: false })
    }, agACookie);
    assert.strictEqual(grpCreate.status, 201);
    const grpId = grpCreate.json.conversation.id;

    // Agent A sends message in group -> Client 1 gets admin_alert; Owner & Agent B & Client 2 get NOTHING!
    const grpMsg = await req(`/api/chat/conversations/${grpId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Welcome to Alpha VIP Group 🚀' })
    }, agACookie);
    assert.strictEqual(grpMsg.status, 201);
    const cl1Recv = await waitForEvent(cl1Ws.events, e => e.type === 'chat:message' && e.conversation_id === grpId);
    assert(cl1Recv, 'Client 1 did not receive Agent group message');
    assert.strictEqual(cl1Recv.alert_priority, 'admin_alert', 'Agent -> Client group message must trigger admin_alert');

    // Verify ZERO leakage to Owner, Agent B, and Client 2!
    assert(!ownerWs.events.some(e => e.conversation_id === grpId), 'CRITICAL: Group message leaked to Owner WS!');
    assert(!agBWs.events.some(e => e.conversation_id === grpId), 'CRITICAL: Group message leaked to Agent B WS!');
    assert(!cl2Ws.events.some(e => e.conversation_id === grpId), 'CRITICAL: Group message leaked to Client 2 WS!');

    // Verify REST 403 isolation for Owner, Agent B, and Client 2
    assert.strictEqual((await req(`/api/chat/conversations/${grpId}/messages`, {}, ownerCookie)).status, 403, 'Owner must be blocked from Agent group');
    assert.strictEqual((await req(`/api/chat/conversations/${grpId}/messages`, {}, agBCookie)).status, 403, 'Agent B must be blocked from Agent A group');
    assert.strictEqual((await req(`/api/chat/conversations/${grpId}/messages`, {}, cl2Cookie)).status, 403, 'Client 2 must be blocked from Agent A group');

    // Client 1 CANNOT message Owner or Agent B
    assert.strictEqual((await req('/api/chat/direct', { method: 'POST', body: JSON.stringify({ target_key: 'owner:1' }) }, cl1Cookie)).status, 403, 'Client must NOT message Owner');
    assert.strictEqual((await req('/api/chat/direct', { method: 'POST', body: JSON.stringify({ target_key: `agent:${agBId}` }) }, cl1Cookie)).status, 403, 'Client 1 must NOT message Agent B');

    // 5. Client 1 sends message in group -> Agent A gets 'silent'
    const cl1Send = await req(`/api/chat/conversations/${grpId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Thanks Agent!' })
    }, cl1Cookie);
    assert.strictEqual(cl1Send.status, 201);
    const agAGrpRecv = await waitForEvent(agAWs.events, e => e.type === 'chat:message' && e.message.id === cl1Send.json.message.id);
    assert(agAGrpRecv && agAGrpRecv.alert_priority === 'silent', 'Client -> Agent group message must be silent');

    // 6. Group Admin Controls: Admin-Only mode + Pin + Remove Member
    const toggleLock = await req(`/api/chat/groups/${grpId}`, {
      method: 'PATCH',
      body: JSON.stringify({ admin_only: true })
    }, agACookie);
    assert.strictEqual(toggleLock.status, 200);
    assert.strictEqual(toggleLock.json.conversation.admin_only, true);

    // Client 1 blocked from sending when admin_only is ON
    const cl1Blocked = await req(`/api/chat/conversations/${grpId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Should be blocked' })
    }, cl1Cookie);
    assert.strictEqual(cl1Blocked.status, 403, 'Client must be blocked when admin_only=true');

    // Pin message works
    const pinRes = await req(`/api/chat/groups/${grpId}/pin`, {
      method: 'POST',
      body: JSON.stringify({ message_id: grpMsg.json.message.id })
    }, agACookie);
    assert.strictEqual(pinRes.status, 200);
    assert.strictEqual(pinRes.json.conversation.pinned_message_id, grpMsg.json.message.id);

    // Remove Client 1 from group -> Client 1 immediately loses access
    const remRes = await req(`/api/chat/groups/${grpId}/members`, {
      method: 'POST',
      body: JSON.stringify({ remove_client_ids: [cl1Id] })
    }, agACookie);
    assert.strictEqual(remRes.status, 200);
    assert.strictEqual((await req(`/api/chat/conversations/${grpId}/messages`, {}, cl1Cookie)).status, 403, 'Removed client must immediately lose group access');

    // Delete group
    const delGrp = await req(`/api/chat/groups/${grpId}`, { method: 'DELETE' }, agACookie);
    assert.strictEqual(delGrp.status, 200);

    // 7. Agent A <-> Client 1 1-to-1 direct chat: alert_priority + Owner/Agent B zero-leakage
    const acDirect = await req('/api/chat/direct', {
      method: 'POST',
      body: JSON.stringify({ target_key: `client:${cl1Id}` })
    }, agACookie);
    assert.strictEqual(acDirect.status, 200, `Agent->Client direct failed: ${acDirect.text}`);
    const acConvId = acDirect.json.conversation.id;

    // Agent A -> Client 1 triggers admin_alert
    const agToCl = await req(`/api/chat/conversations/${acConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Direct alert from your Agent!' })
    }, agACookie);
    assert.strictEqual(agToCl.status, 201);
    const cl1DirectRecv = await waitForEvent(cl1Ws.events, e => e.type === 'chat:message' && e.message.id === agToCl.json.message.id);
    assert(cl1DirectRecv && cl1DirectRecv.alert_priority === 'admin_alert', 'Agent -> Client 1-to-1 must trigger admin_alert');

    // Client 1 -> Agent A triggers silent
    const clToAg = await req(`/api/chat/conversations/${acConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Got it, thanks!' })
    }, cl1Cookie);
    assert.strictEqual(clToAg.status, 201);
    const agADirectRecv = await waitForEvent(agAWs.events, e => e.type === 'chat:message' && e.message.id === clToAg.json.message.id);
    assert(agADirectRecv && agADirectRecv.alert_priority === 'silent', 'Client -> Agent 1-to-1 must be silent');

    // Owner and Agent B CANNOT access Agent A <-> Client 1 direct chat via REST or WS
    assert.strictEqual((await req(`/api/chat/conversations/${acConvId}/messages`, {}, ownerCookie)).status, 403, 'Owner must be blocked from Agent-Client 1-to-1');
    assert.strictEqual((await req(`/api/chat/conversations/${acConvId}/messages`, {}, agBCookie)).status, 403, 'Agent B must be blocked from Agent A-Client 1 1-to-1');
    assert(!ownerWs.events.some(e => e.conversation_id === acConvId), 'CRITICAL: Agent-Client direct message leaked to Owner WS!');
    assert(!agBWs.events.some(e => e.conversation_id === acConvId), 'CRITICAL: Agent-Client direct message leaked to Agent B WS!');

    // Client 1 CANNOT create a group
    const clGrpTry = await req('/api/chat/groups', {
      method: 'POST',
      body: JSON.stringify({ title: 'Client Group Try', member_client_ids: [cl1Id] })
    }, cl1Cookie);
    assert.strictEqual(clGrpTry.status, 403, 'Client must NOT be able to create groups');

    console.log('ALL LIVE CHAT ROLE-ISOLATION, GROUP ADMIN & ALERT PRIORITY TESTS PASSED!');
  } finally {
    sockets.forEach(ws => { try { ws.close(); } catch (_) {} });
    await srv.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((err) => {
  console.error('LIVE CHAT TEST FAILED:', err);
  process.exit(1);
});
