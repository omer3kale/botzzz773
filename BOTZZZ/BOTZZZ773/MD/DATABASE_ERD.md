# SMM Panel Bot Reseller System - Entity Relationship Diagram (ERD)

## Database Architecture Overview

This document describes the complete database schema for the SMM Panel Bot Reseller System, including all entities, attributes, relationships, and business rules.

---

## Entities and Attributes

### 1. Users
**Primary Table**: `users`  
**Description**: Stores customer and admin user accounts

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique user identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User email address |
| password_hash | VARCHAR(255) | NOT NULL | Bcrypt hashed password |
| username | VARCHAR(50) | UNIQUE, NOT NULL | Unique username |
| full_name | VARCHAR(100) | | Full name of user |
| balance | DECIMAL(10,2) | DEFAULT 0.00 | Current account balance |
| spent | DECIMAL(10,2) | DEFAULT 0.00 | Total lifetime spending |
| discount_rate | DECIMAL(5,2) | DEFAULT 0.00 | User-specific discount % |
| user_rate | DECIMAL(5,2) | DEFAULT 0.00 | Custom pricing rate |
| status | VARCHAR(20) | DEFAULT 'active' | Account status: active/inactive |
| role | VARCHAR(20) | DEFAULT 'user' | User role: user/admin |
| api_key | VARCHAR(64) | UNIQUE | API access key (optional) |
| last_login | TIMESTAMP WITH TIME ZONE | | Last login timestamp |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Account creation time |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last update time |

**Business Rules**:
- Balance must be >= 0
- Email must be valid format
- Password must be bcrypt hashed (never plain text)
- Only admins can set custom discount_rate and user_rate

---

### 2. Services
**Primary Table**: `services`  
**Description**: Available SMM services for purchase

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Internal service UUID |
| service_id | UUID | ALIAS for id | Alternate reference name |
| public_id | BIGINT | UNIQUE | Customer-facing ID (starts 7000) |
| provider_id | UUID | FK → providers(id) | Link to provider (nullable) |
| name | VARCHAR(255) | NOT NULL | Service display name |
| category | VARCHAR(50) | NOT NULL | Service category |
| description | TEXT | | Detailed description |
| rate | DECIMAL(10,4) | NOT NULL | Price per 1000 units |
| min_quantity | INTEGER | NOT NULL | Minimum order quantity |
| max_quantity | INTEGER | NULL = unlimited | Maximum order quantity |
| status | VARCHAR(20) | DEFAULT 'active' | active/inactive |
| provider_service_id | VARCHAR(50) | | Provider's service ID |
| type | VARCHAR(20) | DEFAULT 'default' | Service type |
| origin | VARCHAR(20) | | manual/imported |
| is_manual | BOOLEAN | | True if manually created |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last update timestamp |

**Categories**: instagram, tiktok, youtube, twitter, facebook, telegram, spotify, soundcloud, other

**Business Rules**:
- public_id sequence starts at 7000 (for customer-facing IDs)
- Only active services appear in customer catalog
- Manual services (is_manual=true) show public_id, imported show provider_service_id
- rate is ALWAYS per 1000 units
- max_quantity NULL means unlimited

---

### 3. Orders
**Primary Table**: `orders`  
**Description**: Customer service orders

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Order UUID |
| order_number | VARCHAR(20) | UNIQUE, NOT NULL | Human-readable order ID |
| user_id | UUID | FK → users(id), NOT NULL | Customer who placed order |
| service_id | UUID | FK → services(id) | Service ordered |
| service_name | VARCHAR(255) | NOT NULL | Cached service name |
| link | TEXT | NOT NULL | Target URL (profile/post) |
| quantity | INTEGER | NOT NULL | Number of units ordered |
| charge | DECIMAL(10,2) | NOT NULL | Total cost charged |
| start_count | INTEGER | DEFAULT 0 | Initial count on target |
| remains | INTEGER | | Remaining units to deliver |
| status | VARCHAR(20) | DEFAULT 'pending' | Order status |
| provider_order_id | VARCHAR(50) | | Provider's order reference |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Order placement time |
| completed_at | TIMESTAMP WITH TIME ZONE | | Order completion time |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last status update |

**Status Values**:
- `pending` - Order created, awaiting processing
- `processing` - Submitted to provider, in progress
- `completed` - Fully delivered
- `partial` - Partially completed
- `cancelled` - Cancelled by user/admin
- `refunded` - Refunded to user balance

