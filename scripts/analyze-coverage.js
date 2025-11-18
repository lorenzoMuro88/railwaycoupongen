#!/usr/bin/env node
/**
 * Coverage Analysis Script
 * Analyzes server.js to find all functions and endpoints,
 * then cross-references with test files to identify uncovered code
 */

const fs = require('fs');
const path = require('path');

function extractFunctions(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const functions = [];
    const endpoints = [];
    
    // Extract function declarations: function name(...) or const name = function(...) or const name = async function(...)
    const functionPatterns = [
        /^function\s+(\w+)\s*\(/gm,
        /^async\s+function\s+(\w+)\s*\(/gm,
        /const\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(/gm,
        /const\s+(\w+)\s*=\s*\(/gm,
        /const\s+(\w+)\s*=\s*async\s*\(/gm
    ];
    
    // Extract Express routes: app.get/post/put/delete('path', ...)
    const routePattern = /app\.(get|post|put|delete|patch)\s*\(['"`]([^'"`]+)['"`]/g;
    
    const lines = content.split('\n');
    
    // Extract functions
    functionPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const funcName = match[1] || match[2] || match[3];
            if (funcName && !functions.find(f => f.name === funcName)) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                functions.push({
                    name: funcName,
                    line: lineNum,
                    type: 'function'
                });
            }
        }
    });
    
    // Extract endpoints
    let routeMatch;
    while ((routeMatch = routePattern.exec(content)) !== null) {
        const method = routeMatch[1].toUpperCase();
        const path = routeMatch[2];
        const lineNum = content.substring(0, routeMatch.index).split('\n').length;
        
        endpoints.push({
            method,
            path,
            line: lineNum,
            type: 'endpoint'
        });
    }
    
    return { functions, endpoints };
}

function extractTestCoverage(testDir) {
    const testFiles = fs.readdirSync(testDir)
        .filter(f => f.startsWith('test-') && f.endsWith('.js'))
        .map(f => path.join(testDir, f));
    
    const coveredEndpoints = new Set();
    const coveredFunctions = new Set();
    
    testFiles.forEach(testFile => {
        const content = fs.readFileSync(testFile, 'utf8');
        
        // Look for endpoint calls in tests
        const endpointPatterns = [
            /(?:GET|POST|PUT|DELETE|PATCH)\s+['"`]([^'"`]+)['"`]/gi,
            /makeRequest\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi,
            /['"`]\/(api\/[^'"`]+)['"`]/g
        ];
        
        endpointPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const method = match[1] || 'GET';
                const endpoint = match[2] || match[1];
                if (endpoint && endpoint.startsWith('/')) {
                    coveredEndpoints.add(`${method} ${endpoint}`);
                }
            }
        });
        
        // Look for function calls
        const functionCallPattern = /(\w+)\s*\(/g;
        let funcMatch;
        while ((funcMatch = functionCallPattern.exec(content)) !== null) {
            coveredFunctions.add(funcMatch[1]);
        }
    });
    
    return { coveredEndpoints, coveredFunctions };
}

function main() {
    console.log('🔍 Analyzing code coverage...\n');
    
    const serverPath = path.join(__dirname, '..', 'server.js');
    const testDir = path.join(__dirname, '..', 'scripts');
    
    if (!fs.existsSync(serverPath)) {
        console.error('❌ server.js not found');
        process.exit(1);
    }
    
    console.log('📖 Extracting functions and endpoints from server.js...');
    const { functions, endpoints } = extractFunctions(serverPath);
    console.log(`   Found ${functions.length} functions and ${endpoints.length} endpoints\n`);
    
    console.log('📋 Analyzing test files...');
    const { coveredEndpoints, coveredFunctions } = extractTestCoverage(testDir);
    console.log(`   Found ${coveredEndpoints.size} covered endpoints and ${coveredFunctions.size} function references\n`);
    
    // Find uncovered endpoints
    const uncoveredEndpoints = endpoints.filter(ep => {
        const key = `${ep.method} ${ep.path}`;
        // Check exact match or pattern match
        return !Array.from(coveredEndpoints).some(covered => {
            return covered.includes(ep.path) || ep.path.includes(covered.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, ''));
        });
    });
    
    // Find uncovered functions (approximate - functions might be called indirectly)
    const uncoveredFunctions = functions.filter(fn => {
        // Skip common built-ins and Express internals
        const skipList = ['require', 'module', 'exports', 'console', 'process', 'setTimeout', 'setInterval', 'clearInterval', 'parseInt', 'parseFloat', 'String', 'Number', 'Date', 'Array', 'Object', 'Promise', 'Buffer', 'JSON', 'Math', 'RegExp', 'Error', 'TypeError', 'RangeError'];
        if (skipList.includes(fn.name)) return false;
        
        // Check if function is referenced in tests
        return !coveredFunctions.has(fn.name);
    });
    
    // Group uncovered endpoints by category
    const endpointCategories = {
        'SuperAdmin': [],
        'Admin': [],
        'Store': [],
        'Public': [],
        'Other': []
    };
    
    uncoveredEndpoints.forEach(ep => {
        if (ep.path.includes('/superadmin')) {
            endpointCategories.SuperAdmin.push(ep);
        } else if (ep.path.includes('/admin')) {
            endpointCategories.Admin.push(ep);
        } else if (ep.path.includes('/store')) {
            endpointCategories.Store.push(ep);
        } else if (ep.path.startsWith('/api/') || ep.path.startsWith('/t/')) {
            endpointCategories.Public.push(ep);
        } else {
            endpointCategories.Other.push(ep);
        }
    });
    
    // Generate report
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 COVERAGE ANALYSIS REPORT');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log(`Total Endpoints: ${endpoints.length}`);
    console.log(`Covered Endpoints: ${endpoints.length - uncoveredEndpoints.length}`);
    console.log(`Uncovered Endpoints: ${uncoveredEndpoints.length}`);
    console.log(`Coverage: ${((endpoints.length - uncoveredEndpoints.length) / endpoints.length * 100).toFixed(1)}%\n`);
    
    console.log(`Total Functions: ${functions.length}`);
    console.log(`Potentially Uncovered Functions: ${uncoveredFunctions.length}\n`);
    
    // Show uncovered endpoints by category
    Object.entries(endpointCategories).forEach(([category, eps]) => {
        if (eps.length > 0) {
            console.log(`\n❌ Uncovered ${category} Endpoints (${eps.length}):`);
            eps.slice(0, 20).forEach(ep => {
                console.log(`   ${ep.method.padEnd(6)} ${ep.path} (line ${ep.line})`);
            });
            if (eps.length > 20) {
                console.log(`   ... and ${eps.length - 20} more`);
            }
        }
    });
    
    // Show uncovered functions (top 30)
    if (uncoveredFunctions.length > 0) {
        console.log(`\n⚠️  Potentially Uncovered Functions (showing top 30):`);
        uncoveredFunctions.slice(0, 30).forEach(fn => {
            console.log(`   ${fn.name} (line ${fn.line})`);
        });
        if (uncoveredFunctions.length > 30) {
            console.log(`   ... and ${uncoveredFunctions.length - 30} more`);
        }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('💡 Note: This is a static analysis. Some functions may be');
    console.log('   called indirectly or through middleware.');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Write detailed report to file
    const reportPath = path.join(__dirname, '..', 'coverage-analysis-report.json');
    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            totalEndpoints: endpoints.length,
            coveredEndpoints: endpoints.length - uncoveredEndpoints.length,
            uncoveredEndpoints: uncoveredEndpoints.length,
            coveragePercentage: ((endpoints.length - uncoveredEndpoints.length) / endpoints.length * 100).toFixed(1),
            totalFunctions: functions.length,
            uncoveredFunctions: uncoveredFunctions.length
        },
        uncoveredEndpoints: uncoveredEndpoints,
        uncoveredFunctions: uncoveredFunctions.slice(0, 100), // Limit to 100
        endpointCategories
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Detailed report saved to: ${reportPath}`);
}

main();





