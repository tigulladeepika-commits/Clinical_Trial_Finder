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
  physician?:  PhysicianInfo;
  onClose:     () => void;
  onSuccess?:  () => void;
}

export default function LeadCaptureModal({ npi, nctId, siteName, physician, onClose, onSuccess }: Props) {
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
      setError("First and last name are required."); return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("A valid email address is required."); return;
    }
    if (!company.trim()) {
      setError("Company / organisation is required."); return;
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
      setTimeout(() => { onSuccess?.(); onClose(); }, 2000);
    } catch (err: unknown) {
      setError((err as Error).message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [firstName, lastName, email, phone, company, message, resolvedNpi, nctId, siteName, physician, onClose, onSuccess]);

  function initials(name: string) {
    return name.replace(/^Dr\.\s*/i, "").split(" ").filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join("");
  }

  return (
    <>
      <style>{`
        .lcm-backdrop {
          position: fixed; inset: 0;
          background: rgba(10,15,30,0.50);
          z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: fadeIn 0.18s ease both;
          backdrop-filter: blur(2px);
        }
        .lcm-box {
          background: #fff; border-radius: 20px;
          width: 100%; max-width: 488px;
          box-shadow: 0 32px 80px rgba(10,15,30,0.22), 0 0 0 1px rgba(10,15,30,0.05);
          overflow: hidden;
          animation: fadeUp 0.22s cubic-bezier(.22,1,.36,1) both;
          display: flex; flex-direction: column;
          max-height: 90vh;
        }
        .lcm-hdr {
          padding: 20px 22px 16px;
          border-bottom: 1px solid var(--border);
          display: flex; align-items: flex-start; justify-content: space-between;
          flex-shrink: 0;
        }
        .lcm-title { font-size: 16px; font-weight: 700; color: var(--ink); }
        .lcm-sub   { font-size: 11px; color: var(--muted); margin-top: 4px; font-family: var(--font-mono); }
        .lcm-close {
          width: 30px; height: 30px;
          display: flex; align-items: center; justify-content: center;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); cursor: pointer;
          font-size: 16px; color: var(--muted); flex-shrink: 0;
          transition: all 0.15s;
        }
        .lcm-close:hover { background: var(--surface-2); color: var(--ink); }
        .lcm-sf-bar {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 18px; background: var(--green-50);
          border-bottom: 1px solid var(--green-100); flex-shrink: 0;
        }
        .lcm-sf-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--green-500); flex-shrink: 0;
          box-shadow: 0 0 0 3px rgba(16,185,129,0.15);
        }
        .lcm-sf-text { font-size: 11px; font-weight: 600; color: var(--forest-mid); }
        .lcm-sf-chip {
          margin-left: auto; background: var(--green-100);
          border-radius: 20px; padding: 2px 9px;
          font-size: 10px; font-weight: 700; color: var(--forest-mid);
        }
        .lcm-physician-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 11px 18px; background: var(--blue-50);
          border-bottom: 1px solid #bfdbfe; flex-shrink: 0;
        }
        .lcm-physician-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: var(--navy); color: #fff;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; flex-shrink: 0;
          font-family: var(--font-mono);
        }
        .lcm-physician-name { font-size: 13px; font-weight: 700; color: #1e3a5f; }
        .lcm-physician-spec { font-size: 11px; color: var(--blue-600); margin-top: 1px; }
        .lcm-body {
          flex: 1; overflow-y: auto;
          padding: 20px 22px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .lcm-row   { display: flex; gap: 12px; }
        .lcm-field { display: flex; flex-direction: column; gap: 5px; flex: 1; }
        .lcm-label {
          font-size: 10px; font-weight: 700; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .lcm-required { color: var(--coral-600); margin-left: 2px; }
        .lcm-input {
          height: 38px; padding: 0 13px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 13px; color: var(--ink); background: var(--surface);
          outline: none; transition: border-color 0.15s, box-shadow 0.15s;
          font-family: var(--font-sans); width: 100%;
        }
        .lcm-input:focus {
          border-color: var(--green-500); background: #fff;
          box-shadow: 0 0 0 3px rgba(16,185,129,0.10);
        }
        .lcm-input::placeholder { color: var(--muted-light); }
        .lcm-textarea {
          padding: 10px 13px; resize: none;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 13px; color: var(--ink); background: var(--surface);
          outline: none; transition: border-color 0.15s, box-shadow 0.15s;
          font-family: var(--font-sans); width: 100%; line-height: 1.5;
        }
        .lcm-textarea:focus {
          border-color: var(--green-500); background: #fff;
          box-shadow: 0 0 0 3px rgba(16,185,129,0.10);
        }
        .lcm-textarea::placeholder { color: var(--muted-light); }
        .lcm-error {
          margin: 0 22px; padding: 10px 14px; border-radius: var(--radius-md);
          background: var(--coral-50); border: 1px solid #fecaca;
          color: var(--coral-600); font-size: 12px; font-weight: 500;
          flex-shrink: 0; animation: fadeIn 0.15s ease both;
        }
        .lcm-footer {
          padding: 14px 22px; border-top: 1px solid var(--border);
          display: flex; align-items: center; justify-content: flex-end; gap: 8px;
          flex-shrink: 0; background: #fff;
        }
        .lcm-cancel {
          padding: 9px 18px; background: transparent;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 13px; color: var(--ink-3); cursor: pointer;
          font-family: var(--font-sans); transition: all 0.15s;
        }
        .lcm-cancel:hover { background: var(--surface-2); border-color: var(--border-mid); }
        .lcm-submit {
          padding: 9px 24px; background: var(--forest-mid); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 13px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans);
          transition: all 0.16s cubic-bezier(.22,1,.36,1);
          display: flex; align-items: center; gap: 7px;
          box-shadow: 0 2px 8px rgba(6,95,70,0.25);
        }
        .lcm-submit:hover:not(:disabled) {
          background: var(--forest);
          box-shadow: 0 5px 16px rgba(6,95,70,0.35);
          transform: translateY(-1px);
        }
        .lcm-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
        .lcm-success {
          display: flex; flex-direction: column; align-items: center; gap: 14px;
          padding: 52px 28px; text-align: center;
          animation: fadeUp 0.25s ease both;
        }
        .lcm-success-icon { font-size: 48px; }
        .lcm-success-title { font-size: 17px; font-weight: 700; color: var(--ink); }
        .lcm-success-sub   { font-size: 13px; color: var(--muted); max-width: 300px; line-height: 1.7; }
        .lcm-success-pill  {
          font-size: 11px; font-weight: 600; color: var(--forest-mid);
          background: var(--green-50); border: 1px solid var(--green-100);
          border-radius: 20px; padding: 5px 16px;
        }
        .lcm-btn-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff; border-radius: 50%;
          animation: spinAnim 0.65s linear infinite;
        }
      `}</style>

      <div className="lcm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="lcm-box">

          {/* Header */}
          <div className="lcm-hdr">
            <div>
              <div className="lcm-title">
                {physician ? "Add Physician as Lead" : "Generate Salesforce Lead"}
              </div>
              <div className="lcm-sub">{nctId}{siteName ? ` · ${siteName}` : ""}</div>
            </div>
            <button className="lcm-close" onClick={onClose}>✕</button>
          </div>

          {/* Salesforce bar */}
          <div className="lcm-sf-bar">
            <div className="lcm-sf-dot" />
            <span className="lcm-sf-text">Lead will be added to Salesforce</span>
            <span className="lcm-sf-chip">Clinical Trial</span>
          </div>

          {/* Physician banner */}
          {physician && (
            <div className="lcm-physician-bar">
              <div className="lcm-physician-avatar">{initials(physician.name)}</div>
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
              <div className="lcm-success-title">Lead submitted!</div>
              <div className="lcm-success-sub">
                {onSuccess
                  ? "Lead created. Loading more physicians now…"
                  : "The lead has been created. Our team will follow up shortly."}
              </div>
              <div className="lcm-success-pill">Lead Source: Clinical Trial</div>
            </div>
          ) : (
            <>
              <div className="lcm-body">
                <div className="lcm-row">
                  <div className="lcm-field">
                    <label className="lcm-label">
                      First Name<span className="lcm-required">*</span>
                    </label>
                    <input className="lcm-input" type="text" placeholder="Jane"
                      value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      autoComplete="given-name" />
                  </div>
                  <div className="lcm-field">
                    <label className="lcm-label">
                      Last Name<span className="lcm-required">*</span>
                    </label>
                    <input className="lcm-input" type="text" placeholder="Smith"
                      value={lastName} onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name" />
                  </div>
                </div>

                <div className="lcm-field">
                  <label className="lcm-label">
                    Email<span className="lcm-required">*</span>
                  </label>
                  <input className="lcm-input" type="email" placeholder="jane.smith@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email" />
                </div>

                <div className="lcm-row">
                  <div className="lcm-field">
                    <label className="lcm-label">Phone</label>
                    <input className="lcm-input" type="tel" placeholder="+1 (555) 000-0000"
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel" />
                  </div>
                  <div className="lcm-field">
                    <label className="lcm-label">
                      Company<span className="lcm-required">*</span>
                    </label>
                    <input className="lcm-input" type="text" placeholder="Organisation name"
                      value={company} onChange={(e) => setCompany(e.target.value)}
                      autoComplete="organization" />
                  </div>
                </div>

                <div className="lcm-field">
                  <label className="lcm-label">Message</label>
                  <textarea className="lcm-textarea" rows={3}
                    placeholder="Describe what you're looking for…"
                    value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
              </div>

              {error && <p className="lcm-error">{error}</p>}

              <div className="lcm-footer">
                <button className="lcm-cancel" onClick={onClose}>Cancel</button>
                <button className="lcm-submit" onClick={handleSubmit} disabled={loading}>
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