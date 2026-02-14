# Magnet-Downloader

A Chrome extension to list and manage magnet links for qBittorrent.

## Features

- Automatically detect and list all magnet links on the current page
- Deduplicate magnet links by info hash
- Select All / Deselect All with a single checkbox
- Search and filter magnet links by name
- Copy individual magnet URLs to clipboard
- Send selected magnet links to qBittorrent for download
- Parallel downloads with per-torrent success/failure status
- Choose a qBittorrent category before downloading
- Badge count on the extension icon showing how many magnet links are on the page
- Smart session reuse — only re-authenticates when needed
- Dark mode support (follows system theme)

## Installation

1. Clone the repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked"
5. Select the folder where you cloned the repository

## Usage

1. Navigate to a page with magnet links
2. Click the extension icon — the badge shows how many magnets were found
3. Use the search bar to filter links, or Select All to grab everything
4. Optionally pick a qBittorrent category from the dropdown
5. Click "Download Selected" to add torrents to qBittorrent
6. Each torrent shows a checkmark or X indicating success or failure

## Settings

Go to the **Settings** tab in the popup to configure:

- **WebUI URL** — your qBittorrent WebUI address (e.g. `http://localhost:8080`)
- **Username** / **Password** — your qBittorrent credentials
- **Test Connection** — verify connectivity and see the qBittorrent version

## Troubleshooting

- If you get a 403 error when connecting to qBittorrent, add the following custom headers in qBittorrent (Options > WebUI > Security > Custom HTTP headers):
  - `Access-Control-Allow-Origin: chrome-extension://*`
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: Authorization, Content-Type, Accept`
  - `Access-Control-Allow-Credentials: true`
