// components/shared/LeadCaptureModal.tsx
// Contact form modal — appears when user clicks "Capture Lead"
// on a PhysicianCard. POSTs to /api/leads.

"use client";

import React, { useState } from "react";
import { submitLead }       from "@/lib/api";
import type { Physician }   from "@/types/physician";

type Props = {
  physician: Physician;
  nctId:     string;
  siteName:  string | null;
  onClose:   () => void;
};

type FormState = {
  name:    string;
  email:   string;
  phone:   string;
  message: string;
};

const EMPTY: FormState = { name: "", email: "", phone: "", message: "" };

export default function LeadCaptureModal({ physician, nctId, siteName, onClose }: Props) {
  const [form,      setForm]      = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;

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

  // ── Styles ──────────────────────────────────────────────────────────────────
  const overlay: React.CSSProperties = {
    position:       "fixed",
    inset:          0,
    background:     "rgba(0,0,0,0.45)",
    zIndex:         1000,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    padding:        "16px",
  };

  const modal: React.CSSProperties = {
    background:   "var(--white, #fff)",
    borderRadius: 16,
    width:        "100%",
    maxWidth:     480,
    boxShadow:    "0 24px 64px rgba(0,0,0,0.18)",
    overflow:     "hidden",
  };

  const header: React.CSSProperties = {
    padding:       "18px 24px 16px",
    borderBottom:  "1px solid var(--gray-100, #f1f5f9)",
    display:       "flex",
    alignItems:    "flex-start",
    justifyContent:"space-between",
    gap:            12,
  };

  const inputStyle: React.CSSProperties = {
    width:        "100%",
    padding:      "9px 12px",
    border:       "1px solid var(--gray-200, #e2e8f0)",
    borderRadius:  8,
    fontSize:      14,
    color:         "var(--gray-800, #1e293b)",
    background:    "var(--gray-50, #f8fafc)",
    outline:       "none",
    boxSizing:     "border-box",
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>

        {/* Header */}
        <div style={header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--gray-800, #1e293b)" }}>
              Capture Lead
            </div>
            <div style={{ fontSize: 12, color: "var(--gray-400, #94a3b8)", marginTop: 3 }}>
              {physician.name}
              {physician.taxonomy_desc && ` · ${physician.taxonomy_desc}`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 20, color: "var(--gray-400, #94a3b8)", lineHeight: 1, padding: 0,
            }}
            aria-label="Close"
          >×</button>
        </div>

        {/* Context strip */}
        <div style={{
          padding:    "10px 24px",
          background: "var(--gray-50, #f8fafc)",
          borderBottom: "1px solid var(--gray-100, #f1f5f9)",
          fontSize:   12,
          color:      "var(--gray-500, #64748b)",
          display:    "flex",
          gap:        16,
          flexWrap:   "wrap",
        }}>
          <span>NPI: <strong style={{ color: "var(--gray-700, #334155)" }}>{physician.npi}</strong></span>
          <span>Trial: <strong style={{ color: "var(--gray-700, #334155)" }}>{nctId}</strong></span>
          {siteName && <span>Site: <strong style={{ color: "var(--gray-700, #334155)" }}>{siteName}</strong></span>}
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 24px" }}>

          {submitted ? (
            /* Success state */
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--gray-800, #1e293b)", marginBottom: 6 }}>
                Lead captured!
              </div>
              <div style={{ fontSize: 13, color: "var(--gray-400, #94a3b8)", marginBottom: 20 }}>
                Your contact details have been saved.
              </div>
              <button
                onClick={onClose}
                style={{
                  padding: "9px 24px", borderRadius: 8, border: "none",
                  background: "var(--blue-600, #2563eb)", color: "#fff",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >Done</button>
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-600, #475569)", display: "block", marginBottom: 5 }}>
                    Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={set("name")}
                    placeholder="Your name"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-600, #475569)", display: "block", marginBottom: 5 }}>
                    Email <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={set("email")}
                    placeholder="you@org.com"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-600, #475569)", display: "block", marginBottom: 5 }}>
                  Phone <span style={{ color: "var(--gray-400, #94a3b8)", fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="+1 (555) 000-0000"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-600, #475569)", display: "block", marginBottom: 5 }}>
                  Message <span style={{ color: "var(--gray-400, #94a3b8)", fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  value={form.message}
                  onChange={set("message")}
                  placeholder="Any notes about this outreach…"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                />
              </div>

              {error && (
                <div style={{
                  padding: "10px 14px", borderRadius: 8,
                  background: "#fee2e2", color: "#dc2626",
                  fontSize: 13, border: "1px solid #fecaca",
                }}>{error}</div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "9px 20px", borderRadius: 8,
                    border: "1px solid var(--gray-200, #e2e8f0)",
                    background: "transparent", color: "var(--gray-600, #475569)",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                  }}
                >Cancel</button>
                <button
                  type="submit"
                  disabled={submitting || !form.name.trim() || !form.email.trim()}
                  style={{
                    padding: "9px 24px", borderRadius: 8, border: "none",
                    background: submitting ? "var(--gray-300, #cbd5e1)" : "var(--blue-600, #2563eb)",
                    color: "#fff", fontWeight: 600, fontSize: 14,
                    cursor: submitting ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                  }}
                >
                  {submitting ? "Saving…" : "Save Lead"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}