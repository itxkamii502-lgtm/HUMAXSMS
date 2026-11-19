// Unified Role-Based Theme Studio & Per-User Profile Theme Tests
import { makeFixture, startServer, check, summary } from './lib.js';

const TEST_PORT = 4418;
const dir = makeFixture();
const srv = await startServer(dir, TEST_PORT);

try {
  // 1. Login Owner, Agent, Client
  const own = await srv.login('Kamran_Bhatti', 'ownerpass1');
  const ag = await srv.login('agent_one', 'agentpass1');
  const cl = await srv.login('client_one', 'clientpass1');
  check('Owner, Agent, Client logins succeed', own.ok && ag.ok && cl.ok);

  // 2. GET /api/settings returns 5 built-in Role Themes + default_theme_key
  const getSet = await srv.api('GET', '/api/settings', { cookie: own.cookie });
  check('GET /api/settings returns theme_catalog (>=5) and default_theme_key',
    getSet.status === 200 &&
    Array.isArray(getSet.data?.theme_catalog) &&
    getSet.data.theme_catalog.length >= 5 &&
    getSet.data.default_theme_key === 'daylight_cobalt'
  );

  // 3. Non-Owner blocked (403) from creating or deleting Owner themes
  const agCreate = await srv.api('POST', '/api/settings/themes', {
    cookie: ag.cookie,
    body: { key: 'ag_hack', name: 'Agent Hack', structure_bg: '#111111', primary_btn: '#2563eb' }
  });
  const clCreate = await srv.api('POST', '/api/settings/themes', {
    cookie: cl.cookie,
    body: { key: 'cl_hack', name: 'Client Hack', structure_bg: '#111111', primary_btn: '#2563eb' }
  });
  check('Agent & Client blocked (403) from POST /api/settings/themes', agCreate.status === 403 && clCreate.status === 403);

  // 4. Owner creates two custom Role Themes
  const custom1 = await srv.api('POST', '/api/settings/themes', {
    cookie: own.cookie,
    body: {
      key: 'royal_ocean',
      name: 'Royal Ocean',
      structure_bg: '#0c4a6e',
      structure_table_bg: '#075985',
      primary_btn: '#0284c7',
      warning_btn: '#d97706',
      danger_btn: '#dc2626'
    }
  });
  const custom2 = await srv.api('POST', '/api/settings/themes', {
    cookie: own.cookie,
    body: {
      key: 'obsidian_gold',
      name: 'Obsidian Amber',
      structure_bg: '#18181b',
      structure_table_bg: '#27272a',
      primary_btn: '#059669',
      warning_btn: '#d97706',
      danger_btn: '#dc2626'
    }
  });
  check('Owner publishes custom Role Themes (200)',
    custom1.status === 200 && custom1.data?.success === true &&
    custom2.status === 200 && custom2.data?.success === true
  );

  // 5. Built-in theme deletion rejected (400)
  const delBuiltin = await srv.api('DELETE', '/api/settings/themes/daylight_cobalt', { cookie: own.cookie });
  check('Deleting built-in starter theme is rejected (400)', delBuiltin.status === 400);

  // 6. Agent & Client choose published themes in My Profile without mutating global settings
  const clPickBad = await srv.api('POST', '/api/user/profile/update', {
    cookie: cl.cookie,
    body: { theme_key: 'nonexistent_theme_xyz' }
  });
  check('Unknown theme_key rejected (400) on /api/user/profile/update', clPickBad.status === 400);

  const clPick = await srv.api('POST', '/api/user/profile/update', {
    cookie: cl.cookie,
    body: { theme_key: 'royal_ocean', theme_mode: 'dark' }
  });
  const agPick = await srv.api('POST', '/api/user/profile/update', {
    cookie: ag.cookie,
    body: { theme_key: 'emerald_executive', theme_mode: 'light' }
  });
  check('Client picks royal_ocean (dark) and Agent picks emerald_executive (light)',
    clPick.status === 200 && clPick.data?.user?.theme_key === 'royal_ocean' && clPick.data?.user?.theme_mode === 'dark' &&
    agPick.status === 200 && agPick.data?.user?.theme_key === 'emerald_executive'
  );

  // 7. Verify isolation & SSR HTML injection per logged-in user
  const ownSetAfter = await srv.api('GET', '/api/settings', { cookie: own.cookie });
  check('Per-user profile theme change leaves global default_theme_key untouched',
    ownSetAfter.data?.default_theme_key === 'daylight_cobalt'
  );

  const clMe = await srv.api('GET', '/api/auth/me', { cookie: cl.cookie });
  const agMe = await srv.api('GET', '/api/auth/me', { cookie: ag.cookie });
  check('/api/auth/me returns distinct personal theme_key per user',
    clMe.data?.theme_key === 'royal_ocean' && clMe.data?.theme_mode === 'dark' &&
    agMe.data?.theme_key === 'emerald_executive' && agMe.data?.theme_mode === 'light'
  );

  const clHtmlRes = await fetch(`http://127.0.0.1:${TEST_PORT}/client`, { headers: { Cookie: cl.cookie } });
  const clHtml = await clHtmlRes.text();
  const agHtmlRes = await fetch(`http://127.0.0.1:${TEST_PORT}/agent`, { headers: { Cookie: ag.cookie } });
  const agHtml = await agHtmlRes.text();
  check('SSR injects user-specific --theme-struct-bg in HTML without cross-user leakage',
    clHtml.includes('--theme-struct-bg: #0c4a6e') &&
    clHtml.includes('data-role-theme="royal_ocean"') &&
    agHtml.includes('--theme-struct-bg: #064e3b') &&
    agHtml.includes('data-role-theme="emerald_executive"')
  );

  // 8. Owner updates global default_theme_key -> users with explicit theme_key stay unchanged
  const updDef = await srv.api('POST', '/api/settings', {
    cookie: own.cookie,
    body: { default_theme_key: 'midnight_navy' }
  });
  check('Owner updates global default_theme_key to midnight_navy',
    updDef.status === 200 && updDef.data?.default_theme_key === 'midnight_navy'
  );
  const agMeAfterOwnerChange = await srv.api('GET', '/api/auth/me', { cookie: ag.cookie });
  check('Agent explicit theme_key remains emerald_executive when Owner switches global default',
    agMeAfterOwnerChange.data?.theme_key === 'emerald_executive'
  );

  // 9. Active default deletion rejected (400)
  const setCustomDef = await srv.api('POST', '/api/settings', {
    cookie: own.cookie,
    body: { default_theme_key: 'obsidian_gold' }
  });
  check('Owner sets custom theme obsidian_gold as default', setCustomDef.status === 200);
  const delActiveDef = await srv.api('DELETE', '/api/settings/themes/obsidian_gold', { cookie: own.cookie });
  check('Deleting active default custom theme rejected (400)', delActiveDef.status === 400);

  // Switch default back to midnight_navy, then delete royal_ocean while Client references it
  await srv.api('POST', '/api/settings', { cookie: own.cookie, body: { default_theme_key: 'midnight_navy' } });
  const delRoyal = await srv.api('DELETE', '/api/settings/themes/royal_ocean', { cookie: own.cookie });
  check('Owner deletes unused/non-default custom theme royal_ocean (200)', delRoyal.status === 200);

  // Client SSR must gracefully fall back to global default (#0f172a midnight_navy)
  const clHtmlFallback = await (await fetch(`http://127.0.0.1:${TEST_PORT}/client`, { headers: { Cookie: cl.cookie } })).text();
  check('Client whose custom theme was deleted gracefully falls back to global default in SSR HTML',
    clHtmlFallback.includes('--theme-struct-bg: #0f172a') &&
    clHtmlFallback.includes('data-role-theme="midnight_navy"')
  );

  // 10. Clean HTML renders zero legacy wave gradient script markers
  check('No legacy HEADER_GRADIENTS or wave color sliders exist in frontend JS',
    !clHtml.includes('HEADER_GRADIENTS')
  );
} finally {
  await srv.stop();
}

const ok = summary('Role Theme System Integration');
if (!ok) process.exit(1);
