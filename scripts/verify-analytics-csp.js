#!/usr/bin/env node
/**
 * Verify CSP configuration for Analytics page (Chart.js CDN)
 * Checks that cdn.jsdelivr.net is configured in scriptSrc and styleSrc
 */

const fs = require('fs');
const path = require('path');

const serverJsPath = path.join(__dirname, '..', 'server.js');

function log(message) {
    console.log(`[VERIFY] ${message}`);
}

function verifyAnalyticsCSP() {
    log('=== Verifying CSP Configuration for Analytics Page ===');
    log('');
    
    try {
        const serverJsContent = fs.readFileSync(serverJsPath, 'utf8');
        
        // Check scriptSrc for cdn.jsdelivr.net
        if (serverJsContent.includes('scriptSrc')) {
            log('✅ scriptSrc directive found in server.js');
            
            // Extract scriptSrc line
            const lines = serverJsContent.split('\n');
            const scriptSrcLine = lines.find(line => line.includes('scriptSrc') && line.includes(':'));
            
            if (scriptSrcLine) {
                log(`   Found: ${scriptSrcLine.trim()}`);
                
                if (scriptSrcLine.includes('cdn.jsdelivr.net')) {
                    log('✅ cdn.jsdelivr.net is configured in scriptSrc');
                } else {
                    log('❌ cdn.jsdelivr.net is NOT configured in scriptSrc');
                    log('   Chart.js will be blocked by CSP!');
                    return false;
                }
            }
        } else {
            log('❌ scriptSrc directive NOT found in server.js');
            return false;
        }
        
        // Check styleSrc for cdn.jsdelivr.net
        if (serverJsContent.includes('styleSrc')) {
            log('');
            log('✅ styleSrc directive found in server.js');
            
            const lines = serverJsContent.split('\n');
            const styleSrcLine = lines.find(line => line.includes('styleSrc') && line.includes(':'));
            
            if (styleSrcLine) {
                log(`   Found: ${styleSrcLine.trim()}`);
                
                if (styleSrcLine.includes('cdn.jsdelivr.net')) {
                    log('✅ cdn.jsdelivr.net is configured in styleSrc');
                } else {
                    log('⚠️  cdn.jsdelivr.net is NOT configured in styleSrc');
                    log('   This is OK if you are not using SunEditor CSS from CDN');
                }
            }
        } else {
            log('⚠️  styleSrc directive NOT found in server.js');
        }
        
        // Check connectSrc for cdn.jsdelivr.net (needed for source maps)
        if (serverJsContent.includes('connectSrc')) {
            log('');
            log('✅ connectSrc directive found in server.js');
            
            const lines = serverJsContent.split('\n');
            const connectSrcLine = lines.find(line => line.includes('connectSrc') && line.includes(':'));
            
            if (connectSrcLine) {
                log(`   Found: ${connectSrcLine.trim()}`);
                
                if (connectSrcLine.includes('cdn.jsdelivr.net')) {
                    log('✅ cdn.jsdelivr.net is configured in connectSrc');
                    log('   Source maps will load correctly!');
                } else {
                    log('❌ cdn.jsdelivr.net is NOT configured in connectSrc');
                    log('   Source maps will be blocked by CSP!');
                    return false;
                }
            }
        } else {
            log('⚠️  connectSrc directive NOT found in server.js');
        }
        
        log('');
        log('✅ Configuration verification PASSED!');
        log('');
        log('To test in production mode:');
        log('  1. Set required environment variables (SESSION_SECRET, etc.)');
        log('  2. Set NODE_ENV=production');
        log('  3. Start the server: npm start');
        log('  4. Open http://localhost:3000/analytics in browser');
        log('  5. Login if required');
        log('  6. Open browser DevTools (F12) → Console tab');
        log('  7. Verify no CSP errors about cdn.jsdelivr.net');
        log('  8. Verify Chart.js loads and charts are displayed correctly');
        log('');
        
        return true;
        
    } catch (error) {
        log(`❌ Error reading server.js: ${error.message}`);
        return false;
    }
}

if (require.main === module) {
    const success = verifyAnalyticsCSP();
    process.exit(success ? 0 : 1);
}

module.exports = { verifyAnalyticsCSP };

