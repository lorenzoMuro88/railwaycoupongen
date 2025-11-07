// Global Navigation Functions

// Compute tenant base from current path: '/t/{slug}' or ''
window.__tenantBase = (function() {
    try {
        const parts = window.location.pathname.split('/').filter(Boolean);
        if (parts[0] === 't' && parts[1]) return '/t/' + parts[1];
        return '';
    } catch (_) { return ''; }
})();

// Load tenant information and update navigation and theme
async function loadTenantInfo() {
    try {
        const base = window.__tenantBase;
        const requests = [];
        if (base) {
            requests.push(fetch(`${base}/api/tenant-info`));
            requests.push(fetch(`${base}/api/brand-settings`));
        } else {
            // Legacy routes (no /t/:slug): skip tenant-info, but fetch brand via admin endpoint
            requests.push(Promise.resolve(null));
            requests.push(fetch(`/api/admin/brand-settings`));
        }
        const [infoResp, brandRespFirst] = await Promise.all(requests);

        if (infoResp && infoResp.ok) {
            const tenantInfo = await infoResp.json();
            const brandElement = document.getElementById('tenantBrand');
            if (brandElement && tenantInfo.name) brandElement.textContent = `${tenantInfo.name} Admin`;
        }

        let brandResp = brandRespFirst;
        // Fallback: if legacy admin endpoint fails (403), try store endpoint
        if (!base && brandResp && !brandResp.ok) {
            try { brandResp = await fetch(`/api/store/brand-settings`); } catch (_) {}
        }
        if (brandResp && brandResp.ok) {
            const theme = await brandResp.json();
            if (theme && Object.keys(theme).length > 0) {
                const root = document.documentElement;
                if (theme.primary_color) root.style.setProperty('--primary-green', theme.primary_color);
                if (theme.accent_color) root.style.setProperty('--accent-green', theme.accent_color);
                if (theme.light_color) root.style.setProperty('--light-green', theme.light_color);
                if (theme.background_color) root.style.setProperty('--cream', theme.background_color);
                if (theme.text_dark_color) root.style.setProperty('--text-dark', theme.text_dark_color);
                // Update gradient based on primary/accent
                if (theme.primary_color || theme.accent_color) {
                    const p = theme.primary_color || getComputedStyle(root).getPropertyValue('--primary-green').trim();
                    const a = theme.accent_color || getComputedStyle(root).getPropertyValue('--accent-green').trim();
                    root.style.setProperty('--gradient-primary', `linear-gradient(135deg, ${p} 0%, ${a} 100%)`);
                }
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

// CSRF token handling: fetch once and attach to mutating fetch requests
window.__csrfToken = null;

async function ensureCsrfToken() {
    if (window.__csrfToken) return window.__csrfToken;
    const base = window.__tenantBase || '';
    try {
        const r = await fetch(base + '/api/csrf-token', { credentials: 'same-origin' });
        if (r.ok) {
            const j = await r.json();
            window.__csrfToken = j.csrfToken || null;
        }
    } catch (_) {}
    return window.__csrfToken;
}

const originalFetch = window.fetch.bind(window);
window.fetch = async function(input, init = {}) {
    try {
        const method = (init && init.method ? String(init.method) : 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
            const token = await ensureCsrfToken();
            init.headers = Object.assign({}, init.headers, token ? { 'X-CSRF-Token': token } : {});
            init.credentials = init.credentials || 'same-origin';
        }
    } catch (_) {}
    return originalFetch(input, init);
};

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
