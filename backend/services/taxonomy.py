"""
Taxonomy service for medical specialties and classifications.
Manages taxonomy data from NUCC CSV or seed data.

v2 changes:
  - Added CONDITION_MAP: maps plain-language condition queries to NUCC specialties.
  - search() now checks condition map first, then falls back to specialty matching.
  - resolve() helper returns the best NUCC display string for a raw user query.

v3 changes:
  - _condition_map_lookup() now uses 4-pass matching (exact → prefix → substring
    key → token overlap) so multi-word trial conditions like "High Grade Sarcoma"
    correctly map to ["Medical Oncology", "Surgical Oncology"] even though the key
    stored in CONDITION_MAP is just "sarcoma" or "high grade sarcoma".
  - resolve_with_broader() now runs condition-map lookup first, then expands each
    hit through SPECIALTY_HIERARCHY, and only includes broader terms that actually
    exist in the loaded NUCC taxonomy. This prevents phantom NPPES queries like
    taxonomy_description=Oncology (not a real NUCC code) from silently returning
    zero results.
"""

import csv
import io
import logging
import threading
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

from services.http_client import http_client

NUCC_CSV_URL = "https://www.nucc.org/images/stories/CSV/nucc_taxonomy_250.csv"

# Global state
_taxonomy_entries: List[Dict] = []
_taxonomy_loaded = False
_taxonomy_source = "none"
_taxonomy_lock = threading.Lock()

# ─────────────────────────────────────────────
#  CONDITION → SPECIALTY MAP
# ─────────────────────────────────────────────

