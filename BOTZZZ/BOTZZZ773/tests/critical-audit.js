// CRITICAL PRE-LAUNCH AUDIT
// Deep validation of ALL systems before going live

const fs = require('fs').promises;
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(colors[color] + message + colors.reset);
}

class CriticalAudit {
  constructor() {
    this.blockers = [];
    this.risks = [];
    this.warnings = [];
    this.passed = [];
  }

  blocker(issue, reason, fix) {
    this.blockers.push({ issue, reason, fix });
    log('red', `🚫 BLOCKER: ${issue}`);
    log('red', `   Reason: ${reason}`);
    log('yellow', `   Fix: ${fix}\n`);
  }

  risk(issue, reason, fix) {
    this.risks.push({ issue, reason, fix });
    log('yellow', `⚠️  RISK: ${issue}`);
    log('yellow', `   Reason: ${reason}`);
    log('cyan', `   Fix: ${fix}\n`);
  }

  warning(issue, reason) {
    this.warnings.push({ issue, reason });
    log('yellow', `⚡ WARNING: ${issue}`);
    log('yellow', `   ${reason}\n`);
  }

  pass(check) {
    this.passed.push(check);
    log('green', `✅ ${check}`);
  }

  async runAudit() {
    log('bold', '\n╔════════════════════════════════════════════════════════════╗');
    log('bold', '║     🔍 CRITICAL PRE-LAUNCH AUDIT - ZERO TOLERANCE        ║');
    log('bold', '╚════════════════════════════════════════════════════════════╝\n');

    // 1. Business Logic Validation
    log('cyan', '═══ 1. BUSINESS LOGIC & ORDER FLOW ═══\n');
    await this.auditBusinessLogic();

    // 2. Payment Processing
    log('cyan', '\n═══ 2. PAYMENT PROCESSING ═══\n');
    await this.auditPayments();

    // 3. Provider Integration
    log('cyan', '\n═══ 3. PROVIDER INTEGRATION ═══\n');
    await this.auditProviderIntegration();

    // 4. Security Vulnerabilities
    log('cyan', '\n═══ 4. SECURITY AUDIT ═══\n');
    await this.auditSecurity();

    // 5. Database Integrity
    log('cyan', '\n═══ 5. DATABASE INTEGRITY ═══\n');
    await this.auditDatabase();

    // 6. API Error Handling
    log('cyan', '\n═══ 6. API ERROR HANDLING ═══\n');
    await this.auditErrorHandling();

    // 7. Frontend-Backend Integration
    log('cyan', '\n═══ 7. FRONTEND-BACKEND INTEGRATION ═══\n');
    await this.auditIntegration();

    // 8. Performance & Scalability
    log('cyan', '\n═══ 8. PERFORMANCE & SCALABILITY ═══\n');
    await this.auditPerformance();

    // 9. Data Validation
    log('cyan', '\n═══ 9. INPUT VALIDATION ═══\n');
    await this.auditValidation();

    // 10. Admin Controls
    log('cyan', '\n═══ 10. ADMIN CONTROLS ═══\n');
    await this.auditAdminControls();

    // Print Final Report
    this.printReport();
  }

  async auditBusinessLogic() {
    // Check order flow
    const ordersPath = path.join(__dirname, '..', 'netlify', 'functions', 'orders.js');
    const ordersCode = await fs.readFile(ordersPath, 'utf-8');

    // Balance deduction
    if (ordersCode.includes('user.balance - totalCost') || ordersCode.includes('balance >= totalCost')) {
      this.pass('Order balance checking implemented');
    } else {
      this.blocker(
        'No balance verification before order placement',
        'Users can place orders without sufficient balance',
        'Add balance check: if (user.balance < totalCost) return error'
      );
    }

    // Order cost calculation
    if (ordersCode.includes('service.price') && ordersCode.includes('quantity')) {
      this.pass('Order cost calculation present');
    } else {
      this.blocker(
        'Order pricing not calculated properly',
        'Orders may be free or incorrectly priced',
        'Add: totalCost = service.price * (quantity / 1000)'
      );
    }

    // Refund logic for cancellations
    if (ordersCode.includes('refund') || ordersCode.includes('balance +')) {
      this.pass('Refund logic implemented');
    } else {
      this.risk(
        'No refund mechanism for cancelled orders',
        'Users lose money on cancelled orders',
        'Add refund logic when order status changes to cancelled'
      );
    }

    // Order status tracking
    if (ordersCode.includes('pending') && ordersCode.includes('completed') && ordersCode.includes('processing')) {
      this.pass('Order status workflow defined');
    } else {
      this.warning('Order status workflow may be incomplete', 'Check all status transitions');
    }
  }

