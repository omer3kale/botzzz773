// Script to create admin user in Supabase
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create Supabase client with service role (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function createAdminUser() {
  try {
    console.log('🔐 Creating admin user...\n');

    const adminData = {
      email: 'botzzz773@gmail.com',
      password: 'Mariogomez33*',
      full_name: 'Admin User',
      username: 'botzzz773',
      role: 'admin'
    };

    // Hash the password
    console.log('🔒 Hashing password...');
    const passwordHash = await bcrypt.hash(adminData.password, 10);
    console.log('✅ Password hashed\n');

    // Check if user already exists
    console.log('🔍 Checking if user exists...');
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('email', adminData.email)
      .single();

    if (existingUser) {
      console.log('⚠️  User already exists! Updating to admin role...\n');
      
      // Update existing user to admin
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          role: 'admin',
          password_hash: passwordHash,
          full_name: adminData.full_name,
          username: adminData.username,
          status: 'active'
        })
        .eq('email', adminData.email)
        .select()
        .single();

      if (updateError) {
        console.error('❌ Error updating user:', updateError);
        throw updateError;
      }

      console.log('✅ User updated successfully!\n');
      console.log('👤 Admin Details:');
      console.log('   Email:', updatedUser.email);
      console.log('   Username:', updatedUser.username);
      console.log('   Role:', updatedUser.role);
      console.log('   Status:', updatedUser.status);
      console.log('\n🎉 You can now login at: https://botzzz773.pro/signin.html');
      
    } else {
      console.log('✅ No existing user found. Creating new admin...\n');

      // Create new admin user
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: adminData.email,
          password_hash: passwordHash,
          full_name: adminData.full_name,
          username: adminData.username,
          role: 'admin',
          balance: 0,
          status: 'active'
        })
        .select()
        .single();

      if (createError) {
        console.error('❌ Error creating user:', createError);
        throw createError;
      }

      console.log('✅ Admin user created successfully!\n');
      console.log('👤 Admin Details:');
      console.log('   ID:', newUser.id);
      console.log('   Email:', newUser.email);
      console.log('   Username:', newUser.username);
      console.log('   Role:', newUser.role);
      console.log('   Status:', newUser.status);
      console.log('   Balance:', newUser.balance);
      console.log('\n🎉 You can now login at: https://botzzz773.pro/signin.html');
    }

    console.log('\n📝 Login Credentials:');
    console.log('   Email:', adminData.email);
    console.log('   Password:', adminData.password);
    console.log('\n✅ Setup complete!');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
createAdminUser();
