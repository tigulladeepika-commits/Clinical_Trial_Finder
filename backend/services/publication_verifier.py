import asyncio
import json
import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv
import httpx

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama-3.3-70b-versatile"
HTTP_TIMEOUT = 15.0


def verify_publications(
    publications: list[dict],
    specialty: str,
    npi_state: str,
    client: httpx.AsyncClient,
    physician_name: str = "",
) -> list[dict]:
    if not publications:
        return []

    after_affiliation = _affiliation_filter(publications, npi_state)
    logger.info(
        "Affiliation filter: %d → %d papers (state=%r)",
        len(publications), len(after_affiliation), npi_state,
    )

    papers_to_verify = after_affiliation if after_affiliation else publications

    if physician_name:
        papers_to_verify = _author_name_filter(papers_to_verify, physician_name)
        logger.info(
            "Author name filter: %d papers after name check (physician=%r)",
            len(papers_to_verify), physician_name,
        )

    verified = asyncio.run(_groq_title_verify(papers_to_verify, specialty, client))
    logger.info(
        "Groq title verify: %d → %d papers (specialty=%r)",
        len(papers_to_verify), len(verified), specialty,
    )

    return verified


def _author_name_filter(publications: list[dict], physician_name: str) -> list[dict]:
    parts = physician_name.strip().split()
    if len(parts) < 2:
        return publications

    last_name    = parts[-1].lower()
    first_initial = parts[0][0].lower()
    full_initials = "".join(p[0].lower() for p in parts[:-1])

    kept = []
    for pub in publications:
        authors = pub.get("authors", [])
        if not authors:
            kept.append(pub)
            continue

        matched = False
        for author in authors:
            a_lower = author.lower()
            if last_name in a_lower:
                author_parts = a_lower.replace(",", "").split()
                for ap in author_parts:
                    if ap.startswith(first_initial) and ap != last_name:
                        matched = True
                        break
                if matched:
                    break

        if matched:
            kept.append(pub)
        else:
            logger.info(
                "Author name reject: %r not found in authors %r",
                physician_name, authors[:3],
            )

    return kept


_US_STATE_NAMES = {
    "AL": ["alabama"], "AK": ["alaska"], "AZ": ["arizona"],
    "AR": ["arkansas"], "CA": ["california"], "CO": ["colorado"],
    "CT": ["connecticut"], "DE": ["delaware"], "FL": ["florida"],
    "GA": ["georgia"], "HI": ["hawaii"], "ID": ["idaho"],
    "IL": ["illinois"], "IN": ["indiana"], "IA": ["iowa"],
    "KS": ["kansas"], "KY": ["kentucky"], "LA": ["louisiana"],
    "ME": ["maine"], "MD": ["maryland"], "MA": ["massachusetts"],
    "MI": ["michigan"], "MN": ["minnesota"], "MS": ["mississippi"],
    "MO": ["missouri"], "MT": ["montana"], "NE": ["nebraska"],
    "NV": ["nevada"], "NH": ["new hampshire"], "NJ": ["new jersey"],
    "NM": ["new mexico"], "NY": ["new york"], "NC": ["north carolina"],
    "ND": ["north dakota"], "OH": ["ohio"], "OK": ["oklahoma"],
    "OR": ["oregon"], "PA": ["pennsylvania"], "RI": ["rhode island"],
    "SC": ["south carolina"], "SD": ["south dakota"], "TN": ["tennessee"],
    "TX": ["texas"], "UT": ["utah"], "VT": ["vermont"],
    "VA": ["virginia"], "WA": ["washington"], "WV": ["west virginia"],
    "WI": ["wisconsin"], "WY": ["wyoming"], "DC": ["district of columbia"],
}


