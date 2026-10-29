/**
 * The page-build eval set: real-looking requests, no customer names, with expectations a
 * script can check on the files. Bump SET_VERSION when an item changes meaning (a prompt,
 * a table name, an expectation) so two results files are only compared like for like.
 */
import type { EvalItem } from './types';
import { LANDING_SEED, SALES_SEED, TASKS_SEED } from './seeds';

export const SET_VERSION = 1;

export const EVAL_SET: EvalItem[] = [
  // ── CRUD tools: sdk.table + forms + validation ─────────────────────────────
  {
    id: 'crud-tasks-en', language: 'en', kind: 'build', tags: ['crud', 'forms', 'validation'],
    prompt: 'Build a team task tracker. Store tasks in a table called "tasks" with title, owner, due date, status (todo, doing, done) and notes. A form adds a task (title and due date required), the list can be filtered by status, and each row has buttons to change its status or delete it.',
    expect: { tables: ['tasks'], minFormFields: 4, features: ['validation', 'persistence'], patterns: ['\\bdelete\\b|\\.remove\\(|\\.delete\\('] },
  },
  {
    id: 'crud-contacts-es', language: 'es', kind: 'build', tags: ['crud', 'forms', 'validation'],
    prompt: 'Armame una agenda de contactos para el equipo. Guardá los datos en una tabla "contactos" con nombre, email, teléfono, empresa y notas. Quiero un formulario para cargar un contacto (nombre y email obligatorios, el email validado), un buscador que filtre mientras escribo y poder editar o borrar cada contacto.',
    expect: { tables: ['contactos'], minFormFields: 4, features: ['validation', 'persistence'], language: 'es', patterns: ['type=["\']?email'] },
  },
  {
    id: 'crud-inventory-en', language: 'en', kind: 'build', tags: ['crud', 'forms', 'multi-table'],
    prompt: 'I need a simple stock control page. Two tables: "products" (sku, name, unit, min_stock) and "stock_moves" (sku, quantity, kind in/out, date, reason). A form registers a movement for an existing product, and the product list shows the current stock (sum of moves) and flags anything below its minimum.',
    expect: { tables: ['products', 'stock_moves'], minFormFields: 4, features: ['formula', 'persistence'], patterns: ['min_stock'] },
  },
  {
    id: 'crud-expenses-es', language: 'es', kind: 'build', tags: ['crud', 'forms', 'validation'],
    prompt: 'Hacé una planilla para registrar gastos de la oficina. Tabla "gastos" con fecha, categoría, monto, proveedor y comprobante (número). El monto tiene que ser mayor a cero y la fecha no puede ser futura. Mostrá el total del mes y un subtotal por categoría.',
    expect: { tables: ['gastos'], minFormFields: 4, features: ['validation', 'formula', 'persistence'], language: 'es' },
  },
  {
    id: 'crud-bookings-en', language: 'en', kind: 'build', tags: ['crud', 'forms', 'validation'],
    prompt: 'Make a meeting-room booking page. A table "bookings" with room (Room A, Room B, Room C), date, start time, end time, booked by and purpose. Reject a booking that overlaps another one in the same room and show a clear message. Show today\'s bookings at the top.',
    expect: { tables: ['bookings'], minFormFields: 5, features: ['validation', 'persistence'], patterns: ['overlap|conflict|already booked'] },
  },
  {
    id: 'crud-feedback-es', language: 'es', kind: 'build', tags: ['crud', 'forms'],
    prompt: 'Quiero una página para juntar opiniones después de una capacitación: tabla "opiniones" con puntaje del 1 al 5, qué te gustó, qué mejorarías y un email opcional. Abajo, el promedio de puntaje y la cantidad de respuestas.',
    expect: { tables: ['opiniones'], minFormFields: 3, features: ['formula', 'persistence'], language: 'es' },
  },

  // ── Monthly entry / KPI consolidators with formulas ────────────────────────
  {
    id: 'kpi-sales-en', language: 'en', kind: 'build', tags: ['kpi', 'formula', 'forms'],
    prompt: 'A monthly results page: each month I enter revenue, cost of goods and operating expenses (table "monthly_entries"). Compute gross margin, operating profit and margin % per month, show a totals row for the year to date, and highlight months where profit is negative.',
    expect: { tables: ['monthly_entries'], minFormFields: 4, features: ['formula', 'persistence'], patterns: ['margin'] },
  },
  {
    id: 'kpi-branches-es', language: 'es', kind: 'build', tags: ['kpi', 'formula', 'forms'],
    prompt: 'Necesito consolidar el reporte mensual de varias sucursales. Cada sucursal carga ventas, cantidad de tickets y costos en la tabla "reportes_mensuales" (con mes y sucursal). Calculá el ticket promedio, la variación porcentual contra el mes anterior y un consolidado de todas las sucursales por mes.',
    expect: { tables: ['reportes_mensuales'], minFormFields: 4, features: ['formula', 'persistence'], language: 'es', patterns: ['variaci[oó]n|%'] },
  },
  {
    id: 'kpi-headcount-en', language: 'en', kind: 'build', tags: ['kpi', 'formula'],
    prompt: 'Track headcount by department month by month in a table "headcount" (month, department, start, hires, exits). Show end-of-month headcount, monthly attrition rate (exits divided by average headcount) and a department x month grid with the totals.',
    expect: { tables: ['headcount'], minFormFields: 4, features: ['formula', 'persistence'], patterns: ['attrition'] },
  },
  {
    id: 'kpi-cashflow-es', language: 'es', kind: 'build', tags: ['kpi', 'formula', 'chart'],
    prompt: 'Una proyección de flujo de caja: tabla "flujo_caja" con mes, ingresos y egresos. Mostrá el saldo acumulado mes a mes (empezando con un saldo inicial que se pueda editar), marcá en rojo los meses con saldo negativo y agregá un gráfico de línea del saldo.',
    expect: { tables: ['flujo_caja'], minFormFields: 3, features: ['formula', 'chart', 'persistence'], language: 'es' },
  },

  // ── Dashboards with charts ─────────────────────────────────────────────────
  {
    id: 'dash-sales-en', language: 'en', kind: 'build', tags: ['dashboard', 'chart'],
    prompt: 'Build a sales dashboard with sample data for 12 months: four KPI cards (revenue, orders, average order value, growth vs last month), a line chart of revenue by month and a bar chart of revenue by region. It must look good on a phone.',
    expect: { features: ['chart', 'responsive'], patterns: ['revenue'], minSections: 2 },
  },
  {
    id: 'dash-tickets-es', language: 'es', kind: 'build', tags: ['dashboard', 'chart', 'crud'],
    prompt: 'Armá un tablero de tickets de soporte que lea de una tabla "tickets" (asunto, estado, prioridad, fecha). Un gráfico de torta por estado, uno de barras por prioridad, y debajo la lista de los tickets abiertos. Si la tabla está vacía, mostrá un mensaje que lo diga.',
    expect: { tables: ['tickets'], features: ['chart', 'persistence'], language: 'es' },
  },
  {
    id: 'dash-traffic-en', language: 'en', kind: 'build', tags: ['dashboard', 'chart'],
    prompt: 'A website traffic dashboard with made-up data: visitors per day for the last 30 days (line chart), top 5 pages (horizontal bars), traffic sources (doughnut) and a selector to switch between the last 7, 14 and 30 days that updates the charts.',
    expect: { features: ['chart', 'responsive'], patterns: ['<select', '30'] },
  },
  {
    id: 'dash-ops-es', language: 'es', kind: 'build', tags: ['dashboard', 'chart'],
    prompt: 'Hacé un tablero operativo para una planta chica: cuatro tarjetas con indicadores (producción del día, rechazos %, paradas, cumplimiento del plan), un gráfico de barras de producción por turno y una tabla con las últimas paradas. Datos de ejemplo.',
    expect: { features: ['chart', 'responsive'], language: 'es', minSections: 2 },
  },

  // ── Landing and info pages ─────────────────────────────────────────────────
  {
    id: 'landing-saas-en', language: 'en', kind: 'build', tags: ['landing'],
    prompt: 'A landing page for a project-planning tool for small agencies: hero with a headline and a call-to-action button, three feature cards, a three-plan pricing section, a short FAQ and a footer. Clean, modern, responsive.',
    expect: { features: ['responsive'], minSections: 4, language: 'en', patterns: ['pricing|plans?', 'faq'] },
  },
  {
    id: 'landing-bakery-es', language: 'es', kind: 'build', tags: ['landing'],
    prompt: 'Una página para una panadería de barrio: portada con una frase y una foto (usá un fondo de color si no hay imagen), el menú del día con precios, horarios, dirección con un mapa de ejemplo y un botón para pedir por WhatsApp. Tiene que verse bien en el celular.',
    expect: { features: ['responsive'], minSections: 3, language: 'es', patterns: ['whatsapp', 'horario'] },
  },
  {
    id: 'info-faq-en', language: 'en', kind: 'build', tags: ['info'],
    prompt: 'An internal FAQ page for new hires: 10 questions grouped in four topics (equipment, accounts, time off, expenses), each answer expands and collapses, plus a search box that filters the questions as you type.',
    expect: { features: ['responsive'], language: 'en', patterns: ['<details|aria-expanded', 'input'], minSections: 3 },
  },
  {
    id: 'info-onboarding-es', language: 'es', kind: 'build', tags: ['info', 'persistence'],
    prompt: 'Una guía de bienvenida para gente que entra al equipo, con un checklist de la primera semana (día 1 a día 5). Cada tarea se puede tildar y el progreso se guarda en una tabla "progreso_onboarding" para que no se pierda. Mostrá una barra con el porcentaje completado.',
    expect: { tables: ['progreso_onboarding'], language: 'es', features: ['persistence', 'formula'], minSections: 3 },
  },

  // ── Long multi-section apps (more than one turn of output) ─────────────────
  {
    id: 'long-crm-en', language: 'en', kind: 'build', tags: ['long', 'crud', 'dashboard', 'multi-table'],
    prompt: 'Build a small CRM with five sections reachable from a sidebar: Dashboard (open deals, pipeline value, win rate and a chart of deals by stage), Contacts, Companies, Deals (a kanban board by stage with drag between columns) and Activity log. Tables: "contacts", "companies", "deals" and "activities". Every section has its own add/edit form with validation, and deals link to a contact and a company.',
    expect: { tables: ['contacts', 'companies', 'deals', 'activities'], minFormFields: 10, features: ['chart', 'validation', 'persistence'], minSections: 5, minChars: 15000 },
  },
  {
    id: 'long-gym-es', language: 'es', kind: 'build', tags: ['long', 'crud', 'dashboard', 'multi-table'],
    prompt: 'Quiero un sistema de gestión para un gimnasio chico, en una sola página con pestañas: Socios, Pagos, Clases y Reportes. Tablas "socios", "pagos" y "clases" (con cupo y anotados). En Pagos tiene que marcar quién está al día y quién debe; en Clases no se puede anotar más gente que el cupo; en Reportes ingresos por mes en un gráfico y socios activos.',
    expect: { tables: ['socios', 'pagos', 'clases'], minFormFields: 9, features: ['chart', 'validation', 'persistence'], language: 'es', minSections: 4, minChars: 15000 },
  },
  {
    id: 'long-projects-en', language: 'en', kind: 'build', tags: ['long', 'crud', 'formula', 'multi-table'],
    prompt: 'A project and time tracker for a consultancy with these views: Projects (budget hours, hours used, % used with a progress bar), Tasks per project, Timesheet (log hours per person per day) and Weekly report (hours by person and by project, over-budget projects highlighted, a chart). Tables "projects", "tasks" and "timesheet". Include validation (hours between 0 and 24) and an empty state for every list.',
    expect: { tables: ['projects', 'tasks', 'timesheet'], minFormFields: 9, features: ['chart', 'formula', 'validation', 'persistence'], minSections: 4, minChars: 15000 },
  },

  // ── Edits to an existing page ──────────────────────────────────────────────
  {
    id: 'edit-priority-en', language: 'en', kind: 'edit', tags: ['edit', 'crud'], seed: TASKS_SEED,
    prompt: 'In the "Team tasks" page, add a priority field (low, medium, high) to the form, store it in the tasks table and show it next to each task. Do not change anything else.',
    expect: { tables: ['tasks'], minFormFields: 3, patterns: ['priority'], preserve: ['Team tasks', "shareout.table('tasks')"] },
  },
  {
    id: 'edit-chart-es', language: 'es', kind: 'edit', tags: ['edit', 'chart'], seed: SALES_SEED,
    prompt: 'En la página "Monthly sales" agregá arriba de la tabla un gráfico de barras con las ventas por mes y una fila de total al final de la tabla. Dejá todo lo demás como está.',
    expect: { tables: ['sales'], features: ['chart'], preserve: ['Monthly sales', "shareout.table('sales')"], patterns: ['total'] },
  },
  {
    id: 'edit-translate-es', language: 'es', kind: 'edit', tags: ['edit', 'landing'], seed: LANDING_SEED,
    prompt: 'Traducí al español toda la página "Studio" (títulos y textos) y agregale un botón de contacto que abra un mail. Que no quede nada en inglés.',
    expect: { language: 'es', patterns: ['mailto:'], preserve: ['<section'] },
  },
];
