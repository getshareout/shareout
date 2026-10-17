---
title: Conexiones MCP
description: Dejá que un artefacto solo para miembros lea la cuenta propia de cada visitante en un servidor MCP remoto.
---

import { Aside } from '@astrojs/starlight/components';

Un artefacto puede usar **la cuenta propia de quien lo mira** en un servidor MCP remoto
(Notion, Linear, Sentry, …). Cada miembro ve sus propios datos, con su propio inicio de
sesión. ShareOut nunca le muestra el token de nadie al artefacto.

<Aside type="note" title="Solo artefactos para miembros">
Las conexiones MCP funcionan solo en artefactos de workspace con visibilidad `workspace` o
`private`, para miembros internos de ese workspace. Nunca llegan a links públicos, links
con contraseña ni invitados.
</Aside>

## 1. Un admin agrega el servidor

En **Conexiones** del workspace elegí **Servidor MCP**, poné un nombre y la URL `https`
del servidor. ShareOut descubre cómo inicia sesión ese servidor y se registra solo.

```http
POST /v1/workspaces/{workspaceId}/mcp-connections
{ "name": "notion", "serverUrl": "https://mcp.notion.com/mcp" }
```

## 2. Cada miembro conecta su cuenta

Los miembros tocan **Conectar mi cuenta**, o conectan desde el artefacto cuando lo pide.
Los tokens se guardan por miembro y se renuevan solos.

## 3. El artefacto declara qué usa

Publicá con los nombres de conexión y las **herramientas exactas** que usa el artefacto.
Solo se pueden usar herramientas que el servidor marca como de solo lectura. Una lista
vacía se rechaza: nunca significa "todas".

```json
{
  "capabilities": {
    "mcp": { "connections": [{ "name": "notion", "tools": ["search", "fetch"] }] }
  }
}
```

Si omitís `capabilities` en una publicación posterior se mantiene la declaración;
`"mcp": null` la quita. Los guardados del editor la mantienen. Si la declaración cambia,
cada visitante tiene que volver a permitir el artefacto.

## 4. Usala desde el artefacto

```javascript
const sdk = await ShareOut.create();

async function load() {
  try {
    const res = await sdk.mcp.callTool('notion', 'search', { query: 'Roadmap' });
    render(res.payload);
  } catch (err) {
    if (err.code === 'approval_required' || err.code === 'credentials_required') {
      showButton('Usar mi cuenta de Notion', async () => {
        const access = await sdk.mcp.requestAccess('notion');
        if (access.allowed) load();
      });
    } else if (err.retryable) {
      showRetry(load);
    } else {
      showMessage(err.message);
    }
  }
}
load();
```

`requestAccess` abre el diálogo de ShareOut fuera del artefacto. **Ahora no** vale hasta
que se recargue el artefacto, así que llamalo desde un botón que tocó el visitante.

`sdk.mcp.watchTool(connection, tool, input, handler, { refetchInterval })` mantiene los
datos al día: consulta como mucho cada 30 segundos, se pausa con la pestaña oculta y se
detiene ante errores que solo el visitante puede resolver.

Los códigos de error y el modelo de seguridad están en la
[versión en inglés](/sdk/mcp/).
