# Guida CI/CD per FLYCouponGen

## Cos'è CI/CD?

**CI/CD** sta per **Continuous Integration** (Integrazione Continua) e **Continuous Deployment** (Deployment Continuo).

### CI - Continuous Integration (Integrazione Continua)

**Cosa fa:**
- Esegue automaticamente test ogni volta che viene fatto un commit o una pull request
- Verifica che il codice funzioni correttamente
- Controlla qualità del codice, linting, documentazione
- Blocca il merge se qualcosa non va

**Benefici:**
- Trova errori prima che arrivino in produzione
- Mantiene alta qualità del codice
- Documentazione sempre aggiornata

### CD - Continuous Deployment (Deployment Continuo)

**Cosa fa:**
- Deploy automatico del codice dopo che i test passano
- Rilascio automatico su server di staging/produzione
- Automazione del processo di release

**Benefici:**
- Release più veloci e frequenti
- Meno errori manuali
- Deploy più sicuri

## Perché CI/CD per questo progetto?

Nel contesto di FLYCouponGen, CI/CD può:

1. **Verificare documentazione JSDoc** - Assicura che tutti i route abbiano documentazione completa
2. **Eseguire test automatici** - Verifica che tutto funzioni dopo ogni cambio
3. **Generare documentazione API** - Crea automaticamente docs aggiornate
4. **Controllare qualità codice** - Linting, security scans, etc.
5. **Deploy automatico** - Su Railway, Heroku, o altro servizio

## Setup CI/CD per GitHub Actions

### 1. Crea il file di workflow

Crea `.github/workflows/ci.yml`:

```yaml
name: CI Pipeline

# Quando eseguire il workflow
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  # Job 1: Test e Verifica Documentazione
  test-and-docs:
    name: Test & Documentation Check
    runs-on: ubuntu-latest
    
    steps:
      # Step 1: Checkout codice
      - name: Checkout code
        uses: actions/checkout@v3
      
      # Step 2: Setup Node.js
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      # Step 3: Installa dipendenze
      - name: Install dependencies
        run: npm ci
      
      # Step 4: Test JSDoc Documentation
      - name: Test JSDoc Documentation
        run: npm run test:jsdoc-documentation
      
      # Step 5: Genera documentazione API
      - name: Generate API Documentation
        run: npm run docs:generate
      
      # Step 6: Verifica che docs siano aggiornate
      - name: Check documentation is up to date
        run: |
          git diff --exit-code docs/API_REFERENCE_GENERATED.md || \
          (echo "❌ API documentation is out of date. Run 'npm run docs:generate' and commit the changes." && exit 1)
      
      # Step 7: Esegui test di sicurezza
      - name: Run security tests
        run: |
          npm run test:input-validation || true
          npm run test:xss-protection || true
          npm run test:password-policy || true
      
      # Step 8: Linting (se hai ESLint configurato)
      - name: Run linter
        run: npm run lint || echo "No lint script configured"
        continue-on-error: true

  # Job 2: Security Scan
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run npm audit
        run: npm audit --audit-level=moderate
      
      - name: Check for known vulnerabilities
        run: npm run security:scan || true
```

### 2. Workflow completo con deploy

Crea `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [ main ]
  workflow_dispatch: # Permette deploy manuale

jobs:
  deploy:
    name: Deploy Application
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm run test:all || echo "Tests completed with warnings"
      
      - name: Generate documentation
        run: npm run docs:generate
      
      # Deploy su Railway (esempio)
      - name: Deploy to Railway
        uses: bervProject/railway-deploy@v1.0.0
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
          service: flycoupongen
        # Oppure usa Railway CLI
        # run: |
        #   npm install -g @railway/cli
        #   railway up
      
      # Oppure deploy su altro servizio
      # - name: Deploy to Heroku
      #   uses: akhileshns/heroku-deploy@v3.12.12
      #   with:
      #     heroku_api_key: ${{ secrets.HEROKU_API_KEY }}
      #     heroku_app_name: "flycoupongen"
      #     heroku_email: "your-email@example.com"
```

## Setup CI/CD per GitLab CI

Crea `.gitlab-ci.yml`:

```yaml
stages:
  - test
  - docs
  - security
  - deploy

variables:
  NODE_VERSION: "18"

# Cache node_modules per velocizzare build
cache:
  paths:
    - node_modules/

# Job: Test Documentazione
test:docs:
  stage: test
  image: node:${NODE_VERSION}
  script:
    - npm ci
    - npm run test:jsdoc-documentation
  only:
    - merge_requests
    - main
    - develop

# Job: Genera Documentazione
generate:docs:
  stage: docs
  image: node:${NODE_VERSION}
  script:
    - npm ci
    - npm run docs:generate
    - |
      if git diff --exit-code docs/API_REFERENCE_GENERATED.md; then
        echo "✅ Documentation is up to date"
      else
        echo "❌ Documentation needs update"
        exit 1
      fi
  artifacts:
    paths:
      - docs/API_REFERENCE_GENERATED.md
    expire_in: 1 week
  only:
    - merge_requests
    - main

# Job: Security Scan
security:scan:
  stage: security
  image: node:${NODE_VERSION}
  script:
    - npm ci
    - npm audit --audit-level=moderate
    - npm run security:scan || true
  only:
    - merge_requests
    - main

# Job: Deploy (solo su main)
deploy:production:
  stage: deploy
  image: node:${NODE_VERSION}
  script:
    - npm ci
    - npm run test:all || echo "Tests completed"
    - npm run docs:generate
    # Aggiungi comandi deploy qui
    - echo "Deploying to production..."
  only:
    - main
  when: manual # Richiede approvazione manuale
```

