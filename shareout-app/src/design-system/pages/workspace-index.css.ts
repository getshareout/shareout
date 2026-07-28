/**
 * ShareOut Design System - Workspace Directory Index Page Styles
 * Simple /workspace apex page (use with baseStyles from shell.ts)
 */

const workspaceIndexPageComponents = `
body {
  font-family: var(--font-body);
  max-width: 32rem;
  margin: 4rem auto;
  padding: 0 1.5rem;
  color: var(--color-text);
  line-height: 1.5;
}

h1 {
  font-family: var(--font-display);
  font-weight: 600;
  margin-bottom: 1rem;
}

p {
  margin-bottom: 1rem;
  color: var(--color-text-secondary);
}

code {
  font-family: var(--font-mono);
  background: var(--color-surface);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
}

a {
  color: var(--color-primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
`;

export const workspaceIndexPageStyles = workspaceIndexPageComponents;
