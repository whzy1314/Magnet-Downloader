# Magnet Link Manager — Improvements & Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix code quality issues (XSS, session handling, loading states) and add new features (select all, badge, search, categories, copy, dedup, per-torrent status, dark mode).

**Architecture:** Keep existing single-file popup.js/popup.html structure. Add background.js service worker only for badge count. No build tools, no modules — vanilla JS/HTML/CSS.

**Tech Stack:** Chrome Extension Manifest v3, vanilla JS, qBittorrent WebUI API v2

**Note:** This is a Chrome extension with no test framework. Verification is manual: reload extension in `chrome://extensions`, open popup on a page with magnet links, and check behavior. Each task includes specific verification steps.

---

### Task 1: Fix XSS vulnerability — Safe DOM rendering

**Files:**
- Modify: `popup.js:140-158` (the `updateMagnetList` function)

**Context:** Currently `link.name` and `link.url` are injected via `innerHTML` template literals. A malicious magnet link name like `<img src=x onerror=alert(1)>` would execute arbitrary JS. Fix by using `createElement` and `textContent`.

**Step 1: Replace `updateMagnetList` function**

Replace `popup.js` lines 140-158 with:

```js
// Update magnet links list in popup
function updateMagnetList(magnetLinks) {
  magnetList.innerHTML = '';

  if (magnetLinks.length === 0) {
    const item = document.createElement('div');
    item.className = 'magnet-item';
    const p = document.createElement('p');
    p.textContent = 'No magnet links found on this page.';
    item.appendChild(p);
    magnetList.appendChild(item);
    return;
  }

  magnetLinks.forEach((link, index) => {
    const item = document.createElement('div');
    item.className = 'magnet-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `magnet-${index}`;
    checkbox.dataset.url = link.url;

    const label = document.createElement('label');
    label.className = 'magnet-name';
    label.htmlFor = `magnet-${index}`;
    label.title = link.name;
    label.textContent = link.name;

    item.appendChild(checkbox);
    item.appendChild(label);
    magnetList.appendChild(item);
  });
}
```

**Step 2: Verify**

Reload extension in `chrome://extensions`. Open popup on any page with magnet links. Confirm links still display correctly. The XSS vector is now neutralized — `textContent` escapes HTML.

**Step 3: Commit**

```bash
git add popup.js
git commit -m "fix: prevent XSS in magnet list by using createElement instead of innerHTML"
```

---

### Task 2: Add trailing slash normalization and URL helper

**Files:**
- Modify: `popup.js` — add helper function near top, update all fetch calls

**Context:** If user enters `http://localhost:8080/`, API calls become `http://localhost:8080//api/v2/...`. Fix by normalizing the URL.

**Step 1: Add `apiUrl` helper function after the UI Elements section (after line 7)**

```js
// Normalize WebUI URL — strip trailing slash
function apiUrl(baseUrl, path) {
  return baseUrl.replace(/\/+$/, '') + path;
}
```

**Step 2: Replace all `${settings.webuiUrl}/api/v2/...` with `apiUrl(settings.webuiUrl, '/api/v2/...')`**

There are 4 occurrences:
- Line 49: `${settings.webuiUrl}/api/v2/auth/login` → `apiUrl(settings.webuiUrl, '/api/v2/auth/login')`
- Line 84: `${settings.webuiUrl}/api/v2/app/version` → `apiUrl(settings.webuiUrl, '/api/v2/app/version')`
- Line 185: `${settings.webuiUrl}/api/v2/torrents/add` → `apiUrl(settings.webuiUrl, '/api/v2/torrents/add')`
- (The categories endpoint added in Task 10 will also use this)

**Step 3: Verify**

Reload extension. Set WebUI URL to `http://localhost:8080/` (with trailing slash). Test Connection should still work.

**Step 4: Commit**

```bash
git add popup.js
git commit -m "fix: normalize WebUI URL to prevent double-slash in API paths"
```

---

### Task 3: Add session reuse with auto-retry on 403

**Files:**
- Modify: `popup.js` — add `fetchWithAuth` helper, update test connection and download handlers

