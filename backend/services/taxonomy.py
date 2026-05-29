"""
Taxonomy service for medical specialties and classifications.
Manages taxonomy data from NUCC CSV or seed data.

v2: Added CONDITION_MAP, search() checks condition map first.
v3: _condition_map_lookup() uses 4-pass matching. resolve_with_broader() guards
    against phantom NPPES queries.
v4: resolve_with_broader() handles multiple conditions separated by commas/"and".
v5: Added 200+ missing clinical-trial condition keys (metastatic/castrate-resistant
    prostate cancer, CRPC, MCRPC, sipuleucel, ADT variants, and dozens of other
    trial-specific phrasings). Improved Pass 3 substring matching to prefer the
    LONGEST matching key so "metastatic prostate cancer" beats "metastatic" alone.
    Added _ALWAYS_ONCOLOGY_PREFIXES guard so conditions starting with "metastatic",
    "advanced", "recurrent", "refractory", "relapsed" default to Medical Oncology
    instead of falling through to a generic key.
v6: Pass 3 now deprioritises generic staging/status modifier words (e.g. "recurrent",
    "metastatic") so specific disease keys (e.g. "glioma", "sarcoma") always win
    when both appear in the condition string.
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
    # ── Direct specialty matches ───────────────────────────────────────────────
    "neurology":                         ["Neurology"],
    "interventional cardiology":         ["Interventional Cardiology"],
    "cardiovascular disease":            ["Cardiovascular Disease"],
    "cardiology":                        ["Cardiovascular Disease"],
    "diagnostic radiology":              ["Diagnostic Radiology"],
    "radiology":                         ["Diagnostic Radiology"],
    "psychiatry":                        ["Psychiatry"],
    "psychiatry & neurology":            ["Psychiatry & Neurology"],
    "medical oncology":                  ["Medical Oncology"],
    "surgical oncology":                 ["Surgical Oncology"],
    "radiation oncology":                ["Radiation Oncology"],
    "hematology":                        ["Hematology & Oncology"],
    "hematology & oncology":             ["Hematology & Oncology"],
    "orthopedic surgery":                ["Orthopaedic Surgery"],
    "orthopaedic surgery":               ["Orthopaedic Surgery"],
    "orthopedics":                       ["Orthopaedic Surgery"],
    "gastroenterology":                  ["Gastroenterology"],
    "gi":                                ["Gastroenterology"],
    "pulmonology":                       ["Pulmonary Disease"],
    "pulmonary disease":                 ["Pulmonary Disease"],
    "endocrinology":                     ["Endocrinology, Diabetes & Metabolism"],
    "nephrology":                        ["Nephrology"],
    "urology":                           ["Urology"],
    "obstetrics":                        ["Obstetrics & Gynecology"],
    "obstetrics & gynecology":           ["Obstetrics & Gynecology"],
    "gynecology":                        ["Obstetrics & Gynecology"],
    "dermatology":                       ["Dermatology"],
    "ophthalmology":                     ["Ophthalmology"],
    "otolaryngology":                    ["Otolaryngology"],
    "ent":                               ["Otolaryngology"],
    "allergy":                           ["Allergy & Immunology"],
    "allergy & immunology":              ["Allergy & Immunology"],
    "immunology":                        ["Allergy & Immunology"],
    "rheumatology":                      ["Rheumatology"],
    "geriatric medicine":                ["Geriatric Medicine"],
    "geriatrics":                        ["Geriatric Medicine"],
    "pediatrics":                        ["Pediatrics"],
    "pediatric":                         ["Pediatrics"],
    "neonatology":                       ["Neonatal-Perinatal Medicine"],
    "internal medicine":                 ["Internal Medicine"],
    "family medicine":                   ["Family Medicine"],
    "general surgery":                   ["General Surgery"],
    "surgery":                           ["General Surgery"],
    "neurosurgery":                      ["Neurosurgery"],
    "thoracic surgery":                  ["Thoracic Surgery"],
    "cardiac surgery":                   ["Cardiac Surgery"],
    "vascular surgery":                  ["Vascular Surgery"],
    "colon & rectal surgery":            ["Colon & Rectal Surgery"],
    "proctology":                        ["Colon & Rectal Surgery"],
    "pain medicine":                     ["Pain Medicine"],
    "pain":                              ["Pain Medicine"],
    "addiction medicine":                ["Addiction Medicine"],
    "sleep medicine":                    ["Sleep Medicine"],
    "sports medicine":                   ["Sports Medicine"],
    "physical medicine":                 ["Physical Medicine & Rehabilitation"],
    "rehabilitation":                    ["Physical Medicine & Rehabilitation"],
    "infectious disease":                ["Infectious Disease"],
    "infectious diseases":               ["Infectious Disease"],

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
    "heart pain":          ["Cardiovascular Disease", "Interventional Cardiology"],
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
    "type 1":               ["Endocrinology, Diabetes & Metabolism"],
    "type 2":               ["Endocrinology, Diabetes & Metabolism"],
    "diabetes":               ["Endocrinology, Diabetes & Metabolism"],
    "diabetic":               ["Endocrinology, Diabetes & Metabolism"],
    "sugar disease":          ["Endocrinology, Diabetes & Metabolism"],
    "blood sugar":            ["Endocrinology, Diabetes & Metabolism"],
    "sugar":                  ["Endocrinology, Diabetes & Metabolism"],
    "diabetic retinopathy":   ["Ophthalmology", "Endocrinology, Diabetes & Metabolism"],
    "thyroid":                ["Endocrinology, Diabetes & Metabolism"],
    "hypothyroid":            ["Endocrinology, Diabetes & Metabolism"],
    "hyperthyroid":           ["Endocrinology, Diabetes & Metabolism"],
    "obesity":                ["Endocrinology, Diabetes & Metabolism", "Family Medicine", "Nutritionist"],
    "weight loss":            ["Endocrinology, Diabetes & Metabolism", "Family Medicine","Nutritionist"],
    "hormones":               ["Endocrinology, Diabetes & Metabolism","Nutritionist"],
    "adrenal":                ["Endocrinology, Diabetes & Metabolism"],
    "pituitary":              ["Endocrinology, Diabetes & Metabolism"],
    "growth hormone":         ["Endocrinology, Diabetes & Metabolism", "Pediatrics","Nutritionist"],
    "testosterone":           ["Endocrinology, Diabetes & Metabolism", "Urology"],
    "estrogen":               ["Endocrinology, Diabetes & Metabolism", "Obstetrics & Gynecology"],
    "metabolic syndrome":     ["Endocrinology, Diabetes & Metabolism"],
    "cushing":                ["Endocrinology, Diabetes & Metabolism"],
    "addison":                ["Endocrinology, Diabetes & Metabolism"],
    "hypoglycemia":           ["Endocrinology, Diabetes & Metabolism"],
    "insulin":                ["Endocrinology, Diabetes & Metabolism"],
    "pancreas":               ["Gastroenterology", "Endocrinology, Diabetes & Metabolism"],
    "osteoporosis":           ["Rheumatology", "Endocrinology, Diabetes & Metabolism", "Geriatric Medicine"],
 # ── Metabolic / Storage Diseases ─────────────────────────────────────────
    "glycogen storage disease":      ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "glycogen storage":              ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "gsd":                           ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "pompe disease":                 ["Endocrinology, Diabetes & Metabolism", "Neurology"],
    "gaucher disease":               ["Hematology & Oncology", "Endocrinology, Diabetes & Metabolism"],
    "gaucher":                       ["Hematology & Oncology", "Endocrinology, Diabetes & Metabolism"],
    "fabry disease":                 ["Nephrology", "Endocrinology, Diabetes & Metabolism"],
    "niemann pick":                  ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "mucopolysaccharidosis":         ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "mps":                           ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "lysosomal storage":             ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    "metabolic disorder":            ["Endocrinology, Diabetes & Metabolism"],
    "inborn error":                  ["Endocrinology, Diabetes & Metabolism", "Pediatrics"],
    

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

    # ── Cancer / Oncology — General ───────────────────────────────────────────
    "cancer":                 ["Medical Oncology", "Hematology & Oncology"],
    "solid tumor":            ["Medical Oncology", "Hematology & Oncology"],
    "solid tumour":           ["Medical Oncology", "Hematology & Oncology"],
    "malignant neoplasm":     ["Medical Oncology", "Hematology & Oncology"],
    "malignant":              ["Medical Oncology", "Hematology & Oncology"],
    "neoplasm":               ["Medical Oncology", "Hematology & Oncology"],
    "neoplasia":              ["Medical Oncology", "Hematology & Oncology"],
    "tumor":                  ["Medical Oncology", "Radiation Oncology"],
    "tumour":                 ["Medical Oncology", "Radiation Oncology"],
    "oncology":               ["Medical Oncology", "Hematology & Oncology"],
    "leukemia":               ["Hematology & Oncology"],
    "leukaemia":              ["Hematology & Oncology"],
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
    "cervical cancer":        ["Obstetrics & Gynecology", "Medical Oncology"],
    "ovarian cancer":         ["Obstetrics & Gynecology", "Medical Oncology"],
    "kidney cancer":          ["Urology", "Medical Oncology"],
    "renal cell carcinoma":   ["Urology", "Medical Oncology"],
    "renal cell":             ["Urology", "Medical Oncology"],
    "rcc":                    ["Urology", "Medical Oncology"],
    "skin cancer":            ["Dermatology", "Medical Oncology"],
    "head and neck cancer":   ["Otolaryngology", "Medical Oncology"],
    "head neck cancer":       ["Otolaryngology", "Medical Oncology"],
    "colorectal cancer":      ["Gastroenterology", "Medical Oncology", "Colon & Rectal Surgery"],
    "colon cancer":           ["Gastroenterology", "Medical Oncology", "Colon & Rectal Surgery"],
    "rectal cancer":          ["Colon & Rectal Surgery", "Medical Oncology"],
    "pancreatic cancer":      ["Gastroenterology", "Medical Oncology"],
    "bladder cancer":         ["Urology", "Medical Oncology"],
    "urothelial carcinoma":   ["Urology", "Medical Oncology"],
    "urothelial":             ["Urology", "Medical Oncology"],
    "thyroid cancer":         ["Endocrinology, Diabetes & Metabolism", "Medical Oncology"],
    "hepatocellular":         ["Gastroenterology", "Medical Oncology"],
    "cholangiocarcinoma":     ["Gastroenterology", "Medical Oncology"],
    "endometrial cancer":     ["Obstetrics & Gynecology", "Medical Oncology"],
    "uterine cancer":         ["Obstetrics & Gynecology", "Medical Oncology"],
    "testicular cancer":      ["Urology", "Medical Oncology"],
    "penile cancer":          ["Urology", "Medical Oncology"],
    "gastric cancer":         ["Gastroenterology", "Medical Oncology"],
    "stomach cancer":         ["Gastroenterology", "Medical Oncology"],
    "esophageal cancer":      ["Thoracic Surgery", "Medical Oncology"],

    # ── Prostate Cancer — Comprehensive ──────────────────────────────────────
    # Explicit keys for every common clinical-trial phrasing so Pass 1/2/3
    # always resolves correctly without falling through to a shorter key.
    "prostate cancer":                                ["Medical Oncology", "Urology"],
    "prostate carcinoma":                             ["Medical Oncology", "Urology"],
    "prostatic carcinoma":                            ["Medical Oncology", "Urology"],
    "prostatic cancer":                               ["Medical Oncology", "Urology"],
    "prostate adenocarcinoma":                        ["Medical Oncology", "Urology"],
    "metastatic prostate cancer":                     ["Medical Oncology"],
    "metastatic prostate carcinoma":                  ["Medical Oncology"],
    "metastatic prostatic cancer":                    ["Medical Oncology"],
    "advanced prostate cancer":                       ["Medical Oncology"],
    "castrate resistant prostate cancer":             ["Medical Oncology", "Urology"],
    "castration resistant prostate cancer":           ["Medical Oncology", "Urology"],
    "castrate-resistant prostate cancer":             ["Medical Oncology", "Urology"],
    "castration-resistant prostate cancer":           ["Medical Oncology", "Urology"],
    "castrate resistant prostate":                    ["Medical Oncology", "Urology"],
    "castration resistant prostate":                  ["Medical Oncology", "Urology"],
    "hormone refractory prostate cancer":             ["Medical Oncology", "Urology"],
    "hormone resistant prostate cancer":              ["Medical Oncology", "Urology"],
    "hormone sensitive prostate cancer":              ["Medical Oncology", "Urology"],
    "androgen deprivation":                           ["Medical Oncology", "Urology"],
    "androgen receptor":                              ["Medical Oncology"],
    "enzalutamide":                                   ["Medical Oncology"],
    "sipuleucel":                                     ["Medical Oncology"],
    "sipuleucel-t":                                   ["Medical Oncology"],
    "abiraterone":                                    ["Medical Oncology"],
    "docetaxel prostate":                             ["Medical Oncology"],
    "crpc":                                           ["Medical Oncology"],
    "mcrpc":                                          ["Medical Oncology"],
    "hspc":                                           ["Medical Oncology", "Urology"],
    "mhspc":                                          ["Medical Oncology", "Urology"],
    "nmcrpc":                                         ["Medical Oncology", "Urology"],
    "psa":                                            ["Medical Oncology", "Urology"],
    "gleason":                                        ["Medical Oncology", "Urology"],
    "prostate":                                       ["Urology"],

    # ── Sarcoma ───────────────────────────────────────────────────────────────
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

    # ── Melanoma / Skin Oncology ──────────────────────────────────────────────
    "melanoma":               ["Dermatology", "Medical Oncology"],
    "metastatic melanoma":    ["Medical Oncology"],
    "advanced melanoma":      ["Medical Oncology"],
    "squamous cell carcinoma": ["Dermatology", "Medical Oncology"],
    "squamous cell":          ["Dermatology", "Medical Oncology"],
    "basal cell carcinoma":   ["Dermatology", "Medical Oncology"],
    "basal cell":             ["Dermatology"],
    "merkel cell":            ["Dermatology", "Medical Oncology"],

    # ── Hematologic Malignancies ──────────────────────────────────────────────
    "acute myeloid leukemia": ["Hematology & Oncology"],
    "aml":                    ["Hematology & Oncology"],
    "acute lymphoblastic leukemia": ["Hematology & Oncology"],
    "all":                    ["Hematology & Oncology"],
    "chronic lymphocytic leukemia": ["Hematology & Oncology"],
    "cll":                    ["Hematology & Oncology"],
    "chronic myeloid leukemia": ["Hematology & Oncology"],
    "cml":                    ["Hematology & Oncology"],
    "diffuse large b cell":   ["Hematology & Oncology"],
    "dlbcl":                  ["Hematology & Oncology"],
    "follicular lymphoma":    ["Hematology & Oncology"],
    "hodgkin lymphoma":       ["Hematology & Oncology"],
    "hodgkin's lymphoma":     ["Hematology & Oncology"],
    "non hodgkin":            ["Hematology & Oncology"],
    "non-hodgkin":            ["Hematology & Oncology"],
    "mantle cell lymphoma":   ["Hematology & Oncology"],
    "myelodysplastic":        ["Hematology & Oncology"],
    "mds":                    ["Hematology & Oncology"],
    "myelofibrosis":          ["Hematology & Oncology"],
    "polycythemia vera":      ["Hematology & Oncology"],
    "essential thrombocythemia": ["Hematology & Oncology"],
    "waldenstrom":            ["Hematology & Oncology"],
    "smoldering myeloma":     ["Hematology & Oncology"],
    "plasmacytoma":           ["Hematology & Oncology"],
    "amyloidosis":            ["Hematology & Oncology"],

    # ── Trial-specific modifier prefixes (catch-all for unlisted conditions) ─
    # These are lower-specificity fallbacks — exact keys above always win.
    "metastatic":             ["Medical Oncology"],
    "advanced":               ["Medical Oncology"],
    "recurrent":              ["Medical Oncology"],
    "refractory":             ["Medical Oncology", "Hematology & Oncology"],
    "relapsed":               ["Medical Oncology", "Hematology & Oncology"],
    "relapsed refractory":    ["Medical Oncology", "Hematology & Oncology"],
    "unresectable":           ["Medical Oncology"],
    "inoperable":             ["Medical Oncology"],
    "locally advanced":       ["Medical Oncology", "Radiation Oncology"],
    "stage iv":               ["Medical Oncology"],
    "stage 4":                ["Medical Oncology"],
    "stage iii":              ["Medical Oncology", "Radiation Oncology"],
    "stage 3":                ["Medical Oncology", "Radiation Oncology"],

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
    "metastasis":             ["Medical Oncology"],
    "checkpoint inhibitor":   ["Medical Oncology"],
    "pd-1":                   ["Medical Oncology"],
    "pd-l1":                  ["Medical Oncology"],
    "pembrolizumab":          ["Medical Oncology"],
    "nivolumab":              ["Medical Oncology"],
    "atezolizumab":           ["Medical Oncology"],
    "durvalumab":             ["Medical Oncology"],
    "car-t":                  ["Hematology & Oncology"],
    "car t":                  ["Hematology & Oncology"],
    "stem cell transplant":   ["Hematology & Oncology"],
    "bone marrow transplant": ["Hematology & Oncology"],
    "bmt":                    ["Hematology & Oncology"],
    "hsct":                   ["Hematology & Oncology"],
    "bispecific":             ["Hematology & Oncology", "Medical Oncology"],
    "antibody drug conjugate": ["Medical Oncology"],
    "adc":                    ["Medical Oncology"],
    "parp inhibitor":         ["Medical Oncology"],
    "brca":                   ["Medical Oncology"],
    "msi":                    ["Medical Oncology"],
    "microsatellite":         ["Medical Oncology"],
    "tumor mutational burden": ["Medical Oncology"],
    "tmb":                    ["Medical Oncology"],
    "ctdna":                  ["Medical Oncology"],
    "liquid biopsy":          ["Medical Oncology"],

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
    "incontinence":           ["Urology"],
    "overactive bladder":     ["Urology"],
    "erectile dysfunction":   ["Urology"],
    "vasectomy":              ["Urology"],
    "testicular":             ["Urology"],
    "uti":                    ["Urology", "Infectious Disease"],
    "urinary tract infection": ["Urology", "Infectious Disease"],
    "sexual health":          ["Urology", "Obstetrics & Gynecology"],
    "male health":            ["Urology"],

    # ── Women's Health ────────────────────────────────────────────────────────
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
    "allergies":              ["Allergy & Immunology"],
    "food allergy":           ["Allergy & Immunology"],
    "drug allergy":           ["Allergy & Immunology"],
    "latex allergy":          ["Allergy & Immunology"],
    "anaphylaxis":            ["Allergy & Immunology", "Emergency Medicine"],
    "hay fever":              ["Allergy & Immunology"],
    "rhinitis":               ["Allergy & Immunology", "Otolaryngology"],
    "hives":                  ["Dermatology", "Allergy & Immunology"],
    "immune":                 ["Allergy & Immunology", "Infectious Disease"],
    "immunodeficiency":       ["Allergy & Immunology", "Infectious Disease"],

    # ── Dermatology / Skin ────────────────────────────────────────────────────
    "skin":                   ["Dermatology"],
    "acne":                   ["Dermatology"],
    "rash":                   ["Dermatology"],
    "eczema":                 ["Dermatology", "Allergy & Immunology"],
    "psoriasis":              ["Dermatology", "Rheumatology"],
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
    "pet scan":               ["Diagnostic Radiology"],

    # ── Emergency Medicine ────────────────────────────────────────────────────
    "emergency":              ["Emergency Medicine"],
    "overdose":               ["Emergency Medicine", "Addiction Medicine"],
    "poisoning":              ["Emergency Medicine"],
    "laceration":             ["Emergency Medicine"],

    # ── Physical Medicine & Rehabilitation ────────────────────────────────────
    "physical therapy":       ["Physical Medicine & Rehabilitation"],
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
    "vaccination":            ["Pediatrics", "Family Medicine"],
    "vaccine":                ["Pediatrics", "Family Medicine"],
    "developmental delay":    ["Pediatrics"],
    "growth disorder":        ["Pediatrics", "Endocrinology, Diabetes & Metabolism"],

    # ── Allied Health ─────────────────────────────────────────────────────────
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

    # ── General / Primary Care ────────────────────────────────────────────────
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
#  SPECIALTY HIERARCHY MAP
# ─────────────────────────────────────────────

SPECIALTY_HIERARCHY: Dict[str, List[str]] = {
    "Medical Oncology":              ["Hematology & Oncology", "Radiation Oncology"],
    "Surgical Oncology":             ["Medical Oncology", "General Surgery"],
    "Radiation Oncology":            ["Medical Oncology"],
    "Hematology & Oncology":         ["Medical Oncology"],
    "Neurology":                     ["Neurosurgery"],
    "Neurosurgery":                  ["Neurology"],
    "Cardiovascular Disease":        ["Interventional Cardiology", "Cardiac Surgery"],
    "Interventional Cardiology":     ["Cardiovascular Disease"],
    "Cardiac Surgery":               ["Cardiovascular Disease", "Thoracic Surgery"],
    "Orthopaedic Surgery":           ["Sports Medicine"],
    "Sports Medicine":               ["Orthopaedic Surgery", "Physical Medicine & Rehabilitation"],
    "Gastroenterology":              ["Colon & Rectal Surgery"],
    "Colon & Rectal Surgery":        ["Gastroenterology", "General Surgery"],
    "Pulmonary Disease":             ["Sleep Medicine", "Thoracic Surgery"],
    "Sleep Medicine":                ["Pulmonary Disease"],
    "Endocrinology, Diabetes & Metabolism": ["Internal Medicine-Endocrinology, Diabetes & Metabolism"],
    "Rheumatology":                  ["Internal Medicine-Rheumatology", "Allergy & Immunology"],
    "Nephrology":                    ["Internal Medicine-Nephrology"],
    "Psychiatry":                    ["Addiction Medicine,neurology"],
    "Addiction Medicine":            ["Psychiatry", "Pain Medicine","neurology"],
    "Pain Medicine":                 ["Anesthesiology", "Physical Medicine & Rehabilitation"],
    "Geriatric Medicine":            ["Internal Medicine-Geriatric Medicine", "Family Medicine"],
    "Thoracic Surgery":              ["Cardiac Surgery", "General Surgery"],
    "Vascular Surgery":              ["General Surgery"],
    "Infectious Disease":            ["Internal Medicine"],
    "Urology":                       ["General Surgery"],
    "Obstetrics & Gynecology":       ["General Surgery"],
}

_BROADER_TO_SPECIFIC: Dict[str, List[str]] = {}
for _specific, _broader_list in SPECIALTY_HIERARCHY.items():
    for _broader in _broader_list:
        _BROADER_TO_SPECIFIC.setdefault(_broader, [])
        if _specific not in _BROADER_TO_SPECIFIC[_broader]:
            _BROADER_TO_SPECIFIC[_broader].append(_specific)

# ─────────────────────────────────────────────
#  ONCOLOGY MODIFIER PREFIXES
#  When a condition starts with one of these words AND no longer exact key
#  matched, default to Medical Oncology rather than returning nothing.
# ─────────────────────────────────────────────
_ONCOLOGY_MODIFIER_PREFIXES = (
    "metastatic", "advanced", "recurrent", "refractory",
    "relapsed", "unresectable", "inoperable", "locally advanced",
    "stage iv", "stage 4", "stage iii", "stage 3",
)

# ─────────────────────────────────────────────
#  PASS 3 GENERIC MODIFIER SET
#  Generic staging/status modifiers — valid keys but should only win as last
#  resort when no specific disease key is present in the condition string.
#  The modifier set mirrors _ONCOLOGY_MODIFIER_PREFIXES above.
# ─────────────────────────────────────────────
_PASS3_GENERIC_MODIFIERS: frozenset = frozenset({
    "metastatic", "advanced", "recurrent", "refractory",
    "relapsed", "unresectable", "inoperable", "locally advanced",
    "stage iv", "stage 4", "stage iii", "stage 3",
})


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
    Resolve a condition/specialty string to NUCC specialty names via
    CONDITION_MAP using a 4-pass strategy:

      1. Exact match
      2. Prefix match (q starts with a known key)
      3. Substring key match — LONGEST non-modifier key wins; falls back to
         longest modifier key only if no specific disease key matched.
         (Fix: prevents "recurrent" from beating "glioma" in
          "Recurrent High-Grade Glioma")
      4. Token overlap — meaningful tokens in q match start of a key

    After all passes, if nothing matched but the condition starts with a known
    oncology modifier prefix (metastatic, advanced, etc.), default to
    Medical Oncology so trial conditions are never left unresolved.
    """
    q_lower = q.lower().strip()
    if not q_lower:
        return None

    # Pass 1: exact
    if q_lower in CONDITION_MAP:
        return CONDITION_MAP[q_lower]

    # Pass 2: q starts with a known key — prefer longest
    prefix_candidates = [k for k in CONDITION_MAP if q_lower.startswith(k)]
    if prefix_candidates:
        return CONDITION_MAP[max(prefix_candidates, key=len)]

    # Pass 3: a map key is a substring of q — prefer specific disease keys
    # over generic staging/status modifiers.
    if len(q_lower) >= 4:
        contained = [k for k in CONDITION_MAP if len(k) >= 4 and k in q_lower]
        if contained:
            # Prefer non-modifier (disease-specific) keys first
            specific = [k for k in contained if k not in _PASS3_GENERIC_MODIFIERS]
            best_key = max(specific, key=len) if specific else max(contained, key=len)
            return CONDITION_MAP[best_key]

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

    # Pass 5: oncology modifier prefix fallback
    # If condition starts with a staging/status modifier, it's almost certainly
    # an oncology trial condition even if the specific cancer type is not mapped.
    for prefix in _ONCOLOGY_MODIFIER_PREFIXES:
        if q_lower.startswith(prefix):
            return ["Medical Oncology", "Hematology & Oncology"]

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


