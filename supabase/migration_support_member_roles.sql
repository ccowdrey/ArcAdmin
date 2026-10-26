-- ArcNode Admin — Company staff roles: Owner / Admin / Support
-- ============================================================
-- Owners and admins live in company_admins; support staff live in
-- support_members (see migration_support_members.sql for why). This adds one
-- RPC the portal calls to add, switch or remove someone, so a switch moves the
-- row between the two tables in a single transaction.
--
-- Who may call it: Arc staff for any company, or an owner/admin of that
-- company (the same people who can already add admins today). Nobody can
-- change their own role, so an admin can't lock themselves out by mistake.
--
-- Run in the Supabase SQL editor after migration_support_member_clients.sql.
-- Re-runnable.
--
-- ROLLBACK: drop function if exists public.set_company_staff_role(uuid, uuid, text);

create or replace function public.set_company_staff_role(
  p_user_id uuid, p_company_id uuid, p_role text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := nullif(lower(trim(coalesce(p_role, ''))), '');
begin
  if not (public.support_is_arc_staff()
          or exists (select 1 from public.company_admins
                     where user_id = auth.uid() and company_id = p_company_id
                       and coalesce(role, 'admin') in ('owner', 'admin'))) then
    raise exception 'Only an owner or admin of this company can change roles'
      using errcode = '42501';
  end if;
  if not public.support_mfa_satisfied() then
    raise exception 'Two-factor sign-in required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own role' using errcode = '42501';
  end if;
  if v_role is not null and v_role not in ('owner', 'admin', 'support') then
    raise exception 'Unknown role %', p_role using errcode = '22023';
  end if;

  if v_role in ('owner', 'admin') then
    delete from public.support_members
     where user_id = p_user_id and company_id = p_company_id;
    update public.company_admins set role = v_role
     where user_id = p_user_id and company_id = p_company_id;
    if not found then
      insert into public.company_admins (user_id, company_id, role)
      values (p_user_id, p_company_id, v_role);
    end if;
  elsif v_role = 'support' then
    if exists (select 1 from public.support_members
               where user_id = p_user_id and company_id <> p_company_id) then
      raise exception 'This person is already support staff for another company'
        using errcode = '23505';
    end if;
    delete from public.company_admins
     where user_id = p_user_id and company_id = p_company_id;
    insert into public.support_members (user_id, company_id)
    values (p_user_id, p_company_id)
    on conflict (user_id) do nothing;
  else
    -- No role: remove them from this company's staff.
    delete from public.company_admins
     where user_id = p_user_id and company_id = p_company_id;
    delete from public.support_members
     where user_id = p_user_id and company_id = p_company_id;
  end if;

  return coalesce(v_role, 'removed');
end;
$$;

revoke all on function public.set_company_staff_role(uuid, uuid, text) from public;
grant execute on function public.set_company_staff_role(uuid, uuid, text) to authenticated;
