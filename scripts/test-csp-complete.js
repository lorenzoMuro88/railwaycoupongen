#!/usr/bin/env node
/**
 * Complete CSP test - starts server in production and verifies script-src-attr
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
        const req = http.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'GET',
            timeout: 5000
        }, (res) => {
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
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

function startServer() {
    return new Promise((resolve, reject) => {
        log('Starting server in production mode...');
        const env = { ...process.env, NODE_ENV: 'production' };
        serverProcess = spawn('node', ['server.js'], {
            cwd: __dirname + '/..',
            env: env,
            stdio: 'pipe'
        });
        
        let serverReady = false;
        const timeout = setTimeout(() => {
            if (!serverReady) {
                reject(new Error('Server startup timeout'));
            }
        }, 10000);
        
        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Server listening') || output.includes('listening on port')) {
                serverReady = true;
                clearTimeout(timeout);
                setTimeout(resolve, 2000); // Give it 2 more seconds to fully start
            }
        });
        
        serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            // Ignore EADDRINUSE if server is already running
            if (output.includes('EADDRINUSE')) {
                log('Server already running, using existing instance...');
                serverReady = true;
                clearTimeout(timeout);
                setTimeout(resolve, 1000);
            }
        });
        
        serverProcess.on('error', reject);
    });
}

function stopServer() {
    if (serverProcess) {
        log('Stopping test server...');
        serverProcess.kill();
        serverProcess = null;
    }
}

async function testCSP() {
    try {
        await startServer();
        
        log('');
        log('Testing /superadmin page...');
        const response = await makeRequest('/superadmin');
        
        const cspHeader = response.headers['content-security-policy'] || 
                         response.headers['Content-Security-Policy'];
        
        if (!cspHeader) {
            log('⚠️  WARNING: Content-Security-Policy header not found');
            log('   This might mean the server is running in development mode');
            log('   Make sure NODE_ENV=production when starting the server');
            return false;
        }
        
        log(`✅ CSP Header found`);
        log(`   ${cspHeader.substring(0, 150)}...`);
        
        if (cspHeader.includes('script-src-attr')) {
            log('✅ script-src-attr directive found in CSP');
            
            if (cspHeader.includes("script-src-attr 'unsafe-inline'") || 
                cspHeader.includes("script-src-attr 'unsafe-inline'")) {
                log('✅ script-src-attr contains unsafe-inline');
                log('');
                log('✅ TEST PASSED: CSP configuration is correct!');
                log('   Inline event handlers (onclick) should now work without CSP errors.');
                return true;
            } else {
                log('❌ script-src-attr found but does not contain unsafe-inline');
                log(`   Full CSP: ${cspHeader}`);
                return false;
            }
        } else {
            log('❌ script-src-attr directive NOT found in CSP');
            log(`   Full CSP: ${cspHeader}`);
            return false;
        }
        
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
    
    const success = await testCSP();
    
    // Don't stop server if it was already running
    // stopServer();
    
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        stopServer();
        process.exit(1);
    });
}

module.exports = { testCSP };

