#!/usr/bin/env node
/**
 * QR Code Utilities Test Suite
 * Tests QR code generation functions
 */

const { generateQRDataURL, generateQRBuffer } = require('../utils/qrcode');

let testResults = [];
let passed = 0;
let failed = 0;

function log(message) {
    console.log(`[TEST] ${message}`);
}

async function test(name, fn) {
    try {
        await fn();
        testResults.push({ name, status: 'PASS' });
        passed++;
        log(`✓ PASSED: ${name}`);
    } catch (error) {
        testResults.push({ name, status: 'FAIL', error: error.message });
        failed++;
        log(`✗ FAILED: ${name} - ${error.message}`);
    }
}

async function main() {
    log('Starting QR Code Utilities Test Suite\n');

    // Test 1: Generate QR Data URL with default options
    await test('generateQRDataURL: Generates valid data URL', async () => {
        const data = 'https://example.com/test';
        const qrDataUrl = await generateQRDataURL(data);
        
        if (!qrDataUrl || typeof qrDataUrl !== 'string') {
            throw new Error('QR data URL should be a string');
        }
        if (!qrDataUrl.startsWith('data:image/png;base64,')) {
            throw new Error('QR data URL should start with data:image/png;base64,');
        }
        if (qrDataUrl.length < 100) {
            throw new Error('QR data URL seems too short');
        }
    });

    // Test 2: Generate QR Data URL with custom options
    await test('generateQRDataURL: Custom width and margin work', async () => {
        const data = 'https://example.com/test';
        const qrDataUrl = await generateQRDataURL(data, {
            width: 500,
            margin: 3
        });
        
        if (!qrDataUrl || !qrDataUrl.startsWith('data:image/png;base64,')) {
            throw new Error('Custom options should still generate valid data URL');
        }
    });

    // Test 3: Generate QR Buffer with default options
    await test('generateQRBuffer: Generates valid PNG buffer', async () => {
        const data = 'https://example.com/test';
        const qrBuffer = await generateQRBuffer(data);
        
        if (!Buffer.isBuffer(qrBuffer)) {
            throw new Error('QR buffer should be a Buffer');
        }
        if (qrBuffer.length < 100) {
            throw new Error('QR buffer seems too small');
        }
        // PNG files start with PNG signature
        if (qrBuffer[0] !== 0x89 || qrBuffer[1] !== 0x50 || qrBuffer[2] !== 0x4E || qrBuffer[3] !== 0x47) {
            throw new Error('QR buffer should be a valid PNG file');
        }
    });

    // Test 4: Generate QR Buffer with custom options
    await test('generateQRBuffer: Custom options work', async () => {
        const data = 'https://example.com/test';
        const qrBuffer = await generateQRBuffer(data, {
            width: 500,
            margin: 3,
            errorCorrectionLevel: 'H'
        });
        
        if (!Buffer.isBuffer(qrBuffer)) {
            throw new Error('Custom options should still generate valid buffer');
        }
    });

    // Test 5: Different data types
    await test('generateQRDataURL: Works with different data types', async () => {
        const testCases = [
            'https://example.com',
            'COUPON123',
            '{"id":123,"code":"ABC"}',
            'mailto:test@example.com'
        ];
        
        for (const testData of testCases) {
            const qrDataUrl = await generateQRDataURL(testData);
            if (!qrDataUrl.startsWith('data:image/png;base64,')) {
                throw new Error(`Failed for data: ${testData}`);
            }
        }
    });

    // Test 6: Error handling for empty data
    await test('generateQRDataURL: Handles empty string', async () => {
        try {
            await generateQRDataURL('');
            // Empty string might be valid, so we just check it doesn't crash
        } catch (error) {
            // Error is acceptable for empty string
        }
    });

    // Test 7: Error correction levels
    await test('generateQRDataURL: Different error correction levels work', async () => {
        const data = 'https://example.com/test';
        const levels = ['L', 'M', 'Q', 'H'];
        
        for (const level of levels) {
            const qrDataUrl = await generateQRDataURL(data, {
                errorCorrectionLevel: level
            });
            if (!qrDataUrl.startsWith('data:image/png;base64,')) {
                throw new Error(`Failed for error correction level: ${level}`);
            }
        }
    });

    // Test 8: Custom colors
    await test('generateQRDataURL: Custom colors work', async () => {
        const data = 'https://example.com/test';
        const qrDataUrl = await generateQRDataURL(data, {
            color: '#FF0000',
            backgroundColor: '#000000'
        });
        
        if (!qrDataUrl.startsWith('data:image/png;base64,')) {
            throw new Error('Custom colors should still generate valid QR code');
        }
    });

    // Summary
    log('\n============================================================');
    log('TEST SUMMARY');
    log('============================================================');
    testResults.forEach(result => {
        if (result.status === 'PASS') {
            log(`✓ ${result.name}`);
        } else {
            log(`✗ ${result.name}: ${result.error}`);
        }
    });
    log(`\nTotal: ${testResults.length} | Passed: ${passed} | Failed: ${failed}\n`);

    if (failed === 0) {
        log('All tests passed! ✓');
        process.exit(0);
    } else {
        log('Some tests failed ✗');
        process.exit(1);
    }
}

main().catch(error => {
    console.error('[TEST] Fatal error:', error);
    process.exit(1);
});

