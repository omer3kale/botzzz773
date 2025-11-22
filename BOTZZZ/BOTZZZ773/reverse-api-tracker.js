// Reverse API Tracker - SMM Panel Provider Analysis
// Analyzes API responses to identify Tier 1 provider sources

// Load environment variables
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./netlify/functions/utils/logger');
const { supabaseAdmin } = require('./netlify/functions/utils/supabase');

const logger = createLogger('reverse-api-tracker');

class ReverseAPITracker {
    constructor() {
        this.knownProviders = {
            // Tier 1 Provider Signatures
            'justanotherpanel': {
                patterns: {
                    endpoint: /justanotherpanel\.com/i,
                    orderIdFormat: /^[0-9]{8,12}$/,
                    responseDelay: { min: 100, max: 300 },
                    errorMessages: ['Invalid service', 'Insufficient funds']
                }
            },
            'peakerr': {
                patterns: {
                    endpoint: /peakerr\.com/i,
                    orderIdFormat: /^PK[0-9]{6,10}$/,
                    responseDelay: { min: 80, max: 250 },
                    errorMessages: ['Service not available', 'Low balance']
                }
            },
            'smmpanel': {
                patterns: {
                    endpoint: /smmpanel\.(net|org|io)/i,
                    orderIdFormat: /^SMP[A-Z0-9]{6,8}$/,
                    responseDelay: { min: 120, max: 400 },
                    errorMessages: ['Invalid request', 'Service offline']
                }
            },
            'smmkings': {
                patterns: {
                    endpoint: /smmkings\.com/i,
                    orderIdFormat: /^[0-9]{10,15}$/,
                    responseDelay: { min: 90, max: 280 },
                    errorMessages: ['Error processing', 'Service unavailable']
                }
            }
        };
        
        this.trackingData = [];
    }

    // Intercept and analyze API calls
    async interceptAPICall(url, options, response, timing) {
        const analysis = {
            timestamp: new Date().toISOString(),
            url: url,
            method: options.method || 'GET',
            responseTime: timing.duration,
            statusCode: response.status,
            headers: this.sanitizeHeaders(response.headers),
            bodySize: response.bodySize || 0,
            providerSignature: null,
            confidence: 0
        };

        // Analyze response for provider signatures
        analysis.providerSignature = this.identifyProvider(analysis);
        
        this.trackingData.push(analysis);
        
        // Log suspicious patterns
        if (analysis.confidence > 0.7) {
            logger.info('High confidence provider match detected', {
                provider: analysis.providerSignature?.name,
                confidence: analysis.confidence,
                url: this.maskSensitiveUrl(url)
            });
        }

        return analysis;
    }

    // Identify provider based on response patterns
    identifyProvider(apiCall) {
        let bestMatch = null;
        let highestConfidence = 0;

        for (const [providerName, config] of Object.entries(this.knownProviders)) {
            let confidence = 0;
            const patterns = config.patterns;

            // Check endpoint pattern
            if (patterns.endpoint && patterns.endpoint.test(apiCall.url)) {
                confidence += 0.4;
            }

            // Check response timing
            if (patterns.responseDelay) {
                const { min, max } = patterns.responseDelay;
                if (apiCall.responseTime >= min && apiCall.responseTime <= max) {
                    confidence += 0.3;
                }
            }

            // Check for specific headers or response patterns
            if (this.checkResponsePatterns(apiCall, patterns)) {
                confidence += 0.3;
            }

            if (confidence > highestConfidence) {
                highestConfidence = confidence;
                bestMatch = {
                    name: providerName,
                    patterns: patterns,
                    matchedFeatures: this.getMatchedFeatures(apiCall, patterns)
                };
            }
        }

        return bestMatch ? { ...bestMatch, confidence: highestConfidence } : null;
    }

    // Check response patterns against known signatures
    checkResponsePatterns(apiCall, patterns) {
        let matches = 0;
        let total = 0;

        // Check order ID format in response body if available
        if (patterns.orderIdFormat && apiCall.responseBody) {
            total++;
            if (patterns.orderIdFormat.test(apiCall.responseBody)) {
                matches++;
            }
        }

        // Check error message patterns
        if (patterns.errorMessages && apiCall.statusCode >= 400) {
            total++;
            const responseText = apiCall.responseBody || '';
            if (patterns.errorMessages.some(msg => responseText.includes(msg))) {
                matches++;
            }
        }

        return total > 0 ? matches / total : 0;
    }

