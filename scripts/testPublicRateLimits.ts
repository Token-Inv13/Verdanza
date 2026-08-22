import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessPublicSubmissionTrap,
  enforcePublicSubmissionRateLimit,
  extractTrustedClientIp,
  normalizeRateLimitEmail,
  publicRateLimitRules,
  publicRateLimitsCollection,
  sendPublicRateLimitResponse,
  type PublicSubmissionRoute,
} from "../api/_server/publicRateLimit.js";
import type {
  VercelRequestLike,
  VercelResponseLike,
} from "../api/_server/http.js";

type StoredDocument = Record<string, unknown>;

class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly value?: StoredDocument,
  ) {}

  get exists() {
    return Boolean(this.value);
  }

  data() {
    return this.value;
  }
}

class FakeDocumentReference {
  constructor(
    private readonly database: FakeFirestore,
    readonly path: string,
  ) {}

  get id() {
    return this.path.split("/").at(-1) || "";
  }
}

class FakeCollectionReference {
  constructor(
    private readonly database: FakeFirestore,
    private readonly name: string,
  ) {}

  doc(id: string) {
    return new FakeDocumentReference(this.database, `${this.name}/${id}`);
  }
}

class FakeTransaction {
  private readonly writes: Array<{
    ref: FakeDocumentReference;
    value: StoredDocument;
  }> = [];

  constructor(private readonly database: FakeFirestore) {}

  get(ref: FakeDocumentReference) {
    return Promise.resolve(this.database.snapshot(ref));
  }

  set(ref: FakeDocumentReference, value: StoredDocument) {
    this.writes.push({ ref, value });
  }

  commit() {
    for (const write of this.writes) this.database.apply(write.ref, write.value);
  }
}

class FakeFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly writes: string[] = [];
  private transactionLock: Promise<void> = Promise.resolve();

  collection(name: string) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
    const previous = this.transactionLock;
    let release = () => {};
    this.transactionLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const transaction = new FakeTransaction(this);
    try {
      const result = await callback(transaction);
      transaction.commit();
      return result;
    } finally {
      release();
    }
  }

  snapshot(ref: FakeDocumentReference) {
    return new FakeSnapshot(ref.id, this.documents.get(ref.path));
  }

  apply(ref: FakeDocumentReference, value: StoredDocument) {
    this.documents.set(ref.path, { ...value });
    this.writes.push(ref.path);
  }
}

class ThrowingFirestore extends FakeFirestore {
  override async runTransaction<T>(
    _callback: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    void _callback;
    throw new Error("synthetic_storage_outage");
  }
}

class FakeResponse {
  statusCode = 200;
  body: unknown;
  readonly headers = new Map<string, string>();

  status(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  json(data: unknown) {
    this.body = data;
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }
}

const secret = "rate-limit-test-secret-which-is-longer-than-thirty-two-characters";
const baseNow = Date.UTC(2026, 7, 1, 10, 5, 0);
const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
const originalInfo = console.info;
const originalWarn = console.warn;
const silent = () => {};
console.info = silent;
console.warn = silent;

function test(name: string, run: () => void | Promise<void>) {
  tests.push({ name, run });
}

function requestFor(network: string, forwarded?: string) {
  return {
    method: "POST",
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
    socket: { remoteAddress: network },
  } as unknown as VercelRequestLike;
}

function attemptId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function submit(
  db: FakeFirestore,
  input: {
    route?: PublicSubmissionRoute;
    email?: string;
    network?: string;
    anonymousId?: string;
    attempt?: number;
    fingerprint?: string;
    nowMs?: number;
    authenticated?: boolean;
    providedSecret?: string;
  } = {},
) {
  const route = input.route ?? "/api/create-order";
  const attempt = input.attempt ?? 1;
  return enforcePublicSubmissionRateLimit({
    route,
    request: requestFor(input.network ?? "198.51.100.10"),
    email: input.email ?? "client@example.test",
    anonymousId: input.anonymousId,
    authenticated: input.authenticated ?? false,
    attemptId: route === "/api/create-order" ? attemptId(attempt) : undefined,
    attemptPayloadFingerprint:
      route === "/api/create-order"
        ? input.fingerprint ?? `payload-${attempt}`
        : undefined,
    nowMs: input.nowMs ?? baseNow,
    secret: input.providedSecret ?? secret,
    db: db as unknown as FirebaseFirestore.Firestore,
  });
}

test("la premiere tentative de commande est autorisee", async () => {
  const result = await submit(new FakeFirestore());
  assert.equal(result.allowed, true);
  assert.equal(result.code, "allowed");
});

test("la limite reseau courte est atomique sous concurrence", async () => {
  const db = new FakeFirestore();
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      submit(db, {
        attempt: index + 1,
        email: `client-${index}@example.test`,
        network: "198.51.100.20",
      }),
    ),
  );
  assert.equal(results.filter((result) => result.allowed).length, 5);
  assert.equal(results.filter((result) => !result.allowed).length, 1);
});

