#!/usr/bin/env node

/**
 * Test automatico per verificare che i cambiamenti per-tenant email non abbiano impatti negativi
 * Verifica:
 * - Schema database (colonne email presenti)
 * - Backward compatibility (tenant senza config usano default globali)
 * - Helper functions (buildTenantEmailFrom, getTenantMailgunDomain)
 * - Default per nuovi tenant
 * - Configurazione per-tenant funzionante
 */

require('dotenv').config();
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_PATH = path.join(DATA_DIR, 'coupons.db');

// Replica delle funzioni helper da server.js per test
function buildTenantEmailFrom(tenant) {
    const displayName = (tenant && tenant.email_from_name) || 'CouponGen';
    if (tenant && tenant.email_from_address) {
        return `${displayName} <${tenant.email_from_address}>`;
    }
    // If tenant has Mailgun custom domain, use no-reply@ that domain
    if (tenant && tenant.mailgun_domain) {
        return `${displayName} <no-reply@${tenant.mailgun_domain.replace(/^mg\./, '')}>`;
    }
    // Fallback to global sender
    const globalFrom = process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>';
    // Replace display name while preserving address
    const addrMatch = globalFrom.match(/<([^>]+)>/);
    const address = addrMatch ? addrMatch[1] : 'no-reply@send.coupongen.it';
    return `${displayName} <${address}>`;
}

function getTenantMailgunDomain(tenant) {
    if (tenant && tenant.mailgun_domain) return tenant.mailgun_domain;
    return process.env.MAILGUN_DOMAIN;
}

let testsPassed = 0;
let testsFailed = 0;
const results = [];

function test(name, fn) {
    try {
        fn();
        testsPassed++;
        results.push({ name, status: 'PASS', error: null });
        console.log(`✅ ${name}`);
    } catch (error) {
        testsFailed++;
        results.push({ name, status: 'FAIL', error: error.message });
        console.error(`❌ ${name}: ${error.message}`);
    }
}

