import { makeFixture, startServer, check, summary, readJson } from './lib.js';

console.log('\n=== Payterm List & Server Validation Tests (R2) ===');

export async function stagePayterms() {
  const dir = makeFixture();
  const srv = await startServer(dir, 3995);

  try {
    // 1. Logins
    const ow = await srv.login('Kamran_Bhatti', 'ownerpass1');
    check('Owner logs in', ow.ok);

    const ag = await srv.login('agent_one', 'agentpass1');
    check('Agent logs in', ag.ok);

    const cl = await srv.login('client_one', 'clientpass1');
    check('Client logs in', cl.ok);

    // 2. Master payterm list in settings default exactly: Weekly, Monthly (Biweekly completely removed)
    const setRes = await srv.api('GET', '/api/settings', { cookie: ow.cookie });
    check('Settings has payterms array', setRes.status === 200 && Array.isArray(setRes.data.payterms));
    const expectedDefaults = ['Weekly', 'Monthly'];
    const hasExactDefaults = expectedDefaults.length === (setRes.data.payterms || []).length &&
      expectedDefaults.every(d => (setRes.data.payterms || []).includes(d));
    check('Settings contains ONLY the 2 active payterms (Weekly, Monthly)', hasExactDefaults);

    // Client/Agent safeSettings also includes payterms
    const safeSetRes = await srv.api('GET', '/api/settings', { cookie: ag.cookie });
    check('Non-owner settings includes master payterms list', safeSetRes.status === 200 && Array.isArray(safeSetRes.data.payterms));

    // Dedicated /api/payterms endpoint + schedule metadata
    const ptRes = await srv.api('GET', '/api/payterms');
    check('GET /api/payterms returns 2 master payterms (Weekly, Monthly)', ptRes.status === 200 && Array.isArray(ptRes.data.payterms) && ptRes.data.payterms.length === 2 && !ptRes.data.payterms.includes('Biweekly'));

    // /api/payments includes payterm_schedules + hold_summary (NO Biweekly)
    const payRes = await srv.api('GET', '/api/payments', { cookie: ag.cookie });
    check('GET /api/payments returns payterm_schedules for Weekly (7/3), Monthly (30/5) {W} & hold_summary (no Biweekly)',
      payRes.status === 200 &&
      payRes.data?.payterm_schedules?.Weekly?.cycle_days === 7 &&
      payRes.data?.payterm_schedules?.Weekly?.hold_days === 3 &&
      !payRes.data?.payterm_schedules?.Biweekly &&
      payRes.data?.payterm_schedules?.Monthly?.cycle_days === 30 &&
      payRes.data?.payterm_schedules?.Monthly?.hold_days === 5 &&
      Boolean(payRes.data?.hold_summary)
    );

    // 3. Editable by Owner only (Biweekly always stripped/blocked)
    const nonOwnerSet = await srv.api('POST', '/api/settings', { cookie: ag.cookie, body: { payterms: ['Weekly'] } });
    check('Non-owner cannot edit settings (403)', nonOwnerSet.status === 403);

    const nonOwnerPt = await srv.api('POST', '/api/payterms', { cookie: ag.cookie, body: { payterms: ['Weekly'] } });
    check('Non-owner cannot edit /api/payterms (403)', nonOwnerPt.status === 403);

    const ownerPt = await srv.api('POST', '/api/payterms', { cookie: ow.cookie, body: { payterms: ['Weekly', 'Biweekly', 'Monthly', 'CustomTerm'] } });
    check('Owner can update /api/payterms (200) and Biweekly is stripped',
      ownerPt.status === 200 &&
      (ownerPt.data.payterms || []).includes('CustomTerm') &&
      !(ownerPt.data.payterms || []).includes('Biweekly')
    );

    // Reset back to exact 2 defaults
    await srv.api('POST', '/api/payterms', { cookie: ow.cookie, body: { payterms: expectedDefaults } });

    // 4. Server validates payterm values: reject unknown/removed strings (including Biweekly & 15/3) with 400
    // (a) Range creation with unknown & removed strings
    const badRangeCreate = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        country: 'BadRangeTest',
        prefix: '9999',
        company_cost: 0.02,
        payterms: { 'UnknownTermXYZ': 0.015 }
      }
    });
    check('Server rejects unknown payterm on range create with 400', badRangeCreate.status === 400);

    for (const removedTerm of ['1/1', '7/1', '15/3', 'Biweekly', '15/30', 'Monthly60', 'Monthly10']) {
      const removedRes = await srv.api('POST', '/api/numbers/sms-ranges', {
        cookie: ow.cookie,
        body: {
          country: 'RemovedTermTest',
          prefix: '9998',
          company_cost: 0.02,
          payterms: { [removedTerm]: 0.015 }
        }
      });
      check(`Server rejects deleted payterm "${removedTerm}" on range create with 400`, removedRes.status === 400);
    }

    // (b) Range patch
    const badRangePatch = await srv.api('PATCH', '/api/numbers/sms-ranges/1', {
      cookie: ow.cookie,
      body: {
        payterms: { 'IllegalNet45': 0.015 }
      }
    });
    check('Server rejects unknown payterm on range patch with 400', badRangePatch.status === 400);

    // (c) Single assign to agent
    const badAssignAg = await srv.api('POST', '/api/numbers/1/assign', {
      cookie: ow.cookie,
      body: {
        target_type: 'agent',
        target_id: 1,
        payterm: 'InvalidAgPayterm'
      }
    });
    check('Server rejects unknown payterm on agent assign with 400', badAssignAg.status === 400);

    // (d) Single assign to client
    const badAssignCl = await srv.api('POST', '/api/numbers/4/assign', {
      cookie: ag.cookie,
      body: {
        target_type: 'client',
        target_id: 1,
        client_payterm: 'InvalidClPayterm'
      }
    });
    check('Server rejects unknown client_payterm on client assign with 400', badAssignCl.status === 400);

    // (e) Bulk assign
    const badBulk = await srv.api('POST', '/api/numbers/bulk-assign-many', {
      cookie: ag.cookie,
      body: {
        number_ids: [4],
        target_id: 1,
        client_payterm: 'BadBulkPayterm'
      }
    });
    check('Server rejects unknown payterm on bulk-assign-many with 400', badBulk.status === 400);

    // 5. Server enforces Standard = Weekly ONLY, Whitenoise = Monthly ONLY
    const goodStdRange = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'MasterPT Standard Weekly Range',
        country: 'ValidLand',
        provider: 'StandardTel',
        prefix: '8888',
        company_cost: 0.02,
        payterms: {
          'Weekly': 0.012
        }
      }
    });
    check('Server accepts Weekly on standard range create (active_payterms = ["Weekly"])',
      goodStdRange.status === 200 &&
      JSON.stringify(goodStdRange.data.active_payterms) === '["Weekly"]'
    );

    const goodWnRange = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'MasterPT Whitenoise Monthly Range',
        country: 'ValidLand',
        provider: 'Whitenoise',
        prefix: '8889',
        company_cost: 0.025,
        payterms: {
          'Monthly': 0.015
        }
      }
    });
    check('Server accepts Monthly on Whitenoise range create (active_payterms = ["Monthly"])',
      goodWnRange.status === 200 &&
      JSON.stringify(goodWnRange.data.active_payterms) === '["Monthly"]'
    );

    // 6. Alias normalization: 7/3 -> Weekly (standard), 30/5 & Monthly (30/5) {W} -> Monthly (Whitenoise); 15/3 rejected
    const alias73 = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'Alias73 Range',
        country: 'Alias73',
        provider: 'StandardTel',
        prefix: '7771',
        company_cost: 0.02,
        payterm: '7/3',
        payterms: { '7/3': 0.012 }
      }
    });
    check('Alias 7/3 normalizes to Weekly (200)',
      alias73.status === 200 && alias73.data.payterm === 'Weekly' && alias73.data.hold_days === 3 && Number(alias73.data.payterms?.Weekly) === 0.012
    );

    const alias153 = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'Alias153 Range',
        country: 'Alias153',
        provider: 'StandardTel',
        prefix: '7772',
        company_cost: 0.02,
        payterm: '15/3',
        payterms: { '15/3': 0.014 }
      }
    });
    check('Alias 15/3 (removed Biweekly) is rejected with 400', alias153.status === 400);

    const alias305 = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'Alias305 Range',
        country: 'Alias305',
        provider: 'Whitenoise',
        prefix: '7773',
        company_cost: 0.02,
        payterm: 'Monthly (30/5) {W}',
        payterms: { '30/5': 0.016 }
      }
    });
    check('Alias 30/5 and Monthly (30/5) {W} normalize to Monthly on Whitenoise range (200)',
      alias305.status === 200 && alias305.data.payterm === 'Monthly' && alias305.data.cycle_days === 30 && alias305.data.hold_days === 5 && Number(alias305.data.payterms?.Monthly) === 0.016
    );

  } finally {
    await srv.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await stagePayterms();
  const ok = summary('PAYTERMS R2');
  process.exit(ok ? 0 : 1);
}
