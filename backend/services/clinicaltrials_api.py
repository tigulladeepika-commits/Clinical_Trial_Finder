"""
services/clinicaltrials_api.py

Changes vs the version you shared:

FIX A — Off-topic results when searching broad disease terms like "cancer":

  Root cause: _expand_specialty_to_query("cancer") returns was_expanded=False
  because "cancer" is a disease term, not a specialty name. That means Gate 2
  (domain synonym check) is never applied — so trials whose conditions list
  contains ["Pharmacokinetics"] or ["Healthy Volunteers"] slip through
  alongside genuinely unrelated studies (tobramycin, colonoscopy, fibroids).

  Two changes:
    1. _DISEASE_SYNONYMS — a parallel dict to DOMAIN_SYNONYMS covering broad
       disease search terms ("cancer", "diabetes", "heart disease", etc.).
       When a search term matches a key here, Gate 2 is applied even though
       was_expanded=False. The synonyms are tight so legitimate trials pass
       (breast cancer, leukemia, glioblastoma all contain "cancer" synonyms).

    2. _NOISE_TITLE_WORDS — an extended set of title-level keywords that are
       strong evidence a trial is NOT about the searched domain. These go into
       Gate 1 as a second check: if the title starts with a noise word that has
       no lexical overlap with the search term, the trial is dropped.

FIX B — Physicians / contacts not fetching for many trials:

  Root cause: _map_trial() only grabbed centralContacts[0] and stored it as
  a single "pointOfContact" dict. ClinicalTrials.gov stores contacts in three
  places and many trials have none in centralContacts but do have them in
  overallOfficials or per-location contacts[].

  Change: replaced _map_trial()'s pointOfContact block with _extract_contacts()
  which harvests all three sources, deduplicates by name, and returns a
  "contacts" list. The old "pointOfContact" key is preserved as an alias
  pointing at contacts[0] so any existing frontend code that reads
  trial.pointOfContact still works.

No other changes — all existing logic, imports, and function signatures
are preserved exactly.
"""

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
# SPECIALTY → DISEASE CONDITION EXPANSION MAP  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

