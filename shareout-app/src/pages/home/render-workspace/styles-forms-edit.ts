/**
 * Modal create forms and Edit-Lite toolbar / property panel.
 * Split out of styles.ts to stay under the per-module line cap; concatenated into
 * WORKSPACE_STYLES in the same cascade position so order is unchanged.
 */
export const WORKSPACE_FORMS_EDIT_STYLES = `/* ---- Modal + native create forms ---- */
.wsx-modal { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 24px; background: color-mix(in srgb, var(--color-text) 32%, transparent); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
.wsx-modal__card { width: 100%; max-width: 460px; max-height: 88vh; display: flex; flex-direction: column; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-xl); overflow: hidden; }
.wsx-modal__head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--color-border); font: 700 var(--text-base) var(--font-body); }
.wsx-modal__x { border: 0; background: transparent; color: var(--color-text-tertiary); font-size: 20px; line-height: 1; cursor: pointer; }
.wsx-modal__x:hover { color: var(--color-text); }
.wsx-modal__body { padding: 18px; overflow-y: auto; }
.wsx-cform { display: flex; flex-direction: column; gap: 12px; }
.wsx-field { display: flex; flex-direction: column; gap: 5px; }
.wsx-field__lbl { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); }
.wsx-field__in { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font: 400 var(--text-sm) var(--font-body); }
.wsx-field__in:focus { outline: none; border-color: var(--color-primary); }
.wsx-field__ta { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.45; }
.wsx-field__note { font-size: var(--text-xs); color: var(--color-text-tertiary); line-height: 1.5; margin: 0; }
.wsx-field__doc { font-size: var(--text-xs); color: var(--color-primary); text-decoration: none; }
.wsx-field__doc:hover { text-decoration: underline; }
.wsx-cform__err { font-size: var(--text-xs); color: var(--color-danger, var(--color-error)); min-height: 14px; }
.wsx-cform__err:empty { min-height: 0; }
.wsx-cform__test { font-size: var(--text-xs); }
.wsx-cform__test.testing { color: var(--color-text-tertiary); }
.wsx-cform__test.ok { color: var(--color-success); }
.wsx-cform__test.bad { color: var(--color-danger, var(--color-error)); }
.wsx-cform__foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.wsx-abtn--primary { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-text-inverse); }
.wsx-abtn--primary:hover { background: var(--color-primary-hover); border-color: var(--color-primary-hover); color: var(--color-text-inverse); }
.wsx-abtn--primary:disabled { opacity: 0.6; cursor: default; }
.wsx-abtn--block { width: 100%; justify-content: center; }
.wsx-admin__planpush .wsx-abtn { margin-top: 10px; }
.wsx-tests__run { margin-top: 7px; }
.wsx-mt-12 { margin-top: 12px; }
.wsx__stageframe { width: 100%; flex: 1; min-height: 360px; border: 1px solid var(--color-border); border-radius: var(--radius-2xl); box-shadow: var(--shadow-hero); background: var(--color-surface); display: block; }
/* ---- Edit-Lite: per-pane toolbar + edit surface ---- */
.wsx__stagebar2 { display: flex; align-items: center; gap: 10px; margin-bottom: var(--space-3); flex: none; }
.wsx__pane--art:not(.is-editing) .wsx__stagebar2 { display: none; }
.wsx__modetog { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--radius-md); background: var(--color-surface); }
.wsx__modetog button { border: 0; background: transparent; padding: 5px 15px; border-radius: calc(var(--radius-md) - 3px); font: 600 var(--text-sm) var(--font-body); color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx__modetog button:hover { color: var(--color-text); }
.wsx__modetog button.is-on { background: var(--color-bg-elevated); color: var(--color-text); box-shadow: var(--shadow-sm); }
.wsx__ubtn { width: 32px; height: 32px; display: grid; place-items: center; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast); }
.wsx__ubtn:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
.wsx__ubtn:disabled { opacity: 0.4; cursor: default; }
.wsx__ubtn[hidden] { display: none; }
.wsx__savestat { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx__savestat.ok { color: var(--color-success); }
.wsx__savestat.warn { color: var(--color-warning); }
.wsx__editspacer { flex: 1; }
.wsx__publish { padding: 7px 16px; border: 0; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx__publish:disabled { opacity: 0.55; cursor: default; }
.wsx__fulledit { font-size: var(--text-sm); color: var(--color-primary); text-decoration: none; white-space: nowrap; }
.wsx__fulledit:hover { text-decoration: underline; }
.wsx__editframe { width: 100%; flex: 1; min-height: 360px; border: 1px solid var(--color-border); border-radius: var(--radius-2xl); box-shadow: var(--shadow-hero); background: var(--color-bg-elevated); display: none; }
.wsx__pane--art.is-editing .wsx__stageframe { display: none; }
.wsx__pane--art.is-editing .wsx__editframe { display: block; }
.wsx__ubtn.is-on { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
.wsx__pane--art.is-mobile .wsx__editframe, .wsx__pane--art.is-mobile .wsx__stageframe { max-width: 400px; margin-left: auto; margin-right: auto; }
.wsx__discard { border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx__discard:hover { color: var(--color-error); }
.wsx__discard[hidden] { display: none; }
.wsx__editnote { flex: 1; display: grid; place-items: center; text-align: center; color: var(--color-text-tertiary); font-size: var(--text-sm); padding: 24px; }
.wsx__toast { position: fixed; bottom: 84px; left: 50%; transform: translateX(-50%); z-index: 50; background: var(--color-text); color: var(--color-bg); padding: 10px 18px; border-radius: 999px; font: 600 var(--text-sm) var(--font-body); box-shadow: var(--shadow-xl); opacity: 0; transition: opacity var(--duration-fast); pointer-events: none; }
.wsx__toast.is-show { opacity: 1; }
/* Edit-Lite: right-rail property panel (context-sensitive, in Edit mode) */
.wsx-edit { padding: 16px; display: flex; flex-direction: column; gap: var(--space-4); }
.wsx-edit__hint { color: var(--color-text-tertiary); font-size: var(--text-sm); line-height: 1.55; padding: 8px 2px; }
.wsx-edit__type { display: inline-flex; align-items: center; gap: 7px; font: 700 var(--text-sm) var(--font-body); }
.wsx-edit__hdr { display: flex; align-items: center; gap: 9px; }
.wsx-edit__back { width: 30px; height: 30px; display: grid; place-items: center; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); cursor: pointer; flex: none; }
.wsx-edit__back:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-edit__tag { font: 600 10px var(--font-body); text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; background: var(--color-primary-light); color: var(--color-primary); }
.wsx-edit__sec { display: flex; flex-direction: column; gap: 7px; }
.wsx-edit__sec .lbl { font: 600 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-tertiary); }
.wsx-edit__inrow { display: flex; gap: 6px; }
.wsx-edit input[type="url"], .wsx-edit input[type="text"] { flex: 1; min-width: 0; box-sizing: border-box; padding: 8px 11px; border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md); font: 400 var(--text-sm) var(--font-body); outline: none; }
.wsx-edit input:focus { border-color: var(--color-primary); }
.wsx-edit__btn { padding: 8px 13px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; white-space: nowrap; }
.wsx-edit__btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-edit__btn.full { width: 100%; justify-content: center; }
.wsx-edit__btn.danger:hover { border-color: var(--color-error); color: var(--color-error); }
.wsx-edit__sel { flex: 1; padding: 8px 10px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-edit input[type="color"] { width: 40px; height: 38px; padding: 2px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); cursor: pointer; flex: none; }
.wsx-edit__btn.sq { flex: none; width: 40px; padding: 8px 0; text-align: center; font-size: var(--text-base); }
.wsx-edit__palette { display: flex; flex-wrap: wrap; gap: 6px; }
.wsx-edit__palette button { padding: 6px 11px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; }
.wsx-edit__palette button:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-edit__ai { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1.5px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); }
.wsx-edit__ai .lbl { color: var(--color-primary); }
.wsx-edit__aibtns { display: flex; flex-wrap: wrap; gap: 6px; }
.wsx-edit__aibtns button { padding: 5px 11px; border: 1.5px solid var(--color-primary); border-radius: 999px; background: var(--color-bg-elevated); color: var(--color-primary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; }
.wsx-edit__aibtns button:hover:not(:disabled) { background: var(--color-primary); color: var(--color-text-inverse); }
.wsx-edit__aibtns button:disabled, .wsx-edit__airow button:disabled { opacity: 0.5; cursor: default; }
.wsx-edit__airow { display: flex; gap: 6px; }
.wsx-edit__airow input { flex: 1; min-width: 0; box-sizing: border-box; padding: 7px 10px; border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md); font-size: var(--text-sm); outline: none; }
.wsx-edit__airow input:focus { border-color: var(--color-primary); }
.wsx-edit__aistat { font-size: var(--text-xs); color: var(--color-primary); min-height: 1em; }
.wsx-edit__fmt { display: flex; gap: 6px; }
.wsx-edit__fmt button { width: 38px; height: 34px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); cursor: pointer; font-size: var(--text-base); }
.wsx-edit__fmt button:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-edit__check { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--color-text-secondary); cursor: pointer; }
.wsx-edit__thumb { width: 100%; max-height: 120px; object-fit: contain; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); }

`;
