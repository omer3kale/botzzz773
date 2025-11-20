const path = require('path');
const fs = require('fs/promises');
const { chromium } = require('playwright');

const BASE_URL = (process.env.TEST_URL || 'https://botzzz773.pro').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'botzzz773@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Mariogomez33*';
const VIEWPORT_WIDTH = parseInt(process.env.ADMIN_ORDERS_VIEWPORT_WIDTH || '1360', 10);
const VIEWPORT_HEIGHT = parseInt(process.env.ADMIN_ORDERS_VIEWPORT_HEIGHT || '900', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const SKIP_LOGIN = process.env.SKIP_LOGIN === 'true';

function createFakeJwt(hoursValid = 2) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'admin',
      role: 'admin',
      email: ADMIN_EMAIL,
      exp: Math.floor(Date.now() / 1000) + hoursValid * 3600
    })
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  console.log('🔍 Starting admin orders viewport check...');
  console.log(`➡️  Target: ${BASE_URL}`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
  const page = await context.newPage();

  try {
    if (!SKIP_LOGIN) {
      await page.goto(`${BASE_URL}/signin.html`, { waitUntil: 'networkidle' });
      console.log('📄 Sign-in page loaded');

      await page.fill('#email', ADMIN_EMAIL);
      await page.fill('#password', ADMIN_PASSWORD);

      await Promise.all([
        page.waitForNavigation({
          url: url => /\/admin\/(index|dashboard)\.html$/.test(url.pathname),
          timeout: 20000
        }).catch(() => null),
        page.click('button[type="submit"]')
      ]);

      await page.waitForTimeout(1500);
      console.log('✅ Login flow finished, navigating to admin orders...');
    } else {
      console.log('⏭️  SKIP_LOGIN enabled, priming auth storage before jumping to admin orders');
      await page.addInitScript(({ token, user }) => {
        window.localStorage.setItem('token', token);
        window.localStorage.setItem('user', JSON.stringify(user));
      }, {
        token: createFakeJwt(),
        user: {
          id: 'admin-local',
          role: 'admin',
          username: 'Local Admin',
          email: ADMIN_EMAIL
        }
      });
    }

    await page.goto(`${BASE_URL}/admin/orders.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.admin-table', { timeout: 20000 });

    const layoutState = await page.evaluate(() => {
      const layout = document.querySelector('.orders-layout');
      const quickPanel = document.querySelector('.quick-actions-panel');
      const tablePanel = document.querySelector('.orders-table-panel');
      const tableContainer = document.querySelector('.table-container');
      const adminTable = document.querySelector('.admin-table');

      const quickVisible = quickPanel ? (
        window.getComputedStyle(quickPanel).display !== 'none' &&
        quickPanel.getBoundingClientRect().width > 10
      ) : false;

      return {
        hasLayout: !!layout,
        noQuickActionsClass: !!layout && layout.classList.contains('no-quick-actions'),
        quickPanelVisible: quickVisible,
        tablePanelWidth: tablePanel ? tablePanel.getBoundingClientRect().width : 0,
        tablePanelScrollWidth: tablePanel ? tablePanel.scrollWidth : 0,
        tablePanelClientWidth: tablePanel ? tablePanel.clientWidth : 0,
        tableContainerWidth: tableContainer ? tableContainer.getBoundingClientRect().width : 0,
        tableContainerScrollWidth: tableContainer ? tableContainer.scrollWidth : 0,
        adminTableExists: !!adminTable,
        adminTableMinWidth: adminTable ? window.getComputedStyle(adminTable).minWidth : null,
        viewportWidth: window.innerWidth
      };
    });

    console.log('📊 Layout state:', layoutState);

    if (!layoutState.hasLayout) {
      throw new Error('Orders layout wrapper not found');
    }

    if (!layoutState.noQuickActionsClass) {
      throw new Error('Orders layout missing no-quick-actions class (full-width mode off)');
    }

    if (layoutState.quickPanelVisible) {
      throw new Error('Quick actions panel still visible and taking horizontal space');
    }

    if (!layoutState.adminTableExists) {
      throw new Error('Admin table element not found');
    }

    if (layoutState.tablePanelWidth < layoutState.viewportWidth * 0.9) {
      throw new Error('Orders table panel does not span at least 90% of the viewport');
    }

    if (layoutState.tablePanelScrollWidth <= layoutState.tablePanelClientWidth) {
      console.warn('⚠️ Table panel has no horizontal overflow — confirm data has enough columns.');
    }

    const screenshotPath = path.join(__dirname, 'output', `admin-orders-${Date.now()}.png`);
    await ensureDir(screenshotPath);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`🖼️ Screenshot saved: ${screenshotPath}`);

    console.log('🎉 Admin orders viewport check passed. Layout is fully viewable.');
  } catch (error) {
    console.error('❌ Admin orders viewport check failed:', error.message);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