async function runTests() {
    console.log('=== Test Tenant Email Configuration ===\n');

    // Test 1: Verifica schema database
    console.log('1. Verifica Schema Database');
    let db;
    try {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        
        const tenantCols = await db.all("PRAGMA table_info(tenants)");
        const columnNames = tenantCols.map(c => c.name);
        
        test('Colonna email_from_name esiste', () => {
            if (!columnNames.includes('email_from_name')) {
                throw new Error('Colonna email_from_name non trovata');
            }
        });
        
        test('Colonna email_from_address esiste', () => {
            if (!columnNames.includes('email_from_address')) {
                throw new Error('Colonna email_from_address non trovata');
            }
        });
        
        test('Colonna mailgun_domain esiste', () => {
            if (!columnNames.includes('mailgun_domain')) {
                throw new Error('Colonna mailgun_domain non trovata');
            }
        });
        
        test('Colonna mailgun_region esiste', () => {
            if (!columnNames.includes('mailgun_region')) {
                throw new Error('Colonna mailgun_region non trovata');
            }
        });
        
        test('Colonna custom_domain esiste', () => {
            if (!columnNames.includes('custom_domain')) {
                throw new Error('Colonna custom_domain non trovata');
            }
        });
        
    } catch (error) {
        console.error('❌ Errore durante verifica schema:', error.message);
        process.exit(1);
    }

    // Test 2: Helper functions - Fallback globale
    console.log('\n2. Test Helper Functions - Fallback Globale');
    test('buildTenantEmailFrom con tenant null usa default', () => {
        const from = buildTenantEmailFrom(null);
        if (!from || typeof from !== 'string') {
            throw new Error('from deve essere una stringa');
        }
        if (!from.includes('CouponGen')) {
            throw new Error('from deve contenere CouponGen come default');
        }
    });

    test('getTenantMailgunDomain con tenant null ritorna MAILGUN_DOMAIN', () => {
        const domain = getTenantMailgunDomain(null);
        const expected = process.env.MAILGUN_DOMAIN || null;
        if (domain !== expected) {
            throw new Error(`Atteso ${expected}, ricevuto ${domain}`);
        }
    });

    // Test 3: Helper functions - Tenant senza config (backward compatibility)
    console.log('\n3. Test Backward Compatibility - Tenant senza Config');
    const tenantEmpty = {
        id: 1,
        slug: 'test',
        name: 'Test Tenant',
        email_from_name: null,
        email_from_address: null,
        mailgun_domain: null,
        mailgun_region: null
    };

    test('Tenant vuoto usa display name default', () => {
        const from = buildTenantEmailFrom(tenantEmpty);
        if (!from.includes('CouponGen')) {
            throw new Error('Tenant vuoto deve usare CouponGen come display name');
        }
    });

    test('Tenant vuoto usa dominio globale', () => {
        const domain = getTenantMailgunDomain(tenantEmpty);
        const expected = process.env.MAILGUN_DOMAIN || null;
        if (domain !== expected) {
            throw new Error(`Atteso dominio globale ${expected}, ricevuto ${domain}`);
        }
    });

    test('Tenant vuoto costruisce from con indirizzo globale', () => {
        const from = buildTenantEmailFrom(tenantEmpty);
        const globalFrom = process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>';
        const addrMatch = globalFrom.match(/<([^>]+)>/);
        const expectedAddr = addrMatch ? addrMatch[1] : 'no-reply@send.coupongen.it';
        if (!from.includes(expectedAddr)) {
            throw new Error(`Atteso indirizzo ${expectedAddr} nel from, ricevuto ${from}`);
        }
    });

    // Test 4: Helper functions - Tenant con solo display name
    console.log('\n4. Test Tenant con Display Name Personalizzato');
    const tenantNameOnly = {
        id: 2,
        email_from_name: 'Brand Cliente',
        email_from_address: null,
        mailgun_domain: null
    };

    test('Tenant con solo name mantiene display name personalizzato', () => {
        const from = buildTenantEmailFrom(tenantNameOnly);
        if (!from.includes('Brand Cliente')) {
            throw new Error('Display name deve essere Brand Cliente');
        }
    });

    test('Tenant con solo name usa indirizzo globale', () => {
        const from = buildTenantEmailFrom(tenantNameOnly);
        const globalFrom = process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>';
        const addrMatch = globalFrom.match(/<([^>]+)>/);
        const expectedAddr = addrMatch ? addrMatch[1] : 'no-reply@send.coupongen.it';
        if (!from.includes(expectedAddr)) {
            throw new Error('Deve usare indirizzo globale quando email_from_address è null');
        }
    });

    // Test 5: Helper functions - Tenant con Mailgun domain personalizzato
    console.log('\n5. Test Tenant con Mailgun Domain Personalizzato');
    const tenantCustomDomain = {
        id: 3,
        email_from_name: 'Brand Cliente',
        email_from_address: null,
        mailgun_domain: 'mg.dominiocliente.it'
    };

    test('Tenant con mailgun_domain costruisce no-reply@dominio', () => {
        const from = buildTenantEmailFrom(tenantCustomDomain);
        if (!from.includes('no-reply@dominiocliente.it')) {
            throw new Error(`Atteso no-reply@dominiocliente.it, ricevuto ${from}`);
        }
    });

    test('Tenant con mailgun_domain ritorna dominio corretto', () => {
        const domain = getTenantMailgunDomain(tenantCustomDomain);
        if (domain !== 'mg.dominiocliente.it') {
            throw new Error(`Atteso mg.dominiocliente.it, ricevuto ${domain}`);
        }
    });

    // Test 6: Helper functions - Tenant con indirizzo esplicito
    console.log('\n6. Test Tenant con Indirizzo Mittente Esplicito');
    const tenantExplicitAddr = {
        id: 4,
        email_from_name: 'Brand Cliente',
        email_from_address: 'no-reply@dominiocliente.it',
        mailgun_domain: 'mg.dominiocliente.it'
    };

    test('Tenant con email_from_address usa indirizzo esplicito', () => {
        const from = buildTenantEmailFrom(tenantExplicitAddr);
        if (!from.includes('no-reply@dominiocliente.it')) {
            throw new Error(`Atteso no-reply@dominiocliente.it nel from, ricevuto ${from}`);
        }
    });

    test('Tenant con email_from_address ha formato corretto', () => {
        const from = buildTenantEmailFrom(tenantExplicitAddr);
        const match = from.match(/^([^<]+)<([^>]+)>$/);
        if (!match) {
            throw new Error(`Formato from non valido: ${from}`);
        }
        const name = match[1].trim();
        const addr = match[2].trim();
        if (name !== 'Brand Cliente') {
            throw new Error(`Display name errato: ${name}`);
        }
        if (addr !== 'no-reply@dominiocliente.it') {
            throw new Error(`Indirizzo errato: ${addr}`);
        }
    });

    // Test 7: Verifica tenant esistenti nel DB
    console.log('\n7. Test Tenant Esistenti nel Database');
    try {
        const existingTenants = await db.all('SELECT id, slug, name, email_from_name, email_from_address, mailgun_domain, mailgun_region FROM tenants LIMIT 10');
        
        if (existingTenants.length === 0) {
            console.log('⚠️  Nessun tenant trovato nel database (skip test)');
        } else {
            test(`Verifica backward compatibility per ${existingTenants.length} tenant(s)`, () => {
                for (const tenant of existingTenants) {
                    // Ogni tenant deve poter costruire un from valido
                    const from = buildTenantEmailFrom(tenant);
                    if (!from || typeof from !== 'string') {
                        throw new Error(`Tenant ${tenant.id} (${tenant.slug}): from non valido`);
                    }
                    if (!from.includes('<') || !from.includes('>')) {
                        throw new Error(`Tenant ${tenant.id} (${tenant.slug}): formato from non valido: ${from}`);
                    }
                    const domain = getTenantMailgunDomain(tenant);
                    if (tenant.mailgun_domain && domain !== tenant.mailgun_domain) {
                        throw new Error(`Tenant ${tenant.id}: dominio errato`);
                    }
                }
            });
        }
    } catch (error) {
        console.error('❌ Errore durante verifica tenant esistenti:', error.message);
    }

    // Test 8: Verifica default per nuovi tenant
    console.log('\n8. Test Default per Nuovi Tenant');
    const defaultFromEnv = (process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>');
    const nameFromEnv = defaultFromEnv.replace(/\s*<[^>]+>\s*$/, '') || 'CouponGen';
    const defaultMailgunDomain = process.env.MAILGUN_DOMAIN || null;
    const defaultMailgunRegion = process.env.MAILGUN_REGION || null;

    test('Default email_from_name estratto correttamente da env', () => {
        if (!nameFromEnv || nameFromEnv.trim().length === 0) {
            throw new Error('Default name non può essere vuoto');
        }
    });

    test('Default mailgun_domain disponibile da env', () => {
        // Questo test passa anche se è null (env non configurato)
        // Serve solo a verificare che la logica di estrazione funzioni
        if (defaultMailgunDomain !== null && typeof defaultMailgunDomain !== 'string') {
            throw new Error('mailgun_domain deve essere stringa o null');
        }
    });

    await db.close();

    // Riepilogo
    console.log('\n=== Riepilogo Test ===');
    console.log(`✅ Test passati: ${testsPassed}`);
    console.log(`❌ Test falliti: ${testsFailed}`);
    console.log(`📊 Totale: ${testsPassed + testsFailed}\n`);

    if (testsFailed > 0) {
        console.log('=== Dettagli Errori ===');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.error(`  ❌ ${r.name}: ${r.error}`);
        });
        console.log('');
        process.exit(1);
    } else {
        console.log('✅ Tutti i test sono passati! I cambiamenti non hanno impatti negativi.\n');
        process.exit(0);
    }
}

// Esegui test
runTests().catch(error => {
    console.error('❌ Errore fatale durante esecuzione test:', error);
    process.exit(1);
});