    // Get detailed breakdown of matched features
    getMatchedFeatures(apiCall, patterns) {
        const features = [];

        if (patterns.endpoint && patterns.endpoint.test(apiCall.url)) {
            features.push('endpoint_pattern');
        }

        if (patterns.responseDelay) {
            const { min, max } = patterns.responseDelay;
            if (apiCall.responseTime >= min && apiCall.responseTime <= max) {
                features.push('response_timing');
            }
        }

        return features;
    }

    // Sanitize headers to remove sensitive data
    sanitizeHeaders(headers) {
        const sanitized = {};
        const sensitiveKeys = ['authorization', 'api-key', 'x-api-key', 'cookie'];
        
        for (const [key, value] of Object.entries(headers || {})) {
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = value;
            }
        }
        
        return sanitized;
    }

    // Mask sensitive parts of URLs
    maskSensitiveUrl(url) {
        return url.replace(/[?&](key|api_key|token)=([^&]+)/gi, (match, param) => {
            return `${param}=[REDACTED]`;
        });
    }

    // Generate analysis report
    async generateReport() {
        const report = {
            generatedAt: new Date().toISOString(),
            totalRequests: this.trackingData.length,
            identifiedProviders: {},
            suspiciousPatterns: [],
            recommendations: []
        };

        // Analyze provider distribution
        for (const call of this.trackingData) {
            if (call.providerSignature && call.providerSignature.confidence > 0.5) {
                const providerName = call.providerSignature.name;
                if (!report.identifiedProviders[providerName]) {
                    report.identifiedProviders[providerName] = {
                        requests: 0,
                        avgConfidence: 0,
                        avgResponseTime: 0,
                        features: new Set()
                    };
                }
                
                const provider = report.identifiedProviders[providerName];
                provider.requests++;
                provider.avgConfidence = (provider.avgConfidence + call.providerSignature.confidence) / 2;
                provider.avgResponseTime = (provider.avgResponseTime + call.responseTime) / 2;
                
                call.providerSignature.matchedFeatures?.forEach(feature => {
                    provider.features.add(feature);
                });
            }
        }

        // Convert Sets to Arrays for JSON serialization
        for (const provider of Object.values(report.identifiedProviders)) {
            provider.features = Array.from(provider.features);
        }

        // Identify suspicious patterns
        report.suspiciousPatterns = this.identifySuspiciousPatterns();

        // Add recommendations
        report.recommendations = this.generateRecommendations(report);

        return report;
    }

    // Identify suspicious request patterns
    identifySuspiciousPatterns() {
        const patterns = [];
        const urlGroups = {};

        // Group requests by similar URLs
        for (const call of this.trackingData) {
            const baseUrl = call.url.split('?')[0];
            if (!urlGroups[baseUrl]) {
                urlGroups[baseUrl] = [];
            }
            urlGroups[baseUrl].push(call);
        }

        // Check for unusual patterns
        for (const [url, calls] of Object.entries(urlGroups)) {
            if (calls.length > 10) {
                const avgResponseTime = calls.reduce((sum, call) => sum + call.responseTime, 0) / calls.length;
                const responseTimeVariance = this.calculateVariance(calls.map(c => c.responseTime));
                
                if (responseTimeVariance < 10) { // Very consistent timing
                    patterns.push({
                        type: 'consistent_timing',
                        url: this.maskSensitiveUrl(url),
                        description: 'Unusually consistent response times may indicate load balancing or caching',
                        confidence: 0.6
                    });
                }
            }
        }

        return patterns;
    }

    // Calculate variance
    calculateVariance(numbers) {
        const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
        const squaredDiffs = numbers.map(num => Math.pow(num - mean, 2));
        return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / numbers.length;
    }

    // Generate actionable recommendations
    generateRecommendations(report) {
        const recommendations = [];

        if (Object.keys(report.identifiedProviders).length > 0) {
            recommendations.push({
                priority: 'high',
                category: 'provider_transparency',
                message: 'Multiple Tier 1 providers detected. Consider disclosing provider relationships to customers.',
                action: 'Review provider agreements and customer communications'
            });
        }

        if (report.suspiciousPatterns.length > 0) {
            recommendations.push({
                priority: 'medium',
                category: 'api_security',
                message: 'Suspicious API patterns detected. Review for potential security issues.',
                action: 'Implement additional API monitoring and rate limiting'
            });
        }

        return recommendations;
    }

    // Save report to file
    async saveReport(report, filename) {
        const reportsDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const filePath = path.join(reportsDir, filename || `reverse-api-report-${Date.now()}.json`);
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
        
        logger.info('Report saved', { filePath });
        return filePath;
    }

    // Store tracking data in database
    async storeInDatabase(report) {
        try {
            // First check if table exists
            const { data: testData, error: testError } = await supabaseAdmin
                .from('api_tracking_reports')
                .select('count')
                .limit(1);
            
            if (testError && testError.code === 'PGRST205') {
                logger.warn('API tracking table does not exist - skipping database storage');
                logger.info('To enable database storage, create the table using: supabase/migrations/20251121_create_api_tracking.sql');
                return;
            }

            const { error } = await supabaseAdmin
                .from('api_tracking_reports')
                .insert({
                    report_data: report,
                    generated_at: report.generatedAt,
                    total_requests: report.totalRequests,
                    identified_providers: Object.keys(report.identifiedProviders)
                });

            if (error) throw error;
            logger.info('Report stored in database');
        } catch (error) {
            logger.error('Failed to store report in database', { error });
        }
    }
}

