#!/usr/bin/env node
/**
 * Test script per verificare la correttezza del file email-template.html
 * Verifica:
 * 1. Struttura HTML corretta (tag link nell'head)
 * 2. Presenza di tutti i file statici referenziati
 * 3. Validità base del JavaScript
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const EMAIL_TEMPLATE_PATH = path.join(PROJECT_ROOT, 'views', 'email-template.html');
const STATIC_DIR = path.join(PROJECT_ROOT, 'static');

let errors = [];
let warnings = [];

console.log('🔍 Testing email-template.html...\n');

// 1. Verifica esistenza file
if (!fs.existsSync(EMAIL_TEMPLATE_PATH)) {
    console.error('❌ File email-template.html non trovato!');
    process.exit(1);
}

const content = fs.readFileSync(EMAIL_TEMPLATE_PATH, 'utf8');

// 2. Verifica struttura HTML - tag link devono essere nell'head
console.log('📋 Verifica struttura HTML...');
const headMatch = content.match(/<head>([\s\S]*?)<\/head>/i);
const bodyMatch = content.match(/<body>([\s\S]*?)<\/body>/i);

if (!headMatch) {
    errors.push('Tag <head> non trovato');
} else {
    const headContent = headMatch[1];
    const bodyContent = bodyMatch ? bodyMatch[1] : '';
    
    // Verifica che i tag link siano nell'head e non nel body
    const linkInBody = bodyContent.match(/<link[^>]*>/gi);
    if (linkInBody) {
        errors.push(`Trovati ${linkInBody.length} tag <link> nel <body> invece che nell'<head>`);
        linkInBody.forEach(link => {
            errors.push(`  - ${link.trim()}`);
        });
    } else {
        console.log('  ✅ Tutti i tag <link> sono nell\'<head>');
    }
    
    // Verifica che SunEditor CSS sia nell'head
    if (headContent.includes('suneditor') && headContent.includes('link')) {
        console.log('  ✅ CSS SunEditor trovato nell\'<head>');
    } else if (headContent.includes('suneditor')) {
        warnings.push('CSS SunEditor potrebbe non essere caricato correttamente');
    }
}

// 3. Verifica file statici referenziati
console.log('\n📁 Verifica file statici...');
const staticFiles = [
    '/static/styles.css',
    '/static/navigation.css',
    '/static/navigation.js',
    '/static/navigation.html',
    '/static/notifications.js'
];

staticFiles.forEach(filePath => {
    const fileName = filePath.replace('/static/', '');
    const fullPath = path.join(STATIC_DIR, fileName);
    
    if (fs.existsSync(fullPath)) {
        console.log(`  ✅ ${fileName} trovato`);
    } else {
        errors.push(`File statico mancante: ${fileName}`);
    }
});

// 4. Verifica che non ci siano doppi listener DOMContentLoaded
console.log('\n🔍 Verifica JavaScript...');
const domContentLoadedMatches = content.match(/addEventListener\(['"]DOMContentLoaded['"]/gi);
if (domContentLoadedMatches) {
    if (domContentLoadedMatches.length > 1) {
        warnings.push(`Trovati ${domContentLoadedMatches.length} listener DOMContentLoaded (dovrebbe essere uno solo)`);
    } else {
        console.log('  ✅ Un solo listener DOMContentLoaded trovato');
    }
} else {
    warnings.push('Nessun listener DOMContentLoaded trovato');
}

// 5. Verifica gestione errori nel fetch
if (content.includes('fetch(\'/static/navigation.html\')')) {
    if (content.includes('response.ok') || content.includes('!response.ok')) {
        console.log('  ✅ Gestione errori nel fetch presente');
    } else {
        warnings.push('Fetch di navigation.html senza controllo response.ok');
    }
}

// 6. Verifica che tutti gli script siano chiusi correttamente
const scriptTags = content.match(/<script[^>]*>/gi) || [];
const scriptCloseTags = content.match(/<\/script>/gi) || [];
if (scriptTags.length !== scriptCloseTags.length) {
    errors.push(`Mismatch tag script: ${scriptTags.length} aperti, ${scriptCloseTags.length} chiusi`);
} else {
    console.log('  ✅ Tutti i tag script sono bilanciati');
}

// Report finale
console.log('\n' + '='.repeat(50));
if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Tutti i test passati!');
    process.exit(0);
} else {
    if (errors.length > 0) {
        console.log(`\n❌ Errori trovati (${errors.length}):`);
        errors.forEach(err => console.log(`  - ${err}`));
    }
    if (warnings.length > 0) {
        console.log(`\n⚠️  Avvisi (${warnings.length}):`);
        warnings.forEach(warn => console.log(`  - ${warn}`));
    }
    process.exit(errors.length > 0 ? 1 : 0);
}


