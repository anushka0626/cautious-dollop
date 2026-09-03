from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

def create_fir_pdf(filename):
    c = canvas.Canvas(filename, pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 750, "FIRST INFORMATION REPORT (Under Section 173 BNSS)")
    
    c.setFont("Helvetica", 10)
    c.drawString(50, 720, "State: Maharashtra          District: Pune City          Police Station: Shivajinagar PS")
    c.drawString(50, 700, "FIR No: 0142/2026           General Diary (GD) Reference: GD-882A")
    c.drawString(50, 680, "Date and Time of Occurrence: 01-Sep-2026, 21:30 hrs")
    c.drawString(50, 660, "Investigating Officer Identification: Inspector R. K. Patil (Badge #4091)")
    
    c.setFont("Helvetica-Bold", 11)
    c.drawString(50, 620, "Brief Description of Occurrence & Seized Items:")
    c.setFont("Helvetica", 10)
    text = (
        "Complainant reported unauthorized access and server physical tampering at premises. "
        "Investigating Officer visited the scene at 22:15 hrs. Digital artifacts, tamper seals, "
        "and physical memory drives seized. Chain of custody transmittal form prepared."
    )
    c.drawString(50, 600, text[:90])
    c.drawString(50, 585, text[90:])
    
    c.drawString(50, 540, "Jurisdictional Police Station Details: Shivajinagar Division, Pune.")
    c.drawString(50, 520, "Magistrate Intimation / Delay Explanation: Forwarded within statutory 24-hr window.")
    c.drawString(50, 480, "Officer-in-Charge Signature: [DIGITALLY SIGNED VIA DSC]")
    c.save()

def create_forensic_pdf(filename):
    c = canvas.Canvas(filename, pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 750, "CENTRAL FORENSIC SCIENCE LABORATORY - EVIDENCE REPORT")
    
    c.setFont("Helvetica", 10)
    c.drawString(50, 720, "Case Ref: CFSL-PUN-2026-089          FIR Link: FIR No: 0142/2026")
    c.drawString(50, 700, "Examiner Credentials & Signature: Dr. S. Nair, Senior Forensic Scientist")
    c.drawString(50, 680, "Chain of Custody Form / Courier Dispatch: Sealed Parcel Received via Constable 219")
    c.drawString(50, 660, "Specimen Seal Integrity Status: Unbroken seal verified; intact on arrival.")
    c.drawString(50, 640, "Specimen Description & Quantification: One 1TB NVMe drive, weight 48g, serial SN-9912.")

    c.setFont("Helvetica-Bold", 11)
    c.drawString(50, 600, "Forensic Examination Summary:")
    c.setFont("Helvetica", 10)
    c.drawString(50, 580, "Bit-stream image created with write-blocker active. Master hash matches transmittal sheet.")
    c.drawString(50, 540, "Authorized Signatory: [FORENSIC EXAMINER CERTIFIED]")
    c.save()

def create_tampered_fir_pdf(filename):
    # Changes occurrence time to test tamper detection in verification
    c = canvas.Canvas(filename, pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 750, "FIRST INFORMATION REPORT (Under Section 173 BNSS)")
    c.setFont("Helvetica", 10)
    c.drawString(50, 720, "State: Maharashtra          District: Pune City          Police Station: Shivajinagar PS")
    c.drawString(50, 700, "FIR No: 0142/2026           General Diary (GD) Reference: GD-882A")
    c.drawString(50, 680, "Date and Time of Occurrence: 03-Sep-2026, 11:00 hrs [ALTERED RECORD]")
    c.drawString(50, 660, "Investigating Officer Identification: Inspector R. K. Patil (Badge #4091)")
    c.save()

if __name__ == "__main__":
    create_fir_pdf("sample_fir.pdf")
    create_forensic_pdf("sample_forensic.pdf")
    create_tampered_fir_pdf("sample_fir_tampered.pdf")
    print("Test PDFs generated: sample_fir.pdf, sample_forensic.pdf, sample_fir_tampered.pdf")