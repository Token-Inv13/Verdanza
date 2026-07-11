import { INDEXNOW_KEY, INDEXNOW_KEY_LOCATION } from "./indexNowConfig";
import { maskIndexNowKey } from "./indexNowCore";

const timeoutMs = 15000;

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(INDEXNOW_KEY_LOCATION, {
      redirect: "manual",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const trimmed = body.trim();

    const failures: string[] = [];
    if (response.status !== 200) failures.push(`expected HTTP 200, got ${response.status}`);
    if (response.status >= 300 && response.status < 400) failures.push("key URL redirects");
    if (trimmed !== INDEXNOW_KEY) failures.push(`key content mismatch for ${maskIndexNowKey()}`);
    if (/<html[\s>]/i.test(body) || /<!doctype html/i.test(body)) failures.push("key URL returned HTML");
    if (!/text\/plain|application\/octet-stream/.test(contentType)) {
      failures.push(`unexpected content-type: ${contentType || "missing"}`);
    }
    if (body.length > INDEXNOW_KEY.length + 2) failures.push("key response contains extra content");

    if (failures.length) {
      console.error(`IndexNow key verification failed at ${INDEXNOW_KEY_LOCATION}:`);
      failures.forEach((failure) => console.error(`- ${failure}`));
      console.error("If this was just added, deploy the site before running indexnow:verify.");
      process.exitCode = 1;
      return;
    }

    console.log(`IndexNow key verified at ${INDEXNOW_KEY_LOCATION} (${maskIndexNowKey()}).`);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `IndexNow key verification timed out after ${timeoutMs} ms.`
        : `IndexNow key verification failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    console.error("If this was just added, deploy the site before running indexnow:verify.");
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

void main();