**Context:** Currently every action re-authenticates. Instead, try the request first and only authenticate on 403.

**Step 1: Add `fetchWithAuth` helper after the `authenticateQbittorrent` function**

```js
// Fetch with automatic auth retry on 403
async function fetchWithAuth(settings, url, options = {}) {
  const fetchOptions = { credentials: 'include', mode: 'cors', ...options };
  let response = await fetch(url, fetchOptions);
  if (response.status === 403) {
    await authenticateQbittorrent(settings);
    response = await fetch(url, fetchOptions);
  }
  return response;
}
```

**Step 2: Update test connection handler (the `testConnectionButton` listener)**

Replace the body of the try block (lines 75-95) with:

```js
    const settings = await chrome.storage.sync.get(['webuiUrl', 'username', 'password']);
    if (!settings.webuiUrl) {
      throw new Error('WebUI URL is required');
    }

    const response = await fetchWithAuth(
      settings,
      apiUrl(settings.webuiUrl, '/api/v2/app/version'),
      { method: 'GET' }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
    }

    const version = await response.text();
    showStatus(`Connected successfully! qBittorrent version: ${version}`, 'success');
```

**Step 3: Update download handler similarly** (handled fully in Task 9 when we rewrite the download flow)

For now, update the download handler's auth section (lines 179-181) to use `fetchWithAuth` for the torrent add call. Replace lines 179-200 with:

```js
    // Authenticate (will be skipped if session is still valid via fetchWithAuth)
    await authenticateQbittorrent(settings);

    for (const magnetUrl of selectedMagnets) {
      const response = await fetchWithAuth(settings, apiUrl(settings.webuiUrl, '/api/v2/torrents/add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ urls: magnetUrl })
      });

      if (!response.ok) {
        throw new Error(`Failed to add torrent: ${response.status} - ${response.statusText}`);
      }
    }
```

**Step 4: Verify**

Reload extension. Test Connection should work. Download should work. Second click should reuse session (no re-auth needed if cookie is still valid).

**Step 5: Commit**

```bash
git add popup.js
git commit -m "feat: add session reuse with auto-retry on 403"
```

---

### Task 4: Add loading states to buttons

**Files:**
- Modify: `popup.js` — wrap async handlers with button disable/enable
- Modify: `popup.html` — add CSS for disabled buttons

**Step 1: Add disabled button CSS in `popup.html` (after the `button.secondary:hover` rule, ~line 66)**

```css
    button:disabled {
      background-color: #B0BEC5;
      cursor: not-allowed;
      opacity: 0.7;
    }
```

**Step 2: Add `setButtonLoading` helper in `popup.js` (after `apiUrl` helper)**

```js
// Set button loading state
function setButtonLoading(button, loading, loadingText) {
  button.disabled = loading;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText || 'Loading...';
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
  }
}
```

**Step 3: Wrap the test connection handler**

At the start of the `testConnectionButton` click handler (inside the try, before anything else):
```js
    setButtonLoading(testConnectionButton, true, 'Testing...');
```

Add a `finally` block:
```js
  } finally {
    setButtonLoading(testConnectionButton, false);
  }
```

**Step 4: Wrap the download handler similarly**

At the start of the `downloadButton` click handler, after the validation checks but before the try:
```js
  setButtonLoading(downloadButton, true, 'Downloading...');
```

Add a `finally` block:
```js
  } finally {
    setButtonLoading(downloadButton, false);
  }
```

**Step 5: Wrap the refresh handler**

Change the refresh button click handler to:
```js
refreshButton.addEventListener('click', async () => {
  setButtonLoading(refreshButton, true, 'Scanning...');
  try {
    await scanForMagnetLinks();
  } finally {
    setButtonLoading(refreshButton, false);
  }
});
```

**Step 6: Verify**

Reload extension. Click Test Connection — button should show "Testing..." and be grayed out. Click Download — should show "Downloading...". Click Refresh — should show "Scanning...".

**Step 7: Commit**

```bash
git add popup.js popup.html
git commit -m "feat: add loading states to buttons during async operations"
```

---

### Task 5: Add duplicate detection by info hash

**Files:**
- Modify: `popup.js` — update `scanForMagnetLinks` to deduplicate

