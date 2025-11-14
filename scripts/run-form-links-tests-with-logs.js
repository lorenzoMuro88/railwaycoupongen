#!/usr/bin/env node
/**
 * Script per eseguire i test form-links con logging completo del server
 * Avvia automaticamente il server con DISABLE_RATE_LIMIT=true e cattura i log
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
let serverProcess = null;
const serverLogs = [];

function log(message) {
    console.log(`[TEST-RUNNER] ${message}`);
}

function logServer(message) {
    const timestamp = new Date().toISOString();
    serverLogs.push(`[${timestamp}] ${message}`);
    // Mostra solo i log rilevanti in tempo reale
    if (message.includes('[FORM_LINK]') || message.includes('ERROR') || message.includes('CRITICAL')) {
        console.log(`[SERVER] ${message}`);
    }
}

async function startServer() {
    return new Promise((resolve, reject) => {
        log('Starting server with DISABLE_RATE_LIMIT=true...');
        const serverPath = path.join(__dirname, '..', 'server.js');
        serverProcess = spawn('node', [serverPath], {
            env: { ...process.env, DISABLE_RATE_LIMIT: 'true', PORT: '3000' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let serverReady = false;
        const timeout = setTimeout(() => {
            if (!serverReady) {
                reject(new Error('Server failed to start within 15 seconds'));
            }
        }, 15000);
        
        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n').filter(l => l.trim());
            lines.forEach(line => {
                logServer(line);
            });
            
            if (output.includes('server started') || output.includes('CouponGen server started')) {
                serverReady = true;
                clearTimeout(timeout);
                log('Server started successfully');
                setTimeout(resolve, 2000); // Wait a bit more for server to be fully ready
            }
        });
        
        serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n').filter(l => l.trim());
            lines.forEach(line => {
                if (!line.includes('DeprecationWarning') && !line.includes('ExperimentalWarning')) {
                    logServer(`STDERR: ${line}`);
                }
            });
        });
        
        serverProcess.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        
        // Fallback: if we don't see the ready message, wait a bit and assume it's ready
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

async function stopServer() {
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
}

async function waitForServer(url, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await new Promise((resolve, reject) => {
                const urlObj = new URL(url);
                const client = urlObj.protocol === 'https:' ? https : http;
                const req = client.get(`${url}/healthz`, (res) => {
                    if (res.statusCode === 200) {
                        resolve();
                    } else {
                        reject(new Error(`Server returned ${res.statusCode}`));
                    }
                });
                req.on('error', reject);
                req.setTimeout(1000, () => {
                    req.destroy();
                    reject(new Error('Request timeout'));
                });
            });
            return true;
        } catch (e) {
            if (i < maxAttempts - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }
    return false;
}

async function killExistingServers() {
    log('Checking for existing servers on port 3000...');
    try {
        const { exec } = require('child_process');
        return new Promise((resolve) => {
            // On Windows, find process using port 3000
            exec('netstat -ano | findstr :3000', (error, stdout) => {
                if (stdout) {
                    const lines = stdout.split('\n').filter(l => l.includes('LISTENING'));
                    lines.forEach(line => {
                        const match = line.match(/\s+(\d+)$/);
                        if (match) {
                            const pid = match[1];
                            log(`Killing process ${pid} on port 3000...`);
                            try {
                                process.kill(parseInt(pid), 'SIGTERM');
                            } catch (e) {
                                // Ignore if process doesn't exist
                            }
                        }
                    });
                }
                setTimeout(resolve, 2000);
            });
        });
    } catch (e) {
        // Ignore errors
        setTimeout(() => {}, 2000);
    }
}

async function runTests() {
    log('=== Form Links Test Runner with Server Logs ===\n');
    
    try {
        // Kill existing servers
        await killExistingServers();
        
        // Start server
        log('Starting server...');
        await startServer();
        
        // Wait for server to be ready
        log('Waiting for server to be ready...');
        const serverReady = await waitForServer(BASE_URL, 30);
        if (!serverReady) {
            throw new Error('Server did not become ready in time');
        }
        
        log(`Server is ready at ${BASE_URL}\n`);
        
        // Run the actual test script
        log('Running tests...\n');
        const testScript = spawn('node', [path.join(__dirname, 'test-form-links.js')], {
            env: { ...process.env, TEST_URL: BASE_URL },
            stdio: 'inherit'
        });
        
        await new Promise((resolve, reject) => {
            testScript.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Tests exited with code ${code}`));
                }
            });
            testScript.on('error', reject);
        });
        
    } catch (error) {
        log(`Error: ${error.message}`);
        console.error(error);
    } finally {
        // Stop server
        await stopServer();
        
        // Show relevant logs
        log('\n=== Relevant Server Logs ===');
        const relevantLogs = serverLogs.filter(log => 
            log.includes('[FORM_LINK]') || 
            log.includes('ERROR') || 
            log.includes('CRITICAL') ||
            log.includes('WARN')
        );
        
        if (relevantLogs.length > 0) {
            relevantLogs.forEach(log => console.log(log));
        } else {
            log('No relevant logs found. Showing all logs:');
            serverLogs.slice(-50).forEach(log => console.log(log)); // Last 50 logs
        }
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

// Run
runTests().catch(async (error) => {
    log(`Fatal error: ${error.message}`);
    console.error(error);
    await stopServer();
    process.exit(1);
});

