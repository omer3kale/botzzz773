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

// Resolve a service from cache by public_id (displayed in the table)
function getServiceByPublicId(publicId) {
  const cache = window.servicesCache || [];
  // public_id can be string or number; compare as strings
  return cache.find(s => String(s.public_id) === String(publicId));
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
  console.log('[DND] handleServiceReorder triggered');
  console.log('[DND] servicesCache size:', window.servicesCache ? window.servicesCache.length : 'UNDEFINED');
  
  if (isUpdatingSlots) {
    console.log('[DND] Already updating slots, ignoring');
    return;
  }
  
  const rows = Array.from(document.querySelectorAll('#servicesTableBody tr'));
  console.log(`[DND] Found ${rows.length} rows in table`);
  
  const servicesInOrder = [];

    // Extract services in new visual order
    rows.forEach((row, idx) => {
      // Prefer explicit data attribute if available (this is internal DB id)
      const rowAttrId = row.getAttribute('data-service-id');
      const rowPublicId = row.getAttribute('data-public-id');
      if (rowAttrId) {
        const internalId = String(rowAttrId).trim();
        const service = getServiceById(internalId);
        console.log(`[DND] Row ${idx}: Using data-service-id (internal id)=${internalId}`);
        if (service) {
          console.log(`[DND] Row ${idx}: FOUND via internal id ${internalId} (public_id: ${service.public_id}, child_category: ${service.child_category})`);
          servicesInOrder.push(service);
          return;
        } else {
          console.warn(`[DND] Row ${idx}: NOT FOUND via internal id ${internalId}; will try parsing cell text`);
        }
      }

      // If we have a public_id attribute, try that next
      if (rowPublicId) {
        const publicId = String(rowPublicId).trim();
        const service = getServiceByPublicId(publicId);
        console.log(`[DND] Row ${idx}: Using data-public-id=${publicId}`);
        if (service) {
          console.log(`[DND] Row ${idx}: FOUND via public_id ${publicId} (internal id: ${service.id}, child_category: ${service.child_category})`);
          servicesInOrder.push(service);
          return;
        } else {
          console.warn(`[DND] Row ${idx}: NOT FOUND via public_id ${publicId}; will try parsing cell text`);
        }
      }

      // Fallback: parse from the ID cell (may contain public_id and other numbers)
      const serviceIdCell = row.querySelector('td:nth-child(2)');
      const rawTrimmed = (serviceIdCell ? (serviceIdCell.textContent || '') : '').trim();
      const numbers = rawTrimmed.match(/\d+/g) || [];
      // Heuristic: choose likely public_id (>=4 digits) else largest number
      let parsedPublicId = null;
      const longCandidates = numbers.filter(n => n.length >= 4);
      if (longCandidates.length > 0) {
        parsedPublicId = longCandidates[0];
      } else if (numbers.length > 0) {
        parsedPublicId = numbers.sort((a,b) => Number(b) - Number(a))[0];
      }

      console.log(`[DND] Row ${idx}: raw="${rawTrimmed}", numbers=${JSON.stringify(numbers)}, chosenPublicId=${parsedPublicId}`);

      if (parsedPublicId) {
        const service = getServiceByPublicId(parsedPublicId);
        if (service) {
          console.log(`[DND] Row ${idx}: FOUND via public_id ${parsedPublicId} (internal id: ${service.id}, child_category: ${service.child_category})`);
          servicesInOrder.push(service);
        } else {
          console.warn(`[DND] Row ${idx}: NOT FOUND via public_id ${parsedPublicId}`);
        }
      } else {
        console.warn(`[DND] Row ${idx}: Could not parse service ID from "${rawTrimmed}"`);
      }
    });

  console.log(`[DND] Extracted ${servicesInOrder.length} services from table`);

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
    const oldSlot = toNumeric(service.customer_portal_slot);
    
    console.log(`[DND] Service ${service.id}: slot ${oldSlot} → ${newSlot} (category: ${category})`);
    
    reorderedServices.push({
      service,
      newSlot,
      oldSlot
    });
  });

  console.log(`[DND] Total reordered services: ${reorderedServices.length}`);
  console.log('[DND] Showing reordering feedback');

  // Show visual feedback
  showReorderingFeedback();

  // Optional dry-run mode: set window.DND_DRY_RUN = true to skip updates
  if (window.DND_DRY_RUN) {
    console.log('[DND] Dry run enabled: skipping updateServiceSlots');
  } else {
    console.log('[DND] Calling updateServiceSlots');
    // Update slots in database
    await updateServiceSlots(reorderedServices);
    console.log('[DND] updateServiceSlots completed');
  }
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
    const err = 'Authentication token not found';
    console.error('[SLOT-UPDATE] ' + err);
    throw new Error(err);
  }

  console.log(`[SLOT-UPDATE] Updating service ${serviceId} slot to ${newSlot}`);

  const requestBody = {
    serviceId,
    customer_portal_slot: newSlot
  };

  console.log('[SLOT-UPDATE] Request body:', requestBody);

  const response = await fetch('/.netlify/functions/services', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(requestBody)
  });

  console.log(`[SLOT-UPDATE] Response status: ${response.status}`);

  if (!response.ok) {
    let errorMsg = `Failed to update service ${serviceId}: ${response.status} ${response.statusText}`;
    try {
      const error = await response.json();
      console.log('[SLOT-UPDATE] Error response:', error);
      errorMsg = error.error || error.message || errorMsg;
    } catch (parseErr) {
      console.log('[SLOT-UPDATE] Could not parse error response:', parseErr);
    }
    console.error('[SLOT-UPDATE] ' + errorMsg);
    throw new Error(errorMsg);
  }

  const result = await response.json();
  console.log('[SLOT-UPDATE] Success response:', result);
  return result;
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
