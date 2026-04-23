// components/shared/LeadCaptureModal.tsx
// Contact form modal — appears when user clicks "Capture Lead" on a PhysicianCard
// OR when user clicks "Load More" for physicians (change #6).
// POSTs to /api/leads.

"use client";

import React, { useState, useEffect, useRef } from "react";
import { submitLead }     from "@/lib/api";
import type { Physician } from "@/types/physician";

type TriggerSource = "card" | "load_more";

type Props = {
  physician:     Physician;
  nctId:         string;
  siteName:      string | null;
  onClose:       () => void;
  /** Where the modal was opened from — affects the header copy. Default: "card" */
  triggerSource?: TriggerSource;
};

type FormState = {
  name:    string;
  email:   string;
  phone:   string;
  message: string;
};

const EMPTY: FormState = { name: "", email: "", phone: "", message: "" };

// ── Design tokens (mirroring the app-wide CSS variables) ──────────────────────
const TOKEN = {
  // Surfaces
  white:       "#ffffff",
  gray50:      "#f8fafc",
  gray100:     "#f1f5f9",
  gray200:     "#e2e8f0",
  gray300:     "#cbd5e1",
  gray400:     "#94a3b8",
  gray500:     "#64748b",
  gray600:     "#475569",
  gray700:     "#334155",
  gray800:     "#1e293b",
  gray900:     "#0f172a",

  // Brand / action
  blue500:     "#3b82f6",
  blue600:     "#2563eb",
  blue700:     "#1d4ed8",

  // Semantic — universal status color conventions (change #8)
  successBg:   "#dcfce7",
  successFg:   "#16a34a",
  errorBg:     "#fee2e2",
  errorFg:     "#dc2626",
  errorBorder: "#fecaca",
  warningBg:   "#fef9c3",
  warningFg:   "#ca8a04",
};