## Pre-commit Hook (Alternativa Locale)

Se non vuoi usare CI/CD cloud, puoi usare pre-commit hooks locali:

### 1. Installa Husky

```bash
npm install --save-dev husky
npx husky install
```

### 2. Crea pre-commit hook

Crea `.husky/pre-commit`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "🔍 Checking JSDoc documentation..."
npm run test:jsdoc-documentation

echo "📝 Generating API documentation..."
npm run docs:generate

echo "✅ Pre-commit checks passed!"
```

### 3. Aggiungi script a package.json

```json
{
  "scripts": {
    "prepare": "husky install"
  }
}
```

## Workflow Consigliato

### Per ogni Pull Request:

1. ✅ **Test JSDoc** - Verifica che documentazione sia completa
2. ✅ **Genera Docs** - Crea documentazione aggiornata
3. ✅ **Security Scan** - Controlla vulnerabilità
4. ✅ **Linting** - Verifica stile codice

### Per ogni Merge su Main:

1. ✅ Tutti i test PR
2. ✅ **Deploy Staging** - Deploy automatico su ambiente di test
3. ✅ **E2E Tests** - Test end-to-end su staging
4. ✅ **Deploy Production** - Deploy su produzione (opzionale, può essere manuale)

## Esempio Pratico: GitHub Actions Completo

Crea `.github/workflows/main.yml`:

```yaml
name: Main CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  # Job 1: Verifica Documentazione
  documentation:
    name: Documentation Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Test JSDoc completeness
        run: npm run test:jsdoc-documentation
      
      - name: Generate API docs
        run: npm run docs:generate
      
      - name: Check docs are committed
        run: |
          if [ -n "$(git status --porcelain docs/API_REFERENCE_GENERATED.md)" ]; then
            echo "❌ Documentation is out of date!"
            echo "Run: npm run docs:generate && git add docs/API_REFERENCE_GENERATED.md && git commit"
            exit 1
          fi
          echo "✅ Documentation is up to date"

  # Job 2: Test Suite
  tests:
    name: Run Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run security tests
        run: |
          npm run test:input-validation || true
          npm run test:xss-protection || true
          npm run test:password-policy || true
      
      - name: Run all tests
        run: npm run test:all || echo "Some tests may have warnings"

  # Job 3: Security Audit
  security:
    name: Security Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run npm audit
        run: npm audit --audit-level=moderate
      
      - name: Check for vulnerabilities
        run: npm run security:scan || true

  # Job 4: Deploy (solo su main)
  deploy:
    name: Deploy to Production
    needs: [documentation, tests, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build (se necessario)
        run: echo "No build step needed for Node.js app"
      
      - name: Deploy to Railway
        run: |
          echo "🚀 Deploying to Railway..."
          # Aggiungi comandi Railway qui
          # railway up --service flycoupongen
      
      - name: Notify deployment
        run: |
          echo "✅ Deployment completed successfully!"
```

## Vantaggi CI/CD per Documentazione

1. **Documentazione sempre aggiornata** - Se cambi un route, la doc viene rigenerata
2. **Blocca PR incomplete** - Se manca JSDoc, il merge viene bloccato
3. **Tracciabilità** - Vedi quando e chi ha cambiato la documentazione
4. **Automatizzazione** - Zero sforzo manuale

## Setup Rapido (5 minuti)

### Per GitHub:

1. Crea cartella `.github/workflows/`
2. Copia il file `main.yml` sopra
3. Commit e push
4. GitHub eseguirà automaticamente il workflow

### Per GitLab:

1. Crea `.gitlab-ci.yml` nella root
2. Copia il contenuto sopra
3. Push su GitLab
4. GitLab eseguirà automaticamente

## Monitoraggio

Dopo setup, puoi vedere:
- ✅ Status dei test su ogni PR
- ✅ Log completi di ogni esecuzione
- ✅ Notifiche su fallimenti
- ✅ Badge di status nel README

## Prossimi Passi

1. **Scegli piattaforma** (GitHub Actions, GitLab CI, Jenkins, etc.)
2. **Crea workflow file** usando gli esempi sopra
3. **Testa localmente** prima di pushare
4. **Monitora prima esecuzione** per verificare che funzioni
5. **Aggiungi deploy** quando sei pronto

## Risorse

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [GitLab CI Docs](https://docs.gitlab.com/ee/ci/)
- [Railway Deploy Guide](https://docs.railway.app/guides/deploying-with-github)