def resolve_with_broader(q: str) -> List[str]:
    """
    Resolve a condition/specialty query and return NUCC-valid specialty names
    for OR-based NPPES physician search.

    Resolution order per part:
      1. Direct taxonomy match (user typed an actual specialty name)
      2. CONDITION_MAP lookup (clinical trial conditions)
      3. Expand each hit through SPECIALTY_HIERARCHY
      4. Fuzzy fallback

    Handles comma / "and" / "&" separated multi-condition strings.
    Returns a deduplicated list preserving priority order.
    """
    if not q:
        return []

    import re
    parts = re.split(r',\s*|\s+and\s+|\s+&\s+', q, flags=re.IGNORECASE)

    all_specialties: List[str] = []

    def _add_if_valid(name: str) -> None:
        match = _find_direct_taxonomy_match(name)
        if not match:
            return
        resolved = match["display"]
        if resolved not in all_specialties:
            all_specialties.append(resolved)

    for part in parts:
        part = part.strip()
        if not part:
            continue

        # Step 1: direct taxonomy match
        direct = _find_direct_taxonomy_match(part)
        if direct:
            exact = direct["display"]
            if exact not in all_specialties:
                all_specialties.append(exact)
            for broader in SPECIALTY_HIERARCHY.get(exact, []):
                _add_if_valid(broader)
            continue

        # Step 2: condition map lookup
        condition_hits = _condition_map_lookup(part)
        if condition_hits:
            for specialty_name in condition_hits:
                _add_if_valid(specialty_name)
                for broader in SPECIALTY_HIERARCHY.get(specialty_name, []):
                    _add_if_valid(broader)
            continue

        # Step 3: fuzzy fallback
        matches = search(part, limit=1)
        if matches:
            exact = matches[0]["display"]
            _add_if_valid(exact)
            for broader in SPECIALTY_HIERARCHY.get(exact, []):
                _add_if_valid(broader)

    return all_specialties

