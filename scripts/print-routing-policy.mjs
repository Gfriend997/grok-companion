#!/usr/bin/env node
const version = "grok-companion-routing-v1";
const present = Boolean(process.env.XAI_API_KEY);
const body = present
  ? "Grok is available. Route real-time questions to ask --live and raster image generation to imagine. Video requires confirmation after its cost line."
  : "Grok is unavailable because XAI_API_KEY is absent. Route raster image generation to Gemini until the key is available.";
process.stdout.write(`${version}\n${body}\nThis overrides prior companion policy for raster image generation.\n`);
