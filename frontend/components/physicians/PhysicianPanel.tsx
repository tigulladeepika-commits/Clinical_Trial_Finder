"use client";

// components/physicians/PhysicianPanel.tsx

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import PhysicianCard              from "@/components/physicians/PhysicianCard";
import PhysicianDetailPanel       from "@/components/physicians/PhysicianDetailPanel";
import PhysicianMap               from "@/components/physicians/PhysicianMap";
import LeadCaptureModal           from "@/components/shared/LeadCaptureModal";
import { useSuggestedPhysicians } from "@/hooks/usePhysicians";
import { getConditionSpecialties } from "@/lib/api";
import type { Physician, SelectedSite } from "@/types/physician";

interface Props {
  site:              SelectedSite;
  kpiBar?:           React.ReactNode;
  physicians:        Physician[];
  total:             number;
  loading:           boolean;
  error:             string | null;
  searched:          boolean;
  hasMore:           boolean;
  searchSpecialties: string[];
  onSearch:   (radius: number, specialty: string, userSpecialty: string, initialSpecialty: string) => void;
  onLoadMore: () => void;
  onBack:     () => void;
}

// Must match RADIUS_STEPS in usePhysicians exactly
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

// ── NUCC Taxonomy groups ──────────────────────────────────────────────────────
// Doctors (MD/DO), HCPs (non-physician health care providers), HCOs (organisations)
interface TaxonomyOption {
  code:  string;
  label: string;
  group: "Doctors" | "HCPs" | "HCOs";
}