**Business Rules**:
- charge = (service.rate × quantity) / 1000
- User balance must be >= charge at order time
- Balance is deducted immediately on order creation
- Order number format: ORD-{timestamp}-{random}
- service_name is cached to preserve history if service is deleted

---

### 4. Providers
**Primary Table**: `providers`  
**Description**: External SMM service providers

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Provider UUID |
| name | VARCHAR(100) | NOT NULL | Provider name |
| api_url | VARCHAR(255) | NOT NULL | Provider API endpoint |
| api_key | TEXT | NOT NULL | API authentication key |
| markup | DECIMAL(5,2) | DEFAULT 15.00 | Markup percentage |
| status | VARCHAR(20) | DEFAULT 'active' | active/inactive |
| balance | DECIMAL(10,2) | DEFAULT 0.00 | Provider account balance |
| services_count | INTEGER | DEFAULT 0 | Number of synced services |
| last_sync | TIMESTAMP WITH TIME ZONE | | Last successful sync time |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Provider added time |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last update time |

**Business Rules**:
- markup is percentage added to provider cost
- Provider cost = retail_rate / (1 + markup/100)
- Example: retail $1.50, markup 15% → provider cost $1.30
- Only active providers are used for order fulfillment

---

### 5. Payments
**Primary Table**: `payments`  
**Description**: User balance top-ups

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Payment UUID |
| transaction_id | VARCHAR(100) | UNIQUE, NOT NULL | Transaction reference |
| user_id | UUID | FK → users(id), NOT NULL | User making payment |
| amount | DECIMAL(10,2) | NOT NULL | Payment amount |
| method | VARCHAR(50) | NOT NULL | Payment method |
| status | VARCHAR(20) | DEFAULT 'pending' | Payment status |
| gateway_response | JSONB | | Raw gateway response data |
| memo | TEXT | | Optional note/description |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Payment initiated time |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last status update |

**Payment Methods**: stripe, paypal, crypto, bank_transfer, other

**Status Values**:
- `pending` - Payment initiated
- `completed` - Payment successful, balance added
- `failed` - Payment failed
- `refunded` - Payment refunded

**Business Rules**:
- Amount must be > 0
- Balance is added only when status = 'completed'
- transaction_id format: TXN-{timestamp}-{random}
- gateway_response stores full payment gateway data

---

### 6. Tickets
**Primary Table**: `tickets`  
**Description**: Customer support tickets

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Ticket UUID |
| ticket_number | VARCHAR(20) | UNIQUE, NOT NULL | Ticket reference number |
| user_id | UUID | FK → users(id), NOT NULL | User who created ticket |
| subject | VARCHAR(255) | NOT NULL | Ticket subject line |
| category | VARCHAR(50) | NOT NULL | Ticket category |
| priority | VARCHAR(20) | DEFAULT 'medium' | Ticket priority |
| status | VARCHAR(20) | DEFAULT 'open' | Ticket status |
| order_id | UUID | FK → orders(id) | Related order (optional) |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Ticket creation time |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last update time |

**Categories**: order, payment, technical, general

**Priority Levels**: low, medium, high, urgent

**Status Values**: open, in_progress, resolved, closed

**Business Rules**:
- ticket_number format: TKT-{timestamp}-{random}
- order_id is optional (not all tickets relate to orders)
- Only user and admins can view/update tickets

---

### 7. Ticket Messages
**Primary Table**: `ticket_messages`  
**Description**: Messages within support tickets

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Message UUID |
| ticket_id | UUID | FK → tickets(id), NOT NULL | Parent ticket |
| user_id | UUID | FK → users(id) | Message author |
| message | TEXT | NOT NULL | Message content |
| is_admin | BOOLEAN | DEFAULT false | True if sent by admin |
| is_internal | BOOLEAN | DEFAULT false | True if internal note |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Message timestamp |

**Business Rules**:
- is_internal messages only visible to admins
- Messages cannot be edited (immutable audit trail)

---

### 8. API Keys
**Primary Table**: `api_keys`  
**Description**: User API authentication keys

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | API key UUID |
| user_id | UUID | FK → users(id), NOT NULL | Key owner |
| key | TEXT | UNIQUE | Full API key (hashed) |
| key_hash | TEXT | | Hashed key for lookup |
| key_prefix | VARCHAR(32) | | Key prefix for display |
| key_last_four | VARCHAR(4) | | Last 4 chars for display |
| name | VARCHAR(100) | | Key nickname |
| permissions | TEXT[] | DEFAULT ['read'] | Permissions array |
| status | VARCHAR(20) | DEFAULT 'active' | active/inactive |
| last_used | TIMESTAMP WITH TIME ZONE | | Last usage timestamp |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation time |
| expires_at | TIMESTAMP WITH TIME ZONE | | Expiration time (optional) |