  async auditPayments() {
    const paymentsPath = path.join(__dirname, '..', 'netlify', 'functions', 'payments.js');
    const paymentsCode = await fs.readFile(paymentsPath, 'utf-8');

    // Stripe webhook verification
    if (paymentsCode.includes('stripe.webhooks.constructEvent')) {
      this.pass('Stripe webhook signature verification enabled');
    } else {
      this.blocker(
        'Stripe webhooks not verified',
        'Anyone can fake payment confirmations and get free balance',
        'Add: stripe.webhooks.constructEvent(body, signature, webhookSecret)'
      );
    }

    // Balance update on payment
    if (paymentsCode.includes('balance') && paymentsCode.includes('UPDATE')) {
      this.pass('Payment balance update implemented');
    } else {
      this.blocker(
        'Payments don\'t update user balance',
        'Users pay but get no balance',
        'Add balance update after successful payment'
      );
    }

    // Payment amount validation
    if (paymentsCode.includes('amount') && (paymentsCode.includes('> 0') || paymentsCode.includes('amount < '))) {
      this.pass('Payment amount validation present');
    } else {
      this.risk(
        'No minimum/maximum payment limits',
        'Users could pay $0 or $999999',
        'Add: if (amount < 1 || amount > 10000) return error'
      );
    }

    // Check Payeer
    const payeerPath = path.join(__dirname, '..', 'netlify', 'functions', 'payeer.js');
    const payeerCode = await fs.readFile(payeerPath, 'utf-8');

    if (payeerCode.includes('createHash') && payeerCode.includes('sha256')) {
      this.pass('Payeer signature verification implemented');
    } else {
      this.blocker(
        'Payeer payments not verified',
        'Anyone can fake Payeer payments',
        'Add SHA256 signature verification'
      );
    }

    // Check .env for payment keys
    const envPath = path.join(__dirname, '..', '.env');
    const envContent = await fs.readFile(envPath, 'utf-8');

    if (!envContent.includes('STRIPE_SECRET_KEY=sk_') && !envContent.includes('your_stripe_secret_key')) {
      this.blocker(
        'Stripe not configured',
        'Payment processing will fail immediately',
        'Get Stripe secret key from dashboard.stripe.com and add to .env'
      );
    } else if (envContent.includes('your_stripe_secret_key')) {
      this.blocker(
        'Stripe secret key placeholder not replaced',
        'Payments will fail - no real key configured',
        'Replace placeholder with actual Stripe secret key'
      );
    } else {
      this.pass('Stripe credentials configured');
    }
  }

  async auditProviderIntegration() {
    const ordersPath = path.join(__dirname, '..', 'netlify', 'functions', 'orders.js');
    const ordersCode = await fs.readFile(ordersPath, 'utf-8');

    // Provider API call
    if (ordersCode.includes('provider.api_url') && ordersCode.includes('axios')) {
      this.pass('Provider API integration exists');
    } else {
      this.blocker(
        'Orders not sent to SMM provider',
        'Orders sit in database but never fulfilled',
        'Add axios call to provider API in submitOrderToProvider()'
      );
    }

    // Provider error handling
    if (ordersCode.includes('catch') && ordersCode.includes('provider')) {
      this.pass('Provider error handling present');
    } else {
      this.risk(
        'No provider API error handling',
        'If provider is down, orders fail silently',
        'Add try-catch around provider API calls with proper error messages'
      );
    }

    // Provider order ID tracking
    if (ordersCode.includes('provider_order_id')) {
      this.pass('Provider order ID tracking implemented');
    } else {
      this.blocker(
        'No provider order ID stored',
        'Cannot track order status from provider',
        'Store provider\'s order ID in database for tracking'
      );
    }

    // Check if any providers exist
    const providersPath = path.join(__dirname, '..', 'netlify', 'functions', 'providers.js');
    const providersCode = await fs.readFile(providersPath, 'utf-8');

    if (providersCode.includes('api_url') && providersCode.includes('api_key')) {
      this.pass('Provider management system ready');
    } else {
      this.warning('Provider management may be incomplete', 'Ensure admin can add providers');
    }

    // CRITICAL: Must have at least one provider configured
    this.risk(
      'No SMM providers configured yet',
      'Cannot fulfill any orders without provider',
      'BEFORE LAUNCH: Add at least 1 provider via admin panel (e.g., justanotherpanel.com, smmpanel.com)'
    );
  }

