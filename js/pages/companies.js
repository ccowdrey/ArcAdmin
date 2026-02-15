// ArcOS Admin — Companies Page
// ==============================

let allCompanies = [];
let selectedCompanyId = null;

const CompaniesPage = {
  async load() {
    setActivePage('pageCompanies');
    setActiveTab('tabCompanies');
    
    try {
      const [companies, profiles, subs, admins] = await Promise.all([
        supa("companies?select=*&order=created_at.desc"),
        supa("profiles?select=id,company_id,first_name,last_name,email"),
        supa("subscriptions?select=user_id,tier,status"),
        supa("company_admins?select=*")
      ]);
      
      allCompanies = companies.map(c => {
        const clients = profiles.filter(p => p.company_id === c.id);
        const clientSubs = clients.map(cl => subs.find(s => s.user_id === cl.id)).filter(Boolean);
        const companyAdmins = admins.filter(a => a.company_id === c.id);
        return { ...c, clients, clientSubs, admins: companyAdmins };
      });
      
      // Stats
      const directUsers = profiles.filter(p => !p.company_id).length;
      const companyClients = profiles.filter(p => p.company_id).length;
      const paidUsers = subs.filter(s => s.status === "active" && s.tier !== "base_camp").length;
      
      document.getElementById("statCompanies").textContent = companies.length;
      document.getElementById("statCompanyClients").textContent = companyClients;
      document.getElementById("statDirectUsers").textContent = directUsers;
      document.getElementById("statTotalPaid").textContent = paidUsers;
      
      this.render(allCompanies);
    } catch (e) {
      console.error("Load companies failed:", e);
    }
  },
  
  render(companies) {
    // Register slugs
    companies.forEach(c => Router.registerSlug(c.id, c.name));
    
    const tbody = document.getElementById("companiesTableBody");
    if (companies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#666;padding:32px">No companies yet</td></tr>`;
      return;
    }
    
    const planColors = { starter: "#8E8D8A", growth: "#E7B400", enterprise: "#2ABC53" };
    
    tbody.innerHTML = companies.map(c => {
      const slug = Router.getSlug(c.id);
      return `<tr onclick="Router.navigate('/companies/${slug}')">
        <td style="font-weight:600;color:#F5F1EB">${escHtml(c.name)}</td>
        <td><span class="tier" style="background:${planColors[c.plan] || '#666'}20;color:${planColors[c.plan] || '#666'}">${c.plan}</span></td>
        <td style="color:#F5F1EB;font-weight:600">${c.clients.length}</td>
        <td style="color:#666">${c.max_clients}</td>
        <td style="color:#2ABC53">${c.monthly_rate ? '$' + Number(c.monthly_rate).toFixed(0) + '/mo' : '—'}</td>
        <td>${c.is_active ? '<span style="color:#2ABC53">Active</span>' : '<span style="color:#FF6565">Inactive</span>'}</td>
        <td style="color:#666;font-size:12px">${timeAgo(c.created_at)}</td>
        <td><span style="color:#E7B400;font-size:12px">View →</span></td>
      </tr>`;
    }).join("");
  }
};

