// Showtime scenarios (work/044 §6.4). Builders resolve demo artifacts by slug and
// return a timeline the Showtime DO replays. Deterministic — demo-reset re-runs clean.

import type { Env } from '../types';
import type { TimelineStep } from './showtime';

const TICK_MS = 18_000;
const USD_ARS = 1_050;
const PRODUCTS = ['Buzo Terra Verde', 'Remera Oversize Terra', 'Gorra Terra', 'Tote Bag Terra', 'Medias Pack x3'];

export interface ScenarioMeta { name: string; label: string; company: string; approxMin: number; }
export const SCENARIOS: ScenarioMeta[] = [
  { name: 'lanzamiento', label: 'Hora del lanzamiento — Drop Terra Verde', company: 'terra', approxMin: 5 },
  { name: 'cierre-mensual', label: 'Cierre mensual — pipeline + utilización', company: 'solara', approxMin: 4 },
  { name: 'avance-obra', label: 'Avance de obra — Casa Núñez', company: 'alameda', approxMin: 5 },
  { name: 'quiebre-stock', label: 'Quiebre de stock salvado — Córdoba', company: 'meridiano', approxMin: 5 },
];

async function artifactBySlug(env: Env, workspaceId: string, slug: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE workspace_id = ? AND slug = ? AND deleted_at IS NULL LIMIT 1'
  ).bind(workspaceId, slug).first<{ id: string }>();
  return row?.id ?? null;
}