const TAXONOMY_OPTIONS: TaxonomyOption[] = [
  // ── Doctors ──────────────────────────────────────────────────────────────
  { code: "207R00000X", label: "Internal Medicine",                  group: "Doctors" },
  { code: "207RH0000X", label: "Hematology",                        group: "Doctors" },
  { code: "207RH0003X", label: "Hematology & Oncology",             group: "Doctors" },
  { code: "207RO0000X", label: "Medical Oncology",                  group: "Doctors" },
  { code: "2086S0129X", label: "Surgical Oncology",                 group: "Doctors" },
  { code: "2086X0206X", label: "Surgical Oncology (Thoracic)",      group: "Doctors" },
  { code: "207RR0500X", label: "Rheumatology",                      group: "Doctors" },
  { code: "207RE0101X", label: "Endocrinology, Diabetes & Metabolism", group: "Doctors" },
  { code: "207RI0200X", label: "Infectious Disease",                group: "Doctors" },
  { code: "207RG0300X", label: "Gastroenterology",                  group: "Doctors" },
  { code: "207RP1001X", label: "Pulmonary Disease",                 group: "Doctors" },
  { code: "207RC0000X", label: "Cardiovascular Disease",            group: "Doctors" },
  { code: "207RN0300X", label: "Nephrology",                        group: "Doctors" },
  { code: "2084N0400X", label: "Neurology",                         group: "Doctors" },
  { code: "207T00000X", label: "Neurological Surgery (Neurosurgery)", group: "Doctors" },
  { code: "207X00000X", label: "Orthopaedic Surgery",               group: "Doctors" },
  { code: "207V00000X", label: "Obstetrics & Gynecology",           group: "Doctors" },
  { code: "207VX0000X", label: "Gynecologic Oncology",              group: "Doctors" },
  { code: "207W00000X", label: "Ophthalmology",                     group: "Doctors" },
  { code: "207Y00000X", label: "Otolaryngology (ENT)",              group: "Doctors" },
  { code: "207ZP0102X", label: "Anatomic & Clinical Pathology",     group: "Doctors" },
  { code: "2085R0202X", label: "Diagnostic Radiology",              group: "Doctors" },
  { code: "2085R0001X", label: "Radiation Oncology",                group: "Doctors" },
  { code: "208600000X", label: "General Surgery",                   group: "Doctors" },
  { code: "207Q00000X", label: "Family Medicine",                   group: "Doctors" },
  { code: "207P00000X", label: "Emergency Medicine",                group: "Doctors" },
  { code: "208M00000X", label: "Hospitalist",                       group: "Doctors" },
  { code: "207N00000X", label: "Dermatology",                       group: "Doctors" },
  { code: "207K00000X", label: "Allergy & Immunology",              group: "Doctors" },
  { code: "207U00000X", label: "Physical Medicine & Rehabilitation", group: "Doctors" },
  { code: "2084P0800X", label: "Psychiatry",                        group: "Doctors" },
  { code: "207LP2900X", label: "Pain Medicine",                     group: "Doctors" },
  { code: "207RC0001X", label: "Clinical Cardiac Electrophysiology", group: "Doctors" },
  { code: "207RI0011X", label: "Interventional Cardiology",         group: "Doctors" },
  { code: "207RU0001X", label: "Transplant Hepatology",             group: "Doctors" },
  { code: "2086S0105X", label: "Transplant Surgery",                group: "Doctors" },
  { code: "208VP0000X", label: "Pain Medicine (ABPM)",              group: "Doctors" },

  // ── HCPs ─────────────────────────────────────────────────────────────────
  { code: "363LF0000X", label: "Nurse Practitioner – Family",       group: "HCPs" },
  { code: "363LA2200X", label: "Nurse Practitioner – Acute Care",   group: "HCPs" },
  { code: "363LX0001X", label: "Nurse Practitioner – Oncology",     group: "HCPs" },
  { code: "363LP0200X", label: "Nurse Practitioner – Pediatrics",   group: "HCPs" },
  { code: "363LS0200X", label: "Nurse Practitioner – School",       group: "HCPs" },
  { code: "367500000X", label: "Nurse Anesthetist (CRNA)",          group: "HCPs" },
  { code: "364S00000X", label: "Clinical Nurse Specialist",         group: "HCPs" },
  { code: "261QR0206X", label: "Research Facility / Clinical Research", group: "HCPs" },
  { code: "390200000X", label: "Student (Health Care)",             group: "HCPs" },
  { code: "374700000X", label: "Technician / Technologist",         group: "HCPs" },
  { code: "246QB0000X", label: "Clinical Laboratory Scientist",     group: "HCPs" },
  { code: "111N00000X", label: "Chiropractor",                      group: "HCPs" },
  { code: "122300000X", label: "Dentist",                           group: "HCPs" },
  { code: "152W00000X", label: "Optometrist",                       group: "HCPs" },
  { code: "163W00000X", label: "Registered Nurse",                  group: "HCPs" },
  { code: "164W00000X", label: "Licensed Practical Nurse",          group: "HCPs" },
  { code: "170100000X", label: "Medical Genetics / Genomics",       group: "HCPs" },
  { code: "183500000X", label: "Pharmacist",                        group: "HCPs" },
  { code: "225100000X", label: "Physical Therapist",                group: "HCPs" },
  { code: "225X00000X", label: "Occupational Therapist",            group: "HCPs" },
  { code: "231H00000X", label: "Audiologist",                       group: "HCPs" },
  { code: "235Z00000X", label: "Speech-Language Pathologist",       group: "HCPs" },
  { code: "251B00000X", label: "Case Manager",                      group: "HCPs" },
  { code: "332B00000X", label: "Durable Medical Equipment Supplier", group: "HCPs" },
  { code: "3416L0300X", label: "Perfusionist",                      group: "HCPs" },

  // ── HCOs ─────────────────────────────────────────────────────────────────
  { code: "282N00000X", label: "General Acute Care Hospital",       group: "HCOs" },
  { code: "282NC0060X", label: "Critical Access Hospital",          group: "HCOs" },
  { code: "282NR1301X", label: "Rural Acute Care Hospital",         group: "HCOs" },
  { code: "283Q00000X", label: "Psychiatric Hospital",              group: "HCOs" },
  { code: "283X00000X", label: "Rehabilitation Hospital",           group: "HCOs" },
  { code: "284300000X", label: "Special Hospital",                  group: "HCOs" },
  { code: "261QA0600X", label: "Ambulatory Surgery Center",         group: "HCOs" },
  { code: "261QR0200X", label: "Radiology / Imaging Center",        group: "HCOs" },
  { code: "261QC1500X", label: "Community Health Center",           group: "HCOs" },
  { code: "261QM1300X", label: "Multi-Specialty Group Practice",    group: "HCOs" },
  { code: "261QP2300X", label: "Primary Care Clinic",               group: "HCOs" },
  { code: "261QC0050X", label: "Critical Care (Intensive Care) Facility", group: "HCOs" },
  { code: "261QH0700X", label: "Hospice",                           group: "HCOs" },
  { code: "315D00000X", label: "Inpatient Hospice",                 group: "HCOs" },
  { code: "315P00000X", label: "Intermediate Care Facility",        group: "HCOs" },
  { code: "311500000X", label: "Alzheimer Center / Dementia Unit",  group: "HCOs" },
  { code: "324500000X", label: "Substance Abuse Rehab Facility",    group: "HCOs" },
  { code: "3416A0800X", label: "Ambulance Service",                 group: "HCOs" },
  { code: "251G00000X", label: "Home Health Agency",                group: "HCOs" },
  { code: "273100000X", label: "Epilepsy Unit",                     group: "HCOs" },
  { code: "291U00000X", label: "Clinical Medical Laboratory",       group: "HCOs" },
];

