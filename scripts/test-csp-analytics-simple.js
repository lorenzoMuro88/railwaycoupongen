#!/usr/bin/env node
/**
 * Simple test to verify CSP header includes cdn.jsdelivr.net
 * Tests against running server (assumes server is already running)
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

function log(message) {
    console.log(`[TEST] ${message}`);
}

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'GET',
            headers: {
                'User-Agent': 'CSP-Test/1.0'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
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
        req.end();
    });
}

async function testCSP() {
    try {
        log('Testing CSP configuration on running server...');
        log('');
        
        // Test health endpoint first
        log('1. Testing /health endpoint...');
        const healthResponse = await makeRequest('/health');
        if (healthResponse.statusCode === 200) {
            log('   ✅ Server is running');
        } else {
            log(`   ⚠️  Server returned status ${healthResponse.statusCode}`);
        }
        
        log('');
        log('2. Testing CSP headers...');
        
        // Try to get analytics page (might redirect, that's ok)
        const response = await makeRequest('/analytics');
        
        const cspHeader = response.headers['content-security-policy'] || 
                         response.headers['Content-Security-Policy'];
        
        if (!cspHeader) {
            log('   ⚠️  Content-Security-Policy header not found');
            log('   This means server is running in development mode');
            log('   CSP is disabled in development, so Chart.js will work');
            log('   To test CSP, restart server with: $env:NODE_ENV="production"; node server.js');
            return true; // Not an error in dev mode
        }
        
        log(`   ✅ CSP Header found`);
        log(`   ${cspHeader.substring(0, 250)}...`);
        log('');
        
        // Check scriptSrc
        const scriptSrcMatch = cspHeader.match(/script-src[^;]*/);
        if (scriptSrcMatch) {
            const scriptSrc = scriptSrcMatch[0];
            log(`3. Checking script-src directive...`);
            log(`   ${scriptSrc}`);
            
            if (scriptSrc.includes('cdn.jsdelivr.net')) {
                log('   ✅ cdn.jsdelivr.net is allowed in script-src');
                log('   ✅ Chart.js will load correctly!');
            } else {
                log('   ❌ cdn.jsdelivr.net is NOT allowed in script-src');
                log('   ❌ Chart.js will be blocked by CSP!');
                return false;
            }
        }
        
        // Check styleSrc
        const styleSrcMatch = cspHeader.match(/style-src[^;]*/);
        if (styleSrcMatch) {
            const styleSrc = styleSrcMatch[0];
            log('');
            log(`4. Checking style-src directive...`);
            log(`   ${styleSrc}`);
            
            if (styleSrc.includes('cdn.jsdelivr.net')) {
                log('   ✅ cdn.jsdelivr.net is allowed in style-src');
            } else {
                log('   ⚠️  cdn.jsdelivr.net is NOT in style-src (OK if not using SunEditor CSS)');
            }
        }
        
        // Check connectSrc (needed for source maps)
        const connectSrcMatch = cspHeader.match(/connect-src[^;]*/);
        if (connectSrcMatch) {
            const connectSrc = connectSrcMatch[0];
            log('');
            log(`5. Checking connect-src directive...`);
            log(`   ${connectSrc}`);
            
            if (connectSrc.includes('cdn.jsdelivr.net')) {
                log('   ✅ cdn.jsdelivr.net is allowed in connect-src');
                log('   ✅ Source maps will load correctly!');
            } else {
                log('   ❌ cdn.jsdelivr.net is NOT allowed in connect-src');
                log('   ❌ Source maps will be blocked by CSP!');
                return false;
            }
        } else {
            log('');
            log('   ⚠️  connect-src directive not found in CSP');
        }
        
        log('');
        log('✅ TEST PASSED: CSP configuration is correct!');
        log('');
        log('Next steps:');
        log('  1. Open http://localhost:3000/analytics in your browser');
        log('  2. Login if required');
        log('  3. Open DevTools (F12) → Console tab');
        log('  4. Verify NO CSP errors about cdn.jsdelivr.net');
        log('  5. Verify Chart.js loads and charts display correctly');
        log('');
        
        return true;
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            log('❌ Cannot connect to server');
            log('   Make sure server is running: node server.js');
            log('   Or in production mode: $env:NODE_ENV="production"; node server.js');
        } else {
            log(`❌ Error: ${error.message}`);
        }
        return false;
    }
}

if (require.main === module) {
    testCSP().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        log(`Fatal error: ${error.message}`);
        process.exit(1);
    });
}

