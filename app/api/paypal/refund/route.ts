export async function POST(): Promise<Response> {
  return Response.json({ error: "not_implemented", route: "refund" }, { status: 501 });
}
