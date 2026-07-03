"use client";

import { useEffect, useState } from "react";

interface DebugState {
  last_sf_payload: Record<string, unknown> | null;
  salesforce_enabled: boolean;
  web_to_lead_url: string | null;
  debug_email: string | null;
}

export default function SalesforceDebugPanel() {
  const [state, setState] = useState<DebugState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const secret = process.env.NEXT_PUBLIC_DEBUG_SECRET ?? "";
    if (!secret) {
      setError("Debug secret is not configured on the client.");
      return;
    }

    fetch(`/api/leads/debug/last-sf-payload?secret=${encodeURIComponent(secret)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<DebugState>;
      })
      .then(setState)
      .catch((err) => setError(err.message || "Unable to load Salesforce debug status."));
  }, []);

  if (error) {
    return (
      <div style={{ marginTop: 16, padding: 12, border: "1px solid #fecaca", borderRadius: 8, background: "#fff1f2", color: "#b91c1c" }}>
        Salesforce debug status unavailable: {error}
      </div>
    );
  }

  if (!state) {
    return null;
  }

  return (
    <div style={{ marginTop: 16, padding: 12, border: "1px solid #dbeafe", borderRadius: 8, background: "#f8fbff" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Salesforce status</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <div><strong>Enabled:</strong> {state.salesforce_enabled ? "Yes" : "No"}</div>
        <div><strong>Endpoint:</strong> {state.web_to_lead_url || "Not configured"}</div>
        <div><strong>Debug email:</strong> {state.debug_email || "Not configured"}</div>
        <div><strong>Last payload keys:</strong> {state.last_sf_payload ? Object.keys(state.last_sf_payload).join(", ") : "None"}</div>
      </div>
    </div>
  );
}
