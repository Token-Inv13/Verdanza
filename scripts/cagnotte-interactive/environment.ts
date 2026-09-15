import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  RECIPE_ALLOWED_PORTS,
  RECIPE_CURSOR_SECRET,
  RECIPE_FIREBASE_CACHE,
  RECIPE_HOST,
  RECIPE_PORTS,
  RECIPE_PROJECT_ID,
  RECIPE_RATE_LIMIT_SECRET,
  RECIPE_ROOT,
} from "./constants.js";

export function formatNodeRequireOption(modulePath: string) {
  if (!modulePath || /[\0\r\n"]/.test(modulePath)) {
    throw new Error("ISOLATION: chemin de garde réseau incompatible avec NODE_OPTIONS.");
  }
  return `--require="${modulePath.replaceAll("\\", "\\\\")}"`;
}

export function buildRecipeEnvironment(runDirectory: string): NodeJS.ProcessEnv {
  const localHome = resolve(runDirectory, "home");
  const localTemp = resolve(runDirectory, "tmp");
  const emptyEnvDir = resolve(runDirectory, "empty-env");
  mkdirSync(localHome, { recursive: true });
  mkdirSync(localTemp, { recursive: true });
  mkdirSync(emptyEnvDir, { recursive: true });
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const guard = resolve(RECIPE_ROOT, "scripts/cagnotte-interactive/serverNetworkGuard.cjs");
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || "",
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: process.env.ComSpec || resolve(systemRoot, "System32/cmd.exe"),
    JAVA_HOME: process.env.JAVA_HOME || "",
    HOME: localHome,
    USERPROFILE: localHome,
    APPDATA: resolve(localHome, "AppData/Roaming"),
    LOCALAPPDATA: resolve(localHome, "AppData/Local"),
    TEMP: localTemp,
    TMP: localTemp,
    HOMEDRIVE: localHome.slice(0, 2),
    HOMEPATH: localHome.slice(2),
    USERNAME: "verdanza-recette-local",
    USERDOMAIN: "LOCAL",
    NODE_ENV: "development",
    CI: "1",
    GCLOUD_PROJECT: RECIPE_PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: RECIPE_PROJECT_ID,
    FIRESTORE_EMULATOR_HOST: `${RECIPE_HOST}:${RECIPE_PORTS.firestore}`,
    FIREBASE_AUTH_EMULATOR_HOST: `${RECIPE_HOST}:${RECIPE_PORTS.auth}`,
    FIREBASE_EMULATORS_PATH: RECIPE_FIREBASE_CACHE,
    FIREBASE_TOOLS_DISABLE_AUTOUPDATE: "true",
    METADATA_SERVER_DETECTION: "none",
    VITE_FIREBASE_API_KEY: "demo-api-key",
    VITE_FIREBASE_AUTH_DOMAIN: `${RECIPE_PROJECT_ID}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: RECIPE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: `${RECIPE_PROJECT_ID}.appspot.com`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
    VITE_FIREBASE_APP_ID: "1:000000000000:web:localrecipe",
    RATE_LIMIT_HMAC_SECRET: RECIPE_RATE_LIMIT_SECRET,
    CAGNOTTE_READ_CURSOR_SECRET: RECIPE_CURSOR_SECRET,
    VERDANZA_CAGNOTTE_INTERACTIVE: "1",
    VERDANZA_RECETTE_RUN_DIR: runDirectory,
    VERDANZA_RECETTE_EMPTY_ENV_DIR: emptyEnvDir,
    VERDANZA_RECETTE_ALLOWED_PORTS: RECIPE_ALLOWED_PORTS.join(","),
    VERDANZA_RECETTE_NETWORK_LOG: resolve(runDirectory, "server-network-blocks.jsonl"),
    NODE_OPTIONS: formatNodeRequireOption(guard),
    NO_PROXY: "127.0.0.1",
    no_proxy: "127.0.0.1",
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
    JAVA_TOOL_OPTIONS: "-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=1 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=1 -Dhttp.nonProxyHosts=127.*",
  };
  validateRecipeEnvironment(environment);
  return environment;
}

export function validateRecipeEnvironment(environment: NodeJS.ProcessEnv) {
  const forbidden = [
    "FIREBASE_SERVICE_ACCOUNT_BASE64",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "VERCEL_TOKEN",
  ];
  if (forbidden.some((key) => environment[key])) {
    throw new Error("ISOLATION: credential ou jeton distant interdit dans la recette locale.");
  }
  if (
    environment.VERDANZA_CAGNOTTE_INTERACTIVE !== "1" ||
    environment.GCLOUD_PROJECT !== RECIPE_PROJECT_ID ||
    environment.GOOGLE_CLOUD_PROJECT !== RECIPE_PROJECT_ID ||
    environment.VITE_FIREBASE_PROJECT_ID !== RECIPE_PROJECT_ID ||
    environment.FIRESTORE_EMULATOR_HOST !== `${RECIPE_HOST}:${RECIPE_PORTS.firestore}` ||
    environment.FIREBASE_AUTH_EMULATOR_HOST !== `${RECIPE_HOST}:${RECIPE_PORTS.auth}`
  ) {
    throw new Error("ISOLATION: projet fictif et endpoints émulateurs exacts requis.");
  }
}

export function validateCurrentRecipeProcess() {
  validateRecipeEnvironment(process.env);
}
