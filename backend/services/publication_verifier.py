import asyncio
import json
import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv
import httpx

from services.pubmed_service import COMMON_LAST_NAMES

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "openai/gpt-oss-120b"
# Fallback chain: each model has its own separate rate limit bucket on Groq
GROQ_FALLBACK_MODELS = [
    "openai/gpt-oss-120b",   # primary  — 8K TPM, best quality
    "openai/gpt-oss-20b",    # secondary — 8K TPM, 1000 tps
    "llama-3.1-8b-instant",  # tertiary  — 6K TPM, highest availability
]
HTTP_TIMEOUT = 15.0



def _exact_name_confirm(publications: list[dict], physician_name: str) -> list[dict]:
    """
    Post-Groq final confirmation: verify the physician's last name + first
    initial actually appears in each paper's author list.

    Handles PubMed format ("Tsokos GC"), S2 format ("George C. Tsokos"),
    and short formats ("G Tsokos", "Tsokos G").

    Papers with no authors are kept (benefit of doubt).
    S2 papers with affiliation_verified=True are kept without re-checking.
    """
    if not physician_name:
        return publications

    parts = physician_name.strip().split()
    if len(parts) < 2:
        return publications

    last_name    = parts[-1].lower()
    first_initial = parts[0][0].lower() if parts[0] else ""
    is_common_surname = last_name in COMMON_LAST_NAMES

    kept = []
    for pub in publications:
        # S2 papers already verified at author level — skip re-check
        if pub.get("affiliation_verified") is True and pub.get("source") == "Semantic Scholar":
            kept.append(pub)
            continue

        authors = pub.get("authors", [])
        if not authors:
            kept.append(pub)
            continue

        matched = False
        matched_full_name = False
        for author in authors:
            a = author.lower().replace(".", "").replace(",", "").strip()
            a_parts = a.split()

            # Must contain last name as whole word
            if last_name not in a_parts:
                continue

            # Last name found — check first initial (and full first name, if present)
            for ap in a_parts:
                if ap == last_name:
                    continue
                if ap == first_initial:
                    matched = True
                if len(ap) >= 3 and ap == parts[0].lower():
                    matched = True
                    matched_full_name = True

            if matched:
                break

        # Common surname (Han, Kim, Chen...) matched only by bare initial, with
        # no affiliation to corroborate it, is a high collision-risk match —
        # PubMed's author field is often just "Han J", which any J-initialed
        # Han satisfies. Require either a full first-name match or affiliation
        # evidence before accepting.
        if matched and not matched_full_name and is_common_surname:
            has_affiliation = bool(pub.get("affiliation")) or pub.get("affiliation_verified") is True
            if not has_affiliation:
                logger.info(
                    "Name confirm reject: common surname %r matched by initial only, "
                    "no affiliation to corroborate - title=%r",
                    last_name, pub.get("title", "")[:50],
                )
                matched = False

        if matched:
            kept.append(pub)
        else:
            logger.info(
                "Name confirm reject: physician=%r not confirmed in authors=%r title=%r",
                physician_name,
                authors[:3],
                pub.get("title", "")[:50],
            )

    return kept

