const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const TrOCRIntegration = require('./trocr_integration');

const app = express();
const PORT = 3000;

// Initialize TrOCR integration
const trocrIntegration = new TrOCRIntegration();

// Initialize SQLite database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Create table if it doesn't exist
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS marriage_licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name_spouse1 TEXT,
            name_spouse2 TEXT,
            marriage_date DATE,
            license_number TEXT,
            file_path TEXT,
            original_filename TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|tiff|tif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image and PDF files are allowed'));
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Routes

// OCR endpoint for processing uploaded files
app.post('/api/ocr', upload.single('document'), async (req, res) => {
    console.log('OCR route called');
    if (!req.file) {
        console.log('No file uploaded to OCR endpoint');
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    console.log('File uploaded for OCR:', filePath);

    try {
        // First try standard OCR (Tesseract)
        let ocrResult = await extractTextFromDocument(filePath);
        console.log('Standard OCR result:', ocrResult);

        // If standard OCR fails or has very low confidence, try TrOCR
        const hasLowConfidence = ocrResult.needsVerification && 
            Object.values(ocrResult.extractedFields).some(field => 
                !field.value || field.value.trim().length === 0 || field.confidence < 0.3
            );

        if (hasLowConfidence && trocrIntegration.isAvailable) {
            console.log('Standard OCR had low confidence, trying TrOCR...');
            const trocrResult = await trocrIntegration.extractTextWithTrOCR(filePath);
            
            if (trocrResult.success) {
                console.log('TrOCR result:', trocrResult);
                
                // Use TrOCR result if it has better field extraction
                const trocrHasData = Object.values(trocrResult.extractedFields).some(field => 
                    field.value && field.value.trim().length > 0
                );
                
                if (trocrHasData) {
                    ocrResult = trocrResult;
                    console.log('Using TrOCR result for better cursive recognition');
                }
            }
        }

        // Clean up temporary file
        fs.unlinkSync(filePath);
        console.log('Temporary file deleted:', filePath);

        res.json({
            success: true,
            extractedText: ocrResult.text,
            extractedFields: ocrResult.extractedFields,
            needsVerification: ocrResult.needsVerification,
            warnings: ocrResult.warnings || [],
            error: ocrResult.error
        });
    } catch (error) {
        // Clean up temporary file on error
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('Temporary file deleted after error:', filePath);
        }
        console.error('OCR processing failed:', error);

        res.status(500).json({
            success: false,
            error: 'OCR processing failed: ' + error.message
        });
    }
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve API documentation
app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'docs.html'));
});

// Serve OpenAPI spec
app.get('/api-spec.yaml', (req, res) => {
    res.sendFile(path.join(__dirname, 'api-spec.yaml'));
});

// TrOCR status and installation endpoints
app.get('/api/trocr/status', (req, res) => {
    res.json({
        available: trocrIntegration.isAvailable,
        message: trocrIntegration.isAvailable ? 
            'TrOCR is available for cursive handwriting recognition' : 
            'TrOCR not available - install Python dependencies to enable'
    });
});

app.post('/api/trocr/install', async (req, res) => {
    try {
        const success = await trocrIntegration.installDependencies();
        res.json({
            success,
            message: success ? 
                'TrOCR dependencies installed successfully' : 
                'Failed to install TrOCR dependencies'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Installation failed: ' + error.message
        });
    }
});

