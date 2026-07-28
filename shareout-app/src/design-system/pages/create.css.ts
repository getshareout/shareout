/**
 * ShareOut Design System - AI Creator (/create) UI
 *
 * Liquid-glass surfaces floating over an infinite dotted canvas. No traditional
 * navbars or panel borders — everything reads as glass resting on the canvas.
 * The canvas is intentionally de-emphasized until the visitor signs in, so all
 * attention lands on the (fast, free) account step.
 */

export const createPageStyles = `
[hidden] { display: none !important; }

html, body { height: 100%; }
body { overflow: hidden; background: var(--color-bg); color: var(--color-text); font-family: var(--font-body); }

/* ===================== Infinite dotted canvas ===================== */
.creator {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(1100px 760px at 78% 8%, #e9eeff 0%, transparent 56%),
    radial-gradient(900px 700px at 12% 92%, #fdf1ea 0%, transparent 54%),
    radial-gradient(820px 820px at 92% 96%, #eafaf3 0%, transparent 60%),
    #f6f5f4;
  opacity: 0;
  animation: creatorIn 0.5s var(--ease-out) forwards;
}
.creator::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, rgba(28, 25, 23, 0.16) 1.1px, transparent 1.2px);
  background-size: 23px 23px;
  -webkit-mask-image: radial-gradient(ellipse 90% 80% at 60% 45%, #000 55%, transparent 100%);
  mask-image: radial-gradient(ellipse 90% 80% at 60% 45%, #000 55%, transparent 100%);
  transition: opacity 0.5s ease;
}
@keyframes creatorIn { to { opacity: 1; } }

/* ===================== Liquid glass base ===================== */
.glass {
  position: relative;
  background: rgba(255, 255, 255, 0.5);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow:
    0 18px 50px -14px rgba(28, 25, 23, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 -1px 1px rgba(255, 255, 255, 0.25);
}
.glass::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(120deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 38%, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, 0.28) 100%);
  background-size: 220% 220%;
  mix-blend-mode: screen;
  animation: sheen 9s ease-in-out infinite;
}
.glass > * { position: relative; z-index: 1; }
@keyframes sheen { 0%, 100% { background-position: 0% 0%; } 50% { background-position: 100% 100%; } }

/* ===================== Chat (floating glass panel, left) ===================== */
.chat {
  position: fixed;
  left: 16px;
  top: 16px;
  bottom: 16px;
  width: 392px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: 26px;
}
.chat-head { display: flex; align-items: center; justify-content: space-between; padding: 17px 18px 10px; }
.chat-brand, .brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.brand-mark { display: block; width: 26px; height: 26px; flex-shrink: 0; }
.brand-name {
  font: 700 1.02rem var(--font-display);
  letter-spacing: -0.02em;
  color: var(--color-primary);
  line-height: 1;
}
.chat-new { display: inline-flex; align-items: center; gap: 6px; padding: 8px 15px; border-radius: var(--radius-full); font: 600 0.8rem var(--font-body); color: var(--color-text-secondary); background: rgba(28, 25, 23, 0.05); }
.chat-new:hover { background: rgba(28, 25, 23, 0.09); color: var(--color-text); }

.chat-body { flex: 1; overflow-y: auto; padding: 10px 16px 14px; display: flex; flex-direction: column; gap: 14px; }
.chat-body::-webkit-scrollbar { width: 8px; }
.chat-body::-webkit-scrollbar-thumb { background: rgba(28, 25, 23, 0.14); border-radius: 8px; }

.msg { max-width: 92%; font: 400 0.92rem/1.5 var(--font-body); }
.msg.user { align-self: flex-end; max-width: 86%; padding: 10px 14px; border-radius: 16px; border-bottom-right-radius: 5px; background: var(--color-primary); color: var(--color-text-inverse); font-weight: 500; box-shadow: 0 8px 20px -8px var(--color-primary-glow); }
.msg.ai { align-self: flex-start; padding: 11px 14px; border-radius: 16px; border-bottom-left-radius: 5px; background: rgba(255, 255, 255, 0.62); color: var(--color-text); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7); }
.msg.ai a { color: var(--color-primary); font-weight: 600; }
.msg.ai.thinking { color: var(--color-text-secondary); }
.msg.ai.thinking .dots { display: inline-flex; gap: 3px; margin-left: 5px; vertical-align: middle; }
.msg.ai.thinking .dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--color-text-tertiary); animation: blink 1.2s infinite ease-in-out; }
.msg.ai.thinking .dots i:nth-child(2) { animation-delay: 0.2s; }
.msg.ai.thinking .dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

.act { display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: var(--radius-full); font: 600 0.82rem var(--font-body); color: var(--color-primary); background: var(--color-primary-light); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 18%, transparent); cursor: pointer; transition: background 0.15s var(--ease-out), transform 0.15s var(--ease-out); }
.act:hover { background: color-mix(in srgb, var(--color-primary) 16%, var(--color-primary-light)); transform: translateY(-1px); }
.act.primary { color: var(--color-text-inverse); background: var(--color-primary); box-shadow: 0 8px 18px -8px var(--color-primary-glow); }
.act.primary:hover { background: var(--color-primary-hover); }

.chips { align-self: flex-start; display: flex; flex-wrap: wrap; gap: 8px; max-width: 92%; margin: 2px 0; }
.chip { padding: 8px 13px; border-radius: var(--radius-full); font: 600 0.82rem var(--font-body); color: var(--color-text); background: rgba(255, 255, 255, 0.7); box-shadow: inset 0 0 0 1px var(--color-border); cursor: pointer; transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), transform 0.15s var(--ease-out); }
.chip:hover { background: #fff; color: var(--color-primary); transform: translateY(-1px); }

.confirm-card { align-self: flex-start; display: flex; flex-wrap: wrap; gap: 8px; max-width: 92%; margin: 2px 0; }
.confirm-card.resolved { opacity: 0.5; pointer-events: none; }
.confirm-btn { padding: 9px 16px; border-radius: var(--radius-full); font: 600 0.85rem var(--font-body); cursor: pointer; transition: background 0.15s var(--ease-out), transform 0.15s var(--ease-out); }
.confirm-btn.yes { color: var(--color-text-inverse); background: var(--color-primary); box-shadow: 0 8px 18px -8px var(--color-primary-glow); }
.confirm-btn.yes:hover { background: var(--color-primary-hover); transform: translateY(-1px); }
.confirm-btn.no { color: var(--color-text-secondary); background: rgba(28, 25, 23, 0.05); }
.confirm-btn.no:hover { background: rgba(28, 25, 23, 0.09); }

.result-card { align-self: flex-start; max-width: 92%; display: flex; flex-direction: column; gap: 11px; padding: 14px; border-radius: 16px; border-bottom-left-radius: 5px; background: rgba(255, 255, 255, 0.78); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8), 0 12px 30px -16px rgba(28, 25, 23, 0.3); }
.result-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.result-live { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; font: 700 0.72rem var(--font-body); letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-success); }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-success); animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 55%, transparent); } 70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
.result-url { font: 500 0.84rem var(--font-mono, ui-monospace, SFMono-Regular, monospace); color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.caps { display: flex; flex-wrap: wrap; gap: 6px; }
.cap { padding: 4px 10px; border-radius: var(--radius-full); font: 600 0.74rem var(--font-body); color: var(--color-primary); background: var(--color-primary-light); }
.result-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.steps { display: flex; flex-direction: column; gap: 9px; margin-top: 11px; }
.step { display: flex; align-items: center; gap: 9px; font: 500 0.85rem var(--font-body); color: var(--color-text-tertiary); opacity: 0.55; transition: color 0.4s var(--ease-out), opacity 0.4s var(--ease-out); }
.step.active, .step.done { color: var(--color-text); opacity: 1; }
.step .tick { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(28, 25, 23, 0.18); display: grid; place-items: center; }
.step.active .tick { border-color: var(--color-primary); border-top-color: transparent; animation: spin 0.7s linear infinite; }
.step.done .tick { background: var(--color-success); border-color: var(--color-success); }
.step.done .tick::after { content: '✓'; color: #fff; font-size: 11px; font-weight: 700; }
@keyframes spin { to { transform: rotate(360deg); } }

.chat-foot { padding: 12px 16px 16px; }
.chat-input { display: flex; align-items: center; gap: 8px; padding: 7px 7px 7px 16px; border-radius: var(--radius-full); background: rgba(255, 255, 255, 0.72); border: 1px solid rgba(255, 255, 255, 0.85); box-shadow: 0 10px 26px -12px rgba(28, 25, 23, 0.2); }
.chat-input:focus-within { border-color: color-mix(in srgb, var(--color-primary) 60%, transparent); box-shadow: 0 0 0 3px var(--color-primary-light); }
.chat-input input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: 400 0.92rem var(--font-body); color: var(--color-text); }
.chat-input input:disabled { color: var(--color-text-tertiary); cursor: not-allowed; }
.chat-input button { flex: 0 0 auto; width: 38px; height: 38px; border-radius: 50%; background: var(--color-primary); color: var(--color-text-inverse); display: grid; place-items: center; box-shadow: 0 6px 16px -5px var(--color-primary-glow); }
.chat-input button:hover { background: var(--color-primary-hover); }
.chat-input button svg { width: 17px; height: 17px; }

/* ===================== In-chat sign-up card (CRO-focused) ===================== */
.auth-card { display: flex; flex-direction: column; gap: 13px; padding: 18px; border-radius: 20px; background: rgba(255, 255, 255, 0.66); border: 1px solid rgba(255, 255, 255, 0.85); box-shadow: 0 16px 40px -16px rgba(28, 25, 23, 0.24); }
.auth-title { font: 700 1.16rem var(--font-display); letter-spacing: -0.01em; color: var(--color-text); }
.auth-sub { margin-top: -6px; font: 400 0.86rem/1.45 var(--font-body); color: var(--color-text-secondary); }

.g-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 13px 16px; border-radius: var(--radius-full); background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(255, 255, 255, 0.9); box-shadow: 0 10px 24px -10px rgba(28, 25, 23, 0.24); font: 600 0.92rem var(--font-body); color: var(--color-text); transition: transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out); }
.g-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 28px -10px rgba(28, 25, 23, 0.3); }
.g-btn svg { width: 18px; height: 18px; }

.auth-or { display: flex; align-items: center; gap: 12px; font: 600 0.7rem var(--font-body); letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-text-tertiary); }
.auth-or::before, .auth-or::after { content: ''; flex: 1; height: 1px; background: rgba(28, 25, 23, 0.1); }

.field { display: flex; align-items: center; gap: 6px; padding: 5px 5px 5px 16px; border-radius: var(--radius-full); background: rgba(255, 255, 255, 0.85); border: 1px solid rgba(255, 255, 255, 0.95); box-shadow: 0 8px 22px -12px rgba(28, 25, 23, 0.2); }
.field:focus-within { border-color: color-mix(in srgb, var(--color-primary) 55%, transparent); box-shadow: 0 0 0 3px var(--color-primary-light); }
.field input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: 500 0.95rem var(--font-body); color: var(--color-text); letter-spacing: 0.01em; }
.field input#codeInput { letter-spacing: 0.32em; font-variant-numeric: tabular-nums; }

.icon-btn { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--color-primary); color: #fff; box-shadow: 0 8px 18px -6px var(--color-primary-glow); transition: transform 0.15s var(--ease-out), background 0.15s var(--ease-out); }
.icon-btn:hover { background: var(--color-primary-hover); transform: translateY(-1px); }
.icon-btn:disabled { opacity: 0.5; transform: none; cursor: default; }
.icon-btn svg { width: 18px; height: 18px; }

.auth-link { align-self: flex-start; background: none; color: var(--color-primary); font: 600 0.8rem var(--font-body); padding: 0; }
.auth-link:hover { text-decoration: underline; }
.auth-status { font: 500 0.8rem var(--font-body); color: var(--color-text-tertiary); min-height: 0.4em; }
.auth-status.err { color: var(--color-error); }
.auth-status.ok { color: var(--color-success); }

.trust { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 2px; }
.trust span { display: inline-flex; align-items: center; gap: 5px; font: 600 0.72rem var(--font-body); color: var(--color-text-tertiary); }
.trust svg { width: 13px; height: 13px; color: var(--color-success); }

/* ===================== Canvas HUD (floating glass pill, top-right) ===================== */
.hud { position: fixed; top: 16px; right: 16px; z-index: 50; display: inline-flex; align-items: center; gap: 10px; padding: 6px 7px; border-radius: var(--radius-full); transition: opacity 0.4s ease; }
.tabs { display: inline-flex; gap: 3px; padding: 3px; border-radius: var(--radius-full); background: rgba(28, 25, 23, 0.06); }
.tab2 { padding: 7px 15px; border-radius: var(--radius-full); font: 600 0.82rem var(--font-body); color: var(--color-text-secondary); }
.tab2:hover { color: var(--color-text); }
.tab2.active { background: rgba(255, 255, 255, 0.95); color: var(--color-text); box-shadow: 0 2px 8px -2px rgba(28, 25, 23, 0.2); }
.url2 { padding: 0 6px; font: 500 0.74rem var(--font-mono); color: var(--color-text-tertiary); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url2 b { color: var(--color-text-secondary); font-weight: 600; }
.share { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: var(--radius-full); background: var(--color-primary); color: var(--color-text-inverse); font: 600 0.82rem var(--font-body); box-shadow: 0 8px 18px -6px var(--color-primary-glow); }
.share:hover { background: var(--color-primary-hover); }

/* ===================== Stage + floating preview ===================== */
.stage { position: fixed; inset: 0; padding: 16px 16px 16px 424px; display: grid; pointer-events: none; }
.frame {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border-radius: 22px;
  overflow: hidden;
  background: #fff;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 30px 80px -26px rgba(28, 25, 23, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.8);
  transition: opacity 0.5s ease, filter 0.5s ease, transform 0.5s var(--ease-out);
}
.frame-body { position: relative; flex: 1; background: #fff; }

.preview-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
.preview-empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 28px; color: var(--color-text-tertiary); font: 500 0.95rem var(--font-body); }
.code-view { position: absolute; inset: 0; margin: 0; overflow: auto; padding: 20px; background: #fbfbfa; color: var(--color-text-secondary); font: 400 0.76rem/1.55 var(--font-mono); white-space: pre-wrap; word-break: break-word; }

/* Calm building indicator (no glowing skeleton) */
.building { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #fff; }
.building .spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(28, 25, 23, 0.12); border-top-color: var(--color-primary); animation: spin 0.8s linear infinite; }
.building-label { font: 500 0.88rem var(--font-body); color: var(--color-text-tertiary); }

/* ===================== Gate: de-emphasize canvas until signed in ===================== */
.creator.gate::before { opacity: 0.45; }
.creator.gate .stage .frame { filter: grayscale(0.7) brightness(1.02) opacity(0.5); transform: scale(0.975); }
.creator.gate .hud { opacity: 0.4; pointer-events: none; }

/* ===================== Starter-pack picker (overlay in preview frame) ===================== */
.theme-picker { position: absolute; inset: 0; z-index: 2; overflow: auto; padding: 34px 28px; display: flex; flex-direction: column; gap: 22px; background: #fff; animation: tpIn 0.35s var(--ease-out); }
@keyframes tpIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.tp-head { text-align: center; }
.tp-title { font: 700 1.5rem var(--font-display); letter-spacing: -0.02em; color: var(--color-text); }
.tp-sub { margin-top: 6px; font: 400 0.95rem var(--font-body); color: var(--color-text-secondary); }
.tp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; width: 100%; max-width: 760px; margin: 0 auto; }
.tp-card { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 13px; border-radius: 16px; text-align: left; background: #fff; border: 1px solid var(--color-border); box-shadow: 0 1px 2px rgba(28, 25, 23, 0.04); cursor: pointer; transition: transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out), border-color 0.15s var(--ease-out); }
.tp-card:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--color-primary) 40%, transparent); box-shadow: 0 14px 30px -14px rgba(28, 25, 23, 0.3); }
.tp-swatch { position: relative; width: 100%; height: 74px; border-radius: 11px; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 9px; overflow: hidden; }
.tp-dot { width: 22px; height: 22px; border-radius: 50%; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); }
.tp-swatch-surprise { background: conic-gradient(from 180deg, #ff5d8f, #ffd166, #3ad6c4, #6c8cff, #ff5d8f); color: #fff; font-size: 27px; font-weight: 700; }
.tp-name { font: 700 0.98rem var(--font-display); color: var(--color-text); }
.tp-blurb { font: 400 0.82rem/1.4 var(--font-body); color: var(--color-text-secondary); }

/* ===================== Clarifying questions ===================== */
.clarify-card { align-self: flex-start; display: flex; flex-direction: column; gap: 13px; max-width: 92%; padding: 14px; border-radius: 16px; border-bottom-left-radius: 5px; background: rgba(255, 255, 255, 0.78); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8), 0 12px 30px -16px rgba(28, 25, 23, 0.3); }
.clarify-card.resolved { opacity: 0.55; pointer-events: none; }
.clarify-q { display: flex; flex-direction: column; gap: 8px; }
.clarify-label { font: 600 0.86rem var(--font-body); color: var(--color-text); }
.clarify-opts { display: flex; flex-wrap: wrap; gap: 7px; }
.clarify-opt { padding: 7px 12px; border-radius: var(--radius-full); font: 600 0.8rem var(--font-body); color: var(--color-text); background: rgba(255, 255, 255, 0.8); box-shadow: inset 0 0 0 1px var(--color-border); cursor: pointer; transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out); }
.clarify-opt:hover { color: var(--color-primary); }
.clarify-opt.selected { color: var(--color-text-inverse); background: var(--color-primary); box-shadow: 0 6px 14px -6px var(--color-primary-glow); }

/* ===================== Responsive ===================== */
@media (max-width: 920px) {
  .chat { left: 10px; right: 10px; bottom: 10px; top: auto; width: auto; max-height: 64vh; }
  .stage { padding: 70px 14px 56vh; }
  .creator.gate .stage .frame { transform: scale(0.96); }
}

@media (prefers-reduced-motion: reduce) {
  .creator, .glass::before, .frame, .step { animation: none; transition: none; }
  .building .spinner { animation-duration: 1.4s; }
}
`;
