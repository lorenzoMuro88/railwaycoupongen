#!/usr/bin/env node
/**
 * Test CSP script-src-attr configuration
 * Verifies that script-src-attr is properly configured to allow inline event handlers
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const isProduction = process.env.NODE_ENV === 'production';

function log(message) {
    console.log(`[TEST] ${message}`);
}

function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const client = url.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'CSP-Test/1.0',
                ...options.headers
            }
        };
        
        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({ 
                    statusCode: res.statusCode, 
                    headers: res.headers,
                    body: data
                });
            });
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function testCSPConfiguration() {
    log('=== Testing CSP script-src-attr Configuration ===');
    log(`Testing against: ${BASE_URL}`);
    log(`Production mode: ${isProduction}`);
    log('');
    
    if (!isProduction) {
        log('⚠️  WARNING: NODE_ENV is not set to "production"');
        log('⚠️  CSP is disabled in development mode, so this test will not verify CSP headers.');
        log('⚠️  To test CSP, run: NODE_ENV=production npm start');
        log('');
    }
    
    try {
        // Test superadmin page
        log('Testing /superadmin page...');
        const response = await makeRequest('/superadmin');
        
        if (response.statusCode !== 200 && response.statusCode !== 302) {
            log(`❌ Failed to access /superadmin: ${response.statusCode}`);
            return false;
        }
        
        const cspHeader = response.headers['content-security-policy'] || response.headers['Content-Security-Policy'];
        
        if (isProduction) {
            if (!cspHeader) {
                log('❌ Content-Security-Policy header is missing in production mode');
                return false;
            }
            
            log(`✅ CSP Header found: ${cspHeader.substring(0, 100)}...`);
            
            // Check for script-src-attr
            if (cspHeader.includes('script-src-attr')) {
                log('✅ script-src-attr directive found in CSP');
                
                if (cspHeader.includes("script-src-attr 'unsafe-inline'") || cspHeader.includes('script-src-attr \'unsafe-inline\'')) {
                    log('✅ script-src-attr contains unsafe-inline (allows inline event handlers)');
                    return true;
                } else {
                    log('⚠️  script-src-attr found but does not contain unsafe-inline');
                    log(`   Full CSP: ${cspHeader}`);
                    return false;
                }
            } else {
                log('❌ script-src-attr directive NOT found in CSP');
                log(`   Full CSP: ${cspHeader}`);
                return false;
            }
        } else {
            log('ℹ️  Development mode: CSP is disabled (as expected)');
            log('ℹ️  To test CSP configuration, set NODE_ENV=production');
            return true; // Not an error in development
        }
        
    } catch (error) {
        log(`❌ Error testing CSP: ${error.message}`);
        return false;
    }
}

async function main() {
    const success = await testCSPConfiguration();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { testCSPConfiguration };


