#!/usr/bin/env python3
"""
Test script for TrOCR integration
Tests the TrOCR service with a sample image
"""

import sys
import os
from trocr_service import TrOCRService

def test_trocr():
    """Test TrOCR service"""
    print("🧪 Testing TrOCR service...")
    
    # Initialize service
    service = TrOCRService()
    
    # Load model
    if not service.load_model():
        print("❌ Failed to load TrOCR model")
        return False
    
    print("✅ TrOCR model loaded successfully")
    
    # Test with a sample image if provided
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
        if os.path.exists(image_path):
            print(f"📷 Testing with image: {image_path}")
            result = service.extract_marriage_license_fields(image_path)
            
            print("\n📋 TrOCR Results:")
            print(f"Success: {result['success']}")
            print(f"Raw Text: {result.get('raw_text', '')[:100]}...")
            
            if result['success']:
                print("\n📝 Extracted Fields:")
                for field, data in result.items():
                    if isinstance(data, dict) and 'value' in data:
                        print(f"  {field}: {data['value']} (confidence: {data['confidence']:.2f})")
            else:
                print(f"Error: {result.get('error', 'Unknown error')}")
        else:
            print(f"❌ Image file not found: {image_path}")
    else:
        print("ℹ️  No test image provided. TrOCR service is ready.")
        print("   Usage: python test_trocr.py <image_path>")
    
    return True

if __name__ == "__main__":
    success = test_trocr()
    sys.exit(0 if success else 1)