const GROUPS = ["Doctors", "HCPs", "HCOs"] as const;

export default function PhysicianPanel({
  site, physicians, total, loading, error, searched, hasMore,
  searchSpecialties, kpiBar, onSearch, onLoadMore, onBack,
}: Props) {
  const [radius,            setRadius]            = useState<number>(25);
  const [selectedCodes,     setSelectedCodes]     = useState<string[]>([]);
  const [dropdownOpen,      setDropdownOpen]       = useState(false);
  const [dropdownSearch,    setDropdownSearch]     = useState("");
  const [selectedNpi,       setSelectedNpi]       = useState<string | null>(null);
  const [detailPhys,        setDetailPhys]        = useState<Physician | null>(null);
  const [showMainModal,     setShowMainModal]     = useState(false);
  const [showSuggestModal,  setShowSuggestModal]  = useState(false);

  const [resolvedSpecialty, setResolvedSpecialty] = useState<string>("");
  const [resolving,         setResolving]         = useState(false);

  const suggested          = useSuggestedPhysicians();
  const siteConditionRef   = useRef<string>("");
  const dropdownRef        = useRef<HTMLDivElement>(null);

  // ── Resolve specialty on mount / site change ─────────────────────────────
  useEffect(() => {
    const condition = site.condition?.trim() ?? "";
    if (!condition || condition === siteConditionRef.current) return;
    siteConditionRef.current = condition;

    setResolving(true);
    setResolvedSpecialty("");
    setSelectedCodes([]);

    getConditionSpecialties(condition)
      .then((specialties) => {
        const primary = specialties[0] ?? condition;
        setResolvedSpecialty(primary);
        // Auto-select the first matching taxonomy code
        const match = TAXONOMY_OPTIONS.find(
          (o) => o.label.toLowerCase() === primary.toLowerCase()
        );
        if (match) setSelectedCodes([match.code]);
      })
      .catch(() => {
        setResolvedSpecialty(condition);
      })
      .finally(() => setResolving(false));
  }, [site.condition]);

  // ── Close dropdown on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Stable NPI key (FIX 3) ───────────────────────────────────────────────
  const npis   = physicians.map((p) => p.npi);
  const npiKey = useMemo(
    () => [...npis].sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [npis.join(",")]
  );

  useEffect(() => {
    if (!searched || loading || physicians.length === 0) return;
    const currentNpis = npiKey ? npiKey.split(",") : [];
    suggested.fetch(site, radius, site.condition ?? undefined, currentNpis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, loading, npiKey]);

  // ── Toggle a taxonomy code ───────────────────────────────────────────────
  const toggleCode = useCallback((code: string) => {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }, []);

  // ── Build specialty string from selected codes ───────────────────────────
  const selectedLabels = useMemo(
    () => TAXONOMY_OPTIONS.filter((o) => selectedCodes.includes(o.code)).map((o) => o.label),
    [selectedCodes]
  );

  // ── handleSearch ─────────────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const userSpecialty  = selectedLabels.join(", ");
    const initialSpecialty = resolvedSpecialty;
    onSearch(
      radius,
      site.condition?.trim() ?? "",
      userSpecialty,
      initialSpecialty,
    );
  }, [radius, selectedLabels, resolvedSpecialty, site.condition, onSearch]);

  // ── Filtered options for dropdown search ────────────────────────────────
  const filteredOptions = useMemo(() => {
    const q = dropdownSearch.toLowerCase();
    return TAXONOMY_OPTIONS.filter(
      (o) => !q || o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)
    );
  }, [dropdownSearch]);

  // ── Dropdown trigger label ───────────────────────────────────────────────
  const triggerLabel =
    selectedCodes.length === 0
      ? "Select taxonomy…"
      : selectedCodes.length === 1
      ? selectedLabels[0]
      : `${selectedCodes.length} specialties selected`;

  if (detailPhys) {
    return (
      <div>
        {kpiBar}
        <PhysicianDetailPanel
          physician={detailPhys}
          site={site}
          onBack={() => setDetailPhys(null)}
          onAddAsLead={() => {}}
        />
      </div>
    );
  }

  return (
    <>
      <style>{`
        .pp-shell { display: flex; flex-direction: column; font-family: var(--font-sans); }
        .pp-toolbar {
          display: flex; align-items: center; gap: 7px;
          padding: 8px 14px; background: #fff;
          border-bottom: 1px solid var(--border);
          position: sticky; top: 0; z-index: 20; flex-wrap: wrap;
        }
        .pp-back-btn {
          display: flex; align-items: center; justify-content: center;
          height: 32px; width: 32px; background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--radius-md);
          cursor: pointer; font-size: 15px; color: var(--ink-3);
          flex-shrink: 0; transition: all 0.15s;
        }
        .pp-back-btn:hover { background: var(--surface-2); border-color: var(--border-mid); color: var(--ink); }
        .pp-site-label { flex: 1; min-width: 0; }
        .pp-site-name {
          font-size: 12px; font-weight: 700; color: var(--ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pp-site-sub { font-size: 10px; color: var(--muted); font-weight: 500; }

        /* ── Taxonomy dropdown ── */
        .pp-taxonomy-wrap {
          flex: 2 1 150px; position: relative; min-width: 0;
        }
        .pp-taxonomy-trigger {
          width: 100%; height: 32px; padding: 0 28px 0 11px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 12px; color: var(--ink); background: var(--surface);
          outline: none; font-family: var(--font-sans);
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box; cursor: pointer;
          display: flex; align-items: center; justify-content: space-between;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          text-align: left;
        }
        .pp-taxonomy-trigger:hover,
        .pp-taxonomy-trigger:focus {
          border-color: var(--blue-500);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.10);
          background: #fff;
        }
        .pp-taxonomy-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
        .pp-taxonomy-caret {
          position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
          pointer-events: none; font-size: 10px; color: var(--muted);
        }
        .pp-taxonomy-dropdown {
          position: absolute; top: calc(100% + 4px); left: 0;
          width: 300px; background: #fff;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          box-shadow: 0 8px 32px rgba(0,0,0,0.13);
          z-index: 100; overflow: hidden;
          animation: fadeIn 0.12s ease both;
        }
        .pp-taxonomy-search {
          width: 100%; height: 34px; padding: 0 10px;
          border: none; border-bottom: 1px solid var(--border);
          font-size: 12px; color: var(--ink); outline: none;
          font-family: var(--font-sans); background: var(--surface);
          box-sizing: border-box;
        }
        .pp-taxonomy-search:focus { background: #fff; }
        .pp-taxonomy-list {
          max-height: 260px; overflow-y: auto;
          padding: 4px 0;
        }
        .pp-taxonomy-group-label {
          padding: 6px 10px 2px;
          font-size: 9px; font-weight: 800; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.8px;
          background: var(--surface);
          border-top: 1px solid var(--border);
          position: sticky; top: 0; z-index: 1;
        }
        .pp-taxonomy-group-label:first-child { border-top: none; }
        .pp-taxonomy-item {
          display: flex; align-items: center; gap: 8px;
          padding: 5px 10px; cursor: pointer;
          font-size: 11px; color: var(--ink);
          transition: background 0.1s;
          user-select: none;
        }
        .pp-taxonomy-item:hover { background: var(--blue-50); }
        .pp-taxonomy-item.selected { background: rgba(37,99,235,0.06); font-weight: 600; }
        .pp-taxonomy-checkbox {
          width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
          border: 1.5px solid var(--border); background: var(--surface);
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; color: #fff; transition: all 0.12s;
        }
        .pp-taxonomy-item.selected .pp-taxonomy-checkbox {
          background: var(--blue-600); border-color: var(--blue-600);
        }
        .pp-taxonomy-footer {
          padding: 6px 10px; border-top: 1px solid var(--border);
          display: flex; align-items: center; justify-content: space-between;
          background: var(--surface);
        }
        .pp-taxonomy-count { font-size: 10px; color: var(--muted); font-weight: 600; }
        .pp-taxonomy-clear {
          font-size: 10px; color: var(--blue-600); font-weight: 700;
          background: none; border: none; cursor: pointer; padding: 0;
          font-family: var(--font-sans);
        }
        .pp-taxonomy-clear:hover { text-decoration: underline; }

        .pp-radius-select {
          flex: 0 0 86px; height: 32px; padding: 0 7px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 12px; color: var(--ink); background: var(--surface);
          outline: none; cursor: pointer; font-family: var(--font-sans);
        }
        .pp-search-btn {
          height: 32px; padding: 0 14px;
          background: var(--blue-600); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans); flex-shrink: 0;
          transition: all 0.15s;
        }
        .pp-search-btn:hover:not(:disabled) { background: var(--blue-700); }
        .pp-search-btn:disabled { background: var(--muted-light); cursor: not-allowed; }

        /* Resolving indicator */
        .pp-resolving {
          padding: 5px 14px; background: var(--blue-50);
          border-bottom: 1px solid var(--blue-100);
          font-size: 11px; color: var(--blue-600); font-weight: 600;
          display: flex; align-items: center; gap: 7px;
        }
        .pp-resolving-spinner {
          width: 12px; height: 12px;
          border: 1.5px solid rgba(37,99,235,0.3);
          border-top-color: var(--blue-600); border-radius: 50%;
          animation: spinAnim 0.65s linear infinite; flex-shrink: 0;
        }

        /* Selected taxonomy chips bar */
        .pp-chips-bar {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 14px; background: var(--blue-50);
          border-bottom: 1px solid var(--blue-200); flex-wrap: wrap;
        }
        .pp-chips-label {
          font-size: 10px; font-weight: 700; color: #1d4ed8;
          letter-spacing: 0.5px; text-transform: uppercase; flex-shrink: 0;
        }
        .pp-chip {
          display: inline-flex; align-items: center; gap: 4px;
          background: var(--blue-600); color: #fff;
          border-radius: 20px; padding: 2px 9px;
          font-size: 10px; font-weight: 600;
        }

        /* Map */
        .pp-map-wrap {
          height: 260px; position: relative;
          background: var(--surface-2);
          border-bottom: 1px solid var(--border);
        }
        .pp-map-empty {
          display: flex; align-items: center; justify-content: center;
          height: 100%; font-size: 12px; color: var(--muted);
          font-weight: 500; flex-direction: column; gap: 10px;
        }
        .pp-count-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 14px; border-bottom: 1px solid var(--border);
          background: #fff; font-size: 11px; color: var(--muted); font-weight: 600;
        }
        .pp-count-bar strong { color: var(--ink); }
        .pp-list { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
        .pp-load-more-top {
          height: 28px; padding: 0 12px;
          background: var(--blue-600); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 11px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans); transition: all 0.15s;
        }
        .pp-load-more-top:hover:not(:disabled) { background: var(--blue-700); }
        .pp-load-more-top:disabled { opacity: 0.55; cursor: not-allowed; }
        .pp-load-more-bottom {
          width: 100%; padding: 11px 0; background: #fff;
          border-radius: var(--radius-md); font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans);
          border: 1.5px dashed var(--border); color: var(--blue-600);
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: all 0.15s;
        }
        .pp-load-more-bottom:hover:not(:disabled) {
          background: var(--blue-50); border-color: var(--blue-500);
        }
        .pp-load-more-bottom:disabled { opacity: 0.5; cursor: not-allowed; }
        .pp-center {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px;
          padding: 36px 20px; color: var(--muted); text-align: center;
        }
        .pp-empty-icon  { font-size: 30px; opacity: 0.5; }
        .pp-empty-title { font-size: 13px; font-weight: 600; color: var(--ink-3); }
        .pp-empty-sub   { font-size: 11px; max-width: 220px; line-height: 1.6; }
        .pp-error {
          margin: 8px 14px; padding: 10px 12px; border-radius: var(--radius-md);
          background: var(--coral-50); border: 1px solid #fecaca;
          color: var(--coral-600); font-size: 12px;
        }
        .pp-error-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
        .pp-section-hdr {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 14px 8px; border-top: 2px solid var(--border);
          background: var(--surface);
        }
        .pp-section-title {
          font-size: 12px; font-weight: 700; color: var(--ink);
          display: flex; align-items: center; gap: 6px;
        }
        .pp-section-badge {
          background: var(--blue-600); color: #fff;
          font-size: 9px; font-weight: 700; padding: 2px 7px;
          border-radius: 20px; letter-spacing: 0.5px; text-transform: uppercase;
        }
        .pp-section-sub { font-size: 10px; color: var(--muted); margin-top: 2px; }
        .pp-spinner-sm {
          width: 16px; height: 16px;
          border: 2px solid var(--border);
          border-top-color: var(--blue-600); border-radius: 50%;
          animation: spinAnim 0.7s linear infinite; flex-shrink: 0;
        }
        .pp-load-more-wrap {
          margin-top: 4px; padding: 10px 14px 4px;
          border-top: 1px solid var(--border);
          display: flex; flex-direction: column; align-items: center; gap: 5px;
        }
        .pp-count-sub { font-size: 10px; color: var(--muted); }
      `}</style>

      <div className="pp-shell">
        {kpiBar}

        {/* Sticky toolbar */}
        <div className="pp-toolbar">
          <button className="pp-back-btn" onClick={onBack} title="Back to sites">←</button>
          <div className="pp-site-label">
            <div className="pp-site-name">{site.facility || "Site"}</div>
            <div className="pp-site-sub">
              {[site.city, site.state].filter(Boolean).join(", ")} · nearby physicians
            </div>
          </div>

          {/* Taxonomy multi-select dropdown */}
          <div className="pp-taxonomy-wrap" ref={dropdownRef}>
            <button
              className="pp-taxonomy-trigger"
              disabled={resolving}
              onClick={() => !resolving && setDropdownOpen((o) => !o)}
              title={selectedLabels.join(", ") || "Select taxonomy"}
            >
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: selectedCodes.length === 0 ? "var(--muted-light)" : "var(--ink)",
              }}>
                {resolving ? "Resolving specialty…" : triggerLabel}
              </span>
            </button>
            <span className="pp-taxonomy-caret">{dropdownOpen ? "▲" : "▼"}</span>

            {dropdownOpen && (
              <div className="pp-taxonomy-dropdown">
                <input
                  className="pp-taxonomy-search"
                  placeholder="Search specialties…"
                  value={dropdownSearch}
                  onChange={(e) => setDropdownSearch(e.target.value)}
                  autoFocus
                />
                <div className="pp-taxonomy-list">
                  {GROUPS.map((group) => {
                    const groupItems = filteredOptions.filter((o) => o.group === group);
                    if (groupItems.length === 0) return null;
                    return (
                      <React.Fragment key={group}>
                        <div className="pp-taxonomy-group-label">{group}</div>
                        {groupItems.map((opt) => {
                          const isSelected = selectedCodes.includes(opt.code);
                          return (
                            <div
                              key={opt.code}
                              className={`pp-taxonomy-item${isSelected ? " selected" : ""}`}
                              onClick={() => toggleCode(opt.code)}
                            >
                              <div className="pp-taxonomy-checkbox">
                                {isSelected && "✓"}
                              </div>
                              {opt.label}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                  {filteredOptions.length === 0 && (
                    <div style={{ padding: "10px", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                      No matches for "{dropdownSearch}"
                    </div>
                  )}
                </div>
                <div className="pp-taxonomy-footer">
                  <span className="pp-taxonomy-count">
                    {selectedCodes.length} selected
                  </span>
                  {selectedCodes.length > 0 && (
                    <button className="pp-taxonomy-clear" onClick={() => setSelectedCodes([])}>
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <select
            className="pp-radius-select"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} mi</option>)}
          </select>
          <button
            className="pp-search-btn"
            onClick={handleSearch}
            disabled={loading || resolving}
          >
            {loading ? "…" : "Search"}
          </button>
        </div>

        {resolving && (
          <div className="pp-resolving">
            <div className="pp-resolving-spinner" />
            Resolving specialty for "{site.condition}"…
          </div>
        )}

        {/* Selected taxonomy chips */}
        {selectedLabels.length > 0 && !resolving && (
          <div className="pp-chips-bar">
            <span className="pp-chips-label">Taxonomy</span>
            {selectedLabels.map(s => (
              <span key={s} className="pp-chip">{s}</span>
            ))}
          </div>
        )}

        {/* Search result specialty chips */}
        {searchSpecialties.length > 0 && !resolving && selectedLabels.length === 0 && (
          <div className="pp-chips-bar">
            <span className="pp-chips-label">Matching</span>
            {searchSpecialties.map(s => <span key={s} className="pp-chip">{s}</span>)}
          </div>
        )}

        {/* Map */}
        <div className="pp-map-wrap">
          {(searched && physicians.length > 0) || suggested.physicians.length > 0 ? (
            <PhysicianMap
              physicians={physicians}
              suggestedPhysicians={suggested.physicians}
              selectedSite={site}
              selectedNpi={selectedNpi}
              onSelect={(p) => setSelectedNpi(p.npi)}
            />
          ) : (
            <div className="pp-map-empty">
              <span style={{ fontSize: 28, opacity: 0.35 }}>🗺️</span>
              <span>
                {resolving
                  ? "Resolving specialty…"
                  : loading
                  ? "Finding physicians…"
                  : "Run a search to see physicians on the map"}
              </span>
            </div>
          )}
        </div>

        {/* Count bar */}
        {!loading && physicians.length > 0 && (
          <div className="pp-count-bar">
            <span><strong>{physicians.length}</strong> of <strong>{total}</strong> physicians</span>
            {hasMore && (
              <button className="pp-load-more-top" onClick={() => setShowMainModal(true)} disabled={loading}>
                Load More
              </button>
            )}
          </div>
        )}

        <div className="pp-list">
          {loading && (
            <div className="pp-center">
              <div className="spinner" />
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>Finding physicians…</p>
            </div>
          )}
          {!loading && error && (
            <div className="pp-error">
              <div className="pp-error-label">Error</div>
              {error}
            </div>
          )}
          {!loading && searched && !error && physicians.length === 0 && (
            <div className="pp-center">
              <span className="pp-empty-icon">👨‍⚕️</span>
              <span className="pp-empty-title">No physicians found</span>
              <span className="pp-empty-sub">
                {selectedLabels.length > 0
                  ? `No ${selectedLabels[0]} physicians found within ${radius} miles. Try a different taxonomy or increase the radius.`
                  : resolvedSpecialty
                  ? `No ${resolvedSpecialty} physicians found within ${radius} miles. Try increasing the radius.`
                  : "Try increasing the radius or selecting a different taxonomy."}
              </span>
            </div>
          )}

          {!loading && physicians.map((p, i) => (
            <div key={p.npi} className={`card-anim-${Math.min(i + 1, 5)}`}>
              <PhysicianCard
                physician={p}
                nctId={site.nct_id}
                siteName={site.facility}
                onClick={(phys) => setDetailPhys(phys)}
              />
            </div>
          ))}

          {!loading && hasMore && physicians.length > 0 && (
            <div className="pp-load-more-wrap">
              <button className="pp-load-more-bottom" onClick={() => setShowMainModal(true)} disabled={loading}>
                Load more physicians
              </button>
              <span className="pp-count-sub">Showing {physicians.length} of {total}</span>
            </div>
          )}
        </div>

        {/* Suggested Physicians section */}
        {(suggested.searched || suggested.loading) && (
          <>
            <div className="pp-section-hdr">
              <div>
                <div className="pp-section-title">
                  ⭐ Suggested Physicians
                  <span className="pp-section-badge">Trial-related</span>
                </div>
                <div className="pp-section-sub">
                  Related to <strong style={{ color: "var(--ink-2)" }}>{site.condition || "this trial"}</strong>
                </div>
              </div>
              {suggested.hasMore && !suggested.loading && (
                <button className="pp-load-more-top" onClick={() => setShowSuggestModal(true)} disabled={suggested.loading}>
                  Load More
                </button>
              )}
            </div>

            <div className="pp-list">
              {suggested.loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>
                  <div className="pp-spinner-sm" />
                  Finding suggested physicians…
                </div>
              )}
              {!suggested.loading && suggested.error && (
                <div className="pp-error">
                  <div className="pp-error-label">Error</div>
                  {suggested.error}
                </div>
              )}
              {!suggested.loading && suggested.searched && !suggested.error && suggested.physicians.length === 0 && (
                <div style={{ padding: "12px 0", textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                  No additional specialists found for this trial.
                </div>
              )}

              {!suggested.loading && suggested.physicians.map((p, i) => (
                <div key={p.npi} className={`card-anim-${Math.min(i + 1, 5)}`}>
                  <PhysicianCard
                    physician={p}
                    nctId={site.nct_id}
                    siteName={site.facility}
                    onClick={(phys) => setDetailPhys(phys)}
                  />
                </div>
              ))}

              {!suggested.loading && suggested.hasMore && suggested.physicians.length > 0 && (
                <div className="pp-load-more-wrap">
                  <button className="pp-load-more-bottom" onClick={() => setShowSuggestModal(true)} disabled={suggested.loading}>
                    Load more suggested
                  </button>
                  <span className="pp-count-sub">Showing {suggested.physicians.length} of {suggested.total}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showMainModal && (
        <LeadCaptureModal
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={() => setShowMainModal(false)}
          onSuccess={() => { setShowMainModal(false); onLoadMore(); }}
        />
      )}
      {showSuggestModal && (
        <LeadCaptureModal
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={() => setShowSuggestModal(false)}
          onSuccess={() => { setShowSuggestModal(false); suggested.loadMore(); }}
        />
      )}
    </>
  );
}