const hhmm = (startMin: number, i: number): string => {
  const t = startMin + i;
  return `${String(19 + Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function tickerRows(count: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let pedAcum = 0, usdAcum = 0;
  for (let i = 0; i < count; i++) {
    const pedidos = 38 + i * 4 + (i % 3 === 0 ? 6 : 0);
    const usd = pedidos * (19 + (i % 4));
    pedAcum += pedidos; usdAcum += usd;
    rows.push({
      minuto: i, hora: hhmm(0, i), pedidos,
      pedidos_acum: pedAcum,
      ingresos_usd_acum: usdAcum,
      ingresos_ars_acum: usdAcum * USD_ARS,
      producto: PRODUCTS[i % PRODUCTS.length],
    });
  }
  return rows;
}

// ── Terra flagship ───────────────────────────────────────────────────────────

async function terraLanzamiento(env: Env, workspaceId: string): Promise<TimelineStep[]> {
  const tracker = await artifactBySlug(env, workspaceId, 'drop-terra-verde');
  const ugc = await artifactBySlug(env, workspaceId, 'biblioteca-ugc');
  const inversores = await artifactBySlug(env, workspaceId, 'reporte-inversores');
  if (!tracker) throw new Error('artifact "drop-terra-verde" not found — publish the tracker (P3b) first');

  const N = 16;
  const rows = tickerRows(N);
  const SEED = 3;
  const milestone = rows.findIndex((r) => (r.ingresos_usd_acum as number) >= 10_000);

  const steps: TimelineStep[] = [];
  steps.push({ delayMs: 0, action: 'tick_dataset',
    params: { artifactId: tracker, dataset: 'lanzamiento_ticker', seed: rows.slice(0, SEED), rows: [] } });

  for (let i = SEED; i < N; i++) {
    const at = (i - SEED + 1) * TICK_MS;
    steps.push({ delayMs: at, action: 'tick_dataset',
      params: { artifactId: tracker, dataset: 'lanzamiento_ticker', rows: [rows[i]] } });
    if (i === milestone) {
      steps.push({ delayMs: at + 1500, action: 'fire_alert',
        params: { key: 'showtime:terra:lanzamiento:10k',
          message: '🎉 Terra & Co. — ¡USD 10.000 en el Drop Terra Verde! Pico de ventas en vivo.' } });
    }
  }

  const tail = (N - SEED + 2) * TICK_MS;
  if (ugc) {
    steps.push({ delayMs: Math.floor(tail * 0.55), action: 'tick_dataset',
      params: { artifactId: ugc, dataset: 'ugc_biblioteca', rows: [{
        asset_id: 'UGC-LIVE-001', creador: '@sofideco', plataforma: 'Instagram', tipo: 'Reel',
        engagement: 18400, fecha: '2026-07-10', url: 'https://instagram.com/p/drop-terra-verde' }] } });
    steps.push({ delayMs: Math.floor(tail * 0.55) + 800, action: 'notify',
      params: { message: '📸 Nuevo UGC del lanzamiento: @sofideco publicó un Reel (18.4k de engagement).' } });
  }
  if (inversores) {
    steps.push({ delayMs: tail, action: 'generate_tldr', params: { artifactId: inversores } });
    steps.push({ delayMs: tail + 800, action: 'notify',
      params: { message: '🧾 TL;DR del reporte a inversores actualizado con el cierre del lanzamiento.' } });
  }
  return steps.sort((a, b) => a.delayMs - b.delayMs);
}

// ── Solara flagship — pipeline moves + util alert + report TL;DR ─────────────

function solaraDeal(
  prospecto: string, etapa: string, valor: number, prob: number, responsable: string, dias: number,
): Record<string, unknown> {
  return {
    prospecto, etapa, valor_ars: valor, probabilidad_pct: prob,
    valor_ponderado_ars: Math.round(valor * prob / 100), responsable, dias_en_etapa: dias,
  };
}

function solaraPipelineBase(): Array<Record<string, unknown>> {
  return [
    solaraDeal('Nexplan', 'Propuesta', 8_400_000, 60, 'Valentina Ríos', 18),
    solaraDeal('Bahía Foods', 'Negociación', 5_200_000, 75, 'Tomás Bianchi', 12),
    solaraDeal('Clínica Vitalis', 'Descubrimiento', 3_100_000, 30, 'Valentina Ríos', 8),
    solaraDeal('Andes Outdoor', 'Propuesta', 6_700_000, 55, 'Marcos Pellegrini', 22),
    solaraDeal('Delta Seguros', 'Negociación', 9_800_000, 70, 'Tomás Bianchi', 15),
    solaraDeal('Pampa Logística', 'Ganado', 4_500_000, 100, 'Tomás Bianchi', 3),
  ];
}

function solaraUtilBase(dip: boolean): Array<Record<string, unknown>> {
  const people: Array<[string, string, number]> = [
    ['Valentina Ríos', 'Directora de Cuentas', 82],
    ['Marcos Pellegrini', 'Director Creativo', 74],
    ['Sofía Aldao', 'Diseñadora Sr.', 71],
    ['Julián Funes', 'Media Buyer', 88],
    ['Camila Ferreyra', 'Community Manager', 65],
    ['Tomás Bianchi', 'Estratega', 79],
    ['Lucía Peralta', 'Diseñadora Jr.', 58],
    ['Nicolás Sena', 'Data / Analytics', 84],
  ];
  return people.map(([persona, rol, util0]) => {
    const util = dip && persona === 'Sofía Aldao' ? 52
      : dip && persona === 'Lucía Peralta' ? 48
      : util0;
    return {
      persona, rol,
      horas_facturables: Math.round(160 * util / 100),
      horas_totales: 160,
      utilizacion_pct: util,
      estado: util > 90 ? 'Sobrecarga' : util < 65 ? 'Bajo' : 'OK',
    };
  });
}

async function solaraCierreMensual(env: Env, workspaceId: string): Promise<TimelineStep[]> {
  const pipeline = await artifactBySlug(env, workspaceId, 'pipeline-negocios');
  const pnl = await artifactBySlug(env, workspaceId, 'pnl-utilizacion');
  const reporte = await artifactBySlug(env, workspaceId, 'reporte-mensual-lumera');
  if (!pipeline) throw new Error('artifact "pipeline-negocios" not found — publish Solara P2 first');

  const steps: TimelineStep[] = [];
  const base = solaraPipelineBase();
  steps.push({ delayMs: 0, action: 'tick_dataset',
    params: { artifactId: pipeline, dataset: 'pipeline_negocios', replace: true, rows: base } });
  if (pnl) {
    steps.push({ delayMs: 500, action: 'tick_dataset',
      params: { artifactId: pnl, dataset: 'utilizacion_equipo', replace: true, rows: solaraUtilBase(false) } });
  }

  // Beat 1: client feedback notify (sales phone buzzes).
  steps.push({ delayMs: 12_000, action: 'notify',
    params: { message: '💬 Lumera Cosmética: "el logo pesa mucho, ¿probamos versión clara?" — Sofía responde en el hilo.' } });

  // Beat 2: Nexplan advances, Bahía closes.
  const mid = base.map((r) => {
    if (r.prospecto === 'Nexplan') {
      return solaraDeal('Nexplan', 'Negociación', 8_400_000, 80, 'Valentina Ríos', 2);
    }
    if (r.prospecto === 'Bahía Foods') {
      return solaraDeal('Bahía Foods', 'Ganado', 5_200_000, 100, 'Tomás Bianchi', 1);
    }
    return r;
  });
  steps.push({ delayMs: 28_000, action: 'tick_dataset',
    params: { artifactId: pipeline, dataset: 'pipeline_negocios', replace: true, rows: mid } });
  steps.push({ delayMs: 29_000, action: 'notify',
    params: { message: '✅ Bahía Foods cerrado · $5,2M ARS. Nexplan pasó a Negociación.' } });

  // Beat 3: utilization dips below target → alert.
  if (pnl) {
    steps.push({ delayMs: 50_000, action: 'tick_dataset',
      params: { artifactId: pnl, dataset: 'utilizacion_equipo', replace: true, rows: solaraUtilBase(true) } });
    steps.push({ delayMs: 52_000, action: 'fire_alert',
      params: { key: 'showtime:solara:util:dip',
        message: '⚠️ Solara — utilización creativa por debajo del 75% (Sofía 52%, Lucía 48%).' } });
  }

  // Beat 4: v2 uploaded + approval (notify stand-in for full approval room).
  steps.push({ delayMs: 80_000, action: 'notify',
    params: { message: '📎 Sofía subió "logo-lumera-v2-claro.pdf" · pide aprobación de Valentina.' } });
  steps.push({ delayMs: 100_000, action: 'notify',
    params: { message: '✅ Valentina aprobó el creativo · Lumera abrió el entregable (read receipt 18:32).' } });

  // Beat 5: report TL;DR.
  if (reporte) {
    steps.push({ delayMs: 120_000, action: 'generate_tldr', params: { artifactId: reporte } });
    steps.push({ delayMs: 122_000, action: 'notify',
      params: { message: '🧾 TL;DR del reporte mensual Lumera listo para mandar al cliente.' } });
  }

  // Recovery util for a clean close.
  if (pnl) {
    steps.push({ delayMs: 140_000, action: 'tick_dataset',
      params: { artifactId: pnl, dataset: 'utilizacion_equipo', replace: true, rows: solaraUtilBase(false) } });
  }

  return steps.sort((a, b) => a.delayMs - b.delayMs);
}

// ── Alameda flagship — obra avance ticks + hitos + alert ─────────────────────

function alamedaObras(avanceNunez: number, saavedraAtraso: number): Array<Record<string, unknown>> {
  return [
    { obra: 'Casa Núñez', cliente: 'Familia Núñez', tipo: 'obra', avance_pct: avanceNunez,
      presupuesto_ars: 185_000_000, certificado_ars: Math.round(185_000_000 * avanceNunez / 100),
      estado: 'En obra', atraso_dias: 2, proximo_hito: avanceNunez >= 78 ? 'Revoques y terminaciones' : 'Instalación carpintería',
      fecha_fin_est: '2026-09-15' },
    { obra: 'Ampliación Saavedra', cliente: 'Estudio Contable RS', tipo: 'obra', avance_pct: 41,
      presupuesto_ars: 92_000_000, certificado_ars: 40_000_000,
      estado: saavedraAtraso > 10 ? 'Atrasada' : 'En obra', atraso_dias: saavedraAtraso,
      proximo_hito: 'Instalaciones', fecha_fin_est: '2026-10-02' },
    { obra: 'Local Belgrano', cliente: 'Indumentaria Vero', tipo: 'obra', avance_pct: 83,
      presupuesto_ars: 54_000_000, certificado_ars: 45_000_000,
      estado: 'En obra', atraso_dias: 0, proximo_hito: 'Pintura', fecha_fin_est: '2026-08-01' },
    { obra: 'Depto Palermo', cliente: 'A. Ferrari', tipo: 'diseño', avance_pct: 90,
      presupuesto_ars: 12_000_000, certificado_ars: 10_800_000,
      estado: 'En obra', atraso_dias: 0, proximo_hito: 'Entrega de renders', fecha_fin_est: '2026-07-20' },
  ];
}

function alamedaHitos(carpState: string): Array<Record<string, unknown>> {
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return [
    { hito: 'Demolición y movimiento de suelos', fecha: day(-120), estado: 'Completado', completado: true },
    { hito: 'Fundaciones y platea', fecha: day(-95), estado: 'Completado', completado: true },
    { hito: 'Estructura y losas', fecha: day(-60), estado: 'Completado', completado: true },
    { hito: 'Mampostería y cerramientos', fecha: day(-30), estado: 'Completado', completado: true },
    {
      hito: 'Instalaciones (agua/luz/gas)', fecha: day(-8),
      estado: carpState === 'Pendiente' ? 'En curso' : 'Completado',
      completado: carpState !== 'Pendiente',
    },
    { hito: 'Instalación carpintería', fecha: day(12), estado: carpState, completado: carpState === 'Completado' },
    { hito: 'Revoques y terminaciones', fecha: day(35), estado: 'Pendiente', completado: false },
    { hito: 'Pintura y entrega final', fecha: day(60), estado: 'Pendiente', completado: false },
  ];
}

async function alamedaAvanceObra(env: Env, workspaceId: string): Promise<TimelineStep[]> {
  const obras = await artifactBySlug(env, workspaceId, 'obras-en-curso');
  const portal = await artifactBySlug(env, workspaceId, 'portal-casa-nunez');
  if (!obras) throw new Error('artifact "obras-en-curso" not found — publish Alameda P2 first');

  const target = portal ?? obras;
  const steps: TimelineStep[] = [];

  steps.push({ delayMs: 0, action: 'tick_dataset',
    params: { artifactId: obras, dataset: 'obras', replace: true, rows: alamedaObras(68, 18) } });
  steps.push({ delayMs: 300, action: 'tick_dataset',
    params: { artifactId: target, dataset: 'hitos_casa_nunez', replace: true, rows: alamedaHitos('Pendiente') } });

  // Foreman photo lands.
  steps.push({ delayMs: 15_000, action: 'notify',
    params: { message: '📷 Capataz · Casa Núñez: 4 fotos nuevas desde obra (email → Files inbox).' } });

  // Avance ticks 68 → 72 → 76 → 81.
  const av = [72, 76, 81];
  av.forEach((pct, i) => {
    const at = 35_000 + i * 22_000;
    steps.push({ delayMs: at, action: 'tick_dataset',
      params: { artifactId: obras, dataset: 'obras', replace: true, rows: alamedaObras(pct, 18 - i * 4) } });
    if (portal) {
      steps.push({ delayMs: at + 200, action: 'tick_dataset',
        params: { artifactId: portal, dataset: 'obras', replace: true, rows: alamedaObras(pct, 18 - i * 4) } });
    }
  });

  // Client question + contractor reply.
  steps.push({ delayMs: 55_000, action: 'notify',
    params: { message: '💬 Familia Núñez: "¿cuándo llega la carpintería?"' } });
  steps.push({ delayMs: 75_000, action: 'notify',
    params: { message: '🔧 Electricidad Gómez / Carpintería Sur: "confirmado martes, entrega en obra."' } });

  // Carpintería completes + Saavedra delay alert.
  steps.push({ delayMs: 100_000, action: 'tick_dataset',
    params: { artifactId: target, dataset: 'hitos_casa_nunez', replace: true, rows: alamedaHitos('Completado') } });
  steps.push({ delayMs: 105_000, action: 'fire_alert',
    params: { key: 'showtime:alameda:saavedra:atraso',
      message: '🚨 Alameda — Ampliación Saavedra: desvío de costos +17% y atraso de 14 días.' } });
  steps.push({ delayMs: 130_000, action: 'notify',
    params: { message: '✅ Casa Núñez 81% · carpintería instalada · cliente ve el portal actualizado.' } });

  return steps.sort((a, b) => a.delayMs - b.delayMs);
}

// ── Meridiano flagship — stock crunch then recovery ──────────────────────────

function meridianoInv(mode: 'crisis' | 'recovery'): Array<Record<string, unknown>> {
  const skus = [
    ['MD-ACE-001', 'Aceite Girasol 1.5L', 'Córdoba', 'crisis'],
    ['MD-YER-001', 'Yerba Mate 1kg', 'Córdoba', 'crisis'],
    ['MD-GAS-001', 'Gaseosa Cola 2.25L', 'Rosario', 'crisis'],
    ['MD-HAR-001', 'Harina 000 x 1kg', 'Central (Bs As)', 'ok'],
    ['MD-AZU-001', 'Azúcar x 1kg', 'Mendoza', 'ok'],
    ['MD-FID-001', 'Fideos Guiseros 500g', 'Central (Bs As)', 'ok'],
  ] as const;
  return skus.map(([sku, producto, deposito, kind]) => {
    const crisis = kind === 'crisis';
    const stock = mode === 'crisis' && crisis ? 18 : mode === 'recovery' && crisis ? 240 : 320;
    const reorden = 120;
    return {
      deposito, sku, producto, categoria: 'Almacén',
      stock, punto_reorden: reorden,
      dias_cobertura: Math.round((stock / 18) * 10) / 10,
      estado: stock < reorden * 0.5 ? 'Quiebre' : stock < reorden ? 'Bajo' : 'OK',
    };
  });
}

async function meridianoQuiebreStock(env: Env, workspaceId: string): Promise<TimelineStep[]> {
  const inv = await artifactBySlug(env, workspaceId, 'inventario-depositos');
  const score = await artifactBySlug(env, workspaceId, 'scorecard-proveedores');
  if (!inv) throw new Error('artifact "inventario-depositos" not found — publish Meridiano P2 first');

  const steps: TimelineStep[] = [];
  steps.push({ delayMs: 0, action: 'tick_dataset',
    params: { artifactId: inv, dataset: 'inventario_depositos', replace: true, rows: meridianoInv('crisis') } });

  // Orders stream in (notify stand-in for embudo artifact if missing).
  steps.push({ delayMs: 12_000, action: 'notify',
    params: { message: '📦 +38 pedidos ingresados · embudo en vivo (Almacén San Martín x12).' } });
  steps.push({ delayMs: 28_000, action: 'notify',
    params: { message: '📦 +22 pedidos · Córdoba pidiendo Aceite y Yerba (stock crítico).' } });

  steps.push({ delayMs: 40_000, action: 'fire_alert',
    params: { key: 'showtime:meridiano:stock:cba',
      message: '🚨 Meridiano — quiebre inminente en Córdoba: Aceite Girasol y Yerba Mate (< 1 día de cobertura).' } });

  steps.push({ delayMs: 60_000, action: 'notify',
    params: { message: '📝 OC-4821 publicada a Aceitera del Litoral · 400 u. aceite + 300 u. yerba.' } });
  steps.push({ delayMs: 85_000, action: 'notify',
    params: { message: '🏭 Aceitera del Litoral: "confirmado, sale el jueves."' } });

  // Stock recovers.
  steps.push({ delayMs: 110_000, action: 'tick_dataset',
    params: { artifactId: inv, dataset: 'inventario_depositos', replace: true, rows: meridianoInv('recovery') } });
  steps.push({ delayMs: 112_000, action: 'notify',
    params: { message: '✅ Inventario Córdoba repuesto · alertas de quiebre resueltas.' } });

  if (score) {
    steps.push({ delayMs: 125_000, action: 'tick_dataset',
      params: { artifactId: score, dataset: 'scorecard_proveedores', replace: true, rows: [
        { proveedor: 'Aceitera del Litoral', otif_pct: 91.2, fill_rate_pct: 94, lead_time_dias: 4, dso_dias: 40, estado: 'OK' },
        { proveedor: 'Molinos Pampa', otif_pct: 94.2, fill_rate_pct: 97, lead_time_dias: 3, dso_dias: 36, estado: 'OK' },
        { proveedor: 'Yerbatera Misiones', otif_pct: 91.0, fill_rate_pct: 93, lead_time_dias: 5, dso_dias: 38, estado: 'OK' },
        { proveedor: 'Bebidas del Sur', otif_pct: 88.7, fill_rate_pct: 91, lead_time_dias: 4, dso_dias: 42, estado: 'OK' },
        { proveedor: 'Distribuidora Norte', otif_pct: 83.4, fill_rate_pct: 86, lead_time_dias: 7, dso_dias: 55, estado: 'Bajo objetivo' },
      ] } });
  }

  steps.push({ delayMs: 140_000, action: 'notify',
    params: { message: '📊 Scorecard: Aceitera del Litoral sube a 91% OTIF después de la OC de emergencia.' } });

  return steps.sort((a, b) => a.delayMs - b.delayMs);
}

const BUILDERS: Record<string, (env: Env, workspaceId: string) => Promise<TimelineStep[]>> = {
  lanzamiento: terraLanzamiento,
  'cierre-mensual': solaraCierreMensual,
  'avance-obra': alamedaAvanceObra,
  'quiebre-stock': meridianoQuiebreStock,
};

export async function buildScenario(env: Env, name: string, workspaceId: string): Promise<TimelineStep[]> {
  const build = BUILDERS[name];
  if (!build) throw new Error(`unknown scenario: ${name}`);
  return build(env, workspaceId);
}