**Business Rules**:
- Keys are hashed before storage
- Only prefix and last 4 chars shown in UI
- Expired keys (expires_at < now) are rejected

---

## Relationships

### Users ↔ Orders
**Type**: One-to-Many  
**Foreign Key**: `orders.user_id → users.id`  
**Relationship**: A user can place multiple orders; each order belongs to one user  
**Cascade**: ON DELETE CASCADE (deleting user deletes their orders)

### Services ↔ Orders
**Type**: Many-to-One  
**Foreign Key**: `orders.service_id → services.id`  
**Relationship**: Multiple orders can reference the same service  
**Cascade**: ON DELETE SET NULL (if service deleted, order keeps service_name)

### Providers ↔ Services
**Type**: One-to-Many  
**Foreign Key**: `services.provider_id → providers.id`  
**Relationship**: A provider supplies multiple services; each service has one provider  
**Cascade**: ON DELETE CASCADE (deleting provider deletes its services)

### Users ↔ Payments
**Type**: One-to-Many  
**Foreign Key**: `payments.user_id → users.id`  
**Relationship**: A user can make multiple payments  
**Cascade**: ON DELETE CASCADE

### Users ↔ Tickets
**Type**: One-to-Many  
**Foreign Key**: `tickets.user_id → users.id`  
**Relationship**: A user can create multiple support tickets  
**Cascade**: ON DELETE CASCADE

### Tickets ↔ Orders
**Type**: Many-to-One (Optional)  
**Foreign Key**: `tickets.order_id → orders.id`  
**Relationship**: A ticket can optionally reference an order  
**Cascade**: ON DELETE SET NULL

### Tickets ↔ Ticket Messages
**Type**: One-to-Many  
**Foreign Key**: `ticket_messages.ticket_id → tickets.id`  
**Relationship**: A ticket contains multiple messages  
**Cascade**: ON DELETE CASCADE

### Users ↔ API Keys
**Type**: One-to-Many  
**Foreign Key**: `api_keys.user_id → users.id`  
**Relationship**: A user can have multiple API keys  
**Cascade**: ON DELETE CASCADE

---

## Critical Business Logic & Formulas

### 1. Order Charge Calculation
```javascript
// Rate is ALWAYS per 1000 units
charge = (service.rate × quantity) / 1000

// Examples:
// - Service rate: $0.50/1k, Quantity: 1000 → Charge: $0.50
// - Service rate: $1.20/1k, Quantity: 5000 → Charge: $6.00
// - Service rate: $2.00/1k, Quantity: 500  → Charge: $1.00
```

### 2. Provider Cost & Markup
```javascript
// Calculate what you pay the provider
provider_cost = retail_rate / (1 + (markup / 100))

// Example:
// - Retail rate: $1.50/1k
// - Provider markup: 15%
// - Provider cost: $1.50 / 1.15 = $1.30/1k
// - Your profit: $1.50 - $1.30 = $0.20/1k
```

### 3. Balance Operations
```javascript
// Deduct balance on order
new_balance = current_balance - charge

// Add balance on payment
new_balance = current_balance + payment_amount

// Refund balance on cancellation
new_balance = current_balance + refund_amount

// Validation: balance must always be >= 0
```

### 4. Order Validation Rules
```javascript
// Before creating order, verify:
1. service.status === 'active'
2. quantity >= service.min_quantity
3. quantity <= service.max_quantity (or max_quantity is NULL)
4. user.balance >= charge
5. link is valid URL format
```

---

## Indexes for Performance

### Users Table
```sql
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_api_key ON users(api_key);
CREATE INDEX idx_users_role ON users(role);
```

### Services Table
```sql
CREATE INDEX idx_services_category ON services(category);
CREATE INDEX idx_services_status ON services(status);
CREATE INDEX idx_services_provider_id ON services(provider_id);
CREATE INDEX idx_services_provider_service_id ON services(provider_service_id);
CREATE INDEX idx_services_public_id ON services(public_id);
```

### Orders Table
```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_service_id ON orders(service_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_order_number ON orders(order_number);
```

### Payments Table
```sql
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_transaction_id ON payments(transaction_id);
```

