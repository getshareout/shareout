// Labelled corpus for the keyword-search eval (knowledge/keyword-eval.test.ts). Synthetic
// passages and hand labels: it measures the lexical mechanisms (stopwords, stemming,
// partial words, AND/OR), not search quality in general. Companies are placeholders.
//
// PROBE_QUERIES are the 18 queries of the original Spanish probe, kept as they were so
// before/after numbers compare. The EN→ES four ask in English about Spanish passages:
// keyword search cannot bridge languages, so they stay misses here by design.

export interface EvalSource { title: string; passages: string[] }
export interface EvalQuery { q: string; relevant: [number, number]; tag: string }

export const EVAL_SOURCES: EvalSource[] = [
  {
    title: 'Campaña invierno — Lácteos Acme',
    passages: [
      'Presupuesto aprobado: el directorio aprobó un presupuesto total de USD 48.000 para la campaña de invierno de Lácteos Acme, con un 60% destinado a medios digitales.',
      'Calendario de la campaña: lanzamiento el 3 de junio, cierre el 15 de agosto. Piezas: 12 videos cortos y 30 banners.',
    ],
  },
  {
    title: 'Campaña verano — Bebidas Globex',
    passages: ['La campaña de verano de Bebidas Globex tuvo un presupuesto estimado de USD 35.000, todavía pendiente de aprobación por el cliente.'],
  },
  {
    title: 'Manual de planta — Minera Initech',
    passages: [
      'Clasificación de residuos peligrosos: todo residuo con hidrocarburos se clasifica como peligroso y se almacena en contenedores rojos rotulados.',
      'Procedimiento de ingreso a la planta: el visitante debe registrarse en portería y recibir casco, chaleco y una charla de seguridad de 10 minutos.',
      'Residuos domiciliarios: los residuos no peligrosos de comedor van a contenedores verdes y se retiran dos veces por semana.',
    ],
  },
  {
    title: 'Políticas de RR.HH.',
    passages: [
      'Política de vacaciones: los empleados con más de un año de antigüedad tienen 15 días hábiles de vacaciones pagas por año.',
      'Reembolsos: los reembolsos de gastos de viaje los aprueba la gerencia de finanzas dentro de los 10 días de presentada la rendición.',
      'Licencias: la licencia por paternidad es de 10 días corridos; la de maternidad, de 90 días.',
    ],
  },
  {
    title: 'Reporte comercial Q3',
    passages: [
      'En el tercer trimestre incorporamos 12 clientes nuevos, principalmente del sector agroindustrial, y las ventas crecieron 18% interanual.',
      'Churn: perdimos 2 cuentas medianas por recortes de presupuesto; la tasa de cancelación trimestral fue de 3,1%.',
    ],
  },
  { title: 'Reporte comercial Q2', passages: ['En el segundo trimestre sumamos 7 clientes y la facturación fue de USD 410.000.'] },
  {
    title: 'Contratos',
    passages: [
      'Transportes Umbrella: el contrato de logística vence el 30 de noviembre; la renovación requiere aviso con 60 días de anticipación.',
      'Contratación de un proveedor: toda contratación mayor a USD 5.000 requiere tres cotizaciones y aprobación del comité de compras.',
    ],
  },
  {
    title: 'Auditoría de seguridad 2026',
    passages: [
      'Principales riesgos identificados en la auditoría de seguridad: contraseñas compartidas, falta de doble factor y backups sin cifrar.',
      'Plan de remediación: activar doble factor en todas las cuentas antes de diciembre y cifrar los backups semanales.',
    ],
  },
  {
    title: 'Indicadores de RR.HH.',
    passages: [
      'La rotación del personal fue de 8% en el último año, por debajo del promedio de la industria (12%).',
      'El ausentismo promedio fue de 2,4 días por empleado por año.',
    ],
  },
  {
    title: 'Reunión de directorio',
    passages: ['El lunes el directorio revisará el cierre del trimestre, los riesgos del negocio y la estrategia comercial para el año próximo.'],
  },
  {
    title: 'Minuta de equipo',
    passages: [
      'Se acordó que el equipo de diseño entregará las piezas de la campaña antes del viernes y que el cliente dará su aprobación final el lunes.',
      'El total de horas del proyecto fue de 340, de las cuales 120 se usaron para revisiones del cliente.',
    ],
  },
  { title: 'Guía de marca', passages: ['El logo se usa siempre sobre fondo blanco; el color principal es el azul Pantone 286 y la tipografía es Inter.'] },
  {
    title: 'Travel policy',
    passages: ['Travel expenses are reimbursed by the finance team within 10 days after your manager approves the expense report.'],
  },
  {
    title: 'Onboarding guide',
    passages: ['Every new hire gets a laptop on the first day and completes the security trainings during the first week.'],
  },
  {
    title: 'Quarterly business review',
    passages: ['Revenue grew 18% this quarter, driven by new customers in agribusiness; churned accounts stayed below 3%.'],
  },
];

