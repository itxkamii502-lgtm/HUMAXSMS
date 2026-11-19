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

    // 2. Master payterm list in settings default exactly: Weekly, Biweekly, Monthly
    const setRes = await srv.api('GET', '/api/settings', { cookie: ow.cookie });
    check('Settings has payterms array', setRes.status === 200 && Array.isArray(setRes.data.payterms));
    const expectedDefaults = ['Weekly', 'Biweekly', 'Monthly'];
    const hasExactDefaults = expectedDefaults.length === (setRes.data.payterms || []).length &&
      expectedDefaults.every(d => (setRes.data.payterms || []).includes(d));
    check('Settings contains ONLY the 3 active payterms (Weekly, Biweekly, Monthly)', hasExactDefaults);

    // Client/Agent safeSettings also includes payterms
    const safeSetRes = await srv.api('GET', '/api/settings', { cookie: ag.cookie });
    check('Non-owner settings includes master payterms list', safeSetRes.status === 200 && Array.isArray(safeSetRes.data.payterms));

    // Dedicated /api/payterms endpoint + schedule metadata
    const ptRes = await srv.api('GET', '/api/payterms');
    check('GET /api/payterms returns 3 master payterms', ptRes.status === 200 && Array.isArray(ptRes.data.payterms) && ptRes.data.payterms.length === 3);

    // /api/payments includes payterm_schedules + hold_summary
    const payRes = await srv.api('GET', '/api/payments', { cookie: ag.cookie });
    check('GET /api/payments returns payterm_schedules for Weekly (7/3), Biweekly (15/3), Monthly (30/5) {W} & hold_summary',
      payRes.status === 200 &&
      payRes.data?.payterm_schedules?.Weekly?.cycle_days === 7 &&
      payRes.data?.payterm_schedules?.Weekly?.hold_days === 3 &&
      payRes.data?.payterm_schedules?.Biweekly?.cycle_days === 15 &&
      payRes.data?.payterm_schedules?.Biweekly?.hold_days === 3 &&
      payRes.data?.payterm_schedules?.Monthly?.cycle_days === 30 &&
      payRes.data?.payterm_schedules?.Monthly?.hold_days === 5 &&
      Boolean(payRes.data?.hold_summary)
    );

    // 3. Editable by Owner only
    const nonOwnerSet = await srv.api('POST', '/api/settings', { cookie: ag.cookie, body: { payterms: ['Weekly'] } });
    check('Non-owner cannot edit settings (403)', nonOwnerSet.status === 403);

    const nonOwnerPt = await srv.api('POST', '/api/payterms', { cookie: ag.cookie, body: { payterms: ['Weekly'] } });
    check('Non-owner cannot edit /api/payterms (403)', nonOwnerPt.status === 403);

    const ownerPt = await srv.api('POST', '/api/payterms', { cookie: ow.cookie, body: { payterms: ['Weekly', 'Biweekly', 'Monthly', 'CustomTerm'] } });
    check('Owner can update /api/payterms (200)', ownerPt.status === 200 && (ownerPt.data.payterms || []).includes('CustomTerm'));

    // Reset back to exact 3 defaults
    await srv.api('POST', '/api/payterms', { cookie: ow.cookie, body: { payterms: expectedDefaults } });

    // 4. Server validates payterm values: reject unknown/removed strings with 400
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

    for (const removedTerm of ['1/1', '7/1', '15/30', 'Monthly60', 'Monthly10']) {
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

    // 5. Server accepts the 3 valid master payterms
    const goodRangeCreate = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'MasterPT Valid Range',
        country: 'ValidLand',
        prefix: '8888',
        company_cost: 0.02,
        payterms: {
          'Weekly': 0.012,
          'Biweekly': 0.014,
          'Monthly': 0.015
        }
      }
    });
    check('Server accepts all 3 valid payterms (Weekly, Biweekly, Monthly) on range create', goodRangeCreate.status === 200);

    // 6. Alias normalization: 7/3 -> Weekly, 15/3 -> Biweekly, 30/5 -> Monthly, Monthly (30/5) {W} -> Monthly
    const alias73 = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'Alias73 Range',
        country: 'Alias73',
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
        prefix: '7772',
        company_cost: 0.02,
        payterm: '15/3',
        payterms: { '15/3': 0.014 }
      }
    });
    check('Alias 15/3 normalizes to Biweekly (200)',
      alias153.status === 200 && alias153.data.payterm === 'Biweekly' && alias153.data.cycle_days === 15 && alias153.data.hold_days === 3 && Number(alias153.data.payterms?.Biweekly) === 0.014
    );

    const alias305 = await srv.api('POST', '/api/numbers/sms-ranges', {
      cookie: ow.cookie,
      body: {
        range_name: 'Alias305 Range',
        country: 'Alias305',
        prefix: '7773',
        company_cost: 0.02,
        payterm: 'Monthly (30/5) {W}',
        payterms: { '30/5': 0.016 }
      }
    });
    check('Alias 30/5 and Monthly (30/5) {W} normalize to Monthly (200)',
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