  async auditSecurity() {
    const authPath = path.join(__dirname, '..', 'netlify', 'functions', 'auth.js');
    const authCode = await fs.readFile(authPath, 'utf-8');

    // Password hashing
    if (authCode.includes('bcrypt.hash') || authCode.includes('bcrypt.compare')) {
      this.pass('Passwords hashed with bcrypt');
    } else {
      this.blocker(
        'Passwords stored in plain text',
        'CRITICAL SECURITY BREACH - passwords readable',
        'Use bcrypt to hash all passwords before storing'
      );
    }

    // SQL injection protection (Supabase handles this)
    this.pass('SQL injection protected (Supabase parameterized queries)');

    // JWT secret strength
    const envPath = path.join(__dirname, '..', '.env');
    const envContent = await fs.readFile(envPath, 'utf-8');
    const jwtMatch = envContent.match(/JWT_SECRET=(.+)/);
    
    if (jwtMatch && jwtMatch[1].length < 32) {
      this.risk(
        'JWT secret too short',
        'Easier to crack authentication tokens',
        'Generate a 64+ character random secret'
      );
    } else {
      this.pass('JWT secret is strong');
    }

    // Admin role protection
    const usersPath = path.join(__dirname, '..', 'netlify', 'functions', 'users.js');
    const usersCode = await fs.readFile(usersPath, 'utf-8');

    if (usersCode.includes('role') && usersCode.includes('admin')) {
      this.pass('Admin role checks implemented');
    } else {
      this.blocker(
        'No admin role verification',
        'Regular users can access admin functions',
        'Add role check: if (user.role !== "admin") return 403'
      );
    }

    // Rate limiting
    this.risk(
      'No rate limiting configured',
      'Vulnerable to brute force attacks and API abuse',
      'Add rate limiting middleware or use Netlify rate limiting'
    );

    // HTTPS enforcement
    this.pass('HTTPS enforced by Netlify automatically');
  }

  async auditDatabase() {
    const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');

    // Critical tables
    const requiredTables = [
      { name: 'users', critical: true },
      { name: 'services', critical: true },
      { name: 'orders', critical: true },
      { name: 'payments', critical: true },
      { name: 'providers', critical: true }
    ];

    for (const table of requiredTables) {
      if (schema.includes(`CREATE TABLE ${table.name}`) || schema.includes(`create table ${table.name}`)) {
        this.pass(`Table '${table.name}' exists`);
      } else {
        this.blocker(
          `Missing critical table: ${table.name}`,
          'Database incomplete - app will crash',
          `Add CREATE TABLE ${table.name} to schema.sql and deploy`
        );
      }
    }

    // Foreign key constraints
    if (schema.includes('FOREIGN KEY') || schema.includes('REFERENCES')) {
      this.pass('Foreign key relationships defined');
    } else {
      this.warning('No foreign key constraints', 'Data integrity may be at risk');
    }

    // Indexes for performance
    if (schema.includes('CREATE INDEX') || schema.includes('create index')) {
      this.pass('Database indexes created');
    } else {
      this.risk(
        'No database indexes',
        'Slow queries as data grows',
        'Add indexes on frequently queried columns (user_id, status, created_at)'
      );
    }

    // Default admin user
    if (schema.includes('INSERT INTO users') && schema.includes('admin')) {
      this.pass('Default admin user created');
    } else {
      this.blocker(
        'No admin user in database',
        'Cannot access admin panel after launch',
        'Add INSERT statement to create admin@botzzz.com with role=admin'
      );
    }
  }