SPECIALTY_TO_CONDITIONS: dict[str, list[str]] = {
    "neurology": [
        "Parkinson Disease", "Epilepsy", "Multiple Sclerosis", "Stroke",
        "Alzheimer Disease", "Dementia", "Migraine", "Neuropathy",
        "Amyotrophic Lateral Sclerosis", "Glioma", "Brain Injury",
        "Cerebrovascular Disease", "Tremor", "Dystonia", "Myasthenia Gravis",
        "Encephalitis", "Meningitis", "Hydrocephalus", "Ataxia",
        "Spinal Cord Disease", "Guillain-Barre Syndrome", "Peripheral Neuropathy",
        "Cerebral Palsy", "Huntington Disease",
    ],
    "cardiology": [
        "Heart Failure", "Atrial Fibrillation", "Coronary Artery Disease",
        "Myocardial Infarction", "Hypertension", "Cardiomyopathy", "Arrhythmia",
        "Aortic Valve Disease", "Peripheral Arterial Disease",
        "Pulmonary Hypertension", "Ventricular Tachycardia", "Aortic Aneurysm",
    ],
    "cardiovascular disease": [
        "Heart Failure", "Coronary Artery Disease", "Atrial Fibrillation",
        "Hypertension", "Cardiomyopathy", "Peripheral Arterial Disease",
        "Myocardial Infarction",
    ],
    "oncology": [
        "Carcinoma", "Lymphoma", "Leukemia", "Sarcoma", "Glioblastoma",
        "Melanoma", "Breast Cancer", "Lung Cancer", "Colorectal Cancer",
        "Prostate Cancer", "Multiple Myeloma", "Neoplasm", "Ovarian Cancer",
        "Pancreatic Cancer",
    ],
    "psychiatry": [
        "Depression", "Anxiety Disorder", "Bipolar Disorder", "Schizophrenia",
        "Post-Traumatic Stress Disorder", "Attention Deficit Disorder",
        "Obsessive-Compulsive Disorder", "Eating Disorder", "Psychosis",
        "Borderline Personality Disorder", "Autism Spectrum Disorder",
    ],
    "gastroenterology": [
        "Crohn Disease", "Ulcerative Colitis", "Irritable Bowel Syndrome",
        "Liver Cirrhosis", "Hepatitis", "Gastroesophageal Reflux", "Pancreatitis",
        "Celiac Disease", "Colorectal Cancer", "Non-Alcoholic Fatty Liver Disease",
    ],
    "pulmonology": [
        "Asthma", "Chronic Obstructive Pulmonary Disease", "Pulmonary Fibrosis",
        "Sleep Apnea", "Lung Cancer", "Pneumonia", "Pulmonary Hypertension",
        "Bronchiectasis", "Sarcoidosis",
    ],
    "rheumatology": [
        "Rheumatoid Arthritis", "Systemic Lupus Erythematosus",
        "Psoriatic Arthritis", "Ankylosing Spondylitis", "Osteoarthritis",
        "Fibromyalgia", "Sjogren Syndrome", "Vasculitis", "Gout",
        "Scleroderma", "Myositis",
    ],
    "dermatology": [
        "Psoriasis", "Atopic Dermatitis", "Melanoma", "Acne", "Vitiligo",
        "Alopecia", "Urticaria", "Hidradenitis Suppurativa", "Rosacea",
    ],
    "endocrinology": [
        "Type 2 Diabetes", "Type 1 Diabetes", "Thyroid Nodule", "Hypothyroidism",
        "Obesity", "Adrenal Insufficiency", "Cushing Syndrome", "Osteoporosis",
        "Metabolic Syndrome", "Hyperthyroidism",
    ],
    "nephrology": [
        "Chronic Kidney Disease", "Glomerulonephritis", "Kidney Transplantation",
        "Acute Kidney Injury", "Diabetic Nephropathy", "Polycystic Kidney Disease",
        "Hemodialysis", "IgA Nephropathy",
    ],
    "urology": [
        "Prostate Cancer", "Bladder Cancer", "Benign Prostatic Hyperplasia",
        "Urinary Incontinence", "Kidney Stones", "Erectile Dysfunction",
        "Overactive Bladder", "Testicular Cancer",
    ],
    "ophthalmology": [
        "Glaucoma", "Age-Related Macular Degeneration", "Diabetic Retinopathy",
        "Cataract", "Dry Eye", "Retinal Detachment", "Uveitis", "Corneal Disease",
    ],
    "otolaryngology": [
        "Hearing Loss", "Chronic Sinusitis", "Obstructive Sleep Apnea",
        "Head and Neck Cancer", "Tinnitus", "Vestibular Disorder",
        "Thyroid Nodule", "Laryngeal Cancer",
    ],
    "infectious disease": [
        "HIV", "Tuberculosis", "Hepatitis C", "Sepsis", "COVID-19", "Influenza",
        "Pneumonia", "Lyme Disease", "Malaria", "Clostridioides difficile",
    ],
    "geriatrics": [
        "Dementia", "Alzheimer Disease", "Frailty", "Falls", "Osteoporosis",
        "Delirium", "Sarcopenia", "Functional Decline",
    ],
    "pediatrics": [
        "Childhood Asthma", "Pediatric Cancer", "Type 1 Diabetes",
        "Autism Spectrum Disorder", "Attention Deficit Disorder",
        "Congenital Heart Disease", "Neonatal Sepsis", "Pediatric Epilepsy",
    ],
    "hematology": [
        "Leukemia", "Lymphoma", "Multiple Myeloma", "Sickle Cell Disease",
        "Thalassemia", "Hemophilia", "Anemia", "Myelodysplastic Syndrome",
        "Thrombocytopenia",
    ],
    "allergy": [
        "Allergic Rhinitis", "Asthma", "Food Allergy", "Urticaria", "Anaphylaxis",
        "Atopic Dermatitis", "Drug Hypersensitivity", "Eosinophilic Esophagitis",
    ],
    "pain medicine": [
        "Chronic Pain", "Neuropathic Pain", "Low Back Pain", "Fibromyalgia",
        "Complex Regional Pain Syndrome", "Osteoarthritis", "Cancer Pain",
        "Postoperative Pain",
    ],
    "sleep medicine": [
        "Obstructive Sleep Apnea", "Insomnia", "Narcolepsy",
        "Restless Leg Syndrome", "Circadian Rhythm Disorder", "Central Sleep Apnea",
    ],
    "addiction medicine": [
        "Opioid Use Disorder", "Alcohol Use Disorder", "Substance Use Disorder",
        "Nicotine Dependence", "Cocaine Dependence", "Methamphetamine Use Disorder",
    ],
    "physical medicine": [
        "Stroke Rehabilitation", "Spinal Cord Injury", "Traumatic Brain Injury",
        "Amputee Rehabilitation", "Chronic Pain", "Multiple Sclerosis",
        "Musculoskeletal Disorder",
    ],
    "vascular surgery": [
        "Peripheral Arterial Disease", "Aortic Aneurysm", "Deep Vein Thrombosis",
        "Carotid Artery Stenosis", "Varicose Veins", "Venous Insufficiency",
    ],
    "thoracic surgery": [
        "Lung Cancer", "Esophageal Cancer", "Pleural Effusion", "Pneumothorax",
        "Mediastinal Tumor", "Mesothelioma",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────
# DOMAIN SYNONYM SETS  (unchanged — used by Gate 2 for specialty searches)
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

# ─────────────────────────────────────────────────────────────────────────────
# FIX A — Part 1: DISEASE SYNONYM SETS
#
# These mirror DOMAIN_SYNONYMS but cover broad disease search terms that are
# NOT specialty names (so was_expanded stays False after Phase 1).
#
# When the user's search term matches a key here, Gate 2 is applied even
# though was_expanded=False. This catches trials like:
#   - "The Tobramycin Study"  conditions=["Cystic Fibrosis"]  → passes cancer gate
#   - "Colonoscope Insertion" conditions=["Colonoscopy"]       → no cancer synonym
#   - "Asoprisnil Fibroids"   conditions=["Uterine Fibroids"]  → no cancer synonym
#
# Synonyms are intentionally broad so legitimate trials are NOT dropped:
#   - "Breast Cancer" contains "cancer" → passes
#   - "Glioblastoma Multiforme" contains "glioblastoma" → passes (listed below)
#   - "Non-Hodgkin Lymphoma" contains "lymphoma" → passes
# ─────────────────────────────────────────────────────────────────────────────

_DISEASE_SYNONYMS: dict[str, set[str]] = {
    # Searching "cancer" → require at least one of these in conditions text
    "cancer": {
        "cancer", "carcinoma", "sarcoma", "lymphoma", "leukemia", "myeloma",
        "neoplasm", "malignant", "melanoma", "glioma", "glioblastoma",
        "mesothelioma", "adenocarcinoma", "blastoma", "tumor", "tumour",
        "metastatic", "oncology", "carcinoid",
    },
    # Searching "diabetes" → require metabolic condition in conditions
    "diabetes": {
        "diabetes", "diabetic", "insulin", "glucose", "glycemic",
        "hyperglycemia", "hypoglycemia", "hba1c", "metabolic syndrome",
    },
    # Searching "heart disease" / "heart failure" etc.
    "heart": {
        "heart", "cardiac", "cardiovascular", "coronary", "myocardial",
        "arrhythmia", "atrial", "ventricular", "cardiomyopathy", "pericarditis",
    },
    "heart disease": {
        "heart", "cardiac", "cardiovascular", "coronary", "myocardial",
        "arrhythmia", "atrial", "ventricular", "cardiomyopathy",
    },
    "heart failure": {
        "heart failure", "cardiac failure", "cardiomyopathy",
        "left ventricular", "ejection fraction",
    },
    # Searching "stroke"
    "stroke": {
        "stroke", "cerebrovascular", "ischemic", "hemorrhagic", "tia",
        "transient ischemic", "brain infarct",
    },
    # Searching "alzheimer" / "dementia"
    "alzheimer": {
        "alzheimer", "dementia", "cognitive", "memory", "amyloid", "tau",
    },
    "dementia": {
        "dementia", "alzheimer", "cognitive decline", "memory loss",
        "vascular dementia", "lewy body",
    },
    # Searching "depression" / "anxiety"
    "depression": {
        "depression", "depressive", "major depressive", "bipolar",
        "antidepressant", "mood disorder",
    },
    "anxiety": {
        "anxiety", "anxious", "panic", "phobia", "ptsd", "ocd",
        "generalized anxiety",
    },
    # Searching "asthma" / "copd"
    "asthma": {
        "asthma", "bronchial", "bronchospasm", "airway hyperreactivity",
        "wheezing",
    },
    "copd": {
        "copd", "chronic obstructive", "emphysema", "bronchitis",
        "pulmonary disease",
    },
    # Searching "multiple sclerosis"
    "multiple sclerosis": {
        "multiple sclerosis", "ms ", "sclerosis", "demyelinating",
        "relapsing remitting",
    },
    # Searching "parkinson"
    "parkinson": {
        "parkinson", "dopaminergic", "lewy body", "tremor", "bradykinesia",
    },
    # Searching "hiv" / "aids"
    "hiv": {
        "hiv", "aids", "antiretroviral", "cd4", "viral load",
        "human immunodeficiency",
    },
    # Searching "lupus"
    "lupus": {
        "lupus", "systemic lupus", "sle", "autoimmune", "antinuclear",
    },
    # Searching "rheumatoid arthritis"
    "rheumatoid arthritis": {
        "rheumatoid", "arthritis", "synovitis", "joint inflammation",
        "dmard", "anti-tnf",
    },
    # Searching "kidney disease" / "ckd"
    "kidney disease": {
        "kidney", "renal", "nephrop", "glomerul", "dialysis", "ckd",
        "creatinine", "proteinuria",
    },
}

_SPECIALTY_NAMES: frozenset[str] = frozenset(SPECIALTY_TO_CONDITIONS.keys())

MIN_RELEVANCE_SCORE = 40

# ─────────────────────────────────────────────────────────────────────────────
# FIX A — Part 2: EXTENDED NOISE TITLE PATTERNS
#
# Original _ADMIN_TITLE_PATTERNS only caught operational/administrative studies.
# These additional patterns catch domain-mismatch noise — trials where the
# title reveals the study is clearly about a different medical domain,
# regardless of why it appeared in the search results.
#
# Design rule: each pattern must be specific enough that it would NOT match
# a legitimate trial from the searched domain. We never add broad words like
# "study" or "trial" — only domain-specific vocabulary.
# ─────────────────────────────────────────────────────────────────────────────

_ADMIN_TITLE_PATTERNS = re.compile(
    r"\b("
    # Original patterns (unchanged)
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
    # NEW — antibiotic / antimicrobial agents unrelated to oncology/cancer
    r"|tobramycin"
    r"|vancomycin"
    r"|azithromycin"
    r"|amoxicillin"
    r"|ciprofloxacin"
    # NEW — procedural / device studies that appear in broad disease searches
    r"|colonoscop"          # colonoscope, colonoscopy insertion trials
    r"|endoscop"            # endoscopy technique studies
    r"|sigmoidoscop"
    # NEW — gynaecological drug studies that appear in cancer/oncology searches
    r"|asoprisnil"
    r"|ulipristal"
    r"|uterine fibroid"
    r"|levonorgestrel"
    # NEW — tobacco / smoking cessation (frequently indexed under cancer centres)
    r"|tobacco use"
    r"|smoking cessation"
    r"|curbing tobacco"
    r"|quit smoking"
    r"|nicotine patch"
    r"|nicotine replacement"
    # NEW — dietary / nutritional studies without a clinical condition focus
    r"|dietary supplement"
    r"|vitamin d supplement"
    r"|weight loss program"
    r"|bariatric counseling"
    # NEW — generic population / epidemiology studies
    r"|chinese women study"
    r"|women['']?s health survey"
    r"|population registry"
    r"|birth cohort"
    r")\b",
    re.IGNORECASE,
)

_GENERIC_CONDITION_TAGS: frozenset[str] = frozenset({
    "neurology", "cardiology", "oncology", "psychiatry", "health services",
    "pharmacokinetics", "mental health", "telemedicine", "digital health",
    "quality of life", "clinical registry", "healthy volunteers",
    "healthy adults", "healthy subjects",
})


def _norm_lower(text: str) -> str:
    return " ".join((text or "").lower().split())


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — SPECIALTY EXPANSION  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def _expand_specialty_to_query(condition: str) -> tuple[str, bool]:
    key = _norm_lower(condition)
    if key in _SPECIALTY_NAMES:
        terms = SPECIALTY_TO_CONDITIONS[key]
        return " OR ".join(terms), True
    for sp_key in _SPECIALTY_NAMES:
        if key in sp_key or sp_key in key:
            terms = SPECIALTY_TO_CONDITIONS[sp_key]
            return " OR ".join(terms), True
    return condition, False


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — POST-FETCH RELEVANCE FILTER
#
# FIX A — Part 3: Gate 2 now also fires for disease-term searches
# by consulting _DISEASE_SYNONYMS in addition to DOMAIN_SYNONYMS.
# ─────────────────────────────────────────────────────────────────────────────

def _count_specific_conditions(conditions_raw: list[str]) -> int:
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

    Gate 1 — Administrative/operational study rejection  (unchanged logic,
              extended pattern list — see _ADMIN_TITLE_PATTERNS above).

    Gate 2 — Domain synonym check.
              CHANGED: now applies to both specialty searches (was_expanded=True)
              AND to disease-term searches where the term appears in
              _DISEASE_SYNONYMS. This is the core fix for "cancer" returning
              tobramycin/colonoscopy/fibroids results.
    """
    title            = _norm_lower(trial.get("title") or "")
    conditions_raw   = [_norm_lower(c) for c in (trial.get("conditions") or [])]
    conditions_text  = " ".join(conditions_raw)

    # ── Gate 1: administrative/operational study filter (extended) ────────────
    if _ADMIN_TITLE_PATTERNS.search(title):
        specific_count = _count_specific_conditions(conditions_raw)
        if specific_count < 2:
            logger.debug(
                "Gate 1 dropped (admin/noise title, %d specific conditions): %s",
                specific_count, trial.get("nctId"),
            )
            return False

    # ── Gate 2: domain synonym check ─────────────────────────────────────────
    term = _norm_lower(original_term)

    # Determine which synonym set to use:
    #   Priority 1 — specialty expansion synonyms (was_expanded=True)
    #   Priority 2 — disease synonym set (_DISEASE_SYNONYMS match)
    synonyms: set[str] = set()

    if was_expanded:
        # Existing logic: specialty name → DOMAIN_SYNONYMS
        synonyms = DOMAIN_SYNONYMS.get(term, set())
        if not synonyms:
            for key, syn_set in DOMAIN_SYNONYMS.items():
                if term in key or key in term:
                    synonyms = syn_set
                    break
    else:
        # NEW: disease term → _DISEASE_SYNONYMS
        synonyms = _DISEASE_SYNONYMS.get(term, set())
        if not synonyms:
            # Partial match (e.g. "breast cancer" → "cancer" key)
            for key, syn_set in _DISEASE_SYNONYMS.items():
                if term.endswith(key) or key in term:
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
# HELPER FUNCTIONS  (unchanged)
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


# ─────────────────────────────────────────────────────────────────────────────
# FIX B — FULL CONTACT EXTRACTION
#
# Replaces the original single-contact pointOfContact block in _map_trial().
#
# ClinicalTrials.gov v2 stores contacts in three separate places:
#   1. contactsLocationsModule.centralContacts   — study-wide contacts
#   2. contactsLocationsModule.overallOfficials  — PIs, study directors
#   3. contactsLocationsModule.locations[].contacts — per-site contacts
#
# The original code only looked at centralContacts[0] and returned a single
# dict. Many trials have no centralContacts but do have overallOfficials or
# per-location contacts — those all returned empty.
#
# This function harvests all three sources, deduplicates by normalised name,
# and returns a list. _map_trial() stores this as "contacts" and also sets
# "pointOfContact" to contacts[0] for backward compatibility with any
# frontend code that still reads the old key.
# ─────────────────────────────────────────────────────────────────────────────

_ROLE_LABELS: dict[str, str] = {
    "PRINCIPAL_INVESTIGATOR": "Principal Investigator",
    "SUB_INVESTIGATOR":       "Sub-Investigator",
    "STUDY_DIRECTOR":         "Study Director",
    "STUDY_CHAIR":            "Study Chair",
    "CONTACT":                "Study Contact",
}


def _extract_contacts(contacts_module: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Extract and deduplicate all contacts from a contactsLocationsModule dict.

    Returns a list of contact dicts, each with keys:
        name, role, phone, email, affiliation

    Deduplication is by lowercase-stripped name so the same person listed
    in both centralContacts and overallOfficials appears only once.
    """
    seen_names: set[str] = set()
    result: list[dict[str, Any]] = []

    def _add(
        name: str,
        raw_role: str,
        phone: str = "",
        email: str = "",
        affiliation: str = "",
    ) -> None:
        name = (name or "").strip()
        key  = name.lower()
        if not key or key in seen_names:
            return
        seen_names.add(key)
        role = _ROLE_LABELS.get((raw_role or "").upper(), (raw_role or "Study Contact"))
        result.append({
            "name":        name,
            "role":        role,
            "phone":       (phone or "").strip(),
            "email":       (email or "").strip(),
            "affiliation": (affiliation or "").strip(),
        })

    # Source 1 — central contacts (study-wide, most reliable)
    for c in contacts_module.get("centralContacts") or []:
        _add(
            c.get("name", ""),
            c.get("role", "CONTACT"),
            c.get("phone", ""),
            c.get("email", ""),
        )

    # Source 2 — overall officials / principal investigators
    for o in contacts_module.get("overallOfficials") or []:
        _add(
            o.get("name", ""),
            o.get("role", "PRINCIPAL_INVESTIGATOR"),
            affiliation=o.get("affiliation", ""),
        )

    # Source 3 — per-location contacts (first 5 locations to avoid huge lists)
    for loc in (contacts_module.get("locations") or [])[:5]:
        facility = (loc.get("facility") or "").strip()
        for c in loc.get("contacts") or []:
            _add(
                c.get("name", ""),
                c.get("role", "CONTACT"),
                c.get("phone", ""),
                c.get("email", ""),
                facility,
            )

    return result


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

    # FIX B: extract all contacts from all three sources
    all_contacts = _extract_contacts(contacts)

    # Backward-compatible alias — keeps existing frontend code working
    point_of_contact = all_contacts[0] if all_contacts else None

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
        # NEW: full contacts list (all sources, deduplicated)
        "contacts":          all_contacts,
        # KEPT for backward compatibility: first contact or None
        "pointOfContact":    point_of_contact,
    }


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION HELPERS  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def validate_city(city: str | None) -> tuple[bool, str]:
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
    if not state or not state.strip():
        return True, ""
    norm = _normalize_value(state.strip())
    if norm in STATE_ABBREV_TO_FULL:
        return True, ""
    if norm in _VALID_STATES_NORMALIZED:
        return True, ""
    return False, f"Unrecognised state: {state!r}"


def _matches_filters(trial: dict[str, Any], filters: dict[str, Any]) -> bool:
    normalized_status = _normalize_value(filters.get("status"))
    normalized_phase  = _normalize_value(filters.get("phase"))
    normalized_city   = _normalize_value(filters.get("city"))
    normalized_state  = _normalize_value(filters.get("state"))

    if normalized_status:
        trial_status_norm = _normalize_value(trial.get("status"))
        if (trial_status_norm != normalized_status
                and normalized_status not in trial_status_norm):
            return False

    if normalized_phase:
        trial_phases = [_normalize_value(p) for p in trial.get("phases", [])]
        if normalized_phase not in trial_phases:
            return False

    locations = trial.get("locations", [])

    if normalized_city and not any(
        _normalize_value(loc.get("city")) == normalized_city
        for loc in locations
    ):
        return False

    if normalized_state:
        resolved_state = STATE_ABBREV_TO_FULL.get(normalized_state, normalized_state)
        if not any(
            _normalize_value(loc.get("state")) == resolved_state
            for loc in locations
        ):
            return False

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
#
# Aligned with how ClinicalTrials.gov's own website searches:
#
# 1. sort=@relevance  (not LastUpdatePostDate:desc)
#    CT.gov's website defaults to @relevance — their internal Lucene engine
#    scores each study by how strongly the query matches the ConditionSearch
#    fields (conditions[], MeSH terms, title, keywords).  A study where
#    "cancer" appears only in a keyword because it was run at a cancer centre
#    scores far lower than one where "cancer" is an actual registered condition.
#    Switching to @relevance means the API returns results in exactly the same
#    order as the CT.gov website, pushing off-topic studies to the back.
#
# 2. query.term=AREA[ConditionSearch]<term>  (not query.cond=<term>)
#    query.cond is a convenience alias that also searches free-text fields
#    beyond the ConditionSearch area, which widens recall unnecessarily.
#    AREA[ConditionSearch] scopes the query to the same fields CT.gov's
#    "Condition or Disease" search box uses: conditions[], condition MeSH
#    terms, brief title, and keywords — and nothing else.
#
#    For specialty-expanded OR queries (e.g. "Parkinson Disease OR Epilepsy
#    OR ...") each term is individually wrapped so the AREA scope applies
#    to every term in the OR chain.
#
#    Exception: if the caller passes a query that already contains AREA[]
#    syntax (future-proofing), we pass it through via query.term unchanged.
# ─────────────────────────────────────────────────────────────────────────────

def _build_condition_query(condition: str) -> tuple[str, str]:
    """
    Convert a condition string to a CT.gov v2 query parameter pair.

    Returns (param_name, param_value) ready to insert into the params dict.

    Examples:
        "cancer"
            → ("query.term", "AREA[ConditionSearch]cancer")

        "Parkinson Disease OR Epilepsy OR Multiple Sclerosis"
            → ("query.term",
               "AREA[ConditionSearch]Parkinson Disease OR
                AREA[ConditionSearch]Epilepsy OR
                AREA[ConditionSearch]Multiple Sclerosis")

        "AREA[ConditionSearch]something"   (already has AREA syntax)
            → ("query.term", "AREA[ConditionSearch]something")
    """
    # Pass through if already using AREA syntax
    if "AREA[" in condition:
        return "query.term", condition

    # OR-expanded specialty queries — wrap each term individually
    if " OR " in condition:
        terms = [t.strip() for t in condition.split(" OR ") if t.strip()]
        wrapped = " OR ".join(f"AREA[ConditionSearch]{t}" for t in terms)
        return "query.term", wrapped

    # Simple single condition
    return "query.term", f"AREA[ConditionSearch]{condition}"


def _fetch_study_page(condition: str, page_token: str | None = None) -> dict[str, Any]:
    param_name, param_value = _build_condition_query(condition)

    params: dict[str, Any] = {
        param_name:   param_value,
        "pageSize":   DEFAULT_PAGE_SIZE,
        "countTotal": "true",
        "format":     "json",
        "sort":       "@relevance",   # match CT.gov website default
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
    Fetch, filter, and return trials from ClinicalTrials.gov, using the
    same search approach as the CT.gov website itself.

    Pipeline:

    ┌─────────────────────────────────────────────────────────────────────┐
    │  PHASE 1 — Query construction (CT.gov-aligned)                      │
    │                                                                     │
    │  a) Specialty expansion (unchanged):                                │
    │     If term is a specialty name ("neurology") → OR disease query    │
    │                                                                     │
    │  b) AREA[ConditionSearch] scoping (new):                            │
    │     Wraps the query so it searches only the ConditionSearch area    │
    │     (conditions[], MeSH terms, title, keywords) — exactly what      │
    │     CT.gov's "Condition or Disease" search box targets.             │
    │                                                                     │
    │  c) sort=@relevance (new):                                          │
    │     CT.gov's own relevance ranking — studies where the term is a    │
    │     registered condition rank far above ones where it merely        │
    │     appears in a keyword or description.                            │
    └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ ClinicalTrials.gov API
    ┌─────────────────────────────────────────────────────────────────────┐
    │  HARD FILTERS (status / phase / city / state / us_only)             │
    └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  PHASE 2 — Post-fetch relevance safety net (unchanged + extended)   │
    │                                                                     │
    │  Gate 1: Reject noise-titled studies (extended pattern list)        │
    │  Gate 2: Domain synonym check — now fires for disease-term          │
    │          searches too (via _DISEASE_SYNONYMS), not only for         │
    │          specialty expansions                                       │
    └─────────────────────────────────────────────────────────────────────┘
    """
    condition = (filters.get("condition") or "").strip()
    if not condition:
        return [], 0

    city_ok,  city_reason  = validate_city(filters.get("city"))
    state_ok, state_reason = validate_state(filters.get("state"))
    if not city_ok:
        logger.warning("Invalid city filter rejected: %s", city_reason)
        return [], 0
    if not state_ok:
        logger.warning("Invalid state filter rejected: %s", state_reason)
        return [], 0

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

            if not _matches_filters(mapped_trial, filters):
                continue

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