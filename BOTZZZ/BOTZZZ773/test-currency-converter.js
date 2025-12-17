/**
 * Test script for currency converter
 * Run with: node test-currency-converter.js
 */

const { convertToUSD, getExchangeRates } = require('./functions/utils/currency-converter');

async function runTests() {
  console.log('=== Currency Converter Test Suite ===\n');

  try {
    // Test 1: Get exchange rates
    console.log('Test 1: Fetching exchange rates...');
    const rates = await getExchangeRates();
    console.log('✓ Exchange rates loaded');
    console.log(`  - USD: ${rates.USD}`);
    console.log(`  - EUR: ${rates.EUR}`);
    console.log(`  - GBP: ${rates.GBP}\n`);

    // Test 2: Convert EUR to USD
    console.log('Test 2: Convert EUR 100 to USD');
    const eurResult = await convertToUSD(100, 'EUR');
    console.log(`✓ ${eurResult.originalCurrency} ${eurResult.originalAmount} = USD ${eurResult.usdAmount}`);
    console.log(`  - Exchange rate used: ${eurResult.rate}`);
    console.log(`  - Converted: ${eurResult.converted}\n`);

    // Test 3: Convert GBP to USD
    console.log('Test 3: Convert GBP 50 to USD');
    const gbpResult = await convertToUSD(50, 'GBP');
    console.log(`✓ ${gbpResult.originalCurrency} ${gbpResult.originalAmount} = USD ${gbpResult.usdAmount}`);
    console.log(`  - Converted: ${gbpResult.converted}\n`);

    // Test 4: Convert JPY to USD
    console.log('Test 4: Convert JPY 10000 to USD');
    const jpyResult = await convertToUSD(10000, 'JPY');
    console.log(`✓ ${jpyResult.originalCurrency} ${jpyResult.originalAmount} = USD ${jpyResult.usdAmount}`);
    console.log(`  - Converted: ${jpyResult.converted}\n`);

    // Test 5: USD to USD (no conversion)
    console.log('Test 5: Convert USD 100 to USD');
    const usdResult = await convertToUSD(100, 'USD');
    console.log(`✓ ${usdResult.originalCurrency} ${usdResult.originalAmount} = USD ${usdResult.usdAmount}`);
    console.log(`  - Converted: ${usdResult.converted}\n`);

    // Test 6: Invalid amount
    console.log('Test 6: Convert invalid amount');
    const invalidResult = await convertToUSD('invalid', 'EUR');
    console.log(`✓ Invalid amount handling: ${invalidResult.error}`);
    console.log(`  - USD Amount: ${invalidResult.usdAmount}\n`);

    // Test 7: Unknown currency (fallback)
    console.log('Test 7: Convert with unknown currency');
    const unknownResult = await convertToUSD(100, 'XYZ');
    console.log(`✓ Unknown currency handling: ${unknownResult.warning || 'No warning'}`);
    console.log(`  - Amount: ${unknownResult.usdAmount} (should be treated as USD)`);
    console.log(`  - Converted: ${unknownResult.converted}\n`);

    console.log('=== All tests completed ===');

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

runTests();