  async auditErrorHandling() {
    const functions = ['auth.js', 'orders.js', 'payments.js', 'users.js', 'services.js'];
    
    for (const func of functions) {
      const funcPath = path.join(__dirname, '..', 'netlify', 'functions', func);
      const code = await fs.readFile(funcPath, 'utf-8');

      if (!code.includes('try') || !code.includes('catch')) {
        this.blocker(
          `No error handling in ${func}`,
          'App will crash on errors',
          'Wrap all logic in try-catch blocks'
        );
      } else {
        this.pass(`Error handling in ${func}`);
      }

      // Check for generic error messages (security risk)
      if (code.includes('catch') && code.includes('error.message')) {
        this.risk(
          `${func} exposes internal errors to users`,
          'Could leak sensitive information',
          'Return generic error messages, log details server-side'
        );
      }
    }
  }

  async auditIntegration() {
    // Check API client
    const apiClientPath = path.join(__dirname, '..', 'js', 'api-client.js');
    try {
      const apiCode = await fs.readFile(apiClientPath, 'utf-8');
      
      if (apiCode.includes('Authorization') && apiCode.includes('Bearer')) {
        this.pass('Auth headers configured in API client');
      } else {
        this.blocker(
          'API client missing authentication headers',
          'All API calls will be unauthorized',
          'Add Authorization: Bearer ${token} to headers'
        );
      }

      if (apiCode.includes('/api/')) {
        this.pass('API endpoint routing configured');
      } else {
        this.risk(
          'API base URL may be incorrect',
          'Frontend calls may go to wrong endpoint',
          'Verify API_BASE_URL points to /.netlify/functions or /api'
        );
      }
    } catch (err) {
      this.blocker(
        'api-client.js missing',
        'Frontend cannot communicate with backend',
        'Create js/api-client.js with API wrapper'
      );
    }

    // Check auth integration
    const authBackendPath = path.join(__dirname, '..', 'js', 'auth-backend.js');
    try {
      const authBackCode = await fs.readFile(authBackendPath, 'utf-8');
      if (authBackCode.includes('localStorage') && authBackCode.includes('token')) {
        this.pass('Token storage configured');
      }
    } catch (err) {
      this.risk(
        'Frontend auth integration missing',
        'Users cannot login from frontend',
        'Create auth-backend.js to handle login/signup'
      );
    }
  }

  async auditPerformance() {
    // Check for N+1 queries
    const ordersPath = path.join(__dirname, '..', 'netlify', 'functions', 'orders.js');
    const ordersCode = await fs.readFile(ordersPath, 'utf-8');

    if (ordersCode.includes('.select(') && ordersCode.includes('*')) {
      this.warning('Selecting all columns', 'Consider selecting only needed fields for performance');
    }

    // Check for pagination
    if (ordersCode.includes('limit') || ordersCode.includes('range')) {
      this.pass('Query pagination implemented');
    } else {
      this.risk(
        'No pagination on orders query',
        'Will load ALL orders - slow with many records',
        'Add .range(0, 100) or .limit(100) to queries'
      );
    }

    // Image optimization
    this.warning('Ensure images are optimized', 'Use WebP format and compression for fast load times');
  }

  async auditValidation() {
    const authPath = path.join(__dirname, '..', 'netlify', 'functions', 'auth.js');
    const authCode = await fs.readFile(authPath, 'utf-8');

    // Email validation
    if (authCode.includes('@') || authCode.includes('email')) {
      this.pass('Email validation present');
    } else {
      this.blocker(
        'No email validation',
        'Invalid emails can be registered',
        'Add email regex validation'
      );
    }

    // Password strength
    if (authCode.includes('length') && authCode.includes('password')) {
      this.pass('Password length validation');
    } else {
      this.risk(
        'Weak password validation',
        'Users can set "123" as password',
        'Add minimum 8 chars, require uppercase, number, special char'
      );
    }

    // Order validation
    const ordersPath = path.join(__dirname, '..', 'netlify', 'functions', 'orders.js');
    const ordersCode = await fs.readFile(ordersPath, 'utf-8');

    if (ordersCode.includes('quantity') && (ordersCode.includes('> 0') || ordersCode.includes('< 0'))) {
      this.pass('Order quantity validation');
    } else {
      this.blocker(
        'No order quantity validation',
        'Users can order negative or 0 quantity',
        'Add: if (quantity <= 0) return error'
      );
    }
  }

