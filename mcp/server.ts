#!/usr/bin/env tsx
/**
 * Aviation SMS — MCP Server
 * Exposes safety report data and AI insights as tools for Claude Code and other MCP clients.
 *
 * Run:  npm run mcp
 * Configure in ~/.claude/settings.json — see README or CLAUDE.md for details.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listReports, getReport, getRiskSummary, type ListReportsArgs } from "./tools/reports";
import { getInsights } from "./tools/insights";

const server = new Server(
  { name: "sms-aviation", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_reports",
      description:
        "List aviation safety reports. Supports filtering by category, severity, and status. Returns risk score and level for each report.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["FlightOps", "Maintenance", "GroundOps", "Weather", "HumanFactors", "Other"],
            description: "Filter by incident category",
          },
          severity: {
            type: "string",
            enum: ["Negligible", "Minor", "Major", "Hazardous", "Catastrophic"],
            description: "Filter by ICAO severity level",
          },
          status: {
            type: "string",
            enum: ["Open", "UnderReview", "Closed"],
            description: "Filter by report status",
          },
          limit: {
            type: "number",
            default: 20,
            description: "Max reports to return (capped at 100)",
          },
          include_diagnosis: {
            type: "boolean",
            default: false,
            description: "Include AI diagnosis and corrective actions in each report",
          },
        },
      },
    },
    {
      name: "get_report",
      description:
        "Get a single safety report by ID, including its AI diagnosis, 5 Whys analysis, similar events, and corrective actions.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Report CUID (from list_reports)" },
        },
      },
    },
    {
      name: "get_risk_summary",
      description:
        "Get dashboard KPIs: total report counts grouped by risk level (low/medium/high/critical), status, diagnoses complete, and open corrective actions.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_insights",
      description:
        "Generate AI-powered prognosis: trending categories, risk trajectory, seasonal patterns, and an executive summary. Calls Claude internally — may take a few seconds.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "list_reports":
        result = await listReports((args ?? {}) as ListReportsArgs);
        break;
      case "get_report": {
        const { id } = (args ?? {}) as { id: string };
        if (!id) throw new Error("id is required");
        result = await getReport(id);
        if (!result) throw new Error(`Report ${id} not found`);
        break;
      }
      case "get_risk_summary":
        result = await getRiskSummary();
        break;
      case "get_insights":
        result = await getInsights();
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
