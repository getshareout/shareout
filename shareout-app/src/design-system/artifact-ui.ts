/**
 * ShareOut UI — behavior layer for artifacts.
 * Served at /sdk/shareout-ui.js. Visuals come from shareout.css (`.so-` classes);
 * this only wires interactivity. Exposes `window.ShareOutUI`. Vanilla, no deps.
 */

export const artifactUIScript = `(function () {
  if (window.ShareOutUI) return;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function toast(message, opts) {
    opts = opts || {};
    var container = document.querySelector('.so-toast-container');
    if (!container) {
      container = el('div', 'so-toast-container');
      document.body.appendChild(container);
    }
    var type = opts.type ? ' so-' + opts.type : '';
    var node = el('div', 'so-toast' + type);
    node.textContent = message;
    container.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); if (!container.children.length) container.remove(); }, 250);
    }, opts.duration || 3000);
    return node;
  }

  function closeModal() {
    var b = document.querySelector('.so-modal-backdrop');
    if (b) b.remove();
  }

  function openModal(content) {
    closeModal();
    var backdrop = el('div', 'so-modal-backdrop');
    var modal = el('div', 'so-modal');
    if (typeof content === 'string') modal.innerHTML = content;
    else if (content) modal.appendChild(content);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
    });
    document.body.appendChild(backdrop);
    return modal;
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function chartColors() {
    var s = getComputedStyle(document.documentElement);
    var out = [];
    for (var i = 1; i <= 8; i++) {
      var c = s.getPropertyValue('--so-chart-' + i).trim();
      if (c) out.push(c);
    }
    return out;
  }

  // Auto-init tabs. Uses the editor's spec attributes so one markup serves both the
  // visual tabs AND the editor outline: container [data-shareout-tabs], buttons
  // .so-tab[data-shareout-tab="id"], panels .so-tab-panel[id="id"].
  // Only wires groups that have .so-tab buttons; pure spec panels-as-tabs are left
  // for the editor to read. Never injects DOM (the editor serializes the live DOM).
  function initTabs(root) {
    (root || document).querySelectorAll('[data-shareout-tabs]').forEach(function (group) {
      var tabs = group.querySelectorAll('.so-tab');
      if (!tabs.length) return;
      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          var targetId = tab.getAttribute('data-shareout-tab');
          tabs.forEach(function (t) { t.classList.toggle('so-active', t === tab); });
          group.querySelectorAll('.so-tab-panel').forEach(function (p) {
            p.hidden = p.id !== targetId;
          });
        });
      });
    });
  }

  // Auto-init dropdowns: <div class="so-dropdown"> with [data-so-toggle] and .so-dropdown-menu
  function initDropdowns(root) {
    (root || document).querySelectorAll('.so-dropdown [data-so-toggle]').forEach(function (toggle) {
      var menu = toggle.parentElement.querySelector('.so-dropdown-menu');
      if (!menu) return;
      menu.hidden = true;
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });
    });
    document.addEventListener('click', function () {
      document.querySelectorAll('.so-dropdown-menu').forEach(function (m) { m.hidden = true; });
    });
  }

  function init(root) { initTabs(root); initDropdowns(root); }

  window.ShareOutUI = {
    toast: toast,
    modal: openModal,
    openModal: openModal,
    closeModal: closeModal,
    copy: copy,
    chartColors: chartColors,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();`;
