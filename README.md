# CouponGen

![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

**CouponGen** è un'applicazione Node.js standalone per generare coupon via form web, inviare email con QR code e permettere il riscatto in negozio tramite interfaccia protetta.

## 🚀 Caratteristiche

- **Generazione Coupon**: Form web personalizzabile per la raccolta dati utenti
- **Email Automatiche**: Invio automatico di email con QR code allegato
- **Gestione Campagne**: Sistema completo per gestire campagne promozionali
- **Interfaccia Cassa**: Sistema protetto per il riscatto coupon in negozio
- **Analytics**: Dashboard completa con statistiche e report
- **Database SQLite**: Nessun database esterno richiesto
- **API REST**: API complete per integrazione con sistemi esterni

## 📋 Requisiti

- Node.js 18 o superiore
- Nessun database esterno (usa SQLite locale)

## ⚡ Installazione Rapida

1. **Clona il repository**
```bash
git clone https://github.com/TUO_USERNAME/CouponGen.git
cd CouponGen
```

2. **Installa le dipendenze**
```bash
npm install
```

3. **Configura l'ambiente**
```bash
cp env.example .env
# Modifica il file .env con le tue configurazioni
```

4. **Avvia l'applicazione**
```bash
# Sviluppo
npm run dev

# Produzione
npm start
```

## 🔧 Configurazione

### Variabili d'Ambiente

Copia `env.example` in `.env` e configura:

```env
# Server
PORT=3000

# Autenticazione
STORE_USER=admin
STORE_PASS=admin123

# Email (scegli un provider)
MAIL_PROVIDER=mailgun
MAILGUN_API_KEY=your_key
MAILGUN_DOMAIN=your_domain.mailgun.org
```

### Provider Email Supportati

1. **Mailgun** (Raccomandato)
2. **SMTP** (Gmail, Outlook, etc.)
3. **Modalità Sviluppo** (log in console)

## 🌐 Utilizzo

### Interfacce Principali

- **Form Pubblico**: `http://localhost:3000`
- **Interfaccia Cassa**: `http://localhost:3000/store` (protetta)
- **Pannello Admin**: `http://localhost:3000/admin` (protetto)
- **Analytics**: `http://localhost:3000/analytics` (protetto)

### API Endpoints

#### Pubblici
- `GET /api/campaigns/:code` - Dettagli campagna
- `POST /submit` - Invio form coupon

#### Protetti (Basic Auth)
- `GET /api/admin/coupons` - Lista coupon
- `GET /api/admin/campaigns` - Gestione campagne
- `GET /api/admin/analytics/*` - Statistiche

## 📊 Funzionalità

### Gestione Campagne
- Creazione e configurazione campagne promozionali
- Campi personalizzati per il form
- Configurazione sconti (percentuale o fisso)
- Associazione prodotti

### Sistema Coupon
- Generazione automatica codici unici
- QR code per riscatto rapido
- Tracking stato (attivo, riscattato, scaduto)
- Email automatiche con template personalizzabili

### Interfaccia Cassa
- Ricerca coupon per codice o cognome
- Riscatto immediato
- Lista coupon attivi e riscattati
- Interfaccia ottimizzata per tablet

### Analytics
- Dashboard con statistiche complete
- Report per campagna
- Export dati in CSV
- Grafici temporali

## 🔒 Sicurezza

- **Basic Authentication** per aree protette
- **Validazione input** su tutti i form
- **SQL Injection protection** tramite prepared statements
- **Rate limiting** consigliato per produzione

## 🚀 Deploy in Produzione

1. **Configura HTTPS**
2. **Imposta credenziali sicure** in `.env`
3. **Configura provider email reale**
4. **Considera backup automatici** del database SQLite
5. **Usa un process manager** come PM2

### Esempio con PM2

```bash
npm install -g pm2
pm2 start server.js --name "couponen"
pm2 startup
pm2 save
```

## 📁 Struttura Progetto

```
CouponGen/
├── data/                 # Database SQLite
├── static/              # File CSS/JS statici
├── views/               # Template HTML
├── server.js            # Server principale
├── package.json         # Dipendenze
├── env.example          # Template configurazione
└── README.md           # Documentazione
```

## 🤝 Contribuire

1. Fork del progetto
2. Crea un branch per la tua feature (`git checkout -b feature/AmazingFeature`)
3. Commit delle modifiche (`git commit -m 'Add some AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Apri una Pull Request

## 📝 Licenza

Distribuito sotto licenza MIT. Vedi `LICENSE` per maggiori informazioni.

## 🆘 Supporto

Per supporto e domande:
- Apri una [Issue](https://github.com/TUO_USERNAME/CouponGen/issues)
- Controlla la [documentazione](https://github.com/TUO_USERNAME/CouponGen/wiki)

## 🔄 Changelog

### v1.0.0
- Rilascio iniziale
- Sistema completo gestione coupon
- Interfaccia admin e cassa
- Analytics e reporting
- Supporto email con QR code