test("la limite email suit un client sur des reseaux independants", async () => {
  const db = new FakeFirestore();
  const results = [];
  for (let index = 0; index < 4; index += 1) {
    results.push(
      await submit(db, {
        attempt: index + 1,
        email: "same@example.test",
        network: `198.51.100.${30 + index}`,
      }),
    );
  }
  assert.deepEqual(results.map((result) => result.allowed), [true, true, true, false]);
});

test("un reseau partage conserve un quota distinct par email", async () => {
  const db = new FakeFirestore();
  for (let index = 0; index < 5; index += 1) {
    const result = await submit(db, {
      attempt: index + 1,
      email: `household-${index}@example.test`,
      network: "203.0.113.40",
    });
    assert.equal(result.allowed, true);
  }
});

test("la limite contact bloque le quatrieme envoi horaire du meme email", async () => {
  const db = new FakeFirestore();
  const results = [];
  for (let index = 0; index < 4; index += 1) {
    results.push(
      await submit(db, {
        route: "/api/contact",
        email: "contact@example.test",
        network: `198.51.100.${50 + index}`,
      }),
    );
  }
  assert.deepEqual(results.map((result) => result.allowed), [true, true, true, false]);
});

test("les quotas contact et commande sont isoles", async () => {
  const db = new FakeFirestore();
  for (let index = 0; index < 3; index += 1) {
    await submit(db, { route: "/api/contact", email: "route@example.test" });
  }
  const order = await submit(db, {
    attempt: 40,
    email: "route@example.test",
  });
  assert.equal(order.allowed, true);
});

