# Changelog

All notable changes to the public ShareOut tree are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

Two parts: **Release notes** — what changed for people who use ShareOut, newest first, in plain
words, each with its Spanish line and a short note for integrators (the docs site renders it as
*What's new* / *Novedades*) — and **Unreleased**, the detailed technical log. A user-visible PR
adds to both (AGENTS.md → Gate contract).

## Release notes

### 2026-11-18

- **Keep a table up to date by email.** Email the Excel or CSV to the page's own address and the table updates itself — no Google account, no sign-in. Only the people you list can send it, and you see how many rows arrived.
  - es: **Mantené una tabla al día por email.** Mandá el Excel o el CSV a la dirección del artefacto y la tabla se actualiza sola — sin cuenta de Google, sin iniciar sesión. Solo pueden mandarlo las personas que pongas, y ves cuántas filas llegaron.
  - Guide: /everyone/inbox/#update-your-pages-numbers-by-emailing-the-excel
  - Guía: /es/everyone/inbox/#actualizá-los-números-de-tu-artefacto-mandando-el-excel-por-email
  - Integrators: job action `email_sheet_sync`; `GET /v1/artifacts/{id}/email-sync`, `PUT …/email-sync/senders`; MCP `set_email_sync`, `check_email_sync`. (#316, #317)
- **Make a table from an Excel file in one step.** New → Table from an Excel file turns an Excel or CSV from your computer into a clean table that reads well on a phone, then asks how to keep it up to date. The page's email address is now short enough to read out over the phone.
  - es: **Armá una tabla desde un Excel en un paso.** Nuevo → Tabla desde un Excel convierte un Excel o CSV de tu computadora en una tabla prolija que se lee bien en el celular, y después te pregunta cómo mantenerla al día. La dirección de email del artefacto ahora es tan corta que se puede dictar por teléfono.
  - Guide: /everyone/inbox/#start-from-an-excel-file
  - Guía: /es/everyone/inbox/#empezá-desde-un-excel
  - Integrators: `POST /v1/home/new` `{ template: "table", file }`; short inbox addresses (long ones keep working). (#319)
- **Reports that already reach your inbox can update a page by themselves.** Forward them automatically from Gmail or Outlook. When Gmail asks to confirm, ShareOut shows a Confirm button; a forwarded report from someone not on your list can be allowed with one tap.
  - es: **Los reportes que ya te llegan por mail pueden actualizar un artefacto solos.** Reenvialos automáticamente desde Gmail u Outlook. Cuando Gmail pide confirmar, ShareOut te muestra un botón Confirmar; un reporte reenviado de alguien que no está en tu lista se permite con un toque.
  - Guide: /everyone/inbox/#let-the-report-arrive-by-itself
  - Guía: /es/everyone/inbox/#que-tu-reporte-llegue-solo
  - Integrators: `GET /v1/artifacts/{id}/email-sync` → `forwarding`, `recentRejected[].canAllow`; `POST …/email-sync/forwarding/{id}`. (#320)
- **A stranger can't hide your Gmail confirmation.** When several people ask to forward to the same page, the people on your list come first and get the Confirm button; someone else's request shows with a warning instead.
  - es: **Un desconocido no puede tapar tu confirmación de Gmail.** Cuando varias personas piden reenviar al mismo artefacto, las de tu lista aparecen primero y tienen el botón Confirmar; el pedido de otra persona aparece con una advertencia.
  - Guide: /everyone/inbox/#let-the-report-arrive-by-itself
  - Guía: /es/everyone/inbox/#que-tu-reporte-llegue-solo
  - Integrators: `forwarding` lists listed requesters first; over the cap of 3, unlisted requesters are dropped first; a requester on the instance's own inbox domain is recognised. (#321)
- **Keep a page in sync with a spreadsheet in Google Drive or behind a shared link.** Pick a private file in Google's own window (ShareOut reads only that file), or paste a link shared with "Anyone with the link". The page updates on the schedule you choose — every morning by default.
  - es: **Mantené un artefacto sincronizado con una planilla de Google Drive o de un enlace compartido.** Elegí un archivo privado en la ventana de Google (ShareOut solo lee ese archivo), o pegá un enlace compartido con "Cualquier persona que tenga el vínculo". El artefacto se actualiza en el horario que elijas — por defecto, todas las mañanas.
  - Guide: /everyone/google-sheets/#keep-a-page-up-to-date-from-a-spreadsheet
  - Guía: /es/everyone/google-sheets/#mantené-un-artefacto-al-día-desde-una-planilla
  - Integrators: job actions `drive_file_sync`, `public_sheet_sync`; `POST /v1/workspaces/{ws}/sheet-links/inspect`; `GET …/file-imports/sheet-sync` (`picked`). (#304, #309, #311)
- **Claude, ChatGPT and other assistants can set these up for you.** Ask your assistant to keep a page up to date from a spreadsheet or by email: it asks one question at a time, hands you the address or the Google window, and tells you how many rows arrived.
  - es: **Claude, ChatGPT y otros asistentes pueden configurarlo por vos.** Pedile a tu asistente que mantenga un artefacto al día desde una planilla o por email: te hace una pregunta por vez, te da la dirección o la ventana de Google y te dice cuántas filas llegaron.
  - Guide: /everyone/connect-ai-apps/
  - Guía: /es/everyone/connect-ai-apps/
  - Integrators: MCP `inspect_sheet_link`, `pick_drive_spreadsheet`, `set_sheet_sync`, `remove_sheet_sync`, `set_email_sync`, `check_email_sync`; skill `integrations/spreadsheet-sync.md`. (#315)
- **Bring a whole Google Drive folder by sharing it.** Where the ShareOut you use has it turned on, share a Drive folder with your workspace's own ShareOut email — no Google permission screen. Files added later come over on the next sync.
  - es: **Traé una carpeta entera de Google Drive compartiéndola.** Donde tu ShareOut lo tenga activado, compartí una carpeta de Drive con el email propio de tu workspace — sin pantalla de permisos de Google. Los archivos que agregues después llegan en la próxima sincronización.
  - Guide: /teams/drive-import/#google-drive-share-a-folder-with-shareout
  - Guía: /es/teams/drive-import/#google-drive-compartí-una-carpeta-con-shareout
  - Integrators: optional, self-host: set `GOOGLE_DRIVE_SA_KEY`. `POST /v1/workspaces/{ws}/file-imports/share/google_drive`; sources `access: "share"`. (#310)
- **One simple way to share.** The same share window in Home and on the page: anyone with the link, everyone in your workspace, only the people you pick, or only you. Invite anyone by email and add a message; people who haven't signed in yet show as invited.
  - es: **Una sola forma simple de compartir.** La misma ventana para compartir en Inicio y en el artefacto: cualquiera con el link, todo tu workspace, solo las personas que elijas, o solo vos. Invitá a cualquiera por email y sumá un mensaje; quien todavía no entró aparece como invitado.
  - Guide: /everyone/share-it/
  - Guía: /es/everyone/share-it/
  - Integrators: `POST /v1/artifacts/{id}/collaborators` `message`; collaborators `pending`; `GET /v1/artifacts/{id}` `workspace_name`. (#303)
- **Your team decides what Knowledge knows.** Owners and admins confirm, rename, merge or discard what Knowledge learned, add connections and facts, and write the team's rules and glossary. Learning again keeps what the team decided. Assistants connected to ShareOut can do the same.
  - es: **Tu equipo decide qué sabe Knowledge.** Owners y admins confirman, renombran, unen o descartan lo que Knowledge aprendió, suman conexiones y datos, y escriben las reglas y el glosario del equipo. Volver a aprender respeta lo que decidió el equipo. Los asistentes conectados a ShareOut pueden hacer lo mismo.
  - Guide: /teams/knowledge/
  - Guía: /es/teams/knowledge/
  - Integrators: `/v1/workspaces/{id}/knowledge/{entities,relations,facts,schema,rules,discarded,history}`; MCP `knowledge_edit_*`, `knowledge_rules`, `knowledge_review`. (#305, #306)
- **Install ShareOut in Claude in two commands.** The official Claude plugin brings the ShareOut connector and skill together.
  - es: **Instalá ShareOut en Claude con dos comandos.** El plugin oficial de Claude trae juntos el conector y el skill de ShareOut.
  - Guide: /everyone/connect-ai-apps/
  - Guía: /es/everyone/connect-ai-apps/
  - Integrators: `/plugin marketplace add getshareout/shareout`, then `/plugin install shareout@getshareout`. (#307)
- **Read your Humand data in a page.** Connect Humand (people, time off, shifts, courses and more, read-only) and show it in a page or ask the assistant about it.
  - es: **Leé tus datos de Humand en un artefacto.** Conectá Humand (personas, licencias, turnos, cursos y más, solo lectura) y mostralo en un artefacto o preguntale al asistente.
  - Guide: /integrations/humand/
  - Guía: /es/integrations/humand/
  - Integrators: platform connector `humand`; `read_connector` tool (assistant and MCP). (#302)
- **Scanned documents cost less to read.** A scanned PDF is turned into text by a smaller model.
  - es: **Leer documentos escaneados cuesta menos.** Un PDF escaneado se pasa a texto con un modelo más chico.
  - Integrators: self-host `SCAN_MODEL` overrides the default (Claude Haiku 5.5). (#301)
- **Invoices arrive by email, and paying is one step.** When the operator issues an invoice it is emailed to your billing contact with the PDF; attaching the transfer proof (or replying to the email with it) marks it paid.
  - es: **Las facturas llegan por email, y pagar es un paso.** Cuando el operador emite una factura, le llega por email a tu contacto de facturación con el PDF; adjuntar el comprobante de transferencia (o responder el email con él) la marca como pagada.
  - Guide: /teams/admin/
  - Guía: /es/teams/admin/
  - Integrators: `POST /v1/workspaces/{ws}/invoices/from-document`, `…/invoices/{id}/send`; self-host: Email → Invoice mail. (#297)
- **Fixes.** Long Snowflake queries no longer give up early, and page view counts are recorded again.
  - es: **Arreglos.** Las consultas largas de Snowflake ya no se cortan antes de tiempo, y las visitas de los artefactos se vuelven a contar.
  - Integrators: (#282, #289)

### 2026-11-16

- **Knowledge picks a page up again when you share it.** A page that goes from private to shared is learned again, and links on your workspace's own address are cleaner.
  - es: **Knowledge vuelve a leer un artefacto cuando lo compartís.** Un artefacto que pasa de privado a compartido se vuelve a aprender, y los links en la dirección propia de tu workspace quedan más limpios.
  - Integrators: (#298, #299)

### 2026-11-05

- **Report emails can carry a proper PDF.** Scheduled report emails can attach the page as a paginated PDF in A4, Letter or Legal, portrait or landscape.
  - es: **Los emails de reportes pueden llevar un PDF prolijo.** Los emails de reportes programados pueden adjuntar el artefacto como un PDF paginado en A4, Carta u Oficio, vertical u horizontal.
  - Guide: /guides/jobs/
  - Guía: /es/guides/jobs/
  - Integrators: email job `renderPdf`, `pdfFormat`, `pdfLandscape`. (#292)

### 2026-11-04

- **See where your AI spending goes.** Admin → Billing has an AI report for each month (download it as CSV), and Admin → Summary shows the month's usage to the owner and the admins they choose. Billing details can include Argentine tax data.
  - es: **Mirá en qué se va el gasto de IA.** Admin → Facturación tiene un reporte de IA por mes (descargalo en CSV), y Admin → Resumen le muestra el uso del mes al dueño y a los admins que elija. Los datos de facturación pueden incluir los datos fiscales de Argentina.
  - Guide: /teams/admin/
  - Guía: /es/teams/admin/
  - Integrators: `GET /v1/workspaces/{id}/ai-report`, `…/summary`, `…/summary/viewers`, `…/billing-profile`. (#288, #290, #291)

### 2026-11-03

- **Show a page only once.** Send someone a link that opens the page one time, with a personal code built in — one tap, nothing to type. The code page carries your workspace's brand, you are told when it was opened, and the link preview in WhatsApp or Slack is up to you.
  - es: **Mostrá un artefacto una sola vez.** Mandale a alguien un link que abre el artefacto una vez, con un código personal adentro — un toque, nada para escribir. La página del código lleva la marca de tu workspace, te avisamos cuándo se abrió, y vos decidís cómo se ve la vista previa en WhatsApp o Slack.
  - Guide: /everyone/share-it/
  - Guía: /es/everyone/share-it/
  - Integrators: `GET|POST|DELETE /v1/artifacts/{id}/view-codes`, `PUT|DELETE …/view-codes/gate/image`. (#284, #285, #286, #287)

### 2026-11-02

- **Admin is easier to find your way in.** Admin is now a menu of short pages grouped by topic, and what needs your attention shows in color.
  - es: **Es más fácil ubicarse en Admin.** Admin ahora es un menú de páginas cortas agrupadas por tema, y lo que necesita tu atención aparece en color.
  - Guide: /teams/admin/
  - Guía: /es/teams/admin/
  - Integrators: deep links `#l/admin/<page>`. (#280)
- **Workspaces get invoices and see their AI price.** The operator can bill a workspace, attach the receipt and mark it paid; AI usage is shown at the workspace's price.
  - es: **Los workspaces reciben facturas y ven su precio de IA.** El operador puede facturarle a un workspace, adjuntar el comprobante y marcarla como pagada; el uso de IA se muestra al precio del workspace.
  - Integrators: `/v1/workspaces/{id}/invoices…`; self-host markup `PUT /v1/admin/ai-settings`, `PUT /v1/workspaces/{id}/ai-markup`. (#278, #279)

### 2026-10-29

- **AI keeps building your page after you close the tab.** You get a notice when it's ready. A page the AI couldn't finish is never published, and if a page breaks, the people viewing it see a short message and can report it.
  - es: **La IA sigue armando tu artefacto aunque cierres la pestaña.** Te avisamos cuando está listo. Un artefacto que la IA no pudo terminar nunca se publica, y si un artefacto falla, quien lo mira ve un mensaje corto y puede avisarnos.
  - Guide: /everyone/your-workspace/
  - Guía: /es/everyone/your-workspace/
  - Integrators: durable builds `/v1/builds*`; self-host `BUILD_AGENT`, `BUILD_EFFORT`, `BUILD_MODEL`, `AI_CREDIT_ALERT_USD`, `AI_SPEND_ALERT_USD_PER_DAY`. (#268, #269, #270, #273, #274, #275, #276)
- **People you share a page with get an email.** New people get a code to sign in. You can also ask the assistant to share, unshare or change who can see a page.
  - es: **Las personas con quienes compartís un artefacto reciben un email.** Las personas nuevas reciben un código para entrar. También le podés pedir al asistente que comparta, deje de compartir o cambie quién puede ver un artefacto.
  - Guide: /everyone/collaborators/
  - Guía: /es/everyone/collaborators/
  - Integrators: (#271)

### 2026-10-28

- **Every automation has its own page.** Open an automation or AI task to see each run and change anything about it. Catalog entries can be edited from the Catalog or by asking the assistant.
  - es: **Cada automatización tiene su propia página.** Abrí una automatización o tarea de IA para ver cada ejecución y cambiar lo que quieras. Las entradas del Catálogo se editan desde el Catálogo o pidiéndoselo al asistente.
  - Guide: /everyone/automations/
  - Guía: /es/everyone/automations/
  - Integrators: `PATCH /v1/workspaces/{id}/automations/{id}` (`cron`, `instructions`, `model`…); `PATCH …/catalog/entries/{id}`. (#266, #267)

### 2026-10-27

- **A calmer Home.** Home shows what needs you, what's for you and what you opened recently. The page panel has three tabs — Details, Comments, Automate — and every table sorts by any column.
  - es: **Un Inicio más tranquilo.** Inicio muestra lo que te necesita, lo que es para vos y lo último que abriste. El panel del artefacto tiene tres pestañas — Detalles, Comentarios, Automatizar — y toda tabla se ordena por cualquier columna.
  - Guide: /everyone/your-workspace/
  - Guía: /es/everyone/your-workspace/
  - Integrators: (#259, #260, #261, #262, #263, #264, #265)
- **People you send a link to see it in their language.** The toolbar, sign-in errors and "not found" pages follow the visitor's language, and the visibility badge says exactly who can open a page.
  - es: **Quien recibe tu link lo ve en su idioma.** La barra, los errores al entrar y las páginas de "no encontrado" siguen el idioma de quien visita, y la etiqueta de visibilidad dice exactamente quién puede abrir el artefacto.
  - Integrators: `can_open_public` on `GET /v1/artifacts/{id}`. (#254, #255, #257, #258)

### 2026-10-26

- **Fewer choices, clearer steps.** One New button, a shorter left menu, a Share button that confirms right away, and a first run that shows one next step. Pages you make with AI start private.
  - es: **Menos opciones, pasos más claros.** Un solo botón Nuevo, un menú de la izquierda más corto, un botón Compartir que confirma al instante, y un primer uso que muestra un solo paso siguiente. Los artefactos que hacés con IA arrancan privados.
  - Guide: /everyone/make-your-first-page/
  - Guía: /es/everyone/make-your-first-page/
  - Integrators: (#249, #250, #251, #252)
- **Quick edit is safer and smarter.** Cmd/Ctrl+S saves, your changes survive if someone else edited at the same time, and you can ask AI to change any block, image or the whole page — then keep it or undo it. Watch AI build a new page live in its own tab.
  - es: **La edición rápida es más segura y más inteligente.** Cmd/Ctrl+S guarda, tus cambios no se pierden si otra persona editó al mismo tiempo, y le podés pedir a la IA que cambie cualquier bloque, imagen o el artefacto entero — y después quedártelo o deshacerlo. Mirá a la IA armar un artefacto nuevo en vivo, en su propia pestaña.
  - Guide: /everyone/your-workspace/
  - Guía: /es/everyone/your-workspace/
  - Integrators: publish answers `409 STALE_BASE` on a stale base. (#205, #226, #227, #230)
- **See where a page's numbers come from.** Every viewer gets a Data button that names each source.
  - es: **Mirá de dónde salen los números de un artefacto.** Cada persona que lo mira tiene un botón Datos que nombra cada fuente.
  - Guide: /guides/data-provenance/
  - Guía: /es/guides/data-provenance/
  - Integrators: `GET /v1/artifacts/{id}/sources`. (#238, #239)
- **Assistants edit pages in small steps and check them.** An assistant can change one part of a page without resending all of it, and check how it looks on a computer and a phone.
  - es: **Los asistentes editan artefactos de a poco y los revisan.** Un asistente puede cambiar una parte de un artefacto sin volver a mandarlo entero, y revisar cómo se ve en la computadora y en el celular.
  - Guide: /guides/publishing/
  - Guía: /es/guides/publishing/
  - Integrators: MCP `read_artifact`, `edit_artifact`, `verify_artifact`; `POST /v1/artifacts/{id}/edits`, `POST …/verify`. (#220, #221, #236)
- **Catalog: certified data you can trust, and metrics you can run.** Certify an entry so everyone knows it's checked, and try a metric right from the Catalog.
  - es: **Catálogo: datos certificados en los que confiar, y métricas que podés correr.** Certificá una entrada para que todos sepan que está revisada, y probá una métrica desde el Catálogo.
  - Guide: /teams/catalog/
  - Guía: /es/teams/catalog/
  - Integrators: (#223, #234)
- **Fixes.** Weekly AI crews no longer re-send the same email, scheduled jobs run again, and Knowledge search understands Spanish word forms better.
  - es: **Arreglos.** Las crews semanales de IA ya no reenvían el mismo email, las tareas programadas vuelven a correr, y la búsqueda de Knowledge entiende mejor las formas de las palabras en español.
  - Integrators: crews `skipped_already_sent`; self-host `KNOWLEDGE_EMBED_MODEL`, `KNOWLEDGE_VECTORS_READ`. (#222, #242, #243, #245, #246)

### 2026-10-25

- **Ask for edit access, like in Google Docs.** On a page you can only view, ask to edit; the owner gets an email every time and one click makes you an editor.
  - es: **Pedí permiso para editar, como en Google Docs.** En un artefacto que solo podés ver, pedí editar; al dueño le llega un email cada vez y con un clic te hace editor.
  - Guide: /everyone/collaborators/
  - Guía: /es/everyone/collaborators/
  - Integrators: `POST /v1/access-requests` `role: "editor"`. (#208)
- **A monthly AI budget for the whole workspace.** Admins set one monthly limit that covers all AI use, and when a limit is reached the message says which one and when it resets.
  - es: **Un presupuesto mensual de IA para todo el workspace.** Los admins ponen un solo límite mensual que cubre todo el uso de IA, y cuando se llega a un límite el mensaje dice cuál y cuándo se renueva.
  - Guide: /teams/admin/
  - Guía: /es/teams/admin/
  - Integrators: `GET /v1/workspaces/{id}/ai-limits`, `PUT …/llm/budget`; `429` with `limit`, `resets_at`. (#204, #207)
- **A clearer page panel and quick edit.** The panel groups the page's details, and quick edit lets you select any element.
  - es: **Un panel del artefacto y una edición rápida más claros.** El panel agrupa los detalles del artefacto, y la edición rápida te deja seleccionar cualquier elemento.
  - Integrators: (#205, #206, #209)

### 2026-10-24

- **More room for your page.** One header across the top, the chat no longer covers the page, and open tabs keep their names.
  - es: **Más lugar para tu artefacto.** Un solo encabezado arriba, el chat ya no tapa el artefacto, y las pestañas abiertas conservan su nombre.
  - Integrators: row `PATCH` accepts `{ changes }`; Markdown `?section=` scrolls. (#198, #199, #200, #201, #202, #203)

### 2026-10-22

- **Unsubscribe from one page's emails with one click.** Every email a page sends has its own unsubscribe link.
  - es: **Dejá de recibir los emails de un artefacto con un clic.** Cada email que manda un artefacto tiene su propio link para darse de baja.
  - Guide: /sdk/email/
  - Guía: /es/sdk/email/
  - Integrators: `List-Unsubscribe`; `GET /v1/data/{id}/email/optouts`; `skippedOptedOut`. (#196, #197)
- **Default skills for the whole team, and private skills stay private.** Admins pick up to five skills every member's assistant uses.
  - es: **Skills por defecto para todo el equipo, y los skills privados siguen privados.** Los admins eligen hasta cinco skills que usa el asistente de cada integrante.
  - Guide: /teams/skill-marketplace/
  - Guía: /es/teams/skill-marketplace/
  - Integrators: `GET|POST|DELETE /v1/workspaces/{id}/default-skills`. (#192, #194, #195)
- **See your workspace's AI spending by day.** Admin shows this month's spend, where it's heading by month-end, and a CSV.
  - es: **Mirá el gasto de IA de tu workspace por día.** Admin muestra lo gastado este mes, hacia dónde va a fin de mes, y un CSV.
  - Guide: /teams/admin/
  - Guía: /es/teams/admin/
  - Integrators: `GET /v1/workspaces/{id}/spend?month=YYYY-MM[&format=csv]`. (#178)
- **Pages can search what your team knows.** A members-only page can search the workspace's Knowledge, and AI crews can read workspace pages too.
  - es: **Los artefactos pueden buscar lo que sabe tu equipo.** Un artefacto solo para integrantes puede buscar en el Knowledge del workspace, y las crews de IA también pueden leer artefactos del workspace.
  - Guide: /sdk/knowledge/
  - Guía: /es/sdk/knowledge/
  - Integrators: `sdk.knowledge.search(q, { limit, full })`; `GET /v1/data/{id}/knowledge/search`; `full=1`. (#180, #182, #186, #191)
- **Fixes.** Private apps install on phones, "Present this" no longer fails when the AI's answer is cut off, and schedules say when a minute you picked runs on the hour.
  - es: **Arreglos.** Las apps privadas se instalan en el celular, "Presentar esto" ya no falla cuando la respuesta de la IA se corta, y las programaciones te avisan cuando el minuto que elegiste corre a la hora en punto.
  - Integrators: `POST /v1/jobs` `notice`. (#179, #181, #184, #185, #187, #188, #189, #193)

### 2026-10-21

- **Everything you upload becomes a page you can open and share.** Word, Excel, PDF, images and video become pages; a PDF becomes an editable page and a scanned one is turned into text. Converted PDFs show the text and the original side by side.
  - es: **Todo lo que subís se convierte en un artefacto que podés abrir y compartir.** Word, Excel, PDF, imágenes y videos se convierten en artefactos; un PDF se vuelve un artefacto editable y uno escaneado se pasa a texto. Los PDF convertidos muestran el texto y el original.
  - Guide: /everyone/assets/
  - Guía: /es/everyone/assets/
  - Integrators: `POST /v1/workspaces/{id}/assets/to-artifacts`. (#155, #156, #160, #162, #163, #164, #165)
- **Pages get a summary and tags by themselves.** Markdown and CSV pages (and PDFs) get an automatic short summary and tags.
  - es: **Los artefactos reciben un resumen y etiquetas solos.** Los artefactos en Markdown y CSV (y los PDF) reciben un resumen corto y etiquetas automáticos.
  - Integrators: (#172, #176)
- **A tidier workspace.** A Drive-style list of pages with folders first, tabs on their own row, and a cleaner Knowledge view.
  - es: **Un workspace más ordenado.** Una lista de artefactos al estilo Drive con las carpetas primero, las pestañas en su propia fila, y una vista de Knowledge más limpia.
  - Integrators: (#153, #159, #161, #167, #168, #171, #173)

### 2026-10-17

- **Sign in with Microsoft, your own domain, and guest access.** Sign in with a Microsoft account, serve the workspace on your own web address, and let a guest into a shared folder with an email code. Admins can import whole folders from Google Drive, OneDrive or SharePoint.
  - es: **Entrá con Microsoft, tu propio dominio y acceso para invitados.** Entrá con una cuenta de Microsoft, mostrá el workspace en tu propia dirección web, y dejá entrar a un invitado a una carpeta compartida con un código por email. Los admins pueden importar carpetas enteras de Google Drive, OneDrive o SharePoint.
  - Guide: /teams/custom-domain/
  - Guía: /es/teams/custom-domain/
  - Integrators: self-host `MICROSOFT_CLIENT_ID`, `CUSTOM_DOMAINS_CNAME_TARGET`, `GOOGLE_DRIVE_CLIENT_ID`, `MICROSOFT_FILES_CLIENT_ID`; `POST /v1/admin/workspaces/provision`. (#150)
- **Pages can use the tools your team already connected.** Admins add a remote MCP server; each member connects their own account, and members-only pages can use those tools.
  - es: **Los artefactos pueden usar las herramientas que tu equipo ya conectó.** Los admins suman un servidor MCP remoto; cada integrante conecta su propia cuenta, y los artefactos solo para integrantes pueden usar esas herramientas.
  - Guide: /sdk/mcp/
  - Guía: /es/sdk/mcp/
  - Integrators: `sdk.mcp`; `capabilities.mcp` on publish; MCP `publish_artifact` `mcp_connections`. (#148)
- **Stronger walls between workspaces.** A security review closed 34 findings so each workspace only ever sees its own data.
  - es: **Paredes más firmes entre workspaces.** Una revisión de seguridad cerró 34 hallazgos para que cada workspace vea solo sus propios datos.
  - Integrators: Agent (`sot_`) tokens work only on artifact, publish, data and support routes (`403 INSUFFICIENT_SCOPE`). (#149)

### 2026-10-16

- **Guests can comment without an account.** Turn on guest comments for a shared folder; you hear about reviews and when someone first opens what you shared.
  - es: **Los invitados pueden comentar sin cuenta.** Activá los comentarios de invitados en una carpeta compartida; te avisamos de las revisiones y de cuándo alguien abre por primera vez lo que compartiste.
  - Guide: /everyone/review/
  - Guía: /es/everyone/review/
  - Integrators: (#131, #133)
- **Search shows results as you type.** ⌘K shows results right away, deeper results below, and your recent searches.
  - es: **La búsqueda muestra resultados mientras escribís.** ⌘K muestra resultados enseguida, resultados más profundos abajo, y tus búsquedas recientes.
  - Integrators: (#145)
- **Assistants can publish a site of several pages, and Telegram links open.** Old Word (.doc) files are read too.
  - es: **Los asistentes pueden publicar un sitio de varias secciones, y los links de Telegram se abren.** También se leen los Word viejos (.doc).
  - Guide: /guides/multi-page/
  - Guía: /es/guides/multi-page/
  - Integrators: MCP `publish_artifact` / `update_artifact` `files`; `400 INVALID_PATH`; `access_policy.queries`; `POST …/knowledge/reindex`; self-host `D1_READ_REPLICAS`. (#124, #125, #127, #129, #132, #136, #138, #140, #146)

## [Unreleased]

### Deprecated

- **Google Drive folder import through the `drive.readonly` OAuth consent:** hidden in the import window when `GOOGLE_DRIVE_SA_KEY` is set; existing sources keep syncing and can switch to sharing. `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` stay for the spreadsheet sync (`drive.file` + Picker).

### Removed

- **Artifact templates:** the Templates lens, "Save as template", `/v1/artifact-templates`, the `list_templates` / `install_template` / `save_as_template` MCP tools and the provisioning `templates` step are gone. Migration 0022's tables stay (additive-only schema) and are no longer read or written.

### Security

- **Backfilled 2026-11-18:** page metadata is escaped in the shell, quick-edit frames run no scripts and the create preview is sandboxed (#218); capture renders use narrower credentials and never reach private networks (#241).

- **Tenant isolation hardening:** workspace Agent and external (`sot_`) tokens are accepted only by the artifact, publish, data and support routes that enforce their workspace and scopes (`403 INSUFFICIENT_SCOPE` elsewhere); session cookies accept only session-shaped tokens and honour the disabled flag on the data plane too; admin-issued member tokens are limited to service accounts, and revoking tokens also revokes connected-app (MCP) grants; `POST /v1/auth/link-email` now requires the verification-code flow; connector OAuth `state` is signed and bound to the installing admin (artifact-level installs to the owner); per-table write roles in the page's `shareout/manifest` are enforced (an unreadable declaration allows only the owner); external members, disabled and disabled-linked accounts no longer count as internal on home, search, skill context, trash, inbox, Telegram/Slack links, scheduled jobs and crew runs; file, collection and deliverable actions are scoped to the caller's bucket; moving an artifact needs its owner, an editor or a workspace admin; viewers' Slack DMs go only to their own linked account; caches for connector results, service-account tokens, Snowflake JWTs, grants and idempotent publishes are keyed per tenant and caller; closed artifact bytes are `private, no-store` on every origin and artifact documents served on the app origin are sandboxed; anonymous abuse reports apply only to public artifacts; the email-events webhook requires its secret. New guard tests require every route and MCP tool to refuse anonymous/foreign callers or carry an explicit public reason.

- **Data Platform row-level scope is enforced structurally (skill v2.58.0):** under an `access_policy`, a scoped viewer can no longer send SQL to a platform connector. They run a query the author declares in the new `access_policy.queries` (`{ connection, provider, endpoint, params }`) by name (`execute(endpoint, { query: '<name>' })`); the server binds the viewer's values into `:viewer_scope` — counted only in SQL code, never in comments or quoted text — or, when the SQL has no placeholder, wraps it as `SELECT * FROM (<sql>) AS so_scoped WHERE so_scoped.<field> IN (…)`. Declared SQL must be one statement (checked when the policy is saved); anything that cannot be scoped returns `403 SCOPE_REQUIRED`. Scoped viewers are also refused on generic `sdk.connection()` query/materialize/test and on the chat `run_data_source` tool. **Breaking for authors:** pages whose viewers sent `:viewer_scope` SQL directly must declare those queries and call them by name.

### Fixed

- **Backfilled 2026-11-18 — fixes that shipped without an entry:** long Snowflake statements keep polling until their own timeout (#282); page views are recorded under any deployment prefix (#289); links on a workspace's own host drop `?workspace=` (#298); Knowledge learns a page again when it goes from private to shared (#299); cron jobs run again after the cutover (#246); weekly crews stop re-sending (12-hour same-subject guard, `skipped_already_sent`, a "sent by" footer) and busy event runs queue instead of dropping (#189, #198, #245); Knowledge forgets passages of removed sources and drops blank spreadsheet cells, and "Learn from existing pages" drains the whole queue (#166, #169, #177); imported files reach Knowledge and search (#165); originals with spaces download again (#163); private PWAs install (#184); *Present this* no longer 502s on cut-off output (#185); the visual editor's publish keeps the whole bundle (#209); row `PATCH` accepts `{ changes }`, Markdown `?section=` scrolls (#203); Knowledge search isn't starved by others' private documents (#243); the knowledge overview is owner/admin-only and notes citing private or trashed pages are withheld (#228); metric alerts follow the page's row policy and Markdown links are safe (#232); the SDK is served as a static asset, yjs loads on demand and realtime `connect()` works in browsers (#217).

- **Gmail forwarding confirmations (#321):** over the cap of 3 per page, requesters not on the page's sender list are dropped first (oldest first), so a stranger's requests can't push out the page's own; `GET /v1/artifacts/{id}/email-sync` → `forwarding` lists the page's own people first, then newest, and the headline names the first; the panel shows every pending request with the main Confirm only on a listed requester's (a stranger's gets a plain button and a warning). The requester is now found among every address except the page's own and Google's, so on an instance receiving on its company domain a requester on that domain (ana@acme.com) is recognised instead of bounced.
- **Update by email (`email_sheet_sync`) after its end-to-end test:** the dataset defaults to the one the live page reads (`GET /v1/artifacts/{id}/email-sync` → `reads`, `suggestedDataset`, `job.datasetReadByPage`), and every surface warns when the page doesn't read it — before, a page reading another name stayed empty with no error. `POST /v1/data/{id}/inbox/disable` is refused (`409 EMAIL_SYNC_ACTIVE`) while the page updates by email; a second identical job is `409 DUPLICATE_JOB` with the existing `job_id`; `POST /v1/jobs/{id}/run` answers `409 NOT_RUNNABLE` with the address instead of recording a failed run; `verify_artifact` notes a page waiting for its first file instead of failing it, and `sdk.dataset(name).get()` returns `[]` for a dataset not created yet. The status gains `state`, a one-line `message`, `lastRejected` (the last bounced email and why) and `limits`; `GET …/email-sync/senders` is allowed and `PUT` takes one address as a string; `POST /v1/jobs` answers with `address`, `senders` and a `warning`; deleting the job keeps the sender list (`senders_kept`). MCP `set_email_sync` takes a page link or slug, refuses unknown arguments by name, asks before replacing data the page already has (`replace_existing`) and says when nothing changed. Skill and docs: page snippet, limits, INDEX row, three ways in for spreadsheet sync.
- **Skill: credentials from env:** the skill and auth docs now say `SHAREOUT_TOKEN` / `SHAREOUT_ORIGIN` in the environment are a valid setup on their own, so an agent without `~/.shareout/credentials` publishes instead of stopping.
- **Skill version follows content:** `/v1/skill/version`, `X-Skill-Version` and the `/v1/skill` ETag are `<frontmatter version>+<sha8 of skill.zip>`, so agents refresh on any skill change, not only on a hand-bumped version; `/v1/skill/version` and `/v1/skill/meta` also return the bare `semver`. A stale R2 skill sync no longer shadows a newer deployed skill: the instance serves whichever copy is newer. Clients comparing semver are unaffected (build metadata); a cached bare-semver ETag gets one `200`, then `304`s. See `skills/README.md`.
- **Email without an `EMAIL` binding:** `POST /v1/data/{id}/email/notify-owner` and `/email/send-report` answer `503 EMAIL_UNAVAILABLE` with a hint and suggestion instead of `500 CONFIG_ERROR`. The other mail paths (sign-in codes, invites, notifications, scheduled deliveries, crew tools) already degrade without the binding.
- **SDK errors and control-plane calls:** `e instanceof ShareOutError` no longer throws `ReferenceError` in artifacts — the script-tag bundle exposes `ShareOutError` / `ConsentRequiredError` as globals and as statics on `ShareOut` (`ShareOut.ShareOutError`, also `ShareOut.McpError`). `sdk.lib(name)` and `sdk.crew.usage()` return the route's bare JSON body instead of `undefined`. `ShareOutError` carries the envelope's `requestId` and `reason`.
- **Export zip-slip + `.doc` text boxes:** artifact/workspace export normalizes stored source paths (backslashes → `/`, no empty/`.`/`..` segments, no leading `/`, control or Windows-reserved characters/names, length caps; collisions `~2`, `~3`…) so no entry escapes `source/`; safe paths are byte-identical, and a `RENAMED.txt` lists any rewrite. The legacy `.doc` reader now reads every story in CP order (main, footnotes, headers/footers, annotations, endnotes, text boxes, header text boxes), so forms whose body is only shapes anchoring text boxes extract; a body that is only pictures/drawings fails with "Document has no extractable text (images/drawings only)" instead of "No text found".

### Added

- **Update by email: automatic forwarding from Gmail and Outlook.** Gmail emails a page's address a confirmation before it auto-forwards there; that mail was bounced, so nobody saw the link. A genuine one (Cloudflare shows DKIM and DMARC pass for google.com, exactly one From `forwarding-noreply@google.com`, its signed To is the page's address, its link https on Google's own host with the `/mail/vf-` path) is now kept — never as mail or data — and shown to the page's editors as one step ("Gmail wants to confirm forwarding from ana@… → Confirm", then whose report it is), in `GET /v1/artifacts/{id}/email-sync` → `forwarding` and in `check_email_sync` with the link to hand over; `POST …/email-sync/forwarding/{id}` marks it opened or closes it. Up to 3 per page, one per requesting mailbox, 7 days (migration 0047). Today's confirmations carry no code; older ones' code is kept. Outlook / Microsoft 365 has no confirmation step. A report auto-forwarded by an allowed mailbox (Cloudflare's SPF pass for a Gmail `+caf_=` or Microsoft `+SRS=` envelope) whose verified sender is not on the list is still bounced, and is offered to the editors as one tap that adds exactly that sender (`recentRejected[].canAllow`); unauthenticated forwarding headers are never read. The panel, docs (en/es), skill and MCP text gain "Let the report arrive by itself": three steps for Gmail, three for Outlook, and the company forwarding block in plain words. The page now keeps its 5 most recent bounces (`recentRejected`, migration 0046) instead of only the last, and a bounce after a failed file shows in the headline too.
- **New → Table from an Excel file, a short inbox address, a bounce people can act on:** `POST /v1/home/new` `{ template: "table", file }` reads the first tab of an `.xlsx` or `.csv` (8 MB, 100,000 rows, first row = column titles) into a private page that shows it as a table (search, 200 rows at a time, rows as cards under 640 px), then offers the three ways to keep it updated; a file it can't use is refused before anything is created, with one sentence and *Pick another file*. Every page inbox also gets a short address — the slug's first word, a dot and 6 characters (`ventas.k7m4p2@…`, migration 0045, never reused) — shown in the panel, `GET /v1/artifacts/{id}/email-sync`, the MCP tools and the docs; long addresses keep working. A sender who isn't allowed or can't be verified gets one plain sentence: ask the page's owner to add your address, then send it again.
- **Update a page's data by email (`email_sheet_sync`):** an Excel (`.xlsx`) or CSV emailed (or auto-forwarded) to the page's own address by an allowed, verified sender replaces one of its datasets — no Google account, no sign-in. Automate → *Update the data* → *By emailing the Excel*; `PUT /v1/artifacts/{id}/email-sync/senders`, `GET /v1/artifacts/{id}/email-sync`, `POST /v1/jobs` with `trigger_type: event`, `event_type: email.received`; MCP `set_email_sync` and `check_email_sync`. A file that can't be used keeps the previous data and emails the owner why. Limits: 8 MB and 100,000 rows per file, 25 MB per email, 200 emails a day per page.
- **Assistants can set up spreadsheet syncs:** the MCP connector gets `inspect_sheet_link`, `pick_drive_spreadsheet`, `set_sheet_sync` and `remove_sheet_sync`, and the skill a guided page (`integrations/spreadsheet-sync.md`) plus `public_sheet_sync` / `drive_file_sync` in `api/jobs.md` (skill 2.68.0). Defaults are picked (first tab, daily 08:00, dataset named after the file), the first load runs at once and reports the row count, and a new sync whose first load fails is removed again. For a private Drive file the assistant hands over the pick link: opened in the person's own browser it signs them in if needed, Google's consent + Picker stays their click, the last page (English or Spanish) sends them back to the conversation, and `GET /v1/workspaces/{ws}/file-imports/sheet-sync` now returns `picked` (migration 0043) so the assistant can finish. OpenAPI lists every job action (a test keeps it equal to `JOB_ACTIONS`), the two sync configs and `POST /v1/workspaces/{ws}/sheet-links/inspect`.

- **Google Drive import by sharing:** with `GOOGLE_DRIVE_SA_KEY` set, a workspace shares a Drive folder with its own Google service-account email (Viewer) instead of granting the restricted `drive.readonly` OAuth consent — no Google verification, no 100-user cap, and files added later come over on the next sync. One account per workspace, so Google's own ACLs keep workspaces apart; a workspace that cannot get one (the project's service-account limit) gets `SHARE_EMAIL_LIMIT`, never a shared account. `POST /v1/workspaces/{ws}/file-imports/share/google_drive`, `browse?link=`, `PATCH …/sources/{id} { access: 'share' }`. Migration 0042. Design: `shareout-app/docs/google-drive-service-account.md`.

- **Sync a dataset from a shared Google link (`public_sheet_sync`):** paste the share link of a Google Sheet, or an Excel file in Drive, set as "Anyone with the link can view", and one tab is copied into a page dataset on a schedule — no Google sign-in, no Drive scope. Automate → *Update the data* → *From a link* warns that anyone with the link can read the file. ShareOut keeps only the file id, builds Google's export URL itself and fetches only from Google's hosts (https, at most 5 checked redirects, 8 MB, 30 s, 100,000 rows); a run with unchanged rows writes nothing and a failed run keeps the last good data. `POST /v1/workspaces/{ws}/sheet-links/inspect` checks a link before saving (internal members, 60 an hour per user).
- **Sync a dataset from a Google Drive spreadsheet (`drive_file_sync`):** Automate → *Update the data* → *From Google Drive* copies one tab of an Excel / Google Sheets / OpenDocument / CSV file into a page dataset on the schedule the editor picks (default every day at 08:00) and runs once on save. An unchanged file costs one metadata call. The dataset's `source` metadata carries a hash, never the Drive file id. Since #309 it reads through its own `drive.file` consent and the Google Picker.

- **Knowledge graph editing over MCP:** six connector tools give owners and admins the same hand on the graph from Claude, ChatGPT or any MCP client: `knowledge_edit_entity` (create, rename, retype, confirm, discard, merge), `knowledge_edit_connection`, `knowledge_edit_fact`, `knowledge_edit_rules` (rules, glossary, types, team-types-only, restore), plus read-only `knowledge_rules` and `knowledge_review` (proposals, discarded, history). They take names as people say them, change nothing for members, and need an exact name or id to discard, merge or disconnect. `knowledge_entity` now says what the team confirmed. The curation routes are in the OpenAPI spec, the skill and the Knowledge docs.
- **Knowledge — the team curates the graph:** owners and admins confirm, rename, retype, merge and discard entities, add or remove connections and facts, from the Knowledge map (drag a node's + to connect, drop a node on another to merge, double-click to create) or `/v1/workspaces/{id}/knowledge/{entities,relations,facts}`. Confirmed knowledge is drawn solid, proposals dashed, and every member sees it. A new **Rules** view (`/knowledge/{schema,rules,discarded}`) holds the team's types (on/off, team-only), glossary and plain-language rules. The learner reads all of it before every batch: confirmed items survive re-learns, discarded ones never come back, merged or renamed names land on the entity the team kept, ignored types are skipped, and a learned fact that differs from the team's shows next to it instead of replacing it. History per entity at `/knowledge/history`.
- **Claude plugin:** the repo is a Claude plugin marketplace (`.claude-plugin/marketplace.json`, name `getshareout`) that lists one plugin, `shareout`, rooted at `skills/`: the connector (`https://shareout.site/mcp`) plus the ShareOut skill. Install with `/plugin marketplace add getshareout/shareout` then `/plugin install shareout@getshareout`. The skill now says to use the connector's tools when they are present (no origin or token needed), `mcp-connector.md` documents `knowledge_reindex`, and `npm run check:claude-plugin` (pre-push) fails when the plugin and skill versions differ or an MCP tool is missing from that doc.
- **Invoice delivery:** the operator uploads the invoice they made in their own tax system and the rest runs by itself. **New invoice from a PDF** in Admin → Billing (`POST /v1/workspaces/{ws}/invoices/from-document`, the document as the body) creates a one-line invoice with the number as printed (free text: letters, digits, spaces, `. _ / - #`), currency, total, optional period and due date, and the PDF attached as its document — the existing receipt slot, now labelled *Invoice document*. Issuing (from either create form, or a draft) emails it: to the billing profile's `billing_email`, else to the workspace's internal owners and admins, never to a suppressed address, with the document attached, number, total, due date, how to pay and a link to Admin → Billing; the operator sees the exact recipients next to a *send email* checkbox (on by default) and can **Resend email** (`POST …/invoices/{id}/send`). Invoice mail is transactional — `LIFECYCLE_EMAILS_DISABLED` and the nurture flag do not stop it — and is logged in `email_sends` (`source_kind` `invoice`). A workspace owner/admin attaching the transfer proof marks the invoice paid and emails the instance admins with the proof; so does a reply to the invoice email (`invoice+<token>@<inbox domain>`, one unguessable address per invoice) that passes DMARC, comes from the billing email or an internal owner/admin and carries a PDF/PNG/JPG/WEBP up to 10 MB. Any other reply changes nothing and the instance admins get a note to review it, without its attachments; out-of-office replies are dropped. `paid_source` (`operator` / `proof` / `email`) says what marked it paid, **Mark unpaid** still undoes it, and every step is in the audit log (`invoice.email`, `invoice.paid` with its source). Agent tokens can never issue, send or mark paid. Migration 0041 (`emailed_at`, `emailed_to`, `paid_source`, `reply_token` on `workspace_invoices`). The inbox prefixes `invoice` and `support` are never handed to an artifact. Copy en/es; self-host docs: Email → Invoice mail.
- **Humand connector (read-only):** new `humand` platform connector under a new **People & HR** catalog group. Admins paste the community's Humand API key (with or without the `Basic ` prefix), **Test** calls `GET /users/me`. Pages read 43 GET endpoints — users, segmentations, departments, job positions, time off, time tracking, shifts, courses, forms answers, goals, knowledge libraries, service management — through `sdk.platform.execute('humand', …)`, paged by `page`/`limit`. Humand's write endpoints, chats and API-key endpoints are not exposed; `executeRequest` refuses non-GET or unlisted paths and dot-segment path params. New `read_connector` tool for the workspace assistant (web, Telegram, Slack) and the MCP connector: with **AI** switched on for the connector, any internal member can list what an app connector can read and read one endpoint (`total`, `next_page`, answers capped at ~50 KB by trimming the longest list); `list_connections` adds `readable`. Only `humand` is readable today; only GET endpoints are callable. Docs: skill `integrations/humand.md` and `mcp-connector.md`, docs-site page (en + es).
- **Paginated PDFs on report emails:** an email job with `renderPdf: true` can set `pdfFormat` (`A4` / `Letter` / `Legal`, plus `pdfLandscape`) to attach a PDF printed in pages with the page's own `@media print` CSS, where a `@page` size and margins win. Without it the attachment stays one continuous page of the screen layout. An unknown `pdfFormat` is refused when the job is saved. Continuous PDFs (report emails, Slack, Telegram) now ignore a page's `@page` size, which used to shrink them to a centered A4-wide column cut off after the first sheet.
- **One-time view (link + personal code):** `POST /v1/artifacts/{id}/view-codes` gives each named person their own code; the link plus that code opens the page once, with no sign-in, for `view_seconds` (default 90), then it closes by itself with no countdown and the code never works again. The viewer sees their name and the time across the page; copy, selection, right-click, print, save, download, the toolbar and the assistant are off, the frame URL refuses to open as a tab, and the page blurs when it loses the screen. `GET` lists who opened it, when, on what device and what they tried; `DELETE …/{codeId}` revokes one code, `DELETE` turns it off. Migration 0036. Skill: `team/one-time-view.md`. A browser cannot block a screenshot or a photo of the screen — the watermark is what names the person.
- **One-time view link preview:** an owner can turn on a link preview for a one-time page (`preview` on `PUT /v1/artifacts/{id}/view-codes/gate`) and upload its cover (`PUT …/view-codes/gate/image`, public at `/vg/…`). With it on, the code page answers 200 with Open Graph tags made of the gate's title, message and cover, so WhatsApp, Slack and iMessage draw a card. Off by default; nothing of the page itself is in it. Migration 0038.
- **One-time view, your look:** the code page carries the workspace's logo, name and color (and drops "Powered by ShareOut" when the workspace hides the footer), and the page's own title, message and button — `PUT /v1/artifacts/{id}/view-codes/gate` or `gate` on create (migration 0037, `artifact_view_gates`). The closing screen shows the workspace logo too. The watermark is much fainter and more spaced, and its date follows the page language.
- **One-time view, closing and tracking:** the page closes with a thank-you ("Thanks for reading" / "¡Gracias por leerlo!") instead of a bare "no longer available". The owner or a collaborator who opens a one-time page signed in sees a notice that their view is not locked (recipients see it locked). Each opened code now records the browser and system and Cloudflare's approximate city, region and country — never the IP (migration 0037). A reused code says "this access was already used — if it wasn't you, tell whoever sent it".
- **One-time view personal links:** each created code now comes with its own `link` (`…/#code=K7M4-QP9X`). Opening it fills the code in, so the person only taps Open — nothing to type. The code rides the URL fragment, which never reaches a server, and nothing is spent until the tap, so link previews cannot use it up.

- **Executable catalog metrics:** a `kind: metric` catalog entry can carry a spec (source — a connection table or SELECT, or a workspace shared table — measure or numerator/denominator, time grains, dimensions, fixed filters, format, scope field, freshness SLA), validated on write with a "did you mean" for unknown keys. ShareOut compiles it to one read-only query for BigQuery, Snowflake, the Postgres family or a shared table (MiniDB) and runs it: `GET /v1/workspaces/{id}/catalog/metrics`, `GET …/metrics/{id}`, `POST …/metrics/{id}/query`, `GET …/metrics/{id}/explain`. Every answer carries its status, who certified it, the spec hash, source and freshness. Certified metrics run for every internal member; drafts for owners/admins and their author (or anyone when the data is already open). New `catalog_metrics` index (migration 0031). Catalog lens: a metrics view (status, owner, source, freshness) and a Try it panel with numbers in the reader's language.
- **Catalog certification you can verify:** owners and admins, signed in to ShareOut, certify, revoke or deprecate one exact version of a catalog entry (Certify entry / Revoke certification / Mark deprecated in the Catalog lens, with a note; `POST /v1/workspaces/{id}/catalog/entries/{entryId}/certify` accepts only a signed-in session — tokens get `403 SESSION_REQUIRED`, so agents draft and people certify). Decisions are append-only (`catalog_certifications`, migration 0030) and every read — REST, lens, manifest KPIs, `catalog_search` / `catalog_get` — shows who certified an entry and when. Editing a certified entry shows "changed since certification" until it is certified again; a metric is pinned to its spec, so prose edits keep it.
- **Verify:** `POST /v1/artifacts/{id}/verify` (MCP: `verify_artifact`) opens a published page the way its viewers get it — on its content origin, with no app session, the viewer sandbox's storage `SecurityError`s and the viewer's CSP enforced — on a 1280×800 desktop and a 390×844 phone, and reports script errors with `file:line:col`, failed requests (with the API `code`/`hint`), blocked CDNs, axe-core accessibility results, horizontal overflow, small tap targets, broken images, blank screens, design lint, LCP/CLS/bytes and source mistakes (root-relative paths, `localStorage`, `alert()`, raw `/v1/data` fetches, `new ShareOut()`), with a screenshot of each view. `GET …/verify/latest` returns the last run. The phone view renders a page's mobile entrypoint when it has one, and a pinned `version` renders entirely from that version's files. Owners and editors only; 30 runs per user per hour (`VERIFY_RUNS_PER_HOUR`); `partial` (source checks only) without a Browser Rendering binding. Verifying the live version over REST refreshes the thumbnail; the MCP tool is read-only. Purging an artifact deletes its verify results. `axe-core` joins the built-in `/vendor` allowlist.
- **Sign in with Microsoft** (personal and work/school accounts, Microsoft identity platform v2.0): button on `/auth/login` and on private-page sign-in when `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` are set; `MICROSOFT_TENANT` = `common` (default) / `organizations` / `consumers` / a tenant GUID. Authorization code + PKCE, nonce and state in a signed zone-wide cookie, subdomain return, CLI device-login hand-off. ID tokens are verified against Microsoft's JWKS (signature, the `{tenantid}` issuer resolved from a GUID `tid`, the signing key's own issuer, audience, `exp`/`nbf`, nonce). Email trust follows Microsoft's guidance: personal accounts use `email` (or an email-shaped `preferred_username`); work/school accounts need the `xms_edov` optional claim, never `preferred_username`. Accounts are keyed by `tid:oid` (migration `0019`, `users.microsoft_id`), an existing account is linked by verified email once, a different Microsoft identity for the same address is refused, disabled users are refused, and enforced workspace-SSO domains are sent to their IdP. Setup: self-host secrets page and skill `deploy/cloudflare.md`.
- **Workspace SSO with Microsoft Entra ID:** issuers on `login.microsoftonline.com` must be the tenant-specific v2.0 issuer (`common` / `organizations` / `consumers` / domain-name tenants are refused on save); Entra sign-ins need `xms_edov` = true before the email-domain check; JWKS key `issuer` scoping and `nbf` are now enforced for every OIDC IdP. New docs page **Teams → Workspace SSO** (en/es) with the Entra app-registration guide; skill `team/sso.md` (skill v2.60.0).
- **Guest access to a shared space (no account):** share a folder with **Guest access — no account needed** (`share-person` with `"guest": true`) and the person opens it from an emailed link, or on any device with an email code at `/shared?folder=<id>` — no user row, no membership, no password, no workspace picker. The grant is the identity (`subject_type: guest`, the email); the session is an HMAC token bound to workspace, grant, folder and email hash in an HttpOnly, Secure, SameSite=Lax cookie, re-checked against the live grant on every request, so revoking, expiry or deleting the folder ends it immediately. A guest reaches only that folder's subtree up to view or comment (pages, non-private files, comments as the same verified identity) — never `/home`, search, members, the agent or MCP — under the workspace's branding. Guests show in the access panel and in **Who opened what**. Codes reuse the guest-comment limits (30 s resend, 6/hour per address, 5 attempts, per-IP caps). No migration. Copy en/es.
- **Import folders from Google Drive, OneDrive and SharePoint:** New → *Import from Drive / OneDrive / SharePoint* connects a drive with a read-only consent that is separate from sign-in (Google `drive.readonly`; Microsoft Graph delegated `Files.Read.All`, `Sites.Read.All`, `User.Read`, `offline_access`), per member and workspace, tokens AES-GCM encrypted with `CREDENTIALS_KEY`, HMAC-signed state + PKCE, never returned to clients. Pick a folder (My Drive, Shared with me, shared drives; OneDrive, followed or searched SharePoint sites → library → folder) and a target folder: the run walks the tree (≤ 10,000 files / 2,000 folders / 20 levels), mirrors subfolders as Team Space folders, exports Google Docs/Sheets/Slides to docx/xlsx/pptx and Drawings to PDF, stores files through the normal blob path (large files stream to R2) under the workspace storage and per-file caps — a full store stops the run cleanly with a message — turns Word/Excel/PDF/Markdown/CSV into pages next to the file, and feeds Knowledge. `file_import_items` maps every remote id to its ShareOut file/page, so **Sync again** and the optional **daily sync** (hourly cron, ≤ 10 per tick and per workspace) only fetch changed files (Drive `modifiedTime`, Graph `cTag`) and add versions. Throttling is retried with Retry-After / exponential backoff. Only owners, admins and members who may create folders can import; disconnecting stops every sync through that connection. Durable `FileImportWorkflow` (`FILE_IMPORT` binding; inline fallback). Hidden until `GOOGLE_DRIVE_CLIENT_ID`/`_SECRET` or `MICROSOFT_FILES_CLIENT_ID`/`_SECRET` are set. API under `/v1/workspaces/{ws}/file-imports` (OpenAPI tag *File imports*). Migration `0021` (`file_import_connections`, `file_import_sources`, `file_import_runs`, `file_import_items`). Copy en/es.
- **Instant search in the ⌘K palette + recent searches:** pages, folders, people, actions and lenses now rank in the browser from a compact search index (`GET /v1/home/search-index`, same visibility as `/v1/search`, weak `ETag` → `304`, `Server-Timing` `idx_build` / `idx_etag`; 250 pages ≈ 47 KB JSON), kept in memory and IndexedDB per user and workspace and revalidated in the background, so results paint on the first keystroke with no request (3,000 items rank in under 1 ms median). Prefix > word start > substring > typo-tolerant subsequence, case- and accent-insensitive, recency as a small boost. Page text, Knowledge passages, data, schedules, crew, alerts and AI skills come from `GET /v1/home/deep-search` as a second section (debounced 150 ms, stale requests aborted). An empty palette shows the last 8 searches (remembered on a pick or Enter, never per keystroke; × removes one, **Clear** empties) and recently opened pages; they sync through `GET/POST/DELETE /v1/home/recent-searches` (max 20 per user and workspace). Migration `0017` (`user_recent_searches`). Copy en/es
- **One-step workspace provisioning:** `POST /v1/admin/workspaces/provision` (instance admins only), the **Provision a workspace** form in `/admin` → Instance, and `scripts/provision-workspace.mjs` (JSON/YAML spec, `${ENV_VAR}` secrets, `logo_file`; example in `scripts/provision-workspace.example.yaml`) create a customer workspace with slug/subdomain and locale, branding, policy defaults and feature flags, starter folders, admin invites and encrypted connectors in one call. Idempotent by slug, per-step results with `207` on partial failure, one audit row per step, credentials never echoed; `custom_domain` attaches the hostname, `pending` until its DNS verifies.
- **Workspace custom domains:** a workspace can serve on hostnames its customer owns (`portal.acme.example`) as a full mirror of its subdomain. New `workspace_domains` table (migration `0020`; hostname normalized to lowercase/punycode and globally unique; `pending` → `active` → `failed`; one `is_primary`). `GET/POST /v1/workspaces/{id}/domains`, `POST …/{domainId}/refresh`, `PATCH …/{domainId}` `{ primary }`, `DELETE …/{domainId}` — owners/admins only — plus **Admin → Custom domain** with the CNAME/TXT records, status refresh, primary and remove, and `provisionWorkspaceDomain()` for server-side provisioning. Provisioned through Cloudflare for SaaS custom hostnames when `CF_CUSTOM_HOSTNAMES_TOKEN` + `CF_CUSTOM_HOSTNAMES_ZONE_ID` are set (Cloudflare verifies and issues HTTPS); otherwise manual mode verifies a `_shareout-verify.<host>` TXT record. The feature is off until `CUSTOM_DOMAINS_CNAME_TARGET` (or the Cloudflare pair) is set; when on, only active hostnames route (positive-only host cache keyed by hostname) and every other foreign host gets the 404. An active hostname cannot move to another workspace; unverified claims expire after 7 days; removal (and workspace deletion) takes the hostname off Cloudflare first. Sign-in on a custom domain hands off from the apex with a one-time, host-bound, 60-second code and a host-only session cookie. Share links, publish URLs, artifact `url`, invite landings and inbox emails use the primary custom domain; serving on a custom domain uses it for the viewer's API origin, artifact CSP and CORS.
- **Section links for headings without ids + legacy Word `.doc`:** headings with no `id` now get a deterministic `h-` anchor (accent-folded, hyphenated text slug, `-2`/`-3` per page) at chunk time, and the injected page agent resolves it inside the content frame (real ids still win), scrolls there and briefly highlights it. `CHUNKER_VERSION` is 2, so the nightly pass re-learns existing sources. `.doc` (Word 97–2003, `application/msword`) is read in-Worker — SheetJS CFB + an own piece-table text reader, up to 8 MB, main body text only — for Knowledge and for Studio import (→ Markdown, original kept); Word 6/95, protected or damaged files are `unsupported` / `CONVERT_FAILED` with a clear reason.
- **Knowledge reindex + per-source status:** `POST /v1/workspaces/{id}/knowledge/reindex` (owner/admin or instance admin; optional `{ artifactIds }`) re-learns live, non-held pages and Files even at an unchanged version, through the normal Workflow / inline ingest and metering; once per workspace per 10 minutes, up to 300 per call. `GET …/knowledge/status` gains `corpus` — per source `status`, indexed `version`, `chunker_version`, chunk counts with `page` / `anchor`, last `error` (members see only sources they may open). Each source records its `chunker_version`; the 03:00 UTC knowledge pass re-learns sources from an older chunker and retries `failed` ones with backoff (10 per workspace, 60 per night). MCP `knowledge_reindex` (with `check_only`)
- **Guest comments without an account:** owners turn guests on per artifact (`_config.guestComments`) or per folder (`PUT /v1/workspaces/{wid}/folders/{fid}/guest-comments`, MCP `set_guest_comments`); a viewer of a public or unlocked password page confirms an email code and comments or replies as a guest (artifact-bound HMAC cookie, keyed email hash only, Origin-checked writes, per-IP and per-guest limits, no resolve/assign/react/approve); viewer toolbar **Comment as guest** (en/es). Migration `0016`
- **Review and sharing notifications** (feed + email + Telegram, under the product email preference, never to the actor): version approved → owner (once per approver per version); an outside person's first open in a shared folder → whoever shared it (once per person per folder per day); new versions → followers and collaborators with each version's note, debounced into one notice per artifact after 10 quiet minutes; a new folder shared with an existing external member → email linking `/shared?folder=<id>`
- **Telegram bot: links that open, section citations, review parity.** Every page link in bot replies is absolute (`/a/{slug}/`, `?page=` for a sub-page, `&section=` for a heading) and sent as plain text; list/search/read tools return the `url`. The sign-in gate now lands on the exact gated URL. Opt-in one-tap sign-in (`TELEGRAM_LOGIN_LINKS=1` + BotFather `/setdomain`): Telegram `login_url` buttons bound to the linked member and the page, single-use, never a bearer link. New `find_passages` tool answers "where is X covered?" with artifact, sub-page, section heading, excerpt and deep link — from the Knowledge corpus (now chunked by section across every HTML page of a multi-page site, with heading ids) or a bounded live scan. Chat agent (Telegram, Slack, web home) gains `list_versions`, `list_comments` and confirm-gated `restore_version`, `approve_version`, `resolve_comment`, `assign_comment`
- **API / skill / MCP parity for the 2026-10-16 releases (skill v2.57.0):**
  - OpenAPI: version list / source / restore, data-API comments (list, resolve, assign, `versionId`), `GET /v1/home/review` + `POST /v1/home/approvals`, `Grant.expires_at`, folder-manager grant rules, `/v1/jobs` visibility
  - Skill: multi-page sites, review mode, folder access / expiring shares / client portal, knowledge source links and reverse lookup, Server-Timing
  - MCP tools: `list_versions`, `get_version_source`, `restore_version`, `list_comments`, `resolve_comment`, `assign_comment`, `approve_version`, `list_jobs`, `folder_access`, `folder_activity`, `share_with_person`, `revoke_share`, `knowledge_get`, `knowledge_from_artifact`; `publish_artifact` takes `message`; `get_artifact` names the live change note and a site's pages
  - Folder access is truthful: the pill, `folder_access` and the docs report the real audience (the most open of the folder setting, its grants and the non-deleted artifacts and files inside, which keep their own visibility); managers get the over-open items by name, other members the counts. Folder managers' shares now run the external-sharing entitlement (`collab.external_sharing`, `requireExternalSharingEnabled`) and the workspace's allowed email domains like admins'; listing and revoking stay open
  - MCP: `publish_artifact` / `update_artifact` take `files: [{ path, content, encoding? }]` for multi-page sites (same `/v1/publish` validation, limits, quota and moderation; the result links each page with `?page=`)
- Agent **deploy skill** (`skills/ShareOutSkill/deploy/`) — install ShareOut on Cloudflare with success criteria, CLI + Deploy-button paths, and Cloudflare companion skill links
- `skills/README.md` — single **source of truth** policy (monorepo skill tree vs `shareout-skill` mirror vs `$ORIGIN/v1/skill`)
- `tooling/scripts/mirror-skill-repo.sh` — keep `getshareout/shareout-skill` on par
- Self-host [Domain and DNS](docs-site/src/content/docs/self-host/domain.md) page
- Origin-aware product skill entry (`$ORIGIN`, credentials `origin` field, self-host unlocked model)

- **Backfilled 2026-11-18 — shipped 2026-10-16 → 2026-11-18 without an entry** (newest first; details in each PR):
  - **One share dialog** for the Home tab and the viewer: anyone with the link / everyone in the workspace / people you choose / only you; invite anyone by email with an optional `message` (≤ 1,000 chars) on `POST /v1/artifacts/{id}/collaborators`; invited people who haven't signed in are `pending`; `GET /v1/artifacts/{id}` returns `workspace_name`. (#303)
  - **Scanned PDFs are transcribed by a small model** (Claude Haiku 5.5 unless `SCAN_MODEL` is set). (#301)
  - **Billing for workspaces:** Admin → Billing gets an **AI report** (`GET /v1/workspaces/{id}/ai-report?month=YYYY-MM[&format=csv]`), **Summary** for chosen admins (`GET …/summary?month=`, `…/summary/access`, `GET|PUT …/summary/viewers`), billing details incl. Argentine tax fields (`GET|PUT …/billing-profile`), and **invoices** the operator issues, with the receipt attached and paid/unpaid state (`/v1/workspaces/{id}/invoices…`). AI is resold at a markup: price = cost × markup (workspace `ai_markup_bps`, else the instance's `default_markup_bps`, else at cost; `PUT /v1/admin/ai-settings`, `PUT /v1/workspaces/{id}/ai-markup`); workspaces see only their price and the monthly AI budget is measured at price. (#278, #279, #288, #291)
  - **AI page builds as durable jobs:** a build keeps running after the tab closes and a bell notice says when it is done (`/v1/builds*`, session only); `BUILD_AGENT` turns on the tool-using build agent (writes, checks, tests and fixes the page), with per-workspace `ai.build_agent`, `BUILD_EFFORT` and `BUILD_MODEL`, and the workspace's brand in builds; one agent engine for the assistant and the builder (history up to 200 messages, older ones folded into a summary; page edits in pieces). Admin Health traces every build; ops alerts on failed builds, low AI credit (`AI_CREDIT_ALERT_USD`, default 20) and daily spend (`AI_SPEND_ALERT_USD_PER_DAY`). A cut-off AI page is never published (32k output cap; failures in the reader's language), and viewers of a page that throws see an error bar with *Report to support*. (#268, #269, #270, #273, #274, #275, #276)
  - **Sharing a page emails the person** (new people get a sign-in code); the workspace assistant can share, unshare and change visibility. (#271)
  - **A detail page for every automation and AI task** with its runs and full editing; `PATCH /v1/workspaces/{id}/automations/{id}` also takes `cron`, `name`, `instructions`, `model`, `maxIterations`, `runBudgetMicroUsd`. (#267)
  - **Edit Catalog entries** from the Catalog lens and the workspace assistant (`PATCH …/catalog/entries/{id}`, assistant tool `catalog_update`). (#266)
  - **Crew limits are configurable:** `maxRuntimeMs`, `maxIterations`, `maxTokensPerCall`; `PATCH /v1/data/{id}/crew`, `sdk.crew.update()`. (#256)
  - **Data sources panel:** every viewer gets a *Data* pill saying where a page's numbers come from (viewer, Studio, editor); `GET /v1/artifacts/{id}/sources`. (#238, #239)
  - **Edit a page in pieces:** `POST /v1/artifacts/{id}/edits`, `GET …/files?manifest=1&paths=`, MCP `read_artifact` / `edit_artifact`; `get_artifact` reads every file and `update_artifact` refuses lossy or stale writes. (#220, #221)
  - **Quick edit:** Cmd/Ctrl+S saves, a conflict keeps your edits (*Keep mine* / *Load newer*), stale publishes are refused (`409 STALE_BASE`), select any element (Elements tree; the insert palette is gone), and ask AI about a block, an image or the whole page with Keep / Try again / Discard and before/after. Create with AI builds in a live tab. (#205, #226, #227, #230)
  - **Request edit access** (Docs-style): a request can be for edit; the owner is emailed every time; `POST /v1/access-requests` `role`. (#208)
  - **Workspace monthly AI budget** caps all metered AI (`GET /v1/workspaces/{id}/ai-limits`, `PUT …/llm/budget`); automation is billed to the workspace and a `429` names the limit (`limit`, `resets_at`); workspace members skip the per-page visitor cap (20 a minute, 300k tokens a day per person). (#181, #204, #207)
  - **Per-artifact one-click unsubscribe** on artifact and crew emails (footer link + `List-Unsubscribe`; opted-out recipients skipped, `skippedOptedOut`; owner `GET /v1/data/{id}/email/optouts`). (#196)
  - **Workspace default skills** for every member's assistant: `GET|POST|DELETE /v1/workspaces/{id}/default-skills` (up to 5, admins write); private skills stay private on publish and are never injected into others' agents. (#192, #194, #195)
  - **Knowledge from pages:** `sdk.knowledge.search(q, { limit, full })` and `GET /v1/data/{id}/knowledge/search` (internal members); `full=1` returns whole passages on the workspace search too; crews can list and read workspace artifacts and search Knowledge. (#180, #182, #186, #191)
  - **Admin Usage:** month spend, month-end pace, by day, CSV (`GET /v1/workspaces/{id}/spend?month=YYYY-MM[&format=csv]`). (#178)
  - **Automatic summaries and tags** for Markdown, CSV and PDF artifacts, not only HTML. (#172, #176)
  - **Converted PDFs** open with *Text | Original* tabs. (#164)
  - **Everything you upload is an artifact:** Word/Excel/PDF/images/video become artifacts (a PDF an editable page, scans transcribed; image-only Word and long scans read; `.pptx` text without the converter); the Files ("Recursos") lens leaves Home; owners/admins convert existing Files with `POST /v1/workspaces/{id}/assets/to-artifacts` (`dryRun`, `limit` ≤ 10, `retry`). (#155, #156, #160, #161)
  - **Viewer MCP connectors:** admins add a remote MCP server, members connect their own account, and members-only pages call the viewer's tools through `sdk.mcp` (`capabilities.mcp` on publish, MCP `publish_artifact` `mcp_connections`, per-viewer consent; migration 0018). (#148)
  - **D1 read replicas** (self-host, opt-in): `D1_READ_REPLICAS=1`; writes hand back `x-d1-bookmark` / `__d1b` for read-your-writes. (#129)
  - **Guest comments switches** in the app (*Allow guest comments* on a folder; *Follow folder / On / Off* in Comments); Spanish emails say "artefacto". (#133)

### Changed (API)

- **Catalog `status` is the effective status:** `status: certified` in a catalog file no longer certifies anything (it reads `draft`); only an owner/admin certification of the current version does. Lineage reads both ends of every edge (a source its datasets point at has downstream and is not an orphan), `aliases:` keep old ids resolving, and connector `source` entries are keyed by connection id (`conn.<connectionId>`, `sources/<connectionId>.md`) with the old `conn.<name-slug>` kept as an alias. `PUT …/catalog/files` records `updated_by` / `updated_by_kind`.
- **Search runs in one D1 wave:** `quickSearch` (`/v1/search`, `/v1/home/quick-search`, `search_workspace`, `find_passages`) carries visibility as SQL subqueries instead of loading linked accounts and workspaces first (was 2–3 sequential waves). Its workspace-wide groups (folders, datasets, connectors, people, schedules, crew, alerts, skills) now return nothing for a caller who is not an internal member of the requested workspace; before, a `workspace` param named by a non-member still listed them.
- `POST /v1/publish` (and data-API provision, Studio Home import, library modules) apply the MCP `files` path rule: backslashes, empty or `.` segments (`a//b`, `./x`), control characters and paths over 512 characters are now refused with `400 INVALID_PATH` and a `hint` naming the path. Names like `img/logo@2x.png` and `a+b.css` still publish; files already stored keep serving. Imported Word images and file names are renamed to safe paths.

### Changed

- **Backfilled 2026-11-18 — UI changes that shipped without an entry:** Admin is a sidebar of pages (Reports, People, Content, AI & billing, Security, Workspace; deep links `#l/admin/<page>`) with what needs you in color and long lists folded (#280); one AI spend number everywhere, super-admin-only blocks marked (#290); Home is fixed *Needs you / For you / Recent*, customizing under More (#261, #262); the open-artifact panel has three tabs, Details / Comments / Automate, with Versions and Data under Details → More, and opens from *Options* on phones (#259, #206); AI tasks, Knowledge and Catalog are back in the rail (#263); one *New* button and a slimmer rail, a first run with one next step, 44 px touch targets, a Share button with instant feedback, and pages made with AI start private (#249, #250, #251, #252); recipients see the toolbar, sign-in errors and 404s in their language and visibility badges that say exactly who can open a page (`can_open_public` on `GET /v1/artifacts/{id}`) (#254, #255, #257, #258); every table header sorts and the Artifacts table lists folders and favorites first (#264, #265, #171); one full-width header, the chat no longer covers the artifact, tabs open on the left and keep their names (#200, #201, #202, #173); a Drive-style Artifacts browser and decluttered lens headers (#167, #168); the Knowledge note view and header (#159, #161); opening the bell marks what needs you as read (#200); shareout.css contrast and focus ring (#193); Spanish-aware Knowledge keyword search and a multilingual index behind `KNOWLEDGE_EMBED_MODEL` / `KNOWLEDGE_VECTORS_READ` (#222, #242); schedules run on the hour and an off-hour minute returns a `notice` (#187); deck covers use the source title and summary in its language (#188); slugs transliterate accents (#199).

- **Skill version moved to `skill.json`:** `skills/ShareOutSkill/skill.json` now holds the skill's `version`, `updated_at` and `skill_endpoint` (and those of `deploy/SKILL.md` and `team/SKILL.md`); the three `SKILL.md` files keep only `name` and `description` in their frontmatter, the keys the Claude plugin directory accepts. `/v1/skill/version`, `X-Skill-Version` and the ETag are unchanged in shape (`<version>+<sha8>`). To bump the skill, edit `skill.json` and `skills/.claude-plugin/plugin.json` together; `check:claude-plugin` fails when they differ or when a Markdown file in the plugin gains another frontmatter key. Skill 2.67.0.
- **MCP tool descriptions only describe:** the connector's tool descriptions no longer tell the model how to behave ("Answer in the person's language", "Tell the person…", "If something fails, call report_problem…", "Confirm with the person first"). That guidance now lives once in the server instructions (returned by `initialize`), which gained a line on confirming before actions that reach other people or cannot be undone. Tool results are unchanged. A test (`tests/unit/mcp/tool-descriptions.test.ts`) fails if a description gains an instruction, or a tool lacks a title or a read-only/destructive hint.
- **MCP data tool descriptions:** `query_connection`, `browse_storage` and `read_connector` now say what they reach (ShareOut's data connector API, on a warehouse, bucket or app the workspace connected) and their limits (read-only, only connectors an admin switched on for AI). No behavior change.
- **Drive spreadsheet sync asks only for `drive.file`:** Automate → *Sync data from Google Drive* no longer uses the folder import's `drive.readonly` consent (a Google restricted scope). It has its own consent with the Google Picker inside it (`trigger_onepick`): the person picks the spreadsheet in Google, and ShareOut can read only the files picked that way, refreshed for the schedule. A pasted link opens the Picker on that file. Stored apart in `file_import_connections` (`provider = google_drive_file`), same OAuth client and redirect URI (or `GOOGLE_DRIVE_FILE_CLIENT_ID`/`_SECRET`); enable the Google Picker API. New `GET/DELETE /v1/workspaces/{ws}/file-imports/sheet-sync[/pick|/connection]`. Disconnecting a Google consent revokes at Google only when no other consent of the person goes through the same OAuth client, since a Google revoke ends every consent the account gave that Cloud project (`GOOGLE_DRIVE_FILE_CLIENT_ID` must be a separate project). Jobs saved before this need the spreadsheet picked again.
- **Faster captures:** thumbnails, smoke tests and PDFs no longer wait out the full timeout for a `window.__shareoutReady` flag a page never sets — the flag is raced against network idle (pages that use the flag are still waited on).
- **Docs site: broken links fixed + link checker.** `npm run check:links` in `docs-site/` checks every internal link and `#anchor` in the built `dist/` against the generated heading ids (28 broken links fixed, now 0). Spanish pages say "artefacto" for ShareOut artifacts instead of "artifact"/"página".
- **Skill OSS hygiene (v2.51.0):** workspace overlay is role-based; `team/billing.md` is a hosted-only stub (no checkout/upsell on self-host); plan language stripped from team entry, API, subdomain, admin portal, assistant docs
- Official marketplace primer `official-skills/shareout.md` rewritten: origin-aware, short, points agents at `GET $ORIGIN/v1/skill` for the full tree
- README / AGENTS / self-host overview: agent install path + skill location clarified
- Self-host secrets docs: drop `BILLING_MODE` as a required knob (OSS unlocked by construction)
- `jsonWithApiErrors` optional extra headers (Set-Cookie / CORS) for OTP and file routes
- Pilot / editor SDK error helpers use the canonical envelope
- Bump `@cloudflare/workers-types` to v5 so `npm ci` resolves wrangler 4.114 peerOptional cleanly
- `npm run sync:skill` (and `prune-skill-orphans.mjs`) have no default R2 bucket: pass `--bucket=<name>` or set `SKILL_R2_BUCKET`, and the target is printed before uploading; `provision:cf` no longer falls back to built-in worker / D1 / R2 names when `wrangler.toml` lacks one. MCP `files` accept asset names REST accepts (`logo@2x.png`, `a+b.css`); HTML pages keep the strict page-path rule

## [0.1.0-pre] — 2026-07-25

First public soft-launch cut of the open-source tree.

### Added

- Wave 4: `ROADMAP.md`, `MAINTAINING.md` (branch protection checklist); broader
  `jsonWithApiErrors` rollout (auth, tokens, folders, router API, slack, email, …)
- Wave 3: `npm run test:critical` (auth/access/publish/error contract) as a fail-fast CI step
- `jsonWithApiErrors` — artifact / publish / workspace JSON helpers normalize error bodies
- Capability lattice unit tests; RELEASING.md maintainer cut checklist
- Dependabot: grouped production/dev deps, lower open-PR limits (avoid CI storms)
- Canonical public API error envelope (`src/http/api-error.ts`) + golden contract tests
- Fail-closed tests for unset `ADMIN_BRIDGE_SECRET` on `/internal/admin/*`
- CI Wave 0/1: coverage floors on every PR, docs-site build job, prod `npm audit`,
  Dependabot (npm + Actions), `NOTICE`, `SUPPORT.md`, EditorConfig / Prettier / ESLint baselines
- Local `ci-check.sh` aligned with public CI (migrate fresh, coverage, audit, gitleaks, docs)
- `MARKETING_ORIGIN`, `DOCS_HOST`, `DOCS_ORIGIN` vars (optional; unset = no marketing/docs proxy)
- `.nvmrc` (Node 24) and `.github/ISSUE_TEMPLATE/config.yml`
- Guidance for self-hosters on retheming `Design/` and replacing `docs-site/`
- Self-host path: `/setup` checklist, email OTP without Google (billing removed from OSS tree)
- Deploy-to-Cloudflare wrangler template (no founder account IDs)
- Fresh D1 migrate smoke (`npm run db:migrate:fresh`) and hello publish smoke
- Docs: Self-host section (EN + ES) — overview, secrets, architecture, ops, threat model
- Public CI (gitleaks, worker checks, migrate smoke)

### Changed

- Scheduling job/template handlers return the same error envelope as the data API (`success: false`)
- Unhandled request errors include `success: false` and never echo exception text to clients
- `wrangler.test.toml`: placeholder IDs, neutral `shareout.test` origins, no product zone routes
- Anonymous `/` redirects to the login page when no `MARKETING_ORIGIN` is set
- npm package renamed `shareout-poc` → `shareout`; analytics/log hints use script name `shareout`

### Removed

- **All billing and payments.** Rebill and dLocal integrations, subscriptions, trials,
  seats, invoices, AI-credit metering and top-ups, checkout/billing/pricing pages and
  APIs, the founder revenue dashboards (`team-metrics/`), and every plan/tier gate.
  Feature access is no longer tiered: external sharing, the skill marketplace, the
  workspace library, public links, and the workspace assistant are on. Abuse limits
  are now instance settings (`STORAGE_QUOTA_BYTES`, `STORAGE_MAX_FILE_BYTES`,
  `PUBLIC_ARTIFACT_LIMIT`), unlimited by default
- Marketing landing page (no route referenced it) and the generated graphify cache
- Instance-specific deploy scripts (`ship.sh`, `rollback.sh`, `bootstrap-staging-secrets.sh`)

### Security

- `superadmin-recipients.json` ships empty — claim first admin via `/setup` or `SETUP_ADMIN_EMAIL`
- Vulnerability reports via GitHub private advisories (no shared alias)
- KV rate limits on email OTP, access-request create, and `/internal/admin/ask`
- `ADMIN_BRIDGE_SECRET` unset ⇒ internal admin bridge denies all
