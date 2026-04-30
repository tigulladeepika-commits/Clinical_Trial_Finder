// components/shared/LeadCaptureModal.tsx
//
// Used by the "Load More" button flow.
// When `physician` prop is supplied the form is pre-filled with that
// physician's details and the user can edit before submitting.
// When no `physician` is supplied (generic modal) all fields are blank.
//
// After a successful submit `onSuccess` is called so the parent can
// proceed with the actual "load more" network request.
"use client";

import { useState, useCallback } from "react";
import { submitLead }            from "@/lib/api";
import type { LeadPayload }      from "@/types/physician";

interface PhysicianInfo {
  name:          string;
  npi:           string;
  taxonomy_desc?: string | null;
}

interface Props {
  npi?:        string;
  nctId:       string;
  siteName?:   string | null;
  /** When provided the form is pre-filled with this physician's info */
  physician?:  PhysicianInfo;
  onClose:     () => void;
  /** Called after a successful lead submission (e.g. trigger loadMore) */
  onSuccess?:  () => void;
}

export default function LeadCaptureModal({
  npi,
  nctId,
  siteName,
  physician,
  onClose,
  onSuccess,
}: Props) {
  // Pre-fill name from physician if available
  const prefillParts = physician ? physician.name.trim().split(" ") : [];
  const prefillFirst = prefillParts[0] ?? "";
  const prefillLast  = prefillParts.slice(1).join(" ");

  const [firstName, setFirstName] = useState(prefillFirst);
  const [lastName,  setLastName]  = useState(prefillLast);
  const [email,     setEmail]     = useState("");
  const [phone,     setPhone]     = useState("");
  const [company,   setCompany]   = useState("");
  const [message,   setMessage]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [success,   setSuccess]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const resolvedNpi = npi ?? physician?.npi ?? "";

  const handleSubmit = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("A valid email address is required.");
      return;
    }
    if (!company.trim()) {
      setError("Company / organisation is required.");
      return;
    }

    setLoading(true);
    setError(null);

    const fullName = `${firstName.trim()} ${lastName.trim()}`;

    const payload: LeadPayload = {
      name:           fullName,
      email:          email.trim(),
      company:        company.trim(),
      lead_source:    "Clinical Trial",
      npi:            resolvedNpi,
      nct_id:         nctId,
      physician_name: physician?.name ?? fullName,
      ...(physician?.taxonomy_desc ? { title: physician.taxonomy_desc } : {}),
      ...(phone.trim()   ? { phone:   phone.trim()   } : {}),
      ...(siteName       ? { site:    siteName        } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
      auto: false,
    };

    try {
      await submitLead(payload);
      setSuccess(true);
      // Notify parent (e.g. trigger loadMore) then close after 2 s
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 2000);
    } catch (err: unknown) {
      setError((err as Error).message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [firstName, lastName, email, phone, company, message, resolvedNpi, nctId, siteName, physician, onClose, onSuccess]);

  return (
    <>
      <style>{`
        .lcm-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.48);
          z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: lcmFadeIn 0.18s ease;
        }
        @keyframes lcmFadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lcmSlideUp { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }

        .lcm-box {
          background: #fff;
          border-radius: 16px;
          width: 100%; max-width: 480px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.18);
          overflow: hidden;
          animation: lcmSlideUp 0.22s ease;
          display: flex; flex-direction: column;
          max-height: 90vh;
        }

        .lcm-hdr {
          padding: 18px 20px 14px;
          border-bottom: 1px solid #e4e8f0;
          display: flex; align-items: flex-start; justify-content: space-between;
          flex-shrink: 0;
        }
        .lcm-hdr-text {}
        .lcm-title { font-size: 15px; font-weight: 700; color: #0d1117; }
        .lcm-sub   { font-size: 11px; color: #8b95a1; margin-top: 3px; }
        .lcm-close-btn {
          width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          background: #f1f5f9; border: none; border-radius: 7px;
          cursor: pointer; font-size: 16px; color: #64748b;
          flex-shrink: 0; transition: background 0.15s;
        }
        .lcm-close-btn:hover { background: #e2e8f0; color: #0d1117; }

        .lcm-sf-badge {
          display: flex; align-items: center; gap: 7px;
          padding: 8px 16px;
          background: #f0fdf4; border-bottom: 1px solid #bbf7d0;
          flex-shrink: 0;
        }
        .lcm-sf-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #16a34a; flex-shrink: 0;
          box-shadow: 0 0 0 3px rgba(22,163,74,0.15);
        }
        .lcm-sf-text { font-size: 11px; font-weight: 600; color: #15803d; }
        .lcm-sf-chip {
          margin-left: auto;
          background: #dcfce7; border-radius: 4px;
          padding: 2px 8px; font-size: 10px; font-weight: 700;
          color: #15803d; letter-spacing: 0.3px;
        }

        /* Physician info banner (shown when pre-filling from a physician) */
        .lcm-physician-banner {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 16px;
          background: #eff6ff; border-bottom: 1px solid #bfdbfe;
          flex-shrink: 0;
        }
        .lcm-physician-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          background: linear-gradient(135deg,#eff6ff,#bfdbfe);
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: #2563eb; flex-shrink: 0;
        }
        .lcm-physician-name { font-size: 12px; font-weight: 700; color: #1e40af; }
        .lcm-physician-spec { font-size: 10px; color: #3b82f6; margin-top: 1px; }

        .lcm-body {
          flex: 1; overflow-y: auto;
          padding: 18px 20px;
          display: flex; flex-direction: column; gap: 12px;
        }

        .lcm-row   { display: flex; gap: 12px; }
        .lcm-field { display: flex; flex-direction: column; gap: 4px; flex: 1; }

        .lcm-label {
          font-size: 10px; font-weight: 700; color: #64748b;
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .lcm-required { color: #dc2626; margin-left: 2px; }

        .lcm-input {
          height: 36px; padding: 0 12px;
          border: 1px solid #e4e8f0; border-radius: 8px;
          font-size: 13px; color: #0d1117; background: #f6f7fb;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          font-family: inherit; width: 100%;
        }
        .lcm-input:focus {
          border-color: #2563eb; background: #fff;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.10);
        }
        .lcm-input::placeholder { color: #c0c8d4; }

        .lcm-textarea {
          padding: 9px 12px; resize: none;
          border: 1px solid #e4e8f0; border-radius: 8px;
          font-size: 13px; color: #0d1117; background: #f6f7fb;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          font-family: inherit; width: 100%; line-height: 1.5;
        }
        .lcm-textarea:focus {
          border-color: #2563eb; background: #fff;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.10);
        }
        .lcm-textarea::placeholder { color: #c0c8d4; }

        .lcm-error {
          margin: 0 20px;
          padding: 9px 12px;
          border-radius: 8px;
          background: #fef2f2; border: 1px solid #fecaca;
          color: #dc2626; font-size: 12px; font-weight: 500;
          flex-shrink: 0;
        }

        .lcm-footer {
          padding: 12px 20px;
          border-top: 1px solid #e4e8f0;
          display: flex; align-items: center; justify-content: flex-end; gap: 8px;
          flex-shrink: 0; background: #fff;
        }
        .lcm-cancel {
          padding: 8px 16px; background: transparent;
          border: 1px solid #e4e8f0; border-radius: 8px;
          font-size: 13px; color: #4b5563; cursor: pointer;
          font-family: inherit; transition: background 0.15s;
        }
        .lcm-cancel:hover { background: #f6f7fb; }
        .lcm-submit {
          padding: 8px 22px; background: #2563eb; color: #fff;
          border: none; border-radius: 8px;
          font-size: 13px; font-weight: 700; cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
          display: flex; align-items: center; gap: 6px;
        }
        .lcm-submit:hover:not(:disabled) { background: #1d4ed8; }
        .lcm-submit:disabled { opacity: 0.6; cursor: not-allowed; }

        .lcm-success {
          display: flex; flex-direction: column;
          align-items: center; gap: 12px;
          padding: 48px 24px; text-align: center;
        }
        .lcm-success-icon  { font-size: 42px; }
        .lcm-success-title { font-size: 16px; font-weight: 700; color: #0d1117; }
        .lcm-success-sub   { font-size: 13px; color: #8b95a1; max-width: 280px; line-height: 1.6; }
        .lcm-success-sf    {
          font-size: 11px; font-weight: 600; color: #15803d;
          background: #f0fdf4; border: 1px solid #bbf7d0;
          border-radius: 20px; padding: 4px 14px;
        }

        .lcm-btn-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: lcmSpin 0.65s linear infinite;
        }
        @keyframes lcmSpin { to { transform: rotate(360deg); } }
      `}</style>

      <div
        className="lcm-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="lcm-box">

          {/* Header */}
          <div className="lcm-hdr">
            <div className="lcm-hdr-text">
              <div className="lcm-title">
                {physician ? "Add Physician as Lead" : "Generate Salesforce Lead"}
              </div>
              <div className="lcm-sub">
                {nctId}{siteName ? ` · ${siteName}` : ""}
              </div>
            </div>
            <button className="lcm-close-btn" onClick={onClose} title="Close">✕</button>
          </div>

          {/* Salesforce badge */}
          <div className="lcm-sf-badge">
            <div className="lcm-sf-dot" />
            <span className="lcm-sf-text">Lead will be added to Salesforce</span>
            <span className="lcm-sf-chip">Clinical Trial</span>
          </div>

          {/* Physician banner (only when pre-filling) */}
          {physician && (
            <div className="lcm-physician-banner">
              <div className="lcm-physician-avatar">
                {physician.name.replace(/^Dr\.\s*/i,"").split(" ").filter(Boolean).slice(0,2).map(n=>n[0].toUpperCase()).join("")}
              </div>
              <div>
                <div className="lcm-physician-name">{physician.name}</div>
                {physician.taxonomy_desc && (
                  <div className="lcm-physician-spec">{physician.taxonomy_desc}</div>
                )}
              </div>
            </div>
          )}

          {success ? (
            <div className="lcm-success">
              <div className="lcm-success-icon">✅</div>
              <div className="lcm-success-title">Lead submitted to Salesforce!</div>
              <div className="lcm-success-sub">
                {onSuccess
                  ? "Lead created. Loading more physicians now…"
                  : "The lead has been created. Our team will follow up shortly."}
              </div>
              <div className="lcm-success-sf">Lead Source: Clinical Trial</div>
            </div>
          ) : (
            <>
              <div className="lcm-body">

                {/* Name row — pre-filled when physician is supplied */}
                <div className="lcm-row">
                  <div className="lcm-field">
                    <label className="lcm-label">
                      First Name<span className="lcm-required">*</span>
                    </label>
                    <input
                      className="lcm-input"
                      type="text"
                      placeholder="Jane"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      autoComplete="given-name"
                    />
                  </div>
                  <div className="lcm-field">
                    <label className="lcm-label">
                      Last Name<span className="lcm-required">*</span>
                    </label>
                    <input
                      className="lcm-input"
                      type="text"
                      placeholder="Smith"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name"
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="lcm-field">
                  <label className="lcm-label">
                    Email<span className="lcm-required">*</span>
                  </label>
                  <input
                    className="lcm-input"
                    type="email"
                    placeholder="jane.smith@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>

                {/* Phone + Company */}
                <div className="lcm-row">
                  <div className="lcm-field">
                    <label className="lcm-label">Phone</label>
                    <input
                      className="lcm-input"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                    />
                  </div>
                  <div className="lcm-field">
                    <label className="lcm-label">
                      Company<span className="lcm-required">*</span>
                    </label>
                    <input
                      className="lcm-input"
                      type="text"
                      placeholder="Organisation name"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      autoComplete="organization"
                    />
                  </div>
                </div>

                {/* Message */}
                <div className="lcm-field">
                  <label className="lcm-label">Message</label>
                  <textarea
                    className="lcm-textarea"
                    rows={3}
                    placeholder="Describe what you're looking for…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>

              </div>

              {error && <p className="lcm-error">{error}</p>}

              <div className="lcm-footer">
                <button className="lcm-cancel" onClick={onClose}>Cancel</button>
                <button
                  className="lcm-submit"
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading
                    ? <><div className="lcm-btn-spinner" /> Submitting…</>
                    : onSuccess ? "Submit & Load More" : "Add to Salesforce"}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}