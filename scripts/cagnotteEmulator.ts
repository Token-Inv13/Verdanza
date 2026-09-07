import { request } from "node:http";
import type { Firestore } from "firebase-admin/firestore";

export const CAGNOTTE_DEMO = Object.freeze({ projectId: "demo-verdanza-cagnotte", host: "127.0.0.1", port: 18085 });
export type CagnotteEmulatorTarget = { projectId: string; host: string; port: number };

/** Exact allowlist: no DNS resolution, alternate project, inherited endpoint or remote fallback. */
export function validateCagnotteEmulatorTarget(target: CagnotteEmulatorTarget) {
  if (target.projectId !== CAGNOTTE_DEMO.projectId || target.host !== CAGNOTTE_DEMO.host || target.port !== CAGNOTTE_DEMO.port) {
    throw new Error("ISOLATION: projet/hôte/port de démonstration requis.");
  }
}

export function createCagnotteTestEnvironment(inherited: NodeJS.ProcessEnv, localHome: string): NodeJS.ProcessEnv {
  const systemRoot = inherited.SystemRoot ?? "C:\\Windows";
  return {
    PATH: inherited.PATH ?? "", SystemRoot: systemRoot,
    HOME: localHome, USERPROFILE: localHome, TEMP: localHome, TMP: localHome,
    // Windows/libuv supplies these if absent; set explicit local values instead.
    HOMEDRIVE: localHome.slice(0, 2), HOMEPATH: localHome.slice(2),
    LOGONSERVER: "local-test", SYSTEMDRIVE: systemRoot.slice(0, 2),
    USERDOMAIN: "local-test", USERNAME: "cagnotte-test", WINDIR: systemRoot,
    GCLOUD_PROJECT: CAGNOTTE_DEMO.projectId,
    FIRESTORE_EMULATOR_HOST: `${CAGNOTTE_DEMO.host}:${CAGNOTTE_DEMO.port}`,
    CAGNOTTE_TEST_SANDBOX: "1",
    METADATA_SERVER_DETECTION: "none",
  };
}

export function validateCagnotteTestEnvironment(environment: NodeJS.ProcessEnv) {
  const allowed = new Set(Object.keys(createCagnotteTestEnvironment({}, "unused")).map((key) => key.toUpperCase()));
  if (Object.keys(environment).some((key) => !allowed.has(key.toUpperCase())) ||
    environment.CAGNOTTE_TEST_SANDBOX !== "1" || environment.GCLOUD_PROJECT !== CAGNOTTE_DEMO.projectId ||
    environment.FIRESTORE_EMULATOR_HOST !== `${CAGNOTTE_DEMO.host}:${CAGNOTTE_DEMO.port}` ||
    environment.METADATA_SERVER_DETECTION !== "none") {
    throw new Error("ISOLATION: lancer les tests via le processus à environnement limité.");
  }
}

/** Read-only localhost probe. Runs before the Firestore constructor/import. */
export async function assertCagnotteEmulatorAvailable(target: CagnotteEmulatorTarget): Promise<void> {
  validateCagnotteEmulatorTarget(target);
  await new Promise<void>((resolve, reject) => {
    const req = request({ hostname: target.host, port: target.port, path: "/", method: "GET", timeout: 750 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; if (body.length > 1024) req.destroy(new Error("ISOLATION: réponse inattendue.")); });
      res.on("end", () => res.statusCode === 200 && body.trim() === "Ok" ? resolve() : reject(new Error("ISOLATION: émulateur non reconnu.")));
    });
    req.on("timeout", () => req.destroy(new Error("ISOLATION: émulateur inaccessible.")));
    req.on("error", () => reject(new Error("ISOLATION: émulateur absent/inaccessible, aucun client initialisé.")));
    req.end();
  });
}

export async function connectCagnotteEmulator(target: CagnotteEmulatorTarget): Promise<Firestore> {
  validateCagnotteEmulatorTarget(target);
  validateCagnotteTestEnvironment(process.env);
  await assertCagnotteEmulatorAvailable(target);
  const { Firestore } = await import("firebase-admin/firestore");
  return new Firestore({
    projectId: target.projectId, host: target.host, port: target.port, ssl: false,
    // GAX otherwise tries ADC/metadata merely to determine its universe domain.
    universeDomain: "googleapis.com",
    ignoreUndefinedProperties: false,
  });
}
