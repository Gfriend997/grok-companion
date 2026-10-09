#!/usr/bin/env node
const version = "grok-companion-routing-v2";
const present = Boolean(process.env.XAI_API_KEY);
const body = present
  ? "Grok is available. Route X/Twitter search and deep reasoning over fresh data to ask --live, and raster image generation to imagine. Routine live-web lookups (latest release, news, quick fresh facts) go to Gemini ask --live instead (free grounding quota). Video requires confirmation after its cost line."
  : "Grok is unavailable because XAI_API_KEY is absent. Route raster image generation and live-web lookups to Gemini until the key is available.";
process.stdout.write(`${version}\n${body}\nThis overrides prior companion policy for raster image generation.\n`);
