// Converted documents (PDF → markdown, xlsx → csv) are summarized too, not just pages.
export const SUMMARY_ARTIFACT_TYPES: readonly string[] = ['html', 'markdown', 'csv', 'pdf'];
export const SUMMARY_MIMES_SQL = `('text/html', 'text/markdown', 'text/csv', 'application/pdf')`;