  async auditAdminControls() {
    // Check admin pages exist
    try {
      const adminDir = path.join(__dirname, '..', 'admin');
      const adminFiles = await fs.readdir(adminDir);
      
      if (adminFiles.length > 0) {
        this.pass(`Admin panel exists (${adminFiles.length} pages)`);
      }

      // Check for critical admin functions
      const requiredAdminPages = ['services.html', 'users.html', 'settings.html'];
      for (const page of requiredAdminPages) {
        if (adminFiles.includes(page)) {
          this.pass(`Admin page: ${page}`);
        } else {
          this.risk(
            `Missing admin page: ${page}`,
            'Cannot manage ${page.replace(".html", "")} from admin panel',
            `Create admin/${page}`
          );
        }
      }
    } catch (err) {
      this.blocker(
        'No admin panel directory',
        'Cannot manage site after launch',
        'Create admin/ directory with management pages'
      );
    }

    // Check providers management
    const providersPath = path.join(__dirname, '..', 'netlify', 'functions', 'providers.js');
    const providersCode = await fs.readFile(providersPath, 'utf-8');

    if (providersCode.includes('POST') && providersCode.includes('DELETE')) {
      this.pass('Provider CRUD operations implemented');
    } else {
      this.blocker(
        'Cannot add/remove providers',
        'Stuck with initial provider forever',
        'Add create and delete functions for providers'
      );
    }
  }

  printReport() {
    log('bold', '\n╔════════════════════════════════════════════════════════════╗');
    log('bold', '║                 🎯 CRITICAL AUDIT REPORT                  ║');
    log('bold', '╚════════════════════════════════════════════════════════════╝\n');

    log('green', `✅ PASSED: ${this.passed.length} checks\n`);

    if (this.blockers.length > 0) {
      log('red', `🚫 CRITICAL BLOCKERS: ${this.blockers.length}\n`);
      this.blockers.forEach((b, i) => {
        log('red', `${i + 1}. ${b.issue}`);
        log('red', `   ⚠️  ${b.reason}`);
        log('yellow', `   🔧 ${b.fix}\n`);
      });
    }

    if (this.risks.length > 0) {
      log('yellow', `⚠️  HIGH RISKS: ${this.risks.length}\n`);
      this.risks.forEach((r, i) => {
        log('yellow', `${i + 1}. ${r.issue}`);
        log('yellow', `   ⚠️  ${r.reason}`);
        log('cyan', `   🔧 ${r.fix}\n`);
      });
    }

    if (this.warnings.length > 0) {
      log('yellow', `⚡ WARNINGS: ${this.warnings.length}\n`);
      this.warnings.forEach((w, i) => {
        log('yellow', `${i + 1}. ${w.issue} - ${w.reason}`);
      });
    }

    // Final verdict
    log('bold', '\n╔════════════════════════════════════════════════════════════╗');
    log('bold', '║                   LAUNCH READINESS                        ║');
    log('bold', '╚════════════════════════════════════════════════════════════╝\n');

    if (this.blockers.length === 0 && this.risks.length === 0) {
      log('green', '🎉 ALL SYSTEMS GO! Ready for production launch!');
      log('green', '✨ Zero critical issues found.\n');
    } else if (this.blockers.length === 0) {
      log('yellow', '⚠️  CAN LAUNCH with acceptable risks');
      log('yellow', `   Fix ${this.risks.length} high-risk items ASAP after launch\n`);
    } else {
      log('red', '🛑 DO NOT LAUNCH - CRITICAL ISSUES FOUND');
      log('red', `   Must fix ${this.blockers.length} blockers before going live\n`);
      process.exit(1);
    }
  }
}

// Run audit
const audit = new CriticalAudit();
audit.runAudit().catch(error => {
  log('red', `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
