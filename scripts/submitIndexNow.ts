import {
  buildIndexNowBatch,
  formatDryRun,
  parseIndexNowArgs,
  submitIndexNow,
} from "./indexNowCore";

async function main() {
  const args = parseIndexNowArgs(process.argv.slice(2));
  const batch = buildIndexNowBatch(args);

  if (args.dryRun) {
    console.log(formatDryRun(batch, args.endpoint));
    return;
  }

  console.log(
    `Submitting ${batch.urls.length + batch.deletedUrls.length} URL(s) to IndexNow.`,
  );
  if (batch.deletedUrls.length) {
    console.log(`Deleted URL(s): ${batch.deletedUrls.length}`);
  }

  const result = await submitIndexNow(batch, {
    endpoint: args.endpoint,
    timeoutMs: args.timeoutMs,
  });
  console.log(`HTTP ${result.status}: ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
