# Umbrella Salud — Protocolo de datos de pacientes para marketing

Versión 1.3, julio de 2026. Responsable: Oficina de Protección de Datos de Umbrella Salud (datos@umbrellasalud.example). Aplica a todo el equipo de marketing y a Acme Digital, que trabaja como encargado del tratamiento según el contrato de servicios firmado en marzo de 2026.

## Marco legal

- Ley 25.326 de Protección de Datos Personales: los datos de salud son datos sensibles (artículos 2, 7 y 8) y solo pueden tratarse con consentimiento expreso o dentro de la relación asistencial.
- El artículo 27 de la Ley 25.326 regula las bases con fines de publicidad: el titular puede pedir en cualquier momento el retiro o bloqueo de sus datos.
- Ley 26.529 de derechos del paciente: la historia clínica es confidencial y nunca se usa para marketing.
- Las bases de Umbrella Salud están inscriptas ante la Agencia de Acceso a la Información Pública (AAIP).

## Consentimiento

- Solo se usan para marketing los datos de pacientes que marcaron la casilla "Acepto recibir comunicaciones de Umbrella Salud" al sacar un turno. La casilla nunca viene marcada y está separada de los términos y condiciones.
- Cada consentimiento se guarda con fecha, canal y versión del texto aceptado.
- El consentimiento se renueva cada 24 meses; si el paciente no lo renueva, sale de todas las listas.
- Pedidos de baja: link en cada email y la palabra BAJA por WhatsApp. Se procesan dentro de los 5 días hábiles.

## Minimización de datos

- Acme recibe únicamente: email o teléfono hasheado con SHA-256, rango de edad, sede y mes del último turno.
- Nunca se comparten especialidad, diagnóstico, prestación, cobertura ni número de afiliado.
- Está prohibido subir a Meta o a Google listas armadas por especialidad o por patología.

## Retención y borrado

- Listas cargadas como audiencias personalizadas: se borran de las plataformas a los 90 días de cargadas.
- Leads de formularios que no sacaron turno: se conservan 12 meses y después se eliminan.
- Reportes con datos agregados: se conservan 5 años.
- Al terminar el contrato, Acme devuelve o destruye los datos en 10 días hábiles y entrega constancia por escrito.

## Anonimización en reportes

- Los reportes solo muestran agregados de 20 pacientes o más por celda; las celdas con menos se agrupan en "Otros".
- No se cruzan datos de turnos con datos de navegación de personas identificables.
- Las capturas de pantalla de plataformas no pueden mostrar emails, teléfonos ni nombres.

## Quién puede acceder

- La carpeta "Audiencias UMB" de Google Drive tiene acceso para solo tres personas de Acme: el líder de la cuenta, la analista de datos asignada y el responsable de IT y Seguridad de Acme.
- Acceso siempre con verificación en dos pasos; los permisos se revisan cada trimestre.
- Un incidente de seguridad o una filtración se informa a datos@umbrellasalud.example dentro de las 24 horas de detectado.
