// PWA Registration and Installation Handler
// Add this script to all pages to enable PWA functionality

(function() {
  'use strict';

  // Check if service workers are supported
  if ('serviceWorker' in navigator) {
    // Register service worker when page loads
    window.addEventListener('load', () => {
      registerServiceWorker();
      checkForUpdates();
    });
  }

  async function registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/'
      });

      console.log('[PWA] Service Worker registered successfully:', registration.scope);

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('[PWA] New service worker installing...');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker available, show update notification
            showUpdateNotification();
          }
        });
      });

      // Handle service worker updates
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] Service worker updated, reloading page...');
        window.location.reload();
      });

    } catch (error) {
      console.error('[PWA] Service Worker registration failed:', error);
    }
  }

  function checkForUpdates() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        registration.update();
      });
    }
  }

  function showUpdateNotification() {
    // Check if notification already exists
    if (document.getElementById('pwa-update-notification')) {
      return;
    }

    const notification = document.createElement('div');
    notification.id = 'pwa-update-notification';
    notification.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #05060a;
        border: 1px solid #ff1494;
        border-radius: 12px;
        padding: 20px;
        max-width: 350px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
      ">
        <div style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 8px;">
          🚀 Update Available
        </div>
        <div style="color: rgba(255,255,255,0.7); font-size: 14px; margin-bottom: 16px;">
          A new version is available. Reload to get the latest features.
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="this.closest('#pwa-update-notification').remove()" style="
            flex: 1;
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: #fff;
            padding: 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          ">
            Later
          </button>
          <button onclick="window.location.reload()" style="
            flex: 1;
            background: #ff1494;
            border: none;
            color: #fff;
            padding: 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          ">
            Reload
          </button>
        </div>
      </div>
      <style>
        @keyframes slideIn {
          from {
            transform: translateY(100px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      </style>
    `;

    document.body.appendChild(notification);
  }

  // Install prompt handling
  let deferredPrompt;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    
    // Store the event for later use
    deferredPrompt = e;
    
    // Show custom install button/banner
    showInstallPromotion();
  });

  function showInstallPromotion() {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    // Check if promotion was already shown recently
    const lastShown = localStorage.getItem('pwa-install-prompt-shown');
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    if (lastShown && (now - parseInt(lastShown)) < dayInMs) {
      return;
    }

    // Create install banner
    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #ff1494 0%, #e0127f 100%);
        border-radius: 12px;
        padding: 16px 24px;
        max-width: 400px;
        width: calc(100% - 40px);
        box-shadow: 0 8px 24px rgba(255, 20, 148, 0.4);
        z-index: 10000;
        animation: slideUp 0.3s ease-out;
      ">
        <div style="display: flex; align-items: center; gap: 16px;">
          <div style="font-size: 32px;">📱</div>
          <div style="flex: 1;">
            <div style="color: #fff; font-weight: 600; margin-bottom: 4px;">
              Install BOTZZZ773
            </div>
            <div style="color: rgba(255,255,255,0.9); font-size: 13px;">
              Add to home screen for quick access
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button onclick="dismissInstallPrompt()" style="
              background: rgba(255,255,255,0.2);
              border: none;
              color: #fff;
              padding: 8px 16px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 13px;
            ">
              ✕
            </button>
            <button onclick="installPWA()" style="
              background: #fff;
              border: none;
              color: #ff1494;
              padding: 8px 16px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 13px;
              font-weight: 600;
            ">
              Install
            </button>
          </div>
        </div>
      </div>
      <style>
        @keyframes slideUp {
          from {
            transform: translate(-50%, 100px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
      </style>
    `;

    document.body.appendChild(banner);
    localStorage.setItem('pwa-install-prompt-shown', now.toString());
  }

  // Connectivity + background sync notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const payload = event.data || {};
      if (payload.type === 'REQUEST_QUEUED') {
        showPWAToast('You are offline. We queued your request and will sync automatically.', 'warning');
      }
      if (payload.type === 'REQUEST_SYNCED') {
        showPWAToast('Queued request synced successfully.', 'success');
      }
    });
  }

  window.addEventListener('online', () => showPWAToast('Back online — syncing any pending actions.', 'success'));
  window.addEventListener('offline', () => showPWAToast('Offline mode enabled. Actions will be queued.', 'warning'));

  function showPWAToast(message, variant = 'info') {
    if (!message) {
      return;
    }

    const containerId = 'pwa-toast-container';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.style.position = 'fixed';
      container.style.bottom = '20px';
      container.style.left = '50%';
      container.style.transform = 'translateX(-50%)';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '12px';
      container.style.zIndex = '10001';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.padding = '14px 20px';
    toast.style.borderRadius = '10px';
    toast.style.minWidth = '260px';
    toast.style.maxWidth = '420px';
    toast.style.boxShadow = '0 12px 24px rgba(0, 0, 0, 0.3)';
    toast.style.color = '#fff';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '500';
    toast.style.background = variant === 'success'
      ? 'linear-gradient(135deg, #00c48c, #00a57a)'
      : variant === 'warning'
        ? 'linear-gradient(135deg, #ffb347, #ffcc33)'
        : 'linear-gradient(135deg, #2b2f3a, #1f222a)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => {
        toast.remove();
        if (!container.childElementCount) {
          container.remove();
        }
      }, 200);
    }, 4000);
  }

  window.dismissInstallPrompt = function() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.remove();
    }
  };

  window.installPWA = async function() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.remove();
    }

    if (!deferredPrompt) {
      console.log('[PWA] Install prompt not available');
      return;
    }

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user's response
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] User response: ${outcome}`);

    // Clear the deferred prompt
    deferredPrompt = null;
  };

  // Detect if app is running as PWA
  window.addEventListener('DOMContentLoaded', () => {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                  window.navigator.standalone === true;

    if (isPWA) {
      console.log('[PWA] Running as installed app');
      document.body.classList.add('pwa-mode');
    }
  });

  // Handle online/offline status
  window.addEventListener('online', () => {
    console.log('[PWA] Back online');
    showConnectionStatus('online');
  });

  window.addEventListener('offline', () => {
    console.log('[PWA] Gone offline');
    showConnectionStatus('offline');
  });

  function showConnectionStatus(status) {
    const existing = document.getElementById('pwa-connection-status');
    if (existing) {
      existing.remove();
    }

    const statusBar = document.createElement('div');
    statusBar.id = 'pwa-connection-status';
    statusBar.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: ${status === 'online' ? '#10b981' : '#ef4444'};
        color: #fff;
        text-align: center;
        padding: 8px;
        font-size: 14px;
        z-index: 10001;
        animation: slideDown 0.3s ease-out;
      ">
        ${status === 'online' ? '✓ Back online' : '⚠ You are offline'}
      </div>
      <style>
        @keyframes slideDown {
          from {
            transform: translateY(-100%);
          }
          to {
            transform: translateY(0);
          }
        }
      </style>
    `;

    document.body.appendChild(statusBar);

    setTimeout(() => {
      statusBar.remove();
    }, 3000);
  }

})();
