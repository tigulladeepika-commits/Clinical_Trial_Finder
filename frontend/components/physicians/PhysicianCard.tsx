"use client";

import { useState, useCallback } from "react";
import { submitLead, fetchPhysicianEmail } from "@/lib/api";
import type { Physician } from "@/types/physician";

interface Props {
  physician: Physician;
  nctId:     string;
  siteName?: string | null;
  onClick:   (physician: Physician) => void;
}

type LeadFlow =
  | "idle"
  | "fetching"
  | "confirm"
  | "submitting"
  | "done"
  | "error";

type PopupReason = "not_found" | "no_email";

interface FallbackPopupProps {
  physicianName: string;
  reason:        PopupReason;
  onConfirm:     () => void;
  onCancel:      () => void;
  isSubmitting:  boolean;
}

function FallbackPopup({ physicianName, reason, onConfirm, onCancel, isSubmitting }: FallbackPopupProps) {
  return (
    <div className="popup-overlay" onClick={onCancel}>
      <div className="popup-card" onClick={(e) => e.stopPropagation()}>
        <div className="popup-icon">⚠️</div>
        <div className="popup-title">
          {reason === "no_email"
            ? "Email not available"
            : "Physician not found on Apollo"}
        </div>
        <div className="popup-body">
          {reason === "no_email" ? (
            <>
              <strong>{physicianName}</strong> was found on Apollo but no
              verified email address is available.
            </>
          ) : (
            <>
              No exact match for <strong>{physicianName}</strong> was found
              on Apollo.
            </>
          )}
        </div>
        <div className="popup-note">
          Add this lead to Salesforce with a <strong>placeholder email</strong>?
        </div>
        <div className="popup-actions">
          <button className="popup-btn popup-btn-cancel" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="popup-btn popup-btn-confirm"
            onClick={onConfirm}
            disabled={isSubmitting}
            type="button"
          >
            {isSubmitting ? "Adding…" : "Add with placeholder"}
          </button>
        </div>
      </div>
    </div>
  );
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

// Pick a deterministic avatar color from the name
function avatarColor(name: string): { bg: string; color: string } {
  const colors = [
    { bg: "#d1fae5", color: "#065f46" },
    { bg: "#dbeafe", color: "#1e40af" },
    { bg: "#ede9fe", color: "#5b21b6" },
    { bg: "#fef3c7", color: "#92400e" },
    { bg: "#fce7f3", color: "#9d174d" },
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// Change 1: Mask phone number — show only last 4 digits
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    const last4 = digits.slice(-4);
    return `(***) ***-${last4}`;
  }
  // Fallback: mask all but last 4 characters
  if (phone.length > 4) {
    return `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
  }
  return phone;
}

export default function PhysicianCard({ physician, nctId, siteName, onClick }: Props) {
  const [leadState, setLeadState] = useState<LeadFlow>("idle");
  const [popupReason, setPopupReason] = useState<PopupReason>("not_found");
  const av = avatarColor(physician.name);

  const submitWithEmail = useCallback(async (email: string) => {
    try {
      await submitLead({
        name:           physician.name,
        email,
        company:        "Individual Physicians",
        lead_source:    "Clinical Trial",
        npi:            physician.npi,
        nct_id:         nctId,
        ...(siteName                ? { site:           siteName                } : {}),
        ...(physician.taxonomy_desc ? { title:          physician.taxonomy_desc } : {}),
        ...(physician.phone         ? { phone:          physician.phone         } : {}),
        physician_name: physician.name,
        auto:           true,
      });
      setLeadState("done");
    } catch {
      setLeadState("error");
      setTimeout(() => setLeadState("idle"), 3000);
    }
  }, [physician, nctId, siteName]);

  const handleAddLead = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (leadState !== "idle") return;

    setLeadState("fetching");

    const result = await fetchPhysicianEmail({
      name:         physician.name,
      address:      physician.address ?? "",
      organization: siteName ?? "",
    });

    if (result.found && result.email) {
      await submitWithEmail(result.email);
      return;
    }

    setPopupReason(result.found ? "no_email" : "not_found");
    setLeadState("confirm");
  }, [leadState, physician, siteName, submitWithEmail]);

  const handleFallbackConfirm = useCallback(async () => {
    setLeadState("submitting");
    await submitWithEmail("placeholder@aquarient.com");
  }, [submitWithEmail]);

  const handleFallbackCancel = useCallback(() => {
    setLeadState("idle");
  }, []);

  const btnLabel =
    leadState === "fetching"   ? "Looking up email…" :
    leadState === "submitting" ? "Adding…"         :
    leadState === "done"      ? "✓ Lead Added"     :
    leadState === "error"     ? "⚠ Retry"          :
    "Add as lead to Salesforce";

  const btnBg =
    leadState === "done"  ? "var(--green-600)" :
    leadState === "error" ? "var(--coral-600)" :
    "var(--blue-600)";

  const btnDisabled =
    leadState === "fetching"  ||
    leadState === "confirm"   ||
    leadState === "submitting"||
    leadState === "done";

  return (
    <>
      <style>{`
        .phys-card {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 13px 14px;
          cursor: pointer; outline: none;
          transition: all 0.16s cubic-bezier(.22,1,.36,1);
          position: relative; overflow: hidden;
        }
        .phys-card::before {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0;
          width: 3px; background: transparent; transition: background 0.14s;
        }
        .phys-card:hover {
          border-color: var(--blue-500);
          box-shadow: 0 4px 16px rgba(37,99,235,0.10);
          transform: translateY(-1px);
        }
        .phys-card:hover::before { background: var(--blue-500); }
        .phys-card:focus-visible {
          outline: 2px solid var(--blue-500); outline-offset: 2px;
        }
        .phys-avatar {
          width: 38px; height: 38px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700; flex-shrink: 0;
          font-family: var(--font-mono);
        }
        .phys-name {
          font-size: 13px; font-weight: 600; color: var(--ink);
          line-height: 1.3;
        }
        .phys-spec {
          font-size: 11px; color: var(--muted); margin-top: 2px;
        }
        .phys-dist {
          font-size: 11px; font-weight: 700; color: var(--blue-600);
          font-family: var(--font-mono); flex-shrink: 0;
          background: var(--blue-50); padding: 2px 8px;
          border-radius: 20px; border: 1px solid var(--blue-200);
        }
        .phys-meta {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          font-size: 11px; color: var(--muted);
          border-top: 1px solid var(--border);
          padding-top: 9px; margin-top: 9px;
        }
        .phys-npi {
          margin-left: auto; font-family: var(--font-mono);
          font-size: 10px; color: var(--muted-light);
        }
        .phys-actions {
          display: flex; align-items: center;
          justify-content: space-between;
          margin-top: 10px; gap: 8px;
        }
        .phys-success {
          margin-top: 10px;
          font-size: 12px; color: var(--green-700);
          background: #ecfdf5; border: 1px solid #bbf7d0;
          border-radius: 12px; padding: 8px 10px;
        }
        .phys-view-link {
          font-size: 11px; color: var(--muted);
          display: flex; align-items: center; gap: 4px;
          font-weight: 500;
        }
        .phys-card:hover .phys-view-link { color: var(--blue-600); }
        .phys-lead-btn {
          padding: 4px 12px; color: #fff; border: none;
          border-radius: var(--radius-sm); font-size: 11px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans); flex-shrink: 0;
          transition: all 0.16s; display: flex; align-items: center; gap: 4px;
        }
        .phys-lead-btn:not(:disabled):hover {
          filter: brightness(1.1);
          box-shadow: 0 3px 10px rgba(0,0,0,0.2);
        }
        .phys-lead-btn:disabled { opacity: 0.65; cursor: not-allowed; }

        .popup-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,0.38);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .popup-card {
          width: min(100%, 360px);
          background: #fff; border-radius: 16px;
          border: 1px solid var(--border);
          box-shadow: 0 22px 60px rgba(0,0,0,0.18);
          padding: 22px;
          font-family: var(--font-sans);
        }
        .popup-icon {
          width: 46px; height: 46px; border-radius: 14px;
          background: #fef3c7; border: 1px solid #fde68a;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 14px; font-size: 22px;
        }
        .popup-title {
          font-size: 14px; font-weight: 700; color: var(--ink);
          margin-bottom: 10px;
        }
        .popup-body {
          font-size: 12px; color: var(--ink-3); line-height: 1.6;
          margin-bottom: 10px;
        }
        .popup-note {
          font-size: 11px; color: var(--muted);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 10px 12px; margin-bottom: 16px;
        }
        .popup-actions {
          display: flex; gap: 10px;
        }
        .popup-btn {
          flex: 1; height: 38px; border-radius: 10px; border: none;
          font-size: 12px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans); transition: all 0.15s;
        }
        .popup-btn-cancel {
          background: var(--surface); border: 1px solid var(--border);
          color: var(--ink-3);
        }
        .popup-btn-confirm {
          background: var(--green-600); color: #fff;
        }
        .popup-btn-confirm:disabled { opacity: 0.65; cursor: not-allowed; }
      `}</style>

      <div
        className="phys-card"
        onClick={() => onClick(physician)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onClick(physician)}
      >
        {/* Top row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div className="phys-avatar" style={{ background: av.bg, color: av.color }}>
            {initials(physician.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="phys-name">{physician.name}</div>
            {physician.taxonomy_desc && (
              <div className="phys-spec">{physician.taxonomy_desc}</div>
            )}
          </div>
          {physician.distance_miles != null && (
            <div className="phys-dist">
              {physician.distance_miles.toFixed(1)} mi
            </div>
          )}
        </div>

        {/* Meta row */}
        <div className="phys-meta">
          {physician.address && (
            <span>📍 {physician.address.split(",").slice(0, 2).join(",")}</span>
          )}
          {/* Change 1: Display masked phone number */}
          {physician.phone && <span>📞 {maskPhone(physician.phone)}</span>}
          <span className="phys-npi">NPI: {physician.npi}</span>
        </div>

        {/* Actions */}
        <div className="phys-actions">
          <span className="phys-view-link">
            View details →
          </span>
          <button
            type="button"
            className="phys-lead-btn"
            onClick={handleAddLead}
            disabled={btnDisabled}
            style={{ background: btnBg }}
          >
            {(leadState === "fetching" || leadState === "submitting") && (
              <span style={{
                width: 10, height: 10,
                border: "1.5px solid rgba(255,255,255,0.4)",
                borderTopColor: "#fff", borderRadius: "50%",
                animation: "spinAnim 0.65s linear infinite",
              }} />
            )}
            {btnLabel}
          </button>
        </div>
        {leadState === "done" && (
          <div className="phys-success">
            Lead captured for {physician.name} in Salesforce.
          </div>
        )}
      </div>

      {(leadState === "confirm" || leadState === "submitting") && (
        <FallbackPopup
          physicianName={physician.name}
          reason={popupReason}
          onConfirm={handleFallbackConfirm}
          onCancel={handleFallbackCancel}
          isSubmitting={leadState === "submitting"}
        />
      )}
    </>
  );
}