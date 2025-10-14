const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * TrOCR Integration for ROD Marriage License System
 * Calls Python TrOCR service for cursive handwriting recognition
 */

class TrOCRIntegration {
    constructor() {
        this.pythonPath = process.env.PYTHON_PATH || 'python3';
        this.trocrScript = path.join(__dirname, 'trocr_service.py');
        this.isAvailable = this.checkTrOCRAvailability();
    }

    async checkTrOCRAvailability() {
        try {
            // Check if Python and required packages are available
            const result = await this.runCommand(this.pythonPath, ['-c', 'import torch, transformers, PIL; print("OK")']);
            return result.success;
        } catch (error) {
            console.warn('TrOCR not available:', error.message);
            return false;
        }
    }

    async runCommand(command, args, options = {}) {
        return new Promise((resolve) => {
            const process = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                ...options
            });

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                resolve({
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    code
                });
            });

            process.on('error', (error) => {
                resolve({
                    success: false,
                    stdout: '',
                    stderr: error.message,
                    code: -1
                });
            });
        });
    }

    async extractTextWithTrOCR(imagePath) {
        if (!this.isAvailable) {
            return {
                success: false,
                error: 'TrOCR not available - Python dependencies not installed',
                text: '',
                extractedFields: {},
                needsVerification: true
            };
        }

        try {
            console.log('Running TrOCR on:', imagePath);
            
            const result = await this.runCommand(this.pythonPath, [this.trocrScript, imagePath]);
            
            if (!result.success) {
                console.error('TrOCR execution failed:', result.stderr);
                return {
                    success: false,
                    error: `TrOCR execution failed: ${result.stderr}`,
                    text: '',
                    extractedFields: {},
                    needsVerification: true
                };
            }

            const trocrResult = JSON.parse(result.stdout);
            
            if (!trocrResult.success) {
                return {
                    success: false,
                    error: trocrResult.error || 'TrOCR processing failed',
                    text: trocrResult.raw_text || '',
                    extractedFields: {},
                    needsVerification: true
                };
            }

            // Convert TrOCR result to our format
            const extractedFields = {
                license_number: trocrResult.license_number || { value: '', confidence: 0 },
                name_spouse1: trocrResult.name_spouse1 || { value: '', confidence: 0 },
                name_spouse2: trocrResult.name_spouse2 || { value: '', confidence: 0 },
                marriage_date: trocrResult.marriage_date || { value: '', confidence: 0 }
            };

            // Determine if verification is needed
            const needsVerification = Object.values(extractedFields).some(field => 
                !field.value || field.value.trim().length === 0 || field.confidence < 0.6
            );

            return {
                success: true,
                text: trocrResult.raw_text || '',
                extractedFields,
                needsVerification,
                warnings: ['Processed with TrOCR for cursive handwriting'],
                error: null
            };

        } catch (error) {
            console.error('TrOCR integration error:', error);
            return {
                success: false,
                error: `TrOCR integration error: ${error.message}`,
                text: '',
                extractedFields: {},
                needsVerification: true
            };
        }
    }

    async installDependencies() {
        console.log('Installing TrOCR Python dependencies...');
        
        const result = await this.runCommand('pip3', ['install', '-r', 'requirements.txt']);
        
        if (result.success) {
            console.log('TrOCR dependencies installed successfully');
            this.isAvailable = true;
            return true;
        } else {
            console.error('Failed to install TrOCR dependencies:', result.stderr);
            return false;
        }
    }
}

module.exports = TrOCRIntegration;
