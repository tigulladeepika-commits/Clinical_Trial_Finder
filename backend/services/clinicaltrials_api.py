from __future__ import annotations

import logging
import re
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
USER_AGENT = "ClinicalTrialLocator/1.0"
DEFAULT_PAGE_SIZE = 100

_ABSOLUTE_PAGE_CEILING = 200

STATE_ABBREV_TO_FULL = {
    "al": "alabama",           "ak": "alaska",          "az": "arizona",
    "ar": "arkansas",          "ca": "california",      "co": "colorado",
    "ct": "connecticut",       "de": "delaware",        "fl": "florida",
    "ga": "georgia",           "hi": "hawaii",          "id": "idaho",
    "il": "illinois",          "in": "indiana",         "ia": "iowa",
    "ks": "kansas",            "ky": "kentucky",        "la": "louisiana",
    "me": "maine",             "md": "maryland",        "ma": "massachusetts",
    "mi": "michigan",          "mn": "minnesota",       "ms": "mississippi",
    "mo": "missouri",          "mt": "montana",         "ne": "nebraska",
    "nv": "nevada",            "nh": "newhampshire",    "nj": "newjersey",
    "nm": "newmexico",         "ny": "newyork",         "nc": "northcarolina",
    "nd": "northdakota",       "oh": "ohio",            "ok": "oklahoma",
    "or": "oregon",            "pa": "pennsylvania",    "ri": "rhodeisland",
    "sc": "southcarolina",     "sd": "southdakota",     "tn": "tennessee",
    "tx": "texas",             "ut": "utah",            "vt": "vermont",
    "va": "virginia",          "wa": "washington",      "wv": "westvirginia",
    "wi": "wisconsin",         "wy": "wyoming",         "dc": "districtofcolumbia",
}

_VALID_STATES_NORMALIZED: frozenset[str] = frozenset(STATE_ABBREV_TO_FULL.values())
_CITY_RE = re.compile(r"^[A-Za-z\s\-\'\.\,]+$")


# ─────────────────────────────────────────────────────────────────────────────
# SPECIALTY → DISEASE CONDITION EXPANSION MAP
#
# Root problem: ClinicalTrials.gov's query.cond is designed for *disease names*
# like "Parkinson Disease", not specialty/department names like "neurology".
# Sending a specialty name causes two categories of false positives:
#
#   Category A — Condition-tagged as the specialty itself:
#     Studies where the registrar used the specialty name as a condition tag
#     (e.g. Conditions: "Neurology", "Pharmacokinetics"). These are legitimate
#     ClinicalTrials.gov registrations but not clinical condition trials.
#
#   Category B — Incidental title/text mentions:
#     Studies that mention the specialty in their title/description as a
#     department or context word (e.g. "Quality Improvement in Neurology
#     Using EMR", "Improving Sleep in the Neurology In-Patient Population").
#
# Two-phase fix:
#
#   Phase 1 — Query expansion:
#     When the search term is a recognised specialty name, expand it to a
#     disease-level OR query before hitting the ClinicalTrials.gov API.
#     "neurology" → "Parkinson Disease OR Epilepsy OR Multiple Sclerosis OR ..."
#     This dramatically reduces Category B false positives at the API level.
#
#   Phase 2 — Post-fetch two-gate relevance filter:
#     Gate 1: Reject administrative/operational studies (registries, surveys,
#             quality improvement, apps, education trials) unless their
#             conditions[] list contains ≥2 specific clinical conditions.
#     Gate 2: For specialty searches, require at least one domain synonym
#             in conditions[]. Catches Category A false positives where
#             conditions=["Neurology","Pharmacokinetics"] — no real disease.
# ─────────────────────────────────────────────────────────────────────────────

