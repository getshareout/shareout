# Components

Detailed component and layout guidelines. Tokens: [tokens.md](tokens.md). Color/type: [../visual/](../visual/).

---

## Buttons

### Primary (THE action)

```css
.btn-primary {
  padding: 14px 28px;
  min-height: 48px;
  min-width: 120px;
  border-radius: 12px;
  border: none;
  background: var(--color-primary);
  color: white;
  font: 600 16px var(--font-body);
  transition: transform 0.1s, background 0.15s;
  cursor: pointer;
}

.btn-primary:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0) scale(0.98);
}
```

### Secondary

```css
.btn-secondary {
  padding: 12px 24px;
  min-height: 44px;
  border-radius: 10px;
  border: 2px solid var(--color-border-strong);
  background: transparent;
  color: var(--color-text);
  font: 500 15px var(--font-body);
}

.btn-secondary:hover {
  border-color: var(--color-text-secondary);
  background: var(--color-surface);
}
```

### Ghost (tertiary)

```css
.btn-ghost {
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font: 500 14px var(--font-body);
}

.btn-ghost:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
```

**Rule:** Icon + label always. Never icon alone for important actions.

---

## Inputs

```css
.input {
  width: 100%;
  padding: 14px 16px;
  min-height: 48px;
  border-radius: 10px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-elevated);
  font: 400 16px var(--font-body);
  color: var(--color-text);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.input:invalid:not(:placeholder-shown) {
  border-color: var(--color-error);
}
```

### Field with label

```html
<div class="field">
  <label class="field-label" for="name">Your Name</label>
  <input class="input" id="name" type="text" placeholder="Maya Okafor">
  <span class="field-hint">This appears on your public page</span>
</div>
```

---

## Cards

```css
.card {
  background: var(--color-bg-elevated);
  border-radius: 16px;
  border: 1px solid var(--color-border);
  padding: var(--space-6);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.card-interactive {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}

.card-interactive:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  border-color: var(--color-border-strong);
}
```

---

## Header / Navigation

```css
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 64px;
  padding: 0 var(--space-6);
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

Toolbar pattern: 64px height · elevated white background · primary action stands alone on right.

---

## Modal / Dialog

```css
.modal {
  background: var(--color-bg-elevated);
  border-radius: 20px;
  padding: var(--space-8);
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
}
```

**Rule:** One primary action per modal. Close always available (X or click outside).

---

## Empty States

Content pattern:

```
[Friendly illustration or icon]
"No pages yet"
"Create your first page to share with the world."
[Create Page]  ← primary button
```

---

## Loading

**Skeleton-first.** When content is loading, show a skeleton that matches the final layout's shape (same blocks, same rounded corners, same rhythm), not a centered circular spinner. The spinner is reserved for a discrete in-progress *action* (a button mid-submit), never for page or content load.

```css
.skeleton {
  background: linear-gradient(
    100deg,
    var(--color-surface) 30%,
    var(--color-bg-elevated) 50%,
    var(--color-surface) 70%
  );
  background-size: 200% 100%;
  border-radius: 8px;            /* match the real element's radius */
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }  /* static placeholder, no shimmer */
}
```

- Reserve the real element's height so content swap-in causes **zero layout shift** (CLS).
- Spinner (action in progress): 0.8s linear spin, only inside the button/control that triggered the action.

---

## Status Badge

- Padding: 4px 12px
- Background: surface
- Text: tertiary, 13px
- Radius: 6px

---

## Patterns

### Form

Max-width 560px. Section titles with bottom border. Actions right-aligned with Cancel + primary.

### List with actions

Row: title + meta (mono URL) + ghost action buttons. Actions fade in on hover (always visible on touch).

---

## States & Feedback

### Interactive state matrix

Every interactive component ships **all five states**. The default-only component is unfinished.

| Component | Hover | Active / pressed | Focus (`:focus-visible`) | Disabled |
|-----------|-------|------------------|--------------------------|----------|
| Primary button | bg → `--color-primary-hover`, `translateY(-1px)` | `translateY(0) scale(0.98)` | `2px` ring `--color-primary`, `2px` offset | 50% opacity, `not-allowed`, no transform |
| Secondary button | border → `--color-text-secondary`, bg `--color-surface` | `scale(0.98)` | same ring | 50% opacity, `not-allowed` |
| Ghost button | bg `--color-surface`, text → `--color-text` | `scale(0.98)` | same ring | 50% opacity, `not-allowed` |
| Input | border → `--color-border-strong` | — | border `--color-primary` + `3px` `--color-primary-light` glow | `--color-surface` bg, `not-allowed` |
| Interactive card | `translateY(-2px)` + elevated shadow + border-strong | `translateY(0)` | ring on the card | reduced opacity, no lift |
| Icon (standalone) | color → `--color-text` | color → `--color-primary` | ring around 40×40 hit area | `--color-text-tertiary` |

Transitions: `--duration-fast`/`--duration-normal` with `--ease-out`. Animate only `transform`, `opacity`, `background`, `border-color`, `box-shadow`.

### Success toast

Green border + light green background (`--color-success-light`). Auto-dismiss; `toast` z-index token (1000).

### Error / validation

- Input: red border (`--color-error`) + message below field. Never rely on color alone (add an icon or text).
- Form-level: summarize errors at the top, link each to its field, keep entered values.
- Inline and contextual. Never `alert()`. Message explains *and* offers the fix (see [../brand/voice.md](../brand/voice.md)).

### Disabled

50% opacity, `cursor: not-allowed`, no transform on buttons. Disabled is the last resort: prefer a clear reason or a guided next step over a dead control.

### Focus

`:focus-visible` ring is mandatory on every interactive element. See [../principles/accessibility.md](../principles/accessibility.md).

---

## Quick Reference

**Do:** 48px touch targets · labels on buttons · generous spacing · warm colors · single primary action

**Don't:** icon-only key actions · thin text · cramped layouts · cold blue-grays · silent failures · competing CTAs

---

*Full CSS examples preserved from legacy UI specifications. Implementation: `shareout-app/src/design-system/components.ts`*
