#!/usr/bin/env python3
"""
TrOCR Service for ROD Marriage License System
Handles cursive handwriting recognition using Microsoft's TrOCR model
"""

import json
import sys
import os
from pathlib import Path
from PIL import Image
import torch
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TrOCRService:
    def __init__(self, model_name="microsoft/trocr-base-handwritten"):
        """Initialize TrOCR service with specified model"""
        self.model_name = model_name
        self.processor = None
        self.model = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Initializing TrOCR with device: {self.device}")
        
    def load_model(self):
        """Load TrOCR model and processor"""
        try:
            logger.info(f"Loading TrOCR model: {self.model_name}")
            self.processor = TrOCRProcessor.from_pretrained(self.model_name)
            self.model = VisionEncoderDecoderModel.from_pretrained(self.model_name)
            self.model.to(self.device)
            logger.info("TrOCR model loaded successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to load TrOCR model: {e}")
            return False
    
    def extract_text_from_image(self, image_path, confidence_threshold=0.5):
        """
        Extract text from image using TrOCR
        
        Args:
            image_path: Path to the image file
            confidence_threshold: Minimum confidence for text extraction
            
        Returns:
            dict: {
                'text': extracted text,
                'confidence': average confidence,
                'success': boolean,
                'error': error message if any
            }
        """
        if not self.processor or not self.model:
            return {
                'text': '',
                'confidence': 0.0,
                'success': False,
                'error': 'TrOCR model not loaded'
            }
        
        try:
            # Load and preprocess image
            image = Image.open(image_path).convert('RGB')
            
            # Process image
            pixel_values = self.processor(image, return_tensors="pt").pixel_values
            pixel_values = pixel_values.to(self.device)
            
            # Generate text
            with torch.no_grad():
                generated_ids = self.model.generate(
                    pixel_values,
                    max_length=512,
                    num_beams=5,
                    early_stopping=True,
                    do_sample=False
                )
            
            # Decode text
            generated_text = self.processor.batch_decode(
                generated_ids, 
                skip_special_tokens=True
            )[0]
            
            # Calculate confidence (approximate)
            confidence = self._calculate_confidence(generated_text)
            
            return {
                'text': generated_text.strip(),
                'confidence': confidence,
                'success': True,
                'error': None
            }
            
        except Exception as e:
            logger.error(f"TrOCR extraction failed: {e}")
            return {
                'text': '',
                'confidence': 0.0,
                'success': False,
                'error': str(e)
            }
    
    def _calculate_confidence(self, text):
        """
        Calculate approximate confidence based on text characteristics
        This is a heuristic since TrOCR doesn't provide token-level confidences
        """
        if not text or len(text.strip()) == 0:
            return 0.0
        
        # Basic heuristics for confidence
        confidence = 0.5  # Base confidence
        
        # Increase confidence for longer, more structured text
        if len(text) > 10:
            confidence += 0.1
        if len(text) > 50:
            confidence += 0.1
            
        # Increase confidence for common patterns
        if any(word in text.lower() for word in ['marriage', 'license', 'application', 'affidavit']):
            confidence += 0.2
        if any(char.isdigit() for char in text):
            confidence += 0.1
        if any(char.isupper() for char in text):
            confidence += 0.1
            
        # Decrease confidence for very short or repetitive text
        if len(text) < 5:
            confidence -= 0.2
        if len(set(text.split())) < 3 and len(text.split()) > 5:
            confidence -= 0.1
            
        return min(1.0, max(0.0, confidence))
    
    def extract_marriage_license_fields(self, image_path):
        """
        Extract specific fields from marriage license image
        
        Returns:
            dict: Extracted fields with confidence scores
        """
        result = self.extract_text_from_image(image_path)
        
        if not result['success']:
            return {
                'license_number': {'value': '', 'confidence': 0.0},
                'name_spouse1': {'value': '', 'confidence': 0.0},
                'name_spouse2': {'value': '', 'confidence': 0.0},
                'marriage_date': {'value': '', 'confidence': 0.0},
                'raw_text': result['text'],
                'success': False,
                'error': result['error']
            }
        
        text = result['text']
        base_confidence = result['confidence']
        
        # Extract fields using regex patterns
        fields = self._extract_fields_from_text(text, base_confidence)
        fields['raw_text'] = text
        fields['success'] = True
        fields['error'] = None
        
        return fields
    
    def _extract_fields_from_text(self, text, base_confidence):
        """Extract marriage license fields from TrOCR text"""
        import re
        
        fields = {
            'license_number': {'value': '', 'confidence': 0.0},
            'name_spouse1': {'value': '', 'confidence': 0.0},
            'name_spouse2': {'value': '', 'confidence': 0.0},
            'marriage_date': {'value': '', 'confidence': 0.0}
        }
        
        # License number patterns
        license_patterns = [
            r'application\s*no\.?\s*([a-z0-9\-]+)',
            r'license\s*(?:no\.|number)\s*[:#]?\s*([a-z0-9\-]+)',
            r'no\.?\s*([0-9]+)'
        ]
        
        for pattern in license_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                fields['license_number'] = {
                    'value': match.group(1).strip(),
                    'confidence': base_confidence + 0.1
                }
                break
        
        # Name patterns - look for "I, [Name]" patterns
        name_patterns = [
            r'I[, ]+([A-Za-z\s]+?)(?:,|\sof|\sdesir|\sdo\b)',
            r'Miss\s+([A-Za-z\s]+?)(?:,|\sof|\sdo\b)',
            r'Mr\.?\s+([A-Za-z\s]+?)(?:,|\sof|\sdo\b)'
        ]
        
        names = []
        for pattern in name_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                name = match.strip()
                if len(name) > 2 and name not in names:
                    names.append(name)
        
        if len(names) >= 1:
            fields['name_spouse1'] = {
                'value': names[0],
                'confidence': base_confidence + 0.1
            }
        if len(names) >= 2:
            fields['name_spouse2'] = {
                'value': names[1],
                'confidence': base_confidence + 0.1
            }
        
        # Date patterns
        date_patterns = [
            r'day\s+of\s+([A-Za-z]+)\s+(\d{1,2})?,?\s*(\d{4})',
            r'(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})',
            r'(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})',
            r'([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})'
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                if 'day of' in pattern:
                    month = match.group(1)
                    day = match.group(2) or '01'
                    year = match.group(3)
                    date_value = f"{year}-{month}-{day.zfill(2)}"
                elif pattern.startswith(r'(\d{4})'):
                    date_value = f"{match.group(1)}-{match.group(2).zfill(2)}-{match.group(3).zfill(2)}"
                else:
                    date_value = f"{match.group(3)}-{match.group(1).zfill(2)}-{match.group(2).zfill(2)}"
                
                fields['marriage_date'] = {
                    'value': date_value,
                    'confidence': base_confidence + 0.1
                }
                break
        
        return fields

def main():
    """Main function for command-line usage"""
    if len(sys.argv) != 2:
        print("Usage: python trocr_service.py <image_path>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    if not os.path.exists(image_path):
        print(f"Error: Image file not found: {image_path}")
        sys.exit(1)
    
    # Initialize TrOCR service
    service = TrOCRService()
    
    if not service.load_model():
        print("Error: Failed to load TrOCR model")
        sys.exit(1)
    
    # Extract fields
    result = service.extract_marriage_license_fields(image_path)
    
    # Output JSON result
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
