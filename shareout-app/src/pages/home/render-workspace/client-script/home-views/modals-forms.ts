/** Shared modal helpers and connector/library create forms. */
export const workspace_client_home_views_modalsForms_JS = `  // ===== Modal + native create forms (Connectors connect, Library new module) =====
  function wsxModal(title, bodyHtml) {
    var ov = document.createElement('div'); ov.className = 'wsx-modal';
    ov.innerHTML = '<div class="wsx-modal__card"><div class="wsx-modal__head"><b>' + esc(title) + '</b><button class="wsx-modal__x" type="button" aria-label="' + esc(t('common.close')) + '">\\u00D7</button></div><div class="wsx-modal__body">' + bodyHtml + '</div></div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.wsx-modal__x').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return { ov: ov, close: close, body: ov.querySelector('.wsx-modal__body') };
  }
  function fld(label, id, ph, type) { return '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(label) + '</span><input class="wsx-field__in" id="' + id + '"' + (type ? ' type="' + type + '"' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>'; }
  function fta(label, id, ph, rows) { return '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(label) + '</span><textarea class="wsx-field__in wsx-field__ta" id="' + id + '" rows="' + (rows || 5) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></textarea></label>'; }
  function cv(id) { var e = document.getElementById(id); return e ? (e.value || '').trim() : ''; }

  var connCatMap = {};
  function connFieldsHtml(p) {
    if (p === 'bigquery') return fta(t('conn.serviceAccountJson'), 'cf_json', t('conn.pasteServiceAccountJson'), 6);
    if (p === 'rest_api') return fld(t('conn.baseUrl'), 'cf_base', t('conn.baseUrlPh'))
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('conn.auth')) + '</span><select class="wsx-field__in" id="cf_auth"><option value="api_key">' + esc(t('conn.authApiKey')) + '</option><option value="basic_auth">' + esc(t('conn.authBasic')) + '</option></select></label><div id="cf_authfields"></div>';
    if (p === 'snowflake') return fld(t('conn.account'), 'cf_account', t('conn.accountPh')) + fld(t('conn.user'), 'cf_user', t('conn.userPh')) + fta(t('conn.privateKey'), 'cf_pk', t('conn.privateKeyPh'), 5) + fld(t('conn.publicKeyFp'), 'cf_fp', t('conn.publicKeyFpPh'));
    if (p === 'facebook-ads') return '<p class="wsx-field__note">' + t('conn.fbNote') + '</p>' + fld(t('conn.adAccountId'), 'cf_fb_acct', t('conn.adAccountIdPh')) + fta(t('conn.accessToken'), 'cf_fb_token', t('conn.accessTokenPh'), 3);
    if (p === 'google-ads') return '<p class="wsx-field__note">' + esc(t('conn.gaNote')) + '</p>' + fld(t('conn.customerId'), 'cf_ga_cust', t('conn.customerIdPh')) + fld(t('conn.loginCustomerId'), 'cf_ga_login', '') + fld(t('conn.developerToken'), 'cf_ga_dev', '') + fld(t('conn.oauthClientId'), 'cf_ga_cid', '') + fld(t('conn.oauthClientSecret'), 'cf_ga_secret', '', 'password') + fld(t('conn.refreshToken'), 'cf_ga_refresh', '', 'password');
    if (p === 'google-analytics') return '<p class="wsx-field__note">' + esc(t('conn.ga4Note')) + '</p>' + fld(t('conn.ga4PropertyId'), 'cf_ga4_prop', t('conn.ga4PropertyIdPh')) + fta(t('conn.serviceAccountJson'), 'cf_ga4_json', t('conn.pasteServiceAccountJson'), 6);
    if (p === 'shopify') return '<p class="wsx-field__note">' + esc(t('conn.shopifyNote')) + '</p>' + fld(t('conn.storeDomain'), 'cf_sh_shop', t('conn.storeDomainPh')) + fld(t('conn.adminApiToken'), 'cf_sh_token', t('conn.adminApiTokenPh'), 'password');
    if (p === 'tiendanube') return '<p class="wsx-field__note">' + esc(t('conn.tnNote')) + '</p>' + fld(t('conn.storeId'), 'cf_tn_store', t('conn.storeIdPh')) + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('conn.region')) + '</span><select class="wsx-field__in" id="cf_tn_region"><option value="ar">' + esc(t('conn.regionAr')) + '</option><option value="br">' + esc(t('conn.regionBr')) + '</option></select></label>' + fld(t('conn.accessToken'), 'cf_tn_token', '', 'password');
    return '';
  }
  function connRestAuth() {
    var a = (document.getElementById('cf_auth') || {}).value, c = document.getElementById('cf_authfields'); if (!c) return;
    if (a === 'basic_auth') c.innerHTML = fld(t('conn.username'), 'cf_user2', '') + fld(t('conn.passwordSecret'), 'cf_pass2', '', 'password');
    else c.innerHTML = fld(t('conn.apiKeyToken'), 'cf_key', '') + fld(t('conn.headerNameOpt'), 'cf_hdr', t('conn.headerNamePh'));
  }
  function connBuild(p) {
    var pl = {};
    if (p === 'bigquery') { var raw = cv('cf_json'); if (!raw) return { err: t('conn.errPasteSaJson') }; var sa; try { sa = JSON.parse(raw); } catch (e) { return { err: t('conn.errInvalidJson') }; } pl.type = 'bigquery'; pl.credentials = { type: 'service_account', data: sa }; }
    else if (p === 'rest_api') { var base = cv('cf_base'); if (!base) return { err: t('conn.errEnterBaseUrl') }; pl.type = 'rest_api'; pl.config = { base_url: base }; if ((document.getElementById('cf_auth') || {}).value === 'basic_auth') { pl.credentials = { type: 'basic_auth', data: { username: cv('cf_user2'), password: cv('cf_pass2') } }; } else { var k = cv('cf_key'); if (!k) return { err: t('conn.errEnterApiKey') }; pl.credentials = { type: 'api_key', data: { api_key: k, header_name: cv('cf_hdr') || 'Authorization' } }; } }
    else if (p === 'snowflake') { var pk = cv('cf_pk'); if (!pk) return { err: t('conn.errPastePrivateKey') }; pl.kind = 'platform'; pl.provider = 'snowflake'; pl.credentials = { type: 'key_pair', data: { private_key: pk, account: cv('cf_account'), user: cv('cf_user'), public_key_fingerprint: cv('cf_fp') } }; }
    else if (p === 'google-analytics') { var g = cv('cf_ga4_json'); if (!g) return { err: t('conn.errPasteSaJson') }; var gsa; try { gsa = JSON.parse(g); } catch (e) { return { err: t('conn.errInvalidJson') }; } pl.kind = 'platform'; pl.provider = 'google-analytics'; pl.config = { propertyId: cv('cf_ga4_prop') }; pl.credentials = { type: 'service_account', data: gsa }; }
    else if (p === 'shopify') { var s = cv('cf_sh_shop'), tok = cv('cf_sh_token'); if (!s) return { err: t('conn.errEnterStoreDomain') }; if (!tok) return { err: t('conn.errPasteToken') }; pl.kind = 'platform'; pl.provider = 'shopify'; pl.config = { shop: s.replace('.myshopify.com', '') }; pl.credentials = { type: 'oauth', data: { access_token: tok } }; }
    else if (p === 'tiendanube') { var st = cv('cf_tn_store'), tt = cv('cf_tn_token'); if (!st) return { err: t('conn.errEnterStoreId') }; if (!tt) return { err: t('conn.errPasteToken') }; pl.kind = 'platform'; pl.provider = 'tiendanube'; pl.config = { store_id: st, region: cv('cf_tn_region') || 'ar' }; pl.credentials = { type: 'oauth', data: { access_token: tt } }; }
    else if (p === 'facebook-ads') { var fa = cv('cf_fb_acct'), ft = cv('cf_fb_token'); if (!fa) return { err: t('conn.errEnterAdAccountId') }; if (!ft) return { err: t('conn.errPasteToken') }; pl.kind = 'platform'; pl.provider = 'facebook-ads'; pl.config = { account_id: fa }; pl.credentials = { type: 'oauth', data: { access_token: ft } }; }
    else if (p === 'google-ads') { var gc = cv('cf_ga_cust'), gd = cv('cf_ga_dev'), gi = cv('cf_ga_cid'), gs = cv('cf_ga_secret'), gr = cv('cf_ga_refresh'); if (!gc) return { err: t('conn.errEnterCustomerId') }; if (!gd) return { err: t('conn.errEnterDevToken') }; if (!gi || !gs || !gr) return { err: t('conn.errEnterOauthCreds') }; pl.kind = 'platform'; pl.provider = 'google-ads'; pl.config = { customer_id: gc, login_customer_id: cv('cf_ga_login') }; pl.credentials = { type: 'authorized_user', data: { client_id: gi, client_secret: gs, refresh_token: gr, developer_token: gd } }; }
    else return { err: t('conn.errSetupFromChat') };
    return { payload: pl };
  }
  function connOAuth(pid, name, extra, modal) {
    fetch(wsUrl('/connections/' + encodeURIComponent(pid) + '/auth-url?connection=' + encodeURIComponent(name) + '&returnUrl=' + encodeURIComponent(location.href) + (extra || '')), { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        var e = modal.body.querySelector('#cf_err');
        if (!res.ok || !res.d || !res.d.authUrl) { if (e) e.textContent = (res.d && res.d.error) || t('modal.couldNotConnect'); return; }
        var pop = window.open(res.d.authUrl, 'so_oauth_' + pid, 'width=640,height=760');
        function onMsg(ev) {
          if (!ev.data || !ev.data.type) return;
          if (ev.data.type === 'shareout:workspace:connection:connected' || ev.data.type === 'shareout:platform:connected') {
            window.removeEventListener('message', onMsg);
            try { if (pop) pop.close(); } catch (_) {}
            modal.close();
            loaded.connectors = 0;
            loadConnectors();
            return;
          }
          if (ev.data.type === 'shareout:workspace:connection:error' || ev.data.type === 'shareout:platform:connection:error') {
            window.removeEventListener('message', onMsg);
            try { if (pop) pop.close(); } catch (_) {}
            var errEl = modal.body.querySelector('#cf_err');
            if (errEl) errEl.textContent = (ev.data.message && String(ev.data.message).trim()) || t('modal.oauthFailed');
          }
        }
        window.addEventListener('message', onMsg);
      }).catch(function () { var e = modal.body.querySelector('#cf_err'); if (e) e.textContent = t('modal.networkError'); });
  }
  function openConnectModal(pid) {
    var meta = connCatMap[pid] || { label: pid, connectMethod: 'token', testable: false, docsUrl: '' };
    var oauth = meta.connectMethod === 'oauth' || meta.connectMethod === 'oauth_shop';
    var body = '<div class="wsx-cform">' + fld(t('modal.connectionName'), 'cf_name', 'my-' + pid)
      + (meta.docsUrl ? '<a class="wsx-field__doc" href="' + esc(meta.docsUrl) + '" target="_blank" rel="noopener">' + esc(t('modal.docsLink')) + '</a>' : '')
      + (oauth ? '<p class="wsx-field__note">' + esc(t('modal.oauthNote')) + '</p>' : connFieldsHtml(pid))
      + '<div class="wsx-cform__err" id="cf_err"></div><div class="wsx-cform__test" id="cf_test"></div>'
      + '<div class="wsx-cform__foot">' + (!oauth && meta.testable ? '<button class="wsx-abtn" id="cf_testbtn" type="button">' + esc(t('modal.test')) + '</button>' : '')
      + '<button class="wsx-abtn wsx-abtn--primary" id="cf_submit" type="button">' + (oauth ? esc(t('modal.connectWith')) + ' ' + esc(meta.label) : esc(t('modal.addConnector'))) + '</button></div></div>';
    var modal = wsxModal(t('modal.connect') + ' ' + (meta.label || pid), body);
    if (pid === 'rest_api') { connRestAuth(); var as = document.getElementById('cf_auth'); if (as) as.addEventListener('change', connRestAuth); }
    document.getElementById('cf_submit').addEventListener('click', function () {
      var sub = this, name = cv('cf_name'), err = document.getElementById('cf_err'); err.textContent = '';
      if (!name) { err.textContent = t('modal.enterName'); return; }
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) { err.textContent = t('modal.nameInvalid'); return; }
      if (oauth) {
        var extra = '';
        if (meta.connectMethod === 'oauth_shop') { var shop = window.prompt(t('modal.storeDomainPrompt'), ''); if (!shop) return; extra = '&shop=' + encodeURIComponent(shop.trim().replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '')); }
        connOAuth(pid, name, extra, modal); return;
      }
      var built = connBuild(pid); if (built.err) { err.textContent = built.err; return; }
      var pl = built.payload; pl.name = name; sub.disabled = true;
      fetch(wsUrl('/connections'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pl) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) { sub.disabled = false; if (!res.ok) { err.textContent = (res.d && res.d.error) || t('modal.failedAdd'); return; } modal.close(); loaded.connectors = 0; loadConnectors(); })
        .catch(function () { sub.disabled = false; err.textContent = t('modal.networkError'); });
    });
    var tb = document.getElementById('cf_testbtn');
    if (tb) tb.addEventListener('click', function () {
      var built = connBuild(pid), st = document.getElementById('cf_test'), err = document.getElementById('cf_err'); err.textContent = '';
      if (built.err) { err.textContent = built.err; return; }
      st.className = 'wsx-cform__test testing'; st.textContent = t('modal.testing');
      fetch(wsUrl('/connections/test'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: built.payload.provider || built.payload.type, config: built.payload.config, credentials: built.payload.credentials }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && d.ok) { st.className = 'wsx-cform__test ok'; st.textContent = '\\u2713 ' + (d.message || t('modal.verified')); } else { st.className = 'wsx-cform__test bad'; st.textContent = '\\u2717 ' + ((d && d.message) || t('modal.testFailed')); } })
        .catch(function () { st.className = 'wsx-cform__test bad'; st.textContent = '\\u2717 ' + t('modal.testRequestFailed'); });
    });
  }
  function openModuleModal() {
    var scopeOpts = window.WSX_WS ? '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('modal.scope')) + '</span><select class="wsx-field__in" id="lm_scope"><option value="personal">' + esc(t('modal.scopePersonal')) + '</option><option value="workspace">' + esc(t('modal.scopeWorkspace')) + '</option></select></label>' : '';
    var body = '<div class="wsx-cform">' + fld(t('modal.moduleName'), 'lm_name', t('modal.moduleNamePh')) + fld(t('modal.version'), 'lm_version', '1.0.0') + scopeOpts
      + fld(t('modal.exports'), 'lm_exports', t('modal.exportsPh'))
      + fta(t('modal.moduleCode'), 'lm_js', t('modal.moduleCodePh'), 8)
      + fta(t('modal.readme'), 'lm_readme', t('modal.readmePh'), 3)
      + '<div class="wsx-cform__err" id="lm_err"></div><div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="lm_submit" type="button">' + esc(t('modal.publish')) + '</button></div></div>';
    var modal = wsxModal(t('modal.newModule'), body);
    var v = document.getElementById('lm_version'); if (v && !v.value) v.value = '1.0.0';
    document.getElementById('lm_submit').addEventListener('click', function () {
      var sub = this, err = document.getElementById('lm_err'); err.textContent = '';
      var name = cv('lm_name'), version = cv('lm_version') || '1.0.0', js = cv('lm_js');
      if (!name) { err.textContent = t('modal.enterModuleName'); return; }
      if (!/^\\d+\\.\\d+\\.\\d+([-+].+)?$/.test(version)) { err.textContent = t('modal.semver'); return; }
      if (!js) { err.textContent = t('modal.addModuleCode'); return; }
      var scope = (document.getElementById('lm_scope') || {}).value || 'personal';
      var b = { name: name, version: version, js: js, scope: scope };
      var rd = cv('lm_readme'); if (rd) b.readme = rd;
      var ex = cv('lm_exports'); if (ex) b.exports = ex;
      if (scope === 'workspace') b.workspace_id = window.WSX_WS;
      sub.disabled = true;
      fetch('/v1/me/libraries', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) { sub.disabled = false; if (!res.ok) { err.textContent = (res.d && res.d.error) || t('modal.failedPublish'); return; } modal.close(); loaded.library = 0; loadLibrary(); })
        .catch(function () { sub.disabled = false; err.textContent = t('modal.networkError'); });
    });
  }

`;
