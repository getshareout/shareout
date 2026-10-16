---
title: S3, Supabase, Redshift y Aurora
description: Leé archivos de Amazon S3 y consultá Supabase, Amazon Redshift y Amazon Aurora desde tus artefactos y el asistente.
---

Cuatro conectores de workspace para los datos que la mayoría de los equipos ya tiene en
AWS o Supabase. Agregalos una vez en **Conectores**, apretá **Test**, y cada artefacto — y el
asistente, si lo habilitás — los usa por nombre. Las claves se guardan cifradas y nunca
llegan al navegador.

Los cuatro son de **solo lectura**.

## Amazon S3

Lista un bucket y lee archivos CSV, JSON y de texto. Para archivos grandes o binarios
(PDF, imágenes, Parquet) devuelve un link de descarga temporal.

1. En AWS, creá un usuario IAM con **`s3:ListBucket`** y **`s3:GetObject`** sobre el bucket.
2. **Conectores → Amazon S3**: bucket, región, access key ID y secret.
3. La **Carpeta** opcional limita el conector a un prefijo (por ejemplo `exports/`).
4. El **endpoint compatible con S3** opcional sirve para Cloudflare R2, MinIO y similares.

```javascript
const sdk = await ShareOut.create();
const s3 = sdk.platform.provider('s3');
const { data } = await s3.execute('objects.get', {
  connectionId,
  params: { queryParams: { key: 'exports/orders.csv' } },
});
console.log(data.rows); // un objeto por fila del CSV, con las columnas del encabezado
```

| Endpoint | Hace |
| --- | --- |
| `objects.list` | Carpetas y archivos bajo `prefix` |
| `objects.get` | Un archivo de hasta 10 MB: CSV → `rows`, JSON → `data`, texto → `text` |
| `objects.presign` | Una URL de descarga firmada, válida hasta una hora |

## Supabase

Corre SQL con el endpoint de consultas de solo lectura de Supabase, como el usuario
`supabase_read_only_user` — no puede escribir por diseño.

1. En Supabase, **Account → Access Tokens → Generate new token**.
2. **Conectores → Supabase**: pegá la URL (o el ref) del proyecto y el token.

## Amazon Redshift

Usa la **Redshift Data API**, así que funciona con clústeres privados sin exponerlos a
internet.

1. Creá un usuario IAM con `redshift-data:*` y además
   `redshift-serverless:GetCredentials` / `redshift:GetClusterCredentials` o
   `secretsmanager:GetSecretValue` para un login guardado.
2. **Conectores → Amazon Redshift**: región, nombre del workgroup Serverless o del clúster,
   base de datos y — para un clúster aprovisionado — un usuario de base de datos o un ARN de Secrets Manager.
3. Dale permisos de solo lectura a ese usuario.

## Amazon Aurora

Aurora PostgreSQL y Aurora MySQL con la **RDS Data API**.

1. Activá la Data API en el clúster (consola de RDS → Modify → *Data API*).
2. Guardá un login de solo lectura en Secrets Manager.
3. Creá un usuario IAM con `rds-data:ExecuteStatement` y `secretsmanager:GetSecretValue`
   sobre ese secreto.
4. **Conectores → Amazon Aurora**: ARN del clúster, ARN del secreto, base de datos.

Amazon RDS común (no Aurora) y Postgres autoalojado todavía no están soportados: necesitan
un socket directo a la base, y el runtime de ShareOut no puede abrirlo contra bases
firmadas por una autoridad certificante privada.

## Consultar los conectores SQL

Supabase, Redshift y Aurora comparten un endpoint y una forma de resultado:

```javascript
const { data } = await sdk.platform.execute('supabase', 'sql.query', {
  connectionId,
  params: { body: { sql: 'select status, count(*) as n from orders group by 1' } },
});
// data → { columns: ['status', 'n'], rows: [{ status: 'paid', n: 31 }, …] }
```

Pasá `maxRows` (hasta 10 000) para limitar el resultado. En los artefactos con política de
acceso por fila, los viewers solo pueden correr queries declaradas en `access_policy.queries`, igual que con Snowflake.

## El asistente

Marcá **AI** en la tarjeta del conector y el asistente del workspace puede consultarlo: los
conectores SQL con `SELECT`s de solo lectura, S3 navegando carpetas y leyendo archivos.
