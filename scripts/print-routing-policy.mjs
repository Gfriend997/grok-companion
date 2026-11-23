#!/usr/bin/env node
const version = "grok-companion-routing-v3";
const present = Boolean(process.env.XAI_API_KEY);
const body = present
  ? "Grok is available. Route X/Twitter search and deep reasoning over fresh data to ask --live, and raster image generation to imagine. Routine live-web lookups (latest release, news, quick fresh facts) go to Gemini ask --live instead (free grounding quota). Video needs the user's explicit cost approval: run it without --confirm-cost to get the estimate, and add --confirm-cost only after the user approves. Grok review runs only when the user asks, or at stop for a large or risky diff in a repository where the user turned the stop-review gate on. Routine diffs go to the host's own reviewer; a Gemini second opinion is for large or risky diffs only."
  : "Grok is unavailable because XAI_API_KEY is absent. Route raster image generation and live-web lookups to Gemini until the key is available.";
process.stdout.write(`${version}\n${body}\nThis overrides prior companion policy for raster image generation.\n`);
