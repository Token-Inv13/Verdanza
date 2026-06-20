export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

export function assertMethod(request: Request, method: string) {
  if (request.method !== method) {
    return jsonResponse({ error: `Method ${request.method} not allowed.` }, 405);
  }
  return null;
}
