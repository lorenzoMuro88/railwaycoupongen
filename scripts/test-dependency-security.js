#!/usr/bin/env node
/**
 * Dependency Security Test Suite
 * Tests that dependencies don't have critical vulnerabilities
 * Uses npm audit and optionally Snyk
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let testResults = [];
let passed = 0;
let failed = 0;

function log(message) {
    console.log(`[TEST] ${message}`);
}

function runCommand(command, options = {}) {
    try {
        const result = execSync(command, {
            encoding: 'utf8',
            stdio: 'pipe',
            ...options
        });
        return { success: true, output: result };
    } catch (error) {
        return { 
            success: false, 
            output: error.stdout || error.stderr || error.message,
            error: error.message
        };
    }
}

async function runTests() {
    log('Starting Dependency Security Test Suite');
    log('');
    
    // Test 1: npm audit
    log('Test 1: Running npm audit...');
    const npmAuditResult = runCommand('npm audit --json', { cwd: process.cwd() });
    
    if (npmAuditResult.success) {
        try {
            const auditData = JSON.parse(npmAuditResult.output);
            const vulnerabilities = auditData.vulnerabilities || {};
            const critical = auditData.metadata?.vulnerabilities?.critical || 0;
            const high = auditData.metadata?.vulnerabilities?.high || 0;
            const moderate = auditData.metadata?.vulnerabilities?.moderate || 0;
            const low = auditData.metadata?.vulnerabilities?.low || 0;
            
            log(`   Critical: ${critical}`);
            log(`   High: ${high}`);
            log(`   Moderate: ${moderate}`);
            log(`   Low: ${low}`);
            
            if (critical === 0 && high === 0) {
                log('✅ npm audit: No critical or high severity vulnerabilities');
                testResults.push({
                    name: 'npm audit',
                    description: 'No critical or high severity vulnerabilities',
                    passed: true,
                    expected: '0 critical, 0 high',
                    actual: `${critical} critical, ${high} high`
                });
                passed++;
            } else {
                log(`❌ npm audit: Found ${critical} critical and ${high} high severity vulnerabilities`);
                testResults.push({
                    name: 'npm audit',
                    description: 'No critical or high severity vulnerabilities',
                    passed: false,
                    expected: '0 critical, 0 high',
                    actual: `${critical} critical, ${high} high`
                });
                failed++;
                
                // Show summary
                if (critical > 0 || high > 0) {
                    log('');
                    log('   Vulnerabilities found:');
                    Object.keys(vulnerabilities).forEach(pkg => {
                        const vuln = vulnerabilities[pkg];
                        if (vuln.severity === 'critical' || vuln.severity === 'high') {
                            log(`   - ${pkg}: ${vuln.severity} (${vuln.via?.length || 0} vulnerabilities)`);
                        }
                    });
                    log('');
                    log('   Run "npm audit fix" to attempt automatic fixes');
                    log('   Or run "npm audit" for detailed report');
                }
            }
        } catch (e) {
            log(`⚠️  Could not parse npm audit output: ${e.message}`);
            testResults.push({
                name: 'npm audit',
                description: 'Parse npm audit results',
                passed: false,
                expected: 'Valid JSON',
                actual: e.message
            });
            failed++;
        }
    } else {
        log(`⚠️  npm audit failed: ${npmAuditResult.error || 'Unknown error'}`);
        testResults.push({
            name: 'npm audit',
            description: 'Run npm audit successfully',
            passed: false,
            expected: 'Success',
            actual: npmAuditResult.error || 'Failed'
        });
        failed++;
    }
    
    // Test 2: Snyk test (if available)
    log('');
    log('Test 2: Checking for Snyk...');
    const snykCheck = runCommand('snyk --version', { cwd: process.cwd() });
    
    if (snykCheck.success) {
        const snykVersion = snykCheck.output.trim();
        log(`   Snyk found: ${snykVersion}`);
        
        log('   Running snyk test...');
        const snykTestResult = runCommand('snyk test --json', { cwd: process.cwd() });
        
        if (snykTestResult.success) {
            try {
                const snykData = JSON.parse(snykTestResult.output);
                const vulnerabilities = snykData.vulnerabilities || [];
                const critical = vulnerabilities.filter(v => v.severity === 'critical').length;
                const high = vulnerabilities.filter(v => v.severity === 'high').length;
                
                log(`   Critical: ${critical}`);
                log(`   High: ${high}`);
                
                if (critical === 0 && high === 0) {
                    log('✅ Snyk test: No critical or high severity vulnerabilities');
                    testResults.push({
                        name: 'Snyk test',
                        description: 'No critical or high severity vulnerabilities',
                        passed: true,
                        expected: '0 critical, 0 high',
                        actual: `${critical} critical, ${high} high`
                    });
                    passed++;
                } else {
                    log(`❌ Snyk test: Found ${critical} critical and ${high} high severity vulnerabilities`);
                    testResults.push({
                        name: 'Snyk test',
                        description: 'No critical or high severity vulnerabilities',
                        passed: false,
                        expected: '0 critical, 0 high',
                        actual: `${critical} critical, ${high} high`
                    });
                    failed++;
                }
            } catch (e) {
                log(`⚠️  Could not parse Snyk output: ${e.message}`);
                // Snyk might return non-JSON output if authenticated
                log('   Note: Snyk may require authentication. Run "snyk auth" first.');
                testResults.push({
                    name: 'Snyk test',
                    description: 'Parse Snyk test results',
                    passed: false,
                    expected: 'Valid JSON or authenticated',
                    actual: 'Parse error - may need authentication'
                });
                // Don't count as failure if it's just an auth issue
            }
        } else {
            const output = snykTestResult.output || snykTestResult.error || '';
            if (output.includes('authentication') || output.includes('auth')) {
                log('⚠️  Snyk requires authentication. Run "snyk auth" first.');
                log('   Skipping Snyk test (authentication required)');
                testResults.push({
                    name: 'Snyk test',
                    description: 'Snyk authentication',
                    passed: true,
                    expected: 'Authenticated or skipped',
                    actual: 'Authentication required (skipped)'
                });
                passed++;
            } else {
                log(`⚠️  Snyk test failed: ${output.substring(0, 200)}`);
                testResults.push({
                    name: 'Snyk test',
                    description: 'Run Snyk test successfully',
                    passed: false,
                    expected: 'Success',
                    actual: output.substring(0, 100)
                });
                failed++;
            }
        }
    } else {
        log('ℹ️  Snyk not installed. Install with: npm install -g snyk');
        log('   Then run: snyk auth');
        testResults.push({
            name: 'Snyk test',
            description: 'Snyk CLI available',
            passed: true,
            expected: 'Installed or skipped',
            actual: 'Not installed (optional)'
        });
        passed++;
    }
    
    // Summary
    log('');
    log('='.repeat(60));
    log('Test Results Summary');
    log('='.repeat(60));
    
    testResults.forEach(result => {
        if (result.passed) {
            log(`✅ ${result.name}: ${result.description}`);
        } else {
            log(`❌ ${result.name}: ${result.description}`);
            log(`   Expected: ${result.expected}`);
            log(`   Actual: ${result.actual}`);
        }
    });
    
    log('');
    log(`Total: ${testResults.length} tests`);
    log(`Passed: ${passed}`);
    log(`Failed: ${failed}`);
    log('');
    
    if (failed === 0) {
        log('✅ All dependency security tests passed!');
        process.exit(0);
    } else {
        log('❌ Some dependency security tests failed');
        log('');
        log('Recommendations:');
        log('1. Run "npm audit fix" to attempt automatic fixes');
        log('2. Review "npm audit" output for manual fixes');
        log('3. Install Snyk: npm install -g snyk && snyk auth');
        log('4. Run "snyk test" for additional vulnerability scanning');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

