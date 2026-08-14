#!/usr/bin/env node
// Disabled unless deliberately enabled outside this plugin's default configuration.
if (process.env.GROK_STOP_REVIEW_GATE !== "1") process.exit(0);
process.stderr.write("Grok stop-review gate is not implemented in the default runtime.\n");
process.exit(0);
