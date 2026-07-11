import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  buildIndexNowBatch,
  buildIndexNowPayload,
  formatDryRun,
  normalizeIndexNowUrl,
  parseIndexNowArgs,
  submitIndexNow,
} from "./indexNowCore";

type TestResult = {
  name: string;
  ok: boolean;
  detail?: string;
};

const results: TestResult[] = [];

await run("normalizes one valid URL", () => {
  const batch = buildIndexNowBatch(
    parseIndexNowArgs(["--url", "https://verdanza.fr/produits/golden-static#section"]),
  );
  assertEqual(batch.urls, ["https://verdanza.fr/produits/golden-static"]);
});

await run("normalizes several URLs", () => {
  const batch = buildIndexNowBatch(
    parseIndexNowArgs([
      "--url",
      "https://verdanza.fr/fleurs-cbd",
      "--url",
      "https://verdanza.fr/produits/golden-static",
    ]),
  );
  assertEqual(batch.urls, [
    "https://verdanza.fr/fleurs-cbd",
    "https://verdanza.fr/produits/golden-static",
  ]);
});

await run("deduplicates URLs", () => {
  const batch = buildIndexNowBatch(
    parseIndexNowArgs([
      "--url",
      "https://verdanza.fr/fleurs-cbd",
      "--url",
      "https://verdanza.fr/fleurs-cbd/",
    ]),
  );
  assertEqual(batch.urls, ["https://verdanza.fr/fleurs-cbd"]);
});

await run("rejects another domain", () => {
  assertThrows(() => normalizeIndexNowUrl("https://example.com/fleurs-cbd", "indexable"));
});

await run("rejects HTTP", () => {
  assertThrows(() => normalizeIndexNowUrl("http://verdanza.fr/fleurs-cbd", "indexable"));
});

await run("rejects private route", () => {
  assertThrows(() => normalizeIndexNowUrl("https://verdanza.fr/compte", "indexable"));
});

await run("accepts deleted URL outside sitemap", () => {
  const batch = buildIndexNowBatch(
    parseIndexNowArgs(["--deleted", "https://verdanza.fr/ancienne-page"]),
  );
  assertEqual(batch.deletedUrls, ["https://verdanza.fr/ancienne-page"]);
});

await run("dry-run does not call network", () => {
  const batch = buildIndexNowBatch(parseIndexNowArgs(["--all-indexable", "--dry-run"]));
  const output = formatDryRun(batch);
  if (!output.includes("No external request sent")) throw new Error("missing dry-run marker");
  if (!output.includes("URL count: 25")) throw new Error("missing URL count");
});

for (const status of [200, 202, 403, 422, 429]) {
  await run(`handles HTTP ${status}`, async () => {
    const server = await createMockServer((_, response) => {
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(`status ${status}`);
    });
    try {
      const batch = buildIndexNowBatch(
        parseIndexNowArgs(["--url", "https://verdanza.fr/produits/golden-static"]),
      );
      const result = await submitIndexNow(batch, {
        endpoint: server.url,
        timeoutMs: 2000,
      });
      if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}`);
      if ([200, 202].includes(status) !== result.ok) throw new Error(`unexpected ok=${result.ok}`);
    } finally {
      await server.close();
    }
  });
}

await run("sends expected JSON payload to mock endpoint", async () => {
  let body = "";
  const server = await createMockServer(async (request, response) => {
    body = await readRequestBody(request);
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
  });
  try {
    const batch = buildIndexNowBatch(
      parseIndexNowArgs(["--url", "https://verdanza.fr/produits/golden-static"]),
    );
    await submitIndexNow(batch, { endpoint: server.url, timeoutMs: 2000 });
    assertEqual(JSON.parse(body), buildIndexNowPayload(batch));
  } finally {
    await server.close();
  }
});

await run("handles timeout", async () => {
  const server = await createMockServer(() => undefined);
  try {
    const batch = buildIndexNowBatch(
      parseIndexNowArgs(["--url", "https://verdanza.fr/produits/golden-static"]),
    );
    let timedOut = false;
    try {
      await submitIndexNow(batch, { endpoint: server.url, timeoutMs: 100 });
    } catch (error) {
      timedOut = error instanceof Error && error.message.includes("timed out");
    }
    if (!timedOut) throw new Error("timeout was not reported");
  } finally {
    await server.close();
  }
});

console.table(results);
if (results.some((result) => !result.ok)) process.exitCode = 1;
else console.log("IndexNow tests passed.");

async function run(name: string, test: () => void | Promise<void>) {
  try {
    await test();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(callback: () => unknown) {
  let threw = false;
  try {
    callback();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected function to throw");
}

async function createMockServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
) {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server address unavailable");
  return {
    url: `http://127.0.0.1:${address.port}/indexnow`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolveRead, rejectRead) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolveRead(body));
    request.on("error", rejectRead);
  });
}
