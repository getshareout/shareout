/** Open artifact links as tabs. */
export const workspace_client_artifact_links_JS = `  // ===== dismiss a "Needs you" event (server-side, cross-device) =====
  function dismissEvents(csv) {
    var ids = (csv || '').split(',').filter(Boolean);
    if (!ids.length) return;
    fetch('/v1/home/dismiss-event', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventIds: ids }) })
      .then(function () { loadFeed(); })
      .catch(function () {});
  }

  // ===== open any artifact link as a tab (cards, widgets, activity) =====
  document.getElementById('wsxBody').addEventListener('click', function (e) {
    var dx = e.target.closest('.wsx-ev__x, .wsx-tl__x');
    if (dx) { e.preventDefault(); e.stopPropagation(); dismissEvents(dx.getAttribute('data-eids')); return; }
    var a = e.target.closest('a[href]');
    if (!a) return;
    var m = (a.getAttribute('href') || '').match(/^\\/a\\/([^/]+)\\//);
    if (!m) return;
    e.preventDefault();
    var slug = decodeURIComponent(m[1]);
    var card = a.closest('.artifact-card');
    var topEl = a.querySelector('.wsx-ev__top');
    var titleEl = card && card.querySelector('.card-title');
    var name = (topEl && topEl.textContent) || (titleEl && titleEl.textContent) || a.getAttribute('data-name') || slug;
    var id = a.getAttribute('data-id') || (card && card.getAttribute('data-id')) || '';
    openArtifact(slug, String(name).trim(), id);
  });

  function renderAgentCards(items) {
    activateTab('home'); show('agent');
    var mount = document.getElementById('wsxAgentMount');
    if (!items || !items.length) { mount.innerHTML = i18nEmpty('artifacts.noMatch'); return; }
    mount.innerHTML = items.map(function (it) {
      return '<a class="wsx-ev" data-open="' + esc(it.slug) + '" data-name="' + esc(it.name) + '" data-id="' + esc(it.id) + '" href="#">'
        + '<span class="wsx-ev__ic">\\uD83D\\uDCC4</span>'
        + '<span class="wsx-ev__main"><span class="wsx-ev__top">' + esc(it.name) + '</span><span class="wsx-ev__sum">' + esc(it.artifact_type || 'page') + '</span></span>'
        + '<span class="wsx-ev__time">Open</span></a>';
    }).join('');
    mount.querySelectorAll('[data-open]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openArtifact(a.getAttribute('data-open'), a.getAttribute('data-name'), a.getAttribute('data-id')); });
    });
  }

`;
