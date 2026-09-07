import io
import re
import traceback
from fastapi import FastAPI, Request, HTTPException
from PIL import Image
import pytesseract
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

app = FastAPI(title="Veritas LexAudit AI Service")

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()
embed_model = SentenceTransformer("all-MiniLM-L6-v2")

# BNSS Section 173 Mandatory Statutory Pillars
BNSS_173_REQUIREMENTS = [
    {
        "field": "Complainant / Informant Identity",
        "description": "Identity and details of informant or complainant who provided information",
        "threshold": 0.38
    },
    {
        "field": "Incident Date & Time",
        "description": "Date, time, hours, or period of occurrence of the alleged offense",
        "threshold": 0.38
    },
    {
        "field": "Place of Occurrence",
        "description": "Location, place of incident, beat number, direction and distance from police station",
        "threshold": 0.38
    },
    {
        "field": "Penal Sections & Offense Description",
        "description": "Penal sections of law, act name, and description of the cognizable offense",
        "threshold": 0.40
    },
    {
        "field": "Officer Endorsement / Station Signoff",
        "description": "Officer in charge signature, rank, station house officer endorsement or police station seal",
        "threshold": 0.36
    }
]

STATUTORY_BENCHMARKS = {
    "303": {"title": "BNS 303 (Theft)", "mandatory": ["dishonest intention", "movable property", "without consent", "taking away"]},
    "379": {"title": "IPC 379 (Theft)", "mandatory": ["dishonest intention", "movable property", "without consent", "taking away"]},
    "281": {"title": "BNS 281 (Rash Driving)", "mandatory": ["public way or road", "driving rashly or negligently", "endangering human life"]},
    "279": {"title": "IPC 279 (Rash Driving)", "mandatory": ["public way or road", "driving rashly or negligently", "endangering human life"]},
    "115": {"title": "BNS 115 (Hurt)", "mandatory": ["bodily pain or infirmity", "intentional harm"]},
    "323": {"title": "IPC 323 (Hurt)", "mandatory": ["bodily pain or infirmity", "intentional harm"]},
    "106": {"title": "BNS 106 (Death by Negligence)", "mandatory": ["death of person", "rash or negligent act"]},
    "304-a": {"title": "IPC 304-A (Death by Negligence)", "mandatory": ["death of person", "rash or negligent act"]},
    "304a": {"title": "IPC 304-A (Death by Negligence)", "mandatory": ["death of person", "rash or negligent act"]},
    "125": {"title": "BNS 125 (Endangering Safety)", "mandatory": ["act endangering life", "hurt caused rashly"]},
    "337": {"title": "IPC 337 (Endangering Safety)", "mandatory": ["act endangering life", "hurt caused rashly"]}
}

@app.post("/process-document")
async def process_document(request: Request):
    try:
        contents = await request.body()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty payload received")

        extracted_text = ""
        if contents.startswith(b"%PDF"):
            if HAS_PYPDF:
                reader = pypdf.PdfReader(io.BytesIO(contents))
                pages = [p.extract_text() or "" for p in reader.pages]
                extracted_text = "\n".join(pages)
            else:
                extracted_text = "[PDF format detected - pypdf required]"
        else:
            image = Image.open(io.BytesIO(contents))
            if image.mode != "RGB":
                image = image.convert("RGB")
            try:
                extracted_text = pytesseract.image_to_string(image, lang="eng+hin")
            except Exception:
                extracted_text = pytesseract.image_to_string(image, lang="eng")

        compliance_flags = []
        if not extracted_text.strip():
            return {
                "success": False,
                "raw_text": "",
                "redacted_text": "",
                "sections_detected": [],
                "procedural_flags": ["Illegible Docket: No textual information detected by OCR."]
            }

        # 1. Presidio PII Masking
        analysis_results = analyzer.analyze(
            text=extracted_text,
            entities=["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "LOCATION"],
            language="en"
        )
        redacted_text = anonymizer.anonymize(
            text=extracted_text,
            analyzer_results=analysis_results
        ).text

        # 2. Semantic BNSS 173 Evaluation (all-MiniLM-L6-v2)
        doc_sentences = [s.strip() for s in re.split(r"[\n.]+", extracted_text) if len(s.strip()) > 15]
        if doc_sentences:
            doc_embeddings = embed_model.encode(doc_sentences)
            for req in BNSS_173_REQUIREMENTS:
                req_emb = embed_model.encode([req["description"]])
                similarities = cosine_similarity(req_emb, doc_embeddings)[0]
                best_match_score = float(np.max(similarities))

                if best_match_score < req["threshold"]:
                    compliance_flags.append(f"BNSS 173 Defect: Missing '{req['field']}' (Confidence: {int(best_match_score * 100)}%)")
        else:
            compliance_flags.append("BNSS 173 Defect: Insufficient sentences to parse procedural requirements.")

        # 3. Penal Section Detection & Semantic Ingredient Matching
        raw_sections = re.findall(r"(?:BNS|IPC|Section|Sections|u/s|धारा)\s*([0-9]+(?:-[A-Za-z]+)?)", extracted_text, re.IGNORECASE)
        sections_found = list({s.upper() for s in raw_sections})

        if not sections_found:
            compliance_flags.append("Statutory Warning: No penal sections (BNS or IPC) detected.")
        elif doc_sentences:
            for sec in sections_found:
                sec_key = sec.lower()
                if sec_key in STATUTORY_BENCHMARKS:
                    bench = STATUTORY_BENCHMARKS[sec_key]
                    for ingredient in bench["mandatory"]:
                        ing_emb = embed_model.encode([ingredient])
                        ing_sim = cosine_similarity(ing_emb, doc_embeddings)[0]
                        if float(np.max(ing_sim)) < 0.35:
                            compliance_flags.append(f"Missing Element for {bench['title']}: '{ingredient}'")

        return {
            "success": True,
            "raw_text": extracted_text,
            "redacted_text": redacted_text,
            "entities_masked": [item.entity_type for item in analysis_results],
            "sections_detected": sections_found,
            "procedural_flags": compliance_flags
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)