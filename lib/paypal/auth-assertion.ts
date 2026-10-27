/**
 * Builds the PayPal-Auth-Assertion header value for acting on a seller's
 * behalf: an unsigned JWT, `base64url({"alg":"none"})` + "." +
 * `base64url({"iss":clientId,"payer_id":merchantId})` + "." (empty signature).
 *
 * Only the `payer_id` form is supported; the `email` form is deliberately not.
 */
export function buildAuthAssertion(clientId: string, merchantId: string): string {
  if (!clientId.trim()) throw new Error("buildAuthAssertion: clientId is required");
  if (!merchantId.trim()) throw new Error("buildAuthAssertion: merchantId is required");
  const header = base64url(JSON.stringify({ alg: "none" }));
  const payload = base64url(JSON.stringify({ iss: clientId, payer_id: merchantId }));
  return `${header}.${payload}.`;
}

function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}
