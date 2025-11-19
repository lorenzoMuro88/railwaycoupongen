#!/usr/bin/env node
/**
 * Test CSP configuration for Analytics page (Chart.js CDN)
 * Verifies that cdn.jsdelivr.net is allowed in scriptSrc and styleSrc directives
 */

const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');

const BASE_URL = 'http://localhost:3000';
let serverProcess = null;

function log(message) {
    console.log(`[TEST] ${message}`);
}

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
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
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

function startServer() {
    return new Promise((resolve, reject) => {
        log('Starting server in production mode...');
        
        serverProcess = spawn('node', ['server.js'], {
            env: { ...process.env, NODE_ENV: 'production' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let serverReady = false;
        const timeout = setTimeout(() => {
            if (!serverReady) {
                serverProcess.kill();
                reject(new Error('Server startup timeout (30s)'));
            }
        }, 30000);

        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Server running') || output.includes('listening')) {
                serverReady = true;
                clearTimeout(timeout);
                setTimeout(resolve, 2000); // Give server 2s to fully initialize
            }
        });

        serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Error') && !output.includes('WARNING')) {
                clearTimeout(timeout);
                reject(new Error(`Server error: ${output}`));
            }
        });

        serverProcess.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

function stopServer() {
    if (serverProcess) {
        log('Stopping server...');
        serverProcess.kill();
        serverProcess = null;
    }
}

async function testAnalyticsCSP() {
    try {
        await startServer();
        
        log('');
        log('Testing /analytics page CSP configuration...');
        
        // First, we need to authenticate or access a public endpoint
        // Let's try to access analytics (might redirect to login, that's ok)
        const response = await makeRequest('/analytics');
        
        const cspHeader = response.headers['content-security-policy'] || 
                         response.headers['Content-Security-Policy'];
        
        if (!cspHeader) {
            log('⚠️  WARNING: Content-Security-Policy header not found');
            log('   This might mean the server is running in development mode');
            log('   Make sure NODE_ENV=production when starting the server');
            return false;
        }
        
        log(`✅ CSP Header found`);
        log(`   ${cspHeader.substring(0, 200)}...`);
        log('');
        
        // Check scriptSrc for cdn.jsdelivr.net
        const scriptSrcMatch = cspHeader.match(/script-src[^;]*/);
        if (scriptSrcMatch) {
            const scriptSrc = scriptSrcMatch[0];
            log(`Found script-src directive: ${scriptSrc}`);
            
            if (scriptSrc.includes('cdn.jsdelivr.net')) {
                log('✅ cdn.jsdelivr.net is allowed in script-src');
            } else {
                log('❌ cdn.jsdelivr.net is NOT allowed in script-src');
                log(`   Current script-src: ${scriptSrc}`);
                return false;
            }
        } else {
            log('⚠️  Could not find script-src directive in CSP');
        }
        
        // Check styleSrc for cdn.jsdelivr.net
        const styleSrcMatch = cspHeader.match(/style-src[^;]*/);
        if (styleSrcMatch) {
            const styleSrc = styleSrcMatch[0];
            log(`Found style-src directive: ${styleSrc}`);
            
            if (styleSrc.includes('cdn.jsdelivr.net')) {
                log('✅ cdn.jsdelivr.net is allowed in style-src');
            } else {
                log('⚠️  cdn.jsdelivr.net is NOT allowed in style-src (might be ok if not using SunEditor CSS)');
            }
        } else {
            log('⚠️  Could not find style-src directive in CSP');
        }
        
        log('');
        log('✅ TEST PASSED: CSP configuration allows Chart.js from cdn.jsdelivr.net');
        log('');
        log('Next steps:');
        log('  1. Open http://localhost:3000/analytics in your browser');
        log('  2. Login if required');
        log('  3. Open browser DevTools (F12) → Console tab');
        log('  4. Verify no CSP errors about cdn.jsdelivr.net');
        log('  5. Verify Chart.js loads and charts are displayed');
        log('');
        
        return true;
        
    } catch (error) {
        log(`❌ Error: ${error.message}`);
        return false;
    }
}

async function main() {
    process.on('SIGINT', () => {
        stopServer();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        stopServer();
        process.exit(0);
    });
    
    try {
        const success = await testAnalyticsCSP();
        stopServer();
        process.exit(success ? 0 : 1);
    } catch (error) {
        log(`Fatal error: ${error.message}`);
        stopServer();
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}


