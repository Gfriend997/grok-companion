---
name: setup
description: Check Grok Companion credentials, xAI connectivity, and available models after installing the Codex plugin or when Grok fails to connect.
---

# Set up Grok Companion

Resolve `../../scripts/grok-companion.mjs` relative to this installed skill
file, not the working directory. Set `$grokScript` to that absolute path. Run
Node on demand; no server registration is needed.

On Windows, load an existing user environment value into the same child shell
before calling the CLI:

```powershell
if (-not $env:XAI_API_KEY) {
    $env:XAI_API_KEY = [Environment]::GetEnvironmentVariable('XAI_API_KEY', 'User')
}
node $grokScript setup
```

On other platforms, invoke `node <absolute-script-path> setup` with
`XAI_API_KEY` inherited from the environment.

Report credential presence, API reachability, model IDs, and any structured
error. If no key exists, ask the user to configure it privately as an OS
environment variable. Never print its value, request it in chat, or save it in
arguments, configuration, or files.

Setup uses GET model discovery. Do not submit paid text or media requests merely
to test setup. Discover models instead of assuming defaults remain available.
