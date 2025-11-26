const path = require('path');
const { spawn } = require('child_process');

const testScripts = [
  { name: 'Auth popup regression', file: path.join(__dirname, 'auth-popup-regression.js') },
  { name: 'Home popup regression', file: path.join(__dirname, 'index-popup-regression.js') },
  { name: 'Tickets popup regression', file: path.join(__dirname, 'tickets-popup-regression.js') },
  { name: 'Order popup regression', file: path.join(__dirname, 'order-popup-regression.js') },
  { name: 'Add-funds popup regression', file: path.join(__dirname, 'addfunds-popup-regression.js') },
  { name: 'Services popup regression', file: path.join(__dirname, 'services-popup-regression.js') },
  { name: 'API popup regression', file: path.join(__dirname, 'api-popup-regression.js') },
  { name: 'Dashboard popup regression', file: path.join(__dirname, 'dashboard-popup-regression.js') },
  { name: 'Admin dashboard popup regression', file: path.join(__dirname, 'admin-dashboard-popup-regression.js') },
  { name: 'Admin orders popup regression', file: path.join(__dirname, 'admin-orders-popup-regression.js') },
  { name: 'Admin users popup regression', file: path.join(__dirname, 'admin-users-popup-regression.js') },
  { name: 'Admin services popup regression', file: path.join(__dirname, 'admin-services-popup-regression.js') },
  { name: 'Admin payments popup regression', file: path.join(__dirname, 'admin-payments-popup-regression.js') },
  { name: 'Admin tickets popup regression', file: path.join(__dirname, 'admin-tickets-popup-regression.js') },
  { name: 'Admin reports popup regression', file: path.join(__dirname, 'admin-reports-popup-regression.js') },
  { name: 'Admin settings popup regression', file: path.join(__dirname, 'admin-settings-popup-regression.js') },
  { name: 'Admin sign-in popup regression', file: path.join(__dirname, 'admin-signin-popup-regression.js') },
  { name: 'Admin sign-in OTP popup regression', file: path.join(__dirname, 'admin-signin-otp-popup-regression.js') },
  { name: 'Contact popup regression', file: path.join(__dirname, 'contact-popup-regression.js') },
  { name: 'API dashboard popup regression', file: path.join(__dirname, 'api-dashboard-popup-regression.js') },
  { name: 'Offline popup regression', file: path.join(__dirname, 'offline-popup-regression.js') },
  { name: 'Payment status popup regression', file: path.join(__dirname, 'payment-status-popup-regression.js') },
  { name: 'Security migration popup regression', file: path.join(__dirname, 'security-migration-popup-regression.js') },
  { name: 'Test services popup regression', file: path.join(__dirname, 'test-services-popup-regression.js') }
];

async function runSuite() {
  for (const script of testScripts) {
    console.log(`\n[SUITE] Starting ${script.name}...`);
    const exitCode = await runScript(script.file);
    if (exitCode !== 0) {
      console.error(`[SUITE] ${script.name} failed.`);
      process.exit(exitCode);
      return;
    }
    console.log(`[SUITE] ${script.name} completed successfully.`);
  }

  console.log('\n[SUITE] Popup regression suite completed successfully.');
}

function runScript(filePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [filePath], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', (code) => {
      resolve(code ?? 0);
    });

    child.on('error', (error) => {
      console.error(`[SUITE] Failed to start ${filePath}:`, error);
      resolve(1);
    });
  });
}

runSuite().catch((error) => {
  console.error('[SUITE] Unexpected error:', error);
  process.exit(1);
});
