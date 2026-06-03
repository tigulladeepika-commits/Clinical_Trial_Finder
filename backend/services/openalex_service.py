import httpx
import logging
import re

logger = logging.getLogger(__name__)

OPENALEX_URL = "https://api.openalex.org/authors"
HTTP_TIMEOUT = 12.0

# Comprehensive medical topic keywords for deriving research areas from paper titles
MEDICAL_TOPIC_KEYWORDS = {
    "heart failure":      "Heart Failure",
    "cardiac":            "Cardiology",
    "cardiovascular":     "Cardiovascular Medicine",
    "coronary":           "Coronary Artery Disease",
    "myocardial":         "Myocardial Disease",
    "arrhythmia":         "Cardiac Arrhythmia",
    "atrial fibrillation":"Atrial Fibrillation",
    "hypertension":       "Hypertension",
    "atherosclerosis":    "Atherosclerosis",
    "interventional":     "Interventional Cardiology",
    "catheter":           "Interventional Cardiology",
    "stent":              "Interventional Cardiology",
    "impella":            "Mechanical Circulatory Support",

    "cancer":             "Oncology",
    "tumor":              "Oncology",
    "oncology":           "Oncology",
    "chemotherapy":       "Medical Oncology",
    "immunotherapy":      "Immunotherapy",
    "checkpoint":         "Immunotherapy & Checkpoint Inhibitors",
    "trastuzumab":        "HER2-Targeted Therapy",
    "tyrosine kinase":    "Targeted Cancer Therapy",
    "leukemia":           "Hematologic Oncology",
    "lymphoma":           "Hematologic Oncology",
    "myeloma":            "Hematologic Oncology",
    "metastatic":         "Metastatic Cancer",
    "breast cancer":      "Breast Oncology",
    "lung cancer":        "Thoracic Oncology",
    "colorectal":         "Gastrointestinal Oncology",
    "everolimus":         "mTOR Inhibitor Therapy",
    "pertuzumab":         "HER2-Targeted Therapy",
    "ceramide":           "Cancer Biology",

    "stroke":             "Stroke & Cerebrovascular Disease",
    "neurology":          "Neurology",
    "alzheimer":          "Neurodegenerative Disease",
    "parkinson":          "Movement Disorders",
    "epilepsy":           "Epilepsy",
    "multiple sclerosis": "Multiple Sclerosis",

    "diabetes":           "Endocrinology & Diabetes",
    "kidney":             "Nephrology",
    "renal":              "Nephrology",
    "liver":              "Hepatology",
    "hepatic":            "Hepatology",
    "lung":               "Pulmonology",
    "pulmonary":          "Pulmonology",
    "respiratory":        "Pulmonology",
    "gastro":             "Gastroenterology",
    "colon":              "Gastroenterology",
    "rheumatology":       "Rheumatology",
    "arthritis":          "Rheumatology",
    "immune":             "Immunology",
    "infection":          "Infectious Disease",
    "sepsis":             "Critical Care Medicine",
    "icu":                "Critical Care Medicine",
    "surgery":            "Surgery",
    "surgical":           "Surgery",
    "pediatric":          "Pediatrics",
    "mental":             "Psychiatry",
    "depression":         "Psychiatry",
    "thyroid":            "Endocrinology",
    "dermatology":        "Dermatology",
    "skin":               "Dermatology",
    "spine":              "Orthopedics",
    "bone":               "Orthopedics",
    "urology":            "Urology",
    "gynecology":         "Gynecology",
    "obstetrics":         "Obstetrics",
    "hematology":         "Hematology",
    "blood":              "Hematology",
    "anemia":             "Hematology",
    "vaccination":        "Preventive Medicine",
    "vaccine":            "Preventive Medicine",
}


