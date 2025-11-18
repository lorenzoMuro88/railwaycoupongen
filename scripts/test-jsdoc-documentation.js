#!/usr/bin/env node
/**
 * JSDoc Documentation Test Suite
 * Tests that route files have complete JSDoc documentation following the established pattern
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const ADMIN_ROUTES_DIR = path.join(ROUTES_DIR, 'admin');

let testResults = [];
let passed = 0;
let failed = 0;

function log(message) {
    console.log(`[TEST] ${message}`);
}

function error(message) {
    console.error(`[ERROR] ${message}`);
}

/**
 * Extract JSDoc comment from function
 */
function extractJSDoc(content, functionName) {
    const lines = content.split('\n');
    let inJSDoc = false;
    let jsdoc = [];
    let foundFunction = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if we found the function
        if (line.includes(`function ${functionName}`) || 
            line.includes(`${functionName}(`) ||
            (functionName === 'setupAuthRoutes' && line.includes('function setupAuthRoutes'))) {
            foundFunction = true;
        }
        
        // Start collecting JSDoc if we see /** before the function
        if (line.trim().startsWith('/**') && !foundFunction) {
            inJSDoc = true;
            jsdoc.push(line);
            continue;
        }
        
        // Collect JSDoc lines
        if (inJSDoc) {
            jsdoc.push(line);
            if (line.trim().endsWith('*/')) {
                break;
            }
        }
    }
    
    return jsdoc.join('\n');
}

/**
 * Check if JSDoc has required tags
 */
function checkJSDocTags(jsdoc, routeType) {
    const requiredTags = {
        'route': ['@route'],
        'function': ['@param', '@returns'],
        'route-handler': ['@route', '@param', '@returns']
    };
    
    const checks = {
        hasRoute: jsdoc.includes('@route'),
        hasParam: jsdoc.includes('@param'),
        hasReturns: jsdoc.includes('@returns'),
        hasThrows: jsdoc.includes('@throws'),
        hasExample: jsdoc.includes('@example'),
        hasMiddleware: jsdoc.includes('@middleware'),
        hasDescription: jsdoc.includes('*') && jsdoc.split('*').length > 3 // Has description lines
    };
    
    return checks;
}

/**
 * Find route handlers in file
 */