export default function LeadCaptureModal({
  physician,
  nctId,
  siteName,
  onClose,
  triggerSource = "card",
}: Props) {
  const [form,       setForm]       = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const firstInputRef               = useRef<HTMLInputElement>(null);

  // Focus first input on mount for accessibility
  useEffect(() => {
    const t = setTimeout(() => firstInputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  const isValid = form.name.trim() !== "" && form.email.trim() !== "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    setError(null);

    try {
      await submitLead({
        name:    form.name.trim(),
        email:   form.email.trim(),
        phone:   form.phone.trim(),
        npi:     physician.npi,
        nct_id:  nctId,
        site:    siteName ?? "",
        message: form.message.trim(),
      });
      setSubmitted(true);
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Header copy differs by trigger source (change #6)
  const headerTitle =
    triggerSource === "load_more"
      ? "Save Physician Before Loading More"
      : "Capture Lead";

  const headerSubtitle =
    triggerSource === "load_more"
      ? "Add your details to save this contact and continue browsing."
      : `${physician.name}${physician.taxonomy_desc ? ` · ${physician.taxonomy_desc}` : ""}`;

  // ── Styles ──────────────────────────────────────────────────────────────────

  const s = {
    overlay: {
      position:       "fixed" as const,
      inset:          0,
      background:     "rgba(15,23,42,0.55)",
      backdropFilter: "blur(4px)",
      WebkitBackdropFilter: "blur(4px)",
      zIndex:         1000,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      padding:        "16px",
      animation:      "fadeIn 0.15s ease",
    },

    modal: {
      background:    TOKEN.white,
      borderRadius:  20,
      width:         "100%",
      maxWidth:      500,
      boxShadow:     "0 32px 80px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)",
      overflow:      "hidden",
      animation:     "slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)",
    },

    header: {
      padding:        "20px 24px 18px",
      borderBottom:   `1px solid ${TOKEN.gray100}`,
      display:        "flex",
      alignItems:     "flex-start",
      justifyContent: "space-between",
      gap:            12,
      background:     `linear-gradient(135deg, ${TOKEN.gray50} 0%, ${TOKEN.white} 100%)`,
    },

    closeBtn: {
      background:  "none",
      border:      `1px solid ${TOKEN.gray200}`,
      borderRadius: 8,
      cursor:      "pointer",
      width:       32,
      height:      32,
      display:     "flex",
      alignItems:  "center",
      justifyContent: "center",
      color:       TOKEN.gray400,
      flexShrink:  0,
      fontSize:    18,
      lineHeight:  1,
      transition:  "background 0.12s, color 0.12s",
    },

    contextStrip: {
      padding:      "10px 24px",
      background:   TOKEN.gray50,
      borderBottom: `1px solid ${TOKEN.gray100}`,
      fontSize:     12,
      color:        TOKEN.gray500,
      display:      "flex",
      gap:          16,
      flexWrap:     "wrap" as const,
    },

    body: {
      padding: "22px 24px 26px",
    },

    label: {
      fontSize:     12,
      fontWeight:   600,
      color:        TOKEN.gray600,
      display:      "block",
      marginBottom: 5,
      letterSpacing: "0.02em",
    },

    input: {
      width:        "100%",
      padding:      "10px 13px",
      border:       `1.5px solid ${TOKEN.gray200}`,
      borderRadius: 10,
      fontSize:     14,
      color:        TOKEN.gray800,
      background:   TOKEN.gray50,
      outline:      "none",
      boxSizing:    "border-box" as const,
      transition:   "border-color 0.15s, box-shadow 0.15s",
    },

    errorBox: {
      padding:      "10px 14px",
      borderRadius: 10,
      background:   TOKEN.errorBg,
      color:        TOKEN.errorFg,
      fontSize:     13,
      border:       `1px solid ${TOKEN.errorBorder}`,
      display:      "flex",
      alignItems:   "center",
      gap:          8,
    },

    btnCancel: {
      padding:      "10px 20px",
      borderRadius: 10,
      border:       `1.5px solid ${TOKEN.gray200}`,
      background:   "transparent",
      color:        TOKEN.gray600,
      fontWeight:   600,
      fontSize:     14,
      cursor:       "pointer",
      transition:   "background 0.12s",
    },

    btnSubmit: (disabled: boolean) => ({
      padding:      "10px 26px",
      borderRadius: 10,
      border:       "none",
      background:   disabled ? TOKEN.gray300 : TOKEN.blue600,
      color:        "#fff",
      fontWeight:   700,
      fontSize:     14,
      cursor:       disabled ? "not-allowed" : "pointer",
      transition:   "background 0.15s, transform 0.1s",
      letterSpacing: "0.01em",
    }),
  };

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.97) }
                             to   { opacity: 1; transform: translateY(0) scale(1) } }
        .lead-input:focus  { border-color: ${TOKEN.blue500} !important;
                             box-shadow: 0 0 0 3px rgba(59,130,246,0.15) !important;
                             background: ${TOKEN.white} !important; }
        .lead-cancel:hover { background: ${TOKEN.gray100} !important; }
        .lead-submit:hover:not(:disabled) { background: ${TOKEN.blue700} !important; transform: translateY(-1px); }
        .lead-close:hover  { background: ${TOKEN.gray100} !important; color: ${TOKEN.gray700} !important; }
      `}</style>

      <div
        style={s.overlay}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        role="dialog"
        aria-modal="true"
        aria-label="Capture Lead"
      >
        <div style={s.modal}>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div style={s.header}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: TOKEN.gray900, marginBottom: 3 }}>
                {headerTitle}
              </div>
              <div style={{ fontSize: 12, color: TOKEN.gray500, lineHeight: 1.4 }}>
                {headerSubtitle}
              </div>
            </div>
            <button
              className="lead-close"
              onClick={onClose}
              style={s.closeBtn}
              aria-label="Close"
            >×</button>
          </div>

          {/* ── Context strip ──────────────────────────────────────────── */}
          <div style={s.contextStrip}>
            <span>
              NPI:{" "}
              <strong style={{ color: TOKEN.gray700, fontVariantNumeric: "tabular-nums" }}>
                {physician.npi}
              </strong>
            </span>
            <span>
              Trial:{" "}
              <strong style={{ color: TOKEN.gray700 }}>{nctId}</strong>
            </span>
            {siteName && (
              <span>
                Site:{" "}
                <strong style={{ color: TOKEN.gray700 }}>{siteName}</strong>
              </span>
            )}
          </div>

          {/* ── Body ───────────────────────────────────────────────────── */}
          <div style={s.body}>

            {submitted ? (
              /* ── Success state ─────────────────────────────────────── */
              <div style={{ textAlign: "center", padding: "24px 0 8px" }}>
                <div style={{
                  width:        56,
                  height:       56,
                  borderRadius: "50%",
                  background:   TOKEN.successBg,
                  display:      "flex",
                  alignItems:   "center",
                  justifyContent: "center",
                  margin:       "0 auto 16px",
                  fontSize:     26,
                }}>✓</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: TOKEN.gray900, marginBottom: 6 }}>
                  Lead captured!
                </div>
                <div style={{ fontSize: 13, color: TOKEN.gray500, marginBottom: 24, lineHeight: 1.5 }}>
                  Contact details for <strong>{physician.name}</strong> have been saved.
                </div>
                <button
                  onClick={onClose}
                  style={s.btnSubmit(false)}
                  className="lead-submit"
                >Done</button>
              </div>

            ) : (
              /* ── Form ──────────────────────────────────────────────── */
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Name + Email row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={s.label}>
                      Name <span style={{ color: TOKEN.errorFg }}>*</span>
                    </label>
                    <input
                      ref={firstInputRef}
                      className="lead-input"
                      type="text"
                      required
                      value={form.name}
                      onChange={set("name")}
                      placeholder="Your name"
                      style={s.input}
                    />
                  </div>
                  <div>
                    <label style={s.label}>
                      Email <span style={{ color: TOKEN.errorFg }}>*</span>
                    </label>
                    <input
                      className="lead-input"
                      type="email"
                      required
                      value={form.email}
                      onChange={set("email")}
                      placeholder="you@org.com"
                      style={s.input}
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label style={s.label}>
                    Phone{" "}
                    <span style={{ color: TOKEN.gray400, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    className="lead-input"
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    placeholder="+1 (555) 000-0000"
                    style={s.input}
                  />
                </div>

                {/* Message */}
                <div>
                  <label style={s.label}>
                    Message{" "}
                    <span style={{ color: TOKEN.gray400, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <textarea
                    className="lead-input"
                    value={form.message}
                    onChange={set("message")}
                    placeholder="Any notes about this outreach…"
                    rows={3}
                    style={{ ...s.input, resize: "vertical", lineHeight: 1.6 }}
                  />
                </div>

                {/* Error */}
                {error && (
                  <div style={s.errorBox}>
                    <span style={{ fontSize: 15 }}>⚠</span>
                    {error}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 2 }}>
                  <button
                    type="button"
                    className="lead-cancel"
                    onClick={onClose}
                    style={s.btnCancel}
                  >Cancel</button>
                  <button
                    type="submit"
                    className="lead-submit"
                    disabled={submitting || !isValid}
                    style={s.btnSubmit(submitting || !isValid)}
                  >
                    {submitting ? "Saving…" : "Save Lead"}
                  </button>
                </div>

              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}