export const PROBE_QUERIES: EvalQuery[] = [
  { q: '¿Me podrías decir cuál fue el presupuesto total que se aprobó finalmente para la campaña de invierno del cliente Lácteos Acme?', relevant: [0, 0], tag: 'long-NL' },
  { q: 'presupuestos aprobados campañas de invierno', relevant: [0, 0], tag: 'morph' },
  { q: '¿Qué procedimiento hay que seguir para la clasificación de residuos peligrosos en la planta?', relevant: [2, 0], tag: 'NL' },
  { q: 'políticas vacaciones empleados días', relevant: [3, 0], tag: 'morph' },
  { q: '¿Cuántos clientes nuevos se incorporaron durante el último trimestre según el reporte comercial de ventas?', relevant: [4, 0], tag: 'long-NL' },
  { q: 'contrataciones de proveedores cotizaciones', relevant: [6, 1], tag: 'morph' },
  { q: 'renovación del contrato con Transportes Umbrella', relevant: [6, 0], tag: 'entity' },
  { q: 'Necesito saber, para preparar la reunión del lunes con el directorio, cuáles fueron los principales riesgos identificados en la auditoría de seguridad', relevant: [7, 0], tag: 'long-NL' },
  { q: '¿Quién es el responsable de aprobar los reembolsos de gastos de viaje que presentan los empleados cuando vuelven de una visita a clientes?', relevant: [3, 1], tag: 'long-NL' },
  { q: 'indicadores rotación personal', relevant: [8, 0], tag: 'short' },
  { q: 'reembolso viáticos', relevant: [3, 1], tag: 'morph-short' },
  { q: 'contrataciones', relevant: [6, 1], tag: 'morph-short' },
  { q: 'auditorías riesgo', relevant: [7, 0], tag: 'morph-short' },
  { q: 'licencia paternal', relevant: [3, 2], tag: 'morph-short' },
  { q: 'approved budget for the winter campaign', relevant: [0, 0], tag: 'EN→ES' },
  { q: 'hazardous waste classification procedure', relevant: [2, 0], tag: 'EN→ES' },
  { q: 'travel expense reimbursement approval', relevant: [3, 1], tag: 'EN→ES' },
  { q: 'staff turnover rate last year', relevant: [8, 0], tag: 'EN→ES' },
];

/** Beyond the probe: partial words, accents left out, and English passages. */
export const EXTRA_QUERIES: EvalQuery[] = [
  { q: 'presupues campaña invierno', relevant: [0, 0], tag: 'partial' },
  { q: 'auditoria seguridad riesgos', relevant: [7, 0], tag: 'no-accents' },
  { q: 'contratacion proveedores', relevant: [6, 1], tag: 'no-accents' },
  { q: 'renovacion contrato logistica', relevant: [6, 0], tag: 'no-accents' },
  { q: 'who approves travel expenses?', relevant: [12, 0], tag: 'EN' },
  { q: 'new hires training', relevant: [13, 0], tag: 'EN' },
  { q: 'customer churn this quarter', relevant: [14, 0], tag: 'EN' },
];
