#!/usr/bin/env node
/**
 * Test Runner with Coverage
 * Starts server with coverage, runs all tests, then generates coverage report
 */

const { spawn } = require('child_process');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;
const MAX_WAIT_TIME = 30000; // 30 seconds
const CHECK_INTERVAL = 500; // 500ms

let serverProcess = null;

function waitForServer() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const check = () => {
            http.get(`${BASE_URL}/health`, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    if (Date.now() - startTime > MAX_WAIT_TIME) {
                        reject(new Error('Server did not start in time'));
                    } else {
                        setTimeout(check, CHECK_INTERVAL);
                    }
                }
            }).on('error', () => {
                if (Date.now() - startTime > MAX_WAIT_TIME) {
                    reject(new Error('Server did not start in time'));
                } else {
                    setTimeout(check, CHECK_INTERVAL);
                }
            });
        };
        
        check();
    });
}

function runTests() {
    console.log('[COVERAGE] Running all tests...\n');
    
    const tests = [
        'test:csrf',
        'test:tenant-isolation',
        'test:authorization',
        'test:store',
        'test:superadmin',
        'test:admin-extended'
    ];
    
    let allPassed = true;
    
    for (const test of tests) {
        try {
            console.log(`[COVERAGE] Running: ${test}`);
            execSync(`npm run ${test}`, { 
                stdio: 'inherit',
                cwd: process.cwd()
            });
            console.log(`[COVERAGE] ✓ ${test} passed\n`);
        } catch (error) {
            console.error(`[COVERAGE] ✗ ${test} failed\n`);
            allPassed = false;
        }
    }
    
    return allPassed;
}

async function main() {
    console.log('[COVERAGE] Starting server with coverage instrumentation...\n');
    
    // Start server with c8 coverage
    serverProcess = spawn('npx', ['c8', '--reporter=text', '--reporter=html', '--reporter=json', 'node', 'server.js'], {
        stdio: 'pipe',
        cwd: process.cwd(),
        shell: true
    });
    
    serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('started') || output.includes('listening')) {
            console.log('[COVERAGE] Server output:', output.trim());
        }
    });
    
    serverProcess.stderr.on('data', (data) => {
        const output = data.toString();
        // Filter out coverage-related messages
        if (!output.includes('c8') && !output.includes('coverage')) {
            console.error('[COVERAGE] Server error:', output.trim());
        }
    });
    
    try {
        // Wait for server to start
        console.log('[COVERAGE] Waiting for server to start...');
        await waitForServer();
        console.log('[COVERAGE] Server is ready!\n');
        
        // Run tests
        const testsPassed = runTests();
        
        // Give some time for coverage data to be written
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (!testsPassed) {
            console.log('\n[COVERAGE] ⚠ Some tests failed, but coverage data was collected');
        }
        
    } catch (error) {
        console.error('[COVERAGE] Error:', error.message);
    } finally {
        // Stop server
        if (serverProcess) {
            console.log('\n[COVERAGE] Stopping server...');
            serverProcess.kill('SIGTERM');
            
            // Wait a bit for cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGKILL');
            }
        }
    }
    
    console.log('\n[COVERAGE] Coverage report generated in ./coverage/');
    console.log('[COVERAGE] Open coverage/index.html to view detailed coverage report');
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\n[COVERAGE] Interrupted, cleaning up...');
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
    }
    process.exit(0);
});

main().catch(error => {
    console.error('[COVERAGE] Fatal error:', error);
    if (serverProcess) {
        serverProcess.kill('SIGKILL');
    }
    process.exit(1);
});