test("une nouvelle fenetre courte reautorise la soumission", async () => {
  const db = new FakeFirestore();
  for (let index = 0; index < 3; index += 1) {
    await submit(db, {
      route: "/api/contact",
      email: "window@example.test",
      network: `198.51.100.${60 + index}`,
    });
  }
  const blocked = await submit(db, {
    route: "/api/contact",
    email: "window@example.test",
    network: "198.51.100.70",
  });
  const nextWindow = await submit(db, {
    route: "/api/contact",
    email: "window@example.test",
    network: "198.51.100.71",
    nowMs: baseNow + 60 * 60_000,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(nextWindow.allowed, true);
});

test("un blocage fournit un Retry-After positif", async () => {
  const db = new FakeFirestore();
  let result = await submit(db);
  for (let index = 2; index <= 4; index += 1) {
    result = await submit(db, { attempt: index });
  }
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSeconds > 0);
});

test("un retry identique reste autorise meme apres saturation", async () => {
  const db = new FakeFirestore();
  const first = await submit(db, { attempt: 80, fingerprint: "same-payload" });
  await submit(db, { attempt: 81 });
  await submit(db, { attempt: 82 });
  const blocked = await submit(db, { attempt: 83 });
  const retry = await submit(db, { attempt: 80, fingerprint: "same-payload" });
  assert.equal(first.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(retry.allowed, true);
  assert.equal(retry.code, "attempt_retry");
});

test("un meme identifiant avec un autre payload reste en conflit", async () => {
  const db = new FakeFirestore();
  await submit(db, { attempt: 90, fingerprint: "payload-a" });
  const conflict = await submit(db, { attempt: 90, fingerprint: "payload-b" });
  assert.equal(conflict.allowed, false);
  assert.equal(conflict.code, "checkout_request_conflict");
});

test("une tentative bloquee ne produit aucune ecriture", async () => {
  const db = new FakeFirestore();
  for (let index = 1; index <= 3; index += 1) await submit(db, { attempt: index });
  const before = db.writes.length;
  const blocked = await submit(db, { attempt: 4 });
  assert.equal(blocked.allowed, false);
  assert.equal(db.writes.length, before);
});

test("une configuration secrete absente echoue en mode ouvert", async () => {
  const originalSecret = process.env.RATE_LIMIT_HMAC_SECRET;
  delete process.env.RATE_LIMIT_HMAC_SECRET;
  try {
    const db = new FakeFirestore();
    const result = await enforcePublicSubmissionRateLimit({
      route: "/api/contact",
      request: requestFor("198.51.100.90"),
      email: "fail-open@example.test",
      authenticated: false,
      db: db as unknown as FirebaseFirestore.Firestore,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.failOpen, true);
    assert.equal(result.code, "config_missing");
    assert.equal(db.writes.length, 0);
  } finally {
    if (originalSecret === undefined) delete process.env.RATE_LIMIT_HMAC_SECRET;
    else process.env.RATE_LIMIT_HMAC_SECRET = originalSecret;
  }
});

test("une panne du stockage du limiteur echoue en mode ouvert", async () => {
  const result = await submit(new ThrowingFirestore());
  assert.equal(result.allowed, true);
  assert.equal(result.failOpen, true);
  assert.equal(result.code, "storage_unavailable");
});

test("Firestore ne contient aucune IP, email ou identifiant brut", async () => {
  const db = new FakeFirestore();
  const email = "private.person@example.test";
  const network = "203.0.113.99";
  const anonymousId = attemptId(999);
  await submit(db, { attempt: 999, email, network, anonymousId });
  const stored = JSON.stringify([...db.documents.entries()]);
  assert.equal(stored.includes(email), false);
  assert.equal(stored.includes(network), false);
  assert.equal(stored.includes(anonymousId), false);
});

test("les logs allowed ne contiennent aucune donnee personnelle brute", async () => {
  const logs = await captureLogs(() =>
    submit(new FakeFirestore(), {
      email: "log-private@example.test",
      network: "198.51.100.101",
      anonymousId: attemptId(101),
      authenticated: true,
    }),
  );
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes("log-private@example.test"), false);
  assert.equal(serialized.includes("198.51.100.101"), false);
  assert.equal(serialized.includes(attemptId(101)), false);
  assert.equal(serialized.includes('"authenticated":true'), true);
});

test("les logs blocked ne contiennent aucune donnee personnelle brute", async () => {
  const db = new FakeFirestore();
  for (let index = 1; index <= 3; index += 1) await submit(db, { attempt: index });
  const logs = await captureLogs(() => submit(db, { attempt: 4 }));
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes("client@example.test"), false);
  assert.equal(serialized.includes("198.51.100.10"), false);
  assert.equal(serialized.includes("rate_limit_blocked"), true);
});

test("Vercel utilise le x-forwarded-for qu'il reecrit", () => {
  const request = requestFor("10.0.0.1", "198.51.100.120");
  assert.equal(extractTrustedClientIp(request, { VERCEL: "1" }), "198.51.100.120");
});

test("hors Vercel un header spoofable est ignore", () => {
  const request = requestFor("127.0.0.1", "198.51.100.121");
  assert.equal(extractTrustedClientIp(request, {}), "127.0.0.1");
});

test("les variantes de casse et espaces d'un email partagent le quota", async () => {
  const db = new FakeFirestore();
  await submit(db, { attempt: 130, email: " Case@Example.Test " });
  await submit(db, { attempt: 131, email: "case@example.test" });
  await submit(db, { attempt: 132, email: "CASE@EXAMPLE.TEST" });
  const blocked = await submit(db, { attempt: 133, email: "case@example.test" });
  assert.equal(normalizeRateLimitEmail(" Case@Example.Test "), "case@example.test");
  assert.equal(blocked.allowed, false);
});

test("le quota anonyme complete les signaux email et reseau", async () => {
  const db = new FakeFirestore();
  const anonymousId = attemptId(140);
  const results = [];
  for (let index = 0; index < 5; index += 1) {
    results.push(
      await submit(db, {
        attempt: 140 + index,
        email: `anon-${index}@example.test`,
        network: `198.51.100.${140 + index}`,
        anonymousId,
      }),
    );
  }
  assert.deepEqual(results.map((result) => result.allowed), [true, true, true, true, false]);
});

test("le honeypot detecte les robots sur les deux formulaires", () => {
  assert.equal(assessPublicSubmissionTrap({ honeypot: "bot-company" }), "honeypot");
});

test("une soumission trop rapide est detectee", () => {
  assert.equal(
    assessPublicSubmissionTrap({
      context: { formStartedAt: baseNow - 200 },
      nowMs: baseNow,
    }),
    "submitted_too_fast",
  );
});

test("une soumission humaine normale n'est pas bloquee", () => {
  assert.equal(
    assessPublicSubmissionTrap({
      context: { formStartedAt: baseNow - 2_000 },
      nowMs: baseNow,
    }),
    null,
  );
});

test("la reponse 429 est generique et conserve Retry-After", () => {
  const response = new FakeResponse();
  sendPublicRateLimitResponse(response as unknown as VercelResponseLike, {
    allowed: false,
    code: "rate_limited",
    retryAfterSeconds: 321,
  });
  const body = response.body as { code?: string; error?: string };
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers.get("retry-after"), "321");
  assert.equal(body.code, "public_submission_rate_limited");
  assert.equal(JSON.stringify(body).includes("@"), false);
});

