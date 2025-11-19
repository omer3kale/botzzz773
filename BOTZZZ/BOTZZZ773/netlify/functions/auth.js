// Authentication API - Signup, Login, Logout, Token Verification
const { supabase, supabaseAdmin } = require('./utils/supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

// Helper function to create JWT token
function createToken(user) {
  console.log('[DEBUG AUTH] Creating token:', {
    userId: user.id,
    email: user.email,
    role: user.role,
    hasJwtSecret: !!JWT_SECRET,
    jwtSecretLength: JWT_SECRET?.length,
    jwtSecretPrefix: JWT_SECRET?.substring(0, 8) + '...'
  });
  
  return jwt.sign(
    { 
      userId: user.id, 
      email: user.email,
      role: user.role 
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Helper function to verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request
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
    const { action, ...data } = JSON.parse(event.body || '{}');

    switch (action) {
      case 'signup':
        return await handleSignup(data, headers);
      case 'login':
        return await handleLogin(data, headers);
      case 'google-signin':
        return await handleGoogleSignIn(data, headers);
      case 'google-signup':
        return await handleGoogleSignUp(data, headers);
      case 'verify':
        return await handleVerify(data, headers);
      case 'logout':
        return await handleLogout(data, headers);
      case 'forgot-password':
        return await handleForgotPassword(data, headers);
      case 'reset-password':
        return await handleResetPassword(data, headers);
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (error) {
    console.error('Auth error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleSignup({ email, password, username, firstName, lastName }, headers) {
  try {
    // Validate input
    if (!email || !password || !username) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          error: 'Email, username, and password are required' 
        })
      };
    }

    // Password strength validation
    if (password.length < 8) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          error: 'Password must be at least 8 characters long' 
        })
      };
    }

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`email.eq.${email},username.eq.${username}`)
      .single();

    if (existingUser) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'User already exists' })
      };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const { data: newUser, error } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        username,
        password_hash: passwordHash,
        full_name: `${firstName} ${lastName}`.trim() || username,
        role: 'user',
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Signup error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create user' })
      };
    }

    // Create token
    const token = createToken(newUser);

    // Remove password hash from response
    delete newUser.password_hash;

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        token,
        user: newUser
      })
    };
  } catch (error) {
    console.error('Signup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleLogin({ email, password }, headers) {
  try {
    // Validate input
    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }

    // Get user by email or username
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .or(`email.eq.${email},username.eq.${email}`)
      .single();

    if (error || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid credentials' })
      };
    }

    // Check if user is active
    if (user.status !== 'active') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Account is not active' })
      };
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid credentials' })
      };
    }

    // Update last login
    await supabaseAdmin
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Create token
    const token = createToken(user);

    // Remove password hash from response
    delete user.password_hash;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        token,
        user
      })
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleVerify({ token }, headers) {
  try {
    if (!token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Token is required' })
      };
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid or expired token' })
      };
    }

    // Get fresh user data
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    if (user.status !== 'active') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Account is not active' })
      };
    }

    // Remove password hash from response
    delete user.password_hash;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user
      })
    };
  } catch (error) {
    console.error('Verify error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleLogout({ token }, headers) {
  // For JWT, logout is handled client-side by removing the token
  // But we can log the activity
  try {
    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        await supabaseAdmin
          .from('activity_logs')
          .insert({
            user_id: decoded.userId,
            action: 'logout',
            details: { timestamp: new Date().toISOString() }
          });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Logout error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  }
}

async function handleForgotPassword({ email }, headers) {
  try {
    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    // Check if user exists
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    // Always return success to prevent email enumeration
    if (!user) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          message: 'If the email exists, a reset link will be sent' 
        })
      };
    }

    // Create reset token (expires in 1 hour)
    const resetToken = jwt.sign(
      { userId: user.id, type: 'password-reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // TODO: Send email with reset link
    // const resetLink = `${process.env.SITE_URL}/reset-password?token=${resetToken}`;
    // await sendEmail(user.email, 'Password Reset', resetLink);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        message: 'If the email exists, a reset link will be sent',
        // Remove this in production - only for testing
        resetToken: resetToken
      })
    };
  } catch (error) {
    console.error('Forgot password error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleResetPassword({ token, newPassword }, headers) {
  try {
    if (!token || !newPassword) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Token and new password are required' })
      };
    }

    const decoded = verifyToken(token);
    if (!decoded || decoded.type !== 'password-reset') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid or expired reset token' })
      };
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    const { error } = await supabaseAdmin
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', decoded.userId);

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to reset password' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        message: 'Password reset successful'
      })
    };
  } catch (error) {
    console.error('Reset password error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Google Sign-In Handler
async function handleGoogleSignIn(data, headers) {
  try {
    const { credential, email, name, picture, adminOnly } = data;

    console.log('[DEBUG] Google sign-in attempt:', { email, name, hasCredential: !!credential, adminOnly });

    if (!credential || !email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required Google credentials' })
      };
    }

    // Check if user exists by email only (no auth_provider column)
    const { data: existingUser, error: findError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle(); // Use maybeSingle instead of single to avoid error when not found

    // If adminOnly flag is set, verify user is admin
    if (adminOnly === true) {
      if (!existingUser) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Admin access required. Please contact support if you should have admin access.' })
        };
      }
      
      if (existingUser.role !== 'admin') {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Admin access required. Your account does not have admin privileges.' })
        };
      }
    }

    let user;

    if (existingUser) {
      console.log('[DEBUG] Existing user found:', existingUser.id);
      // User exists - update last login
      const { data: updatedUser, error: updateError } = await supabaseAdmin
        .from('users')
        .update({ 
          last_login: new Date().toISOString()
        })
        .eq('id', existingUser.id)
        .select()
        .single();

      if (updateError) {
        console.error('Update user error:', updateError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to update user' })
        };
      }

      user = updatedUser;
    } else {
      // If adminOnly is true, don't create new users
      if (adminOnly === true) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Admin access required. No account found for this email.' })
        };
      }

      console.log('[DEBUG] Creating new Google user');
      // Create new user from Google sign-in
      // Generate unique username from email
      const baseUsername = email.split('@')[0];
      const uniqueUsername = baseUsername + Math.floor(Math.random() * 10000);
      
      const { data: newUser, error: createError } = await supabaseAdmin
        .from('users')
        .insert({
          email: email,
          full_name: name || email.split('@')[0],
          username: uniqueUsername,
          password_hash: 'GOOGLE_OAUTH', // Placeholder for Google OAuth users (can't be null)
          balance: 0,
          role: 'user', // Use 'user' not 'customer'
          status: 'active',
          last_login: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        console.error('Create Google user error:', createError);
        console.error('Error details:', JSON.stringify(createError, null, 2));
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Failed to create user account',
            details: createError.message || createError.hint
          })
        };
      }

      console.log('[DEBUG] New user created:', newUser.id);
      user = newUser;
    }

    // Generate JWT token
    const token = createToken(user);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        token: token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          username: user.username,
          role: user.role,
          balance: user.balance
        }
      })
    };
  } catch (error) {
    console.error('Google sign-in error:', error);
    console.error('Error stack:', error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message
      })
    };
  }
}

// Google Sign-Up Handler (same as sign-in for Google OAuth)
async function handleGoogleSignUp(data, headers) {
  // Google sign-up is the same as sign-in (auto-creates account if doesn't exist)
  return await handleGoogleSignIn(data, headers);
}