function findRouteHandlers(content) {
    const handlers = [];
    
    // Find registerAdminRoute calls
    const registerAdminRouteRegex = /registerAdminRoute\(app,\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*async\s*\(/g;
    let match;
    while ((match = registerAdminRouteRegex.exec(content)) !== null) {
        handlers.push({
            type: 'registerAdminRoute',
            path: match[1],
            method: match[2].toUpperCase(),
            line: content.substring(0, match.index).split('\n').length
        });
    }
    
    // Find app.get/post/put/delete calls
    const appMethodRegex = /app\.(get|post|put|delete)\(['"]([^'"]+)['"]/g;
    while ((match = appMethodRegex.exec(content)) !== null) {
        handlers.push({
            type: 'appMethod',
            path: match[2],
            method: match[1].toUpperCase(),
            line: content.substring(0, match.index).split('\n').length
        });
    }
    
    return handlers;
}

/**
 * Test a route file
 */
function testRouteFile(filePath) {
    const fileName = path.basename(filePath);
    log(`Testing ${fileName}...`);
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const handlers = findRouteHandlers(content);
        
        if (handlers.length === 0) {
            log(`  ⚠️  No route handlers found in ${fileName}`);
            return;
        }
        
        log(`  Found ${handlers.length} route handler(s)`);
        
        // Check setup function documentation
        const setupFunctionName = fileName.replace('.js', 'Routes').replace(/^./, (c) => c.toUpperCase());
        const setupFunction = `setup${setupFunctionName.charAt(0).toUpperCase() + setupFunctionName.slice(1)}`;
        const setupJSDoc = extractJSDoc(content, setupFunction);
        
        if (!setupJSDoc || !setupJSDoc.includes('@param')) {
            failed++;
            testResults.push({
                file: fileName,
                handler: setupFunction,
                status: 'FAIL',
                issue: 'Setup function missing or incomplete JSDoc'
            });
            error(`  ❌ ${setupFunction} missing JSDoc`);
        } else {
            passed++;
            testResults.push({
                file: fileName,
                handler: setupFunction,
                status: 'PASS',
                issue: 'Setup function has JSDoc'
            });
            log(`  ✅ ${setupFunction} has JSDoc`);
        }
        
        // Check each route handler
        for (const handler of handlers) {
            // Try to find JSDoc before the handler
            // Look for JSDoc comment before registerAdminRoute or app.method call
            const handlerIndex = content.indexOf(`${handler.type === 'registerAdminRoute' ? 'registerAdminRoute' : `app.${handler.method.toLowerCase()}`}(`);
            const beforeHandler = content.substring(Math.max(0, handlerIndex - 2000), handlerIndex);
            const jsdocMatch = beforeHandler.match(/\/\*\*[\s\S]*?\*\//g);
            
            if (jsdocMatch && jsdocMatch.length > 0) {
                const jsdoc = jsdocMatch[jsdocMatch.length - 1]; // Get last JSDoc before handler
                const checks = checkJSDocTags(jsdoc, 'route-handler');
                
                const issues = [];
                if (!checks.hasRoute) issues.push('missing @route');
                if (!checks.hasParam) issues.push('missing @param');
                if (!checks.hasReturns) issues.push('missing @returns');
                if (!checks.hasExample) issues.push('missing @example');
                
                if (issues.length > 0) {
                    failed++;
                    testResults.push({
                        file: fileName,
                        handler: `${handler.method} ${handler.path}`,
                        status: 'FAIL',
                        issue: `JSDoc incomplete: ${issues.join(', ')}`
                    });
                    error(`  ❌ ${handler.method} ${handler.path} - ${issues.join(', ')}`);
                } else {
                    passed++;
                    testResults.push({
                        file: fileName,
                        handler: `${handler.method} ${handler.path}`,
                        status: 'PASS',
                        issue: 'JSDoc complete'
                    });
                    log(`  ✅ ${handler.method} ${handler.path} - JSDoc complete`);
                }
            } else {
                failed++;
                testResults.push({
                    file: fileName,
                    handler: `${handler.method} ${handler.path}`,
                    status: 'FAIL',
                    issue: 'Missing JSDoc comment'
                });
                error(`  ❌ ${handler.method} ${handler.path} - Missing JSDoc`);
            }
        }
    } catch (err) {
        error(`Error testing ${fileName}: ${err.message}`);
        failed++;
        testResults.push({
            file: fileName,
            handler: 'N/A',
            status: 'ERROR',
            issue: err.message
        });
    }
}

/**
 * Test helper functions in auth.js
 */
function testHelperFunctions() {
    log('Testing helper functions in routes/auth.js...');
    const authFilePath = path.join(ROUTES_DIR, 'auth.js');
    
    try {
        const content = fs.readFileSync(authFilePath, 'utf8');
        const helperFunctions = ['toSlug', 'logAction', 'verifyPassword', 'hashPassword'];
        
        for (const funcName of helperFunctions) {
            const jsdoc = extractJSDoc(content, funcName);
            if (!jsdoc || !jsdoc.includes('@param') || !jsdoc.includes('@returns')) {
                failed++;
                testResults.push({
                    file: 'auth.js',
                    handler: funcName,
                    status: 'FAIL',
                    issue: 'Helper function missing or incomplete JSDoc'
                });
                error(`  ❌ ${funcName} missing or incomplete JSDoc`);
            } else {
                passed++;
                testResults.push({
                    file: 'auth.js',
                    handler: funcName,
                    status: 'PASS',
                    issue: 'Helper function has complete JSDoc'
                });
                log(`  ✅ ${funcName} has complete JSDoc`);
            }
        }
    } catch (err) {
        error(`Error testing helper functions: ${err.message}`);
    }
}

/**
 * Main test function
 */
async function runTests() {
    log('Starting JSDoc documentation tests...\n');
    
    // Test admin route files
    const adminFiles = [
        'campaigns.js',
        'users.js',
        'coupons.js',
        'products.js',
        'auth-users.js',
        'settings.js',
        'analytics.js'
    ];
    
    for (const file of adminFiles) {
        const filePath = path.join(ADMIN_ROUTES_DIR, file);
        if (fs.existsSync(filePath)) {
            testRouteFile(filePath);
            log('');
        } else {
            log(`  ⚠️  File not found: ${file}`);
        }
    }
    
    // Test auth.js
    const authFilePath = path.join(ROUTES_DIR, 'auth.js');
    if (fs.existsSync(authFilePath)) {
        testRouteFile(authFilePath);
        testHelperFunctions();
        log('');
    }
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total tests: ${passed + failed}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
        console.log('\nFAILED TESTS:');
        testResults
            .filter(r => r.status === 'FAIL' || r.status === 'ERROR')
            .forEach(r => {
                console.log(`  - ${r.file} :: ${r.handler} :: ${r.issue}`);
            });
    }
    
    console.log('\n' + '='.repeat(60));
    
    // Exit with error code if tests failed
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
    error(`Fatal error: ${err.message}`);
    console.error(err);
    process.exit(1);
});

