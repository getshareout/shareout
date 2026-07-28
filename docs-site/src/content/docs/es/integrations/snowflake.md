---
title: Snowflake
description: Consultá tu warehouse de Snowflake desde una página, con autenticación por par de claves.
---

Consultá Snowflake desde una página. La conexión vive a nivel **espacio de trabajo** con
tus propias credenciales; las páginas leen a través de ella y nunca ven la clave.

## Conectar

**Conectores → Agregar → Snowflake.** Acá Snowflake usa **autenticación por par de
claves**, no contraseña: ShareOut firma un JWT con tu clave privada en cada request.

Generá el par de claves:

```bash
# clave privada, PKCS#8 sin cifrar — es el formato que espera el conector
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out shareout_key.p8 -nocrypt

# clave pública correspondiente
openssl rsa -in shareout_key.p8 -pubout -out shareout_key.pub
```

Registrá la clave pública en el usuario de Snowflake:

```sql
ALTER USER my_user SET RSA_PUBLIC_KEY='MIIBIjANBgkq...';   -- contenido de shareout_key.pub, sin encabezados
DESC USER my_user;                                          -- leé RSA_PUBLIC_KEY_FP
```

Después completá el formulario del conector:

| Campo | Valor |
|-------|-------|
| `account` | Tu identificador de cuenta, por ejemplo `ab12345.us-east-1` (lo que va antes de `.snowflakecomputing.com`) |
| `user` | El usuario de Snowflake donde cargaste la clave pública |
| `private_key` | Contenido de `shareout_key.p8`, **PKCS#8, sin cifrar** |
| `public_key_fingerprint` | El valor `RSA_PUBLIC_KEY_FP` que devuelve `DESC USER` |

Si la clave privada está en otro formato, el conector falla con `Invalid PKCS8 input` —
regenerala con los flags `-topk8 -nocrypt` de arriba.

## Consultar desde una página

```javascript
const sdk = await ShareOut.create();
const warehouse = sdk.connection('snowflake');

const { data } = await warehouse.query(`
  SELECT customer, SUM(amount) AS revenue
  FROM analytics.public.invoices
  WHERE invoice_date >= DATEADD(day, -30, CURRENT_DATE())
  GROUP BY customer
  ORDER BY revenue DESC
  LIMIT 20
`);
```

Dale a la consulta warehouse, base y schema — calificados en el SQL (como arriba) o como
valores por defecto del usuario de Snowflake. El conector no los adivina.

## No consultes en cada visita

Snowflake factura por tiempo de warehouse, así que un tablero que consulta en cada carga
mantiene un warehouse despierto. Materializá en un horario y que la página lea el
resultado guardado:

```javascript
await warehouse.materialize({
  query: 'SELECT customer, SUM(amount) AS revenue FROM analytics.public.invoices GROUP BY customer',
  to: 'table:revenue_by_customer',
  mode: 'replace',
});
```

## Notas

- Las consultas pasan **por el Worker**. No hay camino directo desde el navegador.
- Corrélas **de a una** — una ráfaga de consultas paralelas contra un mismo warehouse
  tiende a encolarse en vez de paralelizarse.
- La clave privada se guarda cifrada y nunca llega al navegador.
- Probá una conexión con `POST /v1/workspaces/{id}/connections/test` antes de conectarle
  un tablero.
