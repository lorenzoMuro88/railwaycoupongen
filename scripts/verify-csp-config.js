#!/usr/bin/env node
/**
 * Verify CSP script-src-attr configuration in server.js
 * This script checks that the configuration is correct in the code
 */

const fs = require('fs');
const path = require('path');

const serverJsPath = path.join(__dirname, '..', 'server.js');

function log(message) {
    console.log(`[VERIFY] ${message}`);
}

function verifyCSPConfig() {
    log('=== Verifying CSP script-src-attr Configuration ===');
    log('');
    
    try {
        const serverJsContent = fs.readFileSync(serverJsPath, 'utf8');
        
        // Check if scriptSrcAttr is present
        if (serverJsContent.includes('scriptSrcAttr')) {
            log('✅ scriptSrcAttr directive found in server.js');
            
            // Check if it contains unsafe-inline
            if (serverJsContent.includes("scriptSrcAttr: [\"'unsafe-inline'\"]") || 
                serverJsContent.includes('scriptSrcAttr: [\'"unsafe-inline"\']') ||
                serverJsContent.includes("scriptSrcAttr: [\"'unsafe-inline'\"") ||
                serverJsContent.match(/scriptSrcAttr:\s*\[.*unsafe-inline.*\]/)) {
                log('✅ scriptSrcAttr contains unsafe-inline');
                
                // Extract the line for verification
                const lines = serverJsContent.split('\n');
                const scriptSrcAttrLine = lines.find(line => line.includes('scriptSrcAttr'));
                if (scriptSrcAttrLine) {
                    log(`   Found: ${scriptSrcAttrLine.trim()}`);
                }
                
                log('');
                log('✅ Configuration is correct!');
                log('');
                log('To test in production:');
                log('  1. Stop the current server');
                log('  2. Set NODE_ENV=production');
                log('  3. Start the server: npm start');
                log('  4. Open http://localhost:3000/superadmin in browser');
                log('  5. Check browser console for CSP errors');
                log('');
                return true;
            } else {
                log('❌ scriptSrcAttr found but does not contain unsafe-inline');
                return false;
            }
        } else {
            log('❌ scriptSrcAttr directive NOT found in server.js');
            log('   The CSP configuration needs to include scriptSrcAttr');
            return false;
        }
        
    } catch (error) {
        log(`❌ Error reading server.js: ${error.message}`);
        return false;
    }
}

if (require.main === module) {
    const success = verifyCSPConfig();
    process.exit(success ? 0 : 1);
}

module.exports = { verifyCSPConfig };


