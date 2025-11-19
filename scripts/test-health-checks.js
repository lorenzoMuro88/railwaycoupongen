#!/usr/bin/env node
/**
 * Health Checks Test Suite
 * Tests health check endpoints
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const testResults = [];

function log(message) {
    console.log(`[TEST] ${message}`);
}

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        
        const req = client.request(requestOptions, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                let parsedBody;
                try {
                    parsedBody = JSON.parse(body);
                } catch (e) {
                    parsedBody = body;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsedBody
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

async function test(name, fn) {
    try {
        await fn();
        testResults.push({ name, status: 'PASS', error: null });
        log(`✅ PASS: ${name}`);
    } catch (error) {
        testResults.push({ name, status: 'FAIL', error: error.message });
        log(`❌ FAIL: ${name} - ${error.message}`);
    }
}

async function runTests() {
    log('=== Health Checks Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    // ===== TEST 1: Basic Health Endpoint =====
    log('=== TEST 1: Basic Health Endpoint ===');
    
    await test('GET /health returns ok: true', async () => {
        const res = await makeRequest('GET', '/health');
        
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        
        if (!res.body || res.body.ok !== true) {
            throw new Error(`Expected { ok: true }, got ${JSON.stringify(res.body)}`);
        }
    });
    
    // ===== TEST 2: Healthz Endpoint =====
    log('\n=== TEST 2: Healthz Endpoint ===');
    
    await test('GET /healthz returns ok: true when healthy', async () => {
        const res = await makeRequest('GET', '/healthz');
        
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        
        if (!res.body || res.body.ok !== true) {
            throw new Error(`Expected { ok: true }, got ${JSON.stringify(res.body)}`);
        }
        
        if (res.body.status !== 'healthy') {
            throw new Error(`Expected status 'healthy', got '${res.body.status}'`);
        }
        
        if (!res.body.timestamp) {
            throw new Error('Missing timestamp in response');
        }
    });
    
    await test('GET /healthz includes timestamp', async () => {
        const res = await makeRequest('GET', '/healthz');
        
        if (!res.body.timestamp) {
            throw new Error('Missing timestamp');
        }
        
        // Verify timestamp is valid ISO string
        const timestamp = new Date(res.body.timestamp);
        if (isNaN(timestamp.getTime())) {
            throw new Error(`Invalid timestamp format: ${res.body.timestamp}`);
        }
    });
    
    // ===== TEST 3: Detailed Health Endpoint =====
    log('\n=== TEST 3: Detailed Health Endpoint ===');
    
    await test('GET /healthz/detailed returns comprehensive health info', async () => {
        const res = await makeRequest('GET', '/healthz/detailed');
        
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        
        if (!res.body || typeof res.body.ok !== 'boolean') {
            throw new Error(`Expected { ok: boolean }, got ${JSON.stringify(res.body)}`);
        }
        
        if (!res.body.checks) {
            throw new Error('Missing checks object');
        }
        
        if (!res.body.checks.database) {
            throw new Error('Missing database check');
        }
        
        if (!res.body.checks.memory) {
            throw new Error('Missing memory check');
        }
        
        if (typeof res.body.uptime !== 'number') {
            throw new Error('Missing or invalid uptime');
        }
        
        if (!res.body.timestamp) {
            throw new Error('Missing timestamp');
        }
    });
    
    await test('GET /healthz/detailed includes database details', async () => {
        const res = await makeRequest('GET', '/healthz/detailed');
        
        if (!res.body.checks.database.ok) {
            throw new Error('Database check failed');
        }
        
        if (!res.body.checks.database.details) {
            throw new Error('Missing database details');
        }
    });
    
    await test('GET /healthz/detailed includes memory details', async () => {
        const res = await makeRequest('GET', '/healthz/detailed');
        
        if (!res.body.checks.memory.details) {
            throw new Error('Missing memory details');
        }
        
        const mem = res.body.checks.memory.details;
        if (typeof mem.rss !== 'string' || typeof mem.heapUsed !== 'string') {
            throw new Error('Invalid memory details format');
        }
    });
    
    await test('GET /healthz/detailed includes uptime', async () => {
        const res = await makeRequest('GET', '/healthz/detailed');
        
        if (typeof res.body.uptime !== 'number' || res.body.uptime < 0) {
            throw new Error(`Invalid uptime: ${res.body.uptime}`);
        }
    });
    
    await test('GET /healthz/detailed includes version info', async () => {
        const res = await makeRequest('GET', '/healthz/detailed');
        
        if (!res.body.version) {
            throw new Error('Missing version');
        }
        
        if (!res.body.nodeVersion) {
            throw new Error('Missing nodeVersion');
        }
    });
    
    // ===== TEST 4: Response Time =====
    log('\n=== TEST 4: Response Time ===');
    
    await test('GET /health responds quickly (< 100ms)', async () => {
        const start = Date.now();
        await makeRequest('GET', '/health');
        const duration = Date.now() - start;
        
        if (duration > 100) {
            throw new Error(`Response time too slow: ${duration}ms`);
        }
    });
    
    await test('GET /healthz responds reasonably (< 500ms)', async () => {
        const start = Date.now();
        await makeRequest('GET', '/healthz');
        const duration = Date.now() - start;
        
        if (duration > 500) {
            throw new Error(`Response time too slow: ${duration}ms`);
        }
    });
    
    // ===== SUMMARY =====
    log('\n=== TEST SUMMARY ===');
    const passed = testResults.filter(r => r.status === 'PASS').length;
    const failed = testResults.filter(r => r.status === 'FAIL').length;
    const total = testResults.length;
    
    log(`Total tests: ${total}`);
    log(`Passed: ${passed}`);
    log(`Failed: ${failed}`);
    
    if (failed > 0) {
        log('\nFailed tests:');
        testResults.filter(r => r.status === 'FAIL').forEach(r => {
            log(`  - ${r.name}: ${r.error}`);
        });
    }
    
    if (failed > 0) {
        process.exit(1);
    } else {
        log('\n✅ All tests passed!');
        process.exit(0);
    }
}

// Run tests
runTests().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});


