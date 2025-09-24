const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');

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

// OCR Processing Functions
async function extractTextFromDocument(filePath) {
    try {
        const ext = path.extname(filePath).toLowerCase();
        let text = '';
        
        if (ext === '.pdf') {
            // Handle PDF files
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            text = data.text;
        } else {
            // Handle image files
            // First, optimize the image for better OCR
            const optimizedPath = filePath.replace(/\.[^/.]+$/, '_optimized.png');
            
            await sharp(filePath)
                .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
                .normalize()
                .sharpen()
                .png()
                .toFile(optimizedPath);
            
            // Perform OCR on the optimized image
            const { data: { text: ocrText } } = await Tesseract.recognize(
                optimizedPath,
                'eng',
                {
                    logger: m => console.log(m)
                }
            );
            
            text = ocrText;
            
            // Clean up optimized image
            if (fs.existsSync(optimizedPath)) {
                fs.unlinkSync(optimizedPath);
            }
        }
        
        // Extract structured data from the text
        const extractedFields = extractMarriageLicenseData(text);
        
        // Debug logging
        console.log('OCR Text:', text);
        console.log('Extracted Fields:', extractedFields);
        
        return {
            text: text,
            extractedFields: extractedFields,
            error: null
        };
    } catch (error) {
        console.error('OCR Error:', error);
        return {
            text: '',
            extractedFields: {},
            error: error.message
        };
    }
}

