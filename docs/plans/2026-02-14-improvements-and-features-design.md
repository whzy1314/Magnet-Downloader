# Magnet Link Manager — Improvements & Features Design

## Overview

Enhance the Chrome extension with code quality fixes and new features while keeping the current single-file architecture. Add a background service worker only for badge count.

## Files Changed

- `popup.js` — All code fixes + feature logic
- `popup.html` — New UI elements (search, select all, category picker, copy buttons, dark mode CSS)
- `manifest.json` — Add `background` service worker declaration
- `background.js` — New file for badge count

## Code Fixes

### 1. XSS Prevention
Replace `innerHTML` with `createElement`/`textContent` in `updateMagnetList()`. No user-controlled strings injected as HTML.

### 2. Parallel Downloads with Per-Torrent Status
Replace sequential `for` loop with `Promise.allSettled()`. Each torrent is sent in parallel. Results are mapped back to the UI — green checkmark for fulfilled, red X for rejected.

### 3. Trailing Slash Normalization
Strip trailing `/` from `webuiUrl` before constructing API paths to prevent double-slash issues.

### 4. Loading States
Disable buttons and change text during async operations (scan, download, test connection). Re-enable on completion.

### 5. Session Reuse
Attempt API calls first. If 403, authenticate and retry. Avoids redundant logins when session cookie is still valid.

## New Features

### 1. Select All / Deselect All
Checkbox at top of magnet list. Toggles all visible (filtered) items. Individual unchecks update the header checkbox to unchecked/indeterminate.

### 2. Badge Count
`background.js` service worker listens to `chrome.tabs.onActivated` and `chrome.tabs.onUpdated` (status: "complete"). Injects content script to count `a[href^="magnet:"]` elements. Sets `chrome.action.setBadgeText` (empty string if 0).

### 3. Search/Filter
Text input above magnet list. Filters items in real-time by name (case-insensitive substring). Select All only affects visible items.

### 4. Category Picker
Dropdown populated by `/api/v2/torrents/categories` on popup open (if settings configured). Defaults to "No category". Selected category included in torrent add request as `category` parameter.

### 5. Copy Magnet URL
Copy button next to each magnet item. Uses `navigator.clipboard.writeText()`. Shows brief "Copied!" tooltip feedback.

### 6. Duplicate Detection
Extract info hash from `xt=urn:btih:HASH` in magnet URL. Deduplicate by hash — same torrent from multiple links shown once.

### 7. Per-Torrent Status Feedback
After download attempt, each selected item shows inline green checkmark or red X, replacing the checkbox.

### 8. Dark Mode
`@media (prefers-color-scheme: dark)` CSS block with dark backgrounds (#1e1e1e, #2d2d2d), light text (#e0e0e0), and adjusted accent colors.

## Architecture

```
popup.html + popup.js    — UI, settings, scanning, downloading, all features
background.js            — Badge count only (service worker)
manifest.json            — Declares background service worker
```

No ES modules, no build tools. Stays vanilla JS/HTML/CSS.
