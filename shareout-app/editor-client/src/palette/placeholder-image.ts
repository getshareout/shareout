// Inline placeholder for the palette's Image element. Replaces the discontinued
// via.placeholder.com URL (EDIT-10 F7) — that service is gone, so dragging an Image
// produced a broken image. A self-contained SVG data-URI has no network dependency.
// Encoded at load time so we don't hand-maintain a percent-encoded blob.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">` +
  `<rect width="300" height="200" rx="12" fill="#f5f5f4"/>` +
  `<g fill="none" stroke="#a8a29e" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">` +
  `<rect x="1" y="1" width="298" height="198" rx="12"/>` +
  `<circle cx="104" cy="78" r="13"/>` +
  `<path d="M44 158l66-58 40 34 46-46 60 70"/>` +
  `</g></svg>`;

export const PLACEHOLDER_IMAGE_SRC = `data:image/svg+xml,${encodeURIComponent(PLACEHOLDER_SVG)}`;