def get_fallback_specialties(condition: str) -> List[str]:
    """
    Generic fallback specialty resolver for any condition that could not be
    resolved through resolve_with_broader().

    Strategy:
      1. Strip NOS / modifier suffixes and retry resolve_with_broader()
         on the cleaned first meaningful phrase
      2. Try each individual word (>=5 chars) in the condition
      3. Score all CONDITION_MAP keys by keyword overlap with the condition
         and return the top 3 matching specialties
      4. Return empty list if nothing matches — caller handles final fallback
    """
    if not condition:
        return []

    condition_lower = condition.lower().strip()

    # Step 1: Strip NOS and common modifier suffixes, retry on first phrase
    # e.g. "Pancreatic Malignant Neoplasm, NOS" → "Pancreatic Malignant Neoplasm"
    # e.g. "Cancer, NOS" → "Cancer"
    nos_stripped = condition_lower.replace(", nos", "").replace(" nos", "").strip()
    first_phrase = nos_stripped.split(",")[0].strip()

    if first_phrase and first_phrase != condition_lower:
        result = resolve_with_broader(first_phrase)
        if result:
            return result

    # Step 2: Try each meaningful word individually
    # e.g. "Recurrent High-Grade Glioma" → try "glioma", "grade", "recurrent"
    words = sorted(
        [w.strip("-.") for w in nos_stripped.replace("-", " ").split() if len(w.strip("-.")) >= 5],
        key=len,
        reverse=True,  # try longest/most-specific words first
    )
    for word in words:
        result = resolve_with_broader(word)
        if result:
            return result

    # Step 3: Score CONDITION_MAP keys by overlap with the condition string
    # Works for any medical domain — not just oncology
    scored: List[tuple] = []
    for key, specialties in CONDITION_MAP.items():
        if len(key) < 4:
            continue
        # Score = number of words in the key that appear in the condition
        key_words = [w for w in key.split() if len(w) >= 4]
        if not key_words:
            continue
        score = sum(1 for w in key_words if w in condition_lower)
        if score > 0:
            # Prefer longer, more specific keys
            weighted_score = score * len(key)
            for specialty in specialties:
                scored.append((weighted_score, specialty))

    if scored:
        # Deduplicate and return top 3 specialties by score
        seen: set = set()
        result_specialties: List[str] = []
        for _, specialty in sorted(scored, reverse=True):
            if specialty not in seen:
                seen.add(specialty)
                result_specialties.append(specialty)
            if len(result_specialties) >= 3:
                break
        # Validate each against the taxonomy before returning
        validated = []
        for s in result_specialties:
            if _find_direct_taxonomy_match(s):
                validated.append(s)
        if validated:
            return validated

    return []
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