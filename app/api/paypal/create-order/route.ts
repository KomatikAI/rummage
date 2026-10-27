export async function POST(): Promise<Response> {
  return Response.json({ error: "not_implemented", route: "create-order" }, { status: 501 });
}
