// Global Navigation Functions

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
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            window.location.href = '/login';
        } else {
            console.error('Logout failed');
            // Force redirect anyway
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Logout error:', error);
        // Force redirect anyway
        window.location.href = '/login';
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