# FIX 1: Changed from sync to async, replaced asyncio.run() with await
async def verify_publications(
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

    # FIX 1: was asyncio.run(...) which raises RuntimeError inside FastAPI's event loop
    verified = await _groq_title_verify(papers_to_verify, specialty, client, physician_name=physician_name)
    logger.info(
        "Groq title verify: %d → %d papers (specialty=%r)",
        len(papers_to_verify), len(verified), specialty,
    )


    # Final layer: confirm physician name in paper authors
    if physician_name and verified:
        confirmed = _exact_name_confirm(verified, physician_name)
        logger.info(
            "Name confirm: %d -> %d papers (physician=%r)",
            len(verified), len(confirmed), physician_name,
        )
        if confirmed:
            verified = confirmed
    return verified


# FIX 3: Looser author name filter — handles hyphens, middle names, multiple initials
def _author_name_filter(publications: list[dict], physician_name: str) -> list[dict]:
    parts = physician_name.strip().split()
    if len(parts) < 2:
        return publications

    last_name = parts[-1].lower()
    # Accept any initial from ANY part of the name except last (handles middle names, hyphens)
    first_initials = set(p[0].lower() for p in parts[:-1])
    is_common_surname = last_name in COMMON_LAST_NAMES

    kept = []
    for pub in publications:
        authors = pub.get("authors", [])
        if not authors:
            # Reject EuropePMC papers with no authors - unverifiable
            if pub.get("source", "") == "Europe PMC":
                logger.info("Author filter reject: EuropePMC no authors: %r", pub.get("title","")[:50])
                continue
            # PubMed no-author - keep with benefit of doubt
            kept.append(pub)
            continue
        # Word boundary match - prevents "burns" matching "Abushouk"
        import re as _re
        matched = False
        matched_full_name = False
        # Full first name from physician (e.g. "Earl" from "Earl James Brink")
        physician_first_full = parts[0].lower() if parts else ""
        for author in authors:
            a_lower = author.lower()
            # Must contain last name as whole word
            if not _re.search(rf"\b{_re.escape(last_name)}\b", a_lower):
                continue
            # Last name found — now check first name
            author_parts = a_lower.replace(",", "").split()
            # If author string contains a full word >= 3 chars that isn't the
            # last name, treat it as a full first name and require exact match.
            author_first_candidates = [
                ap for ap in author_parts
                if ap != last_name and len(ap) >= 3
            ]
            if author_first_candidates and physician_first_full:
                # Full first name available on both sides — require exact match
                if any(af == physician_first_full for af in author_first_candidates):
                    matched = True
                    matched_full_name = True
                    break
                # Also accept if physician first name starts with author initial
                # (handles "E Brink" matching "Earl Brink") — but NOT "E.E. Brink"
                author_initials_only = [
                    ap for ap in author_parts
                    if ap != last_name and len(ap) == 1
                ]
                if author_initials_only:
                    if any(ai == physician_first_full[0] for ai in author_initials_only):
                        matched = True
                        break
            else:
                # Fallback: initial match (original logic)
                for ap in author_parts:
                    if ap != last_name and ap[0] in first_initials:
                        matched = True
                        break
            if matched:
                break

        # Common surname (Han, Kim, Chen...) matched only by bare initial, with
        # no affiliation to corroborate it, is a high collision-risk match —
        # PubMed's author field is often just "Han J", which any J-initialed
        # Han satisfies. Require either a full first-name match or affiliation
        # evidence before accepting.
        if matched and not matched_full_name and is_common_surname:
            has_affiliation = bool(pub.get("affiliation")) or pub.get("affiliation_verified") is True
            if not has_affiliation:
                logger.info(
                    "Author filter reject: common surname %r matched by initial only, "
                    "no affiliation to corroborate - title=%r",
                    last_name, pub.get("title", "")[:50],
                )
                matched = False

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
            # Fix: reject old papers with no affiliation — high collision risk.
            # A physician active today is unlikely to have published before 1975.
            pub_year = int(pub.get("year") or pub.get("pub_year") or 9999)
            if pub_year < 1975:
                logger.info(
                    "Affiliation reject (no affiliation + old paper %d): %r",
                    pub_year, pub.get("title", "")[:60],
                )
                continue
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



def _keyword_fallback_filter(publications: list[dict], specialty: str) -> list[dict]:
    """
    Last-resort filter when all 3 Groq models are exhausted/rate-limited.
    Mirrors a subset of the Groq prompt's specialty-mismatch NO rules so a
    request that never reaches Groq isn't left completely unfiltered.
    """
    spec_lower = specialty.lower()
    reject = []
    reject += ["quantum","nanotechnology","semiconductor","aerospace","metallurgy",
               "photonics","optics","qubit","nanoresonator","nanomechanics"]
    reject += ["veterinary","piglet","livestock","poultry","bovine","canine","feline",
               "equine","dental caries","periodontal","orthodontic"]
    is_surgical = any(s in spec_lower for s in ["surg","orthop","trauma","vascular surgery"])
    if not is_surgical:
        reject += ["laparoscopic","cholangiogram","cholecystectomy","cholecystitis",
                   "intraoperative","thromboelastography","rib fracture",
                   "scooter injur","cleft lip","cleft palate","epidural analgesia"]
    is_psych = any(s in spec_lower for s in ["psych","neurol","mental"])
    if not is_psych:
        reject += ["polyvagal","vagal tone","mindfulness","meditation",
                   "respiratory sinus arrhythmia","loving-kindness","panic disorder"]
    is_ophtho = "ophthalmol" in spec_lower
    if not is_ophtho:
        reject += ["retinopathy","retinal","ophthalmic","ophthalmology","vitreous",
                   "corneal","glaucoma","macular degeneration"]
    is_derm = "dermatolog" in spec_lower
    if not is_derm:
        reject += ["psoriasis","alopecia","dermatitis","dermatologic"]
    is_onc = "oncolog" in spec_lower
    if not is_onc:
        reject += ["myeloma","lymphoma"]
    is_neuro = any(s in spec_lower for s in ["neurol","neurosurg"])
    if not is_neuro:
        reject += ["neurodegenerat","parkinson's disease","alzheimer's disease"]
    reject += ["war of 1812","extradition","war on terror","economic development",
               "northwest ohio","swinish multitude","cycling time trial","fan cooling"]
    kept = [p for p in publications if not any(t in p.get("title","").lower() for t in reject)]
    return kept if kept else publications

async def _groq_title_verify(
    publications: list[dict],
    specialty: str,
    client: httpx.AsyncClient,
    physician_name: str = "",
) -> list[dict]:
    if not publications or not GROQ_API_KEY:
        return publications

    titles_text = "\n".join(
        f"{i+1}. [{pub.get('year', '?')}] {pub.get('title', 'Unknown')}"
        for i, pub in enumerate(publications)
    )
    name_context = f"Physician name: {physician_name}" if physician_name else ""

    prompt = f"""You are a strict medical publication verifier for a US clinical trial platform.

Physician specialty: {specialty}
{name_context}
IMPORTANT: Papers before 1975 are almost certainly from a different researcher - answer NO for any paper before 1975.

For each paper title, answer YES if the paper is directly relevant to this medical specialty, or NO if it is not.

STRICT rules — answer NO for:
- Dentistry, veterinary medicine (unless the specialty involves it), agriculture, farming, piglet/animal husbandry
- Health policy papers from other countries (e.g. "diabetes drugs in New Zealand")
- Papers about skin conditions (psoriasis, alopecia, dermatology) unless specialty is Dermatology
- Papers about myeloma, lymphoma, cancer unless specialty includes Oncology
- Non-medical science: physics, quantum computing, nanotechnology, semiconductor, photonics, optics, engineering, geology, chemistry (ALWAYS NO regardless of specialty)
- Neuroscience/neurology papers unless specialty includes Neurology
- Basic molecular biology, genomics, proteomics with no direct clinical application
- Ophthalmology, eye, retina, vitreous, ocular papers unless specialty is Ophthalmology
- Papers about nuclear disasters, Chernobyl, radiation epidemiology unless specialty is Radiation Oncology
- Papers about infectious disease, antibiotics, bacteriology unless specialty includes Infectious Disease
- Epidemiological letters or case reports from a completely different subspecialty
- Mitochondrial biology, cellular biophysics, nanomechanics — ALWAYS NO for clinical specialties
- Papers about electron channels, qubits, photocurrents, nanoresonators — ALWAYS NO
- Surgical procedure papers (cholecystectomy, cholecystitis, cholangiogram, laparoscopic surgery, appendectomy, hernia repair, SAGES guidelines, intraoperative imaging, rib fractures, trauma surgery, scooter injuries, coagulopathy, thromboelastography) unless specialty includes Surgery
- Trauma/emergency medicine papers unless specialty includes Emergency Medicine or Surgery
- Pediatric surgery, cleft palate, plastic surgery papers unless specialty includes those areas
- Mindfulness, meditation, polyvagal theory, vagal tone, respiratory sinus arrhythmia papers unless specialty is Psychiatry or Neurology
- Psychology, behavioral science, social science papers unless specialty includes Psychiatry
- Public health surveys, population studies, socioeconomic/pain/abortion/lifestyle papers unless specialty explicitly covers them
- Chinese population studies, nationwide surveys from China unrelated to the specialty
- Animal husbandry, veterinary, public health intervention papers for animals

Answer YES for:
- Papers directly about the specialty's diseases and treatments
- Animal cardiac/heart studies for cardiology specialties
- Papers about comorbidities common to the specialty (e.g. diabetes+cardiovascular outcomes for cardiologists)
- Clinical trials related to the specialty
- Radiation oncology treatment papers for Radiation Oncology specialty
- Breast cancer, prostate cancer, lung cancer papers for Oncology/Radiation Oncology

Return ONLY a valid JSON array. No explanation, no markdown, no extra text.
CRITICAL: Your ENTIRE response must be a JSON array starting with [ and ending with ].
[{{"index": 1, "relevant": true}}, {{"index": 2, "relevant": false}}]
Titles:
{titles_text}"""

    import asyncio as _aio
    for _current_model in GROQ_FALLBACK_MODELS:
        _model_exhausted = False
        for _attempt in range(3):
            try:
                resp = await client.post(
                    GROQ_URL,
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type":  "application/json",
                    },
                    json={
                        "model":       _current_model,
                        "max_tokens":  500,
                        "temperature": 0.0,
                        "messages":    [{"role": "user", "content": prompt}],
                    },
                    timeout=HTTP_TIMEOUT,
                )
                if resp.status_code == 429:
                    wait = 2.0 * (2 ** _attempt)
                    logger.warning("Groq 429 attempt %d model=%s - waiting %.1fs", _attempt+1, _current_model, wait)
                    if _attempt < 2:
                        await _aio.sleep(wait)
                        continue
                    logger.warning("Groq 429 exhausted on %s - trying next model", _current_model)
                    _model_exhausted = True
                    break
                if resp.status_code != 200:
                    logger.warning("Groq failed %d model=%s - trying next", resp.status_code, _current_model)
                    _model_exhausted = True
                    break
                raw = resp.json()["choices"][0]["message"]["content"].strip()
                logger.debug("Groq raw response: %s", raw[:300])
                json_match = re.search(r'\[.*?\]', raw, re.DOTALL)
                if not json_match:
                    logger.warning("Groq verify: no JSON on %s - trying next model", _current_model)
                    _model_exhausted = True
                    break
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
            except Exception as _e:
                logger.warning("Groq exception model=%s: %s", _current_model, _e)
                _model_exhausted = True
                break
        if not _model_exhausted:
            break
    # All models exhausted - keyword fallback
    return _keyword_fallback_filter(publications, specialty)

