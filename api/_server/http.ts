import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

export type VercelRequestLike = IncomingMessage & {
  body?: unknown;
  headers: IncomingHttpHeaders;
  method?: string;
};

export type VercelResponseLike = ServerResponse & {
  status: (statusCode: number) => VercelResponseLike;
  json: (data: unknown) => void;
};

export function sendJson(
  response: VercelResponseLike,
  data: unknown,
  status = 200,
) {
  response.status(status).json(data);
}

export function assertMethod(
  request: VercelRequestLike,
  response: VercelResponseLike,
  method: string,
) {
  if (request.method !== method) {
    sendJson(response, { error: `Method ${request.method} not allowed.` }, 405);
    return true;
  }
  return false;
}

export async function readRawBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
