# Live capability probe report

Date: 2026-08-13. All results captured live against api.x.ai with the account key.
Fixtures in `tests/fixtures/` are scrubbed and are the ground truth for mocked tests.

| Capability | Verified result |
|---|---|
| Models | grok-4.3 (1M), grok-4.20 family (1M), grok-4.5/4.6 (500K), grok-build-0.1 (256K), grok-imagine-image{,-2.0,-quality} (8K), grok-imagine-video{,-1.5} |
| Chat | `POST /v1/chat/completions`, OpenAI shape, works (grok-4.3 "pong") |
| Vision input | Works via chat content parts with web URL (`image_url`); images must be ≥8x8 px; data-URL b64 also accepted per docs |
| Live Search | `search_parameters` on chat is **HTTP 410 deprecated**. Current: **Agent Tools API** — `POST /v1/responses` with `tools:[{type:"web_search"},{type:"x_search"}]`, `input` array instead of `messages`. Output array mixes `reasoning` / `web_search_call` / `message` items; citations are `annotations[].type=="url_citation"` on message content. Usage includes `num_sources_used`, `server_side_tool_usage_details`, `cost_in_usd_ticks` |
| Image generation | `POST /v1/images/generations`, model grok-imagine-image-2.0, returns `data[0].url` on host **imgen.x.ai**, direct 200 without auth header, no redirect |
| Video generation | **Async two-step**: `POST /v1/videos/generations` `{model, prompt, duration}` → `{request_id}`; `GET /v1/videos/{request_id}` → `{status, progress, video:{url, duration}, usage:{cost_in_usd_ticks}}`. Artifact host **vidgen.x.ai**, valid mp4 (ftyp isom), no auth needed on download. 2s cost 1600000000 ticks = $0.16 → ticks = USD × 1e10, $0.08/sec confirmed |
| Error schema | Flat `{code, error}` (NOT OpenAI's nested `{error:{...}}`), e.g. 400 `{"code":"...","error":"..."}` |
| Artifact host allowlist | `imgen.x.ai`, `vidgen.x.ai` |

Not probed: server-side cancel for video jobs (no documented endpoint found; jobs.mjs
treats cancel as local-abandon unless one appears), image editing with `--source`
(builder shape to be asserted against docs during Task 6; refusal path via moderation
fixture pending).
