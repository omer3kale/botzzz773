#!/usr/bin/env node
/**
 * Visitor Access Test
 * Verifies that the live production site is publicly accessible to normal customers
 * without requiring admin credentials.
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(color, message) {
  console.log(colors[color] + message + colors.reset);
}

function fetchPage(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const request = client.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        headers: {
          'User-Agent': 'BOTZZZ Visitor Test'
        }
      },
      (response) => {
        let body = '';

        response.on('data', (chunk) => {
          body += chunk.toString('utf8');
        });

        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body
          });
        });
      }
    );

    request.on('error', reject);
    request.end();
  });
}

async function run() {
  const target = (process.argv[2] || process.env.SITE_URL || 'https://botzzz773.pro').trim();
  log('yellow', `\n╔════════════════════════════════════════╗`);
  log('yellow', `║   Visitor Access Test                  ║`);
  log('yellow', `╚════════════════════════════════════════╝`);
  log('blue', `\n🧪 Checking public access for: ${target}`);

  try {
    const { statusCode, body } = await fetchPage(target);

    if (statusCode >= 400) {
      throw new Error(`Expected a public 2xx/3xx response, received ${statusCode}`);
    }

    if (!body || body.length === 0) {
      throw new Error('Received empty response body');
    }

    const isBotzzzBrandingVisible = /botzzz/i.test(body);
    if (!isBotzzzBrandingVisible) {
      throw new Error('Response does not appear to be the BOTZZZ production site');
    }

    log('green', '\n✓ Visitor access confirmed: normal customers can view the live production site without admin auth.');
  } catch (error) {
    log('red', `\n✗ Visitor access test failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run();
}
