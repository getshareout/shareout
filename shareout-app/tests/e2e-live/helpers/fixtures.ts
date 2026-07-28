export function minimalArtifactHtml(title: string, marker: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
</head>
<body>
  <h1>${title}</h1>
  <p data-e2e-marker="${marker}">ShareOut E2E test artifact</p>
</body>
</html>`;
}