// Add new marriage license record
app.post('/api/licenses', upload.single('document'), (req, res) => {
    console.log('Add license route called');
    const { name_spouse1, name_spouse2, marriage_date, license_number } = req.body;

    if (!req.file) {
        console.log('No file uploaded to licenses endpoint');
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.filename;
    const originalFilename = req.file.originalname;
    console.log('File uploaded for license:', filePath, 'Original:', originalFilename);

    const sql = `
        INSERT INTO marriage_licenses 
        (name_spouse1, name_spouse2, marriage_date, license_number, file_path, original_filename)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [name_spouse1, name_spouse2, marriage_date, license_number, filePath, originalFilename], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to save record' });
        }

        console.log('Marriage license record added, ID:', this.lastID);

        res.json({
            success: true,
            id: this.lastID,
            message: 'Marriage license record added successfully'
        });
    });
});

// Search marriage licenses
app.get('/api/licenses', (req, res) => {
    const { id, name, date_from, date_to, license_number } = req.query;
    
    let sql = 'SELECT * FROM marriage_licenses WHERE 1=1';
    let params = [];
    
    if (id) {
        sql += ' AND id = ?';
        params.push(id);
    }
    
    if (name) {
        sql += ' AND (name_spouse1 LIKE ? OR name_spouse2 LIKE ?)';
        params.push(`%${name}%`, `%${name}%`);
    }
    
    if (date_from) {
        sql += ' AND marriage_date >= ?';
        params.push(date_from);
    }
    
    if (date_to) {
        sql += ' AND marriage_date <= ?';
        params.push(date_to);
    }
    
    if (license_number) {
        sql += ' AND license_number LIKE ?';
        params.push(`%${license_number}%`);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to search records' });
        }
        
        res.json(rows);
    });
});

// Get specific marriage license by ID
app.get('/api/licenses/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM marriage_licenses WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to fetch record' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        res.json(row);
    });
});

// Serve uploaded files
app.get('/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    // Set appropriate headers based on file extension
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') {
        res.setHeader('Content-Type', 'application/pdf');
    } else if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
        res.setHeader('Content-Type', `image/${ext.substring(1)}`);
    }
    
    res.sendFile(filePath);
});

// Delete marriage license record
app.delete('/api/licenses/:id', (req, res) => {
    const { id } = req.params;
    
    // First get the record to find the file path
    db.get('SELECT file_path FROM marriage_licenses WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        // Delete the record from database
        db.run('DELETE FROM marriage_licenses WHERE id = ?', [id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete record' });
            }
            
            // Delete the file
            const filePath = path.join(__dirname, 'uploads', row.file_path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            res.json({ success: true, message: 'Record deleted successfully' });
        });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Make sure you have created the following directories:');
    console.log('- public/ (for HTML, CSS, JS files)');
    console.log('- uploads/ (for uploaded documents)');
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

function normalizeWhitespace(str) {
    return (str || '').replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function makeField(value, confidence) {
    return { value: value || '', confidence: Number.isFinite(confidence) ? confidence : 0 };
}

function extractFieldsFromText(text) {
    const fields = {};
    const lines = normalizeWhitespace(text).split(/\n+/).map(l => l.trim());
    const joined = lines.join('\n');

    // License/Application number
    let licenseNumber = null;
    let m = joined.match(/Application\s*No\.?\s*([A-Z0-9\-]+)/i) || joined.match(/License\s*(?:No\.|Number)\s*[:#]?\s*([A-Z0-9\-]+)/i);
    if (m) licenseNumber = m[1];

    // Names after "I, <Name>" in male/female affidavit sections
    // We look for first significant comma segment after "I," lines
    let maleAff = lines.find(l => /affidavit\s*of\s*male/i.test(l));
    let femaleAff = lines.find(l => /affidavit\s*of\s*female/i.test(l));

    function findNameAfterI(sectionIndexStart) {
        if (sectionIndexStart < 0) return null;
        for (let i = sectionIndexStart; i < Math.min(sectionIndexStart + 8, lines.length); i++) {
            const line = lines[i];
            const nm = line.match(/\bI[, ]+([^,]+?)(?:,|\sof|\sdesir|\sdo\b)/i);
            if (nm && nm[1]) return nm[1].trim();
        }
        return null;
    }

    const maleIndex = lines.findIndex(l => /affidavit\s*of\s*male/i.test(l));
    const femaleIndex = lines.findIndex(l => /affidavit\s*of\s*female/i.test(l));
    let groomName = findNameAfterI(maleIndex);
    let brideName = findNameAfterI(femaleIndex);

    // Date: look for "day of <Month> <year>" or typical formats
    let dateValue = null;
    m = joined.match(/day\s+of\s+([A-Za-z]+)\s+(\d{1,2})?,?\s*(\d{4})/i);
    if (m) {
        const month = m[1];
        const day = m[2] ? m[2].padStart(2, '0') : '01';
        const year = m[3];
        dateValue = `${year}-${month}-${day}`; // keep human-ish, frontend may reformat
    } else {
        m = joined.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
        if (m) dateValue = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }

    // We cannot compute OCR confidences from pdf-parse text; default mid confidence.
    // True word-level confidences are added later when using Tesseract output metadata.
    fields.license_number = makeField(licenseNumber, 0.6);
    fields.name_spouse1 = makeField(brideName || groomName, 0.6); // spouse1 arbitrary
    fields.name_spouse2 = makeField(groomName || brideName, 0.6);
    fields.marriage_date = makeField(dateValue, 0.6);
    return fields;
}

// Update your extractTextFromDocument function:
async function extractTextFromDocument(filePath) {
    const warnings = [];
    try {
        console.log('Starting OCR for file:', filePath);
        const ext = path.extname(filePath).toLowerCase();
        let text = '';
        let fieldsWithConfidence = {};

        if (ext === '.pdf') {
            try {
                const dataBuffer = fs.readFileSync(filePath);
                const pdfData = await pdfParse(dataBuffer);
                text = normalizeWhitespace(pdfData.text || '');
                if (!text.trim()) warnings.push('PDF text empty; falling back to OCR');
            } catch (err) {
                warnings.push('PDF parse failed; falling back to OCR');
            }
        }

        // If no text yet, use Tesseract OCR
        if (!text || text.trim().length < 20) {
            const result = await Tesseract.recognize(filePath, 'eng', {
                tessedit_char_blacklist: '{}[]<>',
            });
            text = normalizeWhitespace(result.data.text || '');

            // Build word index for confidences
            const words = Array.isArray(result.data.words) ? result.data.words : [];
            const joinedLower = text.toLowerCase();
            function confidenceForRegex(regex) {
                const match = joinedLower.match(regex);
                if (!match || !match[1]) return 0.5;
                const value = match[1].trim();
                // Approximate: average confidence of words that appear in the value
                const tokens = value.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
                if (tokens.length === 0) return 0.5;
                const tokenConf = tokens.map(tok => {
                    const w = words.find(wd => (wd.text || '').toLowerCase().includes(tok));
                    return w ? (wd.confidence || 0) / 100 : 0.5;
                });
                return tokenConf.reduce((a, b) => a + b, 0) / tokenConf.length;
            }

            // Extract using multiple regex patterns for better cursive handling
            const fields = {};
            
            // License number patterns (more flexible)
            const licPatterns = [
                /application\s*no\.?\s*([a-z0-9\-]+)/i,
                /license\s*(?:no\.|number)\s*[:#]?\s*([a-z0-9\-]+)/i,
                /no\.?\s*([0-9]+)/i
            ];
            
            // Name patterns (more flexible for cursive)
            const malePatterns = [
                /affidavit\s*of\s*male[\s\S]{0,200}?\bI[, ]+([^,\n]+?)(?:,|\sof|\sdesir|\sdo\b)/i,
                /male[\s\S]{0,100}?I[, ]+([^,\n]+?)(?:,|\sof|\sdesir|\sdo\b)/i,
                /I[, ]+([A-Za-z\s]+?)(?:,|\sof|\sdesir|\sdo\b)/i
            ];
            
            const femalePatterns = [
                /affidavit\s*of\s*female[\s\S]{0,200}?\bI[, ]+([^,\n]+?)(?:,|\sof|\sdo\b)/i,
                /female[\s\S]{0,100}?I[, ]+([^,\n]+?)(?:,|\sof|\sdo\b)/i,
                /Miss\s+([A-Za-z\s]+?)(?:,|\sof|\sdo\b)/i
            ];
            
            // Date patterns (more flexible)
            const datePatterns = [
                /day\s+of\s+([A-Za-z]+)\s+(\d{1,2})?,?\s*(\d{4})/i,
                /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/,
                /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/,
                /([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/i
            ];

            // Try each pattern and pick the best match
            let licVal = '';
            let licConf = 0;
            for (const pattern of licPatterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    const conf = confidenceForRegex(pattern);
                    if (conf > licConf) {
                        licVal = match[1].trim();
                        licConf = conf;
                    }
                }
            }

            let groomVal = '';
            let groomConf = 0;
            for (const pattern of malePatterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    const conf = confidenceForRegex(pattern);
                    if (conf > groomConf) {
                        groomVal = match[1].trim();
                        groomConf = conf;
                    }
                }
            }

            let brideVal = '';
            let brideConf = 0;
            for (const pattern of femalePatterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    const conf = confidenceForRegex(pattern);
                    if (conf > brideConf) {
                        brideVal = match[1].trim();
                        brideConf = conf;
                    }
                }
            }

            let dateVal = '';
            let dateConf = 0;
            for (const pattern of datePatterns) {
                const match = text.match(pattern);
                if (match) {
                    const conf = confidenceForRegex(pattern);
                    if (conf > dateConf) {
                        // Format date based on pattern
                        if (pattern.source.includes('day\\s+of')) {
                            const month = match[1];
                            const day = match[2] ? match[2].padStart(2, '0') : '01';
                            const year = match[3];
                            dateVal = `${year}-${month}-${day}`;
                        } else if (pattern.source.includes('(\\\\d{4})[-\/]')) {
                            dateVal = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
                        } else {
                            dateVal = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
                        }
                        dateConf = conf;
                    }
                }
            }

            fields.license_number = makeField(licVal, licConf);
            fields.name_spouse1 = makeField(brideVal || groomVal, brideVal ? brideConf : groomConf);
            fields.name_spouse2 = makeField(groomVal || brideVal, groomVal ? groomConf : brideConf);
            fields.marriage_date = makeField(dateVal, dateConf);

            fieldsWithConfidence = fields;
        } else {
            fieldsWithConfidence = extractFieldsFromText(text);
        }

        // Determine verification need
        const threshold = 0.8;
        const needsVerification = Object.values(fieldsWithConfidence).some(f => !f.value || f.value.trim().length === 0 || (f.confidence || 0) < threshold);

        console.log('OCR text output length:', text.length);
        console.log('Extracted fields:', fieldsWithConfidence);
        return { text, extractedFields: fieldsWithConfidence, needsVerification, warnings, error: null };
    } catch (error) {
        console.error('Error during OCR:', error);
        return { text: '', extractedFields: {}, needsVerification: true, warnings, error: error.message };
    }
}