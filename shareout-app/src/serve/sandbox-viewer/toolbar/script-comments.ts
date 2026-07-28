/** Auto-extracted client script for the sandbox viewer toolbar. */
export function renderToolbarScriptComments(baseUrl: string, artifactId: string): string {
  return `
    var cmtApi = '${baseUrl}/v1/data/${artifactId}/comments';
    var cmtWsUrl = '${baseUrl}'.replace(/^http/, 'ws') + '/v1/data/${artifactId}/comments/ws';
    var cmtFilter = 'open';
    var cmtReplyingTo = null;
    var cmtPeople = null;
    var cmtMentionMatches = [];
    var cmtMentionActive = -1;
    var cmtRoots = [];
    var cmtRendered = {};
    var cmtWs = null;
    var cmtWsReconnect = 0;
    var cmtTypingSent = 0;
    var cmtTypingHide = null;
    var cmtMyName = 'You';
    var cmtReactState = {};
    var REACT_EMOJIS = ['👍','❤️','✅','🎉','👀'];
    var cmtUnread = 0;
    var cmtAssignPicker = null; // currently open assign picker card id
    var cmtOverlay = document.getElementById('so-comments-overlay');
    var cmtLoggedIn = !!(cmtOverlay && cmtOverlay.getAttribute('data-logged-in') === '1');
    var cmtIdentityMode = (cmtOverlay && cmtOverlay.getAttribute('data-identity-mode')) || 'anonymous';

    function isPanelOpen() {
      var ov = document.getElementById('so-comments-overlay');
      return !!(ov && ov.classList.contains('open'));
    }
    function setUnread(n) { cmtUnread = Math.max(0, n); updateBadge(cmtUnread); }
    function loadUnread() {
      fetch(cmtApi + '/_unread', { credentials: 'include' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(res) { if (res && res.data) setUnread(res.data.count || 0); })
        .catch(function() {});
    }
    function markRead() {
      setUnread(0);
      fetch(cmtApi + '/_read', { method: 'POST', credentials: 'include' }).catch(function() {});
    }

    window.openComments = function() {
      document.getElementById('so-comments-overlay').classList.add('open');
      loadComments();
      loadPeople();
      ensureCmtWs();
      markRead();
      var ta = document.getElementById('so-cmt-input');
      if (ta) setTimeout(function() { ta.focus(); }, 50);
    };
    window.closeComments = function() {
      document.getElementById('so-comments-overlay').classList.remove('open');
      hideMentions();
    };
    window.setCommentFilter = function(f) {
      cmtFilter = f;
      document.getElementById('so-cmt-tab-open').classList.toggle('active', f === 'open');
      document.getElementById('so-cmt-tab-resolved').classList.toggle('active', f === 'resolved');
      loadComments();
    };

    function loadComments() {
      var list = document.getElementById('so-cmt-list');
      list.innerHTML = '<div class="so-cmt-loading">Loading comments…</div>';
      var resolved = cmtFilter === 'resolved' ? 'true' : 'false';
      fetch(cmtApi + '?parentId=null&resolved=' + resolved, { credentials: 'include' })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function(res) {
          var roots = (res.data && res.data.comments) || [];
          cmtRoots = roots;
          cmtRendered = {};
          roots.forEach(function(c) { cmtRendered[c.id] = true; });
          renderThreads(roots);
          updatePins(roots);
        })
        .catch(function(err) {
          console.error('Comments error:', err);
          list.innerHTML = '<div class="so-cmt-empty">Couldn\\'t load comments. Try again?</div>';
        });
    }

    function updateBadge(n) {
      var badge = document.getElementById('so-cmt-count');
      if (n > 0) {
        if (!badge) {
          var btn = document.getElementById('so-cmt-btn');
          if (btn) { badge = document.createElement('span'); badge.className = 'so-cmt-count'; badge.id = 'so-cmt-count'; btn.appendChild(badge); }
        }
        if (badge) badge.textContent = String(n);
      } else if (badge) {
        badge.remove();
      }
    }

    function renderMentions(text) {
      return escapeHtml(text).replace(/@([\\w.@-]+)/g, '<span class="so-cmt-mention">@$1</span>');
    }

    function avatar(name) {
      var initials = (name || '?').substring(0, 2).toUpperCase();
      return '<div class="so-cmt-avatar">' + escapeHtml(initials) + '</div>';
    }

    function assigneeChipHtml(c) {
      if (!c.assigneeEmail && !c.assigneeUserId) return '';
      var name = escapeHtml(c.assigneeEmail || c.assigneeUserId || '');
      // Try to find display name from people list
      if (cmtPeople) {
        var found = cmtPeople.filter(function(p) { return p.email === c.assigneeEmail; });
        if (found.length) name = escapeHtml(found[0].name || found[0].email);
      }
      var dueHtml = '';
      if (c.dueAt) {
        var due = new Date(c.dueAt);
        var overdue = !c.resolved && due < new Date();
        var dueStr = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        dueHtml = ' <span class="so-cmt-due' + (overdue ? ' overdue' : '') + '">Due ' + dueStr + '</span>';
      }
      return '<div class="so-cmt-assignee">→ ' + name + dueHtml + '</div>';
    }

    function commentCardHtml(c, isReply) {
      var when = c.createdAt ? timeAgo(new Date(c.createdAt)) : '';
      var isActionItem = !isReply && !c.resolved && (c.assigneeEmail || c.assigneeUserId);
      var html = '<div class="so-cmt-card' + (c.resolved ? ' resolved' : '') + (isActionItem ? ' action-item' : '') + '" data-id="' + c.id + '">';
      var agentBadge = c.authorType === 'agent' ? ' <span class="so-cmt-agent">🤖 Agent</span>' : '';
      html += '<div class="so-cmt-head">' + avatar(c.authorName) +
        '<div><div class="so-cmt-author">' + escapeHtml(c.authorName) + agentBadge + '</div>' +
        '<div class="so-cmt-time">' + when + (c.resolved && c.resolvedBy ? ' · resolved' : '') + '</div></div></div>';
      html += '<div class="so-cmt-body">' + renderMentions(c.content) + '</div>';
      if (!isReply) html += assigneeChipHtml(c);
      html += '<div class="so-cmt-actions">';
      html += '<button class="so-cmt-action" onclick="startReply(\\'' + c.id + '\\', \\'' + escapeHtml(c.authorName).replace(/'/g, "\\\\'") + '\\')">Reply</button>';
      if (!isReply) {
        if (cmtLoggedIn) {
          if (c.resolved) {
            html += '<button class="so-cmt-action resolved" onclick="toggleResolve(\\'' + c.id + '\\', false)">Reopen</button>';
          } else {
            html += '<button class="so-cmt-action" onclick="toggleResolve(\\'' + c.id + '\\', true)">Resolve</button>';
          }
          html += '<button class="so-cmt-action" onclick="openAssignPicker(\\'' + c.id + '\\')">Assign</button>';
        }
        html += '<button class="so-cmt-action" onclick="toggleReplies(\\'' + c.id + '\\')">Replies</button>';
      }
      html += '</div>';
      cmtReactState[c.id] = c.reactions || {};
      if (cmtLoggedIn) html += '<div class="so-cmt-reactions" data-rid="' + c.id + '">' + reactionBarInner(c.id) + '</div>';
      if (!isReply) html += '<div class="so-cmt-replies" id="so-replies-' + c.id + '" style="display:none"></div>';
      html += '</div>';
      return html;
    }

    function reactionBarInner(id) {
      var map = cmtReactState[id] || {};
      var html = '';
      Object.keys(map).forEach(function(e) {
        var r = map[e];
        if (!r || !r.count) return;
        html += '<button class="so-cmt-react-chip' + (r.mine ? ' mine' : '') + '" onclick="toggleReaction(\\'' + id + '\\',\\'' + e + '\\')">' + e + ' ' + r.count + '</button>';
      });
      html += '<button class="so-cmt-react-add" onclick="toggleReactPicker(\\'' + id + '\\')" title="Add reaction">+</button>';
      html += '<span class="so-cmt-react-picker" id="so-rp-' + id + '">' +
        REACT_EMOJIS.map(function(e) { return '<button class="so-cmt-react-opt" onclick="toggleReaction(\\'' + id + '\\',\\'' + e + '\\')">' + e + '</button>'; }).join('') +
        '</span>';
      return html;
    }

    function refreshReactionBar(id) {
      var el = document.querySelector('.so-cmt-reactions[data-rid="' + id + '"]');
      if (el) el.innerHTML = reactionBarInner(id);
    }

    window.toggleReactPicker = function(id) {
      var el = document.getElementById('so-rp-' + id);
      if (el) el.classList.toggle('open');
    };

    window.toggleReaction = function(id, emoji) {
      var picker = document.getElementById('so-rp-' + id);
      if (picker) picker.classList.remove('open');
      var map = cmtReactState[id] || (cmtReactState[id] = {});
      var cur = map[emoji] || { count: 0, mine: false };
      if (cur.mine) { cur.count = Math.max(0, cur.count - 1); cur.mine = false; if (!cur.count) delete map[emoji]; else map[emoji] = cur; }
      else { cur.count += 1; cur.mine = true; map[emoji] = cur; }
      refreshReactionBar(id);
      fetch(cmtApi + '/' + id + '/reactions', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: emoji })
      })
        .then(function(r) { if (r.status === 401) throw new Error('auth'); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function(res) { var d = res.data || {}; cmtReactState[id] = d.reactions || {}; refreshReactionBar(id); })
        .catch(function(err) {
          if (err.message === 'auth') alert('Please log in to react.');
          else console.error('Reaction error:', err);
          loadComments();
        });
    };

    function applyReactionEvent(id, incoming) {
      var local = cmtReactState[id] || {};
      var merged = {};
      Object.keys(incoming || {}).forEach(function(e) {
        merged[e] = { count: incoming[e].count, mine: !!(local[e] && local[e].mine) };
      });
      cmtReactState[id] = merged;
      refreshReactionBar(id);
    }

    function renderThreads(roots) {
      var list = document.getElementById('so-cmt-list');
      if (!roots.length) {
        list.innerHTML = '<div class="so-cmt-empty">' + (cmtFilter === 'resolved' ? 'No resolved comments yet.' : 'No comments yet. Start the conversation!') + '</div>';
        return;
      }
      list.innerHTML = roots.map(function(c) { return commentCardHtml(c, false); }).join('');
      // Deep-link: open panel + scroll to card if URL hash is #comment-<id>
      var hash = window.location.hash;
      if (hash && hash.indexOf('#comment-') === 0) {
        var targetId = hash.slice('#comment-'.length);
        var targetCard = document.querySelector('.so-cmt-card[data-id="' + targetId + '"]');
        if (targetCard) {
          document.getElementById('so-comments-overlay').classList.add('open');
          setTimeout(function() {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetCard.classList.add('so-cmt-highlight');
            setTimeout(function() { targetCard.classList.remove('so-cmt-highlight'); }, 1800);
          }, 120);
        }
      }
    }

    window.toggleReplies = function(id) {
      var box = document.getElementById('so-replies-' + id);
      if (!box) return;
      if (box.style.display !== 'none') { box.style.display = 'none'; return; }
      box.style.display = 'flex';
      box.innerHTML = '<div class="so-cmt-loading" style="padding:12px">Loading…</div>';
      fetch(cmtApi + '/' + id + '/replies', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          var replies = (res.data && res.data.replies) || [];
          box.innerHTML = replies.length ? replies.map(function(c) { return commentCardHtml(c, true); }).join('') : '<div class="so-cmt-time" style="padding:4px">No replies yet</div>';
        })
        .catch(function() { box.innerHTML = '<div class="so-cmt-time">Couldn\\'t load replies</div>'; });
    };

    window.startReply = function(id, name) {
      cmtReplyingTo = id;
      var info = document.getElementById('so-cmt-replying');
      info.innerHTML = 'Replying to ' + escapeHtml(name) + ' <button onclick="cancelReply()">Cancel</button>';
      document.getElementById('so-cmt-input').focus();
    };
    window.cancelReply = function() {
      cmtReplyingTo = null;
      document.getElementById('so-cmt-replying').innerHTML = '';
    };

    window.toggleResolve = function(id, resolved) {
      applyResolveLive(id, resolved);
      fetch(cmtApi + '/' + id + '/resolve', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: resolved })
      })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function(err) { console.error('Resolve error:', err); loadComments(); });
    };

    // ----- Assign picker -----
    function getOrCreateAssignPickerEl() {
      var el = document.getElementById('so-cmt-assignpicker');
      if (!el) {
        el = document.createElement('div');
        el.id = 'so-cmt-assignpicker';
        el.className = 'so-cmt-assign-picker';
        document.getElementById('so-comments-panel').appendChild(el);
      }
      return el;
    }

    function closeAssignPicker() {
      var el = document.getElementById('so-cmt-assignpicker');
      if (el) el.classList.remove('open');
      cmtAssignPicker = null;
    }

    window.openAssignPicker = function(id) {
      if (cmtAssignPicker === id) { closeAssignPicker(); return; }
      cmtAssignPicker = id;
      var card = document.querySelector('.so-cmt-card[data-id="' + id + '"]');
      if (!card) return;
      var people = (cmtPeople || []).slice(0, 6);
      var c = cmtRoots.filter(function(x) { return x.id === id; })[0] || {};
      var currentDue = c.dueAt ? c.dueAt.substring(0, 10) : '';
      var el = getOrCreateAssignPickerEl();
      var listHtml = people.map(function(p) {
        var label = p.name || p.email;
        var isAssigned = c.assigneeEmail && c.assigneeEmail === p.email;
        return '<div class="so-cmt-assign-item' + (isAssigned ? ' active' : '') + '" onmousedown="pickAssign(event,\\'' + id + '\\',\\'' + escapeHtml(p.email) + '\\')">' +
          avatar(label) + '<span>' + escapeHtml(label) + '</span></div>';
      }).join('');
      if (c.assigneeEmail || c.assigneeUserId) {
        listHtml += '<div class="so-cmt-assign-item so-cmt-assign-unassign" onmousedown="pickAssign(event,\\'' + id + '\\',null)">✕ Unassign</div>';
      }
      el.innerHTML = '<div class="so-cmt-assign-list">' + listHtml + '</div>' +
        '<div class="so-cmt-assign-due"><label>Due date <input type="date" id="so-cmt-due-input" value="' + currentDue + '"></label>' +
        '<button class="so-cmt-action" onmousedown="pickAssign(event,\\'' + id + '\\',\\'' + escapeHtml(c.assigneeEmail || '') + '\\',true)">Set due</button></div>';
      // Position picker below the card's Assign button
      var actionsEl = card.querySelector('.so-cmt-actions');
      var rect = actionsEl ? actionsEl.getBoundingClientRect() : card.getBoundingClientRect();
      var panelRect = document.getElementById('so-comments-panel').getBoundingClientRect();
      el.style.top = (rect.bottom - panelRect.top + 4) + 'px';
      el.classList.add('open');
    };

    window.pickAssign = function(e, id, email, dueOnly) {
      e.preventDefault();
      var dueDateInput = document.getElementById('so-cmt-due-input');
      var rawDate = dueDateInput ? dueDateInput.value : '';
      var dueAt = rawDate ? new Date(rawDate + 'T23:59:59Z').toISOString() : null;
      // If dueOnly (set due button), keep existing email
      var assignee = dueOnly ? (cmtRoots.filter(function(x) { return x.id === id; })[0] || {}).assigneeEmail || null : (email || null);
      closeAssignPicker();
      fetch(cmtApi + '/' + id + '/assign', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: assignee, dueAt: dueAt })
      })
        .then(function(r) {
          if (r.status === 401) throw new Error('auth');
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(res) {
          var updated = res && res.data;
          if (updated && updated.id) applyAssignLive(updated);
        })
        .catch(function(err) {
          if (err.message === 'auth') alert('Please log in to assign.');
          else console.error('Assign error:', err);
        });
    };

    function applyAssignLive(c) {
      // Update cmtRoots entry
      for (var i = 0; i < cmtRoots.length; i++) {
        if (cmtRoots[i].id === c.id) { cmtRoots[i] = c; break; }
      }
      var card = document.querySelector('.so-cmt-card[data-id="' + c.id + '"]');
      if (!card) return;
      var wrap = document.createElement('div');
      wrap.innerHTML = commentCardHtml(c, false);
      card.replaceWith(wrap.firstChild);
    }

    window.submitComment = function() {
      var ta = document.getElementById('so-cmt-input');
      var content = ta.value.trim();
      if (!content) return;
      var guestNameEl = document.getElementById('so-cmt-guest-name');
      var guestName = guestNameEl ? guestNameEl.value.trim() : '';
      if (!cmtLoggedIn && cmtIdentityMode === 'named' && !guestName) {
        alert('Please enter your name to comment.');
        if (guestNameEl) guestNameEl.focus();
        return;
      }
      var btn = document.getElementById('so-cmt-submit');
      btn.disabled = true;
      var mentions = cmtLoggedIn ? collectMentions(content) : [];
      var replyTo = cmtReplyingTo;
      var payload = { content: content, parentId: replyTo, mentions: mentions };
      if (!cmtLoggedIn && guestName) payload.authorName = guestName;
      if (cmtPendingPosition && !replyTo) {
        payload.position = cmtPendingPosition;
        if (cmtPendingState !== undefined) payload.state = cmtPendingState;
      }

      // Optimistic: render immediately with a temp id, reconcile on response.
      var tmpId = 'tmp_' + Date.now();
      var displayName = cmtLoggedIn ? cmtMyName : (guestName || 'Anonymous');
      var optimistic = {
        id: tmpId, parentId: replyTo || null, authorName: displayName,
        content: content, createdAt: new Date().toISOString(), resolved: false,
        position: payload.position || null, pending: true
      };
      if (replyTo) appendReplyLive(replyTo, optimistic);
      else if (cmtFilter === 'open') insertRootLive(optimistic);
      ta.value = '';
      cancelReply();
      var hadPin = !!payload.position;
      if (hadPin) clearPin();
      // Re-enable immediately: the composer is already clear, so the next
      // comment shouldn't wait on this one's network round-trip.
      btn.disabled = false;

      fetch(cmtApi, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function(r) {
          if (r.status === 401) throw new Error('auth');
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(res) {
          var real = res && res.data;
          if (real && real.id) reconcileOptimistic(tmpId, real, !!replyTo);
          else { removeCardDom(tmpId); cmtRoots = cmtRoots.filter(function(c) { return c.id !== tmpId; }); }
        })
        .catch(function(err) {
          console.error('Post comment error:', err);
          removeCardDom(tmpId);
          cmtRoots = cmtRoots.filter(function(c) { return c.id !== tmpId; });
          updatePins(cmtRoots);
          ta.value = content;
          alert(err.message === 'auth' ? 'Please log in to comment.' : 'Couldn\\'t post comment. Try again?');
        });
    };

    // Swap the optimistic (tmp) card for the server's real comment in place —
    // no remove+reinsert, so the entrance animation never replays and the card
    // doesn't flicker; it just resolves from pending to committed where it sits.
    // The poster also receives their own comment back over the WebSocket, so
    // guard against that echo having already rendered the real card first.
    function reconcileOptimistic(tmpId, real, isReply) {
      var realCard = document.querySelector('.so-cmt-card[data-id="' + real.id + '"]');
      var tmpCard = document.querySelector('.so-cmt-card[data-id="' + tmpId + '"]');
      delete cmtRendered[tmpId];
      cmtRendered[real.id] = true;
      cmtReactState[real.id] = real.reactions || {};
      // Normalize state: drop the tmp entry, keep exactly one real entry.
      var hasReal = false;
      cmtRoots = cmtRoots.filter(function(c) {
        if (c.id === tmpId) return false;
        if (c.id === real.id) { hasReal = true; }
        return true;
      });
      if (!hasReal && !isReply && cmtFilter === 'open') cmtRoots.unshift(real);
      if (realCard) {
        // The WebSocket echo already inserted the real card — drop the dup.
        if (tmpCard) tmpCard.remove();
      } else if (tmpCard) {
        var wrap = document.createElement('div');
        wrap.innerHTML = commentCardHtml(real, isReply);
        tmpCard.replaceWith(wrap.firstChild);
      }
      if (!isReply) updatePins(cmtRoots);
    }

    function loadPeople() {
      if (cmtPeople !== null) return;
      cmtPeople = [];
      fetch(cmtApi + '/_people', { credentials: 'include' })
        .then(function(r) { return r.ok ? r.json() : { data: { people: [] } }; })
        .then(function(res) { cmtPeople = (res.data && res.data.people) || []; })
        .catch(function() { cmtPeople = []; });
    }

    function personLabel(p) { return p.name || p.email; }

    function collectMentions(text) {
      var out = [];
      (cmtPeople || []).forEach(function(p) {
        var label = personLabel(p);
        if (label && text.indexOf('@' + label) !== -1 && p.email) out.push(p.email);
      });
      return out;
    }

    function hideMentions() {
      var box = document.getElementById('so-cmt-mentionbox');
      if (box) box.classList.remove('open');
      cmtMentionMatches = [];
      cmtMentionActive = -1;
    }

    function showMentions(query) {
      var box = document.getElementById('so-cmt-mentionbox');
      var people = cmtPeople || [];
      var q = query.toLowerCase();
      cmtMentionMatches = people.filter(function(p) {
        var label = (personLabel(p) || '').toLowerCase();
        return label.indexOf(q) !== -1 || (p.email || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 6);
      if (!cmtMentionMatches.length) { hideMentions(); return; }
      cmtMentionActive = 0;
      box.innerHTML = cmtMentionMatches.map(function(p, i) {
        return '<div class="so-cmt-mention-item' + (i === 0 ? ' active' : '') + '" data-i="' + i + '" onmousedown="pickMention(event, ' + i + ')">' +
          avatar(personLabel(p)) +
          '<div><div class="so-cmt-mention-name">' + escapeHtml(personLabel(p)) + '</div>' +
          (p.email && p.email !== personLabel(p) ? '<div class="so-cmt-mention-email">' + escapeHtml(p.email) + '</div>' : '') +
          '</div></div>';
      }).join('');
      box.classList.add('open');
    }

    window.pickMention = function(e, i) {
      e.preventDefault();
      var p = cmtMentionMatches[i];
      if (!p) return;
      var ta = document.getElementById('so-cmt-input');
      ta.value = ta.value.replace(/@(\\S*)$/, '@' + personLabel(p) + ' ');
      hideMentions();
      ta.focus();
    };

    (function wireComposer() {
      var ta = document.getElementById('so-cmt-input');
      if (!ta) return;
      ta.addEventListener('input', function() {
        var before = ta.value.substring(0, ta.selectionStart);
        var m = before.match(/@(\\S*)$/);
        if (m) showMentions(m[1]); else hideMentions();
        if (ta.value.trim()) sendTyping();
      });
      ta.addEventListener('keydown', function(e) {
        var box = document.getElementById('so-cmt-mentionbox');
        if (box.classList.contains('open') && cmtMentionMatches.length) {
          if (e.key === 'ArrowDown') { e.preventDefault(); cmtMentionActive = (cmtMentionActive + 1) % cmtMentionMatches.length; highlightMention(); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); cmtMentionActive = (cmtMentionActive - 1 + cmtMentionMatches.length) % cmtMentionMatches.length; highlightMention(); return; }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); window.pickMention(e, cmtMentionActive); return; }
          if (e.key === 'Escape') { hideMentions(); return; }
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitComment(); }
      });
    })();

    function highlightMention() {
      var items = document.querySelectorAll('.so-cmt-mention-item');
      items.forEach(function(el, i) { el.classList.toggle('active', i === cmtMentionActive); });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (cmtAssignPicker) { closeAssignPicker(); return; }
        if (cmtPinMode) { setPinMode(false); return; }
        var ov = document.getElementById('so-comments-overlay');
        if (ov && ov.classList.contains('open') && !document.getElementById('so-cmt-mentionbox').classList.contains('open')) closeComments();
      }
    });

    document.addEventListener('click', function(e) {
      if (!cmtAssignPicker) return;
      var picker = document.getElementById('so-cmt-assignpicker');
      if (picker && !picker.contains(e.target)) closeAssignPicker();
    });

    // ----- Phase 2: pinned comments + state bridge -----
    var cmtPinMode = false;
    var cmtPendingPosition = null;
    var cmtPendingState = undefined;
    var cmtPinData = {};
    var cmtStateSeq = 0;
    var cmtStateResolvers = {};

    function iframeWin() {
      var f = document.querySelector('iframe');
      return f && f.contentWindow ? f.contentWindow : null;
    }
    function postToIframe(msg) {
      var w = iframeWin();
      if (w) { try { w.postMessage(msg, '*'); } catch (e) {} }
    }

    function updatePins(roots) {
      cmtPinData = {};
      var pins = [];
      roots.forEach(function(c) {
        if (c.position) {
          cmtPinData[c.id] = c;
          pins.push({ id: c.id, position: c.position });
        }
      });
      postToIframe({ type: 'shareout:comments:setPins', pins: pins });
      if (!pins.length) document.getElementById('so-pins-layer').innerHTML = '';
    }

    function renderPinMarkers(positions) {
      var layer = document.getElementById('so-pins-layer');
      if (!layer) return;
      var html = '';
      positions.forEach(function(p, idx) {
        if (!p.visible) return;
        var c = cmtPinData[p.id];
        var cls = 'so-pin' + (c && c.resolved ? ' resolved' : '');
        html += '<div class="' + cls + '" style="left:' + p.x + 'px;top:' + p.y + 'px" onclick="openPinnedComment(\\'' + p.id + '\\')"><span>' + (idx + 1) + '</span></div>';
      });
      layer.innerHTML = html;
    }

    window.togglePinMode = function() { setPinMode(!cmtPinMode); };

    function setPinMode(on) {
      cmtPinMode = on;
      var btn = document.getElementById('so-cmt-pinbtn');
      var label = document.getElementById('so-cmt-pinbtn-label');
      if (on) {
        btn.classList.add('armed');
        btn.classList.remove('placed');
        if (label) label.textContent = 'Click the page…';
        postToIframe({ type: 'shareout:comments:enterPinMode' });
      } else {
        btn.classList.remove('armed');
        if (label) label.textContent = cmtPendingPosition ? 'Pinned ✓' : 'Pin to page';
        if (cmtPendingPosition) btn.classList.add('placed');
        postToIframe({ type: 'shareout:comments:exitPinMode' });
      }
    }

    function clearPin() {
      cmtPendingPosition = null;
      cmtPendingState = undefined;
      cmtPinMode = false;
      var btn = document.getElementById('so-cmt-pinbtn');
      var label = document.getElementById('so-cmt-pinbtn-label');
      if (btn) { btn.classList.remove('armed', 'placed'); }
      if (label) label.textContent = 'Pin to page';
    }

    function onPinPlaced(position) {
      cmtPendingPosition = position;
      setPinMode(false);
      var ta = document.getElementById('so-cmt-input');
      if (ta) ta.focus();
      requestState().then(function(state) {
        cmtPendingState = (state != null ? state : undefined);
      });
    }

    function requestState() {
      return new Promise(function(resolve) {
        var id = ++cmtStateSeq;
        var done = false;
        cmtStateResolvers[id] = function(state) { if (!done) { done = true; resolve(state); } };
        postToIframe({ type: 'shareout:comments:captureState', requestId: id });
        setTimeout(function() {
          if (!done) { done = true; delete cmtStateResolvers[id]; resolve(null); }
        }, 700);
      });
    }

    window.openPinnedComment = function(id) {
      var c = cmtPinData[id];
      document.getElementById('so-comments-overlay').classList.add('open');
      if (c && c.position) {
        postToIframe({ type: 'shareout:comments:scrollToPin', position: c.position });
        if (c.state != null) postToIframe({ type: 'shareout:comments:restoreState', state: c.state });
      }
      var card = document.querySelector('.so-cmt-card[data-id="' + id + '"]');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    window.addEventListener('message', function(e) {
      var f = document.querySelector('iframe');
      if (!f || e.source !== f.contentWindow) return;
      var data = e.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type === 'shareout:comments:pinPlaced') {
        onPinPlaced(data.position);
      } else if (data.type === 'shareout:comments:pinPositions') {
        renderPinMarkers(data.pins || []);
      } else if (data.type === 'shareout:comments:stateCaptured') {
        var fn = cmtStateResolvers[data.requestId];
        if (fn) { delete cmtStateResolvers[data.requestId]; fn(data.state); }
      } else if (data.type === 'shareout:comments:agentReady') {
        loadComments();
      }
    });

    // ----- Live updates: incremental DOM + realtime WebSocket -----
    function emptyListEl() { return document.querySelector('#so-cmt-list .so-cmt-empty'); }

    function insertRootLive(c) {
      var list = document.getElementById('so-cmt-list');
      if (!list) return;
      var empty = emptyListEl();
      if (empty) empty.remove();
      cmtRendered[c.id] = true;
      if (!cmtRoots.some(function(x) { return x.id === c.id; })) cmtRoots.unshift(c);
      var wrap = document.createElement('div');
      wrap.innerHTML = commentCardHtml(c, false);
      var node = wrap.firstChild;
      if (c.pending) node.classList.add('pending');
      node.classList.add('so-cmt-new');
      list.insertBefore(node, list.firstChild);
      updatePins(cmtRoots);
    }

    function appendReplyLive(parentId, c) {
      cmtRendered[c.id] = true;
      var box = document.getElementById('so-replies-' + parentId);
      if (!box || box.style.display === 'none') return;
      var placeholder = box.querySelector('.so-cmt-time');
      if (placeholder && box.children.length === 1) box.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.innerHTML = commentCardHtml(c, true);
      var node = wrap.firstChild;
      if (c.pending) node.classList.add('pending');
      node.classList.add('so-cmt-new');
      box.appendChild(node);
    }

    function removeCardDom(id) {
      var card = document.querySelector('.so-cmt-card[data-id="' + id + '"]');
      if (card) card.remove();
      delete cmtRendered[id];
    }

    function updateCardBody(id, content) {
      var card = document.querySelector('.so-cmt-card[data-id="' + id + '"]');
      if (!card) return;
      var body = card.querySelector('.so-cmt-body');
      if (body) body.innerHTML = renderMentions(content);
    }

    function applyResolveLive(id, resolved) {
      var idx = -1;
      for (var i = 0; i < cmtRoots.length; i++) { if (cmtRoots[i].id === id) { idx = i; break; } }
      if (idx !== -1) { cmtRoots[idx].resolved = resolved; }
      var matchesFilter = (cmtFilter === 'resolved') === resolved;
      if (!matchesFilter) {
        removeCardDom(id);
        cmtRoots = cmtRoots.filter(function(c) { return c.id !== id; });
        if (!cmtRoots.length) renderThreads([]);
      } else {
        var card = document.querySelector('.so-cmt-card[data-id="' + id + '"]');
        if (card) card.classList.toggle('resolved', resolved);
      }
      updatePins(cmtRoots);
    }

    function onCmtEvent(ev) {
      if (!ev) return;
      if (ev.type === 'comment:reaction') { applyReactionEvent(ev.commentId, ev.reactions); return; }
      if (!ev.comment) return;
      var c = ev.comment;
      if (ev.type === 'comment:added') {
        if (cmtRendered[c.id]) return;
        if (c.parentId) appendReplyLive(c.parentId, c);
        else if (cmtFilter === 'open') insertRootLive(c);
        if (isPanelOpen()) markRead(); else setUnread(cmtUnread + 1);
        flashCmtButton();
      } else if (ev.type === 'comment:updated') {
        updateCardBody(c.id, c.content);
        if (c.assigneeEmail !== undefined || c.assigneeUserId !== undefined || c.dueAt !== undefined) applyAssignLive(c);
      } else if (ev.type === 'comment:deleted') {
        removeCardDom(c.id);
        cmtRoots = cmtRoots.filter(function(x) { return x.id !== c.id; });
        updatePins(cmtRoots);
      } else if (ev.type === 'comment:resolved') {
        applyResolveLive(c.id, !!c.resolved);
      }
    }

    function flashCmtButton() {
      var btn = document.getElementById('so-cmt-btn');
      if (!btn) return;
      btn.classList.add('so-cmt-flash');
      setTimeout(function() { btn.classList.remove('so-cmt-flash'); }, 600);
    }

    function renderPresence(count) {
      var el = document.getElementById('so-cmt-presence');
      if (!el) return;
      var others = count - 1;
      if (others > 0) { el.textContent = others === 1 ? '1 other here' : others + ' others here'; el.classList.add('show'); }
      else { el.textContent = ''; el.classList.remove('show'); }
    }

    function showTyping(name) {
      var el = document.getElementById('so-cmt-typing');
      if (!el) return;
      el.textContent = name + ' is typing…';
      el.classList.add('show');
      if (cmtTypingHide) clearTimeout(cmtTypingHide);
      cmtTypingHide = setTimeout(function() { el.classList.remove('show'); el.textContent = ''; }, 3000);
    }

    function sendTyping() {
      var now = Date.now();
      if (now - cmtTypingSent < 1500) return;
      cmtTypingSent = now;
      if (cmtWs && cmtWs.readyState === 1) {
        try { cmtWs.send(JSON.stringify({ type: 'typing', name: cmtMyName })); } catch (e) {}
      }
    }

    function ensureCmtWs() {
      if (cmtWs && (cmtWs.readyState === 0 || cmtWs.readyState === 1)) return;
      try { cmtWs = new WebSocket(cmtWsUrl); } catch (e) { return; }
      cmtWs.onopen = function() { cmtWsReconnect = 0; };
      cmtWs.onmessage = function(e) {
        var data;
        try { data = JSON.parse(e.data); } catch (err) { return; }
        if (!data || !data.type) return;
        if (data.type === 'connected' || data.type === 'pong') return;
        if (data.type === 'presence') { renderPresence(data.count); return; }
        if (data.type === 'typing') { showTyping(data.name); return; }
        onCmtEvent(data);
      };
      cmtWs.onclose = function() {
        cmtWs = null;
        if (cmtWsReconnect >= 8) return;
        cmtWsReconnect++;
        setTimeout(ensureCmtWs, Math.min(1000 * Math.pow(1.5, cmtWsReconnect), 20000));
      };
      cmtWs.onerror = function() {};
    }

    // Connect at load so the toolbar badge updates live and pings flash even
    // before the panel is opened — the artifact feels alive.
    (function cmtBootstrap() {
      if (!document.getElementById('so-cmt-list')) return;
      loadComments();
      loadUnread();
      ensureCmtWs();
    })();`;
}
