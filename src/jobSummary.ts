import { appendFileSync } from "node:fs";

/**
 * Writes a markdown summary to the GitHub Actions run's "Summary" tab
 * (GITHUB_STEP_SUMMARY). No-ops outside GitHub Actions (e.g. local dev),
 * since that env var is only set there.
 */
export function writeJobSummary(summary: {
  fetched: number;
  syncable: number;
  succeeded: number;
  failures: Array<{ email: string; error: string }>;
}): void {
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (!summaryPath) return;

  const lines: string[] = [
    "## PushPress → Mailchimp Sync",
    "",
    `Fetched **${summary.fetched}** PushPress contacts, **${summary.syncable}** syncable.`,
    `Synced **${summary.succeeded}/${summary.syncable}** contacts to Mailchimp.`,
  ];

  if (summary.failures.length > 0) {
    lines.push(
      "",
      `### ${summary.failures.length} contact(s) failed to sync`,
      "",
      "| Email | Error |",
      "| --- | --- |",
      ...summary.failures.map(
        (failure) => `| ${failure.email} | ${sanitizeForTableCell(failure.error)} |`,
      ),
    );
  }

  appendFileSync(summaryPath, lines.join("\n") + "\n");
}

function sanitizeForTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
