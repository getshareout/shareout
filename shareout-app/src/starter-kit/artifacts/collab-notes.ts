import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = '<style>'
  + '.cn-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}'
  + '.cn-who{display:flex;align-items:center;gap:6px;min-height:28px}'
  + '.cn-dot{width:7px;height:7px;border-radius:50%;background:var(--so-ink-3);flex:0 0 auto}'
  + '.cn-dot.live{background:#22c55e}'
  + '.cn-avatars{display:flex}'
  + '.cn-av{width:26px;height:26px;border-radius:50%;border:2px solid var(--so-surface);'
  + 'display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff;margin-left:-7px}'
  + '.cn-av:first-child{margin-left:0}'
  + '#pad{width:100%;min-height:280px;resize:vertical;line-height:1.6;font-size:15px;'
  + 'border:1px solid var(--so-border);border-radius:10px;padding:14px;background:var(--so-surface);'
  + 'color:var(--so-ink);font-family:inherit}'
  + '#pad:focus{outline:2px solid var(--so-blue-light);border-color:var(--so-blue)}'
  + '</style>';

const body = '<div class="so-card">'
  + '<div class="cn-head">'
  + '<h2 style="margin:0">Shared notepad</h2>'
  + '<div class="cn-who"><span class="cn-dot" id="dot"></span>'
  + '<span class="so-muted" id="status">Connecting</span>'
  + '<span class="cn-avatars" id="avatars"></span></div>'
  + '</div>'
  + '<textarea id="pad" placeholder="Start typing — anyone viewing sees it live."></textarea>'
  + '</div>'
  + '<p class="so-muted" style="margin-top:16px">'
  + 'Open this in two tabs and type in one — the other updates as you go. There is no save '
  + 'button: every keystroke syncs instantly through <code>so.realtime</code>, which uses CRDTs '
  + 'to merge edits from everyone without conflicts. Same tech behind multiplayer docs and whiteboards.'
  + '</p>';

const script = ''
  + 'var pad = document.getElementById("pad");\n'
  + 'var dot = document.getElementById("dot");\n'
  + 'var statusEl = document.getElementById("status");\n'
  + 'var avatarsEl = document.getElementById("avatars");\n'
  + 'var COLORS = ["#2563eb","#22c55e","#f59e0b","#ec4899","#8b5cf6","#14b8a6"];\n'
  + 'var me = { name: "Guest " + Math.floor(1000 + Math.random()*9000), color: COLORS[Math.floor(Math.random()*COLORS.length)] };\n'
  + '\n'
  + 'var doc = so.realtime("collab-notes");\n'
  + '\n'
  + 'doc.on("status", function(s){\n'
  + '  dot.classList.toggle("live", s === "connected");\n'
  + '  statusEl.textContent = s === "connected" ? "Live" : (s === "connecting" ? "Connecting" : "Reconnecting");\n'
  + '});\n'
  + '\n'
  + 'await doc.connect();\n'
  + '\n'
  + 'var notes = doc.text("notes");\n'
  + 'var applyingRemote = false;\n'
  + '\n'
  + 'function paintFromShared(){\n'
  + '  var next = notes.toString();\n'
  + '  if (pad.value === next) return;\n'
  + '  var start = pad.selectionStart;\n'
  + '  var end = pad.selectionEnd;\n'
  + '  applyingRemote = true;\n'
  + '  pad.value = next;\n'
  + '  applyingRemote = false;\n'
  + '  try { pad.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length)); } catch (e) {}\n'
  + '}\n'
  + '\n'
  + 'notes.observe(function(){ paintFromShared(); });\n'
  + 'paintFromShared();\n'
  + '\n'
  + 'pad.addEventListener("input", function(){\n'
  + '  if (applyingRemote) return;\n'
  + '  var next = pad.value;\n'
  + '  var current = notes.toString();\n'
  + '  if (next === current) return;\n'
  + '  var prefix = 0;\n'
  + '  var max = Math.min(next.length, current.length);\n'
  + '  while (prefix < max && next.charAt(prefix) === current.charAt(prefix)) prefix++;\n'
  + '  var sufNext = next.length;\n'
  + '  var sufCur = current.length;\n'
  + '  while (sufNext > prefix && sufCur > prefix && next.charAt(sufNext-1) === current.charAt(sufCur-1)) { sufNext--; sufCur--; }\n'
  + '  doc.transact(function(){\n'
  + '    if (sufCur > prefix) notes.delete(prefix, sufCur - prefix);\n'
  + '    if (sufNext > prefix) notes.insert(prefix, next.slice(prefix, sufNext));\n'
  + '  });\n'
  + '});\n'
  + '\n'
  + 'function renderPresence(users){\n'
  + '  avatarsEl.innerHTML = "";\n'
  + '  users.forEach(function(state){\n'
  + '    if (!state || !state.user) return;\n'
  + '    var av = document.createElement("div");\n'
  + '    av.className = "cn-av";\n'
  + '    av.style.background = state.user.color || "#57534e";\n'
  + '    av.title = state.user.name || "Someone";\n'
  + '    av.textContent = (state.user.name || "?").slice(0, 2).toUpperCase();\n'
  + '    avatarsEl.appendChild(av);\n'
  + '  });\n'
  + '}\n'
  + '\n'
  + 'doc.presence.subscribe(renderPresence);\n'
  + 'doc.presence.set({ user: me });\n';

export const collabNotes: StarterArtifact = {
  slug: 'collab-notes',
  name: 'Collaborative notes',
  description: 'A shared notepad that syncs live across everyone viewing.',
  feature: 'so.realtime',
  tier: 'personal',
  html: frame({
    title: 'Collaborative notes',
    feature: 'so.realtime',
    description: 'Type in one tab, watch it appear in another — live, with no save button.',
    head,
    body,
    script,
  }),
};
