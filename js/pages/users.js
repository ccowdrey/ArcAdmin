// ArcOS Admin — Users Page
// ==========================

const UsersPage = {
  allUsers: [],
  
  async load() {
    setActivePage('pageUsers');
    setActiveTab('tabUsers');
    
    try {
      const users = await supa('profiles?select=*&order=created_at.desc');
      const subs = await supa('subscriptions?select=user_id,tier,status');
      const subMap = {};
      subs.forEach(s => { subMap[s.user_id] = s; });
      
      this.allUsers = users.map(u => ({ ...u, tier: subMap[u.id]?.tier || 'base_camp' }));
      
      // Stats
      document.getElementById('statTotalUsers').textContent = users.length;
      document.getElementById('statActiveUsers').textContent = users.filter(u => {
        const lastLogin = new Date(u.last_login_at || 0);
        return (Date.now() - lastLogin.getTime()) < 7 * 86400000;
      }).length;
      document.getElementById('statPaidUsers').textContent = subs.filter(s => s.tier !== 'base_camp' && s.status === 'active').length;
      
      this.render(this.allUsers);
    } catch (e) {
      console.error('Failed to load users:', e);
    }
  },
  
  render(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = users.map(u => `
      <tr onclick="Router.navigate('/users/${u.id}')">
        <td>
          <div class="user-name">${escHtml(u.first_name || '')} ${escHtml(u.last_name || '')}</div>
          <div class="user-email">${escHtml(u.email)}</div>
        </td>
        <td>${tierBadge(u.tier)}</td>
        <td class="text-muted">${formatDate(u.created_at)}</td>
        <td class="text-muted">${timeAgo(u.last_login_at)}</td>
        <td class="text-dim">${u.company_id ? '✓' : '—'}</td>
      </tr>
    `).join('');
  },
  
  filter(query) {
    const q = query.toLowerCase();
    const filtered = this.allUsers.filter(u =>
      (u.first_name || '').toLowerCase().includes(q) ||
      (u.last_name || '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
    this.render(filtered);
  }
};

window.UsersPage = UsersPage;
