"use client";

import { useState, useCallback } from "react";
import { submitLead }            from "@/lib/api";
import type { Physician, SelectedSite } from "@/types/physician";

interface Props {
  physician:   Physician;
  site:        SelectedSite;
  onBack:      () => void;
  onAddAsLead: (physician: Physician) => void;
}

function initials(name: string): string {
  return name
    .replace(/^Dr\.\s*/i, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return `•••-•••-${last4}`;
}

export default function PhysicianDetailPanel({ physician, site, onBack, onAddAsLead }: Props) {
  const [leadState, setLeadState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleAddAsLead = useCallback(async () => {
    if (leadState !== "idle") return;
    setLeadState("loading");
    try {
      await submitLead({
        name:           physician.name,
        email:          `${physician.npi}@npi.local`,
        company:        "Individual Physicians",
        lead_source:    "Clinical Trial",
        npi:            physician.npi,
        nct_id:         site.nct_id,
        ...(site.facility           ? { site:       site.facility           } : {}),
        ...(physician.taxonomy_desc ? { title:      physician.taxonomy_desc } : {}),
        ...(physician.phone         ? { phone:      physician.phone         } : {}),
        physician_name: physician.name,
        auto:           true,
      });
      setLeadState("done");
      onAddAsLead(physician);
    } catch {
      setLeadState("error");
      setTimeout(() => setLeadState("idle"), 3000);
    }
  }, [leadState, physician, site, onAddAsLead]);

  const btnLabel =
    leadState === "loading" ? "Adding…"      :
    leadState === "done"    ? "✓ Lead Added" :
    leadState === "error"   ? "⚠ Retry"      :
    "Add as Lead";

  const btnBg =
    leadState === "done"  ? "var(--green-600)" :
    leadState === "error" ? "var(--coral-600)" :
    "var(--green-600)";

  return (
    <>
      <style>{`
        .pdp-shell {
          display: flex; flex-direction: column;
          background: var(--surface);
          font-family: var(--font-sans);
          animation: slideRight 0.24s cubic-bezier(.22,1,.36,1) both;
        }
        .pdp-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px;
          background: #fff; border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .pdp-back {
          display: flex; align-items: center; gap: 6px;
          height: 32px; padding: 0 12px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); cursor: pointer;
          font-size: 12px; font-weight: 600; color: var(--ink-3);
          flex-shrink: 0;
          transition: all 0.15s; font-family: var(--font-sans);
          white-space: nowrap;
        }
        .pdp-back:hover {
          background: var(--surface-2); border-color: var(--border-mid);
          color: var(--blue-600);
        }
        .pdp-back-icon { font-size: 14px; }
        .pdp-header-title { font-size: 13px; font-weight: 600; color: var(--ink); flex: 1; }
        .pdp-lead-btn {
          padding: 8px 16px; color: #fff; border: none;
          border-radius: var(--radius-md); font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans); letter-spacing: 0.2px;
          transition: all 0.16s; display: flex; align-items: center; gap: 7px;
          white-space: nowrap; min-width: 130px; justify-content: center;
        }
        .pdp-lead-btn:not(:disabled):hover {
          filter: brightness(1.08);
          box-shadow: 0 4px 14px rgba(37,99,235,0.3);
          transform: translateY(-1px);
        }
        .pdp-lead-btn:disabled { opacity: 0.65; cursor: not-allowed; }
        .pdp-success-banner {
          margin: 0 16px 0;
          padding: 10px 14px;
          background: var(--blue-50); border: 1px solid var(--blue-200);
          border-radius: var(--radius-md);
          display: flex; align-items: center; gap: 9px;
          font-size: 12px; font-weight: 600; color: var(--blue-600);
          animation: fadeIn 0.18s ease both;
          flex-shrink: 0; margin-top: 12px;
        }
        .pdp-success-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--blue-500); flex-shrink: 0;
          box-shadow: 0 0 0 3px rgba(16,185,129,0.15);
        }
        .pdp-body {
          padding: 16px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .pdp-profile-card {
          background: #fff; border: 1px solid var(--border);
          border-radius: var(--radius-xl); overflow: hidden;
        }
        .pdp-profile-header {
          padding: 18px 18px 16px;
          display: flex; align-items: center; gap: 14px;
          background: linear-gradient(135deg, var(--blue-50) 0%, var(--blue-50) 100%);
          border-bottom: 1px solid var(--border);
        }
        .pdp-avatar {
          width: 58px; height: 58px; border-radius: 50%;
          background: var(--blue-700);
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; font-weight: 700; color: #fff;
          font-family: var(--font-mono); flex-shrink: 0;
          box-shadow: 0 4px 16px rgba(37,99,235,0.28);
          border: 3px solid rgba(255,255,255,0.8);
        }
        .pdp-name { font-size: 17px; font-weight: 700; color: var(--ink); line-height: 1.3; }
        .pdp-specialty { font-size: 12px; color: var(--blue-600); font-weight: 600; margin-top: 3px; }
        .pdp-npi { font-size: 10px; color: var(--muted); font-family: var(--font-mono); margin-top: 4px; }
        .pdp-section { padding: 14px 18px; }
        .pdp-section + .pdp-section { border-top: 1px solid var(--border); }
        .pdp-section-label {
          font-size: 9px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 1px; color: var(--muted); margin-bottom: 12px;
        }
        .pdp-info-row {
          display: flex; align-items: flex-start; gap: 12px;
          font-size: 12px; color: var(--ink-2); padding: 5px 0;
        }
        .pdp-info-icon { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
        .pdp-info-label {
          font-size: 10px; color: var(--muted); font-weight: 600; margin-bottom: 2px;
          text-transform: uppercase; letter-spacing: 0.4px;
        }
        .pdp-dist-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: var(--blue-50); border: 1px solid var(--blue-200);
          border-radius: 20px; padding: 5px 14px;
          font-size: 12px; font-weight: 700; color: var(--blue-600);
          font-family: var(--font-mono); margin-top: 10px;
        }
        .pdp-trial-card {
          background: #fff; border: 1px solid var(--border);
          border-radius: var(--radius-xl); padding: 16px 18px;
        }
        .pdp-trial-nct {
          font-size: 10px; font-weight: 700; color: var(--blue-600);
          font-family: var(--font-mono); letter-spacing: 1px; margin-bottom: 6px;
        }
        .pdp-trial-site { font-size: 13px; font-weight: 600; color: var(--ink); }
        .pdp-trial-loc  { font-size: 11px; color: var(--muted); margin-top: 4px; }
        .pdp-btn-spinner {
          width: 12px; height: 12px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff; border-radius: 50%;
          animation: spinAnim 0.65s linear infinite;
        }
      `}</style>

      <div className="pdp-shell">
        <div className="pdp-header">
          <button className="pdp-back" onClick={onBack} title="Back to Find Physicians">
            <span className="pdp-back-icon">←</span>
            Find Physicians
          </button>
          <div className="pdp-header-title">Physician Details</div>
          <button
            className="pdp-lead-btn"
            onClick={handleAddAsLead}
            disabled={leadState === "loading" || leadState === "done"}
            style={{ background: btnBg }}
          >
            {leadState === "loading"
              ? <><div className="pdp-btn-spinner" /> Adding…</>
              : btnLabel}
          </button>
        </div>

        {leadState === "done" && (
          <div className="pdp-success-banner">
            <div className="pdp-success-dot" />
            Lead captured for {physician.name}. The Aquarient team will contact you shortly.
          </div>
        )}

        <div className="pdp-body">
          {/* Profile */}
          <div className="pdp-profile-card">
            <div className="pdp-profile-header">
              <div className="pdp-avatar">{initials(physician.name)}</div>
              <div>
                <div className="pdp-name">{physician.name}</div>
                {physician.taxonomy_desc && (
                  <div className="pdp-specialty">{physician.taxonomy_desc}</div>
                )}
                <div className="pdp-npi">NPI: {physician.npi}</div>
              </div>
            </div>

            <div className="pdp-section">
              <div className="pdp-section-label">Contact Information</div>

              {physician.address && (
                <div className="pdp-info-row">
                  <span className="pdp-info-icon">📍</span>
                  <div>
                    <div className="pdp-info-label">Address</div>
                    <div>{physician.address}</div>
                  </div>
                </div>
              )}

              {physician.phone && (
                <div className="pdp-info-row">
                  <span className="pdp-info-icon">📞</span>
                  <div>
                    <div className="pdp-info-label">Phone</div>
                    <a href={"tel:" + physician.phone}
                      style={{ color: "var(--blue-600)", fontWeight: 600, textDecoration: "none" }}>
                      {maskPhone(physician.phone)}
                    </a>
                  </div>
                </div>
              )}

              {physician.distance_miles != null && (
                <div className="pdp-dist-badge">
                  📏 {physician.distance_miles.toFixed(1)} mi from trial site
                </div>
              )}
            </div>
          </div>

          {/* Associated Trial */}
          <div className="pdp-trial-card">
            <div className="pdp-section-label" style={{ marginBottom: 10 }}>Associated Trial Site</div>
            <div className="pdp-trial-nct">{site.nct_id}</div>
            <div className="pdp-trial-site">{site.facility || "Trial Site"}</div>
            <div className="pdp-trial-loc">
              {[site.city, site.state].filter(Boolean).join(", ")}
            </div>
            {site.condition && (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
                Condition:{" "}
                <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
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