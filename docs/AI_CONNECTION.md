# Connect an AI (MCP)

An AI that supports MCP can create LocalDeck projects, hand over a private link and change them later. The link stays the same after a change.

## For people

1. LocalDeck → **Settings → Connect an AI** (sign in first) → **Create connection** → copy the address.
2. Claude: **Settings → Connectors → Add custom connector** → paste the address. Other apps call it an MCP server.
3. Ask: "Make a quiz about photosynthesis in LocalDeck and give me the link."

Claude Code:

```powershell
claude mcp add --transport http localdeck ADDRESS
```

Programs that send headers can use `https://localdeck-share.<account>.workers.dev/mcp` with `Authorization: Bearer ld_…` instead.

The address works like a password. Whoever has it can create projects in your name and change the ones it created. Remove the connection in Settings to cut it off. At most five connections per account.

## Tools

| Tool | What it does |
|---|---|
| `create_project` | Title, details and files in, link out. Needs `index.html`. `localdeck.json` is written by the server |
| `update_project` | `edits` (find and replace a text that appears once), `files`, `remove`, or new details. Same link |
| `read_project` | List of files, or the content of one file |
| `list_projects` | Projects of this connection with links |
| `delete_project` | Deletes a project and its link |

Limits: 1 MiB and 60 files per project, 240 calls per hour, and the admin limits for changes per day, days online and storage. A change extends the time online.

## Privacy

- A project is encrypted like every share (AES-GCM, key only in the link). The server sees it only while it handles a request.
- Key and title are stored encrypted with a key derived from the connection's secret. The database keeps only a hash of that secret, so nothing readable is stored.
- An AI connection reaches only the projects it created, never the library or other links.
- The company behind the AI sees what the AI writes. LocalDeck says so in Settings.
- `invocation_logs = false` in `wrangler.toml` keeps the addresses, which contain the secret, out of the Cloudflare logs. Do not turn it on.

## Technical

- `cloudflare/worker/src/mcp.ts`: protocol. Stateless, HTTP POST, JSON answers. Speaks 2026-07-28 and the 2024 to 2025 versions with the `initialize` handshake.
- `cloudflare/worker/src/ai.ts`: connections, encryption, projects. Stored in the same D1 database (500 MB on the free plan); AI projects use at most 300 MiB of it.
- Tested with the official MCP SDK against a local D1. Very large projects may run into the 10 ms computing limit of the free Workers plan.
