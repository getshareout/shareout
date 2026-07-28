# Accessibility

Not an afterthought. Not a checklist. Built in.

---

## Non-Negotiables

- **Contrast:** WCAG AA minimum, AAA preferred
- **Keyboard:** Everything reachable, focus visible
- **Screen readers:** Semantic HTML, ARIA where needed
- **Touch:** 44px targets minimum, no hover-only info
- **Motion:** Respects `prefers-reduced-motion`
- **Text:** Scalable, never fixed pixel sizes that block zoom

---

## Focus States

Visible focus for keyboard users. Remove outline for mouse-only focus.

```css
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}
```

---

## Contrast in practice

- Every button label is verified readable against its own background (no white-on-light, no transparent-button text vanishing on a busy backdrop). Buttons over imagery get a scrim or solid fill.
- Feedback colors and Tertiary text have known limits — see the verified ratio table in [../visual/color.md](../visual/color.md). Don't set small body text in them.
- Never signal state with color alone (error/success/warning): pair with an icon or text label.

---

## Reduced Motion

If motion makes someone dizzy or confused → remove it.

If disabling motion breaks understanding → redesign.

The blanket reset below is the floor. Better: per-component, decide what *degrades to static* vs. what *becomes instant*. Infinite loops, parallax, shimmer, and entry slides collapse to their end state; functional transitions (focus ring appearing) can stay instant. Reveal-on-scroll content must be visible without the animation, never hidden waiting for a trigger that never fires.

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
```

---

## Touch Targets

| Element | Min Size |
|---------|----------|
| Primary buttons | 48px height |
| Secondary buttons | 44px height |
| Icon buttons | 40×40px |
| Inputs | 48–52px height |

---

## The Real Test

Can someone:

- Use it with one hand?
- Use it while distracted?
- Use it with poor vision?
- Use it on slow internet?
- Use it without reading instructions?

If any answer is "no" → redesign.

---

*See also: [design_principles.md](design_principles.md) · [../system/components.md](../system/components.md)*
