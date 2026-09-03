const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { spawn } = require('child_process'); 
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

const app = express();
app.use(cors());
const upload = multer();

app.post('/analyze', upload.single('pdf'), async (req, res) => {
    let tempDir;
    try {
        if (!req.file) return res.status(400).send("No file uploaded");

        console.log("--- Processing File: " + req.file.originalname + " ---");
        const dataBuffer = req.file.buffer;
       
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-ledger-'));
        const pdfPath = path.join(tempDir, req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
        await fs.writeFile(pdfPath, dataBuffer);

        const pythonProcess = spawn('python', [
            path.join(__dirname, 'ml_engine', 'analyzer.py'),
            pdfPath
        ]);

        let resultData = '';
        let errorData = '';

        pythonProcess.stdout.on('data', (data) => {
            resultData += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorData += data.toString();
            console.error("Python Stderr:", data.toString()); 
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error("Python Process Exited with code:", code);
                return res.status(500).json({ error: "Analysis failed", details: errorData });
            }

            try {
                // Find JSON in the output (clean up any potential prints)
                const jsonStart = resultData.indexOf('{');
                const jsonEnd = resultData.lastIndexOf('}');
                
                if (jsonStart === -1 || jsonEnd === -1) {
                    throw new Error("No JSON found in Python output");
                }

                const cleanResult = resultData.substring(jsonStart, jsonEnd + 1);
                const analysisResult = JSON.parse(cleanResult);
                
                res.json({
                    docHash: analysisResult.docHash,
                    score: analysisResult.score,
                    type: analysisResult.type,   
                    risks: analysisResult.risks,
                    entities: analysisResult.entities,
                    summary: analysisResult.summary, 
                    missing_clauses: analysisResult.missing_clauses
                });

            } catch (e) {
                console.error("JSON Parse Error:", e);
                console.error("Raw Output:", resultData);
                res.status(500).send("Error parsing analysis results");
            }
        });

        pythonProcess.on('close', () => {
            fs.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) => {
                console.error("Temporary file cleanup failed:", cleanupError);
            });
        });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).send("Error analyzing document");
    }
});

app.listen(3001, () => console.log('Server running on 3001'));