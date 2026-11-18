// Its own module so code that only catches it (`instanceof`) does not load parse-doc, and SheetJS with it.
export class DocReadError extends Error {}