CONDITION_MAP: Dict[str, List[str]] = {
    # ── Neurological ──────────────────────────────────────────────────────────
    "alzheimer":              ["Geriatric Medicine", "Neurology"],
    "alzheimers":             ["Geriatric Medicine", "Neurology"],
    "alzheimer's":            ["Geriatric Medicine", "Neurology"],
    "dementia":               ["Geriatric Medicine", "Neurology", "Psychiatry"],
    "memory loss":            ["Neurology", "Geriatric Medicine"],
    "migraine":               ["Neurology", "Pain Medicine"],
    "migraines":              ["Neurology", "Pain Medicine"],
    "headache":               ["Neurology", "Pain Medicine"],
    "cluster headache":       ["Neurology", "Pain Medicine"],
    "epilepsy":               ["Neurology"],
    "seizure":                ["Neurology"],
    "seizures":               ["Neurology"],
    "parkinson":              ["Neurology"],
    "parkinsons":             ["Neurology"],
    "parkinson's":            ["Neurology"],
    "ms":                     ["Neurology"],
    "multiple sclerosis":     ["Neurology"],
    "stroke":                 ["Neurology", "Interventional Cardiology"],
    "stroke recovery":        ["Physical Medicine & Rehabilitation", "Neurology"],
    "neuropathy":             ["Neurology", "Pain Medicine"],
    "nerve pain":             ["Pain Medicine", "Neurology"],
    "tremor":                 ["Neurology"],
    "als":                    ["Neurology"],
    "brain tumor":            ["Neurology", "Neurosurgery"],
    "concussion":             ["Neurology", "Sports Medicine"],
    "tbi":                    ["Neurology", "Physical Medicine & Rehabilitation"],
    "brain injury":           ["Neurology", "Physical Medicine & Rehabilitation"],
    "bell's palsy":           ["Neurology"],
    "meningitis":             ["Neurology", "Infectious Disease"],
    "encephalitis":           ["Neurology", "Infectious Disease"],
    "cerebral palsy":         ["Neurology", "Physical Medicine & Rehabilitation"],
    "hydrocephalus":          ["Neurosurgery", "Neurology"],
    "dizziness":              ["Neurology", "Otolaryngology"],
    "vertigo":                ["Otolaryngology", "Neurology"],
    "tinnitus":               ["Otolaryngology", "Neurology"],
    "glioma":                 ["Neurology", "Neurosurgery", "Medical Oncology"],
    "glioblastoma":           ["Neurology", "Neurosurgery", "Medical Oncology"],
    "meningioma":             ["Neurosurgery", "Neurology"],
    # ── Cardiac ───────────────────────────────────────────────────────────────
    "heart":                  ["Cardiovascular Disease", "Interventional Cardiology"],
    "heart disease":          ["Cardiovascular Disease", "Interventional Cardiology"],
    "heart attack":           ["Cardiovascular Disease", "Interventional Cardiology"],
    "heart failure":          ["Cardiovascular Disease"],
    "heart valve":            ["Cardiac Surgery", "Cardiovascular Disease"],
    "heart transplant":       ["Cardiac Surgery"],
    "arrhythmia":             ["Cardiovascular Disease"],
    "atrial fibrillation":    ["Cardiovascular Disease"],
    "afib":                   ["Cardiovascular Disease"],
    "hypertension":           ["Cardiovascular Disease", "Internal Medicine", "Family Medicine"],
    "high blood pressure":    ["Cardiovascular Disease", "Internal Medicine"],
    "cholesterol":            ["Cardiovascular Disease", "Internal Medicine", "Family Medicine"],
    "chest pain":             ["Cardiovascular Disease", "Emergency Medicine"],
    "pacemaker":              ["Cardiovascular Disease"],
    "coronary bypass":        ["Cardiac Surgery", "Cardiovascular Disease"],
    "cabg":                   ["Cardiac Surgery"],
    "bypass surgery":         ["Cardiac Surgery", "Cardiovascular Disease"],
    "open heart surgery":     ["Cardiac Surgery"],
    "shortness of breath":    ["Pulmonary Disease", "Cardiovascular Disease"],
    "fluid retention":        ["Nephrology", "Cardiovascular Disease"],
    "swelling":               ["Nephrology", "Cardiovascular Disease", "Vascular Surgery"],
    "pulmonary hypertension":  ["Pulmonary Disease", "Cardiovascular Disease"],
    "circulation":            ["Vascular Surgery", "Cardiovascular Disease"],
    # ── Endocrine / Metabolic ─────────────────────────────────────────────────
    "diabetes":               ["Endocrinology, Diabetes & Metabolism"],
    "diabetic":               ["Endocrinology, Diabetes & Metabolism"],
    "diabetic retinopathy":   ["Ophthalmology", "Endocrinology, Diabetes & Metabolism"],
    "thyroid":                ["Endocrinology, Diabetes & Metabolism"],
    "hypothyroid":            ["Endocrinology, Diabetes & Metabolism"],
    "hyperthyroid":           ["Endocrinology, Diabetes & Metabolism"],
    "obesity":                ["Endocrinology, Diabetes & Metabolism", "Family Medicine"],
    "weight loss":            ["Endocrinology, Diabetes & Metabolism", "Family Medicine"],
    "hormones":               ["Endocrinology, Diabetes & Metabolism"],
    "adrenal":                ["Endocrinology, Diabetes & Metabolism"],
    "pituitary":              ["Endocrinology, Diabetes & Metabolism"],
    "growth hormone":         ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "testosterone":           ["Endocrinology, Diabetes & Metabolism", "Urology"],
    "estrogen":               ["Endocrinology, Diabetes & Metabolism", "Obstetrics & Gynecology"],
    "metabolic syndrome":     ["Endocrinology, Diabetes & Metabolism"],
    "cushing":                ["Endocrinology, Diabetes & Metabolism"],
    "addison":                ["Endocrinology, Diabetes & Metabolism"],
    "hypoglycemia":           ["Endocrinology, Diabetes & Metabolism"],
    "insulin":                ["Endocrinology, Diabetes & Metabolism"],
    "pancreas":               ["Gastroenterology", "Endocrinology, Diabetes & Metabolism"],
    "osteoporosis":           ["Rheumatology", "Endocrinology, Diabetes & Metabolism", "Geriatric Medicine"],
    # ── Gastroenterology / GI ────────────────────────────────────────────────
    "gastro":                 ["Gastroenterology"],
    "ibs":                    ["Gastroenterology"],
    "crohn":                  ["Gastroenterology"],
    "crohns":                 ["Gastroenterology"],
    "crohn's":                ["Gastroenterology"],
    "crohns disease":         ["Gastroenterology"],
    "colitis":                ["Gastroenterology", "Colon & Rectal Surgery"],
    "ulcerative colitis":     ["Gastroenterology"],
    "colonoscopy":            ["Gastroenterology"],
    "acid reflux":            ["Gastroenterology"],
    "gerd":                   ["Gastroenterology"],
    "liver":                  ["Gastroenterology"],
    "hepatitis":              ["Gastroenterology", "Infectious Disease"],
    "fatty liver":            ["Gastroenterology"],
    "cirrhosis":              ["Gastroenterology"],
    "jaundice":               ["Gastroenterology"],
    "celiac":                 ["Gastroenterology"],
    "hemorrhoid":             ["Colon & Rectal Surgery", "Gastroenterology"],
    "hemorrhoids":            ["Colon & Rectal Surgery", "Gastroenterology"],
    "pancreatitis":           ["Gastroenterology"],
    "gallbladder":            ["General Surgery", "Gastroenterology"],
    "gallstones":             ["General Surgery", "Gastroenterology"],
    "bloating":               ["Gastroenterology"],
    "constipation":           ["Gastroenterology", "Family Medicine"],
    "diarrhea":               ["Gastroenterology", "Infectious Disease"],
    "nausea":                 ["Gastroenterology", "Family Medicine"],
    "swallowing":             ["Gastroenterology", "Otolaryngology"],
    "dysphagia":              ["Gastroenterology", "Otolaryngology"],
    "esophageal":             ["Thoracic Surgery", "Gastroenterology"],
    "esophagus":              ["Thoracic Surgery", "Gastroenterology"],
    # ── Pulmonary ─────────────────────────────────────────────────────────────
    "asthma":                 ["Pulmonary Disease", "Allergy & Immunology"],
    "copd":                   ["Pulmonary Disease"],
    "lung":                   ["Pulmonary Disease"],
    "emphysema":              ["Pulmonary Disease"],
    "sleep apnea":            ["Sleep Medicine", "Pulmonary Disease"],
    "snoring":                ["Sleep Medicine"],
    "insomnia":               ["Sleep Medicine", "Psychiatry"],
    "breathing":              ["Pulmonary Disease"],
    "pneumonia":              ["Pulmonary Disease", "Infectious Disease"],
    "bronchitis":             ["Pulmonary Disease", "Family Medicine"],
    "pulmonary fibrosis":     ["Pulmonary Disease"],
    "pleural effusion":       ["Pulmonary Disease", "Thoracic Surgery"],
    "cystic fibrosis":        ["Pulmonary Disease", "Pediatrics"],
    "wheezing":               ["Pulmonary Disease", "Allergy & Immunology"],
    "interstitial lung":      ["Pulmonary Disease"],
    "pulmonary":              ["Pulmonary Disease"],
    "respiratory":            ["Pulmonary Disease"],
    "covid":                  ["Infectious Disease", "Pulmonary Disease"],
    "tuberculosis":           ["Infectious Disease", "Pulmonary Disease"],
    "lung cancer":            ["Thoracic Surgery", "Medical Oncology", "Pulmonary Disease"],
    "pleural":                ["Thoracic Surgery", "Pulmonary Disease"],
    "mesothelioma":           ["Thoracic Surgery", "Medical Oncology"],
    # ── Mental Health ─────────────────────────────────────────────────────────
    "depression":             ["Psychiatry"],
    "anxiety":                ["Psychiatry"],
    "mental":                 ["Psychiatry"],
    "bipolar":                ["Psychiatry"],
    "schizophrenia":          ["Psychiatry"],
    "adhd":                   ["Psychiatry", "Pediatrics"],
    "addiction":              ["Addiction Medicine", "Psychiatry"],
    "substance":              ["Addiction Medicine"],
    "opioid":                 ["Addiction Medicine", "Pain Medicine"],
    "alcohol":                ["Addiction Medicine"],
    "eating disorder":        ["Psychiatry"],
    "anorexia":               ["Psychiatry"],
    "bulimia":                ["Psychiatry"],
    "binge eating":           ["Psychiatry"],
    "ptsd":                   ["Psychiatry"],
    "ocd":                    ["Psychiatry"],
    "autism":                 ["Psychiatry", "Pediatrics"],
    "asperger":               ["Psychiatry", "Pediatrics"],
    "panic attack":           ["Psychiatry"],
    "panic disorder":         ["Psychiatry"],
    "phobia":                 ["Psychiatry"],
    "social anxiety":         ["Psychiatry"],
    "borderline personality": ["Psychiatry"],
    "personality disorder":   ["Psychiatry"],
    "mania":                  ["Psychiatry"],
    "psychosis":              ["Psychiatry"],
    "hallucinations":         ["Psychiatry"],
    "grief":                  ["Psychiatry"],
    "trauma":                 ["Psychiatry", "Emergency Medicine"],
    "postpartum depression":  ["Psychiatry", "Obstetrics & Gynecology"],
    # ── Musculoskeletal / Pain ────────────────────────────────────────────────
    "arthritis":              ["Rheumatology", "Orthopaedic Surgery"],
    "rheumatoid":             ["Rheumatology"],
    "lupus":                  ["Rheumatology"],
    "fibromyalgia":           ["Rheumatology", "Pain Medicine"],
    "gout":                   ["Rheumatology"],
    "sjogren":                ["Rheumatology"],
    "scleroderma":            ["Rheumatology"],
    "vasculitis":             ["Rheumatology"],
    "myositis":               ["Rheumatology"],
    "polymyalgia":            ["Rheumatology"],
    "ankylosing spondylitis": ["Rheumatology"],
    "reactive arthritis":     ["Rheumatology"],
    "psoriatic arthritis":    ["Rheumatology", "Dermatology"],
    "raynaud":                ["Rheumatology", "Vascular Surgery"],
    "autoimmune":             ["Rheumatology", "Allergy & Immunology"],
    "back pain":              ["Pain Medicine", "Orthopaedic Surgery", "Physical Medicine & Rehabilitation"],
    "lower back pain":        ["Pain Medicine", "Orthopaedic Surgery"],
    "neck pain":              ["Pain Medicine", "Orthopaedic Surgery"],
    "sciatica":               ["Pain Medicine", "Orthopaedic Surgery", "Neurology"],
    "spine":                  ["Orthopaedic Surgery", "Neurosurgery"],
    "spinal":                 ["Orthopaedic Surgery", "Neurosurgery", "Pain Medicine"],
    "knee":                   ["Orthopaedic Surgery", "Sports Medicine"],
    "hip":                    ["Orthopaedic Surgery"],
    "shoulder":               ["Orthopaedic Surgery", "Sports Medicine"],
    "fracture":               ["Orthopaedic Surgery"],
    "stress fracture":        ["Sports Medicine", "Orthopaedic Surgery"],
    "sports injury":          ["Sports Medicine", "Orthopaedic Surgery"],
    "tendon":                 ["Sports Medicine", "Orthopaedic Surgery"],
    "tendonitis":             ["Sports Medicine", "Orthopaedic Surgery"],
    "ligament":               ["Sports Medicine", "Orthopaedic Surgery"],
    "acl":                    ["Sports Medicine", "Orthopaedic Surgery"],
    "rotator cuff":           ["Sports Medicine", "Orthopaedic Surgery"],
    "shin splints":           ["Sports Medicine"],
    "sprain":                 ["Sports Medicine", "Orthopaedic Surgery"],
    "athletic":               ["Sports Medicine"],
    "joint":                  ["Rheumatology", "Orthopaedic Surgery"],
    "scoliosis":              ["Orthopaedic Surgery", "Neurosurgery"],
    "chronic pain":           ["Pain Medicine"],
    "pain management":        ["Pain Medicine"],
    "phantom pain":           ["Pain Medicine"],
    "crps":                   ["Pain Medicine"],
    "complex regional pain":  ["Pain Medicine"],
    "epidural":               ["Anesthesiology"],
    "nerve block":            ["Anesthesiology", "Pain Medicine"],
    "pain block":             ["Anesthesiology", "Pain Medicine"],
    # ── Cancer / Oncology ─────────────────────────────────────────────────────
    "cancer":                 ["Medical Oncology", "Hematology & Oncology"],
    "solid tumor":            ["Medical Oncology", "Hematology & Oncology"],
    "malignant neoplasm":     ["Medical Oncology", "Hematology & Oncology"],
    "malignant":              ["Medical Oncology", "Hematology & Oncology"],
    "neoplasm":               ["Medical Oncology", "Hematology & Oncology"],
    "neoplasia":              ["Medical Oncology", "Hematology & Oncology"],
    "tumor":                  ["Medical Oncology", "Radiation Oncology"],
    "oncology":               ["Medical Oncology", "Hematology & Oncology"],
    "leukemia":               ["Hematology & Oncology"],
    "lymphoma":               ["Hematology & Oncology"],
    "myeloma":                ["Hematology & Oncology"],
    "multiple myeloma":       ["Hematology & Oncology"],
    "blood cancer":           ["Hematology & Oncology"],
    "bone marrow":            ["Hematology & Oncology"],
    "sickle cell":            ["Hematology & Oncology"],
    "hemophilia":             ["Hematology & Oncology"],
    "thalassemia":            ["Hematology & Oncology"],
    "platelets":              ["Hematology & Oncology"],
    "breast cancer":          ["Medical Oncology", "Radiation Oncology"],
    "prostate cancer":        ["Medical Oncology", "Urology"],
    "cervical cancer":        ["Obstetrics & Gynecology", "Medical Oncology"],
    "ovarian cancer":         ["Obstetrics & Gynecology", "Medical Oncology"],
    "kidney cancer":          ["Urology", "Medical Oncology"],
    "skin cancer":            ["Dermatology", "Medical Oncology"],
    "head and neck cancer":   ["Otolaryngology", "Medical Oncology"],
    "colorectal cancer":      ["Gastroenterology", "Medical Oncology", "Colon & Rectal Surgery"],
    "colon cancer":           ["Gastroenterology", "Medical Oncology", "Colon & Rectal Surgery"],
    "rectal cancer":          ["Colon & Rectal Surgery", "Medical Oncology"],
    "pancreatic cancer":      ["Gastroenterology", "Medical Oncology"],
    "bladder cancer":         ["Urology", "Medical Oncology"],
    "thyroid cancer":         ["Endocrinology, Diabetes & Metabolism", "Medical Oncology"],
    "hepatocellular":         ["Gastroenterology", "Medical Oncology"],
    "cholangiocarcinoma":     ["Gastroenterology", "Medical Oncology"],
    # ── Sarcoma (mapped explicitly for physician discovery) ───────────────────
    "sarcoma":                ["Medical Oncology", "Orthopaedic Surgery"],
    "soft tissue sarcoma":    ["Medical Oncology", "General Surgery"],
    "bone sarcoma":           ["Medical Oncology", "Orthopaedic Surgery"],
    "ewing sarcoma":          ["Medical Oncology", "Orthopaedic Surgery"],
    "rhabdomyosarcoma":       ["Medical Oncology", "Pediatrics"],
    "high grade sarcoma":     ["Medical Oncology", "General Surgery"],
    "low grade sarcoma":      ["Medical Oncology", "Orthopaedic Surgery"],
    "leiomyosarcoma":         ["Medical Oncology", "General Surgery"],
    "liposarcoma":            ["Medical Oncology", "General Surgery"],
    "osteosarcoma":           ["Medical Oncology", "Orthopaedic Surgery"],
    "synovial sarcoma":       ["Medical Oncology", "Orthopaedic Surgery"],
    "angiosarcoma":           ["Medical Oncology", "Vascular Surgery"],
    "chondrosarcoma":         ["Medical Oncology", "Orthopaedic Surgery"],
    # ── Other oncology terms ──────────────────────────────────────────────────
    "chemotherapy":           ["Medical Oncology"],
    "radiation":              ["Radiation Oncology"],
    "biopsy":                 ["Medical Oncology"],
    "breast reconstruction":  ["Plastic Surgery", "Medical Oncology"],
    "immunotherapy":          ["Medical Oncology", "Allergy & Immunology"],
    "targeted therapy":       ["Medical Oncology"],
    "clinical trial":         ["Medical Oncology"],
    "carcinoma":              ["Medical Oncology"],
    "adenocarcinoma":         ["Medical Oncology"],
    "squamous cell":          ["Dermatology", "Medical Oncology"],
    "malignant":              ["Medical Oncology"],
    "metastatic":             ["Medical Oncology"],
    "metastasis":             ["Medical Oncology"],
    "neoplasm":               ["Medical Oncology"],
    "neoplasia":              ["Medical Oncology"],
    # ── Kidney / Urology ──────────────────────────────────────────────────────
    "kidney":                 ["Nephrology", "Urology"],
    "kidney disease":         ["Nephrology"],
    "kidney stone":           ["Urology", "Nephrology"],
    "kidney stones":          ["Urology", "Nephrology"],
    "dialysis":               ["Nephrology"],
    "ckd":                    ["Nephrology"],
    "renal failure":          ["Nephrology"],
    "acute kidney injury":    ["Nephrology"],
    "aki":                    ["Nephrology"],
    "chronic kidney":         ["Nephrology"],
    "proteinuria":            ["Nephrology"],
    "urinary":                ["Urology"],
    "bladder":                ["Urology"],
    "prostate":               ["Urology"],
    "incontinence":           ["Urology"],
    "overactive bladder":     ["Urology"],
    "erectile dysfunction":   ["Urology"],
    "ed":                     ["Urology"],
    "vasectomy":              ["Urology"],
    "testicular":             ["Urology"],
    "uti":                    ["Urology", "Infectious Disease"],
    "urinary tract infection": ["Urology", "Infectious Disease"],
    "sexual health":          ["Urology", "Obstetrics & Gynecology"],
    "male health":            ["Urology"],
    # ── Women's Health ────────────────────────────────────────────────────────
    "gynecology":             ["Obstetrics & Gynecology"],
    "pregnancy":              ["Obstetrics & Gynecology"],
    "prenatal":               ["Obstetrics & Gynecology"],
    "fertility":              ["Obstetrics & Gynecology"],
    "menopause":              ["Obstetrics & Gynecology", "Endocrinology, Diabetes & Metabolism"],
    "pcos":                   ["Obstetrics & Gynecology", "Endocrinology, Diabetes & Metabolism"],
    "endometriosis":          ["Obstetrics & Gynecology"],
    "ovarian cyst":           ["Obstetrics & Gynecology"],
    "uterine fibroids":       ["Obstetrics & Gynecology"],
    "fibroids":               ["Obstetrics & Gynecology"],
    "irregular periods":      ["Obstetrics & Gynecology"],
    "heavy periods":          ["Obstetrics & Gynecology"],
    "birth control":          ["Obstetrics & Gynecology", "Family Medicine"],
    "miscarriage":            ["Obstetrics & Gynecology"],
    "postpartum":             ["Obstetrics & Gynecology", "Psychiatry"],
    "womens health":          ["Obstetrics & Gynecology"],
    "women's health":         ["Obstetrics & Gynecology"],
    "mammogram":              ["Diagnostic Radiology"],
    # ── Eyes / Ophthalmology ──────────────────────────────────────────────────
    "eye":                    ["Ophthalmology"],
    "vision":                 ["Ophthalmology"],
    "glaucoma":               ["Ophthalmology"],
    "cataract":               ["Ophthalmology"],
    "cataracts":              ["Ophthalmology"],
    "dry eyes":               ["Ophthalmology"],
    "macular degeneration":   ["Ophthalmology"],
    "retina":                 ["Ophthalmology"],
    "conjunctivitis":         ["Ophthalmology"],
    "pink eye":               ["Ophthalmology"],
    "lazy eye":               ["Ophthalmology"],
    "strabismus":             ["Ophthalmology"],
    "cornea":                 ["Ophthalmology"],
    # ── ENT / Otolaryngology ──────────────────────────────────────────────────
    "ent":                    ["Otolaryngology"],
    "ear":                    ["Otolaryngology"],
    "nose":                   ["Otolaryngology"],
    "throat":                 ["Otolaryngology"],
    "sinus":                  ["Otolaryngology", "Allergy & Immunology"],
    "tonsils":                ["Otolaryngology"],
    "tonsillitis":            ["Otolaryngology"],
    "adenoids":               ["Otolaryngology", "Pediatrics"],
    "deviated septum":        ["Otolaryngology"],
    "hoarseness":             ["Otolaryngology"],
    "voice":                  ["Otolaryngology"],
    "larynx":                 ["Otolaryngology"],
    "balance":                ["Otolaryngology", "Neurology"],
    "hearing":                ["Audiologist"],
    "hearing loss":           ["Audiologist"],
    # ── Allergy / Immunology ──────────────────────────────────────────────────
    "allergy":                ["Allergy & Immunology"],
    "allergies":              ["Allergy & Immunology"],
    "food allergy":           ["Allergy & Immunology"],
    "drug allergy":           ["Allergy & Immunology"],
    "latex allergy":          ["Allergy & Immunology"],
    "anaphylaxis":            ["Allergy & Immunology", "Emergency Medicine"],
    "hay fever":              ["Allergy & Immunology"],
    "rhinitis":               ["Allergy & Immunology", "Otolaryngology"],
    "hives":                  ["Dermatology", "Allergy & Immunology"],
    "immune":                 ["Allergy & Immunology", "Infectious Disease"],
    "immunology":             ["Allergy & Immunology"],
    "immunodeficiency":       ["Allergy & Immunology", "Infectious Disease"],
    # ── Dermatology / Skin ────────────────────────────────────────────────────
    "skin":                   ["Dermatology"],
    "acne":                   ["Dermatology"],
    "rash":                   ["Dermatology"],
    "eczema":                 ["Dermatology", "Allergy & Immunology"],
    "psoriasis":              ["Dermatology", "Rheumatology"],
    "melanoma":               ["Dermatology", "Medical Oncology"],
    "warts":                  ["Dermatology"],
    "moles":                  ["Dermatology"],
    "hair loss":              ["Dermatology"],
    "alopecia":               ["Dermatology"],
    "vitiligo":               ["Dermatology"],
    "shingles":               ["Dermatology", "Infectious Disease"],
    "scar":                   ["Plastic Surgery", "Dermatology"],
    # ── Infection / Blood ─────────────────────────────────────────────────────
    "hiv":                    ["Infectious Disease"],
    "aids":                   ["Infectious Disease"],
    "infection":              ["Infectious Disease"],
    "anemia":                 ["Hematology & Oncology"],
    "blood disorder":         ["Hematology & Oncology"],
    "clotting":               ["Hematology & Oncology"],
    "blood clot":             ["Vascular Surgery", "Hematology & Oncology"],
    "deep vein thrombosis":   ["Vascular Surgery", "Hematology & Oncology"],
    "dvt":                    ["Vascular Surgery", "Hematology & Oncology"],
    "tb":                     ["Infectious Disease"],
    "lyme":                   ["Infectious Disease"],
    "lyme disease":           ["Infectious Disease"],
    "malaria":                ["Infectious Disease"],
    "sepsis":                 ["Infectious Disease"],
    "mrsa":                   ["Infectious Disease"],
    "fungal infection":       ["Infectious Disease", "Dermatology"],
    "flu":                    ["Infectious Disease", "Family Medicine"],
    "influenza":              ["Infectious Disease", "Family Medicine"],
    "mononucleosis":          ["Infectious Disease"],
    "mono":                   ["Infectious Disease"],
    "std":                    ["Infectious Disease"],
    "sti":                    ["Infectious Disease"],
    "sexually transmitted":   ["Infectious Disease"],
    # ── Vascular Surgery ──────────────────────────────────────────────────────
    "vascular":               ["Vascular Surgery"],
    "aortic aneurysm":        ["Vascular Surgery"],
    "aneurysm":               ["Vascular Surgery"],
    "peripheral artery":      ["Vascular Surgery"],
    "peripheral vascular":    ["Vascular Surgery"],
    "varicose veins":         ["Vascular Surgery"],
    "carotid":                ["Vascular Surgery", "Neurology"],
    # ── Thoracic Surgery ──────────────────────────────────────────────────────
    "thoracic":               ["Thoracic Surgery"],
    "chest surgery":          ["Thoracic Surgery", "Cardiac Surgery"],
    "mediastinum":            ["Thoracic Surgery"],
    # ── General Surgery ───────────────────────────────────────────────────────
    "appendicitis":           ["General Surgery"],
    "appendix":               ["General Surgery"],
    "hernia":                 ["General Surgery"],
    "abscess":                ["General Surgery", "Infectious Disease"],
    "wound":                  ["Emergency Medicine", "General Surgery"],
    # ── Plastic Surgery ───────────────────────────────────────────────────────
    "plastic surgery":        ["Plastic Surgery"],
    "cosmetic surgery":       ["Plastic Surgery"],
    "reconstruction":         ["Plastic Surgery"],
    "burn":                   ["Plastic Surgery", "Emergency Medicine"],
    "burns":                  ["Plastic Surgery", "Emergency Medicine"],
    "cleft palate":           ["Plastic Surgery", "Pediatrics"],
    "rhinoplasty":            ["Plastic Surgery"],
    # ── Anesthesiology ────────────────────────────────────────────────────────
    "anesthesia":             ["Anesthesiology"],
    "anesthesiology":         ["Anesthesiology"],
    "sedation":               ["Anesthesiology"],
    # ── Diagnostic Radiology ──────────────────────────────────────────────────
    "mri":                    ["Diagnostic Radiology"],
    "ct scan":                ["Diagnostic Radiology"],
    "x-ray":                  ["Diagnostic Radiology"],
    "ultrasound":             ["Diagnostic Radiology"],
    "imaging":                ["Diagnostic Radiology"],
    # ── Emergency Medicine ────────────────────────────────────────────────────
    "emergency":              ["Emergency Medicine"],
    "overdose":               ["Emergency Medicine", "Addiction Medicine"],
    "poisoning":              ["Emergency Medicine"],
    "laceration":             ["Emergency Medicine"],
    # ── Physical Medicine & Rehabilitation ────────────────────────────────────
    "physical therapy":       ["Physical Medicine & Rehabilitation"],
    "rehabilitation":         ["Physical Medicine & Rehabilitation"],
    "rehab":                  ["Physical Medicine & Rehabilitation"],
    "occupational therapy":   ["Physical Medicine & Rehabilitation"],
    "mobility":               ["Physical Medicine & Rehabilitation"],
    "prosthetics":            ["Physical Medicine & Rehabilitation"],
    # ── Pediatrics ────────────────────────────────────────────────────────────
    "child":                  ["Pediatrics"],
    "children":               ["Pediatrics"],
    "infant":                 ["Pediatrics"],
    "baby":                   ["Pediatrics"],
    "newborn":                ["Pediatrics"],
    "pediatric":              ["Pediatrics"],
    "vaccination":            ["Pediatrics", "Family Medicine"],
    "vaccine":                ["Pediatrics", "Family Medicine"],
    "developmental delay":    ["Pediatrics"],
    "growth disorder":        ["Pediatrics", "Endocrinology, Diabetes & Metabolism"],
    # ── Allied Health / Non-Physician Providers ───────────────────────────────
    "dentist":                ["Dentist"],
    "dental":                 ["Dentist"],
    "teeth":                  ["Dentist"],
    "tooth":                  ["Dentist"],
    "dental hygiene":         ["Dental Hygienist"],
    "root canal":             ["Endodontics"],
    "oral surgery":           ["Oral and Maxillofacial Surgery"],
    "jaw":                    ["Oral and Maxillofacial Surgery"],
    "braces":                 ["Orthodontics and Dentofacial Orthopedics"],
    "orthodontics":           ["Orthodontics and Dentofacial Orthopedics"],
    "pediatric dentist":      ["Pediatric Dentistry"],
    "gum disease":            ["Periodontics"],
    "gums":                   ["Periodontics"],
    "dentures":               ["Prosthodontics"],
    "implants":               ["Prosthodontics"],
    "foot":                   ["Podiatrist"],
    "feet":                   ["Podiatrist"],
    "podiatry":               ["Podiatrist"],
    "bunion":                 ["Podiatrist"],
    "plantar fasciitis":      ["Podiatrist"],
    "pharmacist":             ["Pharmacist"],
    "pharmacy":               ["Pharmacist"],
    "medication":             ["Pharmacist", "Family Medicine"],
    "midwife":                ["Certified Nurse Midwife"],
    "nurse anesthetist":      ["Certified Registered Nurse Anesthetist"],
    "nurse practitioner":     ["Nurse Practitioner"],
    "np":                     ["Nurse Practitioner"],
    "physician assistant":    ["Physician Assistant"],
    "pa":                     ["Physician Assistant"],
    "optometrist":            ["Optometrist"],
    "eye exam":               ["Optometrist"],
    "glasses":                ["Optometrist"],
    "contacts":               ["Optometrist"],
    "chiropractor":           ["Chiropractor"],
    "chiropractic":           ["Chiropractor"],
    "adjustment":             ["Chiropractor"],
    "physical therapist":     ["Physical Therapist"],
    "occupational therapist": ["Occupational Therapist"],
    "speech therapy":         ["Speech-Language Pathologist"],
    "speech language":        ["Speech-Language Pathologist"],
    "stuttering":             ["Speech-Language Pathologist"],
    "therapist":              ["Counselor", "Psychologist", "Marriage & Family Therapist"],
    "counselor":              ["Counselor"],
    "counseling":             ["Counselor"],
    "psychologist":           ["Psychologist"],
    "psychology":             ["Psychologist"],
    "social worker":          ["Social Worker, Clinical"],
    "dietitian":              ["Dietitian, Registered"],
    "nutritionist":           ["Dietitian, Registered"],
    "nutrition":              ["Dietitian, Registered"],
    "respiratory therapist":  ["Respiratory Therapist"],
    "urgent care":            ["Urgent Care"],
    "walk in":                ["Urgent Care"],
    "walk-in":                ["Urgent Care"],
    "ambulatory":             ["Ambulatory Surgical"],
    # ── General / Geriatric / Primary Care ────────────────────────────────────
    "geriatric":              ["Geriatric Medicine"],
    "elderly":                ["Geriatric Medicine"],
    "aging":                  ["Geriatric Medicine"],
    "senior":                 ["Geriatric Medicine"],
    "primary care":           ["Family Medicine", "Internal Medicine", "General Practice"],
    "general":                ["General Practice", "Family Medicine"],
    "preventive":             ["Family Medicine", "Internal Medicine"],
    "checkup":                ["Family Medicine", "Internal Medicine", "General Practice"],
}


