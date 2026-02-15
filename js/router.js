// ArcOS Admin — Client-Side Router
// ==================================

const Router = {
  routes: {},
  currentPath: '',
  
  // Register a route handler
  on(path, handler) {
    this.routes[path] = handler;
  },
  
  // Navigate to a path
  navigate(path, pushState = true) {
    if (pushState) {
      window.history.pushState({}, '', path);
    }
    this.currentPath = path;
    this.resolve(path);
    
    // Track page view in GA
    if (window.gtag) {
      gtag('event', 'page_view', { page_path: path });
    }
  },
  
  // Resolve current URL to a route handler
  resolve(path) {
    // Try exact match first
    if (this.routes[path]) {
      this.routes[path]();
      return;
    }
    
    // Try pattern matching
    for (const [pattern, handler] of Object.entries(this.routes)) {
      const params = this.matchRoute(pattern, path);
      if (params) {
        handler(params);
        return;
      }
    }
    
    // 404 fallback
    if (this.routes['/']) {
      this.navigate('/', false);
    }
  },
  
  // Match a route pattern like /companies/:companyId/clients/:clientId
  matchRoute(pattern, path) {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    
    if (patternParts.length !== pathParts.length) return null;
    
    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return params;
  },
  
  // Initialize: listen for popstate and intercept clicks
  init() {
    window.addEventListener('popstate', () => {
      this.resolve(window.location.pathname);
    });
    
    // Intercept link clicks for SPA navigation
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-route]');
      if (link) {
        e.preventDefault();
        this.navigate(link.getAttribute('href'));
      }
    });
    
    // Handle GitHub Pages SPA redirect
    const params = new URLSearchParams(window.location.search);
    const redirectPath = params.get('route');
    if (redirectPath) {
      window.history.replaceState({}, '', redirectPath);
      this.resolve(redirectPath);
    } else {
      // Resolve initial URL
      this.resolve(window.location.pathname);
    }
  }
};

window.Router = Router;