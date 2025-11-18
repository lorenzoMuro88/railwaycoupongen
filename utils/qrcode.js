'use strict';

/**
 * QR Code Utilities Module
 * 
 * Provides functions to generate QR codes in different formats for use in the application.
 * QR codes are used to encode coupon codes and redemption URLs for easy scanning.
 * 
 * @module utils/qrcode
 * @see {@link https://www.npmjs.com/package/qrcode} qrcode npm package documentation
 */

const QRCode = require('qrcode');

/**
 * Generate QR code as Data URL (for web preview)
 * 
 * Generates a QR code and returns it as a Data URL string that can be used directly
 * in HTML img src attributes or CSS backgrounds. Ideal for displaying QR codes
 * in web pages without requiring separate image files.
 * 
 * @param {string} data - Data to encode in QR code (typically a URL or coupon code)
 * @param {Object} [options={}] - QR code generation options
 * @param {number} [options.width=300] - Width/height of QR code in pixels (square)
 * @param {number} [options.margin=2] - Margin around QR code (in modules, typically 1-4)
 * @param {string} [options.color] - Color of QR code (default: '#000000')
 * @param {string} [options.backgroundColor] - Background color (default: '#FFFFFF')
 * @param {string} [options.errorCorrectionLevel] - Error correction level: 'L', 'M', 'Q', 'H' (default: 'M')
 * @param {number} [options.scale] - Scale factor (alternative to width)
 * @param {boolean} [options.small] - Use small modules (alternative to scale)
 * @returns {Promise<string>} Data URL string (format: "data:image/png;base64,...")
 * 
 * @throws {Error} If data is empty or invalid
 * @throws {Error} If QR code generation fails
 * 
 * @example
 * // Generate QR code for coupon redemption URL
 * const qrDataUrl = await generateQRDataURL('https://example.com/redeem/ABC123XYZ456');
 * // Use in HTML: <img src={qrDataUrl} alt="QR Code" />
 * 
 * @example
 * // Generate with custom size and colors
 * const qrDataUrl = await generateQRDataURL('https://example.com/redeem/ABC123', {
 *   width: 500,
 *   margin: 3,
 *   color: '#0066CC',
 *   backgroundColor: '#F0F0F0',
 *   errorCorrectionLevel: 'H' // High error correction for better scanning
 * });
 * 
 * @see {@link https://www.npmjs.com/package/qrcode#options} Full list of QR code options
 */
async function generateQRDataURL(data, options = {}) {
    const defaultOptions = {
        width: 300,
        margin: 2
    };
    return await QRCode.toDataURL(data, { ...defaultOptions, ...options });
}

/**
 * Generate QR code as PNG buffer (for email attachments)
 * 
 * Generates a QR code and returns it as a PNG buffer that can be used for email
 * attachments, file downloads, or any other binary data operations. More efficient
 * than Data URL for non-web use cases.
 * 
 * @param {string} data - Data to encode in QR code (typically a URL or coupon code)
 * @param {Object} [options={}] - QR code generation options
 * @param {number} [options.width=300] - Width/height of QR code in pixels (square)
 * @param {number} [options.margin=2] - Margin around QR code (in modules, typically 1-4)
 * @param {string} [options.type='png'] - Image type: 'png', 'svg', 'utf8' (default: 'png')
 * @param {string} [options.color] - Color of QR code (default: '#000000')
 * @param {string} [options.backgroundColor] - Background color (default: '#FFFFFF')
 * @param {string} [options.errorCorrectionLevel] - Error correction level: 'L', 'M', 'Q', 'H' (default: 'M')
 * @param {number} [options.scale] - Scale factor (alternative to width)
 * @param {boolean} [options.small] - Use small modules (alternative to scale)
 * @returns {Promise<Buffer>} PNG buffer containing QR code image data
 * 
 * @throws {Error} If data is empty or invalid
 * @throws {Error} If QR code generation fails
 * 
 * @example
 * // Generate QR code buffer for email attachment
 * const qrBuffer = await generateQRBuffer('https://example.com/redeem/ABC123XYZ456');
 * // Use with nodemailer:
 * // attachments: [{ filename: 'coupon-qr.png', content: qrBuffer }]
 * 
 * @example
 * // Generate with high error correction for better scanning reliability
 * const qrBuffer = await generateQRBuffer('https://example.com/redeem/ABC123', {
 *   width: 500,
 *   margin: 3,
 *   errorCorrectionLevel: 'H', // High error correction
 *   color: '#000000',
 *   backgroundColor: '#FFFFFF'
 * });
 * 
 * @see {@link https://www.npmjs.com/package/qrcode#options} Full list of QR code options
 */
async function generateQRBuffer(data, options = {}) {
    const defaultOptions = {
        width: 300,
        margin: 2,
        type: 'png'
    };
    return await QRCode.toBuffer(data, { ...defaultOptions, ...options });
}

module.exports = {
    generateQRDataURL,
    generateQRBuffer
};


