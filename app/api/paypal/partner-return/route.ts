export async function GET(): Promise<Response> {
  return Response.json({ error: "not_implemented", route: "partner-return" }, { status: 501 });
}
