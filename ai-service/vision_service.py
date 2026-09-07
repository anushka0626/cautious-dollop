import io
import re
import traceback
from fastapi import FastAPI, Request, HTTPException
from PIL import Image
import pytesseract
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

# Optional PDF support: install `pypdf` if handling PDFs without external system poppler binaries
try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

app = FastAPI(title="Veritas LexAudit AI Service")

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

BNS_BENCHMARKS = {
    "303": {
        "title": "Theft",
        "mandatory_elements": ["dishonest intention", "movable property", "without consent", "taking"],
    },
    "115": {
        "title": "Voluntarily Causing Hurt",
        "mandatory_elements": ["bodily pain", "disease", "infirmity", "intention"],
    },
    "318": {
        "title": "Cheating",
        "mandatory_elements": ["deceiving", "fraudulently", "property delivery"],
    },
}

@app.post("/process-document")
async def process_document(request: Request):
    try:
        contents = await request.body()
        if not contents or len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file payload received")

        extracted_text = ""

        # Check if the file is a PDF (first 4 bytes are %PDF)
        if contents.startswith(b"%PDF"):
            if HAS_PYPDF:
                pdf_reader = pypdf.PdfReader(io.BytesIO(contents))
                pages_text = [p.extract_text() or "" for p in pdf_reader.pages]
                extracted_text = "\n".join(pages_text)
            else:
                extracted_text = "[PDF received: Install pypdf for text extraction, or upload image scan]"
        else:
            # Handle standard raster images
            image = Image.open(io.BytesIO(contents))
            
            # Convert RGBA/Palette to RGB
            if image.mode != "RGB":
                image = image.convert("RGB")

            # Try English + Hindi OCR first, fallback to pure English
            try:
                extracted_text = pytesseract.image_to_string(image, lang="eng+hin")
            except Exception:
                extracted_text = pytesseract.image_to_string(image, lang="eng")

        if not extracted_text.strip():
            extracted_text = "No machine-readable text recognized in source document."

        # 2. PII Detection & Anonymization
        analysis_results = analyzer.analyze(
            text=extracted_text,
            entities=["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "LOCATION"],
            language="en"
        )
        redacted_result = anonymizer.anonymize(
            text=extracted_text,
            analyzer_results=analysis_results
        )

        # 3. Statutory Check
        sections_found = list(set(re.findall(r"(?:BNS|Section|u/s)\s*(\d+)", extracted_text, re.IGNORECASE)))
        compliance_flags = []
        for sec in sections_found:
            if sec in BNS_BENCHMARKS:
                benchmark = BNS_BENCHMARKS[sec]
                for elem in benchmark["mandatory_elements"]:
                    if not any(word in extracted_text.lower() for word in elem.split()):
                        compliance_flags.append(f"Missing element for BNS {sec} ({benchmark['title']}): '{elem}'")

        return {
            "success": True,
            "raw_text": extracted_text,
            "redacted_text": redacted_result.text,
            "entities_masked": [item.entity_type for item in analysis_results],
            "sections_detected": sections_found,
            "procedural_flags": compliance_flags
        }

    except Exception as e:
        print("\n--- ERROR IN PROCESS-DOCUMENT ---")
        traceback.print_exc()
        print("---------------------------------\n")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)