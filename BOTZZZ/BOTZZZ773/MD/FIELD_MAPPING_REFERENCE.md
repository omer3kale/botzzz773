# SMM Panel Bot Reseller System - Field Mapping Reference

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SMM PANEL BOT RESELLER SYSTEM                     │
└─────────────────────────────────────────────────────────────────────┘

FRONTEND (Cyan) → AUTHENTICATION (Cyan) → DASHBOARD (Green) → ORDER PROCESSING (Red/Brown) → BACKEND (Yellow)
```

---

## 1. AUTHENTICATION MODULE (Cyan)

### Sign In/Sign Up Fields
```javascript
// Frontend Input Fields
{
  email: "user@example.com",           // User email address
  password: "hashedPassword123",        // User password
  username: "johndoe",                  // Unique username
  full_name: "John Doe"                 // User's full name (optional)
}

// Backend JWT Token Payload
{
  userId: "uuid-string",                // User UUID from database
  email: "user@example.com",            // User email
  role: "user" | "admin",               // User role
  iat: 1699372800,                      // Issued at timestamp
  exp: 1699459200                       // Expiration timestamp
}

// LocalStorage Keys
localStorage.token = "jwt-token-string"
localStorage.user = JSON.stringify({
  id: "uuid",
  email: "user@example.com",
  username: "johndoe",
  full_name: "John Doe",
  balance: "100.00",
  role: "user"
})
```

---

## 2. DASHBOARD MODULE (Green)

### User Display Fields
```javascript
{
  id: "uuid-string",                    // User UUID
  email: "user@example.com",
  username: "johndoe",
  full_name: "John Doe",
  balance: "100.00",                    // Decimal(10,2) as string
  spent: "250.00",                      // Total amount spent
  discount_rate: "5.00",                // User-specific discount %
  user_rate: "0.00",                    // Custom pricing rate
  status: "active" | "inactive",
  role: "user" | "admin",
  last_login: "2025-11-07T10:30:00Z",   // ISO timestamp
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-11-07T10:30:00Z"
}
```

### Stats Dashboard Fields
```javascript
{
  totalOrders: 150,                     // Count of user orders
  activeOrders: 12,                     // Orders with status 'processing'
  completedOrders: 138,                 // Orders with status 'completed'
  totalSpent: "1250.50",               // Sum of all order charges
  currentBalance: "100.00"              // User's current balance
}
```

---

## 3. SERVICE MANAGEMENT (Dark Cyan/Gray)

### Service Input Fields (Admin Panel)
```javascript
{
  // Primary Fields
  service_id: "uuid-string",            // Database primary key (auto-generated)
  public_id: 7000,                      // Customer-facing ID (starts at 7000)
  name: "Instagram Followers - HQ",     // Service display name
  category: "instagram",                // Category: instagram|tiktok|youtube|twitter|facebook|telegram|spotify|other
  description: "High quality followers", // Service description
  
  // Pricing
  rate: "0.50",                         // Price per 1000 units (Decimal 10,4)
  
  // Quantity Limits
  min_quantity: 10,                     // Minimum order quantity (Integer)
  max_quantity: 100000,                 // Maximum order quantity (Integer or NULL for unlimited)
  
  // Provider Integration
  provider_id: "uuid-string" | null,    // Link to providers table
  provider_service_id: "12345" | null,  // Provider's service ID (VARCHAR 50)
  
  // Metadata
  type: "default" | "custom",           // Service type
  status: "active" | "inactive",        // Availability status
  origin: "manual" | "imported",        // How service was added
  is_manual: true | false,              // Manual creation flag
  
  // Timestamps
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-11-07T10:30:00Z"
}

// Provider Relationship
provider: {
  id: "uuid-string",
  name: "Provider XYZ",
  markup: "15.00"                       // Markup percentage (Decimal 5,2)
}
```

### Service Display Fields (Customer View)
```javascript
{
  id: "uuid-string",                    // Internal UUID
  publicId: 7000,                       // Display as "#7000"
  labelId: "#7000",                     // Formatted label for display
  name: "Instagram Followers - HQ",
  category: "instagram",
  description: "High quality followers",
  rate: "0.50",                         // Per 1000 units
  price: "0.50",                        // Alias for rate
  min: 10,
  max: 100000,
  status: "active"
}
```

---

## 4. ORDER PROCESSING (Red Circles)

### Order Creation Request
```javascript
// Frontend Payload
{
  serviceId: "uuid-string",             // Service UUID
  serviceLabel: "#7000" | "Service Name", // Display label
  link: "https://instagram.com/user",   // Target URL
  quantity: 1000,                       // Number of units (Integer)
  notes: "Optional instructions"        // Additional notes (optional)
}

