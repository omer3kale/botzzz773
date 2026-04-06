// Supabase client bootstrap shared by Netlify functions.
// Loads local .env files for development and fails fast with readable errors
// when required credentials are missing.
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

try {
  const dotenv = require('dotenv');
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  dotenv.config({ path: path.join(rootDir, '.env') });
  dotenv.config({ path: path.join(rootDir, '.env.local'), override: true });
} catch (error) {
  // dotenv is optional at runtime because Netlify injects env vars directly.
}

function requireEnv(name, options = {}) {
  const { allowMissing = false } = options;
  const value = process.env[name];

  if (value) {
    return value;
  }

  if (allowMissing) {
    return null;
  }

  const message = `[supabase] Missing required environment variable: ${name}. ` +
    'Set it in Netlify Environment Variables or the local .env file.';

  throw new Error(message);
}

function createSupabaseClient(keyName, options = {}) {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv(keyName, options);

  if (!supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

const supabase = createSupabaseClient('SUPABASE_ANON_KEY', { allowMissing: true });
const supabaseAdmin = createSupabaseClient('SUPABASE_SERVICE_ROLE_KEY');

module.exports = { supabase, supabaseAdmin };
