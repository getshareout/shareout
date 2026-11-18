/**
 * What New → "Table from an Excel file" says when a file cannot be used: one sentence with what to
 * do. Shared by the route (new-table.ts) and the Studio client (home-i18n copy), which checks the
 * type and size before uploading. No imports: the client copy bundle reads it too.
 * {file} = the file's name, {mb} = the size limit, {rows} = the row limit.
 */
export type TableErrorCode = 'NO_FILE' | 'NOT_A_SHEET' | 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'NO_ROWS' | 'UNREADABLE' | 'WRITE_FAILED';

export const TABLE_ERRORS: Record<'en' | 'es', Record<TableErrorCode, string>> = {
  en: {
    NO_FILE: 'Pick an Excel (.xlsx) or CSV file from your computer.',
    NOT_A_SHEET: '“{file}” isn’t an Excel (.xlsx) or CSV file. Open it in Excel, save it as .xlsx (File → Save as) and pick it again.',
    TOO_LARGE: '“{file}” is too big (the limit is {mb} MB). Keep only the tab you need, or save it as CSV, and try again.',
    TOO_MANY_ROWS: '“{file}” has more than {rows} rows. Keep only the rows you need and try again.',
    NO_ROWS: '“{file}” has no rows under the column titles. The first row holds the titles and the rows below hold the data: fill it in and try again.',
    UNREADABLE: 'We couldn’t read “{file}”. Open it in Excel, save it again as .xlsx and try again.',
    WRITE_FAILED: 'The table was created, but its data couldn’t be saved. Try again in a minute.',
  },
  es: {
    NO_FILE: 'Elegí un archivo Excel (.xlsx) o CSV de tu computadora.',
    NOT_A_SHEET: '“{file}” no es un Excel (.xlsx) ni un CSV. Abrilo en Excel, guardalo como .xlsx (Archivo → Guardar como) y elegilo de nuevo.',
    TOO_LARGE: '“{file}” es demasiado grande (el límite es {mb} MB). Dejá solo la pestaña que necesitás, o guardalo como CSV, y probá de nuevo.',
    TOO_MANY_ROWS: '“{file}” tiene más de {rows} filas. Dejá solo las filas que necesitás y probá de nuevo.',
    NO_ROWS: '“{file}” no tiene filas debajo de los títulos. La primera fila lleva los títulos de las columnas y las de abajo, los datos: completalo y probá de nuevo.',
    UNREADABLE: 'No pudimos leer “{file}”. Abrilo en Excel, guardalo de nuevo como .xlsx y probá otra vez.',
    WRITE_FAILED: 'Se creó la tabla, pero no se pudieron guardar sus datos. Probá de nuevo en un minuto.',
  },
};