**Context:** Same torrent can appear multiple times on a page with different link text. Extract the `xt=urn:btih:HASH` from each magnet URL and deduplicate by hash.

**Step 1: Update the content script inside `scanForMagnetLinks`**

Replace the content script function (the `function()` inside `executeScript`, lines 116-130) with:

```js
      function: () => {
        const links = Array.from(document.querySelectorAll('a[href^="magnet:"]'));
        const seen = new Set();
        const unique = [];

        for (const link of links) {
          const hashMatch = link.href.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
          const hash = hashMatch ? hashMatch[1].toLowerCase() : link.href;

          if (!seen.has(hash)) {
            seen.add(hash);
            unique.push({
              url: link.href,
              name: link.textContent.trim() || extractNameFromMagnet(link.href) || 'Unnamed torrent'
            });
          }
        }

        return unique;

        function extractNameFromMagnet(magnetUrl) {
          const match = magnetUrl.match(/dn=([^&]+)/);
          if (match) {
            return decodeURIComponent(match[1].replace(/\+/g, ' '));
          }
          return null;
        }
      }
```

**Step 2: Verify**

Reload extension. Test on a page with duplicate magnet links — each torrent should appear only once.

**Step 3: Commit**

```bash
git add popup.js
git commit -m "feat: deduplicate magnet links by info hash"
```

---

### Task 6: Add Select All / Deselect All checkbox

**Files:**
- Modify: `popup.html` — add select-all checkbox above the list
- Modify: `popup.js` — add select-all logic, update `updateMagnetList`
- Modify: `popup.html` — add CSS for select-all row

**Step 1: Add HTML for select-all row in `popup.html`**

Insert after the `<h3>Available Magnet Links</h3>` line (line 157) and before the `<div id="magnet-list"` line (line 158):

```html
          <div id="select-all-row" class="magnet-item select-all-row" style="display: none;">
            <input type="checkbox" id="select-all">
            <label for="select-all" class="magnet-name" style="font-weight: 600;">Select All</label>
          </div>
```

**Step 2: Add CSS for select-all row in `popup.html`**

After the `.magnet-item input[type="checkbox"]` rule (~line 86):

```css
    .select-all-row {
      border-bottom: 2px solid #ccc;
      background-color: #eee;
    }
```

**Step 3: Add JS logic in `popup.js`**

Add after the UI Elements section (line 7), add a new reference:

```js
const selectAllCheckbox = document.getElementById('select-all');
const selectAllRow = document.getElementById('select-all-row');
```

Add select-all event listener (after the tab switching code, ~line 20):

```js
// Select All / Deselect All
selectAllCheckbox.addEventListener('change', () => {
  const visibleCheckboxes = magnetList.querySelectorAll('.magnet-item:not([style*="display: none"]) input[type="checkbox"]');
  visibleCheckboxes.forEach(cb => { cb.checked = selectAllCheckbox.checked; });
});
```

**Step 4: Update `updateMagnetList` to show/hide select-all and sync state**

At the end of the `updateMagnetList` function, after appending all items, add:

```js
  // Show select-all row when there are links
  selectAllRow.style.display = magnetLinks.length > 0 ? 'flex' : 'none';
  selectAllCheckbox.checked = false;

  // Sync select-all when individual checkboxes change
  magnetList.addEventListener('change', () => {
    const checkboxes = magnetList.querySelectorAll('input[type="checkbox"]');
    const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
    const someChecked = Array.from(checkboxes).some(cb => cb.checked);
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  });
```

**Step 5: Update the download handler's checkbox selector**

In the download handler, change the selector to exclude the select-all checkbox:

```js
  const selectedMagnets = Array.from(magnetList.querySelectorAll('input[type="checkbox"]:checked'))
    .map(checkbox => checkbox.dataset.url)
    .filter(Boolean);
```

(This uses `magnetList.querySelectorAll` instead of `document.querySelectorAll` and filters out the select-all which has no `data-url`.)

**Step 6: Verify**

Reload extension. Open popup on a page with magnet links. "Select All" checkbox should appear. Checking it selects all items. Unchecking one item should make the header indeterminate.

