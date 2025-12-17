# User Discount Application in API v2

## Problem Solved

Previously, when a reseller used the `/api?action=services` endpoint with their API key, they would get the standard retail prices, **NOT** their user-specific discounts.

### Example:
- Admin sets User A: 20% discount on service 9151
- User A sees 20% discount in frontend (correctly)
- BUT when User A uses their API key with `action=services`, they would see **full price**
- This broke Perfect Panel integration for resellers with custom discounts

## Solution Implemented

### Code Changes

**File:** `netlify/functions/v2.js`

#### Change 1: Update `getServices()` Function Signature
```javascript
// BEFORE
async function getServices() { ... }

// AFTER
async function getServices(user = null) {
  // ... fetch services ...
  
  // Apply user discounts if authenticated
  if (user) {
    // Check user-specific service discount
    // Then global service discount
    // Then user global discount
    
    if (effectiveDiscount > 0) {
      rateNumber = Number((rateNumber * (1 - effectiveDiscount / 100)).toFixed(4));
    }
  }
  
  return services;
}
```

#### Change 2: Pass User to getServices()
```javascript
case 'services':
  // BEFORE: const services = await getServices();
  // AFTER: Pass authenticated user (null if not authenticated)
  const services = await getServices(user);
  return { statusCode: 200, headers, body: JSON.stringify(services) };
```

## Discount Priority (Same as Add Order)

When user is authenticated, discounts are applied in this order:

1. **User-Specific Service Discount** (highest priority)
   - Example: User A gets 20% off service 9151
   - Used if `user.service_discounts[9151] = 20`

2. **Global Service Discount** (medium priority)
   - Applies to ALL users for that service
   - Used if `SERVICE_DISCOUNTS[9151] = 10` and no user-specific exists

3. **User Global Discount** (lowest priority)
   - Applies to all services for that user
   - Used if `user.discount_rate = 5` and no service-level discount exists

4. **No Discount**
   - Full retail price if none above apply

## API Response Examples

### Without Authentication (Public)
```bash
GET /api?action=services
```

Response:
```json
[
  {
    "service": 9151,
    "name": "Instagram Followers",
    "rate": 0.5234,  // Full retail price
    ...
  }
]
```

### With Authentication (Reseller with Discount)
```bash
POST /api
key=USER_API_KEY&action=services
```

Response (User A has 20% off service 9151):
```json
[
  {
    "service": 9151,
    "name": "Instagram Followers",
    "rate": 0.4187,  // 0.5234 × (1 - 20/100) = 0.4187 (20% off!)
    ...
  }
]
```

## Impact on Reseller Integrations

### Perfect Panel Script Integration
- Reseller now gets correct discounted prices from services API
- When syncing to Perfect Panel, discounts are automatically included
- Users can now offer their customers discounted rates

### Example Workflow
1. Admin sets User A: 20% off on Instagram services
2. User A calls `POST /api?key=API_KEY&action=services`
3. API returns Instagram services with 20% applied
4. User A syncs to Perfect Panel with correct pricing
5. User A's customers see discounted rates ✅

## Testing Checklist

- [ ] Anonymous request to `/api?action=services` shows full prices
- [ ] Authenticated request shows user-specific discounts
- [ ] User-specific service discount takes precedence
- [ ] Global service discount applies if no user-specific
- [ ] User global discount applies as fallback
- [ ] Discount calculation correct: `new_rate = old_rate × (1 - discount%/100)`
- [ ] Price precision maintained (4 decimals)

## Code Location

- Function: `getServices(user = null)` - Line 84
- Caller: `case 'services'` - Line 197
- Discount logic: Lines 96-126 in updated getServices()