# ─────────────────────────────────────────────
#  SPECIALTY HIERARCHY MAP (broader categories)
# ─────────────────────────────────────────────
# Maps specific/niche specialties to their broader parent categories.
# IMPORTANT: only list broader terms that actually appear in _SEED_TAXONOMY
# as display names — otherwise resolve() returns the raw string and NPPES
# gets a query it cannot match.

SPECIALTY_HIERARCHY: Dict[str, List[str]] = {
    # Oncology sub-specialties expand to each other so OR search casts a wide net
    "Medical Oncology":              ["Hematology & Oncology", "Radiation Oncology"],
    "Surgical Oncology":             ["Medical Oncology", "General Surgery"],
    "Radiation Oncology":            ["Medical Oncology"],
    "Hematology & Oncology":         ["Medical Oncology"],

    # Neurology / Neurosurgery
    "Neurology":                     ["Neurosurgery"],
    "Neurosurgery":                  ["Neurology"],

    # Cardiac
    "Cardiovascular Disease":        ["Interventional Cardiology", "Cardiac Surgery"],
    "Interventional Cardiology":     ["Cardiovascular Disease"],
    "Cardiac Surgery":               ["Cardiovascular Disease", "Thoracic Surgery"],

    # Orthopaedic
    "Orthopaedic Surgery":           ["Sports Medicine"],
    "Sports Medicine":               ["Orthopaedic Surgery", "Physical Medicine & Rehabilitation"],

    # GI
    "Gastroenterology":              ["Colon & Rectal Surgery"],
    "Colon & Rectal Surgery":        ["Gastroenterology", "General Surgery"],

    # Pulmonary
    "Pulmonary Disease":             ["Sleep Medicine", "Thoracic Surgery"],
    "Sleep Medicine":                ["Pulmonary Disease"],

    # Endocrine
    "Endocrinology, Diabetes & Metabolism": ["Internal Medicine"],

    # Rheumatology
    "Rheumatology":                  ["Internal Medicine", "Allergy & Immunology"],

    # Nephrology
    "Nephrology":                    ["Internal Medicine"],

    # Psychiatry
    "Psychiatry":                    ["Addiction Medicine"],
    "Addiction Medicine":            ["Psychiatry", "Pain Medicine"],

    # Pain
    "Pain Medicine":                 ["Anesthesiology", "Physical Medicine & Rehabilitation"],

    # Geriatrics
    "Geriatric Medicine":            ["Internal Medicine", "Family Medicine"],

    # Thoracic
    "Thoracic Surgery":              ["Cardiac Surgery", "General Surgery"],

    # Vascular
    "Vascular Surgery":              ["General Surgery"],

    # Infectious Disease
    "Infectious Disease":            ["Internal Medicine"],

    # Urology
    "Urology":                       ["General Surgery"],

    # OB/GYN
    "Obstetrics & Gynecology":       ["General Surgery"],
}

