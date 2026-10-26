/** Failure body for the sign-in routes: keeps `ok:false` for older clients and adds the canonical `success:false` + stable `code`. */
export function otpFailureBody(r: { error?: string; code?: string }) {
  return { ok: false, success: false, error: r.error, code: r.code };
}
