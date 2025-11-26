const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function seedAuthState(page) {
  await page.evaluate(() => {
    localStorage.setItem('token', 'playwright-test-services-token');
    localStorage.setItem('user', JSON.stringify({ username: 'diagnostic-user', role: 'admin' }));
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

async function waitForMessage(page, expectedType, occurrence = 1) {
  await page.waitForFunction((type, count) => {
    if (!Array.isArray(window.__receivedMessages)) {
      return false;
    }
    const matchCount = window.__receivedMessages.filter((msg) => msg?.type === type).length;
    return matchCount >= count;
  }, [expectedType, occurrence], { timeout: 5000 });
}

async function openDiagnosticPopup(page, context) {
  const launcherId = await page.evaluate(() => {
    const button = document.createElement('button');
    const id = `popup-launcher-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    button.id = id;
    button.type = 'button';
    button.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    button.addEventListener('click', () => {
      window.open('test-services.html?popup=1', 'botzzz-test-services', 'width=960,height=700');
    });
    document.body.appendChild(button);
    return id;
  });

  const popupPromise = context.waitForEvent('page');
  await page.click(`#${launcherId}`);
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await page.evaluate((id) => {
    const launcher = document.getElementById(id);
    if (launcher) {
      launcher.remove();
    }
  }, launcherId);

  return popup;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await context.route('**/.netlify/functions/services', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [
            { id: 1, name: 'Playwright Diagnostic Service', rate: 1.25 }
          ]
        })
      });
    });

    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    await seedAuthState(page);
    await installMessageRecorder(page);

    const popup = await openDiagnosticPopup(page, context);

    const popupMode = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
    if (!popupMode) {
      throw new Error('Test services popup did not enable popup-mode.');
    }

    await popup.waitForSelector('#results p.success', { timeout: 5000 });
    await waitForMessage(page, 'SERVICES_DIAGNOSTIC_COMPLETED', 1);

    await popup.click('[data-diagnostic="clear"]');
    await popup.waitForFunction(() => document.getElementById('results')?.textContent === '', null, { timeout: 2000 });

    await popup.click('[data-diagnostic="xhr"]');
    await popup.waitForSelector('#results p', { timeout: 5000 });
    await waitForMessage(page, 'SERVICES_DIAGNOSTIC_COMPLETED', 2);

    await popup.close();

    console.log('[TEST] Test services popup regression completed successfully.');
  } catch (error) {
    console.error('[TEST] Failure:', error.message || error);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

run();