# Reverse mapping built at module load (not used directly in resolution
# but available for future tooling / admin endpoints)
_BROADER_TO_SPECIFIC: Dict[str, List[str]] = {}
for _specific, _broader_list in SPECIALTY_HIERARCHY.items():
    for _broader in _broader_list:
        _BROADER_TO_SPECIFIC.setdefault(_broader, [])
        if _specific not in _BROADER_TO_SPECIFIC[_broader]:
            _BROADER_TO_SPECIFIC[_broader].append(_specific)


# ─────────────────────────────────────────────
#  SEED TAXONOMY
# ─────────────────────────────────────────────

_SEED_TAXONOMY = [
    ("Allopathic & Osteopathic Physicians", "Addiction Medicine"),
    ("Allopathic & Osteopathic Physicians", "Allergy & Immunology"),
    ("Allopathic & Osteopathic Physicians", "Anesthesiology"),
    ("Allopathic & Osteopathic Physicians", "Cardiac Surgery"),
    ("Allopathic & Osteopathic Physicians", "Cardiovascular Disease"),
    ("Allopathic & Osteopathic Physicians", "Colon & Rectal Surgery"),
    ("Allopathic & Osteopathic Physicians", "Dermatology"),
    ("Allopathic & Osteopathic Physicians", "Diagnostic Radiology"),
    ("Allopathic & Osteopathic Physicians", "Emergency Medicine"),
    ("Allopathic & Osteopathic Physicians", "Endocrinology, Diabetes & Metabolism"),
    ("Allopathic & Osteopathic Physicians", "Family Medicine"),
    ("Allopathic & Osteopathic Physicians", "Gastroenterology"),
    ("Allopathic & Osteopathic Physicians", "General Practice"),
    ("Allopathic & Osteopathic Physicians", "General Surgery"),
    ("Allopathic & Osteopathic Physicians", "Geriatric Medicine"),
    ("Allopathic & Osteopathic Physicians", "Hematology & Oncology"),
    ("Allopathic & Osteopathic Physicians", "Infectious Disease"),
    ("Allopathic & Osteopathic Physicians", "Internal Medicine"),
    ("Allopathic & Osteopathic Physicians", "Interventional Cardiology"),
    ("Allopathic & Osteopathic Physicians", "Medical Oncology"),
    ("Allopathic & Osteopathic Physicians", "Nephrology"),
    ("Allopathic & Osteopathic Physicians", "Neurology"),
    ("Allopathic & Osteopathic Physicians", "Neurosurgery"),
    ("Allopathic & Osteopathic Physicians", "Obstetrics & Gynecology"),
    ("Allopathic & Osteopathic Physicians", "Ophthalmology"),
    ("Allopathic & Osteopathic Physicians", "Orthopaedic Surgery"),
    ("Allopathic & Osteopathic Physicians", "Otolaryngology"),
    ("Allopathic & Osteopathic Physicians", "Pain Medicine"),
    ("Allopathic & Osteopathic Physicians", "Pediatrics"),
    ("Allopathic & Osteopathic Physicians", "Physical Medicine & Rehabilitation"),
    ("Allopathic & Osteopathic Physicians", "Plastic Surgery"),
    ("Allopathic & Osteopathic Physicians", "Psychiatry"),
    ("Allopathic & Osteopathic Physicians", "Pulmonary Disease"),
    ("Allopathic & Osteopathic Physicians", "Radiation Oncology"),
    ("Allopathic & Osteopathic Physicians", "Rheumatology"),
    ("Allopathic & Osteopathic Physicians", "Sleep Medicine"),
    ("Allopathic & Osteopathic Physicians", "Sports Medicine"),
    ("Allopathic & Osteopathic Physicians", "Thoracic Surgery"),
    ("Allopathic & Osteopathic Physicians", "Urology"),
    ("Allopathic & Osteopathic Physicians", "Vascular Surgery"),
    ("Dental Providers", "Dentist"),
    ("Dental Providers", "Dental Hygienist"),
    ("Dental Providers", "Endodontics"),
    ("Dental Providers", "Oral and Maxillofacial Surgery"),
    ("Dental Providers", "Orthodontics and Dentofacial Orthopedics"),
    ("Dental Providers", "Pediatric Dentistry"),
    ("Dental Providers", "Periodontics"),
    ("Dental Providers", "Prosthodontics"),
    ("Podiatric Medicine & Surgery Providers", "Podiatrist"),
    ("Pharmacy Service Providers", "Pharmacist"),
    ("Pharmacy Service Providers", "Clinical Pharmacy Specialist"),
    ("Nursing Service Providers", "Certified Nurse Midwife"),
    ("Nursing Service Providers", "Certified Registered Nurse Anesthetist"),
    ("Nursing Service Providers", "Clinical Nurse Specialist"),
    ("Nursing Service Providers", "Licensed Practical Nurse"),
    ("Nursing Service Providers", "Nurse Practitioner"),
    ("Nursing Service Providers", "Registered Nurse"),
    ("Physician Assistants & Advanced Practice Nursing Providers", "Physician Assistant"),
    ("Eye and Vision Services Providers", "Optometrist"),
    ("Chiropractic Providers", "Chiropractor"),
    ("Physical Medicine & Rehabilitation Providers", "Physical Therapist"),
    ("Physical Medicine & Rehabilitation Providers", "Occupational Therapist"),
    ("Respiratory, Developmental, Rehabilitative & Restorative Service Providers", "Respiratory Therapist"),
    ("Speech, Language and Hearing Service Providers", "Audiologist"),
    ("Speech, Language and Hearing Service Providers", "Speech-Language Pathologist"),
    ("Behavioral Health & Social Service Providers", "Counselor"),
    ("Behavioral Health & Social Service Providers", "Marriage & Family Therapist"),
    ("Behavioral Health & Social Service Providers", "Psychologist"),
    ("Behavioral Health & Social Service Providers", "Social Worker"),
    ("Behavioral Health & Social Service Providers", "Social Worker, Clinical"),
    ("Dietetic & Nutritional Service Providers", "Dietitian, Registered"),
    ("Emergency Medical Service Providers", "Emergency Medical Technician"),
    ("Emergency Medical Service Providers", "Paramedic"),
    ("Ambulatory Health Care Facilities", "Ambulatory Surgical"),
    ("Ambulatory Health Care Facilities", "Urgent Care"),
    ("Hospital", "General Acute Care Hospital"),
]