**Step 7: Commit**

```bash
git add popup.js popup.html
git commit -m "feat: add Select All / Deselect All checkbox"
```

---

### Task 7: Add search/filter input

**Files:**
- Modify: `popup.html` — add search input
- Modify: `popup.js` — add filter logic

**Step 1: Add search input in `popup.html`**

Insert after the select-all-row div and before the `<div id="magnet-list"` div:

```html
          <input type="text" id="search-filter" placeholder="Filter magnet links..." style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; display: none;">
```

**Step 2: Add JS references and filter logic in `popup.js`**

Add reference after the select-all references:

```js
const searchFilter = document.getElementById('search-filter');
```

Add filter event listener:

```js
// Search/filter magnet links
searchFilter.addEventListener('input', () => {
  const query = searchFilter.value.toLowerCase();
  const items = magnetList.querySelectorAll('.magnet-item');
  items.forEach(item => {
    const label = item.querySelector('.magnet-name');
    if (label) {
      item.style.display = label.textContent.toLowerCase().includes(query) ? 'flex' : 'none';
    }
  });
});
```

**Step 3: Show/hide search input in `updateMagnetList`**

Add at the end of the function (alongside the select-all visibility logic):

```js
  searchFilter.style.display = magnetLinks.length > 0 ? 'block' : 'none';
  searchFilter.value = '';
```

**Step 4: Verify**

Reload extension. Open popup on a page with magnet links. Search input should appear. Typing filters the list in real-time. Select All should only affect visible items.

**Step 5: Commit**

```bash
git add popup.js popup.html
git commit -m "feat: add search/filter input for magnet links"
```

---

### Task 8: Add copy magnet URL button

**Files:**
- Modify: `popup.js` — add copy button to each magnet item in `updateMagnetList`
- Modify: `popup.html` — add CSS for copy button

**Step 1: Add CSS in `popup.html`**

After the `.magnet-name` rule (~line 93):

```css
    .copy-btn {
      background: none;
      border: none;
      padding: 4px 8px;
      cursor: pointer;
      color: #757575;
      font-size: 12px;
      flex-shrink: 0;
      min-width: auto;
    }

    .copy-btn:hover {
      color: #2196F3;
      background: none;
    }
```

**Step 2: Update `updateMagnetList` in `popup.js` to add a copy button per item**

Inside the `magnetLinks.forEach` loop, after creating the label element and before `item.appendChild(label)`, add:

```js
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy magnet URL';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(link.url);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
```

And append it after the label:

```js
    item.appendChild(checkbox);
    item.appendChild(label);
    item.appendChild(copyBtn);
    magnetList.appendChild(item);
```

**Step 3: Verify**

Reload extension. Each magnet link should have a "Copy" button. Clicking it copies the URL and briefly shows "Copied!".

**Step 4: Commit**

```bash
git add popup.js popup.html
git commit -m "feat: add copy-to-clipboard button for each magnet link"
```

---

### Task 9: Parallel downloads with per-torrent status feedback

**Files:**
- Modify: `popup.js` — rewrite download handler to use `Promise.allSettled`
- Modify: `popup.html` — add CSS for status indicators

**Step 1: Add CSS for status indicators in `popup.html`**

After the `.copy-btn:hover` rule:

```css
    .magnet-item .status-icon {
      flex-shrink: 0;
      margin-left: 4px;
      font-size: 14px;
    }

    .magnet-item .status-icon.success {
      color: #2E7D32;
    }

    .magnet-item .status-icon.fail {
      color: #C62828;
    }
```

**Step 2: Rewrite the download button click handler in `popup.js`**

Replace the entire `downloadButton.addEventListener('click', ...)` block with:

