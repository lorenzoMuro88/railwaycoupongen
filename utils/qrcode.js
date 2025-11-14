'use strict';

const QRCode = require('qrcode');

/**
 * Generate QR code as Data URL (for web preview)
 * @param {string} data - Data to encode in QR code
 * @param {object} options - QR code options (width, margin, etc.)
 * @returns {Promise<string>} Data URL string
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
 * @param {string} data - Data to encode in QR code
 * @param {object} options - QR code options (width, margin, type, etc.)
 * @returns {Promise<Buffer>} PNG buffer
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


