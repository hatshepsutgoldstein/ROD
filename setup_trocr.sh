#!/bin/bash

# TrOCR Setup Script for ROD Marriage License System
# This script installs Python dependencies for TrOCR cursive handwriting recognition

echo "🔧 Setting up TrOCR for cursive handwriting recognition..."

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or later."
    exit 1
fi

# Check if pip3 is available
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip3."
    exit 1
fi

echo "✅ Python 3 and pip3 are available"

# Install Python dependencies
echo "📦 Installing TrOCR dependencies..."
pip3 install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ TrOCR dependencies installed successfully!"
    echo ""
    echo "🚀 TrOCR is now ready for cursive handwriting recognition!"
    echo "   - Upload cursive documents to test the improved OCR"
    echo "   - TrOCR will automatically activate when standard OCR fails"
    echo "   - Check status at: http://localhost:3000/api/trocr/status"
else
    echo "❌ Failed to install TrOCR dependencies"
    echo "   Please check the error messages above and try again"
    exit 1
fi