// HTTP Request Interceptor
class APIInterceptor {
    constructor(tracker) {
        this.tracker = tracker;
        this.originalFetch = global.fetch;
        this.originalRequest = require('http').request;
    }

    // Install interceptors
    install() {
        // Intercept fetch calls
        global.fetch = async (url, options = {}) => {
            const startTime = Date.now();
            
            try {
                const response = await this.originalFetch(url, options);
                const endTime = Date.now();
                
                // Track the API call
                await this.tracker.interceptAPICall(url, options, {
                    status: response.status,
                    headers: Object.fromEntries(response.headers.entries()),
                    bodySize: response.headers.get('content-length')
                }, {
                    duration: endTime - startTime
                });
                
                return response;
            } catch (error) {
                const endTime = Date.now();
                
                // Track failed calls too
                await this.tracker.interceptAPICall(url, options, {
                    status: 0,
                    headers: {},
                    error: error.message
                }, {
                    duration: endTime - startTime
                });
                
                throw error;
            }
        };

        logger.info('API interceptors installed');
    }

    // Remove interceptors
    uninstall() {
        global.fetch = this.originalFetch;
        logger.info('API interceptors removed');
    }
}

// Usage example and CLI interface
async function main() {
    const tracker = new ReverseAPITracker();
    const interceptor = new APIInterceptor(tracker);

    console.log('🔍 Reverse API Tracker Started');
    console.log('📊 Monitoring API calls for provider identification...\n');

    // Install interceptors
    interceptor.install();

    // Let it run for a specified duration or until stopped
    const monitoringDuration = process.env.MONITOR_DURATION || 300000; // 5 minutes default
    
    console.log(`⏰ Monitoring for ${monitoringDuration / 1000} seconds...`);
    
    setTimeout(async () => {
        console.log('\n📋 Generating analysis report...');
        
        const report = await tracker.generateReport();
        const reportPath = await tracker.saveReport(report);
        
        console.log('\n✅ Analysis Complete!');
        console.log(`📄 Report saved: ${reportPath}`);
        console.log(`🎯 Total requests analyzed: ${report.totalRequests}`);
        console.log(`🏢 Providers identified: ${Object.keys(report.identifiedProviders).length}`);
        
        if (Object.keys(report.identifiedProviders).length > 0) {
            console.log('\n🔍 Identified Providers:');
            for (const [name, data] of Object.entries(report.identifiedProviders)) {
                console.log(`  • ${name}: ${data.requests} requests (${(data.avgConfidence * 100).toFixed(1)}% confidence)`);
            }
        }

        if (report.recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            report.recommendations.forEach(rec => {
                console.log(`  • [${rec.priority.toUpperCase()}] ${rec.message}`);
            });
        }

        // Store in database
        await tracker.storeInDatabase(report);
        
        // Clean up
        interceptor.uninstall();
        process.exit(0);
    }, monitoringDuration);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down gracefully...');
        const report = await tracker.generateReport();
        await tracker.saveReport(report, `interrupted-report-${Date.now()}.json`);
        interceptor.uninstall();
        process.exit(0);
    });
}

// Export for use in other modules
module.exports = { ReverseAPITracker, APIInterceptor };

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
}