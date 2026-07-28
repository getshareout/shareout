---
title: BigQuery
description: Consultá datasets de Google Cloud desde una página, con tus propias credenciales.
---

Consultá BigQuery desde una página. La conexión vive a nivel **espacio de trabajo** con
tus propias credenciales de Google; las páginas leen a través de ella y nunca ven la
clave.

## Conectar

**Conectores → Agregar → Google BigQuery.** El método de conexión es una **cuenta de
servicio**:

1. En Google Cloud, creá una cuenta de servicio con los roles **BigQuery User** y
   **BigQuery Data Viewer** sobre el proyecto que querés leer.
2. Generá una clave JSON y descargá el archivo.
3. Pegá el JSON en el formulario del conector y nombrá la conexión (por ejemplo
   `warehouse`).

También se admite el camino OAuth, pero solo si quien opera la instancia configuró
`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` — en una instancia autohospedada suelen estar
sin configurar, y la cuenta de servicio evita necesitarlos.

## Consultar desde una página

```javascript
const sdk = await ShareOut.create();
const warehouse = sdk.connection('warehouse');

const { data, rowCount, cached } = await warehouse.query(`
  SELECT country, COUNT(*) AS orders
  FROM \`my-project.sales.orders\`
  WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY country
  ORDER BY orders DESC
`);
```

`fetch()` es la misma llamada cuando solo querés las filas:

```javascript
const rows = await warehouse.fetch('SELECT 1 AS ok');
```

## No consultes en cada visita

Un tablero que golpea BigQuery en cada carga es lento y te factura por visita. Mejor
materializá: corré la consulta en un horario, guardá el resultado y que la página lea la
copia guardada:

```javascript
await warehouse.materialize({
  query: 'SELECT country, COUNT(*) AS orders FROM `my-project.sales.orders` GROUP BY country',
  to: 'dataset:orders_by_country',
});
```

La página después lee `dataset:orders_by_country` sin tocar el warehouse. Combinalo con
un horario para que los números se mantengan al día.

## Notas

- Las consultas pasan **por el Worker** (modo proxy). BigQuery no permite llamadas
  directas desde el navegador, así que no hay camino CORS.
- La facturación es de Google, sobre tu proyecto. Un `SELECT *` sobre una tabla grande
  cuesta dinero real — acotá la consulta.
- La credencial se guarda cifrada y nunca llega al navegador.
- Probá una conexión con `POST /v1/workspaces/{id}/connections/test` antes de conectarle
  un tablero.