```js
downloadButton.addEventListener('click', async () => {
  const settings = await chrome.storage.sync.get(['webuiUrl', 'username', 'password']);
  if (!settings.webuiUrl) {
    showStatus('Please configure qBittorrent settings first', 'error');
    return;
  }

  const selectedCheckboxes = Array.from(magnetList.querySelectorAll('input[type="checkbox"]:checked'))
    .filter(cb => cb.dataset.url);

  if (selectedCheckboxes.length === 0) {
    showStatus('Please select at least one magnet link', 'error');
    return;
  }

  setButtonLoading(downloadButton, true, 'Downloading...');

  try {
    await authenticateQbittorrent(settings);

    const category = document.getElementById('category-select')?.value || '';

    const results = await Promise.allSettled(
      selectedCheckboxes.map(async (checkbox) => {
        const params = { urls: checkbox.dataset.url };
        if (category) params.category = category;

        const response = await fetchWithAuth(settings, apiUrl(settings.webuiUrl, '/api/v2/torrents/add'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params)
        });

        if (!response.ok) {
          throw new Error(`${response.status}`);
        }

        return checkbox;
      })
    );

    // Show per-torrent status
    let successCount = 0;
    let failCount = 0;

    results.forEach((result, i) => {
      const checkbox = selectedCheckboxes[i];
      const item = checkbox.closest('.magnet-item');

      // Remove existing status icons
      const existing = item.querySelector('.status-icon');
      if (existing) existing.remove();

      const icon = document.createElement('span');
      icon.className = 'status-icon';

      if (result.status === 'fulfilled') {
        icon.classList.add('success');
        icon.textContent = '\u2713';
        successCount++;
      } else {
        icon.classList.add('fail');
        icon.textContent = '\u2717';
        failCount++;
      }

      item.appendChild(icon);
    });

    if (failCount === 0) {
      showStatus(`Successfully added ${successCount} torrent(s)`, 'success');
    } else {
      showStatus(`Added ${successCount}, failed ${failCount} torrent(s)`, 'error');
    }
  } catch (error) {
    console.error('Download error details:', error);
    showStatus(`Error adding torrents: ${error.message}`, 'error');
  } finally {
    setButtonLoading(downloadButton, false);
  }
});
```

**Step 3: Verify**

Reload extension. Select multiple magnets. Download — each should show a green checkmark or red X. Status message should summarize results.

**Step 4: Commit**

```bash
git add popup.js popup.html
git commit -m "feat: parallel downloads with per-torrent status indicators"
```

---

### Task 10: Add category picker

**Files:**
- Modify: `popup.html` — add category dropdown
- Modify: `popup.js` — fetch categories on popup open, populate dropdown

**Step 1: Add category dropdown HTML in `popup.html`**

Insert after the search filter input and before the `<div id="magnet-list"` div:

```html
          <div id="category-row" style="display: none; margin-bottom: 8px;">
            <label for="category-select" style="display: inline; margin-right: 8px;">Category:</label>
            <select id="category-select" style="padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;">
              <option value="">No category</option>
            </select>
          </div>
```

**Step 2: Add JS to fetch categories in `popup.js`**

Add a new function after `loadSettings`:

```js
// Load qBittorrent categories
async function loadCategories() {
  try {
    const settings = await chrome.storage.sync.get(['webuiUrl', 'username', 'password']);
    if (!settings.webuiUrl) return;

    const response = await fetchWithAuth(
      settings,
      apiUrl(settings.webuiUrl, '/api/v2/torrents/categories'),
      { method: 'GET' }
    );

    if (!response.ok) return;

    const categories = await response.json();
    const select = document.getElementById('category-select');
    const categoryRow = document.getElementById('category-row');

    // Clear existing options (keep "No category")
    select.innerHTML = '<option value="">No category</option>';

    for (const name of Object.keys(categories).sort()) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }

    categoryRow.style.display = Object.keys(categories).length > 0 ? 'flex' : 'none';
  } catch (e) {
    // Silently fail — categories are optional
  }
}
```

**Step 3: Call `loadCategories()` in the DOMContentLoaded handler**

Add after `scanForMagnetLinks()`:

```js
  loadCategories();
```

**Step 4: Verify**

Reload extension. If qBittorrent has categories configured, the dropdown should appear. Selecting a category before downloading should tag the torrents. (The download handler in Task 9 already reads `category-select`.)

**Step 5: Commit**

```bash
git add popup.js popup.html
git commit -m "feat: add category picker from qBittorrent"
```

---

### Task 11: Add badge count via background service worker

