import { runSync } from "./sync.js";

runSync().catch((error) => {
  console.error("Sync failed:", error);
  process.exit(1);
});
