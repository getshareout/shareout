# Política de seguridad de la información

Versión 3.1, julio de 2026. Responsable: IT y Seguridad (Nicolás Ferraro). Aplica a todo el equipo, contractors incluidos, y a cualquier dispositivo con el que accedas a información de Acme o de un cliente.

## Contraseñas

- Todas las contraseñas de trabajo se guardan en Litware Vault: nada de planillas, notas del teléfono ni contraseñas guardadas en el navegador.
- Largo mínimo de cualquier contraseña: 14 caracteres. La contraseña maestra de Litware Vault lleva como mínimo 20 caracteres; te sugerimos una frase de cinco palabras.
- Una contraseña distinta para cada servicio: no repitas contraseñas entre cuentas.
- No se cambian por calendario. Se cambian cuando hay sospecha de filtración o cuando alguien que la conocía deja el equipo.
- Para compartir un acceso usá una carpeta compartida de Litware Vault. Nunca mandes contraseñas por Slack, mail o WhatsApp.

## Autenticación en dos pasos

La verificación en dos pasos es obligatoria en Google Workspace, Slack, Litware Vault, HubSpot, Meta Business Manager y Google Ads. Usá una app de autenticación o una llave de seguridad física: los códigos por SMS no están permitidos. Guardá los códigos de recuperación en tu bóveda personal de Litware Vault. Si cambiás o perdés el teléfono, escribile a IT y Seguridad antes de borrar la app de autenticación.

## Dispositivos y bloqueo de pantalla

- La pantalla se bloquea sola a los 5 minutos de inactividad; igual, bloqueala a mano cada vez que te levantes, también en la oficina.
- El cifrado de disco tiene que estar activado en la notebook. IT lo verifica al entregar el equipo y una vez por trimestre.
- Instalá las actualizaciones del sistema operativo dentro de los 7 días de publicadas.
- En tu teléfono personal podés usar el mail y Slack solo con bloqueo por PIN o biometría y con el perfil de trabajo activado.
- Si perdés la notebook o el teléfono, o te los roban, avisá en el momento por el canal de reportes (ver más abajo).

## Accesos a cuentas de clientes

- A las cuentas publicitarias de los clientes se entra siempre con tu usuario de acme.example, a través del MCC de Google Ads o del Business Manager de Meta. Nunca uses usuarios compartidos ni credenciales del cliente.
- Mínimo privilegio: el rol por defecto es "Analista"; el rol "Administrador" lo tienen solo el account lead y el Head of Performance.
- Cuando alguien deja una cuenta o se va de Acme, el account lead revoca sus accesos dentro de las 24 horas.
- La primera semana de cada trimestre, IT y los account leads revisan quién tiene acceso a qué y dan de baja lo que sobra.

## Phishing

Desconfiá de los mails que meten urgencia, piden cambiar datos bancarios, te piden que "verifiques" tu cuenta o vienen de dominios parecidos al nuestro (por ejemplo acme-example.example o acrne.example). Ante la duda, no hagas clic: preguntá.

IT hace una simulación de phishing por trimestre; quienes caen hacen un repaso de 15 minutos, sin sanciones. Si hiciste clic o cargaste tu contraseña, reportalo igual: cuanto antes avises, menos daño.

## Cómo reportar algo sospechoso

- Escribí en el canal de Slack #it-seguridad o mandá un mail a it@acme.example.
- Si es un mail sospechoso, reenvialo como adjunto (no como reenvío común) y no lo borres hasta que IT te responda.
- Contá qué viste, cuándo y en qué dispositivo, y sumá capturas de pantalla.
- Fuera de horario, o si es urgente (por ejemplo, una cuenta de cliente tomada por terceros), llamá al teléfono de guardia de IT: +54 11 5555-0199.
- No intentes investigar ni "arreglar" el problema por tu cuenta.

## Clasificación de la información

| Nivel | Ejemplos | Cómo se maneja |
|---|---|---|
| Pública | Posts del blog, casos de éxito autorizados por el cliente | Se comparte libremente |
| Interna | Políticas, minutas, procesos | Solo dentro de Acme |
| Confidencial | Propuestas comerciales, contratos, reportes de clientes | Solo con el equipo de la cuenta, en carpetas de Drive con acceso nominal |
| Restringida | Datos personales de los clientes de nuestros clientes, credenciales, sueldos | Solo en Litware Vault o en carpetas con acceso nominal aprobado por IT; nunca en herramientas externas ni en pendrives |
