// ArcOS Admin — Client-Side Router
// ==================================

const Router = {
  routes: {},
  currentPath: '',
  basePath: '/ArcAdmin',
  
  // Slug maps: id→slug and slug→id
  slugMap: {},
  idMap: {},
  
  on(path, handler) {
    this.routes[path] = handler;
  },
  
  registerSlug(id, name) {
    const slug = this.slugify(name);
    this.slugMap[id] = slug;
    this.idMap[slug] = id;
  },
  
  slugify(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  },
  
  resolveId(slugOrId) {
    return this.idMap[slugOrId] || slugOrId;
  },
  
  getSlug(id) {
    return this.slugMap[id] || id;
  },
  
  navigate(path, pushState = true) {
    if (pushState) {
      window.history.pushState({}, '', this.basePath + path);
    }
    this.currentPath = path;
    this.resolve(path);
    if (window.gtag) gtag('event', 'page_view', { page_path: path });
  },
  
  resolve(path) {
    if (this.routes[path]) { this.routes[path](); return; }
    for (const [pattern, handler] of Object.entries(this.routes)) {
      const params = this.matchRoute(pattern, path);
      if (params) { handler(params); return; }
    }
    if (this.routes['/']) this.navigate('/', false);
  },
  
  matchRoute(pattern, path) {
    const pp = pattern.split('/'), pa = path.split('/');
    if (pp.length !== pa.length) return null;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(pa[i]);
      else if (pp[i] !== pa[i]) return null;
    }
    return params;
  },
  
  stripBase(fullPath) {
    if (fullPath.startsWith(this.basePath)) {
      return fullPath.slice(this.basePath.length) || '/';
    }
    return fullPath || '/';
  },
  
  init() {
    window.addEventListener('popstate', () => {
      this.resolve(this.stripBase(window.location.pathname));
    });
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-route]');
      if (link) { e.preventDefault(); this.navigate(link.getAttribute('href')); }
    });
    const urlParams = new URLSearchParams(window.location.search);
    const redirectPath = urlParams.get('route');
    if (redirectPath) {
      const clean = this.stripBase(redirectPath);
      window.history.replaceState({}, '', this.basePath + clean);
      this.resolve(clean);
    } else {
      this.resolve(this.stripBase(window.location.pathname));
    }
  }
};

window.Router = Router;