# Build a set of all valid seed display names for fast membership tests
_SEED_DISPLAY_NAMES: set = set()


def _build_entries(rows: List[tuple]) -> List[Dict]:
    out, seen = [], set()
    for classification, specialization in rows:
        c = (classification or "").strip()
        s = (specialization or "").strip()
        if not c:
            continue
        display = s if s else c
        if display in seen:
            continue
        seen.add(display)
        out.append({
            "classification": c,
            "specialization": s,
            "display": display,
            "search_text": f"{c} {s}".lower(),
        })
    return out


def _load_taxonomy_background() -> None:
    global _taxonomy_loaded, _taxonomy_source

    seed = _build_entries(_SEED_TAXONOMY)

    # Populate the seed display name set for resolve_with_broader guard
    global _SEED_DISPLAY_NAMES
    _SEED_DISPLAY_NAMES = {e["display"] for e in seed}

    with _taxonomy_lock:
        _taxonomy_entries[:] = seed
        _taxonomy_loaded = True
        _taxonomy_source = "seed"
    logger.info("Taxonomy seed ready: %d entries", len(seed))

    try:
        resp = http_client.get(NUCC_CSV_URL, timeout=30)
        resp.raise_for_status()
        reader = csv.DictReader(io.StringIO(resp.text))
        rows = [
            (r.get("Classification", "").strip(), r.get("Specialization", "").strip())
            for r in reader
            if r.get("Classification", "").strip()
        ]
        if rows:
            live = _build_entries(rows)
            # Update the display name set with live entries too
            _SEED_DISPLAY_NAMES = {e["display"] for e in live}
            with _taxonomy_lock:
                _taxonomy_entries[:] = live
                _taxonomy_source = "NUCC CSV"
            logger.info("NUCC CSV loaded: %d entries", len(live))
    except Exception as e:
        logger.warning("NUCC CSV fetch failed: %s — keeping seed", e)


