"use client";

import { useState, useCallback } from "react";
import { submitLead, fetchPhysicianEmail } from "@/lib/api";
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


// ── Fallback popup ────────────────────────────────────────────────────────────

interface FallbackPopupProps {
  physicianName: string;
  reason:        "not_found" | "no_email";
  onConfirm:     () => void;
  onCancel:      () => void;
  isSubmitting:  boolean;
}

function FallbackPopup({ physicianName, reason, onConfirm, onCancel, isSubmitting }: FallbackPopupProps) {
  return (
    <>
      <style>{`
        .fb-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,0.38);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: fadeIn 0.15s ease both;
        }
        .fb-card {
          background: #fff; border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.18);
          width: 100%; max-width: 380px;
          padding: 24px;
          animation: slideUp 0.2s cubic-bezier(.22,1,.36,1) both;
          font-family: var(--font-sans);
        }
        .fb-icon-wrap {
          width: 44px; height: 44px; border-radius: 12px;
          background: #fff7ed; border: 1px solid #fed7aa;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; margin-bottom: 14px;
        }
        .fb-title {
          font-size: 15px; font-weight: 700; color: var(--ink);
          margin-bottom: 8px; line-height: 1.35;
        }
        .fb-body {
          font-size: 13px; color: var(--ink-3); line-height: 1.6;
          margin-bottom: 6px;
        }
        .fb-note {
          font-size: 11px; color: var(--muted);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 8px; padding: 8px 10px;
          margin-bottom: 18px; line-height: 1.5;
        }
        .fb-note strong { color: var(--ink-2); }
        .fb-actions {
          display: flex; gap: 10px;
        }
        .fb-btn {
          flex: 1; height: 38px; border-radius: 10px;
          font-size: 13px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans); border: none;
          transition: all 0.15s; display: flex;
          align-items: center; justify-content: center; gap: 6px;
        }
        .fb-btn-cancel {
          background: var(--surface); border: 1px solid var(--border);
          color: var(--ink-3);
        }
        .fb-btn-cancel:hover { background: var(--surface-2); }
        .fb-btn-confirm {
          background: var(--green-600); color: #fff;
        }
        .fb-btn-confirm:hover:not(:disabled) { filter: brightness(1.08); }
        .fb-btn-confirm:disabled { opacity: 0.65; cursor: not-allowed; }
        @keyframes slideUp {
          from { transform: translateY(16px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      <div className="fb-overlay" onClick={onCancel}>
        <div className="fb-card" onClick={(e) => e.stopPropagation()}>
          <div className="fb-icon-wrap">⚠️</div>

          <div className="fb-title">
            {reason === "no_email"
              ? "Email not available"
              : "Physician not found on Apollo"}
          </div>

          <div className="fb-body">
            {reason === "no_email" ? (
              <>
                <strong>{physicianName}</strong> was found on Apollo but no
                verified email address is available in their database.
              </>
            ) : (
              <>
                No exact match for <strong>{physicianName}</strong> was found
                on Apollo.
              </>
            )}
          </div>

          <div className="fb-note">
            Do you still want to add this lead to Salesforce with a{" "}
            <strong>placeholder email</strong>? You can update it manually later.
          </div>

          <div className="fb-actions">
            <button className="fb-btn fb-btn-cancel" onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="fb-btn fb-btn-confirm"
              onClick={onConfirm}
              disabled={isSubmitting}
              type="button"
            >
              {isSubmitting
                ? <><div className="pdp-btn-spinner" /> Adding…</>
                : "Add with placeholder"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type LeadFlow =
  | "idle"
  | "fetching"
  | "confirm"
  | "submitting"
  | "done"
  | "error";

export default function PhysicianDetailPanel({ physician, site, onBack, onAddAsLead }: Props) {
  const [leadFlow,    setLeadFlow]    = useState<LeadFlow>("idle");
  const [popupReason, setPopupReason] = useState<"not_found" | "no_email">("not_found");

  // ── Submit lead with a given email ─────────────────────────────────────────
  const submitWithEmail = useCallback(async (email: string) => {
    try {
      await submitLead({
        name:           physician.name,
        email,
        company:        "Individual Physicians",
        lead_source:    "Clinical Trial",
        npi:            physician.npi,
        nct_id:         site.nct_id,
        ...(site.facility           ? { site:  site.facility           } : {}),
        ...(physician.taxonomy_desc ? { title: physician.taxonomy_desc } : {}),
        ...(physician.phone         ? { phone: physician.phone         } : {}),
        physician_name: physician.name,
        auto:           true,
      });
      setLeadFlow("done");
      onAddAsLead(physician);
    } catch {
      setLeadFlow("error");
      setTimeout(() => setLeadFlow("idle"), 3000);
    }
  }, [physician, site, onAddAsLead]);

  // ── Main button click ───────────────────────────────────────────────────────
  const handleAddAsLead = useCallback(async () => {
    if (leadFlow !== "idle") return;

    setLeadFlow("fetching");

    const result = await fetchPhysicianEmail({
      name:         physician.name,
      address:      physician.address ?? "",
      organization: site.facility     ?? "",
    });

    if (result.found && result.email) {
      await submitWithEmail(result.email);
      return;
    }

    setPopupReason(result.found ? "no_email" : "not_found");
    setLeadFlow("confirm");
  }, [leadFlow, physician, site, submitWithEmail]);

  // ── Popup confirm (add with placeholder) ───────────────────────────────────
  const handleFallbackConfirm = useCallback(async () => {
    setLeadFlow("submitting");
    await submitWithEmail("placeholder@aquarient.com");
  }, [submitWithEmail]);

  // ── Popup cancel ────────────────────────────────────────────────────────────
  const handleFallbackCancel = useCallback(() => {
    setLeadFlow("idle");
  }, []);

  // ── Button label / colour ───────────────────────────────────────────────────
  const btnLabel =
    leadFlow === "fetching"   ? "Looking up email…" :
    leadFlow === "done"       ? "✓ Lead Added"       :
    leadFlow === "error"      ? "⚠ Retry"            :
    "Add as lead to Salesforce";

  const btnBg =
    leadFlow === "done"  ? "var(--green-600)" :
    leadFlow === "error" ? "var(--coral-600)" :
    "var(--green-600)";

  const btnDisabled =
    leadFlow === "fetching"  ||
    leadFlow === "confirm"   ||
    leadFlow === "submitting"||
    leadFlow === "done";

  return (
    <>
      <style>{`
        /* ── Shell ──────────────────────────────────────────────────────── */
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
          display: flex; align-items: center; gap: 8px;
          height: 36px; padding: 0 14px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); cursor: pointer;
          font-size: 14px; font-weight: 700; color: var(--ink-3);
          flex-shrink: 0;
          transition: all 0.15s; font-family: var(--font-sans);
          white-space: nowrap;
        }
        .pdp-back:hover {
          background: var(--surface-2); border-color: var(--border-mid);
          color: var(--blue-600);
        }
        .pdp-back-icon { font-size: 18px; line-height: 1; }
        .pdp-header-title { font-size: 13px; font-weight: 600; color: var(--ink); flex: 1; }
        .pdp-lead-btn {
          padding: 8px 16px; color: #fff; border: none;
          border-radius: var(--radius-md); font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans); letter-spacing: 0.2px;
          transition: all 0.16s; display: flex; align-items: center; gap: 7px;
          white-space: nowrap; min-width: 150px; justify-content: center;
        }
        .pdp-lead-btn:not(:disabled):hover {
          filter: brightness(1.08);
          box-shadow: 0 4px 14px rgba(37,99,235,0.3);
          transform: translateY(-1px);
        }
        .pdp-lead-btn:disabled { opacity: 0.65; cursor: not-allowed; }
        .pdp-success-banner {
          margin: 12px 16px 0;
          padding: 10px 14px;
          background: var(--blue-50); border: 1px solid var(--blue-200);
          border-radius: var(--radius-md);
          display: flex; align-items: center; gap: 9px;
          font-size: 12px; font-weight: 600; color: var(--blue-600);
          animation: fadeIn 0.18s ease both;
          flex-shrink: 0;
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

        /* ── Profile card ───────────────────────────────────────────────── */
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
        .pdp-taxonomy-list {
          display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;
        }
        .pdp-taxonomy-chip {
          font-size: 10px; font-weight: 700; color: var(--ink-2);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 999px; padding: 6px 10px;
          display: inline-flex; align-items: center; gap: 6px;
        }
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

        /* ── Trial card ─────────────────────────────────────────────────── */
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


        /* ── Spinner ────────────────────────────────────────────────────── */
        .pdp-btn-spinner {
          width: 12px; height: 12px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff; border-radius: 50%;
          animation: spinAnim 0.65s linear infinite;
        }
      `}</style>

      {/* Fallback popup */}
      {(leadFlow === "confirm" || leadFlow === "submitting") && (
        <FallbackPopup
          physicianName={physician.name}
          reason={popupReason}
          onConfirm={handleFallbackConfirm}
          onCancel={handleFallbackCancel}
          isSubmitting={leadFlow === "submitting"}
        />
      )}

      <div className="pdp-shell">
        {/* Header */}
        <div className="pdp-header">
          <button className="pdp-back" onClick={onBack} title="Back to Find Physicians" aria-label="Back to Find Physicians">
            <span className="pdp-back-icon" aria-hidden="true">⬅️</span>
            Back
          </button>
          <div className="pdp-header-title">Physician Details</div>
          <button
            className="pdp-lead-btn"
            onClick={handleAddAsLead}
            disabled={btnDisabled}
            style={{ background: btnBg }}
          >
            {leadFlow === "fetching" || leadFlow === "submitting"
              ? <><div className="pdp-btn-spinner" /> {btnLabel}</>
              : btnLabel}
          </button>
        </div>

        {leadFlow === "done" && (
          <div className="pdp-success-banner">
            <div className="pdp-success-dot" />
            Lead captured for {physician.name} in Salesforce.
          </div>
        )}

        <div className="pdp-body">
          {/* Profile */}
          <div className="pdp-profile-card">
            <div className="pdp-profile-header">
              <div className="pdp-avatar">{initials(physician.name)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div className="pdp-name">{physician.name}</div>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#1e40af",
                    fontFamily: "var(--font-mono)",
                    background: "#dbeafe",
                    border: "1px solid #93c5fd",
                    borderRadius: 6,
                    padding: "3px 8px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    NPI {physician.npi}
                  </div>
                </div>
                {physician.taxonomy_desc && (
                  <div className="pdp-specialty">{physician.taxonomy_desc}</div>
                )}
                {Array.isArray(physician.all_taxonomies) && physician.all_taxonomies.length > 0 && (
                  <div className="pdp-taxonomy-list">
                    {physician.all_taxonomies.map((tax, index) => {
                      if (!tax || typeof tax !== 'object') return null;
                      const code = String(tax.code || '');
                      const desc = String(tax.desc || '');
                      const label = desc || code || 'Unknown';
                      return (
                        <div key={`${code || 'tax'}-${index}`} className="pdp-taxonomy-chip">
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                    <a
                      href={"tel:" + physician.phone}
                      style={{ color: "var(--blue-600)", fontWeight: 600, textDecoration: "none" }}
                    >
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