// Backend Processing
{
  // Calculated Fields
  charge: "0.50",                       // (rate × quantity) / 1000
  totalCost: "0.50",                    // Same as charge
  
  // Validation Checks
  quantity >= service.min_quantity,     // Minimum check
  quantity <= service.max_quantity,     // Maximum check
  user.balance >= charge,               // Balance check
  service.status === 'active'           // Service availability
}
```

### Order Database Record
```javascript
{
  // Primary Fields
  id: "uuid-string",                    // Order UUID
  order_number: "ORD-1699372800-ABC123", // Unique order number
  
  // Relations
  user_id: "uuid-string",               // Customer UUID
  service_id: "uuid-string",            // Service UUID
  service_name: "Instagram Followers",   // Cached service name
  
  // Order Details
  link: "https://instagram.com/user",
  quantity: 1000,
  charge: "0.50",                       // Final charge amount
  
  // Progress Tracking
  start_count: 1000,                    // Initial count (Integer)
  remains: 0,                           // Remaining quantity (Integer)
  
  // Status Management
  status: "pending" | "processing" | "completed" | "cancelled" | "partial",
  
  // Provider Integration
  provider_order_id: "123456" | null,   // Provider's order ID
  
  // Timestamps
  created_at: "2025-11-07T10:30:00Z",
  completed_at: "2025-11-07T12:00:00Z" | null,
  updated_at: "2025-11-07T11:45:00Z"
}
```

### Order Status Flow
```javascript
{
  pending: "Order created, awaiting processing",
  processing: "Order submitted to provider",
  completed: "Order fully delivered",
  partial: "Order partially completed",
  cancelled: "Order cancelled by user/admin",
  refunded: "Order refunded to user"
}
```

---

## 5. PAYMENT PROCESSING (Red Circles)

### Add Funds Request
```javascript
{
  amount: "50.00",                      // Payment amount (Decimal 10,2)
  method: "stripe" | "paypal" | "crypto", // Payment method
  gateway_response: {                   // JSONB field
    transaction_id: "txn_abc123",
    status: "succeeded",
    raw_response: {}
  }
}
```

### Payment Record
```javascript
{
  id: "uuid-string",
  transaction_id: "TXN-1699372800-XYZ", // Unique transaction ID
  user_id: "uuid-string",
  amount: "50.00",
  method: "stripe",
  status: "pending" | "completed" | "failed" | "refunded",
  gateway_response: {},                 // JSONB with gateway data
  memo: "Balance top-up",               // Optional note
  created_at: "2025-11-07T10:30:00Z",
  updated_at: "2025-11-07T10:30:00Z"
}
```

---

## 6. USER BALANCE OPERATIONS (Brown Circles)

### Balance Update Operations
```javascript
// Check Balance
{
  current_balance: "100.00",
  required_amount: "0.50",
  sufficient: true | false
}

// Deduct Balance (Order)
{
  user_id: "uuid-string",
  old_balance: "100.00",
  charge: "0.50",
  new_balance: "99.50",                 // old_balance - charge
  operation: "order_placed",
  reference_id: "order-uuid"
}

// Add Balance (Payment)
{
  user_id: "uuid-string",
  old_balance: "99.50",
  amount: "50.00",
  new_balance: "149.50",                // old_balance + amount
  operation: "payment_received",
  reference_id: "payment-uuid"
}

// Refund Balance (Cancelled Order)
{
  user_id: "uuid-string",
  old_balance: "99.50",
  refund: "0.50",
  new_balance: "100.00",                // old_balance + refund
  operation: "order_refunded",
  reference_id: "order-uuid"
}
```

---

## 7. BACKEND/API INTERACTIONS (Yellow Circles)

### API Request Headers
```javascript
{
  'Content-Type': 'application/json',
  'Authorization': 'Bearer jwt-token-string'
}
```

### API Response Format
```javascript
// Success Response
{
  success: true,
  data: {},                             // Response data
  message: "Operation completed"        // Optional message
}