def initialize() -> None:
    threading.Thread(target=_load_taxonomy_background, daemon=True, name="tax-loader").start()


# ─────────────────────────────────────────────
#  CORE LOOKUP FUNCTIONS
# ─────────────────────────────────────────────

def _entries_snapshot() -> List[Dict]:
    with _taxonomy_lock:
        return list(_taxonomy_entries)


def _norm(text: str) -> str:
    return " ".join((text or "").lower().split())


def _entry_result(entry: Dict) -> Dict:
    return {
        "display": entry["display"],
        "classification": entry["classification"],
    }


def _find_direct_taxonomy_match(q: str, entries: Optional[List[Dict]] = None) -> Optional[Dict]:
    """
    Prefer direct specialty matches before consulting the broader condition map.
    This preserves inputs like "Hematology & Oncology" and also handles longer
    live NUCC labels that begin with a shorter canonical specialty name.
    """
    q_norm = _norm(q)
    if not q_norm:
        return None

    snapshot = entries if entries is not None else _entries_snapshot()

    def _matches(entry: Dict, *, prefix: bool) -> bool:
        display = _norm(entry.get("display", ""))
        spec = _norm(entry.get("specialization", ""))
        if prefix:
            return display.startswith(q_norm) or spec.startswith(q_norm)
        return display == q_norm or spec == q_norm

    exact = [e for e in snapshot if _matches(e, prefix=False)]
    if exact:
        return min(exact, key=lambda e: len(_norm(e.get("display", ""))))

    prefixed = [e for e in snapshot if _matches(e, prefix=True)]
    if prefixed:
        return min(prefixed, key=lambda e: len(_norm(e.get("display", ""))))

    return None


