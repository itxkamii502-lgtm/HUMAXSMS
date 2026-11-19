// Real-Time Role-Aware Notification Engine & Settings Integration Tests
import WebSocket from 'ws';
import { makeFixture, startServer, check, summary, sleep } from './lib.js';

const TEST_PORT = 4429;
const dir = makeFixture({
  sms_ranges: [
    {
      id: 1,
      range_name: 'Ghana Orange NS2',
      name: 'Ghana Orange NS2',
      country: 'Ghana',
      provider: 'Orange',
      prefix: '233',
      cost: 0.02,
      payout: 0.015,
      weekly_rate: 0.015,
      payterms: { Weekly: 0.015, Biweekly: 0.018 },
      currency: 'USD'
    }
  ],
  agent_client_rates: [
    {
      id: 1,
      agent_id: 1,
      range_id: 1,
      range_name: 'Ghana Orange NS2',
      client_rate_pkr: 3.75,
      allowed_quantities: [25, 50],
      payterm: 'Weekly'
    }
  ],
  agents: [
    { id: 1, username: 'agent_one', password: 'agentpass1', role: 'Agent', status: 'active', balance: 50, created: new Date().toISOString() },
    { id: 2, username: 'agent_direct', password: 'agentpass2', role: 'Agent', status: 'active', balance: 25, created: new Date().toISOString() },
    { id: 3, username: 'agent_two', password: 'agentpass3', role: 'Agent', status: 'active', balance: 10, created: new Date().toISOString() }
  ],
  clients: [
    { id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', balance: 20, balance_pkr: 5000, created: new Date().toISOString() },
    { id: 2, username: 'client_two', password: 'clientpass2', role: 'Client', agent_id: 1, status: 'active', balance: 2, balance_pkr: 560, created: new Date().toISOString() },
    { id: 3, username: 'client_three', password: 'clientpass3', role: 'Client', agent_id: 2, status: 'active', balance: 0, balance_pkr: 0, created: new Date().toISOString() }
  ]
});

const srv = await startServer(dir, TEST_PORT);

function openNotifWs(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/notifications`, {
      headers: { Cookie: cookie }
    });
    const events = [];
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg && msg.type === 'notification' && msg.notification) {
          events.push(msg.notification);
        }
      } catch (e) {}
    });
    ws.on('open', () => resolve({ ws, events }));
    ws.on('error', reject);
  });
}

async function waitForEvent(events, pred, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = events.find(pred);
    if (found) return found;
    await sleep(40);
  }
  return null;
}

const sockets = [];
try {
  const own = await srv.login('Kamran_Bhatti', 'ownerpass1');
  const ag = await srv.login('agent_one', 'agentpass1');
  const cl = await srv.login('client_one', 'clientpass1');
  const cl2 = await srv.login('client_two', 'clientpass2');
  check('Owner, Agent, Client1 & Client2 logins succeed', own.ok && ag.ok && cl.ok && cl2.ok);

  // Open simultaneous real-time WebSocket connections
  const ownWs = await openNotifWs(own.cookie);
  const agWs = await openNotifWs(ag.cookie);
  const clWs = await openNotifWs(cl.cookie);
  const cl2Ws = await openNotifWs(cl2.cookie);
  sockets.push(ownWs.ws, agWs.ws, clWs.ws, cl2Ws.ws);

  // 1. Agent allocates number #4 to Client 1 -> Client 1 gets real-time WS notification with Range, Payterm, Qty & PKR Rate
  const assignRes = await srv.api('POST', '/api/numbers/4/assign', {
    cookie: ag.cookie,
    body: { client_id: 1, payterm: 'Weekly' }
  });
  check('Agent assigns number #4 to client_one (200)', assignRes.status === 200);

  const clAllocNotif = await waitForEvent(clWs.events, n => n.type === 'allocation' && n.range_name === 'Ghana Orange NS2');
  await sleep(180);
  check(
    'Client 1 receives live WS allocation notification with Range, Payterm (Weekly 7/3), Qty & PKR Rate',
    !!clAllocNotif &&
      String(clAllocNotif.message || '').includes('Ghana Orange NS2') &&
      String(clAllocNotif.message || '').includes('Weekly (7/3)') &&
      String(clAllocNotif.message || '').includes('Rs. 3.75/SMS') &&
      clAllocNotif.payterm === 'Weekly (7/3)' &&
      clAllocNotif.rate_label === 'Rs. 3.75/SMS' &&
      clAllocNotif.category === 'numbers',
    JSON.stringify(clAllocNotif)
  );

  // Role isolation check: Owner & Client 2 MUST NOT receive Client 1's allocation notification over WS
  const leakedToOwner = ownWs.events.some(n => n.id === clAllocNotif?.id);
  const leakedToClient2 = cl2Ws.events.some(n => n.id === clAllocNotif?.id);
  check('Client allocation notification does NOT leak to Owner WS or Client 2 WS', !leakedToOwner && !leakedToClient2);

  // 2. Agent submits Number Request -> Owner receives live WS notification immediately
  const agReqRes = await srv.api('POST', '/api/agent-requests', {
    cookie: ag.cookie,
    body: { range_id: 1, range_name: 'Ghana Orange NS2', quantity: 2, payterm: 'Weekly', notes: 'Need 2 Ghana nums' }
  });
  const agReqId = agReqRes.data?.request?.id || agReqRes.data?.id;
  check('Agent submits Number Request (200)', agReqRes.status === 200 && !!agReqId);

  const ownReqNotif = await waitForEvent(ownWs.events, n => n.type === 'request' && String(n.message || '').includes('agent_one'));
  check(
    'Owner receives live same-second WS notification for Agent Number Request',
    !!ownReqNotif && ownReqNotif.category === 'requests' && String(ownReqNotif.message || '').includes('Ghana Orange NS2'),
    JSON.stringify(ownReqNotif)
  );

  // 3. Owner fulfills Agent Number Request -> BOTH Agent WS and Owner WS receive live acceptance confirmation
  const fulfillRes = await srv.api('POST', `/api/agent-requests/${agReqId}/fulfill`, {
    cookie: own.cookie,
    body: { number_ids: [1, 2], payterm: 'Weekly', notes: 'Fulfilled immediately' }
  });
  check('Owner fulfills Agent Number Request (200)', fulfillRes.status === 200);

  const agApprovedNotif = await waitForEvent(agWs.events, n => n.status === 'approved' && n.recipient_role === 'agent' && n.type === 'allocation');
  const ownAcceptedNotif = await waitForEvent(ownWs.events, n => n.type === 'request_approved' && n.recipient_role === 'owner');
  check(
    'Agent receives live WS approval notification with Range, Payterm & USD rate',
    !!agApprovedNotif &&
      String(agApprovedNotif.message || '').includes('Ghana Orange NS2') &&
      String(agApprovedNotif.message || '').includes('Weekly (7/3)') &&
      String(agApprovedNotif.rate_label || '').includes('$0.015'),
    JSON.stringify(agApprovedNotif)
  );
  check(
    'Owner receives live WS status confirmation when Agent Request is accepted',
    !!ownAcceptedNotif && ownAcceptedNotif.status === 'approved',
    JSON.stringify(ownAcceptedNotif)
  );

  // 4. Agent submits second Number Request and Owner rejects -> BOTH Agent and Owner receive live rejection notification
  const agReq2 = await srv.api('POST', '/api/agent-requests', {
    cookie: ag.cookie,
    body: { range_id: 1, range_name: 'Ghana Orange NS2', quantity: 5, payterm: 'Biweekly' }
  });
  const agReq2Id = agReq2.data?.request?.id || agReq2.data?.id;
  const rejRes = await srv.api('POST', `/api/agent-requests/${agReq2Id}/reject`, {
    cookie: own.cookie,
    body: { reason: 'Temporary stock limit' }
  });
  check('Owner rejects Agent Request #2 (200)', rejRes.status === 200);

  const agRejectedNotif = await waitForEvent(agWs.events, n => n.type === 'request_rejected' && n.recipient_role === 'agent');
  const ownRejectedNotif = await waitForEvent(ownWs.events, n => n.type === 'request_rejected' && n.recipient_role === 'owner');
  check(
    'Both Agent WS and Owner WS receive live rejection status notification',
    !!agRejectedNotif && !!ownRejectedNotif && ownRejectedNotif.status === 'rejected'
  );

  // 5. Agent submits USD Payout Request -> Owner gets live WS notification; Owner marks paid -> both get live status
  const agPayoutRes = await srv.api('POST', '/api/payout-requests', {
    cookie: ag.cookie,
    body: { amount: 20, currency: 'USD', method: 'USDT TRC20', account_details: 'T-TEST-WALLET' }
  });
  const agPayoutId = agPayoutRes.data?.request?.id || agPayoutRes.data?.id;
  check('Agent submits USD Payout Request (200/201)', (agPayoutRes.status === 200 || agPayoutRes.status === 201) && !!agPayoutId);

  const ownPayoutNotif = await waitForEvent(ownWs.events, n => n.type === 'payout' && n.recipient_role === 'owner' && n.status === 'pending');
  check('Owner receives live WS notification for Agent Payout Request', !!ownPayoutNotif && ownPayoutNotif.category === 'payments');

  const payPatch = await srv.api('PATCH', `/api/payout-requests/${agPayoutId}`, {
    cookie: own.cookie,
    body: { status: 'paid', transaction_id: 'TX-99881', notes: 'Settled via TRC20' }
  });
  check('Owner marks Agent Payout paid (200)', payPatch.status === 200);
  const agPaidNotif = await waitForEvent(agWs.events, n => n.type === 'payout' && n.recipient_role === 'agent' && n.status === 'paid');
  const ownPaidNotif = await waitForEvent(ownWs.events, n => n.type === 'payout' && n.recipient_role === 'owner' && n.status === 'paid');
  check('Agent & Owner both receive live WS payout completion notifications', !!agPaidNotif && !!ownPaidNotif);

  // 6. Client submits Number Request & PKR Payment Request -> Agent receives live WS notifications
  const clReqRes = await srv.api('POST', '/api/client-requests', {
    cookie: cl.cookie,
    body: { range_id: 1, range_name: 'Ghana Orange NS2', quantity: 25, payterm: 'Weekly' }
  });
  check('Client submits Number Request via /api/client-requests (200)', clReqRes.status === 200);
  const agClReqNotif = await waitForEvent(agWs.events, n => n.type === 'request' && n.recipient_role === 'agent' && String(n.message || '').includes('client_one'));
  check('Agent receives live WS notification for Client Number Request', !!agClReqNotif);

  const clPayoutRes = await srv.api('POST', '/api/payout-requests', {
    cookie: cl.cookie,
    body: { amount: 3000, currency: 'PKR', method: 'JazzCash', account_details: '03001234567' }
  });
  check('Client submits PKR Payment Request (200/201)', clPayoutRes.status === 200 || clPayoutRes.status === 201, JSON.stringify(clPayoutRes.data));
  const agClPayNotif = await waitForEvent(agWs.events, n => n.type === 'payout' && n.recipient_role === 'agent' && n.status === 'pending');
  check('Agent receives live WS notification for Client PKR Payment Request', !!agClPayNotif && agClPayNotif.category === 'payments');

  // 7. Header Bell Popover strictly returns TOP 5 notifications even when 8+ exist
  for (let i = 1; i <= 7; i++) {
    await srv.api('POST', '/api/notifications', {
      cookie: own.cookie,
      body: {
        recipient_role: 'client',
        recipient_id: 1,
        recipient_username: 'client_one',
        title: `Client Alert #${i}`,
        message: `Test client alert message ${i}`,
        type: 'info'
      }
    });
  }
  const clFeed = await srv.api('GET', '/api/notifications/header-feed', { cookie: cl.cookie });
  check(
    'Header bell feed strictly caps at 5 items while reporting accurate unread_count & total_count',
    clFeed.status === 200 &&
      Array.isArray(clFeed.data?.notifications) &&
      clFeed.data.notifications.length === 5 &&
      clFeed.data.total_count >= 8 &&
      clFeed.data.unread_count >= 8,
    JSON.stringify({ len: clFeed.data?.notifications?.length, total: clFeed.data?.total_count, unread: clFeed.data?.unread_count })
  );

  // Owner default /api/notifications/header-feed MUST NOT contain Client-targeted alerts
  const ownFeed = await srv.api('GET', '/api/notifications/header-feed', { cookie: own.cookie });
  const ownerSawClientNotif = (ownFeed.data?.notifications || []).some(n => n.recipient_role === 'client');
  check('Owner default header-feed is strictly isolated to Owner notifications (no Client leak)', ownFeed.status === 200 && !ownerSawClientNotif);

  // 8. Per-user Notification Preferences persist independently per user
  const setClPrefs = await srv.api('POST', '/api/notifications/preferences', {
    cookie: cl.cookie,
    body: {
      preferences: {
        live_toast: true,
        sound_enabled: false,
        categories: { numbers: true, requests: true, payments: true, system: false }
      }
    }
  });
  const getClPrefs = await srv.api('GET', '/api/notifications/preferences', { cookie: cl.cookie });
  const getAgPrefs = await srv.api('GET', '/api/notifications/preferences', { cookie: ag.cookie });
  check(
    'Per-user notification preferences save & isolate cleanly across users',
    setClPrefs.status === 200 &&
      getClPrefs.data?.preferences?.sound_enabled === false &&
      getClPrefs.data?.preferences?.categories?.system === false &&
      getAgPrefs.data?.preferences?.sound_enabled === true &&
      getAgPrefs.data?.preferences?.categories?.system === true
  );

  // 9. Cross-user privacy: Client 2 gets 403 trying to mark or delete Client 1's notification
  const cl1NotifId = clFeed.data.notifications[0].id;
  const crossRead = await srv.api('POST', `/api/notifications/${cl1NotifId}/read`, { cookie: cl2.cookie, body: {} });
  const crossDel = await srv.api('DELETE', `/api/notifications/${cl1NotifId}`, { cookie: cl2.cookie });
  check('Cross-user notification read & delete rejected with 403', crossRead.status === 403 && crossDel.status === 403);

  // 10. Owner Mark All Read (default Owner scope) marks Owner's read without touching Client 1's unread count
  const clUnreadBefore = (await srv.api('GET', '/api/notifications/header-feed', { cookie: cl.cookie })).data.unread_count;
  await srv.api('POST', '/api/notifications/mark-all-read', { cookie: own.cookie, body: {} });
  const ownAfterMark = await srv.api('GET', '/api/notifications/header-feed', { cookie: own.cookie });
  const clUnreadAfter = (await srv.api('GET', '/api/notifications/header-feed', { cookie: cl.cookie })).data.unread_count;
  check(
    'Owner mark-all-read clears Owner unread badge without affecting Client unread notifications',
    ownAfterMark.data.unread_count === 0 && clUnreadAfter === clUnreadBefore && clUnreadAfter > 0
  );
} finally {
  sockets.forEach(s => { try { s.close(); } catch (e) {} });
  await srv.stop();
}

const ok = summary('notifications-integration');
process.exit(ok ? 0 : 1);
