#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

// Quick Test Runner for Reverse API Tracker
// Tests the tracking system with simulated API calls

const { ReverseAPITracker, APIInterceptor } = require('./reverse-api-tracker.js');

class TrackerTester {
    constructor() {
        this.tracker = new ReverseAPITracker();
        this.interceptor = new APIInterceptor(this.tracker);
    }

    // Simulate API calls to known provider patterns
    async simulateProviderCalls() {
        console.log('🧪 Starting provider simulation test...\n');

        // Install interceptors
        this.interceptor.install();

        const testCalls = [
            {
                url: 'https://justanotherpanel.com/api/v2',
                response: { status: 200, body: '{"order":"123456789","status":"success"}' },
                timing: 150
            },
            {
                url: 'https://peakerr.com/api/orders',
                response: { status: 200, body: '{"order_id":"PK1234567","result":"completed"}' },
                timing: 120
            },
            {
                url: 'https://smmpanel.net/api/v1/order',
                response: { status: 200, body: '{"id":"SMP12345A","status":"processing"}' },
                timing: 200
            },
            {
                url: 'https://unknown-provider.com/api',
                response: { status: 200, body: '{"order_ref":"UNK999999"}' },
                timing: 300
            },
            {
                url: 'https://smmkings.com/api/create',
                response: { status: 400, body: '{"error":"Service unavailable"}' },
                timing: 180
            }
        ];

        // Simulate each API call
        for (const call of testCalls) {
            await this.simulateAPICall(call);
            await this.delay(100); // Small delay between calls
        }

        console.log('✅ Simulation complete. Generating analysis...\n');

        // Generate and display report
        const report = await this.tracker.generateReport();
        this.displayReport(report);

        // Clean up
        this.interceptor.uninstall();
        
        return report;
    }

    // Simulate a single API call
    async simulateAPICall({ url, response, timing }) {
        const startTime = Date.now();
        
        // Simulate network delay
        await this.delay(timing);
        
        const endTime = Date.now();
        
        // Manually trigger the tracker (since we're simulating)
        await this.tracker.interceptAPICall(url, { method: 'POST' }, {
            status: response.status,
            headers: { 'content-type': 'application/json' },
            bodySize: response.body?.length || 0,
            responseBody: response.body
        }, {
            duration: endTime - startTime
        });

        console.log(`📡 Simulated call to: ${this.tracker.maskSensitiveUrl(url)} (${timing}ms)`);
    }

    // Display formatted report
    displayReport(report) {
        console.log('📊 REVERSE API TRACKING REPORT');
        console.log('================================\n');
        
        console.log(`📈 Total Requests: ${report.totalRequests}`);
        console.log(`🎯 Identified Providers: ${Object.keys(report.identifiedProviders).length}\n`);

        if (Object.keys(report.identifiedProviders).length > 0) {
            console.log('🏢 IDENTIFIED PROVIDERS:');
            console.log('------------------------');
            
            for (const [name, data] of Object.entries(report.identifiedProviders)) {
                console.log(`\n🔍 ${name.toUpperCase()}`);
                console.log(`   • Requests: ${data.requests}`);
                console.log(`   • Confidence: ${(data.avgConfidence * 100).toFixed(1)}%`);
                console.log(`   • Avg Response Time: ${data.avgResponseTime.toFixed(0)}ms`);
                console.log(`   • Matched Features: ${data.features.join(', ')}`);
            }
        }

        if (report.suspiciousPatterns.length > 0) {
            console.log('\n⚠️  SUSPICIOUS PATTERNS:');
            console.log('------------------------');
            
            report.suspiciousPatterns.forEach(pattern => {
                console.log(`\n🚨 ${pattern.type}`);
                console.log(`   • Description: ${pattern.description}`);
                console.log(`   • Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
            });
        }

        if (report.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            console.log('-------------------');
            
            report.recommendations.forEach(rec => {
                const priority = rec.priority.toUpperCase();
                const icon = priority === 'HIGH' ? '🔴' : priority === 'MEDIUM' ? '🟡' : '🟢';
                
                console.log(`\n${icon} [${priority}] ${rec.category}`);
                console.log(`   • ${rec.message}`);
                console.log(`   • Action: ${rec.action}`);
            });
        }

        console.log('\n================================');
        console.log('✅ Analysis complete!\n');
    }

    // Utility delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Test specific provider identification
    async testProviderIdentification() {
        console.log('🔬 Testing provider identification logic...\n');

        const testCases = [
            {
                name: 'JustAnotherPanel',
                apiCall: {
                    url: 'https://justanotherpanel.com/api/v2?key=test',
                    responseTime: 150,
                    statusCode: 200,
                    responseBody: '{"order":"123456789"}'
                }
            },
            {
                name: 'Peakerr',
                apiCall: {
                    url: 'https://peakerr.com/api/orders',
                    responseTime: 120,
                    statusCode: 200,
                    responseBody: '{"order_id":"PK1234567"}'
                }
            },
            {
                name: 'Unknown Provider',
                apiCall: {
                    url: 'https://mystery-smm.com/api',
                    responseTime: 500,
                    statusCode: 200,
                    responseBody: '{"ref":"ABC123"}'
                }
            }
        ];

        for (const testCase of testCases) {
            const result = this.tracker.identifyProvider(testCase.apiCall);
            
            console.log(`🧪 Testing: ${testCase.name}`);
            if (result) {
                console.log(`   ✅ Identified as: ${result.name} (${(result.confidence * 100).toFixed(1)}% confidence)`);
                console.log(`   📋 Features: ${result.matchedFeatures.join(', ')}`);
            } else {
                console.log(`   ❌ No provider match found`);
            }
            console.log('');
        }
    }
}

// Main execution
async function main() {
    const tester = new TrackerTester();
    
    console.log('🚀 Reverse API Tracker - Test Suite');
    console.log('====================================\n');

    try {
        // Test provider identification logic
        await tester.testProviderIdentification();
        
        console.log('⏳ Starting full simulation test...\n');
        
        // Run full simulation
        const report = await tester.simulateProviderCalls();
        
        // Save test report
        const fs = require('fs');
        const path = require('path');
        
        const testReportsDir = path.join(__dirname, 'test-reports');
        if (!fs.existsSync(testReportsDir)) {
            fs.mkdirSync(testReportsDir, { recursive: true });
        }
        
        const reportPath = path.join(testReportsDir, `test-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`💾 Test report saved: ${reportPath}`);
        console.log('🎉 All tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Export for use in other modules
module.exports = { TrackerTester };

// Run if called directly
if (require.main === module) {
    main();
}