test("les seuils sont centralises et documentables", () => {
  assert.equal(publicRateLimitRules["/api/create-order"].length, 6);
  assert.equal(publicRateLimitRules["/api/contact"].length, 6);
  assert.equal(publicRateLimitRules["/api/contests"].length, 6);
  assert.equal(publicRateLimitsCollection, "securityRateLimits");
});

test("le checkout verifie l'idempotence avant le limiteur et le pricing", () => {
  const source = readFileSync("api/create-order.ts", "utf8");
  const existingIndex = source.indexOf("await findCheckoutRequest(");
  const limiterIndex = source.indexOf("await enforcePublicSubmissionRateLimit(");
  const pricingIndex = source.indexOf("await priceCheckout(");
  assert.ok(existingIndex >= 0 && existingIndex < limiterIndex);
  assert.ok(limiterIndex < pricingIndex);
});

test("les regles Firestore interdisent tout acces client au limiteur", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(rules, /match \/securityRateLimits\/\{rateLimitId\}/);
  assert.match(rules, /allow read, write: if false;/);
});

async function captureLogs(run: () => Promise<unknown>) {
  const entries: unknown[] = [];
  console.info = (...args: unknown[]) => entries.push(args);
  console.warn = (...args: unknown[]) => entries.push(args);
  try {
    await run();
    return entries;
  } finally {
    console.info = silent;
    console.warn = silent;
  }
}

let passed = 0;
try {
  for (const entry of tests) {
    await entry.run();
    passed += 1;
    originalInfo(`PASS ${entry.name}`);
  }
  originalInfo(`Public rate limits: ${passed}/${tests.length} tests passed.`);
} finally {
  console.info = originalInfo;
  console.warn = originalWarn;
}
