import fs from 'fs';
import { makeFixture, startServer, check, summary } from './lib.js';

const PORT = 4721;

const dir = makeFixture({
  users: [
    { id: 1, username: 'Kamran_Bhatti', password: 'ownerpass1', role: 'Owner', status: 'active', balance: 500 }
  ],
  agents: [
    { id: 1, username: 'agent_one', password: 'agentpass1', role: 'Agent', status: 'active', balance: 50 },
    { id: 2, username: 'agent_direct', password: 'agentpass2', role: 'Agent', status: 'active', balance: 25 },
    { id: 3, username: 'agent_two', password: 'agentpass3', role: 'Agent', status: 'active', balance: 25 }
  ],
  clients: [
    { id: 1, username: 'client_one', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', balance: 25 },
    { id: 2, username: 'client_two', password: 'clientpass2', role: 'Client', agent_id: 1, status: 'active', balance: 25 },
    { id: 3, username: 'client_three', password: 'clientpass3', role: 'Client', agent_id: 2, status: 'active', balance: 25 }
  ],
  credit_notes: [
    { id: 101, user: 'agent_one', role: 'Agent', amount: 12.5, currency: 'USD', reason: '<script>alert(1)</script>', status: 'confirmed' },
    { id: 102, user: 'agent_two', role: 'Agent', amount: 15, currency: 'USD', reason: 'Note Two', status: 'confirmed' }
  ],
  support_tickets: [
    { id: 201, user: 'agent_one', user_role: 'Agent', subject: 'Help', status: 'open', replies: [] }
  ],
  notifications: [
    { id: 301, message: 'Agent Two Secret', role: 'Agent', user_id: 3, username: 'agent_two', read: false },
    { id: 302, message: 'Agent One Notice', role: 'Agent', user_id: 1, username: 'agent_one', read: false }
  ],
  payout_requests: [
    { id: 401, user: 'agent_one', user_id: 1, role: 'Agent', agent_id: 1, amount: 20, method: 'USDT', wallet: 'T123', status: 'pending' }
  ],
  registration_requests: [
    { id: 501, username: 'pending_user', email: 'p@example.com', requested_role: 'Client', status: 'pending' }
  ],
  sms_log: [
    { id: 601, number: '233500000005', user: 'client_one', client_id: 1, agent_id: 1, cli: 'WhatsApp', provider: 'Orange', range_name: 'Ghana', message: 'OTP 112233', profit: 0.01, timestamp: new Date().toISOString(), status: 'DELIVRD' },
    { id: 602, number: '233500000007', user: 'client_three', client_id: 3, agent_id: 2, cli: 'Telegram', provider: 'Orange', range_name: 'Ghana', message: 'OTP 998877', profit: 0.01, timestamp: new Date().toISOString(), status: 'DELIVRD' }
  ]
});

const srv = await startServer(dir, PORT);

try {
  // 1. Captcha-free direct login + login response hides token + no ?token= URL bypass
  const badCreds = await srv.api('POST', '/api/auth/login', { body: { username: 'Kamran_Bhatti', password: 'wrongpassword' } });
  check('Security: login rejected with invalid password (401)', badCreds.status === 401);

  const ownerLogin = await srv.login('Kamran_Bhatti', 'ownerpass1');
  check('Security: owner cookie login succeeds without captcha', ownerLogin.ok);
  check('Security: token & session_token omitted from login JSON body', !ownerLogin.res.data?.token && !ownerLogin.res.data?.session_token);

  const rawCookieVal = ownerLogin.cookie.split('=')[1];
  const urlLeak = await srv.api('GET', `/api/auth/me?token=${encodeURIComponent(rawCookieVal)}`);
  check('Security: ?token= query auth bypass rejected', urlLeak.status === 401);

  // 2. Per-account lockout across different X-Forwarded-For IPs
  for (let i = 0; i < 5; i++) {
    await srv.api('POST', '/api/auth/login', {
      headers: { 'X-Forwarded-For': `10.0.0.${i + 10}` },
      body: { username: 'client_two', password: 'wrongpass' }
    });
  }
  const lockedAttempt = await srv.api('POST', '/api/auth/login', {
    headers: { 'X-Forwarded-For': '10.0.0.99' },
    body: { username: 'client_two', password: 'clientpass2' }
  });
  check('Security: per-account lockout enforces 429 even across IPs', lockedAttempt.status === 429);

  // 3. CSRF Origin check on cookie-authenticated POST
  const csrfBad = await srv.api('POST', '/api/settings', {
    cookie: ownerLogin.cookie,
    headers: { Origin: 'https://evil.example' },
    body: { site_name: 'Hacked' }
  });
  check('Security: cross-origin cookie POST blocked with 403', csrfBad.status === 403);

  const ag1Login = await srv.login('agent_one', 'agentpass1');
  const ag2Login = await srv.login('agent_two', 'agentpass3');
  const cl1Login = await srv.login('client_one', 'clientpass1');

  // 4. Credit notes IDOR + PDF XSS escape
  const cnIdor = await srv.api('GET', '/api/credit-notes/102/pdf', { cookie: ag1Login.cookie });
  check('Security: cross-tenant credit-note PDF blocked (403)', cnIdor.status === 403);
  const cnPdf = await srv.api('GET', '/api/credit-notes/101/pdf', { cookie: ag1Login.cookie });
  check('Security: credit-note PDF escapes <script> tags', cnPdf.status === 200 && typeof cnPdf.data === 'string' && !cnPdf.data.includes('<script>alert(1)</script>') && cnPdf.data.includes('&lt;script&gt;'));

  // 5. Ticket PATCH & Client self-status/2FA PATCH blocked
  const ticketPatch = await srv.api('PATCH', '/api/support-tickets/201', { cookie: ag1Login.cookie, body: { status: 'closed', assigned_to: 'Kamran_Bhatti' } });
  check('Security: non-owner cannot tamper ticket status via PATCH', ticketPatch.status === 403 || ticketPatch.data?.status !== 'closed');
  const clientStatusPatch = await srv.api('PATCH', '/api/clients/1', { cookie: cl1Login.cookie, body: { status: 'suspended', two_fa_enabled: false } });
  check('Security: client cannot self-disable 2FA/status via PATCH', clientStatusPatch.status === 403);

  // 6. Payout self-approval, mass-assignment status, insufficient balance, double-pay -> 409
  const agSelfPay = await srv.api('PATCH', '/api/payout-requests/401', { cookie: ag1Login.cookie, body: { status: 'paid' } });
  check('Security: agent cannot self-approve own payout (403)', agSelfPay.status === 403);

  const paidForge = await srv.api('POST', '/api/payout-requests', { cookie: ag1Login.cookie, body: { amount: 15, method: 'USDT', wallet: 'TXYZ', status: 'paid' } });
  check('Security: POST /api/payout-requests forces status pending', paidForge.status === 200 && paidForge.data?.status === 'pending');

  const overdraw = await srv.api('POST', '/api/payout-requests', { cookie: ag1Login.cookie, body: { amount: 9999, method: 'USDT', wallet: 'TXYZ' } });
  check('Security: payout above balance fails safely (400)', overdraw.status === 400);

  const ownerApprove = await srv.api('PATCH', `/api/payout-requests/${paidForge.data.id}`, { cookie: ownerLogin.cookie, body: { status: 'paid' } });
  const doublePay = await srv.api('PATCH', `/api/payout-requests/${paidForge.data.id}`, { cookie: ownerLogin.cookie, body: { status: 'paid' } });
  check('Security: payout request approved by Owner & cannot be paid twice (409)', ownerApprove.status === 200 && doublePay.status === 409);

  // 7. Number pool & revoke IDOR
  const agBulkOtherClient = await srv.api('POST', '/api/numbers/bulk-allocate', { cookie: ag1Login.cookie, body: { range_id: 1, count: 1, target_id: 3, target_type: 'client' } });
  const agBulkAgentRole = await srv.api('POST', '/api/numbers/bulk-allocate', { cookie: ag1Login.cookie, body: { range_id: 1, count: 1, target_id: 1, target_type: 'agent' } });
  check('Security: agent blocked from cross-agent or agent-tier bulk-allocate', agBulkOtherClient.status === 403 && agBulkAgentRole.status === 403);

  const crossRevokeNum = await srv.api('POST', '/api/numbers/revoke', { cookie: ag1Login.cookie, body: { number: '233500000008' } });
  const crossRevokeUser = await srv.api('POST', '/api/numbers/revoke', { cookie: ag1Login.cookie, body: { user_id: 3 } });
  check('Security: agent blocked from revoking out-of-scope number or client', crossRevokeNum.status === 403 && crossRevokeUser.status === 403);

  // 8. Notifications header-feed scoping & IDOR
  const clFeed = await srv.api('GET', '/api/notifications/header-feed', { cookie: cl1Login.cookie });
  const hasOtherClientSms = (clFeed.data?.recent_sms || []).some(s => String(s.number).includes('233500000007'));
  const clSmsUnmasked = (clFeed.data?.recent_sms || []).length > 0 && (clFeed.data?.recent_sms || []).every(s => !s.cli || !/XXXXX$/.test(s.cli));
  check('Security: client header-feed excludes other client SMS and exposes full unmasked CLI', clFeed.status === 200 && !hasOtherClientSms && clSmsUnmasked);

  const notifList = await srv.api('GET', '/api/notifications', { cookie: ag1Login.cookie });
  const seesOtherAgNotif = (notifList.data?.data || []).some(n => n.id === 301);
  const notifIdor = await srv.api('POST', '/api/notifications/301/read', { cookie: ag1Login.cookie, body: {} });
  check('Security: cross-user notifications hidden and mark-read blocked (403)', !seesOtherAgNotif && notifIdor.status === 403);

  // 9. Registration requests locked to Owner & removed /api/cli-search blocked
  const regLeak = await srv.api('GET', '/api/registration-requests', { cookie: ag1Login.cookie });
  check('Security: agent blocked from /api/registration-requests (403)', regLeak.status === 403);

  const cliSearch = await srv.api('GET', '/api/cli-search?hours=24', { cookie: cl1Login.cookie });
  check('Security: /api/cli-search removed and inaccessible for Client', cliSearch.status === 403 || cliSearch.status === 404);

  // 10. SVG upload rejection, orphan report Owner-lock & static traversal check
  const svgUpload = await srv.api('POST', '/api/settings/upload-logo', {
    cookie: ownerLogin.cookie,
    body: { image: 'data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)></svg>').toString('base64') }
  });
  check('Security: SVG data URI rejected on upload-logo', svgUpload.status === 400);

  const orphanNonOwner = await srv.api('GET', '/api/reports/orphans', { cookie: ag1Login.cookie });
  const traversalProbe = await srv.api('GET', '/static/../../server.js');
  const leakedServerSrc = typeof traversalProbe.data === 'string' && traversalProbe.data.includes('registerPaginatedCrud');
  check('Security: /api/reports/orphans restricted to Owner & static traversal blocked', orphanNonOwner.status === 403 && !leakedServerSrc);

  // 11. Removed outward REST API, SMPP & Webhook endpoints are inaccessible
  const rmTokens = await srv.api('GET', '/api/tokens', { cookie: ownerLogin.cookie });
  const rmViewStats = await srv.api('GET', '/api/sms/viewstats');
  const rmCrApiOut = await srv.api('GET', '/crapi/viewstats');
  const rmSmpp = await srv.api('GET', '/api/smpp/accounts', { cookie: ownerLogin.cookie });
  const rmWebhook = await srv.api('GET', '/api/webhook/config', { cookie: ownerLogin.cookie });
  check(
    'Security: removed SMPP, Webhook & outward REST API endpoints return 401/404',
    [401, 404].includes(rmTokens.status) &&
    [401, 404].includes(rmViewStats.status) &&
    [401, 404].includes(rmCrApiOut.status) &&
    [401, 404].includes(rmSmpp.status) &&
    [401, 404].includes(rmWebhook.status)
  );

  // 12. Owner-only VPS Health endpoint (200 for Owner, 403 for Agent & Client)
  const vpsOwner = await srv.api('GET', '/api/owner/vps-health', { cookie: ownerLogin.cookie });
  const vpsAgent = await srv.api('GET', '/api/owner/vps-health', { cookie: ag1Login.cookie });
  const vpsClient = await srv.api('GET', '/api/owner/vps-health', { cookie: cl1Login.cookie });
  check(
    'VPS Health: Owner receives live metrics (200) and Agent/Client receive 403',
    vpsOwner.status === 200 &&
    typeof vpsOwner.data?.cpu?.usage_pct === 'number' &&
    typeof vpsOwner.data?.memory?.total_bytes === 'number' &&
    typeof vpsOwner.data?.folders?.data_dir_bytes === 'number' &&
    vpsAgent.status === 403 &&
    vpsClient.status === 403
  );

  // 13. Monthly (30/5) range & number persistence (must NOT auto-revert to Weekly)
  const createMonthly = await srv.api('POST', '/api/numbers/sms-ranges', {
    cookie: ownerLogin.cookie,
    body: {
      range_name: 'Spain Orange Direct',
      country: 'Spain',
      provider: 'DirectRoute',
      prefix: '34',
      company_cost: 0.05,
      payterm: 'Monthly',
      payout_schedule: 'monthly30_5',
      active_payterms: ['Monthly'],
      payterms: { Monthly: 0.03 }
    }
  });
  const mRangeId = createMonthly.data?.id;
  const impMonthly = mRangeId ? await srv.api('POST', '/api/numbers/import-to-range', {
    cookie: ownerLogin.cookie,
    body: { range_id: mRangeId, numbers: ['34600112233'], payterm: 'Monthly' }
  }) : { status: 500 };
  const allNums = await srv.api('GET', '/api/numbers?limit=200', { cookie: ownerLogin.cookie });
  const importedNum = (allNums.data?.data || []).find(n => String(n.number || '').includes('34600112233'));
  check(
    'Monthly Persistence: range & imported number stay Monthly (30/5) without reverting to Weekly',
    createMonthly.status === 200 &&
    createMonthly.data?.payterm === 'Monthly' &&
    createMonthly.data?.payout_schedule === 'monthly30_5' &&
    impMonthly.status === 200 &&
    importedNum?.payterm === 'Monthly' &&
    importedNum?.payout_schedule === 'monthly30_5'
  );

  // 14. Client blocked numbers endpoint & Agent-scoped App Links
  const clBlocked = await srv.api('GET', '/api/numbers/blocked', { cookie: cl1Login.cookie });
  const agAppAdd = await srv.api('POST', '/api/app-links', {
    cookie: ag1Login.cookie,
    body: { name: 'Telegram Official', url: 'https://telegram.org', category: 'Messaging' }
  });
  const clAppList = await srv.api('GET', '/api/app-links?dashboard=1&limit=10', { cookie: cl1Login.cookie });
  const clSeesAgApp = (clAppList.data?.data || []).some(a => a.name === 'Telegram Official');
  check(
    'Client Blocked & Agent App Links: Client fetches own blocked list and sees Agent-added App Link',
    clBlocked.status === 200 && agAppAdd.status === 200 && clAppList.status === 200 && clSeesAgApp
  );
} finally {
  await srv.stop();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

process.exit(summary('Security audit regression') ? 0 : 1);
