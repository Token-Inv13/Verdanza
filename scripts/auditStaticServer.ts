import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";

type AuditStaticServerOptions = {
  root?: string;
  notFoundPaths?: Iterable<string>;
};

export async function startAuditStaticServer(options: AuditStaticServerOptions = {}) {
  const root = resolve(options.root || "dist");
  const notFoundPaths = new Set(
    [...(options.notFoundPaths || [])].map((path) => normalizePathname(path)),
  );
  const fallbackFile = resolve(root, "404.html");

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Audit build directory is missing: ${root}`);
  }
  if (!existsSync(fallbackFile)) {
    throw new Error(`Audit 404 document is missing: ${fallbackFile}`);
  }

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = normalizePathname(decodeURIComponent(url.pathname));
      const routeFile = resolveRouteFile(root, pathname);
      const isNotFound = notFoundPaths.has(pathname) || !routeFile;
      const file = routeFile || fallbackFile;
      const body = readFileSync(file);

      response.writeHead(isNotFound ? 404 : 200, {
        "content-type": contentType(file),
        "content-length": body.byteLength,
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Audit static server error");
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Audit static server did not expose a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

function resolveRouteFile(root: string, pathname: string) {
  if (pathname === "/") return existingFile(root, resolve(root, "index.html"));

  const cleanPath = pathname.replace(/^\/+/, "");
  const candidates = extname(cleanPath)
    ? [resolve(root, cleanPath)]
    : [resolve(root, `${cleanPath}.html`), resolve(root, cleanPath, "index.html")];

  for (const candidate of candidates) {
    const file = existingFile(root, candidate);
    if (file) return file;
  }
  return "";
}

function existingFile(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath === "index.html") {
    return existsSync(candidate) && statSync(candidate).isFile() ? candidate : "";
  }
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return "";
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : "";
}

function normalizePathname(path: string) {
  const pathname = new URL(path, "https://verdanza.fr").pathname;
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function contentType(file: string) {
  switch (extname(file).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".webmanifest":
      return "application/json; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
