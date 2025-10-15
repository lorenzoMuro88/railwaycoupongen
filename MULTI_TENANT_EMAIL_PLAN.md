# Piano per Sistema Email Multi-Tenant

## 📋 Fase 1: Analisi e Progettazione
- **Analizzare architettura attuale**: Come funziona l'invio email oggi nel `server.js`
- **Identificare provider**: Mailgun attuale, valutare alternative (SES, SendGrid)
- **Progettare schema DB**: Tabelle `tenants`, `tenant_domains`, `email_templates`
- **Definire API**: Endpoint per gestione domini e configurazioni

## 🏗️ Fase 2: Architettura Core
- **EmailService abstraction**: Classe per gestire provider multipli
- **Tenant context**: Middleware per identificare tenant nelle richieste
- **Provider factory**: Pattern per istanziare provider corretto per tenant
- **Configuration management**: Sistema per salvare/caricare config per tenant

## 🔧 Fase 3: Gestione Domini
- **API domini**: `POST /api/domains`, `GET /api/domains/:id/status`
- **Integrazione Mailgun API**: Aggiunta/verifica domini programmatica
- **DNS verification**: Controllo automatico record SPF/DKIM
- **Status tracking**: pending → verified → active → suspended

## 🎨 Fase 4: Interfaccia Utente
- **Wizard onboarding**: Step-by-step per configurazione dominio
- **Dashboard tenant**: Gestione domini, template, statistiche
- **Pannello admin**: Overview tutti i tenant, monitoraggio
- **Test email**: Funzione "invia a me stesso" per test

## 🔒 Fase 5: Sicurezza e Validazione
- **Domain validation**: Solo domini verificati, blocca freemail
- **Rate limiting**: Per tenant e per dominio
- **Audit logging**: Traccia modifiche configurazioni
- **Access control**: Permessi per gestione domini

## 📊 Fase 6: Monitoraggio e Analytics
- **Deliverability metrics**: Bounce rate, open rate per tenant
- **Error tracking**: Log errori invio, retry logic
- **Performance monitoring**: Tempo invio, throughput
- **Alerting**: Notifiche per problemi reputazione

## 🎯 Fase 7: Personalizzazione
- **Template system**: Email template per-tenant
- **Branding**: Header, footer, colori personalizzabili
- **Localization**: Supporto multi-lingua
- **Custom fields**: Campi dinamici nei template

## 🧪 Fase 8: Testing e Deploy
- **Unit tests**: Per EmailService e API
- **Integration tests**: Con provider reali (sandbox)
- **Load testing**: Performance con molti tenant
- **Documentation**: API docs, setup guide
- **Migration plan**: Da sistema attuale a multi-tenant

## 📈 Fase 9: Ottimizzazione
- **Caching**: Config tenant, template, DNS records
- **Batch processing**: Invii massivi ottimizzati
- **Provider failover**: Backup provider se principale down
- **Cost optimization**: Monitoraggio costi per tenant

## 🚀 Fase 10: Advanced Features
- **A/B testing**: Template email per tenant
- **Automation**: Workflow email automatici
- **Webhooks**: Notifiche eventi email
- **Analytics avanzate**: Heatmap, conversion tracking

---

## Strategie per Sender Email Personalizzabili

### Opzioni per Mittente Email per-Tenant

1. **Un solo provider, identità verificate per-tenant**
   - Un account (es. SES/SendGrid/Postmark), più domini/identità verificate
   - Semplice gestione centralizzata, buona deliverability
   - **Scelta predefinita**

2. **Credenziali/provider separati per-tenant**
   - Ogni tenant usa le proprie API key/account
   - Massimo isolamento di reputazione, più complessità operativa e costi

3. **Solo alias visivo (display name/Reply-To)**
   - `From` resta sul vostro dominio, personalizzi `display name` e `Reply-To`
   - Zero DNS per il tenant, ma brand limitato e allineamento DMARC non perfetto

4. **Dominio personalizzato completo (whitelabel)**
   - `From`, `Return-Path` e dominio di tracking sul dominio del tenant
   - Con SPF/DKIM/DMARC. Migliore brand e deliverability, onboarding DNS richiesto

5. **SMTP del tenant (bring-your-own SMTP)**
   - Vi collegate al server SMTP scelto dal tenant
   - Isolamento totale e responsabilità al tenant; gestione errori/timeout più complessa

6. **Solo envelope-from personalizzato**
   - `Return-Path` per bounce per-tenant, `Header From` condiviso
   - Facilita routing bounce per-tenant, brand limitato

### Come Mailgun Sa dei Domini dei Tenant

1. **Aggiunta domini in Mailgun Dashboard**
   - Ogni tenant deve aggiungere il suo dominio (es. `acme.com`) nel vostro account Mailgun
   - Mailgun genera record DNS da configurare: SPF, DKIM, tracking
   - Una volta verificato, Mailgun può inviare da quel dominio

2. **Configurazione programmatica via API**
   ```javascript
   // Aggiungi dominio per tenant via Mailgun API
   const addDomain = async (domain) => {
     const response = await fetch(`https://api.mailgun.net/v3/domains`, {
       method: 'POST',
       headers: {
         'Authorization': `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`
       },
       body: new URLSearchParams({
         name: domain,
         smtp_password: 'generated-password'
       })
     });
     return response.json();
   };
   ```

3. **Flusso tipico**
   - Tenant inserisce il suo dominio nel vostro pannello
   - Voi chiamate Mailgun API per aggiungere il dominio
   - Mailgun restituisce i record DNS da configurare
   - Tenant configura SPF/DKIM nel suo DNS
   - Voi verificate che i record siano attivi
   - Solo allora abilitate l'invio da quel dominio

4. **Gestione nel DB**
   ```sql
   CREATE TABLE tenant_domains (
     id INTEGER PRIMARY KEY,
     tenant_id INTEGER,
     domain VARCHAR(255),
     mailgun_domain VARCHAR(255), -- es. "mg.acme.com"
     status VARCHAR(50), -- pending, verified, active
     dns_records JSON, -- record da configurare
     created_at DATETIME
   );
   ```

### Best Practices

- **Modello dati chiaro**: Tabella/collezione `tenants` con campi per `fromName`, `fromEmail`, `replyTo`, `envelopeFrom`, `provider`, `providerApiKey/credentials`, `dkimSelector`, `domain`, `bccPolicy`, `footerTemplate`

- **Verifica e proprietà del dominio**: Obbliga la verifica del dominio del mittente per ogni tenant (no free-text spoofing)

- **Gestione provider**: Un provider centralizzato (es. SES/SendGrid/Postmark) con identità per-tenant è di solito più semplice e sicuro

- **Parametri di invio**: Distingui `Header From`, `Reply-To`, e `Return-Path`/`envelope-from` per bounce/feedback loop corretti

- **Sicurezza e limiti**: Validazione rigorosa: consenti solo domini verificati; blocca `gmail.com`/freemail come mittenti

- **Reputazione e deliverability**: Preferisci IP condivisi inizialmente; IP dedicati solo con volumi stabili e warmup progressivo

---

**Priorità suggerita**: Iniziare con Fase 1-3 per MVP, poi espandere gradualmente. Ogni fase può essere sviluppata e testata indipendentemente.

**Data creazione**: $(date)
**Versione**: 1.0
