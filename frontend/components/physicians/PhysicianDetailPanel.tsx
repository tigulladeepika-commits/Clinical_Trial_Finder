// components/physicians/PhysicianDetailPanel.tsx
"use client";

import { useState, useCallback } from "react";
import { submitAutoLead }        from "@/lib/api";
import type { Physician, SelectedSite } from "@/types/physician";

interface Props {
  physician:   Physician;
  site:        SelectedSite;
  onBack:      () => void;
  onAddAsLead: (physician: Physician) => void; // kept for parent compatibility
}

type ToastState = "idle" | "loading" | "success" | "error";

function initials(name: string): string {
  return name
    .replace(/^Dr\.\s*/i, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

export default function PhysicianDetailPanel({ physician, site, onBack, onAddAsLead }: Props) {
  const [toast, setToast] = useState<ToastState>("idle");

  const handleAddAsLead = useCallback(async () => {
    if (toast === "loading" || toast === "success") return;
    setToast("loading");
    try {
      await submitAutoLead(physician, site);
      setToast("success");
      onAddAsLead(physician); // notify parent (e.g. for analytics / state sync)
      // Reset button after 3 s so user can see the confirmation
      setTimeout(() => setToast("idle"), 3000);
    } catch (err) {
      console.error("[AddAsLead]", err);
      setToast("error");
      setTimeout(() => setToast("idle"), 3000);
    }
  }, [physician, site, toast, onAddAsLead]);

  const phoneStyle: React.CSSProperties = {
    color:          "#2563eb",
    fontWeight:     600,
    textDecoration: "none",
  };

  const btnLabel =
    toast === "loading" ? "Saving…"  :
    toast === "success" ? "✓ Saved!" :
    toast === "error"   ? "✗ Failed — Retry" :
                          "⭐ Add as Lead";

  const btnBg =
    toast === "success" ? "#15803d" :
    toast === "error"   ? "#dc2626" :
    toast === "loading" ? "#16a34a" :
                          "#16a34a";

  return (
    <>
      <style>{`
        .pdp-shell {
          display: flex; flex-direction: column;
          height: 100%; overflow: hidden;
          font-family: 'DM Sans', system-ui, sans-serif;
          background: #f6f7fb;
        }
        .pdp-header {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px;
          background: #fff; border-bottom: 1px solid #e4e8f0;
          flex-shrink: 0;
        }
        .pdp-back {
          display: flex; align-items: center; justify-content: center;
          height: 30px; width: 30px;
          background: transparent; border: 1px solid #e4e8f0;
          border-radius: 7px; cursor: pointer;
          font-size: 14px; color: #4b5563; flex-shrink: 0;
          transition: all 0.15s; font-family: inherit;
        }
        .pdp-back:hover { background: #f1f5f9; border-color: #cbd5e1; }
        .pdp-header-title { font-size: 13px; font-weight: 600; color: #0d1117; flex: 1; }
        .pdp-add-lead-btn {
          padding: 7px 16px; color: #fff; border: none;
          border-radius: 8px; font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: inherit; letter-spacing: 0.3px;
          transition: background 0.2s, opacity 0.2s;
          display: flex; align-items: center; gap: 6px; white-space: nowrap;
          min-width: 120px; justify-content: center;
        }
        .pdp-add-lead-btn:disabled { opacity: 0.75; cursor: not-allowed; }
        .pdp-body {
          flex: 1; overflow-y: auto; padding: 16px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .pdp-card { background: #fff; border: 1px solid #e4e8f0; border-radius: 12px; overflow: hidden; }
        .pdp-card-header {
          padding: 16px; display: flex; align-items: center; gap: 14px;
          background: linear-gradient(135deg, #eff6ff, #dbeafe);
          border-bottom: 1px solid #e4e8f0;
        }
        .pdp-avatar {
          width: 56px; height: 56px; border-radius: 50%;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; font-weight: 700; color: #fff;
          font-family: 'DM Mono', monospace; flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(37,99,235,0.3);
        }
        .pdp-name     { font-size: 16px; font-weight: 700; color: #0d1117; line-height: 1.3; }
        .pdp-specialty{ font-size: 12px; color: #2563eb; font-weight: 600; margin-top: 3px; }
        .pdp-npi      { font-size: 10px; color: #94a3b8; font-family: 'DM Mono', monospace; margin-top: 4px; }
        .pdp-section  { padding: 14px 16px; }
        .pdp-section + .pdp-section { border-top: 1px solid #f1f5f9; }
        .pdp-section-label {
          font-size: 9px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 10px;
        }
        .pdp-info-row {
          display: flex; align-items: flex-start; gap: 10px;
          font-size: 12px; color: #374151; padding: 4px 0;
        }
        .pdp-info-icon  { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
        .pdp-info-label { font-size: 10px; color: #94a3b8; font-weight: 600; margin-bottom: 2px; }
        .pdp-trial-card { background: #fff; border: 1px solid #e4e8f0; border-radius: 12px; padding: 14px 16px; }
        .pdp-trial-nct  { font-size: 10px; font-weight: 700; color: #2563eb; font-family: 'DM Mono', monospace; letter-spacing: 0.8px; margin-bottom: 4px; }
        .pdp-trial-site { font-size: 12px; font-weight: 600; color: #0d1117; }
        .pdp-trial-loc  { font-size: 11px; color: #8b95a1; margin-top: 3px; }
        .pdp-dist-badge {
          display: inline-flex; align-items: center; gap: 5px;
          background: #eff6ff; border: 1px solid #bfdbfe;
          border-radius: 20px; padding: 4px 12px;
          font-size: 12px; font-weight: 700; color: #2563eb;
          font-family: 'DM Mono', monospace; margin-top: 10px;
        }
      `}</style>

      <div className="pdp-shell">

        {/* Header */}
        <div className="pdp-header">
          <button className="pdp-back" onClick={onBack} title="Back to list">
            &#8592;
          </button>
          <div className="pdp-header-title">Physician Details</div>
          <button
            className="pdp-add-lead-btn"
            style={{ background: btnBg }}
            onClick={handleAddAsLead}
            disabled={toast === "loading" || toast === "success"}
          >
            {btnLabel}
          </button>
        </div>

        <div className="pdp-body">

          {/* Profile card */}
          <div className="pdp-card">
            <div className="pdp-card-header">
              <div className="pdp-avatar">{initials(physician.name)}</div>
              <div>
                <div className="pdp-name">{physician.name}</div>
                {physician.taxonomy_desc && (
                  <div className="pdp-specialty">{physician.taxonomy_desc}</div>
                )}
                <div className="pdp-npi">NPI: {physician.npi}</div>
              </div>
            </div>

            {/* Contact info */}
            <div className="pdp-section">
              <div className="pdp-section-label">Contact Information</div>

              {physician.address && (
                <div className="pdp-info-row">
                  <span className="pdp-info-icon">&#128205;</span>
                  <div>
                    <div className="pdp-info-label">Address</div>
                    <div>{physician.address}</div>
                  </div>
                </div>
              )}

              {physician.phone && (
                <div className="pdp-info-row">
                  <span className="pdp-info-icon">&#128222;</span>
                  <div>
                    <div className="pdp-info-label">Phone</div>
                    <a href={"tel:" + physician.phone} style={phoneStyle}>
                      {physician.phone}
                    </a>
                  </div>
                </div>
              )}

              {physician.distance_miles != null && (
                <div className="pdp-dist-badge">
                  &#128207; {physician.distance_miles.toFixed(1)} mi from trial site
                </div>
              )}
            </div>
          </div>

          {/* Associated Trial Site */}
          <div className="pdp-trial-card">
            <div className="pdp-section-label">Associated Trial Site</div>
            <div className="pdp-trial-nct">{site.nct_id}</div>
            <div className="pdp-trial-site">{site.facility || "Trial Site"}</div>
            <div className="pdp-trial-loc">
              {[site.city, site.state].filter(Boolean).join(", ")}
            </div>
            {site.condition && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#8b95a1" }}>
                {"Condition: "}
                <span style={{ color: "#374151", fontWeight: 600 }}>
                  {site.condition}
                </span>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}