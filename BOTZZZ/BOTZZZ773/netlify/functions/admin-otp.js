// Admin OTP Authentication API
// Handles sending OTP codes via email and verifying them

const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim();
const LEGACY_G_ADMIN_EMAIL = (process.env.G_ADMIN_EMAIL || '').trim();
const ADMIN_OTP_EMAIL = (process.env.ADMIN_OTP_EMAIL || LEGACY_G_ADMIN_EMAIL || ADMIN_EMAIL || '').trim();
const PRIMARY_ADMIN_EMAIL = ADMIN_OTP_EMAIL.toLowerCase();
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const OTP_EXPIRY_MINUTES = 10;
const DEV_OTP_BYPASS = process.env.DEV_OTP_BYPASS !== 'false'; // true unless explicitly set to 'false'

const ALLOWED_ORIGINS = ['https://www.botzzz773.pro', 'https://botzzz773.pro'];
function getCorsOrigin(event) {
  const origin = event?.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

// Configure email transporter
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
    }
});

// Generate 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP email
async function sendOTPEmail(email, otpCode) {
    const mailOptions = {
        from: `"BOTZZZ773 Admin" <${SMTP_USER}>`,
        to: email,
        subject: 'Your Admin Sign-In Code',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0c12;">
                <div style="max-width: 480px; margin: 40px auto; background-color: #0f1117; border-radius: 12px; overflow: hidden;">
                    <!-- Header -->
                    <div style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #1e2030;">
                        <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.05em;">
                            <span style="color: #818cf8;">BOTZZZ</span><span style="color: #e2e4ed;">773</span>
                        </h1>
                        <p style="margin: 8px 0 0; color: #8b8fa3; font-size: 13px;">
                            Admin Authentication
                        </p>
                    </div>

                    <!-- Content -->
                    <div style="padding: 32px;">
                        <p style="margin: 0 0 24px; color: #c4c7d6; font-size: 15px; line-height: 1.6;">
                            Hello Admin,
                        </p>

                        <p style="margin: 0 0 28px; color: #8b8fa3; font-size: 14px; line-height: 1.6;">
                            Use the verification code below to sign in to the admin panel:
                        </p>

                        <!-- OTP Code Box -->
                        <div style="background: #161822; border: 1px solid #1e2030; border-radius: 10px; padding: 24px; text-align: center; margin-bottom: 28px;">
                            <p style="margin: 0 0 8px; color: #8b8fa3; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">
                                Verification Code
                            </p>
                            <p style="margin: 0; color: #818cf8; font-size: 40px; font-weight: 700; letter-spacing: 0.2em; font-family: 'Courier New', monospace;">
                                ${otpCode}
                            </p>
                        </div>

                        <!-- Security Info -->
                        <div style="background: #161822; border-left: 3px solid #f59e0b; padding: 14px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                            <p style="margin: 0 0 6px; color: #f59e0b; font-size: 12px; font-weight: 600;">
                                Security Notice
                            </p>
                            <p style="margin: 0; color: #8b8fa3; font-size: 12px; line-height: 1.5;">
                                Expires in <strong style="color: #c4c7d6;">${OTP_EXPIRY_MINUTES} minutes</strong>. Never share this code with anyone.
                            </p>
                        </div>

                        <p style="margin: 0; color: #6b6f85; font-size: 13px; line-height: 1.5;">
                            If you didn't request this code, you can safely ignore this email.
                        </p>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 20px 32px; border-top: 1px solid #1e2030; text-align: center;">
                        <p style="margin: 0; color: #4a4e63; font-size: 11px; line-height: 1.5;">
                            <span style="color: #818cf8;">BOTZZZ773</span> · ${new Date().getFullYear()}<br>
                            Automated message — do not reply
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
BOTZZZ773 Admin Authentication

Your verification code is: ${otpCode}

This code expires in ${OTP_EXPIRY_MINUTES} minutes.

Never share this code with anyone. If you didn't request this code, you can safely ignore this email.

© ${new Date().getFullYear()} BOTZZZ773
        `.trim()
    };

    return transporter.sendMail(mailOptions);
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { action, email, otpCode } = JSON.parse(event.body || '{}');
        const isLocal = (event.headers['origin'] || '').includes('localhost')
            || (event.headers['host'] || '').includes('localhost')
            || (event.headers['referer'] || '').includes('localhost');
        const canBypass = DEV_OTP_BYPASS && (isLocal || !SMTP_USER || !SMTP_PASS);

        // Action: Request OTP
        if (action === 'request-otp') {
            if (!email || !email.includes('@')) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Valid email is required' })
                };
            }

            // Verify email is the admin email (relaxed in local dev)
            if (!canBypass) {
                if (!PRIMARY_ADMIN_EMAIL || email.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({ error: 'Unauthorized email address' })
                    };
                }
            }

            // Check if user exists and is admin
            const { data: user, error: userError } = canBypass
                ? { data: { id: 'dev-admin', email: (email || PRIMARY_ADMIN_EMAIL), role: 'admin' }, error: null }
                : await supabaseAdmin
                    .from('users')
                    .select('id, email, role')
                    .eq('email', PRIMARY_ADMIN_EMAIL)
                    .eq('role', 'admin')
                    .single();

            if (userError || !user) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: 'Admin account not found' })
                };
            }

            // Generate OTP
            const otp = generateOTP();
            const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

            // Get client IP and user agent
            const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
            const userAgent = event.headers['user-agent'] || 'unknown';

            // Store OTP in database
            const { error: otpError } = canBypass
                ? { error: null }
                : await supabaseAdmin
                    .from('admin_otp_codes')
                    .insert({
                        email: PRIMARY_ADMIN_EMAIL,
                        otp_code: otp,
                        expires_at: expiresAt.toISOString(),
                        ip_address: clientIP,
                        user_agent: userAgent
                    });

            if (otpError) {
                console.error('Failed to store OTP:', otpError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: 'Failed to generate verification code' })
                };
            }

            // Send OTP email (or bypass in local dev)
            if (canBypass) {
                console.log('DEV: Bypassing OTP email - using code 000000 in local mode.');
            } else {
                try {
                    await sendOTPEmail(ADMIN_OTP_EMAIL || email, otp);
                    console.log(`OTP sent to ${email}`);
                } catch (emailError) {
                    console.error('Failed to send OTP email:', emailError);
                    // In bypass mode, continue anyway
                    if (canBypass) {
                        console.log('DEV: Email failed but continuing with bypass mode.');
                    } else {
                        return {
                            statusCode: 500,
                            headers,
                            body: JSON.stringify({ error: 'Failed to send verification email' })
                        };
                    }
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: `Verification code sent to ${email}`,
                    expiresIn: OTP_EXPIRY_MINUTES * 60
                })
            };
        }

        // Action: Verify OTP
        if (action === 'verify-otp') {
            if (!email || !otpCode) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Email and verification code are required' })
                };
            }

            // Allow dev bypass: fixed OTP 000000 on localhost when SMTP not configured
            // In local dev bypass mode, accept fixed OTP regardless of email
            if (canBypass && otpCode === '000000') {
                // Proceed without DB lookup
                console.log('DEV: OTP bypass accepted (000000)');
            } else {
                // Find valid OTP
            const { data: otpRecords, error: findError } = await supabaseAdmin
                .from('admin_otp_codes')
                .select('*')
                .eq('email', email.toLowerCase())
                .eq('otp_code', otpCode)
                .eq('used', false)
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1);

            if (findError || !otpRecords || otpRecords.length === 0) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: 'Invalid or expired verification code' })
                };
            }

            const otpRecord = otpRecords[0];

            // Mark OTP as used
            await supabaseAdmin
                .from('admin_otp_codes')
                .update({ used: true })
                .eq('id', otpRecord.id);
            }

            // Get user details (bypass in local dev)
            let user;
            if (canBypass) {
                user = {
                    id: 'dev-admin',
                    email: (email || PRIMARY_ADMIN_EMAIL).toLowerCase(),
                    role: 'admin',
                    username: (email || PRIMARY_ADMIN_EMAIL).split('@')[0]
                };
            } else {
                const { data: userData, error: userError } = await supabaseAdmin
                    .from('users')
                    .select('id, email, role, username')
                    .eq('email', email.toLowerCase())
                    .eq('role', 'admin')
                    .single();

                if (userError || !userData) {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({ error: 'Admin account not found' })
                    };
                }
                user = userData;
            }

            // Generate JWT token
            const token = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    role: user.role,
                    username: user.username || user.email.split('@')[0]
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: 'Authentication successful',
                    token,
                    user: {
                        id: user.id,
                        email: user.email,
                        role: user.role,
                        username: user.username || user.email.split('@')[0]
                    }
                })
            };
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid action. Use "request-otp" or "verify-otp"' })
        };

    } catch (error) {
        console.error('Admin OTP error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
