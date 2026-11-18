/** Phones and tablets: the right rail as a bottom sheet. Shares the shell IIFE scope (ws, paintRail calls inspSheet). */
export const workspace_client_inspector_sheet_JS = `  // Phones and tablets (<=1100px) have no room for the right rail: the artifact bar's "Options"
  // opens it as a bottom sheet (Details, Comments, Automate — the data-in tiles live there).
  var inspBtnEl = document.getElementById('wsxInspBtn'), inspScrimEl = document.getElementById('wsxInspScrim');
  function inspSheet(open) {
    ws.classList.toggle('is-insp-open', !!open);
    if (inspBtnEl) inspBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (inspScrimEl) inspScrimEl.hidden = !open;
  }
  if (inspBtnEl) inspBtnEl.addEventListener('click', function () { inspSheet(!ws.classList.contains('is-insp-open')); });
  if (inspScrimEl) inspScrimEl.addEventListener('click', function () { inspSheet(false); });
  var inspCloseEl = document.getElementById('wsxInspClose');
  if (inspCloseEl) inspCloseEl.addEventListener('click', function () { inspSheet(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ws.classList.contains('is-insp-open') && !document.querySelector('.wsx-modal')) inspSheet(false); });
`;
