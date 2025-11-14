#!/usr/bin/env node

// Script to run tests with automatic server startup
const { spawn } = require('child_process');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(color + message + colors.reset);
}

async function checkServerHealth() {
  try {
    const response = await fetch('http://localhost:8888/.netlify/functions/services', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.ok || response.status === 401;
  } catch (error) {
    return false;
  }
}

async function waitForServer(maxAttempts = 30, interval = 1000) {
  log(colors.cyan, '\n🔄 Waiting for dev server to start...');
  
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkServerHealth()) {
      log(colors.green, '✓ Server is ready!\n');
      return true;
    }
    await sleep(interval);
    process.stdout.write('.');
  }
  
  console.log('');
  return false;
}

async function main() {
  log(colors.yellow, '\n╔════════════════════════════════════════╗');
  log(colors.yellow, '║   BOTZZZ Test Runner                   ║');
  log(colors.yellow, '╚════════════════════════════════════════╝');
  
  // Check if server is already running
  const serverRunning = await checkServerHealth();
  
  let devServer = null;
  
  if (!serverRunning) {
    log(colors.cyan, '\n🚀 Starting dev server...');
    
    // Start dev server
    devServer = spawn('npm', ['run', 'dev'], {
      stdio: 'pipe',
      detached: false,
      shell: true
    });
    
    // Capture server output
    devServer.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Server now ready')) {
        log(colors.green, '\n✓ Dev server started');
      }
    });
    
    devServer.stderr.on('data', (data) => {
      const output = data.toString();
      // Only log actual errors, not warnings
      if (output.includes('ERROR')) {
        console.error(colors.red, output);
      }
    });
    
    // Wait for server to be ready
    const ready = await waitForServer();
    
    if (!ready) {
      log(colors.red, '\n❌ Server failed to start within 30 seconds');
      if (devServer) {
        devServer.kill();
      }
      process.exit(1);
    }
  } else {
    log(colors.green, '\n✓ Dev server is already running\n');
  }
  
  // Run tests
  log(colors.cyan, '▶️  Running API tests...\n');
  
  const testProcess = spawn('node', ['tests/api-tests.js'], {
    stdio: 'inherit',
    shell: true
  });
  
  testProcess.on('exit', (code) => {
    if (devServer) {
      log(colors.yellow, '\n🛑 Stopping dev server...');
      devServer.kill();
    }
    process.exit(code);
  });
  
  // Handle script termination
  process.on('SIGINT', () => {
    log(colors.yellow, '\n\n🛑 Interrupted. Cleaning up...');
    if (devServer) {
      devServer.kill();
    }
    process.exit(130);
  });
}

main().catch(error => {
  log(colors.red, `\n❌ Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