def _condition_map_lookup(q: str) -> Optional[List[str]]:
    """
    Resolve a condition/specialty string to a list of NUCC specialty names
    via CONDITION_MAP using a 4-pass strategy:

      1. Exact match            — "high grade sarcoma" → direct key hit
      2. Prefix match           — q starts with a known key
      3. Substring key match    — a known key appears anywhere in q
                                  e.g. "metastatic soft tissue sarcoma" contains
                                  "soft tissue sarcoma"
      4. Token overlap          — any meaningful token (≥4 chars) in q matches
                                  the start of a key
                                  e.g. "sarcoma" token in q hits key "sarcoma"

    Longer / more specific keys are preferred at every pass to avoid over-broad
    matches (e.g. "cancer" when "breast cancer" also matches).
    """
    q_lower = q.lower().strip()
    if not q_lower:
        return None

    # Pass 1: exact
    if q_lower in CONDITION_MAP:
        return CONDITION_MAP[q_lower]

    # Pass 2: q starts with a known key (original prefix behaviour)
    prefix_candidates = [k for k in CONDITION_MAP if q_lower.startswith(k)]
    if prefix_candidates:
        return CONDITION_MAP[max(prefix_candidates, key=len)]

    # Pass 3: a map key is a substring of q — prefer the most specific (longest) key
    if len(q_lower) >= 3:
        contained = [k for k in CONDITION_MAP if k in q_lower]
        if contained:
            return CONDITION_MAP[max(contained, key=len)]

    # Pass 4: token overlap — any word (≥4 chars) in q matches the start of a key
    tokens = [t for t in q_lower.split() if len(t) >= 4]
    best_key: Optional[str] = None
    best_len = 0
    for token in tokens:
        for key in CONDITION_MAP:
            if key.startswith(token) and len(key) > best_len:
                best_key = key
                best_len = len(key)
    if best_key:
        return CONDITION_MAP[best_key]

    return None