// Error Response
{
  error: "Error message",
  statusCode: 400 | 401 | 403 | 404 | 500,
  details: {}                           // Optional error details
}
```

### Provider API Integration
```javascript
// Provider Request
{
  key: "provider-api-key",              // Provider API key
  action: "add" | "status" | "services",
  service: "12345",                     // Provider service ID
  link: "https://instagram.com/user",
  quantity: 1000
}

// Provider Response
{
  order: "123456",                      // Provider order ID
  status: "In progress" | "Completed" | "Pending",
  charge: "0.50",
  start_count: 1000,
  remains: 0
}
```

---

## 8. TICKETS/SUPPORT SYSTEM (Brown)

### Ticket Fields
```javascript
{
  id: "uuid-string",
  ticket_number: "TKT-1699372800-ABC",
  user_id: "uuid-string",
  subject: "Order Issue",
  category: "order" | "payment" | "technical" | "general",
  priority: "low" | "medium" | "high" | "urgent",
  status: "open" | "in_progress" | "resolved" | "closed",
  order_id: "uuid-string" | null,       // Related order (optional)
  created_at: "2025-11-07T10:30:00Z",
  updated_at: "2025-11-07T11:00:00Z"
}
```

### Ticket Message
```javascript
{
  id: "uuid-string",
  ticket_id: "uuid-string",
  user_id: "uuid-string",
  message: "I need help with order #7000",
  is_admin: false,                      // Message from admin?
  is_internal: false,                   // Internal note (admin only)?
  created_at: "2025-11-07T10:30:00Z"
}
```

---

## 9. ADMIN FEATURES

### Admin Service Management
```javascript
// Edit Service Payload
{
  serviceId: "uuid-string",
  name: "Updated Service Name",
  category: "instagram",
  rate: "0.75",                         // Updated rate
  min_quantity: 100,
  max_quantity: 50000,
  description: "Updated description",
  status: "active" | "inactive",
  providerId: "uuid-string" | null,     // Reassign provider
  providerServiceId: "67890" | null     // New provider service ID
}

// Add Service Payload
{
  name: "New Service",
  category: "tiktok",
  rate: "1.50",
  min_quantity: 50,
  max_quantity: 10000,
  description: "New service description",
  status: "active",
  origin: "manual",
  is_manual: true,
  type: "custom"
}
```

### Admin Order Management
```javascript
// Update Order Status
{
  orderId: "uuid-string",
  status: "completed" | "cancelled" | "refunded",
  remains: 0,                           // Updated remaining quantity
  provider_order_id: "123456"           // Provider's order ID
}
```

### Provider Sync Response
{
  success: true,
  added: 15,                            // New services added
  updated: 8,                           // Existing services updated
  total: 23,                            // Total services processed
  provider_id: "uuid-string"
}
```

---

## 10. API ENDPOINTS REFERENCE

### Authentication
- `POST /.netlify/functions/auth` - Sign in/Sign up
- `GET /.netlify/functions/auth` - Verify token

### Services
- `GET /.netlify/functions/services` - List services (public or admin)
- `POST /.netlify/functions/services` - Create service (admin)
- `PUT /.netlify/functions/services` - Update service (admin)
- `DELETE /.netlify/functions/services` - Delete service (admin)

### Orders
- `GET /.netlify/functions/orders` - List orders
- `POST /.netlify/functions/orders` - Create order
- `PUT /.netlify/functions/orders` - Update order status
- `DELETE /.netlify/functions/orders` - Cancel order

### Providers
- `GET /.netlify/functions/providers` - List providers
- `POST /.netlify/functions/providers` - Add provider
- `PUT /.netlify/functions/providers` - Update provider
- `POST /.netlify/functions/providers?action=sync` - Sync provider services

### Payments
- `GET /.netlify/functions/payments` - List payments
- `POST /.netlify/functions/payments` - Create payment

### Tickets
- `GET /.netlify/functions/tickets` - List tickets
- `POST /.netlify/functions/tickets` - Create ticket
- `PUT /.netlify/functions/tickets` - Update ticket

---

## 11. DATABASE SCHEMA COLUMN TYPES

