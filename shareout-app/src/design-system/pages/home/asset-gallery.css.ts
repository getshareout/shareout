/**
 * Home page styles — Assets lens (media & file library gallery)
 * @module design-system/pages/home/asset-gallery
 */

/** CSS rules for: Assets gallery */
export const assetGalleryStyles = `/* ── Assets lens ────────────────────────────────────── */
.wsx-assets__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.wsx-assets__upload { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border: 0; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font: 600 0.85rem var(--font-body); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.wsx-assets__upload:hover { background: var(--color-primary-hover); }
.wsx-assets__upload.is-busy { opacity: 0.6; cursor: default; }
.wsx-assets__upload svg { width: 16px; height: 16px; }
.wsx-asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: var(--space-3); margin-top: var(--space-3); }
.wsx-asset { position: relative; display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); overflow: hidden; transition: border-color 0.15s, box-shadow 0.15s; }
.wsx-asset:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.wsx-asset__thumb { position: relative; aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.04); overflow: hidden; }
.wsx-asset__thumb img, .wsx-asset__thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.wsx-asset__thumb--file { flex-direction: column; gap: 6px; color: var(--color-text-tertiary); }
.wsx-asset__thumb--file svg { width: 34px; height: 34px; }
.wsx-asset__ext { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; color: var(--color-text-secondary); }
.wsx-asset__thumb--vid .wsx-asset__play { position: absolute; inset: 0; margin: auto; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(0,0,0,0.5); color: var(--color-text-inverse); }
.wsx-asset__thumb--vid .wsx-asset__play svg { width: 18px; height: 18px; }
.wsx-asset__meta { display: flex; flex-direction: column; gap: 1px; padding: 9px 10px; min-width: 0; }
.wsx-asset__name { font-size: 0.8rem; font-weight: 500; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-asset__sz { font-size: 0.72rem; color: var(--color-text-tertiary); }
.wsx-asset__tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.wsx-asset__tag { font-size: 0.65rem; line-height: 1.4; padding: 0 6px; border-radius: 999px; background: var(--color-surface-sunken, rgba(127,127,127,.12)); color: var(--color-text-secondary); white-space: nowrap; }
.wsx-asset__actions { position: absolute; top: 7px; right: 7px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.wsx-asset:hover .wsx-asset__actions, .wsx-asset:focus-within .wsx-asset__actions { opacity: 1; }
.wsx-asset__act { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-secondary); cursor: pointer; box-shadow: var(--shadow-sm); text-decoration: none; }
.wsx-asset__act:hover { color: var(--color-text); background: rgba(0,0,0,0.06); }
.wsx-asset__act.danger:hover { color: var(--color-error); }
.wsx-asset__act svg { width: 15px; height: 15px; }
/* deliverables: versions, selection, collection bar, share output */
.wsx-asset__ver { position: absolute; top: 8px; left: 8px; font-size: 0.68rem; font-weight: 700; color: var(--color-text-inverse); background: var(--color-primary); border-radius: 999px; padding: 1px 7px; }
.wsx-asset.is-sel { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-light); }
.wsx-asset__check { position: absolute; top: 8px; left: 8px; width: 22px; height: 22px; border-radius: 999px; border: 2px solid var(--color-text-inverse); background: rgba(0,0,0,0.25); box-shadow: var(--shadow-sm); cursor: pointer; z-index: 2; }
.wsx-asset__check.on { background: var(--color-primary); border-color: var(--color-primary); }
.wsx-asset__check.on::after { content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px; border: solid var(--color-text-inverse); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.wsx-asset-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-3); }
.wsx-asset-bar__r { display: flex; gap: 8px; }
.wsx-share-out { margin-top: 14px; }
.wsx-share-link { display: flex; gap: 8px; margin-bottom: 12px; }
.wsx-share-link input { flex: 1; min-width: 0; }
.wsx-share-send { display: flex; align-items: flex-end; gap: 8px; }
.wsx-share-send .wsx-field { flex: 1; margin: 0; }
.wsx-share-send + .wsx-share-send { margin-top: 6px; }
/* sent deliveries (manage + revoke) */
.wsx-assets__headr { display: flex; gap: 8px; align-items: center; }
.wsx-asset-folders { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 var(--space-3); }
.wsx-asset__ver--lock { background: var(--color-text-secondary); }
.wsx-deliv { display: flex; flex-direction: column; gap: 8px; }
.wsx-deliv__row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); }
.wsx-deliv__main { flex: 1; min-width: 0; }
.wsx-deliv__name { font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-deliv__meta { font-size: 0.76rem; color: var(--color-text-tertiary); margin-top: 2px; }
.wsx-deliv__st { flex-shrink: 0; font-size: 0.7rem; font-weight: 700; border-radius: 999px; padding: 2px 9px; }
.wsx-deliv__st.ok { color: var(--color-success); background: var(--color-success-light, rgba(22,163,74,0.1)); }
.wsx-deliv__st.ex { color: var(--color-text-secondary); background: rgba(0,0,0,0.05); }
.wsx-deliv__st.rv { color: var(--color-error); background: var(--color-error-light, rgba(220,38,38,0.08)); }
.wsx-deliv__acts { display: flex; gap: 6px; flex-shrink: 0; }

`;
