// ArcOS Admin — Authentication
// ==============================

const Auth = {
  async login(email, password) {
    const data = await supaLogin(email, password);
    token = data.access_token;
    
    // Determine role
    const userId = data.user.id;
    
    // Check super admin
    const profile = await supa(`profiles?id=eq.${userId}&select=is_admin,email`);
    if (profile[0]?.is_admin) {
      userRole = 'super_admin';
      this.setupSuperAdmin(email);
      return;
    }
    
    // Check company admin
    const ca = await supa(`company_admins?user_id=eq.${userId}&select=company_id,role`);
    if (ca.length > 0) {
      userRole = 'company_admin';
      userCompanyId = ca[0].company_id;
      
      const companies = await supa(`companies?id=eq.${userCompanyId}&select=name`);
      userCompanyName = companies[0]?.name || 'Company';
      
      this.setupCompanyAdmin(email, userCompanyName);
      return;
    }
    
    throw new Error("Access denied. You must be an admin to use this dashboard.");
  },
  
  setupSuperAdmin(email) {
    document.getElementById('navBrandLabel').textContent = 'Admin';
    document.getElementById('navEmail').textContent = email;
    show('tabUsers');
    show('tabCompanies');
    show('navTabs');
    hide('loginPage');
    show('appShell');
    Router.navigate('/users');
  },
  
  setupCompanyAdmin(email, companyName) {
    Router.registerSlug(userCompanyId, companyName);
    document.getElementById('navBrandLabel').textContent = companyName;
    document.getElementById('navEmail').textContent = email;
    hide('tabUsers');
    hide('tabCompanies');
    hide('navTabs');
    hide('loginPage');
    show('appShell');
    Router.navigate(`/companies/${Router.getSlug(userCompanyId)}`);
  },
  
  signout() {
    token = null;
    userRole = null;
    userCompanyId = null;
    userCompanyName = null;
    hide('appShell');
    show('loginPage');
    document.getElementById('loginError').classList.add('hidden');
    Router.navigate('/login', false);
  },
  
  isSuper() { return userRole === 'super_admin'; },
  isCompanyAdmin() { return userRole === 'company_admin'; }
};

window.Auth = Auth;