def search(q: str, limit: int = 12) -> List[Dict]:
    q_stripped = q.strip()
    if not q_stripped:
        return []

    entries = _entries_snapshot()

    direct = _find_direct_taxonomy_match(q_stripped, entries)
    if direct:
        return [_entry_result(direct)]

    condition_specialties = _condition_map_lookup(q_stripped)
    if condition_specialties:
        results = []
        seen: set = set()
        for specialty_name in condition_specialties:
            match = _find_direct_taxonomy_match(specialty_name, entries)
            if match and match["display"] not in seen:
                seen.add(match["display"])
                results.append(_entry_result(match))
        if results:
            return results[:limit]

    q_lower = q_stripped.lower()
    q_words = [w for w in q_lower.split() if len(w) >= 2]

    scored: List[tuple] = []
    seen_display: set = set()

    for e in entries:
        st = e["search_text"]
        d = e["display"]
        score = 0

        if q_lower == e["specialization"].lower():
            score = 100
        elif e["specialization"].lower().startswith(q_lower):
            score = 85
        elif e["classification"].lower().startswith(q_lower):
            score = 75
        elif q_lower in st:
            score = 60
        elif all(w in st for w in q_words):
            score = 50
        elif any(w in st for w in q_words):
            score = 30

        if score > 0 and d not in seen_display:
            seen_display.add(d)
            scored.append((score, d, e["classification"]))

    return [
        {"display": display, "classification": classification}
        for _, display, classification in sorted(scored, key=lambda x: (-x[0], x[1]))[:limit]
    ]


def resolve(q: str) -> str:
    """Return the best-matching NUCC display name for q, or q itself if no match."""
    matches = search(q, limit=1)
    return matches[0]["display"] if matches else q


def _resolve_with_broader_legacy(q: str) -> List[str]:
    """
    Resolve a condition/specialty query and return all NUCC-valid specialty
    names to use in an OR-based NPPES physician search.

    Resolution order:
      1. Try CONDITION_MAP via _condition_map_lookup() (4-pass matching).
         This handles raw trial conditions like "High Grade Sarcoma Phase 2"
         which map directly to ["Medical Oncology", "General Surgery"].
      2. For each mapped specialty, expand via SPECIALTY_HIERARCHY to pick up
         closely related specialties (e.g. Medical Oncology → Hematology &
         Oncology, Radiation Oncology).
      3. Only include a specialty if it actually resolves to a real NUCC entry
         in the currently loaded taxonomy — this prevents abstract labels like
         "Oncology" or "Cancer" (not real NUCC codes) from producing empty
         NPPES results.
      4. If no condition-map hit, try resolve() directly (handles cases where
         the user typed an actual specialty name like "Medical Oncology").
      5. Fallback: return [q] so callers always have something to query.

    Returns a deduplicated list preserving priority order.
    """
    if not q:
        return []

    all_specialties: List[str] = []

    def _add_if_valid(name: str) -> None:
        """
        Add `name` only if it resolves to a known NUCC entry AND it hasn't
        been added already.  This guards against abstract broader terms like
        "Oncology" that are not real NUCC taxonomy codes.
        """
        resolved = resolve(name)
        # resolve() returns the input unchanged when nothing matched in the
        # taxonomy.  We accept it only when the raw name itself IS a seed entry.
        is_in_taxonomy = (
            resolved != name                    # resolve found something different → real match
            or name in _SEED_DISPLAY_NAMES      # raw name is a confirmed seed entry
        )
        if is_in_taxonomy and resolved not in all_specialties:
            all_specialties.append(resolved)

    # ── Step 1: condition-map lookup (handles clinical-trial conditions) ──────
    condition_hits = _condition_map_lookup(q)
    if condition_hits:
        for specialty_name in condition_hits:
            _add_if_valid(specialty_name)
            # ── Step 2: expand each hit through the hierarchy ─────────────────
            for broader in SPECIALTY_HIERARCHY.get(specialty_name, []):
                _add_if_valid(broader)
        # Return early — condition map is authoritative for clinical conditions
        if all_specialties:
            return all_specialties

    # ── Step 3: direct specialty resolve (user typed "Medical Oncology" etc.) ──
    exact = resolve(q)
    if exact and exact not in all_specialties:
        all_specialties.append(exact)
        for broader in SPECIALTY_HIERARCHY.get(exact, []):
            _add_if_valid(broader)

    # ── Step 4: fallback ──────────────────────────────────────────────────────
    # FIX: Return empty list instead of raw input [q] to prevent NPPES from
    # returning ALL physicians (including dentists) when no valid specialty
    # is found. This ensures we only search for physicians when we have a
    # valid specialty filter.
    return all_specialties


def resolve_with_broader(q: str) -> List[str]:
    """
    Resolve a condition/specialty query and return NUCC-valid specialty names
    to use in an OR-based NPPES physician search.

    Resolution order:
      1. Preserve direct taxonomy specialty matches first.
      2. Otherwise use CONDITION_MAP for raw clinical conditions.
      3. Expand each accepted specialty through SPECIALTY_HIERARCHY.
      4. Fallback to fuzzy taxonomy matching only.

    Returns a deduplicated list preserving priority order.
    """
    if not q:
        return []

    all_specialties: List[str] = []

    def _add_if_valid(name: str) -> None:
        match = _find_direct_taxonomy_match(name)
        if not match:
            return
        resolved = match["display"]
        if resolved not in all_specialties:
            all_specialties.append(resolved)

    direct = _find_direct_taxonomy_match(q)
    if direct:
        exact = direct["display"]
        all_specialties.append(exact)
        for broader in SPECIALTY_HIERARCHY.get(exact, []):
            _add_if_valid(broader)
        return all_specialties

    condition_hits = _condition_map_lookup(q)
    if condition_hits:
        for specialty_name in condition_hits:
            _add_if_valid(specialty_name)
            for broader in SPECIALTY_HIERARCHY.get(specialty_name, []):
                _add_if_valid(broader)
        if all_specialties:
            return all_specialties

    matches = search(q, limit=1)
    if matches:
        exact = matches[0]["display"]
        _add_if_valid(exact)
        for broader in SPECIALTY_HIERARCHY.get(exact, []):
            _add_if_valid(broader)

    return all_specialties


# ─────────────────────────────────────────────
#  STATUS / INFO
# ─────────────────────────────────────────────

def is_loaded() -> bool:
    return _taxonomy_loaded


def source() -> str:
    return _taxonomy_source


def count() -> int:
    with _taxonomy_lock:
        return len(_taxonomy_entries)