// Extract structured data from marriage license text
function extractMarriageLicenseData(text) {
    const fields = {
        name_spouse1: '',
        name_spouse2: '',
        marriage_date: '',
        license_number: ''
    };
    
    // Convert text to lowercase for pattern matching
    const lowerText = text.toLowerCase();
    
    // Extract names - look for common patterns with better separation
    const bridePatterns = [
        /(?:bride|bride's?)[\s\S]*?name[:\s]*([a-z\s,.-]+?)(?:\s+(?:groom|husband|marriage|date)|$)/gi,
        /(?:bride|bride's?)[\s\S]*?name[:\s]*([a-z\s,.-]+?)(?:\n|$)/gi,
        /(?:first|given)[\s\S]*?name[:\s]*([a-z\s,.-]+?)(?:\s+(?:groom|husband|marriage|date)|$)/gi
    ];
    
    const groomPatterns = [
        /(?:groom|groom's?|husband)[\s\S]*?name[:\s]*([a-z\s,.-]+?)(?:\s+(?:bride|wife|marriage|date)|$)/gi,
        /(?:groom|groom's?|husband)[\s\S]*?name[:\s]*([a-z\s,.-]+?)(?:\n|$)/gi,
        /(?:last|family|surname)[\s\S]*?name[:\s]*([a-z\s,.-]+?)(?:\s+(?:marriage|date)|$)/gi
    ];
    
    // Extract dates - look for various date formats
    const datePatterns = [
        /(?:marriage|wedding|ceremony)[\s\S]*?date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/gi,
        /(?:date[:\s]*)(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/gi,
        /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/g
    ];
    
    // Extract license numbers - improved patterns
    const licensePatterns = [
        /(?:license|certificate|record)[\s\S]*?(?:number|no\.?)[:\s]*([a-z0-9\-\s]+?)(?:\s|$)/gi,
        /(?:license|certificate)[\s\S]*?(?:number|no\.?)[:\s]*([a-z0-9\-\s]+?)(?:\n|$)/gi,
        /(?:number|no\.?)[:\s]*([a-z0-9\-\s]+?)(?:\s|$)/gi,
        /(?:license|certificate)[\s\S]*?([a-z0-9\-\s]{3,20})(?:\s|$)/gi,
        /(?:ml-|ml|license)[\s\S]*?([a-z0-9\-\s]{3,20})(?:\s|$)/gi
    ];
    
    // Helper function to clean extracted names
    function cleanName(name) {
        return name
            .trim()
            .replace(/[^\w\s,.-]/g, '') // Remove special characters except letters, numbers, spaces, commas, dots, hyphens
            .replace(/\s+(?:marriage|date|groom|bride|husband|wife)\s*.*$/i, '') // Remove trailing keywords
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
    
    // Try to extract bride name
    for (const pattern of bridePatterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            const cleanedName = cleanName(match[1]);
            if (cleanedName.length > 2 && cleanedName.length < 50) {
                fields.name_spouse1 = cleanedName;
                break;
            }
        }
        if (fields.name_spouse1) break;
    }
    
    // Try to extract groom name
    for (const pattern of groomPatterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            const cleanedName = cleanName(match[1]);
            if (cleanedName.length > 2 && cleanedName.length < 50) {
                fields.name_spouse2 = cleanedName;
                break;
            }
        }
        if (fields.name_spouse2) break;
    }
    
    // Fallback: if we still don't have both names, try generic patterns
    if (!fields.name_spouse1 || !fields.name_spouse2) {
        const genericPatterns = [
            /(?:name[:\s]*)([a-z\s,.-]+?)(?:\s+(?:groom|husband|bride|wife)|$)/gi,
            /(?:name[:\s]*)([a-z\s,.-]+)/gi
        ];
        
        let allNames = [];
        for (const pattern of genericPatterns) {
            const matches = [...text.matchAll(pattern)];
            for (const match of matches) {
                const cleanedName = cleanName(match[1]);
                if (cleanedName.length > 2 && cleanedName.length < 50 && !allNames.includes(cleanedName)) {
                    allNames.push(cleanedName);
                }
            }
        }
        
        // Assign names if we found them
        if (allNames.length > 0 && !fields.name_spouse1) {
            fields.name_spouse1 = allNames[0];
        }
        if (allNames.length > 1 && !fields.name_spouse2) {
            fields.name_spouse2 = allNames[1];
        }
    }
    
    // Try to extract dates
    for (const pattern of datePatterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            const dateStr = match[1].trim();
            const parsedDate = parseDate(dateStr);
            if (parsedDate) {
                fields.marriage_date = parsedDate;
                break;
            }
        }
        if (fields.marriage_date) break;
    }
    
    // Helper function to clean license numbers
    function cleanLicense(license) {
        return license
            .trim()
            .replace(/[^\w\s-]/g, '') // Remove special characters except letters, numbers, spaces, hyphens
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
    
    // Try to extract license number
    for (const pattern of licensePatterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            const cleanedLicense = cleanLicense(match[1]);
            // More flexible length check and better validation
            if (cleanedLicense.length >= 3 && cleanedLicense.length <= 25 && 
                /[a-z0-9]/i.test(cleanedLicense)) { // Must contain at least one letter or number
                fields.license_number = cleanedLicense;
                break;
            }
        }
        if (fields.license_number) break;
    }
    
    return fields;
}

// Parse various date formats
function parseDate(dateStr) {
    const formats = [
        /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/,
        /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
        /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/
    ];
    
    for (const format of formats) {
        const match = dateStr.match(format);
        if (match) {
            let month, day, year;
            
            if (format === formats[2]) { // YYYY-MM-DD format
                [, year, month, day] = match;
            } else { // MM-DD-YYYY or MM-DD-YY format
                [, month, day, year] = match;
            }
            
            // Convert 2-digit year to 4-digit
            if (year.length === 2) {
                year = parseInt(year) > 50 ? '19' + year : '20' + year;
            }
            
            // Validate date
            const date = new Date(year, month - 1, day);
            if (date.getFullYear() == year && date.getMonth() == month - 1 && date.getDate() == day) {
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
        }
    }
    
    return null;
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
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    
    try {
        const ocrResult = await extractTextFromDocument(filePath);
        
        // Clean up temporary file
        fs.unlinkSync(filePath);
        
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
        }
        
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
    const { name_spouse1, name_spouse2, marriage_date, license_number } = req.body;
    
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.filename;
    const originalFilename = req.file.originalname;
    
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
    
    // Debug logging
    console.log('Search query:', { id, name, date_from, date_to, license_number });
    
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
    
    console.log('SQL Query:', sql);
    console.log('SQL Params:', params);
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to search records' });
        }
        
        console.log('Search results:', rows);
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