"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { EmailLookupResult } from "@/lib/api";

export type PopupReason = "not_found" | "no_email" | "lookup_error";

/**
 * Single source of truth for turning an EmailLookupResult into a reason code.
 * IMPORTANT: check `error` first — a failed lookup is not the same thing as
 * "no match found," and telling the user their physician wasn't found when
 * the lookup actually crashed is misleading.
 */
export function resolvePopupReason(result: EmailLookupResult): PopupReason {
  if (result.error) return "lookup_error";
  return result.found ? "no_email" : "not_found";
}

const COPY: Record<PopupReason, { title: string; body: (name: string) => ReactNode }> = {
  not_found: {
    title: "Physician not found on Apollo",
    body: (name) => (
      <>No exact match for <strong>{name}</strong> was found on Apollo.</>
    ),
  },
  no_email: {
    title: "Email not available",
    body: (name) => (
      <>
        <strong>{name}</strong> was found on Apollo, but no verified email
        address is available.
      </>
    ),
  },
  lookup_error: {
    title: "Couldn't verify email",
    body: (name) => (
      <>
        We ran into a problem looking up an email for <strong>{name}</strong>.
        This doesn't necessarily mean the physician isn't in Apollo — the
        lookup itself failed.
      </>
    ),
  },
};

interface FallbackPopupProps {
  physicianName: string;
  reason:        PopupReason;
  onConfirm:     () => void;
  onCancel:      () => void;
  isSubmitting:  boolean;
}

export function LeadFallbackPopup({
  physicianName,
  reason,
  onConfirm,
  onCancel,
  isSubmitting,
}: FallbackPopupProps) {
  // Portal target (document.body) only exists on the client
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const copy = COPY[reason];

  const node = (
    <>
      <style>{`
        .lfp-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,0.38);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: fadeIn 0.15s ease both;
        }
        .lfp-card {
          background: #fff; border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.18);
          width: 100%; max-width: 380px;
          padding: 24px;
          font-family: var(--font-sans);
        }
        .lfp-icon {
          width: 44px; height: 44px; border-radius: 12px;
          background: #fff7ed; border: 1px solid #fed7aa;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; margin-bottom: 14px;
        }
        .lfp-title { font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 8px; line-height: 1.35; }
        .lfp-body  { font-size: 13px; color: var(--ink-3); line-height: 1.6; margin-bottom: 6px; }
        .lfp-note  {
          font-size: 11px; color: var(--muted);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 8px; padding: 8px 10px; margin-bottom: 18px; line-height: 1.5;
        }
        .lfp-actions { display: flex; gap: 10px; }
        .lfp-btn {
          flex: 1; height: 38px; border-radius: 10px;
          font-size: 13px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans); border: none; transition: all 0.15s;
          display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .lfp-btn-cancel  { background: var(--surface); border: 1px solid var(--border); color: var(--ink-3); }
        .lfp-btn-cancel:hover { background: var(--surface-2); }
        .lfp-btn-confirm { background: var(--green-600); color: #fff; }
        .lfp-btn-confirm:hover:not(:disabled) { filter: brightness(1.08); }
        .lfp-btn-confirm:disabled { opacity: 0.65; cursor: not-allowed; }
        .lfp-spinner {
          width: 12px; height: 12px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff; border-radius: 50%;
          animation: spinAnim 0.65s linear infinite;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <div className="lfp-overlay" onClick={onCancel}>
        <div className="lfp-card" onClick={(e) => e.stopPropagation()}>
          <div className="lfp-icon">⚠️</div>
          <div className="lfp-title">{copy.title}</div>
          <div className="lfp-body">{copy.body(physicianName)}</div>
          <div className="lfp-note">
            Do you still want to add this lead to Salesforce without an email?
          </div>
          <div className="lfp-actions">
            <button className="lfp-btn lfp-btn-cancel" onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="lfp-btn lfp-btn-confirm"
              onClick={onConfirm}
              disabled={isSubmitting}
              type="button"
            >
              {isSubmitting ? (
                <>
                  <div className="lfp-spinner" /> Adding…
                </>
              ) : (
                "Add without email"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  // Avoid SSR mismatch — only portal once mounted on the client
  if (!mounted) return null;
  return createPortal(node, document.body);
}