# Task Test Cases

Each section provides three recommended test cases for the corresponding issue from the 16-task execution plan.

## Issue #1: Service Loading Problem
1. **Happy Path Load**  
   Steps: Clear browser cache → open `order.html` → observe service dropdown.  
   Expected: Dropdown disables while loading, populates with ≥1 option, console shows `[ORDER] Services loaded` log.
2. **API Failure Handling**  
   Steps: Mock `/services` function to return 500 → load `order.html`.  
   Expected: Dropdown re-enables with error toast, placeholder text changes to "Failed to load services".
3. **Stale Token Scenario**  
   Steps: Load page with expired JWT in localStorage → trigger service load.  
   Expected: Redirect to `signin.html` after toast indicating authentication required.

## Issue #2: Service Filter Button Icons
1. **Icon Rendering**  
   Steps: Open `services.html` on desktop.  
   Expected: Each filter button displays correct platform SVG at 32×32 with no broken images.
2. **Active State Styling**  
   Steps: Click each filter sequentially.  
   Expected: Active button shows gradient background + shadow; others revert to inactive state.
3. **Accessibility Contrast**  
   Steps: Run axe or Lighthouse accessibility audit focused on filter toolbar.  
   Expected: Color contrast ratios meet WCAG AA for text and icons.

## Issue #3: "How You Operate" Section
1. **Step Count Verification**  
   Steps: Inspect `index.html` section.  
   Expected: Exactly three cards rendered with headers Sign In, Add Funds & Select Service, Watch Results.
2. **Responsive Layout**  
   Steps: Resize viewport to 375px width.  
   Expected: Steps stack vertically with preserved spacing and centered icons.
3. **Copy Accuracy**  
   Steps: Review copy against requirements.  
   Expected: H2 text reads "How You Operate"; descriptions match approved wording.

## Issue #4: Popular Services Reddit Card
1. **Card Presence**  
   Steps: Scroll to Popular Services on `index.html`.  
   Expected: Reddit card appears with correct icon and "Coming Soon" badge.
2. **Hover Interaction**  
   Steps: Hover over Reddit card.  
   Expected: Card elevates with box-shadow consistent with other cards.
3. **Link Behavior**  
   Steps: Click Reddit card CTA.  
   Expected: Button disabled or shows informational modal (no broken navigation).

## Issue #5: Reddit Services Implementation
1. **Filter Integration**  
   Steps: On `services.html`, click Reddit filter.  
   Expected: Grid shows only Reddit placeholder services with "Coming Soon" CTAs.
2. **API Consistency**  
   Steps: Query `/services` endpoint for Reddit entries.  
   Expected: Response includes Reddit category records matching front-end placeholders.
3. **No Provider Errors**  
   Steps: Check browser console during Reddit filter selection.  
   Expected: No uncaught exceptions relating to missing providers.

## Issue #6 & #7: Email Address Update
1. **Footer Audit**  
   Steps: Run global search for previous emails.  
   Expected: Only `botzzz773@gmail.com` remains across all pages.
2. **Mailto Links**  
   Steps: Click footer email link in each primary page.  
   Expected: Opens default mail client with correct recipient.
3. **Admin Templates**  
   Steps: Inspect `admin/*.html` footers.  
   Expected: Same updated email present without mismatches.

## Issue #8: Add Funds Button Redesign
1. **Visual Regression**  
   Steps: Compare before/after screenshots of `btn-payment`.  
   Expected: Gradient, radius, and shadow conform to box design palette.
2. **Hover Animation**  
   Steps: Hover button.  
   Expected: Button translates -4px on Y, icon shifts +4px X, transition smooth.
3. **Disabled State**  
   Steps: Submit form while loading.  
   Expected: Button disables, opacity 0.6, no pointer events until fetch resolves.

## Issue #9: Add Funds Footer Implementation
1. **Markup Consistency**  
   Steps: Compare `addfunds.html` footer markup vs `index.html`.  
   Expected: Sections identical aside from page-specific links.
2. **Responsive Layout**  
   Steps: View footer at 360px width.  
   Expected: Columns stack vertically with adequate spacing.
3. **Link Integrity**  
   Steps: Click each footer link.  
   Expected: Navigates to correct pages without 404s.

## Issue #10: Custom Amount Input Styling
1. **Icon Alignment**  
   Steps: Focus the custom amount field.  
   Expected: Dollar icon remains vertically centered with input text.
2. **Focus State**  
   Steps: Tab into input.  
   Expected: Gradient border highlights, box-shadow appears, placeholder fades.
3. **Validation Feedback**  
   Steps: Enter amount <5 and submit.  
   Expected: Toast shows minimum deposit error, field remains highlighted.

## Issue #11: Crypto Payment Integration
1. **Invoice Generation**  
   Steps: Select "Crypto Invoice" → enter $50 → submit.  
   Expected: Netlify function responds success; modal shows invoice link.
2. **NOWPayments API Failure**  
   Steps: Simulate 500 response from NOWPayments.  
   Expected: User receives error toast, button re-enables with default label.
3. **Modal Data Accuracy**  
   Steps: Inspect modal values.  
   Expected: Order ID, pay amount (6 decimal precision), deposit address populated correctly.

## Issue #12: Dynamic Balance Updates
1. **Initial Load Fetch**  
   Steps: Load add funds page with valid token.  
   Expected: Balance card shows value matching `/users` response.
2. **Post-Payment Refresh**  
   Steps: Complete Payeer manual flow (simulate webhook).  
   Expected: After success, `loadUserBalance()` reruns and updates amount.
3. **Token Missing**  
   Steps: Remove token from localStorage → load page.  
   Expected: Alert prompts sign-in and redirects.

## Issue #13/#14/#15: API Page Styling
1. **Button Visuals**  
   Steps: Open `api.html`; inspect primary buttons.  
   Expected: Buttons use box design gradient, hover animation matches spec.
2. **Info Row Contrast**  
   Steps: Review `.api-info-row` elements in light/dark backgrounds.  
   Expected: Borders and fill align with style guide, text readable.
3. **Endpoint Card Consistency**  
   Steps: Compare endpoint cards vs services cards.  
   Expected: Shared palette, typography, spacing consistent across cards.

## Issue #16: Mobile Toggle Button Missing
1. **Toggle Visibility**  
   Steps: Open `tickets.html` at 375px width.  
   Expected: Hamburger icon appears in nav header.
2. **Menu Expansion**  
   Steps: Tap toggle.  
   Expected: Mobile menu slides open, links clickable.
3. **Script Integration**  
   Steps: Inspect console after toggle usage.  
   Expected: No JS errors; `main.js` handles nav state correctly.
