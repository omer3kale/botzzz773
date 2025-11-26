const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

function createMockJwt(hoursValid = 4) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, hoursValid) * 3600;
  const payload = Buffer.from(JSON.stringify({ exp, role: 'admin' })).toString('base64url');
  return `${header}.${payload}.signature`;
}

async function seedAdminSession(context) {
  const token = createMockJwt();
  const user = {
    id: 'admin-popup-test',
    username: 'Popup QA',
    email: 'popup.qa@botzzz773.test',
    role: 'admin'
  };

  await context.addInitScript(([sessionToken, sessionUser]) => {
    try {
      localStorage.setItem('token', sessionToken);
      localStorage.setItem('user', JSON.stringify(sessionUser));
    } catch (error) {
      console.warn('[ADMIN TICKETS POPUP TEST] Failed to seed session:', error);
    }
  }, [token, user]);
}

async function openAdminTicketsPopup(page, context) {
  const launcherId = await page.evaluate(() => {
    const button = document.createElement('button');
    const id = `admin-tickets-popup-launcher-${Date.now()}`;
    button.id = id;
    button.type = 'button';
    button.style.position = 'absolute';
    button.style.left = '-9999px';
    button.textContent = 'Open Admin Tickets Popup';
    button.addEventListener('click', () => {
      window.open('/admin/tickets.html?popup=1', 'botzzz-admin-tickets', 'width=1280,height=820,resizable=yes,scrollbars=yes');
    });
    document.body.appendChild(button);
    return id;
  });

  const popupPromise = context.waitForEvent('page');
  await page.click(`#${launcherId}`);
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await page.evaluate((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.remove();
    }
  }, launcherId);

  return popup;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    await seedAdminSession(context);
    const page = await context.newPage();

    console.log('[TEST] Starting admin tickets popup verification...');
    await page.goto(new URL('/admin/tickets.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });

    const popup = await openAdminTicketsPopup(page, context);
    const popupUrl = popup.url();

    if (!popupUrl.includes('/admin/tickets.html') || !popupUrl.includes('popup=1')) {
      throw new Error('Admin tickets popup URL missing popup parameter.');
    }

    const popupMode = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
    if (!popupMode) {
      throw new Error('Admin tickets popup did not enable popup-mode.');
    }

    await popup.waitForSelector('[data-popup-surface][role="dialog"]', { timeout: 5000 });
    const closeButton = await popup.waitForSelector('[data-popup-close]', { timeout: 5000 });

    const closePromise = popup.waitForEvent('close');
    await closeButton.click();
    await closePromise;

    console.log('[TEST] Admin tickets popup regression completed successfully.');
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