**Files:**
- Create: `background.js`
- Modify: `manifest.json` — add background service worker

**Step 1: Update `manifest.json`**

Add the `background` key after the `host_permissions` array:

```json
  "background": {
    "service_worker": "background.js"
  },
```

Also add `"tabs"` to the permissions array (needed to listen for tab events):

```json
  "permissions": [
    "activeTab",
    "storage",
    "scripting",
    "tabs"
  ],
```

**Step 2: Create `background.js`**

```js
// Count magnet links on the active tab and set badge
async function updateBadge(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      function: () => document.querySelectorAll('a[href^="magnet:"]').length
    });

    const count = results[0]?.result || 0;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#2196F3', tabId });
  } catch (e) {
    // Cannot inject into chrome:// or restricted pages — clear badge
    await chrome.action.setBadgeText({ text: '', tabId });
  }
}

// Update badge when tab is activated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  updateBadge(activeInfo.tabId);
});

// Update badge when page finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    updateBadge(tabId);
  }
});
```

**Step 3: Verify**

Reload extension in `chrome://extensions`. Navigate to a page with magnet links. The extension icon should show a blue badge with the count. Navigate to a page without magnets — badge should disappear.

**Step 4: Commit**

```bash
git add background.js manifest.json
git commit -m "feat: add badge count showing magnet links on active tab"
```

---

### Task 12: Add dark mode CSS

**Files:**
- Modify: `popup.html` — add `@media (prefers-color-scheme: dark)` block

**Step 1: Add dark mode CSS at the end of the `<style>` block (before `</style>`)**

```css
    @media (prefers-color-scheme: dark) {
      body {
        background-color: #1e1e1e;
        color: #e0e0e0;
      }

      .settings-panel, .links-panel {
        background: #2d2d2d;
      }

      input[type="text"],
      input[type="password"],
      input[type="url"],
      #search-filter {
        background-color: #3a3a3a;
        border-color: #555;
        color: #e0e0e0;
      }

      select {
        background-color: #3a3a3a;
        border-color: #555;
        color: #e0e0e0;
      }

      .magnet-item {
        border-bottom-color: #444;
      }

      .select-all-row {
        background-color: #333;
        border-bottom-color: #555;
      }

      .tab-button {
        color: #aaa;
      }

      .tab-button.active {
        color: #64B5F6;
        border-bottom-color: #64B5F6;
      }

      label {
        color: #e0e0e0;
      }

      h3 {
        color: #e0e0e0;
      }

      .copy-btn {
        color: #aaa;
      }

      .copy-btn:hover {
        color: #64B5F6;
      }

      .status-message.success {
        background-color: #1B5E20;
        color: #A5D6A7;
      }

      .status-message.error {
        background-color: #B71C1C;
        color: #EF9A9A;
      }
    }
```

**Step 2: Verify**

Reload extension. Set system appearance to dark mode (System Preferences → Appearance → Dark on macOS). Open popup — should have dark backgrounds, light text, adjusted accent colors.

**Step 3: Commit**

```bash
git add popup.html
git commit -m "feat: add dark mode support via prefers-color-scheme"
```

---

### Task 13: Final cleanup and version bump

**Files:**
- Modify: `manifest.json` — bump version to 1.1

**Step 1: Update version in `manifest.json`**

Change `"version": "1.0"` to `"version": "1.1"`.

**Step 2: Full manual verification**

Reload extension. Verify all features work together:
- [ ] Magnet links detected and displayed (no XSS)
- [ ] Badge count shown on extension icon
- [ ] Select All / Deselect All works
- [ ] Search filter works (Select All respects filter)
- [ ] Copy button works
- [ ] Duplicate links are deduplicated
- [ ] Category picker loads (if qBittorrent has categories)
- [ ] Download adds torrents with per-torrent status icons
- [ ] Loading states on all buttons
- [ ] Test Connection works with trailing slash URL
- [ ] Dark mode renders correctly
- [ ] Settings persist across popup close/reopen

**Step 3: Commit**

```bash
git add manifest.json
git commit -m "chore: bump version to 1.1 for improvements and new features"
```
