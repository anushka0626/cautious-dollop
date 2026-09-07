import pytesseract
from PIL import Image
from presidio_analyzer import AnalyzerEngine

# Verify Tesseract is detected
print("Tesseract Version:", pytesseract.get_tesseract_version())

# Verify Presidio uses the small model
analyzer = AnalyzerEngine()
results = analyzer.analyze(text="Officer Sharma filed the FIR.", language="en")
print("PII Entities found:", [r.entity_type for r in results])