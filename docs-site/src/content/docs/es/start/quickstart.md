---
title: Inicio rápido
description: Publicá tu primera página en menos de un minuto en tu instancia.
---

import { Steps } from '@astrojs/starlight/components';

Publicá una página en vivo con un solo request contra **tu** `$ORIGIN`. Vas a
necesitar un token de API — mirá [Autenticación](/es/start/authentication/).
¿Sin instancia? [Instalá primero](/es/self-host/overview/).

<Steps>

1. **Guardá credenciales.** Token **y origin** en `~/.shareout/credentials`:

   ```json title="~/.shareout/credentials"
   {
     "token": "so_your_token_here",
     "origin": "https://shareout.<tu-cuenta>.workers.dev"
   }
   ```

2. **Publicá una página.** ShareOut está detrás de Cloudflare, que puede bloquear
   los `requests` crudos de Python. El patrón confiable es construir el JSON en
   Python y pasarlo por pipe a `curl`:

   ```bash
   ORIGIN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['origin'].rstrip('/'))")
   TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")

   python3 - <<'PY' | curl -sS -X POST "$ORIGIN/v1/publish" \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     --data-binary @-
   import json, sys
   json.dump({
     "name": "Hello ShareOut",
     "slug": "hello-shareout",
     "visibility": "public",
     "files": [{
       "path": "index.html",
       "content": "<!DOCTYPE html><html><body><h1>Hello, world.</h1></body></html>",
       "mime": "text/html",
       "encoding": "utf8"
     }]
   }, sys.stdout)
   PY
   ```

3. **Abrí tu URL.** La respuesta incluye el link en vivo en **tu** origen:

   ```json
   {
     "artifact": { "id": "art_abc123" },
     "deployment": {
       "slug": "hello-shareout",
       "url": "https://shareout.<tu-cuenta>.workers.dev/a/hello-shareout/"
     }
   }
   ```

</Steps>

Listo — tu página está en vivo. Actualizala cuando quieras publicando de nuevo
con el mismo `slug`; ShareOut crea una nueva versión y conserva las anteriores.

## Siguiente

- [Dale datos a tu página](/es/guides/data/) — JSON, tablas y blobs.
- [Ponela en un schedule](/es/guides/jobs/) — email, Slack, webhooks.
- La [referencia de API](/es/api/).
