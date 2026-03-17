// ArcOS Admin — Users Page
// ==========================

const UsersPage = {
  allUsers: [],
  allAdmins: [],

  async load() {
    setActivePage('pageUsers');
    setActiveTab('tabUsers');

    try {
      const [users, subs, companyAdmins, companies, vehicles] = await Promise.all([
        supa('profiles?select=*&order=created_at.desc'),
        supa('subscriptions?select=user_id,tier,status'),
        supa('company_admins?select=user_id,company_id,role'),
        supa('companies?select=id,name'),
        supa('vehicles?select=user_id')
      ]);

      const subMap = {};
      subs.forEach(s => { subMap[s.user_id] = s; });

      const companyMap = {};
      companies.forEach(c => { companyMap[c.id] = c.name; });

      // Set of all company admin user IDs and users with vehicles
      const adminUserIds = new Set(companyAdmins.map(a => a.user_id));
      const vehicleUserIds = new Set(vehicles.map(v => v.user_id));

      const enriched = users.map(u => {
        const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email.split('@')[0];
        Router.registerSlug(u.id, name);
        return { ...u, tier: subMap[u.id]?.tier || 'base_camp' };
      });

      // Admin-only = in company_admins AND no vehicle AND not super admin
      // If they have a vehicle, they're a real user who also happens to be an admin
      this.allUsers = enriched.filter(u => !adminUserIds.has(u.id) || vehicleUserIds.has(u.id) || u.is_admin);
      this.allAdmins = enriched
        .filter(u => adminUserIds.has(u.id) && !vehicleUserIds.has(u.id) && !u.is_admin)
        .map(u => {
          const adminEntry = companyAdmins.find(a => a.user_id === u.id);
          return {
            ...u,
            adminRole: adminEntry?.role || 'admin',
            adminCompanyId: adminEntry?.company_id,
            adminCompanyName: companyMap[adminEntry?.company_id] || '—'
          };
        });

      // Stats — based on real users only
      document.getElementById('statTotalUsers').textContent = this.allUsers.length;
      document.getElementById('statActiveUsers').textContent = this.allUsers.filter(u => {
        const lastLogin = new Date(u.last_login_at || 0);
        return (Date.now() - lastLogin.getTime()) < 7 * 86400000;
      }).length;
      document.getElementById('statPaidUsers').textContent = subs.filter(s => s.tier !== 'base_camp' && s.status === 'active').length;
      document.getElementById('statAdmins').textContent = this.allAdmins.length;

      this.render(this.allUsers);
      this.renderAdmins(this.allAdmins);
    } catch (e) {
      console.error('Failed to load users:', e);
    }
  },

  render(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = users.map(u => {
      const slug = Router.getSlug(u.id);
      return `<tr onclick="Router.navigate('/users/${slug}')">
        <td>
          <div class="user-name">${escHtml(u.first_name || '')} ${escHtml(u.last_name || '')}</div>
          <div class="user-email">${escHtml(u.email)}</div>
        </td>
        <td>${tierBadge(u.tier)}</td>
        <td class="text-muted">${formatDate(u.created_at)}</td>
        <td class="text-muted">${timeAgo(u.last_login_at)}</td>
        <td class="text-dim">${u.company_id ? '✓' : '—'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:#666;padding:32px">No users</td></tr>';
  },

  renderAdmins(admins) {
    const tbody = document.getElementById('adminsTableBody');
    if (!tbody) return;
    tbody.innerHTML = admins.map(u => {
      const slug = Router.getSlug(u.id);
      const roleColor = u.adminRole === 'owner' ? '#767DFB' : '#8E8D8A';
      return `<tr onclick="Router.navigate('/users/${slug}')">
        <td>
          <div class="user-name">${escHtml(u.first_name || '')} ${escHtml(u.last_name || '')}</div>
          <div class="user-email">${escHtml(u.email)}</div>
        </td>
        <td><span class="tier" style="background:${roleColor}20;color:${roleColor}">${u.adminRole}</span></td>
        <td style="color:#F5F1EB">${escHtml(u.adminCompanyName)}</td>
        <td class="text-muted">${formatDate(u.created_at)}</td>
        <td class="text-muted">${timeAgo(u.last_login_at)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:#666;padding:32px">No admins yet</td></tr>';
  },

  filter(query) {
    const q = query.toLowerCase();
    const filtered = this.allUsers.filter(u =>
      (u.first_name || '').toLowerCase().includes(q) ||
      (u.last_name || '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
    this.render(filtered);
  },

  filterAdmins(query) {
    const q = query.toLowerCase();
    const filtered = this.allAdmins.filter(u =>
      (u.first_name || '').toLowerCase().includes(q) ||
      (u.last_name || '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.adminCompanyName.toLowerCase().includes(q)
    );
    this.renderAdmins(filtered);
  }
};

  showTab(tab) {
    const isUsers = tab === 'users';
    document.getElementById('usersPanel').style.display = isUsers ? '' : 'none';
    document.getElementById('adminsPanel').style.display = isUsers ? 'none' : '';
    document.getElementById('subTabUsers').classList.toggle('active', isUsers);
    document.getElementById('subTabAdmins').classList.toggle('active', !isUsers);
  }
};

window.UsersPage = UsersPage;