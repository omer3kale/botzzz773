# BOTZZZ773 Provider Registration Information

## Provider Details
- **Provider Name:** BOTZZZ773
- **Domain:** www.botzzz773.pro
- **Established:** 2023
- **Total Services:** 153+ active services
- **Total Orders Completed:** 37M+

## API Endpoints

### Primary API Endpoint (Recommended)
```
https://www.botzzz773.pro/api/v2
```

### Alternative Endpoints
```
https://www.botzzz773.pro/api
https://api.botzzz773.pro/api/v2
```

### Provider Info Endpoint
```
https://www.botzzz773.pro/api?action=info
```

## API Documentation
- **Public Documentation:** https://www.botzzz773.pro/api.html
- **API Format:** JSON
- **Supported Methods:** GET, POST
- **Content-Type:** application/json or application/x-www-form-urlencoded

## Sample API Requests

### Get Services List (No Authentication Required for Discovery)
```bash
# GET Request
curl "https://www.botzzz773.pro/api?action=services"

# POST Request
curl -X POST "https://www.botzzz773.pro/api" \
  -H "Content-Type: application/json" \
  -d '{"action":"services"}'
```

### Response Format
Returns array of service objects:
```json
[
  {
    "service": 7,
    "name": "Instagram Post Share [FAST] [NO DROP] [NR]",
    "type": "service",
    "category": "instagram-extras",
    "rate": "0.01",
    "min": "10",
    "max": "500000",
    "refill": true,
    "cancel": true
  }
]
```

## Available Actions
- `services` - Get list of all services
- `balance` - Check account balance (requires API key)
- `status` - Get order status (requires API key)
- `add` - Create new order (requires API key)

## Service Categories
- Instagram (Followers, Likes, Views, Comments, Shares)
- TikTok (Followers, Likes, Views, Comments, Saves)
- YouTube (Likes, Views, Subscribers)
- Spotify (Plays, Followers - Global & Country Targeted)
- Telegram (Members, Views, Reactions)
- Twitter (Likes, Views)

## Technical Specifications
- **API Version:** 2.0
- **Uptime:** 99.9%
- **Response Format:** JSON
- **CORS:** Enabled (Allow-Origin: *)
- **SSL/HTTPS:** Yes (Required)
- **Rate Limiting:** No limits for authenticated requests

## Security
- All requests must use HTTPS
- API keys required for order placement and balance checks
- Public access for service discovery only

## Contact & Support
- **Website:** https://www.botzzz773.pro
- **API Documentation:** https://www.botzzz773.pro/api.html
- **Support:** https://www.botzzz773.pro/contact.html

## Provider Verification
Provider can be verified by checking:
1. Provider info endpoint: https://www.botzzz773.pro/api?action=info
2. Services endpoint: https://www.botzzz773.pro/api?action=services
3. Website presence: https://www.botzzz773.pro
4. Robots.txt: https://www.botzzz773.pro/robots.txt
5. Sitemap: https://www.botzzz773.pro/sitemap.xml

---
**Note for Panel Administrators:** 
Our API is compatible with standard SMM panel protocols. We support both GET and POST methods for maximum compatibility. For provider whitelisting, please use the primary endpoint: `https://www.botzzz773.pro/api/v2`
