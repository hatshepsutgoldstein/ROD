const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = 3000;

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
    console.log('OCR route called'); // Already present
    if (!req.file) {
        console.log('No file uploaded to OCR endpoint');
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    console.log('File uploaded for OCR:', filePath);

    try {
        const ocrResult = await extractTextFromDocument(filePath);
        console.log('OCR result:', ocrResult);

        // Clean up temporary file
        fs.unlinkSync(filePath);
        console.log('Temporary file deleted:', filePath);

        res.json({
            success: true,
            extractedText: ocrResult.text,
            extractedFields: ocrResult.extractedFields,
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

function extractFieldsFromText(text) {
    const fields = {};
    const licenseMatch = text.match(/License Number:\s*(.+)/i);
    const brideMatch = text.match(/Bride Name:\s*(.+)/i);
    const groomMatch = text.match(/Groom Name:\s*(.+)/i);
    const dateMatch = text.match(/Marriage Date:\s*(.+)/i);

    if (licenseMatch) fields.license_number = licenseMatch[1].trim();
    if (brideMatch) fields.name_spouse1 = brideMatch[1].trim();
    if (groomMatch) fields.name_spouse2 = groomMatch[1].trim();
    if (dateMatch) fields.marriage_date = dateMatch[1].trim();

    return fields;
}

// Update your extractTextFromDocument function:
async function extractTextFromDocument(filePath) {
    try {
        console.log('Starting OCR for file:', filePath);
        const result = await Tesseract.recognize(filePath, 'eng');
        const text = result.data.text;
        console.log('OCR text output:', text);
        const extractedFields = extractFieldsFromText(text);
        console.log('Extracted fields:', extractedFields);
        return { text, extractedFields, error: null };
    } catch (error) {
        console.error('Error during OCR:', error);
        return { text: '', extractedFields: {}, error: error.message };
    }
}