// ── Company Detail ──
const CompanyDetailPage = {
  companyId: null,
  companyName: '',
  clientsData: [],
  
  async load(params) {
    this.companyId = Router.resolveId(params.companyId);
    selectedCompanyId = this.companyId;
    setActivePage('pageCompanyDetail');
    if (Auth.isSuper()) setActiveTab('tabCompanies');
    
    // Ensure we have company data
    if (allCompanies.length === 0) {
      const [companies, profiles, subs, admins] = await Promise.all([
        supa("companies?select=*&order=created_at.desc"),
        supa("profiles?select=id,company_id,first_name,last_name,email,last_login_at,created_at"),
        supa("subscriptions?select=user_id,tier,status"),
        supa("company_admins?select=*")
      ]);
      allCompanies = companies.map(c => {
        const clients = profiles.filter(p => p.company_id === c.id);
        const clientSubs = clients.map(cl => subs.find(s => s.user_id === cl.id)).filter(Boolean);
        const companyAdmins = admins.filter(a => a.company_id === c.id);
        return { ...c, clients, clientSubs, admins: companyAdmins };
      });
    }
    
    const company = allCompanies.find(c => c.id === this.companyId);
    if (!company) { Router.navigate('/companies'); return; }
    this.companyName = company.name;
    
    // Breadcrumb
    const bc = document.getElementById('companyDetailBreadcrumb');
    if (Auth.isSuper()) {
      bc.innerHTML = `<a data-route href="/companies">Companies</a><span class="sep">›</span><span class="current">${escHtml(company.name)}</span>`;
    } else {
      bc.innerHTML = `<span class="current">${escHtml(company.name)}</span>`;
    }
    
    // Header
    document.getElementById("companyName").textContent = company.name;
    const meta = [company.website, company.billing_email].filter(Boolean).join(" · ");
    document.getElementById("companyMeta").textContent = meta || "No details";
    
    const planColors = { starter: "#8E8D8A", growth: "#E7B400", enterprise: "#2ABC53" };
    const badge = document.getElementById("companyPlanBadge");
    badge.textContent = company.plan.toUpperCase();
    badge.style.background = (planColors[company.plan] || "#666") + "20";
    badge.style.color = planColors[company.plan] || "#666";
    
    // Stats
    const free = company.clientSubs.filter(s => s.tier === "base_camp").length;
    const explorer = company.clientSubs.filter(s => s.tier === "explore").length;
    const adventure = company.clientSubs.filter(s => s.tier === "adventurer").length;
    document.getElementById("companyStatClients").textContent = company.clients.length;
    document.getElementById("companyStatFree").textContent = free;
    document.getElementById("companyStatExplorer").textContent = explorer;
    document.getElementById("companyStatAdventure").textContent = adventure;
    
    // Admins
    const adminProfiles = await Promise.all(
      company.admins.map(a => supa(`profiles?id=eq.${a.user_id}&select=*`).then(r => ({ ...r[0], role: a.role, admin_created: a.created_at })))
    );
    
    document.getElementById("companyAdminsBody").innerHTML = adminProfiles.map(a => `<tr>
      <td style="color:#F5F1EB">${escHtml(a?.first_name || '')} ${escHtml(a?.last_name || '')}</td>
      <td style="color:#8E8D8A">${escHtml(a?.email || '—')}</td>
      <td><span class="tier" style="background:${a?.role === 'owner' ? '#E7B400' : '#8E8D8A'}20;color:${a?.role === 'owner' ? '#E7B400' : '#8E8D8A'}">${a?.role || 'admin'}</span></td>
      <td style="color:#666;font-size:12px">${timeAgo(a?.admin_created)}</td>
      <td><button class="btn-secondary" onclick="CompanyDetailPage.removeAdmin('${a?.id}')">Remove</button></td>
    </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:#666;padding:16px">No admins</td></tr>`;
    
    // Clients
    this.clientsData = await Promise.all(
      company.clients.map(async cl => {
        const vehicles = await supa(`vehicles?user_id=eq.${cl.id}&select=*`);
        const sub = company.clientSubs.find(s => s.user_id === cl.id);
        return { ...cl, vehicle: vehicles[0], tier: sub?.tier || 'base_camp' };
      })
    );
    this.renderClients(this.clientsData);
    
    // Invite codes
    await this.loadCodes();
  },
  
  renderClients(clients) {
    // Register slugs for clients
    clients.forEach(cl => {
      const name = `${cl.first_name || ''} ${cl.last_name || ''}`.trim() || cl.email.split('@')[0];
      Router.registerSlug(cl.id, name);
    });
    
    const companySlug = Router.getSlug(selectedCompanyId);
    document.getElementById("companyClientsBody").innerHTML = clients.map(cl => {
      const clientSlug = Router.getSlug(cl.id);
      return `<tr onclick="Router.navigate('/companies/${companySlug}/clients/${clientSlug}')">
        <td style="color:#F5F1EB">${escHtml(cl.first_name || '')} ${escHtml(cl.last_name || '')}</td>
        <td style="color:#8E8D8A">${escHtml(cl.email)}</td>
        <td style="color:#666;font-size:12px">${cl.vehicle ? escHtml(cl.vehicle.make + ' ' + cl.vehicle.model) : '—'}</td>
        <td>${tierBadge(cl.tier)}</td>
        <td style="color:#666;font-size:12px">${timeAgo(cl.last_login_at)}</td>
        <td>
          <select onclick="event.stopPropagation()" onchange="CompanyDetailPage.changeTier('${cl.id}', this.value)" style="background:#242424;border:1px solid #333;border-radius:4px;color:#F5F1EB;font-size:12px;padding:4px 8px;font-family:inherit">
            <option value="base_camp" ${cl.tier === 'base_camp' ? 'selected' : ''}>Base Camp</option>
            <option value="explore" ${cl.tier === 'explore' ? 'selected' : ''}>Explore</option>
            <option value="adventurer" ${cl.tier === 'adventurer' ? 'selected' : ''}>Adventurer</option>
          </select>
        </td>
        <td><button class="btn-delete" onclick="event.stopPropagation();UserDetailPage.userId='${cl.id}';UserDetailPage.userName='${escHtml(cl.first_name || '')}';UserDetailPage.deleteUser()" style="font-size:11px">Delete</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" style="text-align:center;color:#666;padding:16px">No clients</td></tr>`;
  },
  
  filterClients() {
    const q = document.getElementById("clientSearch").value.toLowerCase();
    const filtered = this.clientsData.filter(cl =>
      (cl.first_name || '').toLowerCase().includes(q) ||
      (cl.last_name || '').toLowerCase().includes(q) ||
      (cl.email || '').toLowerCase().includes(q)
    );
    this.renderClients(filtered);
  },
  
  async changeTier(userId, newTier) {
    try {
      await supaPatch(`subscriptions?user_id=eq.${userId}&status=eq.active`, { tier: newTier, managed_by_company: selectedCompanyId });
    } catch (e) {
      alert("Failed to update tier: " + e.message);
    }
  },
  
  async removeAdmin(profileId) {
    if (!confirm("Remove this admin?")) return;
    try {
      await supaDelete(`company_admins?user_id=eq.${profileId}&company_id=eq.${selectedCompanyId}`);
      allCompanies = []; // Force reload
      this.load({ companyId: this.companyId });
    } catch (e) {
      console.error("Remove admin failed:", e);
    }
  },
  
  async loadCodes() {
    try {
      const codes = await supa(`company_codes?company_id=eq.${this.companyId}&select=*&order=created_at.desc`);
      const tbody = document.getElementById("companyCodesBody");
      
      if (codes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#666;padding:16px">No invite codes yet</td></tr>`;
        return;
      }
      
      tbody.innerHTML = codes.map(c => {
        const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
        const isMaxed = c.max_uses && c.current_uses >= c.max_uses;
        const active = c.is_active && !isExpired && !isMaxed;
        const statusColor = active ? "#2ABC53" : "#FF6565";
        const statusText = !c.is_active ? "Disabled" : isExpired ? "Expired" : isMaxed ? "Maxed Out" : "Active";
        
        return `<tr>
          <td><code style="background:#242424;padding:4px 10px;border-radius:4px;color:#E7B400;font-size:13px;font-weight:600;letter-spacing:1px">${escHtml(c.code)}</code></td>
          <td style="color:#8E8D8A">${escHtml(c.label || '—')}</td>
          <td style="color:#F5F1EB;font-weight:600">${c.current_uses}</td>
          <td style="color:#666">${c.max_uses || '∞'}</td>
          <td style="color:#666;font-size:12px">${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}</td>
          <td><span style="color:${statusColor};font-size:12px;font-weight:600">${statusText}</span></td>
          <td>
            ${c.is_active ? `<button class="btn-secondary" onclick="CompanyDetailPage.toggleCode('${c.id}', false)">Disable</button>` : `<button class="btn-secondary" onclick="CompanyDetailPage.toggleCode('${c.id}', true)">Enable</button>`}
          </td>
        </tr>`;
      }).join("");
    } catch (e) {
      console.error("Load codes failed:", e);
    }
  },
  
  async toggleCode(codeId, active) {
    try {
      await supaPatch(`company_codes?id=eq.${codeId}`, { is_active: active });
      await this.loadCodes();
    } catch (e) {
      console.error("Toggle code failed:", e);
    }
  },
  
  showAddCodeModal() {
    const company = allCompanies.find(c => c.id === selectedCompanyId);
    const prefix = company ? company.name.replace(/[^A-Z0-9]/gi, '').substring(0, 8).toUpperCase() : 'ARC';
    document.getElementById("newCodeValue").value = `${prefix}${new Date().getFullYear()}`;
    document.getElementById("newCodeLabel").value = '';
    document.getElementById("newCodeMaxUses").value = '';
    document.getElementById("newCodeExpires").value = '';
    document.getElementById("addCodeError").classList.add("hidden");
    openModal("addCodeModal");
  },
  
  async createCode() {
    const code = document.getElementById("newCodeValue").value.trim().toUpperCase();
    const label = document.getElementById("newCodeLabel").value.trim();
    const maxUses = document.getElementById("newCodeMaxUses").value;
    const expires = document.getElementById("newCodeExpires").value;
    const errEl = document.getElementById("addCodeError");
    
    if (!code || code.length < 3) { errEl.textContent = "Code must be at least 3 characters"; errEl.classList.remove("hidden"); return; }
    
    try {
      await supaPost("company_codes", {
        company_id: selectedCompanyId, code, label: label || null,
        max_uses: maxUses ? parseInt(maxUses) : null,
        expires_at: expires ? new Date(expires + "T23:59:59Z").toISOString() : null,
        is_active: true
      });
      closeModals();
      await this.loadCodes();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
    }
  },
  
  showAddAdminModal() {
    document.getElementById("newAdminEmail").value = "";
    document.getElementById("newAdminName").value = "";
    document.getElementById("addAdminError").classList.add("hidden");
    openModal("addAdminModal");
  },
  
  async addAdmin() {
    const email = document.getElementById("newAdminEmail").value.trim().toLowerCase();
    const name = document.getElementById("newAdminName").value.trim();
    const role = document.getElementById("newAdminRole").value;
    const errEl = document.getElementById("addAdminError");
    errEl.classList.add("hidden");
    
    if (!email) { errEl.textContent = "Email is required"; errEl.classList.remove("hidden"); return; }
    
    try {
      const profiles = await supa(`profiles?email=eq.${encodeURIComponent(email)}&select=id`);
      let userId;
      
      if (profiles.length > 0) {
        userId = profiles[0].id;
      } else {
        const tempPassword = 'ArcOS_' + crypto.randomUUID().slice(0, 12) + '!';
        const data = await supaSignup(email, tempPassword, {
          first_name: name.split(' ')[0] || '',
          last_name: name.split(' ').slice(1).join(' ') || ''
        });
        userId = data.user?.id || data.id;
        if (!userId) throw new Error("Account created but no user ID returned");
        
        await new Promise(r => setTimeout(r, 3000));
        
        const firstName = name.split(' ')[0] || '';
        const lastName = name.split(' ').slice(1).join(' ') || '';
        if (firstName || lastName) {
          await supaPatch(`profiles?id=eq.${userId}`, { first_name: firstName, last_name: lastName });
        }
      }
      
      await supaPatch(`profiles?id=eq.${userId}`, { company_id: selectedCompanyId });
      await supaPost("company_admins", { company_id: selectedCompanyId, user_id: userId, role });
      
      closeModals();
      allCompanies = [];
      this.load({ companyId: this.companyId });
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
    }
  },
  
  showAddCompanyModal() {
    document.getElementById("addCompanyError").classList.add("hidden");
    ['newCompanyName', 'newCompanyAdminName', 'newCompanyAdminEmail', 'newCompanyBillingEmail', 'newCompanyWebsite', 'newCompanyRate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    openModal("addCompanyModal");
  },
  
  async createCompany() {
    const name = document.getElementById("newCompanyName").value.trim();
    const adminEmail = document.getElementById("newCompanyAdminEmail").value.trim();
    const billingEmail = document.getElementById("newCompanyBillingEmail").value.trim();
    const website = document.getElementById("newCompanyWebsite").value.trim();
    const plan = document.getElementById("newCompanyPlan").value;
    const rate = document.getElementById("newCompanyRate").value;
    const errEl = document.getElementById("addCompanyError");
    
    if (!name || !adminEmail) { errEl.textContent = "Company name and admin email are required"; errEl.classList.remove("hidden"); return; }
    
    const maxClients = plan === "starter" ? 10 : plan === "growth" ? 50 : 9999;
    const slug = slugify(name);
    
    try {
      await supaPost("companies", { name, slug, plan, max_clients: maxClients, monthly_rate: rate || null, billing_email: billingEmail || null, website: website || null });
      
      const profiles = await supa(`profiles?email=eq.${encodeURIComponent(adminEmail)}&select=*`);
      if (profiles.length > 0) {
        const newCompanies = await supa(`companies?slug=eq.${slug}&select=id`);
        if (newCompanies[0]) {
          await supaPost("company_admins", { company_id: newCompanies[0].id, user_id: profiles[0].id, role: "owner" });
        }
      }
      
      closeModals();
      allCompanies = [];
      CompaniesPage.load();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
    }
  }
};

window.CompaniesPage = CompaniesPage;
window.CompanyDetailPage = CompanyDetailPage;