// components/shared/LeadCaptureModal.tsx
"use client";

import { useState, useCallback } from "react";
import { submitLead }            from "@/lib/api";
import type { LeadPayload }      from "@/types/physician";

interface Props {
  npi:       string;
  nctId:     string;
  siteName?: string | null;
  onClose:   () => void;
}

export default function LeadCaptureModal({ npi, nctId, siteName, onClose }: Props) {
  const [name,    setName]    = useState("");
  const [phone,   setPhone]   = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    setLoading(true);
    setError(null);

    // Fixed Salesforce fields — not shown in form
    const payload: LeadPayload = {
      name:        name.trim(),
      email:       "lead@aquarient.local",   // fixed
      company:     "Individual Physicians",  // fixed
      lead_source: "Clinical Trial",         // fixed
      npi,
      nct_id:      nctId,
      ...(phone.trim()   ? { phone:   phone.trim()   } : {}),
      ...(siteName       ? { site:    siteName        } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    };

    try {
      await submitLead(payload);
      setSuccess(true);
      setTimeout(onClose, 2200);
    } catch (err: unknown) {
      setError((err as Error).message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [name, phone, message, npi, nctId, siteName, onClose]);

  return (
    <>
      <style>{`
        .lcm-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.45); z-index: 300;
          display: flex; align-items: center; justify-content: center;
          padding: 20px; animation: lcmFadeIn 0.18s ease;
        }
        @keyframes lcmFadeIn   { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lcmSlideUp  { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        .lcm-box {
          background: #fff; border-radius: 14px;
          width: 100%; max-width: 460px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.18);
          overflow: hidden; animation: lcmSlideUp 0.22s ease;
        }
        .lcm-hdr { padding: 18px 20px 14px; border-bottom: 1px solid #e4e8f0; }
        .lcm-title { font-size: 16px; font-weight: 600; color: #0d1117; }
        .lcm-sub   { font-size: 12px; color: #8b95a1; margin-top: 2px; }
        .lcm-body  { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
        .lcm-field { display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .lcm-label { font-size: 11px; font-weight: 600; color: #4b5563; text-transform: uppercase; letter-spacing: 0.4px; }
        .lcm-input {
          height: 36px; padding: 0 12px;
          border: 1px solid #e4e8f0; border-radius: 8px;
          font-size: 13px; color: #0d1117; background: #f6f7fb;
          outline: none; transition: border-color 0.15s, box-shadow 0.15s;
          font-family: inherit; width: 100%;
        }
        .lcm-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
        .lcm-textarea {
          padding: 8px 12px; resize: vertical;
          border: 1px solid #e4e8f0; border-radius: 8px;
          font-size: 13px; color: #0d1117; background: #f6f7fb;
          outline: none; transition: border-color 0.15s;
          font-family: inherit; width: 100%;
        }
        .lcm-textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
        .lcm-fixed-row {
          display: flex; gap: 8px; flex-wrap: wrap;
          padding: 8px 12px; background: #f0fdf4;
          border: 1px solid #bbf7d0; border-radius: 8px;
          font-size: 11px; color: #166534;
        }
        .lcm-fixed-chip {
          background: #dcfce7; border-radius: 4px;
          padding: 2px 7px; font-weight: 600; font-size: 11px; color: #15803d;
        }
        .lcm-error  { font-size: 12px; color: #dc2626; padding: 0 20px 4px; }
        .lcm-footer { padding: 12px 20px; border-top: 1px solid #e4e8f0; display: flex; justify-content: flex-end; gap: 8px; }
        .lcm-cancel { padding: 8px 16px; background: transparent; border: 1px solid #e4e8f0; border-radius: 8px; font-size: 13px; color: #4b5563; cursor: pointer; font-family: inherit; transition: background 0.15s; }
        .lcm-cancel:hover { background: #f6f7fb; }
        .lcm-submit { padding: 8px 20px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, opacity 0.15s; }
        .lcm-submit:hover    { background: #1d4ed8; }
        .lcm-submit:disabled { opacity: 0.6; cursor: not-allowed; }
        .lcm-success { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 20px; text-align: center; }
        .lcm-success-icon  { font-size: 36px; }
        .lcm-success-title { font-size: 15px; font-weight: 600; color: #0d1117; }
        .lcm-success-sub   { font-size: 13px; color: #8b95a1; }
      `}</style>

      <div className="lcm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="lcm-box">
          <div className="lcm-hdr">
            <div className="lcm-title">Request More Physicians</div>
            <div className="lcm-sub">
              {nctId}{siteName ? ` · ${siteName}` : ""}
            </div>
          </div>

          {success ? (
            <div className="lcm-success">
              <div className="lcm-success-icon">✅</div>
              <div className="lcm-success-title">Request submitted!</div>
              <div className="lcm-success-sub">Our team will follow up shortly.</div>
            </div>
          ) : (
            <>
              <div className="lcm-body">

                {/* Show the fixed Salesforce fields as read-only chips */}
                <div className="lcm-fixed-row">
                  <span>Will be submitted as:</span>
                  <span className="lcm-fixed-chip">Clinical Trial</span>
                  <span className="lcm-fixed-chip">Individual Physicians</span>
                  <span className="lcm-fixed-chip">lead@aquarient.local</span>
                </div>

                <div className="lcm-field">
                  <label className="lcm-label">Your Name *</label>
                  <input
                    className="lcm-input" type="text" placeholder="Full name"
                    value={name} onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="lcm-field">
                  <label className="lcm-label">Phone</label>
                  <input
                    className="lcm-input" type="tel" placeholder="Optional"
                    value={phone} onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <div className="lcm-field">
                  <label className="lcm-label">Message</label>
                  <textarea
                    className="lcm-textarea" rows={3}
                    placeholder="Describe what you're looking for…"
                    value={message} onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
              </div>

              {error && <p className="lcm-error">{error}</p>}

              <div className="lcm-footer">
                <button className="lcm-cancel" onClick={onClose}>Cancel</button>
                <button className="lcm-submit" onClick={handleSubmit} disabled={loading}>
                  {loading ? "Submitting…" : "Submit Request"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}