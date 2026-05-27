import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import type { Report } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Shared risk scoring (mirrors RiskBadge.tsx — kept in sync manually)
// ---------------------------------------------------------------------------

const SEVERITY_SCORE: Record<string, number> = {
  Negligible: 1, Minor: 2, Major: 3, Hazardous: 4, Catastrophic: 5,
};
const LIKELIHOOD_SCORE: Record<string, number> = {
  ExtremelyImprobable: 1, Improbable: 2, Remote: 3, Probable: 4, Frequent: 5,
};

function riskScore(severity: string, likelihood: string) {
  return (SEVERITY_SCORE[severity] ?? 1) * (LIKELIHOOD_SCORE[likelihood] ?? 1);
}

function riskLevel(score: number): "low" | "medium" | "high" | "critical" {
  if (score <= 4) return "low";
  if (score <= 9) return "medium";
  if (score <= 16) return "high";
  return "critical";
}

// ---------------------------------------------------------------------------
// Graph API client (app-only, client credentials)
// ---------------------------------------------------------------------------

function getGraphClient(): Client | null {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) return null;

  const credential = new ClientSecretCredential(
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET
  );

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken(
          "https://graph.microsoft.com/.default"
        );
        return token?.token ?? "";
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Teams: Incoming Webhook notification (no Azure app needed)
// ---------------------------------------------------------------------------

const RISK_COLOURS: Record<string, string> = {
  low: "Good",
  medium: "Warning",
  high: "Attention",
  critical: "Attention",
};

const RISK_EMOJIS: Record<string, string> = {
  low: "🟢",
  medium: "🟡",
  high: "🟠",
  critical: "🔴",
};

export async function notifyTeamsHighRisk(
  report: Pick<Report, "id" | "title" | "category" | "severity" | "likelihood" | "occurredAt">
): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return;

  const score = riskScore(report.severity, report.likelihood);
  const level = riskLevel(score);

  // Only notify for high or critical
  if (level !== "high" && level !== "critical") return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const reportUrl = `${appUrl}/reports/${report.id}`;
  const emoji = RISK_EMOJIS[level];
  const colour = RISK_COLOURS[level];

  const card = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: `${emoji} ${level === "critical" ? "Critical" : "High"} Risk Safety Report`,
              size: "Large",
              weight: "Bolder",
              color: colour,
            },
            {
              type: "TextBlock",
              text: report.title,
              wrap: true,
              size: "Medium",
            },
            {
              type: "FactSet",
              facts: [
                { title: "Category", value: report.category.replace(/([A-Z])/g, " $1").trim() },
                { title: "Severity", value: report.severity },
                { title: "Likelihood", value: report.likelihood },
                { title: "Risk Score", value: `${score} / 25` },
                { title: "Occurred", value: new Date(report.occurredAt).toLocaleDateString() },
              ],
            },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "View Full Report",
              url: reportUrl,
            },
          ],
        },
      },
    ],
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
}

// ---------------------------------------------------------------------------
// Graph API: send a Teams channel message (requires app registration)
// ---------------------------------------------------------------------------

export async function sendTeamsChannelMessage(
  report: Pick<Report, "id" | "title" | "category" | "severity" | "likelihood">
): Promise<void> {
  const { TEAMS_TEAM_ID, TEAMS_CHANNEL_ID } = process.env;
  if (!TEAMS_TEAM_ID || !TEAMS_CHANNEL_ID) return;

  const graph = getGraphClient();
  if (!graph) return;

  const score = riskScore(report.severity, report.likelihood);
  const level = riskLevel(score);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  await graph
    .api(`/teams/${TEAMS_TEAM_ID}/channels/${TEAMS_CHANNEL_ID}/messages`)
    .post({
      body: {
        contentType: "html",
        content: `<b>${RISK_EMOJIS[level]} ${report.title}</b><br/>
Category: ${report.category} | Severity: ${report.severity} | Likelihood: ${report.likelihood}<br/>
Risk Score: ${score}/25 (${level})<br/>
<a href="${appUrl}/reports/${report.id}">View Report</a>`,
      },
    });
}

// ---------------------------------------------------------------------------
// SharePoint: upload a report as a JSON file to a document library
// ---------------------------------------------------------------------------

export async function archiveReportToSharePoint(
  report: Report & { diagnosis?: unknown }
): Promise<void> {
  const { SHAREPOINT_SITE_ID, SHAREPOINT_DRIVE_ID } = process.env;
  if (!SHAREPOINT_SITE_ID || !SHAREPOINT_DRIVE_ID) return;

  const graph = getGraphClient();
  if (!graph) return;

  const filename = `sms-report-${report.id}-${Date.now()}.json`;
  const content = JSON.stringify(report, null, 2);

  await graph
    .api(`/sites/${SHAREPOINT_SITE_ID}/drives/${SHAREPOINT_DRIVE_ID}/root:/${filename}:/content`)
    .put(Buffer.from(content));
}
