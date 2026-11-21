import fs from 'node:fs';
import { makeFixture, startServer, check, summary } from './lib.js';

const PORT = 3514;

function pktHmOffset(offsetMinutes) {
  const pkt = new Date(Date.now() + 5 * 3600 * 1000 + offsetMinutes * 60 * 1000);
  const hh = String(pkt.getUTCHours()).padStart(2, '0');
  const mm = String(pkt.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function run() {
  const dir = makeFixture({
    agents: [
      { id: 1, username: 'agent_one', name: 'Agent One', password: 'agentpass1', role: 'Agent', status: 'active', whitenoise_access: true }
    ],
    clients: [
      { id: 1, username: 'client_one', name: 'Client One', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', whitenoise_access: true },
      { id: 2, username: 'client_two', name: 'Client Two', password: 'clientpass2', role: 'Client', agent_id: 1, status: 'active', whitenoise_access: false }
    ]
  });

  const srv = await startServer(dir, PORT);
  try {
    const owL = await srv.login('Kamran_Bhatti', 'ownerpass1');
    const agL = await srv.login('agent_one', 'agentpass1');
    const cl1L = await srv.login('client_one', 'clientpass1');
    const cl2L = await srv.login('client_two', 'clientpass2');
    check('Owner, Agent, Client 1 (CDR2 enabled) & Client 2 (CDR2 disabled) log in cleanly',
      Boolean(owL.ok && agL.ok && cl1L.ok && cl2L.ok));

    const asUser = (cookie) => (method, url, body) => srv.api(method, url, { cookie, body });
    const ow = asUser(owL.cookie);
    const ag = asUser(agL.cookie);
    const cl1 = asUser(cl1L.cookie);
    const cl2 = asUser(cl2L.cookie);

    // ── 1. Live Chat Group Auto Night/Morning Schedule ──
    const grpRes = await ag('POST', '/api/chat/groups', {
      title: 'VIP Night Group',
      description: 'Scheduled group test',
      admin_only: false,
      member_client_ids: [1]
    });
    check('Agent creates private Client Group', grpRes.status === 201 && Boolean(grpRes.data?.conversation?.id));
    const convId = grpRes.data.conversation.id;

    const badTimeRes = await ag('PATCH', `/api/chat/groups/${convId}`, {
      schedule: { enabled: true, close_time: '23:00', open_time: '23:00' }
    });
    check('Same Close & Open time rejected (400)', badTimeRes.status === 400);

    const clPatch = await cl1('PATCH', `/api/chat/groups/${convId}`, {
      schedule: { enabled: true, close_time: '22:00', open_time: '08:00' }
    });
    const owPatch = await ow('PATCH', `/api/chat/groups/${convId}`, {
      schedule: { enabled: true, close_time: '22:00', open_time: '08:00' }
    });
    check('Client & Owner blocked (403) from changing group schedule', clPatch.status === 403 && owPatch.status === 403);

    // Closed window covering NOW: closed 30m ago, reopens in 60m
    const nightMsg = '🌙 Good Night team! Auto test close message.';
    const morningMsg = '☀️ Assalam-o-Alaikum team! Auto test morning message.';
    const schedCloseRes = await ag('PATCH', `/api/chat/groups/${convId}`, {
      schedule: {
        enabled: true,
        close_time: pktHmOffset(-30),
        open_time: pktHmOffset(60),
        close_message: nightMsg,
        open_message: morningMsg
      }
    });
    check('Group enters scheduled closed window with live remaining_seconds',
      schedCloseRes.status === 200 &&
      schedCloseRes.data?.conversation?.schedule_state?.is_closed === true &&
      Number(schedCloseRes.data?.conversation?.schedule_state?.remaining_seconds || 0) > 0);

    const msgs1 = await cl1('GET', `/api/chat/conversations/${convId}/messages`);
    const nightMsgs1 = (msgs1.data?.messages || []).filter(m => m.is_auto_schedule && m.auto_type === 'night_close');
    check('Auto Good Night message posted once from Group Admin & Client locked (scheduled_closed)',
      msgs1.status === 200 &&
      msgs1.data?.conversation?.can_send === false &&
      msgs1.data?.conversation?.lock_reason === 'scheduled_closed' &&
      nightMsgs1.length === 1 &&
      nightMsgs1[0].body === nightMsg);

    await cl1('GET', '/api/chat/bootstrap');
    const msgs2 = await cl1('GET', `/api/chat/conversations/${convId}/messages`);
    const nightMsgs2 = (msgs2.data?.messages || []).filter(m => m.is_auto_schedule && m.auto_type === 'night_close');
    check('Idempotency verified: repeated polls never duplicate Good Night message', nightMsgs2.length === 1);

    const blockedSend = await cl1('POST', `/api/chat/conversations/${convId}/messages`, { body: 'Hello at night' });
    check('Client message blocked (403) during scheduled quiet hours', blockedSend.status === 403);

    const adminSend = await ag('POST', `/api/chat/conversations/${convId}/messages`, { body: 'Urgent admin update' });
    check('Group Admin (Agent) can still post updates during quiet hours', adminSend.status === 201);

    // Transition to OPEN window (closed 120m ago, opened 10m ago)
    const openSchedRes = await ag('PATCH', `/api/chat/groups/${convId}`, {
      schedule: {
        enabled: true,
        close_time: pktHmOffset(-120),
        open_time: pktHmOffset(-10),
        close_message: nightMsg,
        open_message: morningMsg
      }
    });
    const clientAllowedSend = await cl1('POST', `/api/chat/conversations/${convId}/messages`, { body: 'Good morning!' });
    check('Group reopens cleanly & Client can send messages normally again',
      openSchedRes.status === 200 &&
      openSchedRes.data?.conversation?.schedule_state?.is_closed === false &&
      clientAllowedSend.status === 201);

    // ── 2. CDR 2 Daily 12:00 PM PKT Status & First-Time Terms Gate ──
    const cl2St = await cl2('GET', '/api/cdr2/status');
    const cl2Acc = await cl2('POST', '/api/cdr2/accept-terms', { accepted: true });
    check('Client without CDR 2 access blocked (403) from /api/cdr2/status & /api/cdr2/accept-terms',
      cl2St.status === 403 && cl2Acc.status === 403);

    const st1 = await cl1('GET', '/api/cdr2/status');
    check('Client 1 /api/cdr2/status returns 12:00 PM PKT schedule, terms_accepted=false & zero whitenoise leak',
      st1.status === 200 &&
      st1.data?.upload_hour_pkt === 12 &&
      st1.data?.upload_time_label === '12:00 PM PKT' &&
      st1.data?.terms_accepted === false &&
      !JSON.stringify(st1.data).toLowerCase().includes('whitenoise'));

    const accFalse = await cl1('POST', '/api/cdr2/accept-terms', { accepted: false });
    const accTrue = await cl1('POST', '/api/cdr2/accept-terms', { accepted: true });
    const st1After = await cl1('GET', '/api/cdr2/status');
    const me1 = await cl1('GET', '/api/auth/me');
    check('First-time Terms & Conditions acceptance validates & persists cleanly for Client 1',
      accFalse.status === 400 &&
      accTrue.status === 200 &&
      st1After.data?.terms_accepted === true &&
      Boolean(st1After.data?.terms_accepted_at) &&
      me1.data?.cdr2_terms_accepted === true);

    const agSt1 = await ag('GET', '/api/cdr2/status');
    const agAcc = await ag('POST', '/api/cdr2/accept-terms', { accepted: true });
    const agSt2 = await ag('GET', '/api/cdr2/status');
    check('Agent first-time CDR 2 terms acceptance works independently',
      agSt1.status === 200 && agSt1.data?.terms_accepted === false &&
      agAcc.status === 200 && agSt2.data?.terms_accepted === true);

    // ── 3. Owner-Only Original Whitenoise Portal Credentials ──
    const agGetP = await ag('GET', '/api/owner/whitenoise-portal');
    const clGetP = await cl1('GET', '/api/owner/whitenoise-portal');
    const agPutP = await ag('PUT', '/api/owner/whitenoise-portal', { url: 'https://evil.com' });
    const clPutP = await cl1('PUT', '/api/owner/whitenoise-portal', { url: 'https://evil.com' });
    check('Agent & Client strictly blocked (403) from Owner Whitenoise portal credentials',
      agGetP.status === 403 && clGetP.status === 403 && agPutP.status === 403 && clPutP.status === 403);

    const badUrl = await ow('PUT', '/api/owner/whitenoise-portal', {
      url: 'javascript:alert(1)',
      username: 'wn_owner',
      password: 'secret'
    });
    check('Unsafe javascript: portal URL rejected (400)', badUrl.status === 400);

    const saveP = await ow('PUT', '/api/owner/whitenoise-portal', {
      url: 'https://portal.whitenoise.example/login',
      username: 'owner_wn_user',
      password: 'WN-Strong-Password!99'
    });
    const readP = await ow('GET', '/api/owner/whitenoise-portal');
    check('Owner saves & reads Original Whitenoise Portal credentials cleanly',
      saveP.status === 200 &&
      readP.status === 200 &&
      readP.data?.portal?.url === 'https://portal.whitenoise.example/login' &&
      readP.data?.portal?.username === 'owner_wn_user' &&
      readP.data?.portal?.password === 'WN-Strong-Password!99');

    const agSet = await ag('GET', '/api/settings');
    const clSet = await cl1('GET', '/api/settings');
    check('/api/settings never leaks Owner portal credentials to Agent or Client',
      agSet.data?.whitenoise_portal_access === undefined &&
      clSet.data?.whitenoise_portal_access === undefined &&
      !JSON.stringify(agSet.data).includes('WN-Strong-Password!99') &&
      !JSON.stringify(clSet.data).includes('WN-Strong-Password!99'));

    // ── 4. Static Wiring Checks ──
    const uiKitSrc = fs.readFileSync('humex-sms/static/js/shared-ui-kit.js', 'utf8');
    const chatSrc = fs.readFileSync('humex-sms/static/js/shared-live-chat.js', 'utf8');
    const ownerSrc = fs.readFileSync('humex-sms/static/js/owner-shell.js', 'utf8');
    check('All frontend UI components & handlers verified cleanly',
      uiKitSrc.includes('zyRenderCdr2DailyBanner') &&
      uiKitSrc.includes('zyOpenCdr2TermsModal') &&
      uiKitSrc.includes('zyCopyTextSafe') &&
      chatSrc.includes('saveGroupSchedule') &&
      chatSrc.includes('zy-chat-night-banner') &&
      chatSrc.includes('data-zy-sched-countdown') &&
      ownerSrc.includes('zyLoadOwnerWhitenoisePortalBar') &&
      ownerSrc.includes('zyOpenOwnerWnPortalModal'));

    summary('Live Chat Group Schedule & CDR 2 Features Suite');
  } finally {
    await srv.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
