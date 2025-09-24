# Marriage License Database with OCR

A comprehensive system for processing scanned marriage licenses using Optical Character Recognition (OCR) and storing the extracted data in a SQLite database.

## Features

- **Automatic Data Extraction**: Upload scanned marriage licenses (PDF, JPG, PNG, TIFF) and automatically extract:
  - Spouse names
  - Marriage dates
  - License numbers
- **Manual Data Entry**: Fill in forms manually if OCR doesn't extract all data
- **Database Storage**: SQLite database for reliable data storage
- **Search & Browse**: Search through marriage license records
- **File Management**: View original documents and manage files
- **LAN-Only**: Designed for local network use

## Technologies Used

- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **OCR**: Tesseract.js (for images), pdf-parse (for PDFs)
- **Image Processing**: Sharp (for image optimization)
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)

## Installation

1. **Clone or download the project**
2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Access the application**:
   Open your browser and go to `http://localhost:3000`

## Usage

### Adding Marriage Licenses

1. **Automatic Extraction**:
   - Click on the "Add License" tab
   - In the "Automatic Data Extraction" section, upload a scanned marriage license
   - Click "Process Document" to extract data using OCR
   - Review the extracted data and click "Use Extracted Data" to populate the form
   - Upload the same document in the main form and submit

2. **Manual Entry**:
   - Fill in the form fields manually
   - Upload the document file
   - Submit the form

### Searching Records

1. Click on the "Search" tab
2. Use any combination of search criteria:
   - Record ID
   - Spouse name
   - Date range
   - License number
3. Click "Search" to view results
4. Use "View" to see the original document
5. Use "Delete" to remove records

## OCR Capabilities

The system uses advanced OCR processing to extract data from various marriage license formats:

### Supported File Types
- **Images**: JPG, JPEG, PNG, TIFF
- **Documents**: PDF

### Data Extraction Patterns
- **Names**: Looks for patterns like "Bride Name:", "Groom Name:", "Spouse Name:", etc.
- **Dates**: Recognizes various date formats (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
- **License Numbers**: Extracts license/certificate numbers

### Image Processing
- Automatically optimizes images for better OCR accuracy
- Resizes large images while maintaining quality
- Applies sharpening and normalization

## Database Schema

```sql
CREATE TABLE marriage_licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_spouse1 TEXT,
    name_spouse2 TEXT,
    marriage_date DATE,
    license_number TEXT,
    file_path TEXT,
    original_filename TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

- `POST /api/ocr` - Process document with OCR
- `POST /api/licenses` - Add new marriage license record
- `GET /api/licenses` - Search marriage licenses
- `GET /api/licenses/:id` - Get specific record
- `DELETE /api/licenses/:id` - Delete record
- `GET /uploads/:filename` - Serve uploaded files

## File Structure

```
app/
├── server.js              # Main server file
├── package.json           # Dependencies and scripts
├── database.db           # SQLite database
├── public/
│   ├── index.html        # Frontend interface
│   └── style.css         # Styling
├── uploads/              # Uploaded documents
└── routes/               # API routes (if needed)
```

## Troubleshooting

### OCR Not Working
- Ensure the image is clear and high resolution
- Try different file formats (PNG often works better than JPG)
- Check that the text in the image is not too small or blurry

### Server Issues
- Make sure port 3000 is available
- Check that all dependencies are installed
- Verify the uploads directory exists and is writable

### Database Issues
- The database file will be created automatically
- Check file permissions for the database.db file

## Performance Notes

- OCR processing can take 10-30 seconds depending on image size and complexity
- Large images are automatically resized for better performance
- The system is optimized for LAN use and may not be suitable for high-traffic internet use

## Security Considerations

- This system is designed for LAN-only use
- No authentication is implemented
- Consider adding security measures for production use
- File uploads are limited to 10MB and specific file types

## Future Enhancements

- Batch processing of multiple documents
- Advanced data validation
- Export functionality (CSV, PDF reports)
- User authentication and role management
- Backup and restore functionality
- Advanced search filters
