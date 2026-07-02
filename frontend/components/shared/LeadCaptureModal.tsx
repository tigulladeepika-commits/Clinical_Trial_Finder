"use client";

import { useState, useCallback } from "react";
import { submitLead }            from "@/lib/api";
import type { LeadPayload }      from "@/types/physician";

interface PhysicianInfo {
  name:          string;
  npi:           string;
  taxonomy_desc?: string | null;
  gender?:       string | null;
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
  const resolvedNpi = npi ?? physician?.npi ?? "";
  const prefillSpecialization = physician?.taxonomy_desc ?? "";
  const prefillGenderIdentity = physician?.gender ?? "";

  const [firstName,  setFirstName]  = useState(prefillFirst);
  const [lastName,   setLastName]   = useState(prefillLast);
  const [email,      setEmail]      = useState("");
  const [phone,      setPhone]      = useState("");
  const [company,    setCompany]    = useState("");
  const [specialization, setSpecialization] = useState(prefillSpecialization);
  const [genderIdentity, setGenderIdentity] = useState(prefillGenderIdentity);
  const [npiNumber, setNpiNumber] = useState(resolvedNpi);
  const [message,    setMessage]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success,    setSuccess]    = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Pure background fetch — never triggers a page reload or native form POST
  const handleSubmit = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim()) { setFieldError("First and last name are required."); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFieldError("A valid email address is required."); return; }
    if (!company.trim()) { setFieldError("Company / organisation is required."); return; }

    setSubmitting(true);
    setFieldError(null);

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
      ...(specialization.trim() ? { specialization: specialization.trim() } : {}),
      ...(genderIdentity.trim() ? { gender_identity: genderIdentity.trim() } : {}),
      ...(npiNumber.trim() || resolvedNpi ? { npi_number: (npiNumber.trim() || resolvedNpi) } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
      auto: false,
    };

    try {
      await submitLead(payload);
      setSuccess(true);
      // Fire loadMore (or other callback) while user reads success message
      onSuccess?.();
      setTimeout(() => onClose(), 3500);
    } catch (err: unknown) {
      setFieldError((err as Error).message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }, [firstName, lastName, email, phone, company, specialization, genderIdentity, npiNumber, message, resolvedNpi, nctId, siteName, physician, onClose, onSuccess]);

  function initials(name: string) {
    return name.replace(/^Dr\.\s*/i, "").split(" ").filter(Boolean).slice(0,2).map(n=>n[0].toUpperCase()).join("");
  }

  return (
    <>
      <style>{`
        .lcm-backdrop {
          position: fixed; inset: 0;
          background: rgba(10,15,30,0.48);
          z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: fadeIn 0.18s ease both;
          backdrop-filter: blur(2px);
        }
        .lcm-box {
          background: #fff; border-radius: 18px;
          width: 100%; max-width: 480px;
          box-shadow: 0 28px 72px rgba(10,15,30,0.20), 0 0 0 1px rgba(10,15,30,0.05);
          overflow: hidden;
          animation: fadeUp 0.22s cubic-bezier(.22,1,.36,1) both;
          display: flex; flex-direction: column;
          max-height: 90vh;
        }
        .lcm-hdr {
          padding: 18px 20px 14px;
          border-bottom: 1px solid var(--border);
          display: flex; align-items: flex-start; justify-content: space-between;
          flex-shrink: 0;
        }
        .lcm-title { font-size: 15px; font-weight: 700; color: var(--ink); }
        .lcm-sub   { font-size: 11px; color: var(--muted); margin-top: 3px; }
        .lcm-close {
          width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); cursor: pointer;
          font-size: 15px; color: var(--muted); flex-shrink: 0;
          transition: all 0.15s;
        }
        .lcm-close:hover { background: var(--surface-2); color: var(--ink); }
        .lcm-physician-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 18px; background: var(--blue-50);
          border-bottom: 1px solid var(--blue-200); flex-shrink: 0;
        }
        .lcm-physician-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          background: var(--blue-600); color: #fff;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; flex-shrink: 0;
          font-family: var(--font-mono);
        }
        .lcm-physician-name { font-size: 12px; font-weight: 700; color: #1e3a5f; }
        .lcm-physician-spec { font-size: 10px; color: var(--blue-600); margin-top: 1px; }
        .lcm-body {
          flex: 1; overflow-y: auto;
          padding: 18px 20px;
          display: flex; flex-direction: column; gap: 13px;
        }
        .lcm-row   { display: flex; gap: 11px; }
        .lcm-field { display: flex; flex-direction: column; gap: 5px; flex: 1; }
        .lcm-label {
          font-size: 10px; font-weight: 700; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .lcm-required { color: var(--coral-600); margin-left: 2px; }
        .lcm-input {
          height: 38px; padding: 0 12px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 13px; color: var(--ink); background: var(--surface);
          outline: none; transition: border-color 0.15s, box-shadow 0.15s;
          font-family: var(--font-sans); width: 100%;
        }
        .lcm-input:focus {
          border-color: var(--blue-500); background: #fff;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.10);
        }
        .lcm-input::placeholder { color: var(--muted-light); }
        .lcm-textarea {
          padding: 9px 12px; resize: none;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 13px; color: var(--ink); background: var(--surface);
          outline: none; transition: border-color 0.15s, box-shadow 0.15s;
          font-family: var(--font-sans); width: 100%; line-height: 1.5;
        }
        .lcm-textarea:focus {
          border-color: var(--blue-500); background: #fff;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.10);
        }
        .lcm-textarea::placeholder { color: var(--muted-light); }
        .lcm-error {
          margin: 0 20px; padding: 9px 13px; border-radius: var(--radius-md);
          background: var(--coral-50); border: 1px solid #fecaca;
          color: var(--coral-600); font-size: 12px; font-weight: 500;
          flex-shrink: 0; animation: fadeIn 0.15s ease both;
        }
        .lcm-footer {
          padding: 12px 20px; border-top: 1px solid var(--border);
          display: flex; align-items: center; justify-content: flex-end; gap: 8px;
          flex-shrink: 0; background: #fff;
        }
        .lcm-cancel {
          padding: 8px 16px; background: transparent;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 13px; color: var(--ink-3); cursor: pointer;
          font-family: var(--font-sans); transition: all 0.15s;
        }
        .lcm-cancel:hover { background: var(--surface-2); border-color: var(--border-mid); }
        .lcm-submit {
          padding: 8px 22px; background: var(--blue-600); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 13px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans);
          transition: all 0.16s cubic-bezier(.22,1,.36,1);
          display: flex; align-items: center; gap: 7px;
          box-shadow: 0 2px 8px rgba(37,99,235,0.25);
        }
        .lcm-submit:hover:not(:disabled) {
          background: var(--blue-700);
          box-shadow: 0 4px 14px rgba(37,99,235,0.35);
          transform: translateY(-1px);
        }
        .lcm-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
        .lcm-success {
          display: flex; flex-direction: column; align-items: center; gap: 16px;
          padding: 52px 32px; text-align: center;
          animation: fadeUp 0.25s ease both;
        }
        .lcm-success-icon  { font-size: 52px; }
        .lcm-success-title { font-size: 20px; font-weight: 700; color: var(--ink); }
        .lcm-success-msg {
          font-size: 14px; color: var(--ink-3); line-height: 1.7;
          background: var(--blue-50); border: 1px solid var(--blue-200);
          border-radius: var(--radius-lg); padding: 14px 20px;
          max-width: 340px;
        }
        .lcm-btn-spinner {
          width: 13px; height: 13px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff; border-radius: 50%;
          animation: spinAnim 0.65s linear infinite;
        }
      `}</style>

      <div className="lcm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="lcm-box">

          {success ? (
            /* ── Success screen ── */
            <div className="lcm-success">
              <div className="lcm-success-icon">✅</div>
              <div className="lcm-success-title">Lead Generated!</div>
              <div className="lcm-success-msg">
                Lead generated in Salesforce. The Aquarient team will get back to you shortly.
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="lcm-hdr">
                <div>
                  <div className="lcm-title">Contact Aquarient Technologies</div>
                  <div className="lcm-sub">for more details about this trial</div>
                </div>
                <button className="lcm-close" onClick={onClose} title="Close">✕</button>
              </div>

              {/* Optional physician context */}
              {physician && (
                <div className="lcm-physician-bar">
                  <div className="lcm-physician-avatar">{initials(physician.name)}</div>
                  <div>
                    <div className="lcm-physician-name">{physician.name}</div>
                    {physician.taxonomy_desc && (
                      <div className="lcm-physician-spec">{physician.taxonomy_desc}</div>
                    )}
                    <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                      NPI: {physician.npi}
                    </div>
                  </div>
                </div>
              )}

              {/* Fields — plain divs, no <form>, so no native POST */}
              <div className="lcm-body">
                <div className="lcm-row">
                  <div className="lcm-field">
                    <label className="lcm-label">First Name<span className="lcm-required">*</span></label>
                    <input className="lcm-input" type="text" placeholder="Jane"
                      value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      autoComplete="given-name" />
                  </div>
                  <div className="lcm-field">
                    <label className="lcm-label">Last Name<span className="lcm-required">*</span></label>
                    <input className="lcm-input" type="text" placeholder="Smith"
                      value={lastName} onChange={(e) => setLastName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      autoComplete="family-name" />
                  </div>
                </div>
                <div className="lcm-field">
                  <label className="lcm-label">Email<span className="lcm-required">*</span></label>
                  <input className="lcm-input" type="email" placeholder="jane.smith@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
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
                    <label className="lcm-label">Company<span className="lcm-required">*</span></label>
                    <input className="lcm-input" type="text" placeholder="Organisation name"
                      value={company} onChange={(e) => setCompany(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      autoComplete="organization" />
                  </div>
                </div>
                <div className="lcm-row">
                  <div className="lcm-field">
                    <label className="lcm-label">Specialization</label>
                    <input className="lcm-input" type="text" placeholder="Cardiology"
                      value={specialization} onChange={(e) => setSpecialization(e.target.value)} />
                  </div>
                  <div className="lcm-field">
                    <label className="lcm-label">Gender Identity</label>
                    <input className="lcm-input" type="text" placeholder="Female"
                      value={genderIdentity} onChange={(e) => setGenderIdentity(e.target.value)} />
                  </div>
                </div>
                <div className="lcm-field">
                  <label className="lcm-label">NPI Number</label>
                  <input className="lcm-input" type="text" placeholder="1234567890"
                    value={npiNumber} onChange={(e) => setNpiNumber(e.target.value)} />
                </div>
                <div className="lcm-field">
                  <label className="lcm-label">Message</label>
                  <textarea className="lcm-textarea" rows={3}
                    placeholder="Describe what you're looking for…"
                    value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
              </div>

              {fieldError && <p className="lcm-error">{fieldError}</p>}

              <div className="lcm-footer">
                <button className="lcm-cancel" onClick={onClose}>Cancel</button>
                <button className="lcm-submit" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <><div className="lcm-btn-spinner" /> Submitting…</> : "Submit"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}