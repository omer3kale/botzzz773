# DOM Selector Alignment Report

**Date:** November 15, 2025  
**Scope:** `document.getElementById`, class selectors, and `data-*` attributes across all HTML/CSS/JS under `BOTZZZ773`

## Audit Command

```bash
node tests/dom-selector-audit.js
```

## Results Summary

### ID Coverage

- **Unique IDs defined:** 277
- **Unique IDs referenced via `getElementById`:** 143
- **Missing IDs:** 0 ✅
- **Unused IDs (defined but never retrieved via `getElementById`):** 134 *(typically referenced via `querySelector`/CSS instead)*

### Class Coverage

- **Unique classes defined (HTML + CSS + template strings):** 850
- **Classes referenced by JS (classList/querySelector):** 65
- **Missing classes:** 0 ✅
- **Unused classes (defined but never touched by JS):** 785 *(styling-only is expected)*

All selectors referenced via JavaScript now map to concrete HTML or CSS definitions.

### Data Attribute Coverage

- **Unique `data-*` attributes defined:** 38
- **Attributes referenced by JS:** 28
- **Missing attributes:** 0 ✅
- **Unused attributes (defined but unused in JS):** 10 *(available for future hooks)*

## Notes

1. The audit traverses every `.html` and `.js` file (including admin templates) while ignoring build/system directories.
2. Template literals that inject modal markup (e.g., `#activeModal`) are included because ID definitions inside JS strings are parsed.
3. The “unused IDs” bucket is informational—many of these IDs are accessed through `querySelector`, data attributes, or server-rendered components and do not represent issues.
4. Future audits can be rerun with the same command to ensure DOM consistency whenever new pages or scripts are added.
5. The November 15 remediation added reusable auth button controls, toast styles, admin utility states, and table/overview containers so every JS selector has a matching DOM/CSS hook.
6. When adding new interactive behavior, prefer `data-*` attributes or dedicated utility classes and re-run the audit to confirm coverage.
