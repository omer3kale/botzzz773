// Admin Services Drag-and-Drop Management
// Enables admins to reorder services via drag-and-drop with real-time sync

let sortableInstance = null;
let draggedRowData = null;
let isUpdatingSlots = false;

/**
 * Convert value to numeric, default to null if invalid
 */
function toNumeric(val) {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

/**
 * Initialize drag-and-drop on services table
 */
function initializeServicesTableDragDrop() {
  const tbody = document.getElementById('servicesTableBody');
  if (!tbody || sortableInstance) return;

  sortableInstance = Sortable.create(tbody, {
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    animation: 150,
    onEnd: handleServiceReorder,
    onMove: handleDragMove,
  });

  // Add drag handles to service rows
  updateServiceRowDragHandles();
}

/**
 * Update drag handles on service rows after table refresh
 */
function updateServiceRowDragHandles() {
  const rows = document.querySelectorAll('#servicesTableBody tr');
  rows.forEach((row) => {
    // Check if drag handle already exists
    const firstCell = row.querySelector('td:first-child');
    if (firstCell && !firstCell.classList.contains('drag-handle-cell')) {
      firstCell.classList.add('drag-handle-cell');
      
      // Add drag handle icon
      const checkbox = firstCell.querySelector('input[type="checkbox"]');
      if (checkbox && !firstCell.querySelector('.drag-handle')) {
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.title = 'Drag to reorder services';
        handle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
        handle.style.cssText = `
          display: inline-block;
          cursor: grab;
          padding: 4px 8px;
          margin-right: 8px;
          color: #64748b;
          font-size: 14px;
        `;
        handle.addEventListener('mousedown', () => {
          handle.style.cursor = 'grabbing';
        });
        handle.addEventListener('mouseup', () => {
          handle.style.cursor = 'grab';
        });
        firstCell.insertBefore(handle, checkbox);
      }
    }
  });
}

/**
 * Handle drag move validation
 */
function handleDragMove(evt) {
  // Prevent drag on checkbox column
  if (evt.related && evt.related.classList && evt.related.classList.contains('drag-handle-cell')) {
    return true;
  }
  return true;
}

/**
 * Handle reorder event from drag-and-drop
 */
async function handleServiceReorder(evt) {
  if (isUpdatingSlots) return;
  
  const rows = Array.from(document.querySelectorAll('#servicesTableBody tr'));
  const servicesInOrder = [];

  // Extract services in new visual order
  rows.forEach((row) => {
    const serviceIdCell = row.querySelector('td:nth-child(2)');
    if (serviceIdCell) {
      const serviceId = serviceIdCell.textContent.trim();
      const service = getServiceById(serviceId);
      if (service) {
        servicesInOrder.push(service);
      }
    }
  });

  // Renumber slots: keep visual order but restart counting per child category
  const reorderedServices = [];
  const categorySlotCounters = {}; // Track slot number per child_category

  servicesInOrder.forEach(service => {
    const category = service.child_category || 'uncategorized';
    
    // Initialize counter for this category if not exists
    if (!categorySlotCounters[category]) {
      categorySlotCounters[category] = 0;
    }
    
    // Increment counter and assign slot
    const newSlot = ++categorySlotCounters[category];
    
    reorderedServices.push({
      service,
      newSlot,
      oldSlot: toNumeric(service.customer_portal_slot)
    });
  });

  // Show visual feedback
  showReorderingFeedback();

  // Update slots in database
  await updateServiceSlots(reorderedServices);
}

/**
 * Update customer_portal_slot for reordered services
 */
async function updateServiceSlots(reorderedServices) {
  isUpdatingSlots = true;
  const updates = [];
  
  try {
    // Only update services where slot actually changed
    const changedServices = reorderedServices.filter(item => item.newSlot !== item.oldSlot);
    
    if (changedServices.length === 0) {
      isUpdatingSlots = false;
      return; // No changes needed
    }

    for (const item of changedServices) {
      updates.push(
        updateServicePortalSlot(item.service.id, item.newSlot)
      );
    }

    const results = await Promise.allSettled(updates);
    
    // Check for failures
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      showNotification(
        `Failed to update ${failed.length} service slot(s). Please try again.`,
        'error'
      );
      // Reload to restore previous state
      setTimeout(() => loadAdminServices(), 1500);
    } else {
      showNotification(
        `Successfully reordered ${changedServices.length} service(s)`,
        'success'
      );
      // Reload to confirm changes persisted
      setTimeout(() => loadAdminServices(), 500);
    }
  } catch (error) {
    console.error('Error updating service slots:', error);
    showNotification('Failed to reorder services. Please try again.', 'error');
    setTimeout(() => loadAdminServices(), 1500);
  } finally {
    isUpdatingSlots = false;
    hideReorderingFeedback();
  }
}

