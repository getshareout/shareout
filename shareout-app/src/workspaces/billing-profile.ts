// Who a workspace's invoices are made out to (workspace_billing_profiles). An Argentine invoice
// needs the buyer's legal name, CUIT, IVA condition and fiscal address; the operator also wants a
// postal code and a phone. Owners and admins keep it from Admin → Billing; the operator reads it.

import type { Env } from '../types';

export const TAX_CONDITIONS = ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'] as const;
export type TaxCondition = (typeof TAX_CONDITIONS)[number];

export interface BillingProfile {
  country: string;
  legal_name: string;
  tax_id: string;
  tax_condition: TaxCondition | null;
  address: string;
  city: string;
  province: string | null;
  postal_code: string;
  phone: string;
  billing_email: string | null;
}

export interface StoredBillingProfile extends BillingProfile {
  updated_at: string;
  updated_by_email: string | null;
}

/** Field → why it was refused: `required`, `invalid` or `too_long`. */
export type BillingProfileErrors = Partial<Record<keyof BillingProfile, 'required' | 'invalid' | 'too_long'>>;

const LIMITS: Record<string, number> = {
  legal_name: 200, tax_id: 32, address: 200, city: 100, province: 100, postal_code: 12, phone: 32, billing_email: 254,
};

/** A CUIT/CUIL as 11 digits, or null. Dots, dashes and spaces are ignored; the last digit is AFIP's
 *  mod-11 check over the first ten (weights 5432765432), and a remainder that would need a 10 is no CUIT. */
export function normalizeCuit(raw: string): string | null {
  const d = raw.replace(/[\s.-]/g, '');
  if (!/^\d{11}$/.test(d)) return null;
  const sum = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((n, w, i) => n + w * Number(d[i]), 0);
  const check = 11 - (sum % 11);
  const expected = check === 11 ? 0 : check;
  return expected === Number(d[10]) ? d : null;
}

/** 20-12345678-9 — how a CUIT is written. */
export const formatCuit = (d: string): string => (/^\d{11}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d);

const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Validate and normalize a PUT body. Every problem is reported at once so the form can mark each field. */
export function parseBillingProfile(body: unknown): { profile: BillingProfile } | { errors: BillingProfileErrors } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: BillingProfileErrors = {};
  const country = (text(b.country) || 'AR').toUpperCase();
  const ar = country === 'AR';
  if (!/^[A-Z]{2}$/.test(country)) errors.country = 'invalid';

  const field = (k: keyof BillingProfile, required: boolean): string => {
    const v = text(b[k]);
    if (!v) { if (required) errors[k] = 'required'; return ''; }
    if (v.length > (LIMITS[k] ?? 200)) errors[k] = 'too_long';
    return v;
  };
  const legal_name = field('legal_name', true);
  const address = field('address', true);
  const city = field('city', true);
  const province = field('province', ar);
  const phone = field('phone', true);
  const billing_email = field('billing_email', false).toLowerCase();
  let tax_id = field('tax_id', true);
  let postal_code = field('postal_code', true).toUpperCase();

  if (tax_id && !errors.tax_id) {
    if (ar) { const cuit = normalizeCuit(tax_id); if (cuit) tax_id = cuit; else errors.tax_id = 'invalid'; }
    else if (!/^[A-Za-z0-9 .\-/]{3,32}$/.test(tax_id)) errors.tax_id = 'invalid';
  }
  // Argentina: the old 4-digit code or the CPA (C1425DKA). Elsewhere letters, digits, spaces, dashes.
  if (postal_code && !errors.postal_code) {
    postal_code = postal_code.replace(/\s+/g, ar ? '' : ' ');
    if (!(ar ? /^([A-Z]\d{4}[A-Z]{3}|\d{4})$/ : /^[A-Z0-9][A-Z0-9 -]{1,10}$/).test(postal_code)) errors.postal_code = 'invalid';
  }
  if (phone && !errors.phone) {
    const digits = phone.replace(/\D/g, '').length;
    if (!/^\+?[\d\s()./-]+$/.test(phone) || digits < 6 || digits > 15) errors.phone = 'invalid';
  }
  if (billing_email && !errors.billing_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing_email)) errors.billing_email = 'invalid';

  let tax_condition: TaxCondition | null = null;
  if (ar) {
    const c = text(b.tax_condition);
    if (!c) errors.tax_condition = 'required';
    else if (!(TAX_CONDITIONS as readonly string[]).includes(c)) errors.tax_condition = 'invalid';
    else tax_condition = c as TaxCondition;
  }

  if (Object.keys(errors).length) return { errors };
  return {
    profile: {
      country, legal_name, tax_id, tax_condition, address, city, province: province || null, postal_code, phone,
      billing_email: billing_email || null,
    },
  };
}

export async function getBillingProfile(env: Env, workspaceId: string): Promise<StoredBillingProfile | null> {
  const row = await env.DB.prepare(
    `SELECT p.country, p.legal_name, p.tax_id, p.tax_condition, p.address, p.city, p.province, p.postal_code, p.phone,
            p.billing_email, p.updated_at, u.email AS updated_by_email
       FROM workspace_billing_profiles p LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.workspace_id = ?`,
  ).bind(workspaceId).first<StoredBillingProfile>();
  return row ?? null;
}

export async function saveBillingProfile(env: Env, workspaceId: string, p: BillingProfile, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace_billing_profiles
       (workspace_id, country, legal_name, tax_id, tax_condition, address, city, province, postal_code, phone, billing_email, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id) DO UPDATE SET
       country = excluded.country, legal_name = excluded.legal_name, tax_id = excluded.tax_id,
       tax_condition = excluded.tax_condition, address = excluded.address, city = excluded.city,
       province = excluded.province, postal_code = excluded.postal_code, phone = excluded.phone,
       billing_email = excluded.billing_email, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(
    workspaceId, p.country, p.legal_name, p.tax_id, p.tax_condition, p.address, p.city, p.province, p.postal_code, p.phone,
    p.billing_email, userId,
  ).run();
}
