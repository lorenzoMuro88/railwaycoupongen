#!/usr/bin/env node
/**
 * Script per eseguire i test form-links avviando automaticamente il server
 * e catturando i log [FORM_LINK] per il debug
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = 'http://localhost:3000';
let serverProcess = null;
const serverLogs = [];
const formLinkLogs = [];

function log(message) {
    console.log(`[TEST-RUNNER] ${message}`);
}

function waitForServer(url, maxAttempts = 30) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
            attempts++;
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;
            const req = client.get(`${url}/healthz`, (res) => {
                if (res.statusCode === 200) {
                    resolve(true);
                } else if (attempts < maxAttempts) {
                    setTimeout(check, 500);
                } else {
                    resolve(false);
                }
            });
            req.on('error', () => {
                if (attempts < maxAttempts) {
                    setTimeout(check, 500);
                } else {
                    resolve(false);
                }
            });
            req.setTimeout(1000, () => {
                req.destroy();
                if (attempts < maxAttempts) {
                    setTimeout(check, 500);
                } else {
                    resolve(false);
                }
            });
        };
        check();
    });
}

function startServer() {
    return new Promise((resolve, reject) => {
        log('Starting server with DISABLE_RATE_LIMIT=true...');
        const serverPath = path.join(__dirname, '..', 'server.js');
        
        serverProcess = spawn('node', [serverPath], {
            env: { ...process.env, DISABLE_RATE_LIMIT: 'true', PORT: '3000' },
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: path.join(__dirname, '..')
        });
        
        let serverReady = false;
        const timeout = setTimeout(() => {
            if (!serverReady) {
                reject(new Error('Server failed to start within 15 seconds'));
            }
        }, 15000);
        
        // Capture stdout (server logs)
        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            serverLogs.push(output);
            
            // Extract [FORM_LINK] logs
            const lines = output.split('\n');
            lines.forEach(line => {
                if (line.includes('[FORM_LINK]')) {
                    formLinkLogs.push(line.trim());
                    console.log(`[SERVER-LOG] ${line.trim()}`);
                }
            });
            
            // Check for server ready message
            if (output.includes('server started') || output.includes('CouponGen server started')) {
                if (!serverReady) {
                    serverReady = true;
                    clearTimeout(timeout);
                    log('Server started successfully');
                    setTimeout(resolve, 2000); // Wait a bit more for server to be fully ready
                }
            }
        });
        
        // Capture stderr
        serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            serverLogs.push(output);
            
            // Extract [FORM_LINK] logs from stderr too
            const lines = output.split('\n');
            lines.forEach(line => {
                if (line.includes('[FORM_LINK]')) {
                    formLinkLogs.push(line.trim());
                    console.log(`[SERVER-LOG] ${line.trim()}`);
                }
            });
            
            // Log errors (but ignore warnings)
            if (!output.includes('DeprecationWarning') && 
                !output.includes('ExperimentalWarning') &&
                !output.includes('Warning:')) {
                console.error(`[SERVER-ERR] ${output.trim()}`);
            }
        });
        
        serverProcess.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        
        serverProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                log(`Server exited with code ${code}`);
            }
        });
        
        // Fallback: assume server is ready after 5 seconds
        setTimeout(() => {
            if (!serverReady) {
                log('Server assumed ready (no ready message detected)');
                serverReady = true;
                clearTimeout(timeout);
                resolve();
            }
        }, 5000);
    });
}

function stopServer() {
    if (serverProcess) {
        log('Stopping server...');
        return new Promise((resolve) => {
            serverProcess.on('close', () => {
                log('Server stopped');
                resolve();
            });
            serverProcess.kill('SIGTERM');
            // Force kill after 5 seconds
            setTimeout(() => {
                if (!serverProcess.killed) {
                    serverProcess.kill('SIGKILL');
                    resolve();
                }
            }, 5000);
        });
    }
    return Promise.resolve();
}

function runTests() {
    return new Promise((resolve, reject) => {
        log('Running test suite...');
        const testPath = path.join(__dirname, 'test-form-links.js');
        const testProcess = spawn('node', [testPath], {
            stdio: 'inherit',
            env: { ...process.env, TEST_URL: BASE_URL },
            cwd: path.join(__dirname, '..')
        });
        
        testProcess.on('exit', (code) => {
            resolve(code);
        });
        
        testProcess.on('error', (err) => {
            reject(err);
        });
    });
}

function killExistingServers() {
    return new Promise((resolve) => {
        log('Checking for existing servers on port 3000...');
        const { exec } = require('child_process');
        
        // On Windows, find and kill processes using port 3000
        exec('netstat -ano | findstr ":3000"', (error, stdout) => {
            if (stdout) {
                const lines = stdout.split('\n');
                const pids = new Set();
                lines.forEach(line => {
                    const match = line.match(/\s+(\d+)\s*$/);
                    if (match && match[1] !== '0') {
                        pids.add(match[1]);
                    }
                });
                
                if (pids.size > 0) {
                    log(`Found ${pids.size} process(es) using port 3000, killing them...`);
                    pids.forEach(pid => {
                        try {
                            process.kill(parseInt(pid), 'SIGTERM');
                        } catch (e) {
                            // Ignore errors
                        }
                    });
                    setTimeout(() => {
                        // Force kill if still running
                        pids.forEach(pid => {
                            try {
                                process.kill(parseInt(pid), 'SIGKILL');
                            } catch (e) {
                                // Ignore errors
                            }
                        });
                        setTimeout(resolve, 2000);
                    }, 3000);
                } else {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    });
}

async function main() {
    try {
        log('=== Form Links Test Runner ===\n');
        
        // Kill existing servers
        await killExistingServers();
        
        // Wait a bit for ports to be released
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if server is still running
        const serverRunning = await waitForServer(BASE_URL, 2);
        if (serverRunning) {
            log(`WARNING: Server still running at ${BASE_URL} after kill attempt`);
            log('Trying to continue anyway...');
            log('');
        } else {
            // Start server
            log('Starting fresh server...');
            await startServer();
            const ready = await waitForServer(BASE_URL, 30);
            if (!ready) {
                throw new Error('Server did not become ready');
            }
        }
        
        log('Server is ready. Running tests...\n');
        
        // Run tests
        const testExitCode = await runTests();
        
        log('\n=== Test Execution Complete ===');
        
        // Show [FORM_LINK] logs summary
        if (formLinkLogs.length > 0) {
            log('\n=== [FORM_LINK] Logs Summary ===');
            formLinkLogs.forEach((logLine, index) => {
                console.log(`${index + 1}. ${logLine}`);
            });
        } else {
            log('\nNo [FORM_LINK] logs captured. This might indicate:');
            log('  - Rate limiting is blocking requests');
            log('  - Server is not processing form_token requests');
            log('  - Logs are going to a different output');
        }
        
        // Stop server if we started it
        if (!serverRunning) {
            await stopServer();
        }
        
        process.exit(testExitCode);
        
    } catch (error) {
        log(`Fatal error: ${error.message}`);
        console.error(error);
        await stopServer();
        process.exit(1);
    }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
    log('\nReceived SIGINT, cleaning up...');
    await stopServer();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    log('\nReceived SIGTERM, cleaning up...');
    await stopServer();
    process.exit(0);
});

main();
