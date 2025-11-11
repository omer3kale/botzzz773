# Order System Troubleshooting Guide

## Problem: "Service ID, quantity and link are required" Error

### What This Error Means
This 400 error occurs when one of the required fields (`serviceId`, `quantity`, or `link`) is missing or empty when the order reaches the backend API.

### Common Causes & Solutions

#### 1. User Not Logged In ✅ FIXED
**Symptom**: Error appears immediately when submitting order
**Cause**: No authentication token in localStorage
**Solution**: 
- The system now checks if user is logged in BEFORE submitting order
- If not logged in, user is redirected to signin.html with redirect back to order page
- **Action Required**: Users MUST sign in before placing orders

#### 2. Service Not Selected
**Symptom**: Error shows `serviceId: 'missing'` in details
**Cause**: User didn't select a service from dropdown
**Solution**:
- Select a service from the "Service" dropdown before submitting
- The dropdown should load automatically when page loads
- If dropdown shows "Loading services..." forever, check browser console for errors

#### 3. Empty Link Field
**Symptom**: Error shows `link: 'missing'` in details
**Cause**: Link input field is empty or contains only whitespace
**Solution**:
- Enter a valid URL (e.g., https://instagram.com/username)
- Link must be between 1 and 500 characters
- Link validation happens in real-time when you click outside the field

#### 4. Invalid Quantity
**Symptom**: Error shows `quantity: 'missing'` in details
**Cause**: Quantity is 0, negative, or not a number
**Solution**:
- Enter a valid number between service min and max
- Each service has different min/max values (shown below quantity field)
- Quantity must be a whole number

### How to Debug

#### Step 1: Open Browser Console
1. Press F12 in your browser
2. Click "Console" tab
3. Try to submit an order
4. Look for messages starting with `[ORDER]`

#### Step 2: Check What's Being Sent
You should see:
```
[ORDER] Submitting order: {
  serviceId: "a98b3071-c83a-4cba-a11c-518b42659fe5",
  link: "https://example.com",
  quantity: 10,
  notes: ""
}
```

If any field shows `undefined`, `null`, or `""` (empty string), that's the problem!

#### Step 3: Check Server Response
Look for:
```
[ORDER] Response: 201 { success: true, order: {...} }
```

If you see `400` instead of `201`, check the error details:
```
[ORDER] Response: 400 {
  error: "Service ID, quantity, and link are required",
  details: {
    serviceId: "missing",  ← This field is the problem
    quantity: "provided",
    link: "provided"
  }
}
```

### Testing Locally

Run this command to test order creation from terminal:
```bash
node tests/live-order-test.js
```

This will show you exactly what's being sent and what response you get.

### Quick Checklist

Before submitting an order, verify:
- [ ] You are signed in (see your username in top-right corner)
- [ ] A service is selected from the dropdown
- [ ] Link field contains a valid URL
- [ ] Quantity is a number within min/max range
- [ ] Browser console shows no JavaScript errors

### Expected Flow

1. **User visits order.html**
2. **Services load** into dropdown
3. **User selects service** → Min/max quantity updates
4. **User enters link** → Real-time validation
5. **User enters quantity** → Price estimate updates
6. **User clicks Submit**
7. **System checks** if logged in → Redirects to signin if not
8. **System validates** all fields → Shows specific error if invalid
9. **System submits** to backend → Shows loading spinner
10. **Backend creates order** → Returns 201 with order details
11. **Frontend shows success** → Redirects to dashboard after 2 seconds

### Recent Fixes Applied

✅ Added authentication check before submitting order  
✅ Added detailed console logging for debugging  
✅ Improved error messages to show which field is missing  
✅ Added redirect to signin page if not logged in  
✅ Enhanced error response details from backend  

### Contact Support

If you still get errors after checking all the above:
1. Take a screenshot of browser console (F12)
2. Note which service you selected
3. Note what link and quantity you entered
4. Send all details to support

---

**Last Updated**: November 9, 2025  
**Deployment**: https://botzzz773.pro  
**Test Command**: `node tests/live-order-test.js`
