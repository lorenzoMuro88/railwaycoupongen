// Global Navigation Functions

// Compute tenant base from current path: '/t/{slug}' or ''
window.__tenantBase = (function() {
    try {
        const parts = window.location.pathname.split('/').filter(Boolean);
        if (parts[0] === 't' && parts[1]) return '/t/' + parts[1];
        return '';
    } catch (_) { return ''; }
})();

// Load tenant information and update navigation
async function loadTenantInfo() {
    try {
        const base = window.__tenantBase;
        if (!base) return; // Not in tenant context
        
        const response = await fetch(`${base}/api/tenant-info`);
        if (response.ok) {
            const tenantInfo = await response.json();
            const brandElement = document.getElementById('tenantBrand');
            if (brandElement && tenantInfo.name) {
                brandElement.textContent = `${tenantInfo.name} Admin`;
            }
        }
    } catch (error) {
        console.error('Error loading tenant info:', error);
    }
}

function navigateTo(path) {
    const base = window.__tenantBase || '';
    window.location.href = base + path;
}

// Load tenant info when DOM is ready
document.addEventListener('DOMContentLoaded', loadTenantInfo);

// Sidebar functions
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.querySelector('.hamburger-btn');
    
    if (sidebar && overlay && hamburger) {
        sidebar.classList.toggle('show');
        overlay.classList.toggle('show');
        hamburger.classList.toggle('active');
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.querySelector('.hamburger-btn');
    
    if (sidebar && overlay && hamburger) {
        sidebar.classList.remove('show');
        overlay.classList.remove('show');
        hamburger.classList.remove('active');
    }
}

// Logout function
async function logout() {
    try {
        const base = window.__tenantBase || '';
        const response = await fetch(base + '/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            window.location.href = '/access';
        } else {
            console.error('Logout failed');
            // Force redirect anyway
            window.location.href = '/access';
        }
    } catch (error) {
        console.error('Logout error:', error);
        // Force redirect anyway
        window.location.href = '/access';
    }
}

// Close sidebar on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeSidebar();
    }
});

// Close sidebar when clicking outside
document.addEventListener('click', function(e) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    if (e.target === overlay && overlay.classList.contains('show')) {
        closeSidebar();
    }
});
