#!/usr/bin/env node

/**
 * Script di test per l'invio email via Mailgun
 * Usa le stesse configurazioni del server
 */

require('dotenv').config();
const formData = require('form-data');
const Mailgun = require('mailgun.js');

// Verifica configurazione Mailgun
console.log('=== Verifica Configurazione Mailgun ===');
console.log('MAIL_PROVIDER:', process.env.MAIL_PROVIDER || '(non impostato)');
console.log('MAILGUN_API_KEY:', process.env.MAILGUN_API_KEY ? `${process.env.MAILGUN_API_KEY.substring(0, 10)}...` : '(non impostato)');
console.log('MAILGUN_DOMAIN:', process.env.MAILGUN_DOMAIN || '(non impostato)');
console.log('MAILGUN_REGION:', process.env.MAILGUN_REGION || 'eu (default)');
console.log('MAILGUN_FROM:', process.env.MAILGUN_FROM || '(non impostato)');
console.log('');

// Verifica che le variabili siano impostate
if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    console.error('❌ ERRORE: MAILGUN_API_KEY e MAILGUN_DOMAIN devono essere impostati nel file .env');
    console.error('   Assicurati di avere un file .env nella root del progetto con:');
    console.error('   MAIL_PROVIDER=mailgun');
    console.error('   MAILGUN_API_KEY=your_api_key');
    console.error('   MAILGUN_DOMAIN=your_domain.mailgun.org');
    process.exit(1);
}

// Costruisci il client Mailgun (stesso codice del server)
function buildMailgunClient() {
    const mailgun = new Mailgun(formData);
    const apiUrl = (process.env.MAILGUN_REGION || 'eu') === 'us' 
        ? 'https://api.mailgun.net' 
        : 'https://api.eu.mailgun.net';
    
    console.log('API URL Mailgun:', apiUrl);
    
    return mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY,
        url: apiUrl,
        timeout: 30000
    });
}

// Test invio email
async function testEmail() {
    const testTo = process.argv[2] || process.env.MAIL_TEST_TO || 'test@example.com';
    
    console.log('=== Test Invio Email ===');
    console.log('Destinatario:', testTo);
    console.log('');
    
    try {
        const mg = buildMailgunClient();
        const domain = process.env.MAILGUN_DOMAIN;
        const from = process.env.MAILGUN_FROM || `CouponGen <no-reply@${domain.replace(/\.mailgun\.org$/, '')}>`;
        
        console.log('Dominio Mailgun:', domain);
        console.log('Mittente:', from);
        console.log('');
        
        const messageData = {
            from: from,
            to: testTo,
            subject: 'Test Email - CouponGen Mailgun',
            html: '<p>Questa è un\'email di test da CouponGen.</p><p>Se ricevi questo messaggio, la configurazione Mailgun funziona correttamente!</p>'
        };
        
        console.log('Invio email in corso...');
        
        const result = await mg.messages.create(domain, messageData);
        
        console.log('✅ Email inviata con successo!');
        console.log('Message ID:', result.id);
        console.log('Messaggio:', result.message || 'OK');
        
    } catch (error) {
        console.error('❌ ERRORE durante l\'invio email:');
        console.error('Messaggio:', error.message);
        
        if (error.status) {
            console.error('Status Code:', error.status);
        }
        
        if (error.details) {
            console.error('Dettagli:', JSON.stringify(error.details, null, 2));
        }
        
        if (error.stack) {
            console.error('\nStack trace:');
            console.error(error.stack);
        }
        
        // Suggerimenti per problemi comuni
        console.error('\n=== Suggerimenti ===');
        if (error.message.includes('Forbidden') || error.status === 403) {
            console.error('- Verifica che MAILGUN_API_KEY sia corretto');
            console.error('- Verifica che MAILGUN_REGION corrisponda alla tua regione Mailgun (eu o us)');
        }
        if (error.message.includes('Domain') || error.status === 404) {
            console.error('- Verifica che MAILGUN_DOMAIN sia corretto');
            console.error('- Il dominio deve essere verificato nel tuo account Mailgun');
        }
        if (error.message.includes('Unauthorized') || error.status === 401) {
            console.error('- Verifica che MAILGUN_API_KEY sia valido e attivo');
        }
        if (error.message.includes('timeout')) {
            console.error('- Verifica la connessione internet');
            console.error('- Il timeout è impostato a 30 secondi');
        }
        
        process.exit(1);
    }
}

// Esegui il test
testEmail();

