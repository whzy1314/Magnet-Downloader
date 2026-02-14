// UI Elements
const magnetList = document.getElementById('magnet-list');
const refreshButton = document.getElementById('refresh-links');
const downloadButton = document.getElementById('download-selected');
const saveSettingsButton = document.getElementById('save-settings');
const testConnectionButton = document.getElementById('test-connection');
const statusMessage = document.getElementById('status-message');

// Normalize WebUI URL — strip trailing slash
function apiUrl(baseUrl, path) {
  return baseUrl.replace(/\/+$/, '') + path;
}

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

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    // Remove active class from all buttons and contents
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to clicked button and corresponding content
    button.classList.add('active');
    document.getElementById(`${button.dataset.tab}-tab`).classList.add('active');
  });
});

// Load settings on popup open
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  scanForMagnetLinks();
});

// Settings management
async function loadSettings() {
  const settings = await chrome.storage.sync.get(['webuiUrl', 'username', 'password']);
  document.getElementById('webui-url').value = settings.webuiUrl || '';
  document.getElementById('username').value = settings.username || '';
  document.getElementById('password').value = settings.password || '';
}

saveSettingsButton.addEventListener('click', async () => {
  const settings = {
    webuiUrl: document.getElementById('webui-url').value.trim(),
    username: document.getElementById('username').value.trim(),
    password: document.getElementById('password').value.trim()
  };

  await chrome.storage.sync.set(settings);
  showStatus('Settings saved successfully!', 'success');
});

// Add this new function for authentication
async function authenticateQbittorrent(settings) {
  const response = await fetch(apiUrl(settings.webuiUrl, '/api/v2/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      username: settings.username,
      password: settings.password
    }),
    credentials: 'include',
    mode: 'cors'
  });

  if (!response.ok) {
    throw new Error('Authentication failed');
  }

  const result = await response.text();
  if (result !== 'Ok.') {
    throw new Error('Authentication failed');
  }
}

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

// Update the test connection function
testConnectionButton.addEventListener('click', async () => {
  setButtonLoading(testConnectionButton, true, 'Testing...');
  try {
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
  } catch (error) {
    console.error('Connection error details:', error);
    let errorMessage = error.message;
    if (error.message === 'Failed to fetch') {
      errorMessage = 'Connection failed. Please check:\n' +
        '1. CORS is enabled in qBittorrent\n' +
        '2. The WebUI URL is correct\n' +
        '3. qBittorrent is running and accessible';
    }
    showStatus(`Connection failed: ${errorMessage}`, 'error');
  } finally {
    setButtonLoading(testConnectionButton, false);
  }
});

// Scan for magnet links
async function scanForMagnetLinks() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        const links = Array.from(document.querySelectorAll('a[href^="magnet:"]'));
        return links.map(link => ({
          url: link.href,
          name: link.textContent.trim() || extractNameFromMagnet(link.href) || 'Unnamed torrent'
        }));

        function extractNameFromMagnet(magnetUrl) {
          const match = magnetUrl.match(/dn=([^&]+)/);
          if (match) {
            return decodeURIComponent(match[1].replace(/\+/g, ' '));
          }
          return null;
        }
      }
    });

    const magnetLinks = results[0].result;
    updateMagnetList(magnetLinks);
  } catch (error) {
    showStatus('Error scanning for magnet links', 'error');
  }
}

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

// Refresh magnet links
refreshButton.addEventListener('click', async () => {
  setButtonLoading(refreshButton, true, 'Scanning...');
  try {
    await scanForMagnetLinks();
  } finally {
    setButtonLoading(refreshButton, false);
  }
});

// Update the download function to handle authentication
downloadButton.addEventListener('click', async () => {
  const settings = await chrome.storage.sync.get(['webuiUrl', 'username', 'password']);
  if (!settings.webuiUrl) {
    showStatus('Please configure qBittorrent settings first', 'error');
    return;
  }

  const selectedMagnets = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
    .map(checkbox => checkbox.dataset.url);

  if (selectedMagnets.length === 0) {
    showStatus('Please select at least one magnet link', 'error');
    return;
  }

  setButtonLoading(downloadButton, true, 'Downloading...');

  try {
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

    showStatus(`Successfully added ${selectedMagnets.length} torrent(s) to qBittorrent`, 'success');
  } catch (error) {
    console.error('Download error details:', error);
    showStatus(`Error adding torrents: ${error.message}`, 'error');
  } finally {
    setButtonLoading(downloadButton, false);
  }
});

// Helper function to show status messages
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  setTimeout(() => {
    statusMessage.className = 'status-message';
  }, 5000);
} 