import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default (in-memory, per-isolate) incremental cache — no R2/KV binding
// configured, since the app has no ISR/SSG pages that need a durable
// cross-request cache in V1 (the dashboard is fully dynamic, behind auth).
// Revisit if a future step adds cached/static routes that need this to
// survive across Worker isolates.
export default defineCloudflareConfig();
