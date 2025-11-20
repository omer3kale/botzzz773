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
            <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #05060a;">
                <div style="max-width: 600px; margin: 40px auto; background-color: #0b0d13; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; overflow: hidden;">
                    <!-- Header -->
                    <div style="background: linear-gradient(135deg, #ff1494, #ff5722); padding: 32px; text-align: center;">
                        <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: 0.08em;">
                            BOTZZZ<span style="color: #000;">773</span>
                        </h1>
                        <p style="margin: 8px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">
                            Admin Authentication
                        </p>
                    </div>
                    
                    <!-- Content -->
                    <div style="padding: 40px 32px;">
                        <p style="margin: 0 0 24px; color: rgba(255, 255, 255, 0.9); font-size: 16px; line-height: 1.6;">
                            Hello Admin,
                        </p>
                        
                        <p style="margin: 0 0 32px; color: rgba(255, 255, 255, 0.7); font-size: 14px; line-height: 1.6;">
                            You requested to sign in to the BOTZZZ773 Admin Panel. Use the verification code below to complete your sign-in:
                        </p>
                        
                        <!-- OTP Code Box -->
                        <div style="background: rgba(255, 20, 148, 0.08); border: 2px solid #ff1494; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
                            <p style="margin: 0 0 8px; color: rgba(255, 255, 255, 0.7); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">
                                Your Verification Code
                            </p>
                            <p style="margin: 0; color: #ff1494; font-size: 42px; font-weight: 800; letter-spacing: 0.2em; font-family: 'Courier New', monospace;">
                                ${otpCode}
                            </p>
                        </div>
                        
                        <!-- Security Info -->
                        <div style="background: rgba(255, 87, 34, 0.08); border: 1px solid rgba(255, 87, 34, 0.2); border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                            <p style="margin: 0 0 8px; color: #ff5722; font-size: 13px; font-weight: 600;">
                                ⚠️ Security Notice
                            </p>
                            <p style="margin: 0; color: rgba(255, 255, 255, 0.7); font-size: 12px; line-height: 1.5;">
                                This code expires in <strong>${OTP_EXPIRY_MINUTES} minutes</strong>. Never share this code with anyone. BOTZZZ773 staff will never ask for your verification code.
                            </p>
                        </div>
                        
                        <p style="margin: 0 0 16px; color: rgba(255, 255, 255, 0.7); font-size: 14px; line-height: 1.6;">
                            If you didn't request this code, you can safely ignore this email. Your account remains secure.
                        </p>
                    </div>
                    
                    <!-- Footer -->
                    <div style="background-color: #05060a; padding: 24px 32px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
                        <p style="margin: 0; color: rgba(255, 255, 255, 0.5); font-size: 12px; text-align: center; line-height: 1.5;">
                            © ${new Date().getFullYear()} BOTZZZ773. All rights reserved.<br>
                            This is an automated message, please do not reply.
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
        'Access-Control-Allow-Origin': '*',
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

        // Action: Request OTP
        if (action === 'request-otp') {
            if (!email || !email.includes('@')) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Valid email is required' })
                };
            }

            // Verify email is the admin email
            if (!PRIMARY_ADMIN_EMAIL || email.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: 'Unauthorized email address' })
                };
            }

            // Check if user exists and is admin
            const { data: user, error: userError } = await supabaseAdmin
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
            const { error: otpError } = await supabaseAdmin
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

            // Send OTP email
            try {
                await sendOTPEmail(ADMIN_OTP_EMAIL || email, otp);
                console.log(`OTP sent to ${email}`);
            } catch (emailError) {
                console.error('Failed to send OTP email:', emailError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: 'Failed to send verification email' })
                };
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

            // Get user details
            const { data: user, error: userError } = await supabaseAdmin
                .from('users')
                .select('id, email, role, username')
                .eq('email', email.toLowerCase())
                .eq('role', 'admin')
                .single();

            if (userError || !user) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: 'Admin account not found' })
                };
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
