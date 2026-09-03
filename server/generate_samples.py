"""Generate deterministic-looking legal and forensic PDFs for local testing."""

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


OUTPUT_DIR = Path(__file__).parent / "sample_docs"


def make_pdf(filename: str, title: str, sections: list[tuple[str, str]]) -> None:
    document = SimpleDocTemplate(
        str(OUTPUT_DIR / filename),
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("EvidenceTitle", parent=styles["Title"], fontSize=15, leading=19, spaceAfter=14)
    heading_style = ParagraphStyle("EvidenceHeading", parent=styles["Heading3"], fontSize=10, leading=13, spaceBefore=8)
    body_style = ParagraphStyle("EvidenceBody", parent=styles["BodyText"], fontSize=10, leading=15)
    story = [Paragraph("STATE POLICE / DIGITAL EVIDENCE CELL", heading_style), Paragraph(title, title_style)]
    for heading, text in sections:
        story.extend([Paragraph(heading, heading_style), Paragraph(text, body_style), Spacer(1, 5)])
    document.build(story)


FIR_SECTIONS = [
    ("Case particulars", "Police Station: Shivaji Nagar PS<br/>FIR No: 104/2026<br/>GD Entry: 042/2026<br/>Date &amp; Time of Occurrence: 14-Aug-2026 21:30 hrs."),
    ("Description of incident", "The informant reported that an unknown person entered the premises near the east gate and removed a sealed evidence packet. The scene was secured, witnesses were noted, and the first response was recorded in the General Diary."),
    ("Informant details", "Phone: +91 98765 43210<br/>ID: 1234 5678 9012"),
    ("Assigned investigating officer", "Inspector Rajesh Patil"),
]

FORENSIC_SECTIONS = [
    ("Reference", "FSL Case Reference: CFSL/BL/2026/889<br/>Specimen Seal Integrity Status: INTACT &amp; VERIFIED"),
    ("Evidence received", "Chain of Custody dispatch reference: COC/SHIVAJI/2026/119. Quantity: 2 x 7.65mm spent cartridges."),
    ("Examination findings", "Microscopic striation analysis was conducted using comparison microscopy. The submitted specimens were examined, documented, and retained under the laboratory evidence protocol."),
    ("Examiner", "Senior Scientific Officer Dr. S. Rao"),
]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    make_pdf("FIR_Sample_001.pdf", "FIRST INFORMATION REPORT (Under Section 173 BNSS / 154 CrPC)", FIR_SECTIONS)
    make_pdf("Forensic_Report_Ballistics.pdf", "CENTRAL FORENSIC SCIENCE LABORATORY - BALLISTICS & EVIDENCE EXAMINATION REPORT", FORENSIC_SECTIONS)
    tampered_sections = [*FIR_SECTIONS]
    tampered_sections[1] = (tampered_sections[1][0], tampered_sections[1][1].replace("east gate", "west gate"))
    make_pdf("FIR_Tampered_Copy.pdf", "FIRST INFORMATION REPORT (Under Section 173 BNSS / 154 CrPC)", tampered_sections)
    print(f"Generated 3 PDFs in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()