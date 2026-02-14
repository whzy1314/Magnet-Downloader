# Torrent Search via Jackett — Design

## Overview

Add a "Search" tab to the Chrome extension that lets users search for torrents via a self-hosted Jackett instance and download selected results to qBittorrent.

## Architecture

- New "Search" tab in popup.html alongside existing "Magnet Links" and "Settings" tabs
- Jackett API integration via `GET /api/v2.0/indexers/all/results?apikey=KEY&Query=TERM`
- Results rendered as checkbox list (same pattern as magnet links)
- Download reuses existing qBittorrent auth + torrent add logic

## UI — Search Tab

- Search input + Search button
- Results list (scrollable, max-height 400px for more space)
- Each result row: checkbox, name (truncated), size, seeders/leechers, tracker badge
- Copy button per result (copies magnet URL)
- "Download Selected" button at bottom

## UI — Settings Tab (additions)

- Jackett URL field (e.g., http://localhost:9117)
- Jackett API Key field
- Stored in chrome.storage.sync

## Jackett API

- Endpoint: `GET /api/v2.0/indexers/all/results`
- Params: `apikey`, `Query`
- Response fields used: Title, Size, Seeders, Peers, MagnetUri, Tracker
- Results sorted by seeders descending
- Filter out results without MagnetUri

## Files Changed

- `popup.html` — New Search tab HTML + CSS for result rows, seeder/leecher badges, tracker labels
- `popup.js` — Search function, Jackett settings load/save, results rendering, download handler for search results
- `manifest.json` — No changes needed (host_permissions already allow all URLs)

## Shared Logic

The download handler for search results reuses:
- `authenticateQbittorrent()` for auth
- `fetchWithAuth()` for session management
- `apiUrl()` for URL normalization
- `setButtonLoading()` for button states
- Category picker selection
