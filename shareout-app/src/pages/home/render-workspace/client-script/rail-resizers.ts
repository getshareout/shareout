/** Rail collapse (fixed open / minimized) + right-sidebar handle resize. */
export const workspace_client_rail_resizers_JS = `  // ===== rail collapse + right-sidebar resize handle (persisted) =====
  var LS = { col: 'wsx_rail_collapsed', aw: 'wsx_act_w', tabs: 'wsx_tabs:' + (window.WSX_WS || '') };
  try {
    if (localStorage.getItem(LS.col) === '1') ws.classList.add('is-rail-collapsed');
    var aw = localStorage.getItem(LS.aw); if (aw) ws.style.setProperty('--wsx-act', aw);
  } catch (e) {}
  document.getElementById('wsxCollapse').addEventListener('click', function () {
    var c = !ws.classList.contains('is-rail-collapsed');
    ws.classList.toggle('is-rail-collapsed', c);
    try { localStorage.setItem(LS.col, c ? '1' : '0'); } catch (e) {}
  });
  // ----- mobile rail drawer (hamburger) -----
  var hamb = document.getElementById('wsxHamb');
  var railScrim = document.getElementById('wsxRailScrim');
  var railClose = document.getElementById('wsxRailClose');
  function setRail(open) {
    ws.classList.toggle('is-rail-open', open);
    if (railScrim) railScrim.hidden = !open;
    if (hamb) hamb.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (hamb) hamb.addEventListener('click', function () { setRail(!ws.classList.contains('is-rail-open')); });
  if (railClose) railClose.addEventListener('click', function () { setRail(false); });
  if (railScrim) railScrim.addEventListener('click', function () { setRail(false); });
  // close after picking a destination in the drawer (lenses, create, account)
  var railEl = document.getElementById('wsxRail');
  if (railEl) railEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-lens], #wsxCreateBtn, #wsxAcctBtn, .wsx__follow')) setRail(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ws.classList.contains('is-rail-open')) setRail(false); });

  var actHandle = document.getElementById('wsxActHandle');
  if (actHandle) {
    actHandle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      actHandle.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
      function mv(ev) {
        var r = ws.getBoundingClientRect();
        var w = Math.min(520, Math.max(220, r.right - ev.clientX));
        ws.style.setProperty('--wsx-act', w + 'px'); try { localStorage.setItem(LS.aw, w + 'px'); } catch (_) {}
      }
      function up() {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        document.body.style.cursor = ''; document.body.style.userSelect = ''; actHandle.classList.remove('is-dragging');
      }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  }

`;