### Users Table
```sql
id                UUID PRIMARY KEY
email             VARCHAR(255) UNIQUE NOT NULL
password_hash     VARCHAR(255) NOT NULL
username          VARCHAR(50) UNIQUE NOT NULL
full_name         VARCHAR(100)
balance           DECIMAL(10, 2) DEFAULT 0.00
spent             DECIMAL(10, 2) DEFAULT 0.00
discount_rate     DECIMAL(5, 2) DEFAULT 0.00
user_rate         DECIMAL(5, 2) DEFAULT 0.00
status            VARCHAR(20) DEFAULT 'active'
role              VARCHAR(20) DEFAULT 'user'
api_key           VARCHAR(64) UNIQUE
last_login        TIMESTAMP WITH TIME ZONE
created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
```

### Services Table
```sql
id                  UUID PRIMARY KEY
service_id          UUID (alternate name - same as id)
public_id           BIGINT UNIQUE (starts at 7000)
provider_id         UUID REFERENCES providers(id)
name                VARCHAR(255) NOT NULL
category            VARCHAR(50) NOT NULL
type                VARCHAR(20) DEFAULT 'default'
rate                DECIMAL(10, 4) NOT NULL
min_quantity        INTEGER NOT NULL
max_quantity        INTEGER (NULL = unlimited)
description         TEXT
status              VARCHAR(20) DEFAULT 'active'
provider_service_id VARCHAR(50)
origin              VARCHAR(20)
is_manual           BOOLEAN
created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
```

### Orders Table
```sql
id                  UUID PRIMARY KEY
order_number        VARCHAR(20) UNIQUE NOT NULL
user_id             UUID REFERENCES users(id)
service_id          UUID REFERENCES services(id)
service_name        VARCHAR(255) NOT NULL
link                TEXT NOT NULL
quantity            INTEGER NOT NULL
charge              DECIMAL(10, 2) NOT NULL
start_count         INTEGER DEFAULT 0
remains             INTEGER
status              VARCHAR(20) DEFAULT 'pending'
provider_order_id   VARCHAR(50)
created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
completed_at        TIMESTAMP WITH TIME ZONE
updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
```

### Providers Table
```sql
id              UUID PRIMARY KEY
name            VARCHAR(100) NOT NULL
api_url         VARCHAR(255) NOT NULL
api_key         TEXT NOT NULL
markup          DECIMAL(5, 2) DEFAULT 15.00
status          VARCHAR(20) DEFAULT 'active'
balance         DECIMAL(10, 2) DEFAULT 0.00
services_count  INTEGER DEFAULT 0
last_sync       TIMESTAMP WITH TIME ZONE
created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
```

---

## 12. CRITICAL FORMULAS

### Price Calculation
```javascript
// Rate is ALWAYS per 1000 units
const charge = (rate * quantity) / 1000;

// Examples:
// Rate: $0.50/1k, Quantity: 1000 → Charge: $0.50
// Rate: $1.20/1k, Quantity: 5000 → Charge: $6.00
// Rate: $2.00/1k, Quantity: 500  → Charge: $1.00
```

### Provider Cost (Admin Panel)
```javascript
// If provider has markup percentage
const providerCost = rate / (1 + (markup / 100));

// Example: Rate $1.50, Markup 15%
// providerCost = 1.50 / 1.15 = $1.30 (what you pay provider)
// Profit = $1.50 - $1.30 = $0.20 per 1k
```

### Balance Operations
```javascript
// Deduct on order
newBalance = parseFloat(currentBalance) - parseFloat(charge);

// Add on payment
newBalance = parseFloat(currentBalance) + parseFloat(amount);

// Refund on cancellation
newBalance = parseFloat(currentBalance) + parseFloat(refundAmount);
```

---

## 13. FRONTEND STATE MANAGEMENT

### LocalStorage Keys
```javascript
localStorage.token         // JWT authentication token
localStorage.user          // JSON string of user object
localStorage.servicesCache // Cached services data (optional)
```

### Session State (Dashboard)
```javascript
// Global Variables
let user = {};                 // Current user object
let servicesData = {};         // Services grouped by category
let selectedService = null;    // Currently selected service for order
```

---

## USAGE NOTES FOR PERPLEXITY

When asking Perplexity for help with this system:

1. **Reference specific field names** from this document
2. **Include the module** (e.g., "In the ORDER PROCESSING module...")
3. **Specify data types** (e.g., "balance is Decimal(10,2) stored as string")
4. **Mention relationships** (e.g., "service_id references services table")

Example queries:
- "How do I calculate the `charge` field in the ORDER PROCESSING module?"
- "What's the difference between `public_id` and `provider_service_id` in services?"
- "Show me the correct JWT payload structure for AUTHENTICATION"