def _affiliation_filter(publications: list[dict], npi_state: str) -> list[dict]:
    if not npi_state:
        return publications

    npi_state_upper = npi_state.upper().strip()

    WRONG_COUNTRY_SIGNALS = [
        "united kingdom", "uk,", " uk ", "england", "scotland", "wales",
        "germany", "france", "italy", "spain", "netherlands", "australia",
        "canada", "china", "india", "japan", "korea", "brazil",
        "new zealand", "sweden", "norway", "denmark", "finland",
        "saudi arabia", "egypt", "turkey", "iran", "pakistan",
    ]

    correct_state_names = _US_STATE_NAMES.get(npi_state_upper, [])
    other_state_names = []
    for state_code, state_names in _US_STATE_NAMES.items():
        if state_code != npi_state_upper:
            other_state_names.extend(state_names)

    kept = []
    for pub in publications:
        affiliation = pub.get("affiliation", "").lower()

        if not affiliation:
            pub["affiliation_verified"] = None
            kept.append(pub)
            continue

        if any(signal in affiliation for signal in WRONG_COUNTRY_SIGNALS):
            logger.debug(
                "Affiliation reject (wrong country): %r",
                pub.get("title", "")[:60]
            )
            continue

        has_correct_state = any(s in affiliation for s in correct_state_names)
        has_wrong_state   = any(s in affiliation for s in other_state_names)

        if has_wrong_state and not has_correct_state:
            logger.debug(
                "Affiliation reject (wrong state, NPI=%s): %r",
                npi_state_upper,
                pub.get("title", "")[:60]
            )
            continue

        pub["affiliation_verified"] = None
        kept.append(pub)

    return kept


async def _groq_title_verify(
    publications: list[dict],
    specialty: str,
    client: httpx.AsyncClient,
) -> list[dict]:
    if not publications or not GROQ_API_KEY:
        return publications

    titles_text = "\n".join(
        f"{i+1}. {pub.get('title', 'Unknown')}"
        for i, pub in enumerate(publications)
    )

    prompt = f"""You are a strict medical publication verifier for a US clinical trial platform.

Physician specialty: {specialty}

For each paper title, answer YES if the paper is directly relevant to this medical specialty, or NO if it is not.

STRICT rules — answer NO for:
- Dentistry, veterinary medicine (unless the specialty involves it), agriculture, farming, piglet/animal husbandry
- Health policy papers from other countries (e.g. "diabetes drugs in New Zealand")
- Papers about skin conditions (psoriasis, alopecia, dermatology) unless specialty is Dermatology
- Papers about myeloma, lymphoma, cancer unless specialty includes Oncology
- Non-medical science (physics, chemistry, engineering, geology)
- Neuroscience/neurology papers unless specialty includes Neurology
- Basic molecular biology with no clinical medicine relevance
- Ophthalmology, eye, retina, vitreous, ocular papers unless specialty is Ophthalmology
- Papers about nuclear disasters, Chernobyl, radiation epidemiology unless specialty is Radiation Oncology
- Papers about infectious disease, antibiotics, bacteriology unless specialty includes Infectious Disease or the physician's specialty directly relates
- Epidemiological letters or case reports from a completely different subspecialty

Answer YES for:
- Papers directly about the specialty's diseases and treatments
- Animal cardiac/heart studies for cardiology specialties
- Papers about comorbidities common to the specialty (e.g. diabetes+cardiovascular outcomes for cardiologists)
- Clinical trials related to the specialty
- Radiation oncology treatment papers for Radiation Oncology specialty
- Breast cancer, prostate cancer, lung cancer papers for Oncology/Radiation Oncology

Return ONLY a JSON array, no other text:
[{{"index": 1, "relevant": true}}, {{"index": 2, "relevant": false}}, ...]

Titles:
{titles_text}"""

    try:
        resp = await client.post(
            GROQ_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type":  "application/json",
            },
            json={
                "model":       GROQ_MODEL,
                "max_tokens":  500,
                "temperature": 0.0,
                "messages":    [{"role": "user", "content": prompt}],
            },
            timeout=HTTP_TIMEOUT,
        )

        if resp.status_code != 200:
            logger.warning("Groq verify failed %d — keeping all papers", resp.status_code)
            return publications

        raw = resp.json()["choices"][0]["message"]["content"].strip()
        logger.debug("Groq raw response: %s", raw[:300])

        json_match = re.search(r'\[.*?\]', raw, re.DOTALL)
        if not json_match:
            logger.warning("Groq verify: no JSON found — keeping all papers")
            return publications

        results = json.loads(json_match.group())
        relevant_indices = {
            item["index"] for item in results
            if item.get("relevant", True)
        }

        verified = []
        for i, pub in enumerate(publications):
            idx = i + 1
            if idx in relevant_indices:
                verified.append(pub)
            else:
                logger.info(
                    "Groq rejected paper: %r",
                    pub.get("title", "")[:60],
                )

        return verified if verified else publications

    except Exception as exc:
        logger.warning("Groq title verify error: %s — keeping all papers", exc)
        return publications