### Tickets Table
```sql
CREATE INDEX idx_tickets_user_id ON tickets(user_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_order_id ON tickets(order_id);
```

---

## Data Integrity Rules

### Unique Constraints
- users.email
- users.username
- users.api_key
- services.public_id
- orders.order_number
- payments.transaction_id
- tickets.ticket_number
- api_keys.key

### Not Null Constraints
All critical fields (email, password_hash, service name, order quantity, etc.) have NOT NULL constraints.

### Default Values
- Timestamps default to NOW()
- Balance fields default to 0.00
- Status fields default to logical initial state (active, pending, open)
- Role defaults to 'user'

### Check Constraints
```sql
-- Balance must be non-negative
ALTER TABLE users ADD CONSTRAINT check_balance_positive 
    CHECK (balance >= 0);

-- Quantity must be positive
ALTER TABLE orders ADD CONSTRAINT check_quantity_positive 
    CHECK (quantity > 0);

-- Amount must be positive
ALTER TABLE payments ADD CONSTRAINT check_amount_positive 
    CHECK (amount > 0);

-- Rate must be positive
ALTER TABLE services ADD CONSTRAINT check_rate_positive 
    CHECK (rate > 0);
```

---

## Timestamp Conventions

All timestamps use **ISO 8601 format with timezone**:
- Format: `YYYY-MM-DDTHH:MM:SS.sssZ`
- Example: `2025-11-07T10:30:00.000Z`
- Database type: `TIMESTAMP WITH TIME ZONE`
- Always stored in UTC, converted for display

---

## Status Enumerations

### User Status
- `active` - Account is active and can place orders
- `inactive` - Account is disabled
- `suspended` - Temporarily suspended
- `banned` - Permanently banned

### Service Status
- `active` - Available for purchase
- `inactive` - Not available (hidden from catalog)

### Order Status
- `pending` - Created, awaiting processing
- `processing` - Submitted to provider
- `completed` - Fully delivered
- `partial` - Partially completed
- `cancelled` - Cancelled
- `refunded` - Refunded to balance

### Payment Status
- `pending` - Payment initiated
- `completed` - Payment successful
- `failed` - Payment failed
- `refunded` - Payment refunded

### Ticket Status
- `open` - New ticket, awaiting response
- `in_progress` - Being worked on
- `resolved` - Issue resolved, awaiting closure
- `closed` - Ticket closed

### Provider Status
- `active` - Provider is operational
- `inactive` - Provider is disabled
- `maintenance` - Provider is under maintenance

---

## ERD Diagram Summary

```
┌──────────┐         ┌──────────┐         ┌───────────┐
│  Users   │1──────*│  Orders  │*────────1│ Services  │
│          │         │          │         │           │
│ id (PK)  │         │ id (PK)  │         │ id (PK)   │
│ email    │         │ user_id  │         │public_id  │
│ username │         │service_id│         │ name      │
│ balance  │         │ quantity │         │ rate      │
│ role     │         │ charge   │         │ category  │
└──────────┘         │ status   │         └───────────┘
     │1              └──────────┘              │*
     │                                         │
     │*                                        │1
┌──────────┐                           ┌───────────┐
│ Payments │                           │ Providers │
│          │                           │           │
│ id (PK)  │                           │ id (PK)   │
│ user_id  │                           │ name      │
│ amount   │                           │ api_url   │
│ status   │                           │ markup    │
└──────────┘                           └───────────┘
     │1
     │
     │*
┌──────────┐         ┌────────────────┐
│ Tickets  │1──────*│ TicketMessages │
│          │         │                │
│ id (PK)  │         │ id (PK)        │
│ user_id  │         │ ticket_id      │
│ order_id │         │ message        │
│ status   │         │ is_admin       │
└──────────┘         └────────────────┘
```

---

## Version History

- **v1.0** - Initial schema (2025-01-01)
- **v1.1** - Added public_id to services (2025-11-07)
- **v1.2** - Added status column to services (2025-11-07)
- **v1.3** - Fixed order charge calculation formula (2025-11-07)

---

## Migration Notes

When updating production database:
1. Always backup before migration
2. Test migrations on staging first
3. Use transactions for multi-step migrations
4. Verify data integrity after migration
5. Update application code before schema changes

---

**Last Updated**: November 7, 2025  
**Database**: PostgreSQL 14+ (Supabase)  
**Character Set**: UTF-8  
**Collation**: en_US.UTF-8