def clean_name(raw_name: str) -> str:
    """
    Clean a raw NPI physician name for use in OpenAlex author search.

    Handles:
      - Credentials (M.D., MD, Ph.D., DO, MPH, FACC, etc.)
      - Honorific prefixes (Dr., Mr., Mrs., Prof.)
      - Leading/trailing dash sequences e.g. "-- WILLIAM BURTON DAVIS --"
      - Isolated dashes not part of hyphenated names
      - Leftover commas and excess whitespace
      - Title-cases the result
    """
    name = raw_name

    # Remove credentials
    for cred in [
        ", M.D.", ",M.D.", " M.D.", ", MD", ",MD", " MD",
        ", D.O.", ",D.O.", " D.O.", ", DO", ",DO", " DO",
        ", Ph.D.", ", PhD", ", M.D", ",M.D",
        ", MD, MPH", ",MD,MPH", " MD MPH", ", MPH", ",MPH", " MPH",
        ",FACC", ", FACC", ",FSCAI", ", FSCAI", ",FACP", ", FACP",
        ",FAHA", ", FAHA", ",FACS", ", FACS", ",FACOG", ", FACOG",
    ]:
        name = name.replace(cred, "")

    # Remove honorific titles
    name = re.sub(
        r'\b(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Drs\.?)\b',
        '',
        name,
        flags=re.IGNORECASE,
    )

    # Remove leading/trailing dash sequences e.g. "-- WILLIAM BURTON DAVIS --"
    name = re.sub(r'\s*--+\s*', ' ', name)

    # Remove isolated dashes not part of hyphenated names
    name = re.sub(r'(?<!\w)-(?!\w)', ' ', name)

    # Remove leftover commas, collapse whitespace, title-case
    name = name.replace(",", "").strip()
    return " ".join(w.capitalize() for w in name.split() if w)


async def openalex_lookup(name: str, client: httpx.AsyncClient) -> dict:
    """Get citation metrics and research areas from OpenAlex."""
    clean = clean_name(name)
    logger.info("OpenAlex lookup | clean_name=%r", clean)

    try:
        resp = await client.get(
            OPENALEX_URL,
            params={
                "search":   clean,
                "per-page": 5,  # FIX 4: fetch more results so we can disambiguate
                "select":   "id,display_name,cited_by_count,summary_stats,x_concepts,topics",
                "mailto":   "contact@aquarient.com",
            },
            timeout=HTTP_TIMEOUT,
        )

        if resp.status_code != 200:
            logger.warning("OpenAlex returned %d for %r", resp.status_code, clean)
            return _empty()

        items = resp.json().get("results", [])
        if not items:
            logger.info("OpenAlex: no results for %r", clean)
            return _empty()

        # FIX 4: Prefer exact name match before falling back to first result.
        # Without this, a common name like "James Lee" returns a random author
        # who happens to rank first in OpenAlex's relevance sort.
        clean_lower = clean.lower()
        author = next(
            (i for i in items if i.get("display_name", "").lower() == clean_lower),
            items[0] if items else None,
        )
        if not author:
            logger.info("OpenAlex: no usable result for %r", clean)
            return _empty()

        stats = author.get("summary_stats", {})

        logger.info(
            "OpenAlex: found %r | citations=%d | h_index=%d",
            author.get("display_name"),
            author.get("cited_by_count", 0),
            stats.get("h_index", 0),
        )

        concepts = sorted(
            author.get("x_concepts", []),
            key=lambda c: c.get("score", 0),
            reverse=True,
        )
        research_areas = [
            c["display_name"] for c in concepts[:5]
            if c.get("display_name")
        ]

        if not research_areas:
            topics = author.get("topics", [])
            research_areas = [
                t["display_name"] for t in topics[:5]
                if t.get("display_name")
            ]

        logger.info("OpenAlex: research_areas=%s", research_areas)

        return {
            "research_areas":         research_areas,
            "total_citations":        author.get("cited_by_count", 0),
            "h_index":                stats.get("h_index", 0),
            "i10_index":              stats.get("i10_index", 0),
            "citations_last_5_years": stats.get("2yr_mean_citedness", 0),
        }

    except Exception as exc:
        logger.warning("OpenAlex failed for %r: %s", name, exc)
        return _empty()


def derive_areas_from_publications(publications: list[dict]) -> list[str]:
    """
    Extract clinical research areas from publication titles.
    More specific than OpenAlex concepts for medical specialties.
    """
    found = {}
    for pub in publications[:15]:
        title = (pub.get("title") or "").lower()
        for keyword, area in MEDICAL_TOPIC_KEYWORDS.items():
            if keyword in title:
                found[area] = found.get(area, 0) + 1

    sorted_areas = sorted(found.items(), key=lambda x: x[1], reverse=True)
    return [area for area, _ in sorted_areas[:5]]


def _empty() -> dict:
    return {
        "research_areas":         [],
        "total_citations":        0,
        "h_index":                0,
        "i10_index":              0,
        "citations_last_5_years": 0,
    }