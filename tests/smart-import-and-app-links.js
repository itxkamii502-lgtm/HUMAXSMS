import { createRequire } from 'node:module';
import { makeFixture, startServer, check, summary } from './lib.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const PORT = 3515;

async function uploadMultipart(port, pathUrl, cookie, fieldName, filename, buffer) {
  const form = new FormData();
  form.append(fieldName, new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  const res = await fetch(`http://127.0.0.1:${port}${pathUrl}`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form
  });
  let body = null;
  try { body = await res.json(); } catch (_) {}
  return { status: res.status, body };
}

async function run() {
  const dir = makeFixture({
    agents: [
      { id: 1, username: 'agent_alpha', name: 'Agent Alpha', password: 'agentpass1', role: 'Agent', status: 'active', whitenoise_access: true, app_links_access: false }
    ],
    clients: [
      { id: 1, username: 'client_alpha', name: 'Client Alpha', password: 'clientpass1', role: 'Client', agent_id: 1, status: 'active', whitenoise_access: true, app_links_access: false }
    ],
    sms_ranges: [
      { id: 101, range_name: 'Pakistan Mobilink {W}', name: 'Pakistan Mobilink {W}', country: 'Pakistan', prefix: '92300', provider: 'Whitenoise', is_whitenoise: true, payterm: 'Monthly', payout_schedule: 'monthly30_5', active: true },
      { id: 102, range_name: 'Turkey Mobile {W}', name: 'Turkey Mobile {W}', country: 'Turkey', prefix: '90532', provider: 'Whitenoise', is_whitenoise: true, payterm: 'Monthly', payout_schedule: 'monthly30_5', active: true },
      { id: 103, range_name: 'UK Virtual Weekly', name: 'UK Virtual Weekly', country: 'United Kingdom', prefix: '44770', provider: 'CarrierA', is_whitenoise: false, payterm: 'Weekly', payout_schedule: 'weekly7_3', active: true }
    ],
    numbers: [
      { id: 1, number: '923001111111', range_id: 101, range_name: 'Pakistan Mobilink {W}', country: 'Pakistan', status: 'active', agent_id: null, client_id: null, is_whitenoise: true }
    ]
  });

  const srv = await startServer(dir, PORT);
  try {
    const owL = await srv.login('Kamran_Bhatti', 'ownerpass1');
    const agL = await srv.login('agent_alpha', 'agentpass1');
    const clL = await srv.login('client_alpha', 'clientpass1');
    check('Owner, Agent, and Client log in cleanly', Boolean(owL.ok && agL.ok && clL.ok));

    const asUser = (cookie) => async (method, url, body) => {
      const r = await srv.api(method, url, { cookie, body });
      return { status: r.status, body: r.data, headers: r.headers };
    };
    const ow = asUser(owL.cookie);
    const ag = asUser(agL.cookie);
    const cl = asUser(clL.cookie);

    // ═══════════════════════════════════════════════════════════════
    // PART 1: SMART MULTI-COUNTRY / MULTI-RANGE EXCEL NUMBER IMPORTER
    // ═══════════════════════════════════════════════════════════════
    const wbNums = XLSX.utils.book_new();
    // Sheet 1: Multi-column matrix (each column = a range header + phone numbers below)
    const wsMatrix = XLSX.utils.aoa_to_sheet([
      ['Pakistan Mobilink', 'Turkey Mobile', 'UK Virtual'],
      ['923001111111', '905321000001', '447700900001'], // 923001111111 already exists in DB!
      ['923001111112', '905321000002', '447700900002'],
      ['923001111113', '905321000002', '']              // 905321000002 duplicate inside file!
    ]);
    XLSX.utils.book_append_sheet(wbNums, wsMatrix, 'Daily Numbers');
    const numsBuf = XLSX.write(wbNums, { type: 'buffer', bookType: 'xlsx' });

    // Non-owner forbidden
    const agPreview = await uploadMultipart(PORT, '/api/numbers/smart-sheet-preview', agL.cookie, 'file', 'Kamran Bhatti (Pakistan) 18.11.xlsx', numsBuf);
    check('Agent is forbidden (403) from Smart Excel Number Preview', agPreview.status === 403);
    const clPreview = await uploadMultipart(PORT, '/api/numbers/smart-sheet-preview', clL.cookie, 'file', 'Kamran Bhatti (Pakistan) 18.11.xlsx', numsBuf);
    check('Client is forbidden (403) from Smart Excel Number Preview', clPreview.status === 403);

    // Owner preview & dedup check
    const owPreview = await uploadMultipart(PORT, '/api/numbers/smart-sheet-preview', owL.cookie, 'file', 'Kamran Bhatti (Pakistan) 18.11.xlsx', numsBuf);
    check('Owner Smart Sheet Preview succeeds (200) with preview_token', owPreview.status === 200 && Boolean(owPreview.body?.preview_token));
    const sum = owPreview.body?.summary || {};
    check('Preview detects 3 range groups, 8 total rows, 6 verified new, 1 already exists, 1 file duplicate',
      sum.groups_count === 3 && sum.total_in_file === 8 && sum.verified_new === 6 && sum.already_exists === 1 && sum.duplicates_in_file === 1,
      JSON.stringify(sum));

    const groups = owPreview.body?.groups || [];
    const pkGrp = groups.find(g => g.label === 'Pakistan Mobilink');
    const trGrp = groups.find(g => g.label === 'Turkey Mobile');
    const ukGrp = groups.find(g => g.label === 'UK Virtual');
    check('Auto-matches Pakistan Mobilink -> Range 101 {W} with high confidence',
      Boolean(pkGrp && pkGrp.suggested_range_id === 101 && pkGrp.new_count === 2 && pkGrp.existing_count === 1),
      JSON.stringify(pkGrp));
    check('Auto-matches Turkey Mobile -> Range 102 {W} & UK Virtual -> Range 103',
      Boolean(trGrp && trGrp.suggested_range_id === 102 && trGrp.new_count === 2 && ukGrp && ukGrp.suggested_range_id === 103 && ukGrp.new_count === 2));

    // Selective 1-click commit for ONLY Pakistan Mobilink first
    const commitPk = await ow('POST', '/api/numbers/smart-sheet-commit', {
      preview_token: owPreview.body.preview_token,
      group_key: pkGrp.group_key,
      target_range_id: 101
    });
    check('Selective 1-click commit imports ONLY Pakistan Mobilink (2 new numbers)',
      commitPk.status === 200 && commitPk.body?.inserted === 2 && commitPk.body?.skipped_existing === 0,
      JSON.stringify(commitPk.body));

    // Re-committing same group inserts 0 duplicates
    const commitPkAgain = await ow('POST', '/api/numbers/smart-sheet-commit', {
      preview_token: owPreview.body.preview_token,
      group_key: pkGrp.group_key,
      target_range_id: 101
    });
    check('Re-committing same group inserts 0 numbers and skips both as already existing',
      commitPkAgain.status === 200 && commitPkAgain.body?.inserted === 0 && commitPkAgain.body?.skipped_existing === 2,
      JSON.stringify(commitPkAgain.body));

    // Commit remaining 2 ranges (Turkey + UK) in batch
    const commitRest = await ow('POST', '/api/numbers/smart-sheet-commit', {
      preview_token: owPreview.body.preview_token,
      items: [
        { group_key: trGrp.group_key, target_range_id: 102 },
        { group_key: ukGrp.group_key, target_range_id: 103 }
      ]
    });
    check('Batch commit imports Turkey (2) + UK (2) = 4 new numbers',
      commitRest.status === 200 && commitRest.body?.inserted === 4,
      JSON.stringify(commitRest.body));

    // Verify numbers in DB carry proper Whitenoise Monthly metadata for {W} ranges
    const allNums = await ow('GET', '/api/numbers?limit=50');
    const numRows = allNums.body?.data || [];
    const pkImported = numRows.find(n => String(n.number) === '923001111112');
    const ukImported = numRows.find(n => String(n.number) === '447700900001');
    check('Imported Whitenoise number gets is_whitenoise=true & Monthly payterm, Weekly range stays Weekly',
      Boolean(pkImported && pkImported.is_whitenoise === true && pkImported.payterm === 'Monthly' && ukImported && !ukImported.is_whitenoise && ukImported.payterm === 'Weekly'));

    // Also test multi-sheet tabular workbook (Range + Number columns)
    const wbTab = XLSX.utils.book_new();
    const wsTab = XLSX.utils.aoa_to_sheet([
      ['Range', 'Number'],
      ['Pakistan Mobilink', '923001111112'], // already inserted above!
      ['Pakistan Mobilink', '923001111199']  // brand new!
    ]);
    XLSX.utils.book_append_sheet(wbTab, wsTab, 'Sheet1');
    const tabBuf = XLSX.write(wbTab, { type: 'buffer', bookType: 'xlsx' });
    const tabPrev = await uploadMultipart(PORT, '/api/numbers/smart-sheet-preview', owL.cookie, 'file', 'tabular.xlsx', tabBuf);
    check('Tabular Range+Number sheet detects live DB duplicate and isolates 1 brand-new number',
      tabPrev.status === 200 && tabPrev.body?.summary?.verified_new === 1 && tabPrev.body?.summary?.already_exists === 1,
      JSON.stringify(tabPrev.body?.summary));

    // ═══════════════════════════════════════════════════════════════
    // PART 2: APPS LINKS DIRECTORY (EXCEL + HYPERLINKS + TOP/LOW + RBAC)
    // ═══════════════════════════════════════════════════════════════

    // Access control before enabling: Agent & Client must be blocked (403)
    const agMe0 = await ag('GET', '/api/auth/me');
    const clMe0 = await cl('GET', '/api/auth/me');
    const agLinks0 = await ag('GET', '/api/app-links');
    const clLinks0 = await cl('GET', '/api/app-links');
    check('Apps Links is hidden/forbidden (403) by default for Agent and Client',
      agMe0.body?.app_links_access === false && clMe0.body?.app_links_access === false && agLinks0.status === 403 && clLinks0.status === 403);

    // Unauthorized Agent cannot grant app_links_access to Client
    const unauthGrant = await ag('PATCH', '/api/clients/1', { app_links_access: true });
    check('Agent without app_links_access cannot grant app_links_access to Client (403)', unauthGrant.status === 403);

    // Owner uploads Services.xlsx with BOTH embedded cell hyperlink AND standard 2-column row
    const wbApps = XLSX.utils.book_new();
    const wsApps = XLSX.utils.aoa_to_sheet([
      ['App Name', 'Link', 'Category'],
      ['WhatsApp Business', '', 'Messaging'],
      ['Telegram', 'https://play.google.com/store/apps/details?id=org.telegram.messenger', 'Messaging'],
      ['Facebook', 'play.google.com/store/apps/details?id=com.facebook.katana', 'Social']
    ]);
    // Embed hyperlink directly on A2 ("WhatsApp Business")
    wsApps['A2'].l = { Target: 'https://play.google.com/store/apps/details?id=com.whatsapp.w4b' };
    XLSX.utils.book_append_sheet(wbApps, wsApps, 'Services');
    const appsBuf = XLSX.write(wbApps, { type: 'buffer', bookType: 'xlsx' });

    const importApps = await uploadMultipart(PORT, '/api/app-links/import-excel', owL.cookie, 'file', 'Services 1611.xlsx', appsBuf);
    check('Owner Apps Links Excel import parses embedded hyperlink + standard + bare-domain URLs (3 added)',
      importApps.status === 200 && importApps.body?.added === 3 && importApps.body?.total === 3,
      JSON.stringify(importApps.body));

    // Reject unsafe javascript: URL
    const badUrl = await ow('POST', '/api/app-links', { name: 'Bad App', url: 'javascript:alert(1)' });
    check('Rejects unsafe javascript: URL with 400', badUrl.status === 400);

    // Manual add + Edit + Hide + Reorder Top/Low
    const manualAdd = await ow('POST', '/api/app-links', {
      name: 'Instagram',
      url: 'https://play.google.com/store/apps/details?id=com.instagram.android',
      category: 'Social',
      visible: true
    });
    check('Owner can manually add an App Link', manualAdd.status === 200 && manualAdd.body?.data?.name === 'Instagram');
    const instaId = manualAdd.body.data.id;

    // Move Instagram to TOP
    const moveTop = await ow('POST', '/api/app-links/reorder', { id: instaId, action: 'top' });
    check('Reorder "top" pins Instagram to index 0',
      moveTop.status === 200 && moveTop.body?.data?.[0]?.id === instaId && moveTop.body?.data?.[0]?.pinned_top === true);

    // Move Instagram to LOW (bottom)
    const moveLow = await ow('POST', '/api/app-links/reorder', { id: instaId, action: 'low' });
    const lowList = moveLow.body?.data || [];
    check('Reorder "low" moves Instagram to last position and unpins',
      moveLow.status === 200 && lowList[lowList.length - 1]?.id === instaId && lowList[lowList.length - 1]?.pinned_top === false);

    // Hide Facebook from users (Owner still sees 4, Users should only see 3)
    const fbItem = lowList.find(x => x.name === 'Facebook');
    const hideFb = await ow('PATCH', `/api/app-links/${fbItem.id}`, { visible: false });
    check('Owner can hide an individual app (visible=false)', hideFb.status === 200 && hideFb.body?.data?.visible === false);

    // Owner enables app_links_access on Agent
    const enableAg = await ow('PATCH', '/api/agents/1', { app_links_access: true });
    check('Owner enables app_links_access on Agent', enableAg.status === 200 && enableAg.body?.app_links_access === true);

    const agLinks1 = await ag('GET', '/api/app-links');
    check('Authorized Agent sees only visible apps (3 of 4, Facebook hidden) in Owner priority order',
      agLinks1.status === 200 && agLinks1.body?.data?.length === 3 && !agLinks1.body.data.some(x => x.name === 'Facebook') && agLinks1.body.data[2]?.name === 'Instagram',
      JSON.stringify(agLinks1.body?.data?.map(x => x.name)));

    // Client still blocked until Agent enables for Client
    const clLinksStillBlocked = await cl('GET', '/api/app-links');
    check('Client remains blocked (403) until Agent enables app_links_access for them', clLinksStillBlocked.status === 403);

    // Authorized Agent enables app_links_access for Client
    const enableCl = await ag('PATCH', '/api/clients/1', { app_links_access: true });
    check('Authorized Agent enables app_links_access on their Client', enableCl.status === 200 && enableCl.body?.app_links_access === true);

    const clLinks1 = await cl('GET', '/api/app-links');
    const clMe1 = await cl('GET', '/api/auth/me');
    check('Authorized Client receives app_links_access=true and sees 3 visible apps in exact Owner order',
      clMe1.body?.app_links_access === true && clLinks1.status === 200 && clLinks1.body?.data?.length === 3 && clLinks1.body.data[2]?.name === 'Instagram');

    // Client & Agent cannot write/delete App Links
    const clWrite = await cl('POST', '/api/app-links', { name: 'Hack', url: 'https://example.com' });
    const agDelete = await ag('DELETE', `/api/app-links/${instaId}`);
    check('Client and Agent are forbidden (403) from creating or deleting App Links', clWrite.status === 403 && agDelete.status === 403);

    // Owner revokes Agent access -> Client automatically loses access too
    await ow('PATCH', '/api/agents/1', { app_links_access: false });
    const clRevoked = await cl('GET', '/api/app-links');
    check('Revoking Agent app_links_access cascades immediately to their Clients (403)', clRevoked.status === 403);

    // Owner can delete App Link
    const delInsta = await ow('DELETE', `/api/app-links/${instaId}`);
    check('Owner can delete an App Link', delInsta.status === 200 && delInsta.body?.success === true);
  } finally {
    await srv.stop();
  }
}

run()
  .then(() => {
    const ok = summary();
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
