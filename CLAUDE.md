# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI-powered Safety Management System (SMS) for aviation operators. Users describe safety incidents in plain English; Claude extracts structured data, performs root cause analysis, and predicts future hazards. Replaces tedious 20-field forms with a 30-second freeform report.

## Commands

```bash
npm run dev             # Dev server → http://localhost:3000
npm run build           # Production build
npm run lint            # Lint check
npm run mcp             # Run MCP server (stdio, for Claude Code)
npx prisma migrate dev  # Run DB migrations
npx prisma studio       # Visual DB browser
```

**Environment:** Copy `.env.example` to `.env.local` and set variables before first run.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Prisma ORM · Claude API (`@anthropic-ai/sdk`) · SQLite (dev) / PostgreSQL (prod) · Vercel

**Extended stack:**
- `@modelcontextprotocol/sdk` — MCP server exposes SMS tools to Claude Code and AI assistants
- `@microsoft/microsoft-graph-client` + `@azure/identity` — Microsoft 365 / Graph API for Teams notifications and SharePoint archival

## Architecture

```
/src/app/           Pages and layouts (App Router)
/src/components/    UI components
/src/lib/ai.ts      ALL Claude API calls — centralised here
/src/lib/db.ts      Prisma client singleton (Next.js)
/src/lib/m365.ts    Microsoft 365 integration — Teams webhook + Graph API
/mcp/server.ts      MCP server entry point (runs via tsx, reads same SQLite DB)
/mcp/tools/         MCP tool implementations
/mcp/lib/db.ts      Prisma client for MCP context (relative imports, no @/ alias)
/prisma/            schema.prisma + migrations
```

**Key routes:**
- `/ ` — Dashboard (KPIs, recent reports, trends)
- `/reports/new` — Freeform report entry + AI extraction preview
- `/reports` — All reports, filterable table
- `/reports/[id]` — Detail: AI diagnosis, 5 Whys, similar events, corrective actions
- `/risk-matrix` — Interactive 5×5 ICAO risk matrix
- `/insights` — AI prognosis: trend analysis, seasonal patterns, predictions

**API routes:**
- `POST /api/reports` — Create report
- `POST /api/reports/[id]/diagnose` — Trigger AI diagnosis
- `GET  /api/insights` — Prognosis data

## Core Rules

- **TypeScript strict** — no `any`
- **Server components by default** — `'use client'` only when required (event handlers, hooks)
- **All AI calls through `/src/lib/ai.ts`** — never call `anthropic` directly in components or route handlers
- **Human review required** — AI suggestions are never auto-submitted; users always confirm before saving
- **ICAO risk level** = computed from `severity × likelihood`; never stored directly, always derived

## AI Integration Pattern

1. User submits freeform text
2. `/src/lib/ai.ts` sends to Claude: extract `{ title, description, category, severity, likelihood, contributingFactors, confidence }`
3. Extraction shown to user — fields with `confidence < 0.8` flagged with a warning indicator
4. User confirms or edits → saved to DB
5. Separate diagnosis call: root causes, 5 Whys, similar event matches, corrective action recommendations

## Database Models (Prisma)

Key fields on `Report`: `rawText`, `category` (enum), `severity` (Negligible→Catastrophic), `likelihood` (ExtremellyImprobable→Frequent), `status`, `aiAnalysis` (JSON), `isAnonymous`.

## MCP Server

The MCP server (`/mcp/server.ts`) exposes four tools to Claude Code and MCP clients:

| Tool | Description |
|---|---|
| `list_reports` | List reports with filters (category, severity, status, limit) |
| `get_report` | Full report + diagnosis + corrective actions by ID |
| `get_risk_summary` | Dashboard KPIs grouped by risk level and status |
| `get_insights` | AI trend analysis (calls Claude internally) |

**Configure in Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "sms-aviation": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/sms-for-chris-t"
    }
  }
}
```

## Microsoft 365 Integration

`/src/lib/m365.ts` provides three functions:

- **`notifyTeamsHighRisk(report)`** — posts an Adaptive Card to a Teams channel via Incoming Webhook when a report's risk level is `high` or `critical`. Called automatically in `POST /api/reports` (confirm step). Requires `TEAMS_WEBHOOK_URL`.
- **`sendTeamsChannelMessage(report)`** — same but via Graph API. Requires Azure app registration + `TEAMS_TEAM_ID` / `TEAMS_CHANNEL_ID`.
- **`archiveReportToSharePoint(report)`** — uploads the full report JSON to a SharePoint document library. Requires `SHAREPOINT_SITE_ID` / `SHAREPOINT_DRIVE_ID`.

All M365 functions are **no-ops if the env vars are not set** — the app runs fine without them.

## ForIT Integration (Week 4)

When integrating shared packages: `@forit/auth` (SSO), `@forit/ui`, `@forit/tailwind-config`. These are deferred until the app is functional end-to-end.
