"use client";

import { useState } from "react";
import { submitLead } from "@/lib/api";
import type { Physician } from "@/types/physician";

interface Props {
  physician: Physician;
  nctId:     string;
  siteName?: string | null;
  onClick:   (physician: Physician) => void;
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
  const [leadState, setLeadState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const av = avatarColor(physician.name);

  const handleAddLead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (leadState !== "idle") return;
    setLeadState("loading");
    try {
      await submitLead({
        name:           physician.name,
        email:          `${physician.npi}@npi.local`,
        npi:            physician.npi,
        nct_id:         nctId,
        ...(siteName                ? { site:           siteName                } : {}),
        ...(physician.taxonomy_desc ? { title:          physician.taxonomy_desc } : {}),
        physician_name: physician.name,
        company:        "Individual Physicians",
        lead_source:    "Clinical Trial",
        auto:           true,
      });
      setLeadState("done");
    } catch {
      setLeadState("error");
      setTimeout(() => setLeadState("idle"), 3000);
    }
  };

  const btnLabel =
    leadState === "loading" ? "Adding…"      :
    leadState === "done"    ? "✓ Added"      :
    leadState === "error"   ? "⚠ Retry"      :
    "Add as Lead";

  const btnBg =
    leadState === "done"  ? "var(--green-600)" :
    leadState === "error" ? "var(--coral-600)" :
    "var(--blue-600)";

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
            className="phys-lead-btn"
            onClick={handleAddLead}
            disabled={leadState === "loading" || leadState === "done"}
            style={{ background: btnBg }}
          >
            {leadState === "loading" && (
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
      </div>
    </>
  );
}