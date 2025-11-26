const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function seedLegacySecurityData(page) {
  await page.evaluate(() => {
    const hashedSample = '$2a$10$5PqULICwhf66A1VpzwuNFu8NhnNyEJD7BqXc9EwP6KDAdAm8YGtWy';

    localStorage.clear();
    localStorage.setItem('token', 'playwright-security-migration-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'admin-001',
      email: 'admin@botzzz.pro',
      role: 'admin',
      fullname: 'Playwright Admin'
    }));

    localStorage.setItem('USERS', JSON.stringify([
      { id: 'legacy-01', email: 'legacy@botzzz.pro', password: 'password123' },
      { id: 'secure-02', email: 'secure@botzzz.pro', password: hashedSample }
    ]));

    localStorage.setItem('API_KEYS', JSON.stringify([
      { id: 'legacy-key', name: 'Legacy Key', key: 'sk_live_plain_1234567890' },
      { id: 'secure-key', name: 'Secure Key', key: 'U2FsdGVkX1alreadyEncrypted' }
    ]));

    localStorage.setItem('API_PROVIDERS', JSON.stringify([
      { id: 1, name: 'Legacy Provider', apiKey: 'provider_plain_key_987' }
    ]));

    sessionStorage.clear();
  });
}

async function installMessageRecorder(page) {
  await page.evaluate(() => {
    window.__receivedMessages = [];
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      window.__receivedMessages.push(event.data);
    });
  });
}

async function openMigrationPopup(page, context, relativePath) {
  const buttonId = await page.evaluate(({ path }) => {
    const button = document.createElement('button');
    const id = `popup-launcher-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    button.id = id;
    button.type = 'button';
    button.style.position = 'absolute';
    button.style.left = '-9999px';
    button.textContent = 'Open Migration Popup';
    button.addEventListener('click', () => {
      window.open(path, `botzzz-${path}`, 'width=1100,height=720');
    });
    document.body.appendChild(button);
    return id;
  }, { path: relativePath });

  const popupPromise = context.waitForEvent('page');
  await page.click(`#${buttonId}`);
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await page.evaluate((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.remove();
    }
  }, buttonId);

  return popup;
}

async function waitForMessage(page, expectedType) {
  await page.waitForFunction((type) => {
    return Array.isArray(window.__receivedMessages) &&
      window.__receivedMessages.some((msg) => msg?.type === type);
  }, expectedType, { timeout: 10000 });
}

async function verifyMigrationFlow(page, context) {
  const popup = await openMigrationPopup(page, context, 'security-migration.html?popup=1');

  const popupMode = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
  if (!popupMode) {
    throw new Error('Security migration popup did not enable popup-mode.');
  }

  await popup.waitForSelector('#migrateBtn', { timeout: 3000 });
  await popup.click('#migrateBtn');

  await popup.waitForFunction(() => {
    const status = document.getElementById('migrationStatus');
    return status && /complete/i.test(status.textContent || '');
  }, null, { timeout: 12000 });

  await waitForMessage(page, 'SECURITY_MIGRATION_COMPLETED');

  await popup.close();

  const storageState = await page.evaluate(() => ({
    users: JSON.parse(localStorage.getItem('USERS') || '[]'),
    apiKeys: JSON.parse(localStorage.getItem('API_KEYS') || '[]'),
    providers: JSON.parse(localStorage.getItem('API_PROVIDERS') || '[]')
  }));

  if (!storageState.users.length || !storageState.users[0].password.startsWith('$2')) {
    throw new Error('Legacy user password was not hashed during migration.');
  }

  if (!storageState.apiKeys.length || !storageState.apiKeys[0].key.startsWith('U2FsdGVkX1')) {
    throw new Error('Legacy API key was not encrypted during migration.');
  }

  if (!storageState.providers.length || !storageState.providers[0].apiKey.startsWith('U2FsdGVkX1')) {
    throw new Error('Provider API key was not encrypted during migration.');
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    await seedLegacySecurityData(page);
    await installMessageRecorder(page);

    console.log('[TEST] Verifying security migration popup...');
    await verifyMigrationFlow(page, context);

    console.log('[TEST] Security migration popup regression completed successfully.');
  } catch (error) {
    console.error('[TEST] Security migration regression failure:', error.message || error);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

run();