SPECIALTY_TO_CONDITIONS: dict[str, list[str]] = {
    "neurology": [
        "Parkinson Disease",
        "Epilepsy",
        "Multiple Sclerosis",
        "Stroke",
        "Alzheimer Disease",
        "Dementia",
        "Migraine",
        "Neuropathy",
        "Amyotrophic Lateral Sclerosis",
        "Glioma",
        "Brain Injury",
        "Cerebrovascular Disease",
        "Tremor",
        "Dystonia",
        "Myasthenia Gravis",
        "Encephalitis",
        "Meningitis",
        "Hydrocephalus",
        "Ataxia",
        "Spinal Cord Disease",
        "Guillain-Barre Syndrome",
        "Peripheral Neuropathy",
        "Cerebral Palsy",
        "Huntington Disease",
    ],
    "cardiology": [
        "Heart Failure",
        "Atrial Fibrillation",
        "Coronary Artery Disease",
        "Myocardial Infarction",
        "Hypertension",
        "Cardiomyopathy",
        "Arrhythmia",
        "Aortic Valve Disease",
        "Peripheral Arterial Disease",
        "Pulmonary Hypertension",
        "Ventricular Tachycardia",
        "Aortic Aneurysm",
    ],
    "cardiovascular disease": [
        "Heart Failure",
        "Coronary Artery Disease",
        "Atrial Fibrillation",
        "Hypertension",
        "Cardiomyopathy",
        "Peripheral Arterial Disease",
        "Myocardial Infarction",
    ],
    "oncology": [
        "Carcinoma",
        "Lymphoma",
        "Leukemia",
        "Sarcoma",
        "Glioblastoma",
        "Melanoma",
        "Breast Cancer",
        "Lung Cancer",
        "Colorectal Cancer",
        "Prostate Cancer",
        "Multiple Myeloma",
        "Neoplasm",
        "Ovarian Cancer",
        "Pancreatic Cancer",
    ],
    "psychiatry": [
        "Depression",
        "Anxiety Disorder",
        "Bipolar Disorder",
        "Schizophrenia",
        "Post-Traumatic Stress Disorder",
        "Attention Deficit Disorder",
        "Obsessive-Compulsive Disorder",
        "Eating Disorder",
        "Psychosis",
        "Borderline Personality Disorder",
        "Autism Spectrum Disorder",
    ],
    "gastroenterology": [
        "Crohn Disease",
        "Ulcerative Colitis",
        "Irritable Bowel Syndrome",
        "Liver Cirrhosis",
        "Hepatitis",
        "Gastroesophageal Reflux",
        "Pancreatitis",
        "Celiac Disease",
        "Colorectal Cancer",
        "Non-Alcoholic Fatty Liver Disease",
    ],
    "pulmonology": [
        "Asthma",
        "Chronic Obstructive Pulmonary Disease",
        "Pulmonary Fibrosis",
        "Sleep Apnea",
        "Lung Cancer",
        "Pneumonia",
        "Pulmonary Hypertension",
        "Bronchiectasis",
        "Sarcoidosis",
    ],
    "rheumatology": [
        "Rheumatoid Arthritis",
        "Systemic Lupus Erythematosus",
        "Psoriatic Arthritis",
        "Ankylosing Spondylitis",
        "Osteoarthritis",
        "Fibromyalgia",
        "Sjogren Syndrome",
        "Vasculitis",
        "Gout",
        "Scleroderma",
        "Myositis",
    ],
    "dermatology": [
        "Psoriasis",
        "Atopic Dermatitis",
        "Melanoma",
        "Acne",
        "Vitiligo",
        "Alopecia",
        "Urticaria",
        "Hidradenitis Suppurativa",
        "Rosacea",
    ],
    "endocrinology": [
        "Type 2 Diabetes",
        "Type 1 Diabetes",
        "Thyroid Nodule",
        "Hypothyroidism",
        "Obesity",
        "Adrenal Insufficiency",
        "Cushing Syndrome",
        "Osteoporosis",
        "Metabolic Syndrome",
        "Hyperthyroidism",
    ],
    "nephrology": [
        "Chronic Kidney Disease",
        "Glomerulonephritis",
        "Kidney Transplantation",
        "Acute Kidney Injury",
        "Diabetic Nephropathy",
        "Polycystic Kidney Disease",
        "Hemodialysis",
        "IgA Nephropathy",
    ],
    "urology": [
        "Prostate Cancer",
        "Bladder Cancer",
        "Benign Prostatic Hyperplasia",
        "Urinary Incontinence",
        "Kidney Stones",
        "Erectile Dysfunction",
        "Overactive Bladder",
        "Testicular Cancer",
    ],
    "ophthalmology": [
        "Glaucoma",
        "Age-Related Macular Degeneration",
        "Diabetic Retinopathy",
        "Cataract",
        "Dry Eye",
        "Retinal Detachment",
        "Uveitis",
        "Corneal Disease",
    ],
    "otolaryngology": [
        "Hearing Loss",
        "Chronic Sinusitis",
        "Obstructive Sleep Apnea",
        "Head and Neck Cancer",
        "Tinnitus",
        "Vestibular Disorder",
        "Thyroid Nodule",
        "Laryngeal Cancer",
    ],
    "infectious disease": [
        "HIV",
        "Tuberculosis",
        "Hepatitis C",
        "Sepsis",
        "COVID-19",
        "Influenza",
        "Pneumonia",
        "Lyme Disease",
        "Malaria",
        "Clostridioides difficile",
    ],
    "geriatrics": [
        "Dementia",
        "Alzheimer Disease",
        "Frailty",
        "Falls",
        "Osteoporosis",
        "Delirium",
        "Sarcopenia",
        "Functional Decline",
    ],
    "pediatrics": [
        "Childhood Asthma",
        "Pediatric Cancer",
        "Type 1 Diabetes",
        "Autism Spectrum Disorder",
        "Attention Deficit Disorder",
        "Congenital Heart Disease",
        "Neonatal Sepsis",
        "Pediatric Epilepsy",
    ],
    "hematology": [
        "Leukemia",
        "Lymphoma",
        "Multiple Myeloma",
        "Sickle Cell Disease",
        "Thalassemia",
        "Hemophilia",
        "Anemia",
        "Myelodysplastic Syndrome",
        "Thrombocytopenia",
    ],
    "allergy": [
        "Allergic Rhinitis",
        "Asthma",
        "Food Allergy",
        "Urticaria",
        "Anaphylaxis",
        "Atopic Dermatitis",
        "Drug Hypersensitivity",
        "Eosinophilic Esophagitis",
    ],
    "pain medicine": [
        "Chronic Pain",
        "Neuropathic Pain",
        "Low Back Pain",
        "Fibromyalgia",
        "Complex Regional Pain Syndrome",
        "Osteoarthritis",
        "Cancer Pain",
        "Postoperative Pain",
    ],
    "sleep medicine": [
        "Obstructive Sleep Apnea",
        "Insomnia",
        "Narcolepsy",
        "Restless Leg Syndrome",
        "Circadian Rhythm Disorder",
        "Central Sleep Apnea",
    ],
    "addiction medicine": [
        "Opioid Use Disorder",
        "Alcohol Use Disorder",
        "Substance Use Disorder",
        "Nicotine Dependence",
        "Cocaine Dependence",
        "Methamphetamine Use Disorder",
    ],
    "physical medicine": [
        "Stroke Rehabilitation",
        "Spinal Cord Injury",
        "Traumatic Brain Injury",
        "Amputee Rehabilitation",
        "Chronic Pain",
        "Multiple Sclerosis",
        "Musculoskeletal Disorder",
    ],
    "vascular surgery": [
        "Peripheral Arterial Disease",
        "Aortic Aneurysm",
        "Deep Vein Thrombosis",
        "Carotid Artery Stenosis",
        "Varicose Veins",
        "Venous Insufficiency",
    ],
    "thoracic surgery": [
        "Lung Cancer",
        "Esophageal Cancer",
        "Pleural Effusion",
        "Pneumothorax",
        "Mediastinal Tumor",
        "Mesothelioma",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────
# DOMAIN SYNONYM SETS
#
# Used in Gate 2 of post-fetch filtering.
# A trial's conditions[] must contain at least one token from the relevant
# synonym set to confirm it genuinely belongs to the searched clinical domain.
# ─────────────────────────────────────────────────────────────────────────────

DOMAIN_SYNONYMS: dict[str, set[str]] = {
    "neurology": {
        "parkinson", "epilepsy", "seizure", "multiple sclerosis", "stroke",
        "alzheimer", "dementia", "migraine", "neuropathy", "amyotrophic",
        "glioma", "glioblastoma", "brain", "cerebral", "cerebrovascular",
        "tremor", "dystonia", "myasthenia", "encephalitis", "meningitis",
        "hydrocephalus", "ataxia", "spinal cord", "tbi", "peripheral nerve",
        "neurological", "neurodegenerative", "vertigo", "concussion",
        "guillain", "huntington", "friedreich", "mitochondrial",
    },
    "cardiology": {
        "heart", "cardiac", "cardiovascular", "coronary", "arrhythmia",
        "atrial fibrillation", "myocardial", "hypertension", "cardiomyopathy",
        "valve", "aortic", "ventricular", "angina", "pericarditis",
    },
    "cardiovascular disease": {
        "heart", "cardiac", "cardiovascular", "coronary", "arrhythmia",
        "atrial fibrillation", "myocardial", "hypertension",
    },
    "oncology": {
        "cancer", "carcinoma", "sarcoma", "lymphoma", "leukemia", "myeloma",
        "tumor", "neoplasm", "malignant", "metastatic", "melanoma",
        "adenocarcinoma", "glioblastoma",
    },
    "psychiatry": {
        "depression", "anxiety", "bipolar", "schizophrenia", "ptsd",
        "psychosis", "adhd", "ocd", "eating disorder", "panic",
        "autism", "borderline",
    },
    "gastroenterology": {
        "crohn", "colitis", "ibs", "liver", "hepatitis", "cirrhosis",
        "gerd", "pancreatitis", "celiac", "gastrointestinal", "esophageal",
        "fatty liver",
    },
    "pulmonology": {
        "asthma", "copd", "pulmonary", "lung", "emphysema", "pneumonia",
        "bronchitis", "fibrosis", "respiratory", "sarcoidosis",
    },
    "rheumatology": {
        "arthritis", "lupus", "fibromyalgia", "sjogren", "scleroderma",
        "vasculitis", "gout", "spondylitis", "myositis",
    },
    "dermatology": {
        "psoriasis", "eczema", "melanoma", "acne", "vitiligo", "alopecia",
        "dermatitis", "urticaria", "rosacea",
    },
    "endocrinology": {
        "diabetes", "thyroid", "obesity", "adrenal", "pituitary",
        "metabolic", "insulin", "cushing", "osteoporosis", "hyperthyroid",
    },
    "nephrology": {
        "kidney", "renal", "glomerular", "dialysis", "nephropathy",
        "proteinuria", "ckd", "polycystic",
    },
    "urology": {
        "prostate", "bladder", "urinary", "kidney stone",
        "erectile", "testicular", "incontinence",
    },
    "ophthalmology": {
        "glaucoma", "macular", "retina", "cataract",
        "diabetic retinopathy", "uveitis", "dry eye", "corneal",
    },
    "otolaryngology": {
        "hearing", "sinus", "tinnitus", "vestibular",
        "larynx", "head and neck", "sleep apnea",
    },
    "infectious disease": {
        "hiv", "tuberculosis", "hepatitis", "sepsis", "covid",
        "influenza", "malaria", "lyme", "mrsa", "clostridioides",
    },
    "geriatrics": {
        "dementia", "alzheimer", "frailty", "fall", "osteoporosis",
        "delirium", "sarcopenia", "elderly", "functional decline",
    },
    "pediatrics": {
        "pediatric", "childhood", "infant", "neonatal",
        "congenital", "autism", "adhd",
    },
    "hematology": {
        "leukemia", "lymphoma", "myeloma", "sickle cell", "thalassemia",
        "hemophilia", "anemia", "myelodysplastic", "thrombocytopenia",
    },
    "allergy": {
        "allerg", "asthma", "urticaria", "anaphylaxis",
        "dermatitis", "eosinophilic", "rhinitis",
    },
    "pain medicine": {
        "chronic pain", "neuropathic", "back pain", "fibromyalgia",
        "complex regional", "osteoarthritis", "cancer pain",
    },
    "sleep medicine": {
        "sleep apnea", "insomnia", "narcolepsy", "restless leg",
        "circadian", "hypersomnia",
    },
    "addiction medicine": {
        "opioid", "alcohol use", "substance use", "nicotine",
        "cocaine", "methamphetamine",
    },
    "physical medicine": {
        "rehabilitation", "spinal cord injury", "traumatic brain",
        "amputee", "stroke rehab", "musculoskeletal",
    },
    "vascular surgery": {
        "peripheral arterial", "aortic aneurysm", "deep vein",
        "carotid", "varicose", "venous insufficiency",
    },
    "thoracic surgery": {
        "lung cancer", "esophageal", "pleural", "pneumothorax",
        "mediastinal", "mesothelioma",
    },
}

# Set of recognised specialty names — anything in this set triggers Phase 1
# expansion. Everything else is treated as a specific disease and passed through.
_SPECIALTY_NAMES: frozenset[str] = frozenset(SPECIALTY_TO_CONDITIONS.keys())

# Minimum relevance score (used in specific-disease searches only)
MIN_RELEVANCE_SCORE = 40

# ─────────────────────────────────────────────────────────────────────────────
# ADMINISTRATIVE STUDY PATTERNS
#
# Regex that matches titles characteristic of operational/administrative studies:
# registries, surveys, eligibility screeners, quality-improvement projects,
# app validations, and education trials. These are legitimate ClinicalTrials.gov
# registrations but are almost never what a clinician searching for patient
# trials is looking for.
#
# A study matching this pattern is dropped UNLESS its conditions[] list
# contains ≥ 2 specific (non-generic) clinical condition terms, which indicates
# it is a registry studying real patients with real diseases.
# (Example: "Parkinson's Disease Registry" matches "registry" but conditions =
# ["Parkinson Disease", "Movement Disorders"] → 2 specific conditions → kept.)
# ─────────────────────────────────────────────────────────────────────────────

_ADMIN_TITLE_PATTERNS = re.compile(
    r"\b("
    r"triage survey"
    r"|eligibility survey"
    r"|research eligibility"
    r"|quality improvement"
    r"|electronic medical record"
    r"|\bemr\b"
    r"|smartphone app"
    r"|mobile app"
    r"|telemedicine app"
    r"|nutritional risk"
    r"|inpatient population"
    r"|in-patient population"
    r"|clinical education trial"
    r"|access to (specialty|care)"
    r"|pharmacokinetics only"
    r"|healthy (adult|volunteer|subject)"
    r")\b",
    re.IGNORECASE,
)

# Condition tags that are too generic to count as "specific clinical conditions"
# for the Gate 1 clinical-conditions count check.
_GENERIC_CONDITION_TAGS: frozenset[str] = frozenset({
    "neurology", "cardiology", "oncology", "psychiatry", "health services",
    "pharmacokinetics", "mental health", "telemedicine", "digital health",
    "quality of life", "clinical registry", "healthy volunteers",
    "healthy adults", "healthy subjects",
})


def _norm_lower(text: str) -> str:
    """Lowercase and collapse whitespace."""
    return " ".join((text or "").lower().split())


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — SPECIALTY EXPANSION
# ─────────────────────────────────────────────────────────────────────────────

def _expand_specialty_to_query(condition: str) -> tuple[str, bool]:
    """
    If condition is a recognised clinical specialty name, expand it to a
    disease-level OR query for ClinicalTrials.gov. Otherwise return unchanged.

    Returns:
        (api_query_string, was_expanded)
        was_expanded=True → apply domain-synonym gate in Phase 2 filtering.

    Examples:
        "neurology"     → ("Parkinson Disease OR Epilepsy OR ...", True)
        "glioblastoma"  → ("glioblastoma", False)   — specific disease, no expand
        "alzheimer"     → ("alzheimer", False)        — specific disease, no expand
    """
    key = _norm_lower(condition)

    # Direct key match
    if key in _SPECIALTY_NAMES:
        terms = SPECIALTY_TO_CONDITIONS[key]
        return " OR ".join(terms), True

    # Partial key match (e.g. "pulmonary disease" → "pulmonology")
    for sp_key in _SPECIALTY_NAMES:
        if key in sp_key or sp_key in key:
            terms = SPECIALTY_TO_CONDITIONS[sp_key]
            return " OR ".join(terms), True

    return condition, False


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — POST-FETCH RELEVANCE FILTER
# ─────────────────────────────────────────────────────────────────────────────

def _count_specific_conditions(conditions_raw: list[str]) -> int:
    """
    Count how many conditions in the list are specific clinical conditions
    (i.e. not in _GENERIC_CONDITION_TAGS and longer than 4 characters).
    Used by Gate 1 to decide whether an administrative-titled study still
    has enough clinical substance to be shown.
    """
    return sum(
        1 for c in conditions_raw
        if c not in _GENERIC_CONDITION_TAGS and len(c) > 4
    )


def _is_relevant(
    trial: dict[str, Any],
    original_term: str,
    was_expanded: bool,
) -> bool:
    """
    Two-gate post-fetch relevance filter.

    Gate 1 — Administrative/operational study rejection:
      Studies whose titles match _ADMIN_TITLE_PATTERNS are considered
      administrative (registries, surveys, quality-improvement projects,
      app studies, healthy-volunteer PK studies) and dropped UNLESS their
      conditions[] list contains ≥ 2 specific clinical conditions.
      This preserves disease-specific registries (Parkinson's registry,
      Alzheimer's registry) while dropping generic operational studies.

    Gate 2 — Domain synonym check (specialty searches only):
      Applied only when was_expanded=True (the user searched for a specialty
      name like "neurology" rather than a specific disease like "glioblastoma").
      Requires at least one token from the domain's DOMAIN_SYNONYMS set to
      appear in the trial's conditions[] text.

      This catches Category A false positives where ClinicalTrials.gov has
      tagged a study as Conditions: ["Neurology", "Pharmacokinetics"] —
      both are valid tags on the platform but neither is a neurological disease.
      The synonyms gate rejects these because "neurology" and "pharmacokinetics"
      are not in the neurology synonym set.

      Gate 2 is deliberately NOT applied to specific disease searches
      (was_expanded=False) because those are already precise — a search for
      "glioblastoma" doesn't need synonym filtering.
    """
    title = _norm_lower(trial.get("title") or "")
    conditions_raw = [_norm_lower(c) for c in (trial.get("conditions") or [])]
    conditions_text = " ".join(conditions_raw)

    # ── Gate 1: administrative/operational study filter ────────────────────────
    if _ADMIN_TITLE_PATTERNS.search(title):
        specific_count = _count_specific_conditions(conditions_raw)
        if specific_count < 2:
            logger.debug(
                "Gate 1 dropped (admin title, %d specific conditions): %s",
                specific_count, trial.get("nctId"),
            )
            return False

    # ── Gate 2: domain synonym check for specialty searches ───────────────────
    if was_expanded:
        term = _norm_lower(original_term)
        synonyms = DOMAIN_SYNONYMS.get(term, set())

        # Partial synonym group match (e.g. "cardiovascular" → "cardiovascular disease")
        if not synonyms:
            for key, syn_set in DOMAIN_SYNONYMS.items():
                if term in key or key in term:
                    synonyms = syn_set
                    break

        if synonyms and not any(syn in conditions_text for syn in synonyms):
            logger.debug(
                "Gate 2 dropped (no domain synonym in conditions): %s | conditions=%s",
                trial.get("nctId"), conditions_raw,
            )
            return False

    return True


# ─────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_value(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _extract_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, str) and value:
        return [value]
    return []


def _map_location(location: dict[str, Any], overall_status: str | None = None) -> dict[str, Any]:
    geo_point = location.get("geoPoint") or {}
    site_status = location.get("recruitmentStatus") or None
    resolved_status = site_status if site_status else overall_status
    return {
        "facility": location.get("facility"),
        "city":     location.get("city"),
        "state":    location.get("state"),
        "country":  location.get("country"),
        "status":   resolved_status,
        "lat":      geo_point.get("lat"),
        "lon":      geo_point.get("lon"),
    }


def _map_trial(study: dict[str, Any]) -> dict[str, Any]:
    protocol       = study.get("protocolSection", {})
    identification = protocol.get("identificationModule", {})
    status_module  = protocol.get("statusModule", {})
    description    = protocol.get("descriptionModule", {})
    conditions     = protocol.get("conditionsModule", {})
    sponsor_info   = protocol.get("sponsorCollaboratorsModule", {})
    design         = protocol.get("designModule", {})
    contacts       = protocol.get("contactsLocationsModule", {})
    eligibility    = protocol.get("eligibilityModule", {})

    overall_status = status_module.get("overallStatus")

    central_contact = None
    central_contacts = contacts.get("centralContacts") or []
    if central_contacts:
        first_contact = central_contacts[0]
        central_contact = {
            "name":  first_contact.get("name"),
            "role":  first_contact.get("role"),
            "phone": first_contact.get("phone"),
            "email": first_contact.get("email"),
        }

    return {
        "nctId":             identification.get("nctId"),
        "title":             identification.get("briefTitle"),
        "status":            overall_status,
        "description":       description.get("briefSummary"),
        "conditions":        _extract_text_list(conditions.get("conditions")),
        "sponsor":           (sponsor_info.get("leadSponsor") or {}).get("name"),
        "phases":            _extract_text_list(design.get("phases")),
        "locations":         [
            _map_location(location, overall_status)
            for location in contacts.get("locations", [])
        ],
        "inclusionCriteria": eligibility.get("eligibilityCriteria"),
        "exclusionCriteria": None,
        "pointOfContact":    central_contact,
    }


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION HELPERS (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def validate_city(city: str | None) -> tuple[bool, str]:
    """
    Validate a city filter value.
    Returns (is_valid, reason). Blank/None is valid (no filter).
    """
    if not city or not city.strip():
        return True, ""
    stripped = city.strip()
    if len(stripped) < 2:
        return False, f"City name too short: {stripped!r}"
    if len(stripped) > 100:
        return False, "City name too long"
    if not _CITY_RE.match(stripped):
        return False, f"City contains invalid characters: {stripped!r}"
    return True, ""


def validate_state(state: str | None) -> tuple[bool, str]:
    """
    Validate a state filter value (2-letter abbreviation OR full name).
    Returns (is_valid, reason). Blank/None is valid (no filter).
    """
    if not state or not state.strip():
        return True, ""
    norm = _normalize_value(state.strip())
    if norm in STATE_ABBREV_TO_FULL:
        return True, ""
    if norm in _VALID_STATES_NORMALIZED:
        return True, ""
    return False, f"Unrecognised state: {state!r}"


def _matches_filters(trial: dict[str, Any], filters: dict[str, Any]) -> bool:
    """
    Return True if trial satisfies all active hard filters
    (status, phase, city, state, us_only).
    """
    normalized_status = _normalize_value(filters.get("status"))
    normalized_phase  = _normalize_value(filters.get("phase"))
    normalized_city   = _normalize_value(filters.get("city"))
    normalized_state  = _normalize_value(filters.get("state"))

    # Status
    if normalized_status:
        trial_status_norm = _normalize_value(trial.get("status"))
        if (trial_status_norm != normalized_status
                and normalized_status not in trial_status_norm):
            return False

    # Phase
    if normalized_phase:
        trial_phases = [_normalize_value(p) for p in trial.get("phases", [])]
        if normalized_phase not in trial_phases:
            return False

    locations = trial.get("locations", [])

    # City — must match ANY location
    if normalized_city and not any(
        _normalize_value(loc.get("city")) == normalized_city
        for loc in locations
    ):
        return False

    # State — accepts 2-letter abbreviations and full state names
    if normalized_state:
        resolved_state = STATE_ABBREV_TO_FULL.get(normalized_state, normalized_state)
        if not any(
            _normalize_value(loc.get("state")) == resolved_state
            for loc in locations
        ):
            return False

    # US-only — normalise country strings broadly
    _US_NORMS = {"us", "usa", "unitedstates", "unitedstatesofamerica"}
    if filters.get("us_only"):
        if locations and not any(
            _normalize_value(loc.get("country")) in _US_NORMS
            for loc in locations
        ):
            return False

    return True


# ─────────────────────────────────────────────────────────────────────────────
# API FETCH
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_study_page(condition: str, page_token: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "query.cond": condition,
        "pageSize":   DEFAULT_PAGE_SIZE,
        "countTotal": "true",
        "format":     "json",
    }
    if page_token:
        params["pageToken"] = page_token

    response = requests.get(
        BASE_URL,
        params=params,
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def fetch_trials_with_filters(
    filters: dict[str, Any], limit: int, offset: int
) -> tuple[list[dict[str, Any]], int]:
    """
    Fetch, filter, and relevance-score trials from ClinicalTrials.gov.

    Pipeline:

    ┌─────────────────────────────────────────────────────────────────────┐
    │  PHASE 1 — Query Expansion                                          │
    │                                                                     │
    │  If the search term is a specialty name (e.g. "neurology"),         │
    │  expand it to a disease-level OR query before hitting the API.      │
    │                                                                     │
    │  "neurology" → "Parkinson Disease OR Epilepsy OR ..."               │
    │                                                                     │
    │  Specific disease searches ("glioblastoma") pass through unchanged. │
    └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ ClinicalTrials.gov API
    ┌─────────────────────────────────────────────────────────────────────┐
    │  HARD FILTERS (status / phase / city / state / us_only)             │
    └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  PHASE 2 — Post-fetch Relevance Filter                              │
    │                                                                     │
    │  Gate 1: Reject administrative/operational studies unless           │
    │          conditions[] has ≥ 2 specific clinical conditions.         │
    │          (Drops: registries, surveys, EMR studies, app trials,      │
    │           healthy-volunteer PK studies, education trials)           │
    │                                                                     │
    │  Gate 2: For specialty searches, require ≥ 1 domain synonym        │
    │          in conditions[]. (Drops: Conditions=["Neurology",          │
    │          "Pharmacokinetics"] — no actual neurological disease)      │
    └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  paginated slice returned to frontend
    """
    condition = (filters.get("condition") or "").strip()
    if not condition:
        return [], 0

    # Validate city/state before touching the API
    city_ok,  city_reason  = validate_city(filters.get("city"))
    state_ok, state_reason = validate_state(filters.get("state"))
    if not city_ok:
        logger.warning("Invalid city filter rejected: %s", city_reason)
        return [], 0
    if not state_ok:
        logger.warning("Invalid state filter rejected: %s", state_reason)
        return [], 0

    # Phase 1: expand specialty → disease OR query
    api_query, was_expanded = _expand_specialty_to_query(condition)

    if was_expanded:
        logger.info(
            "Specialty expansion: %r → OR query (%d disease terms)",
            condition, len(api_query.split(" OR ")),
        )

    matched_trials: list[dict[str, Any]] = []
    page_token: str | None = None
    pages_fetched = 0
    total_count_estimate = 0
    needed = offset + limit

    while pages_fetched < _ABSOLUTE_PAGE_CEILING and len(matched_trials) < needed:
        payload = _fetch_study_page(api_query, page_token)
        studies = payload.get("studies") or []

        if pages_fetched == 0:
            total_count_estimate = payload.get("totalCount", 0)

        if not studies:
            break

        for study in studies:
            mapped_trial = _map_trial(study)

            # Hard filters (status, phase, city, state, us_only)
            if not _matches_filters(mapped_trial, filters):
                continue

            # Phase 2: two-gate relevance filter
            if not _is_relevant(mapped_trial, condition, was_expanded):
                continue

            matched_trials.append(mapped_trial)

        page_token = payload.get("nextPageToken")
        pages_fetched += 1

        if not page_token:
            break

    paged = matched_trials[offset: offset + limit]
    total_count = len(matched_trials) if not page_token else total_count_estimate

    return paged, total_count


def fetch_study_detail(nct_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{BASE_URL}/{nct_id}",
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()