/**
 * Update a single service's customer_portal_slot
 */
async function updateServicePortalSlot(serviceId, newSlot) {
  const token = localStorage.getItem('token');
  
  if (!token) {
    throw new Error('Authentication token not found');
  }

  const response = await fetch('/.netlify/functions/services', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      serviceId,
      customer_portal_slot: newSlot
    })
  });

  if (!response.ok) {
    let errorMsg = `Failed to update service ${serviceId}`;
    try {
      const error = await response.json();
      errorMsg = error.error || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  return response.json();
}

/**
 * Show reordering feedback UI
 */
function showReorderingFeedback() {
  const tbody = document.getElementById('servicesTableBody');
  if (!tbody) return;

  // Add loading class to table
  tbody.style.opacity = '0.6';
  tbody.style.pointerEvents = 'none';

  // Show spinner in header or toast
  if (!document.querySelector('.reorder-spinner')) {
    const spinner = document.createElement('div');
    spinner.className = 'reorder-spinner';
    spinner.style.cssText = `
      position: sticky;
      top: 0;
      z-index: 1000;
      background: rgba(11,13,19,0.85);
      backdrop-filter: blur(4px);
      border-bottom: 1px solid rgba(255,255,255,0.08);
    `;
    spinner.innerHTML = `
      <div style="text-align: center; padding: 10px; color: #fff;">
        <i class="fas fa-spinner fa-spin"></i> Updating order...
      </div>
    `;
    const panel = document.querySelector('.services-table-panel') || document.querySelector('.admin-main');
    if (panel) {
      panel.prepend(spinner);
    } else {
      document.body.appendChild(spinner);
    }
  }
}

/**
 * Hide reordering feedback UI
 */
function hideReorderingFeedback() {
  const tbody = document.getElementById('servicesTableBody');
  if (tbody) {
    tbody.style.opacity = '1';
    tbody.style.pointerEvents = 'auto';
  }

  const spinner = document.querySelector('.reorder-spinner');
  if (spinner) spinner.remove();
}

/**
 * Show notification toast (reuse from admin-services.js if available)
 */
function showNotification(message, type = 'info') {
  // Create a simple toast if one doesn't exist
  let toast = document.querySelector('.admin-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'admin-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 16px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
      max-width: 400px;
    `;
    document.body.appendChild(toast);
  }

  toast.className = `admin-toast admin-toast-${type}`;
  toast.textContent = message;
  
  // Add color based on type
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  
  toast.style.backgroundColor = colors[type] || colors.info;
  toast.style.color = 'white';

  // Auto-hide after 4 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Hook into loadAdminServices to reinitialize DnD after table updates
 */
const originalLoadAdminServices = window.loadAdminServices;
if (originalLoadAdminServices) {
  window.loadAdminServices = async function(...args) {
    const result = await originalLoadAdminServices.apply(this, args);
    // Reinitialize drag-and-drop after services load
    setTimeout(() => {
      if (sortableInstance) sortableInstance.destroy();
      sortableInstance = null;
      initializeServicesTableDragDrop();
    }, 100);
    return result;
  };
}

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initializeServicesTableDragDrop();
  }, 500);
});

// Reinitialize if services table updates
const observer = new MutationObserver(() => {
  if (!sortableInstance) {
    initializeServicesTableDragDrop();
  }
  updateServiceRowDragHandles();
});

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('servicesTableBody');
  if (tbody) {
    observer.observe(tbody, { childList: true });
  }
});
