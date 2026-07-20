import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit2,
  FolderTree,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  User,
  UserRoundCheck,
  X,
} from 'lucide-react';

import api, { LONG_TIMEOUT } from '../../services/api';
import { useAuthStore, type User as UserType } from '../../stores/authStore';

type DirectoryDepartment = {
  id: string;
  parent_id: string | null;
  name: string;
  path?: string;
  scope_path?: string;
  order?: number;
};

type DirectoryResponse = {
  users: UserType[];
  departments: DirectoryDepartment[];
  last_synced_at?: string | null;
  sync_available: boolean;
};

type CreateUserForm = {
  name: string;
  username: string;
  password: string;
  department_id: string;
};

type EditUserForm = {
  name: string;
  department_id: string;
  is_active: boolean;
};

const EMPTY_CREATE_FORM: CreateUserForm = {
  name: '',
  username: '',
  password: '',
  department_id: '',
};

const normalize = (value?: string | null) => (value || '').trim().toLocaleLowerCase('zh-CN');

const getDepartmentScopePath = (department?: DirectoryDepartment) => {
  if (!department) return undefined;
  if (department.scope_path) return department.scope_path;
  const fullPath = department.path || department.name;
  const parts = fullPath.split('/').filter(Boolean);
  return department.parent_id && parts.length > 1 ? parts.slice(1).join('/') : fullPath;
};

const userMatches = (user: UserType, query: string) => {
  const needle = normalize(query);
  if (!needle) return true;
  return [
    user.name,
    user.username,
    user.email,
    user.department_name,
    user.full_department_path,
  ].some((value) => normalize(value).includes(needle));
};

const buildFallbackDepartments = (users: UserType[]): DirectoryDepartment[] => {
  const departments = new Map<string, DirectoryDepartment>();
  users.forEach((user) => {
    const path = user.full_department_path || user.department_name || '未分配部门';
    const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
    let parentId: string | null = null;
    const pathParts: string[] = [];
    parts.forEach((part, index) => {
      pathParts.push(part);
      const id = `fallback:${pathParts.join('/')}`;
      if (!departments.has(id)) {
        departments.set(id, {
          id,
          parent_id: parentId,
          name: part,
          path: pathParts.join('/'),
          order: index,
        });
      }
      parentId = id;
    });
  });
  return Array.from(departments.values());
};

const roleLabel = (user: UserType) => {
  if (user.is_super_admin) return '超级管理员';
  if (user.is_admin) return '管理员';
  return '普通用户';
};

const formatSyncTime = (value?: string | null) => {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '同步时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const UsersManage = () => {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<UserType[]>([]);
  const [departments, setDepartments] = useState<DirectoryDepartment[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncAvailable, setSyncAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<string>>(new Set());
  const [roleUpdatingId, setRoleUpdatingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<UserType | null>(null);
  const [editForm, setEditForm] = useState<EditUserForm>({ name: '', department_id: '', is_active: true });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const applyDirectory = (payload: DirectoryResponse) => {
    const nextDepartments = payload.departments || [];
    setUsers(payload.users || []);
    setDepartments(nextDepartments);
    setLastSyncedAt(payload.last_synced_at || null);
    setSyncAvailable(!!payload.sync_available);
    if (nextDepartments.length) {
      setExpandedDepartmentIds(
        new Set(nextDepartments.filter((department) => !department.parent_id).map((department) => String(department.id))),
      );
    }
  };

  const fetchDirectory = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<DirectoryResponse>('/admin/users/directory');
      applyDirectory(response.data);

      if ((response.data.departments || []).length === 0 && response.data.sync_available) {
        setSyncing(true);
        try {
          const syncResponse = await api.post<DirectoryResponse>('/admin/users/sync-dingtalk', undefined, {
            timeout: LONG_TIMEOUT,
          });
          applyDirectory(syncResponse.data);
          setNotice(`已从钉钉同步 ${syncResponse.data.users?.length || 0} 位成员`);
        } catch (syncError: any) {
          setNotice(syncError?.response?.data?.detail || '钉钉通讯录暂时无法同步，当前显示本地用户数据');
        } finally {
          setSyncing(false);
        }
      }
    } catch (fetchError: any) {
      setError(fetchError?.response?.data?.detail || '用户目录加载失败');
      setUsers([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDirectory();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<DirectoryResponse>('/admin/users/sync-dingtalk', undefined, {
        timeout: LONG_TIMEOUT,
      });
      applyDirectory(response.data);
      setNotice(`同步完成：${response.data.departments?.length || 0} 个部门，${response.data.users?.length || 0} 位成员`);
    } catch (syncError: any) {
      setError(syncError?.response?.data?.detail || '钉钉通讯录同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const effectiveDepartments = useMemo(
    () => (departments.length ? departments : buildFallbackDepartments(users)),
    [departments, users],
  );

  const departmentMap = useMemo(
    () => new Map(effectiveDepartments.map((department) => [String(department.id), department])),
    [effectiveDepartments],
  );

  const childrenByParent = useMemo(() => {
    const result = new Map<string | null, DirectoryDepartment[]>();
    effectiveDepartments.forEach((department) => {
      const parentId = department.parent_id ? String(department.parent_id) : null;
      const children = result.get(parentId) || [];
      children.push(department);
      result.set(parentId, children);
    });
    result.forEach((children) => {
      children.sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'zh-CN'));
    });
    return result;
  }, [effectiveDepartments]);

  const resolveUserDepartmentId = (user: UserType) => {
    const directId = user.department_id ? String(user.department_id) : '';
    if (directId && departmentMap.has(directId)) return directId;
    const fullPath = normalize(user.full_department_path);
    const departmentName = normalize(user.department_name);
    const matched = effectiveDepartments.find((department) => {
      const path = normalize(department.path);
      return (fullPath && (path === fullPath || path.endsWith(`/${fullPath}`))) || normalize(department.name) === departmentName;
    });
    return matched?.id ? String(matched.id) : null;
  };

  const admins = useMemo(
    () => users.filter((user) => (user.is_admin || user.is_super_admin) && userMatches(user, query)),
    [query, users],
  );

  const regularUsers = useMemo(() => users.filter((user) => !user.is_admin && !user.is_super_admin), [users]);

  const usersByDepartment = useMemo(() => {
    const result = new Map<string, UserType[]>();
    regularUsers.forEach((user) => {
      const departmentId = resolveUserDepartmentId(user);
      if (!departmentId) return;
      const department = departmentMap.get(departmentId);
      const includeUser = userMatches(user, query) || (!!query && normalize(department?.path || department?.name).includes(normalize(query)));
      if (!includeUser) return;
      const members = result.get(departmentId) || [];
      members.push(user);
      result.set(departmentId, members);
    });
    result.forEach((members) => members.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
    return result;
  }, [departmentMap, effectiveDepartments, query, regularUsers]);

  const unassignedUsers = useMemo(
    () => regularUsers.filter((user) => !resolveUserDepartmentId(user) && userMatches(user, query)),
    [departmentMap, effectiveDepartments, query, regularUsers],
  );

  const visibleDepartmentIds = useMemo(() => {
    if (!query) return new Set(effectiveDepartments.map((department) => String(department.id)));
    const visible = new Set<string>();
    effectiveDepartments.forEach((department) => {
      const id = String(department.id);
      if ((usersByDepartment.get(id)?.length || 0) > 0 || normalize(department.path || department.name).includes(normalize(query))) {
        let current: DirectoryDepartment | undefined = department;
        while (current) {
          visible.add(String(current.id));
          current = current.parent_id ? departmentMap.get(String(current.parent_id)) : undefined;
        }
      }
    });
    return visible;
  }, [departmentMap, effectiveDepartments, query, usersByDepartment]);

  useEffect(() => {
    if (!effectiveDepartments.length || expandedDepartmentIds.size) return;
    const rootIds = effectiveDepartments
      .filter((department) => !department.parent_id)
      .map((department) => String(department.id));
    const firstLevelIds = rootIds.flatMap((rootId) => (childrenByParent.get(rootId) || []).map((item) => String(item.id)));
    setExpandedDepartmentIds(new Set([...rootIds, ...firstLevelIds]));
  }, [childrenByParent, effectiveDepartments, expandedDepartmentIds.size]);

  const toggleDepartment = (departmentId: string) => {
    setExpandedDepartmentIds((current) => {
      const next = new Set(current);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next;
    });
  };

  const handleUpdateRole = async (target: UserType, makeAdmin: boolean) => {
    if (!currentUser?.is_super_admin || target.is_super_admin || currentUser.id === target.id) return;
    setRoleUpdatingId(target.id);
    setError(null);
    try {
      await api.put(`/admin/users/${target.id}/role`, { is_admin: makeAdmin, is_super_admin: false });
      await fetchDirectory();
    } catch (roleError: any) {
      setError(roleError?.response?.data?.detail || '角色更新失败');
    } finally {
      setRoleUpdatingId(null);
    }
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const selectedDepartment = createForm.department_id
        ? departmentMap.get(createForm.department_id)
        : undefined;
      const fullDepartmentPath = getDepartmentScopePath(selectedDepartment);
      const pathParts = (fullDepartmentPath || '').split('/').filter(Boolean);
      const rootDepartmentName = pathParts[0];
      await api.post('/admin/users', {
        name: createForm.name,
        username: createForm.username,
        password: createForm.password,
        department_id: selectedDepartment?.id.startsWith('fallback:') ? undefined : selectedDepartment?.id,
        department_name: selectedDepartment?.name,
        full_department_path: fullDepartmentPath,
        root_department_name: rootDepartmentName,
      });
      setShowCreateModal(false);
      setCreateForm(EMPTY_CREATE_FORM);
      await fetchDirectory();
    } catch (createError: any) {
      setError(createError?.response?.data?.detail || '用户创建失败');
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (target: UserType) => {
    const resolvedDepartmentId = resolveUserDepartmentId(target);
    setEditTarget(target);
    setEditForm({
      name: target.name,
      department_id: resolvedDepartmentId || '',
      is_active: target.is_active,
    });
  };

  const handleSaveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    setError(null);
    try {
      const selectedDepartment = editForm.department_id ? departmentMap.get(editForm.department_id) : undefined;
      const fullDepartmentPath = getDepartmentScopePath(selectedDepartment);
      const pathParts = (fullDepartmentPath || '').split('/').filter(Boolean);
      await api.put(`/admin/users/${editTarget.id}`, {
        name: editForm.name,
        is_active: editForm.is_active,
        department_id: selectedDepartment?.id.startsWith('fallback:') ? null : selectedDepartment?.id || null,
        department_name: selectedDepartment?.name || null,
        full_department_path: fullDepartmentPath || null,
        root_department_name: pathParts[0] || null,
      });
      setEditTarget(null);
      await fetchDirectory();
    } catch (editError: any) {
      setError(editError?.response?.data?.detail || '用户信息更新失败');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/admin/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      await fetchDirectory();
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail || '删除用户失败');
    } finally {
      setDeleting(false);
    }
  };

  const renderUserActions = (target: UserType) => {
    const canManage = !!currentUser?.is_super_admin && currentUser.id !== target.id && !target.is_super_admin;
    return (
      <div className="flex shrink-0 items-center gap-1">
        {canManage ? (
          <button
            type="button"
            onClick={() => void handleUpdateRole(target, !target.is_admin)}
            disabled={roleUpdatingId === target.id}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition disabled:opacity-50 ${
              target.is_admin
                ? 'bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
                : 'bg-indigo-400/10 text-indigo-300 hover:bg-indigo-400/20'
            }`}
          >
            {target.is_admin ? <User className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
            {roleUpdatingId === target.id ? '处理中' : target.is_admin ? '降为用户' : '任命管理员'}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`编辑 ${target.name}`}
          onClick={() => openEdit(target)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-700 hover:text-white"
        >
          <Edit2 className="h-4 w-4" />
        </button>
        {canManage ? (
          <button
            type="button"
            aria-label={`删除 ${target.name}`}
            onClick={() => setDeleteTarget(target)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-400/10 hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  };

  const renderDepartment = (department: DirectoryDepartment, depth = 0): ReactNode => {
    const departmentId = String(department.id);
    if (!visibleDepartmentIds.has(departmentId)) return null;
    const children = (childrenByParent.get(departmentId) || []).filter((child) => visibleDepartmentIds.has(String(child.id)));
    const members = usersByDepartment.get(departmentId) || [];
    const expanded = !!query || expandedDepartmentIds.has(departmentId);
    const hasContent = children.length > 0 || members.length > 0;

    return (
      <div key={departmentId} className={depth ? 'ml-5 border-l border-slate-700/80 pl-3' : ''}>
        <button
          type="button"
          onClick={() => hasContent && toggleDepartment(departmentId)}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-800/80"
        >
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${depth === 0 ? 'bg-indigo-500/15 text-indigo-300' : 'bg-slate-700/70 text-slate-300'}`}>
            {hasContent ? (
              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
            ) : (
              <Building2 className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-200 group-hover:text-white">{department.name}</span>
            {depth === 0 && department.path ? <span className="mt-0.5 block truncate text-xs text-slate-500">{department.path}</span> : null}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">{members.length}</span>
        </button>

        {expanded ? (
          <div className="pb-1">
            {members.map((member) => (
              <div
                key={member.id}
                className="ml-10 flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition hover:border-slate-700 hover:bg-slate-800/60"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-sm font-semibold text-white">
                  {member.avatar ? <img src={member.avatar} alt="" className="h-full w-full object-cover" /> : member.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-200">{member.name}</div>
                  <div className="truncate text-xs text-slate-500">{member.username || member.email || '未绑定企业邮箱'}</div>
                </div>
                <span className={`hidden items-center gap-1 rounded-full px-2 py-1 text-[11px] sm:inline-flex ${member.is_active ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${member.is_active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  {member.is_active ? '启用' : '停用'}
                </span>
                {renderUserActions(member)}
              </div>
            ))}
            {children.map((child) => renderDepartment(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/60">
        <RefreshCw className="mr-3 h-5 w-5 animate-spin text-indigo-400" />
        <span className="text-sm text-slate-400">正在加载组织通讯录...</span>
      </div>
    );
  }

  const rootDepartments = (childrenByParent.get(null) || []).filter((department) => visibleDepartmentIds.has(String(department.id)));
  const visibleCount = admins.length + Array.from(usersByDepartment.values()).reduce((sum, members) => sum + members.length, 0) + unassignedUsers.length;

  return (
    <div className="pb-10">
      <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
            <FolderTree className="h-4 w-4" />
            Organization Directory
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">用户与部门</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">管理员固定在顶部，其他成员按钉钉部门层级归档。角色任命只对超级管理员开放。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={!syncAvailable || syncing}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同步中...' : '同步钉钉'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-400"
          >
            <Plus className="h-4 w-4" />
            新增本地用户
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-800/60 px-4 py-3">
          <div className="text-xs text-slate-500">组织成员</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{users.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-800/60 px-4 py-3">
          <div className="text-xs text-slate-500">部门节点</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{effectiveDepartments.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-800/60 px-4 py-3">
          <div className="text-xs text-slate-500">钉钉同步</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-200">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            {formatSyncTime(lastSyncedAt)}
          </div>
        </div>
      </div>

      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索姓名、邮箱或部门路径"
          className="h-12 w-full rounded-2xl border border-slate-700 bg-slate-800/80 pl-11 pr-12 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
        />
        {query ? (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-700 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {error ? <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {notice ? <div className="mb-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">{notice}</div> : null}

      {admins.length ? (
        <section className="mb-6 overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-slate-800/80 to-slate-900">
          <div className="flex items-center justify-between border-b border-indigo-400/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-400/15 text-indigo-300">
                <UserRoundCheck className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-white">管理员 · 已置顶</h2>
                <p className="mt-0.5 text-xs text-slate-500">超级管理员与部门管理员始终优先展示</p>
              </div>
            </div>
            <span className="rounded-full bg-indigo-400/10 px-2.5 py-1 text-xs font-medium text-indigo-200">{admins.length} 人</span>
          </div>
          <div className="grid gap-px bg-slate-700/40 md:grid-cols-2">
            {admins.map((admin) => (
              <div key={admin.id} className="flex min-w-0 items-center gap-3 bg-slate-900/75 px-5 py-4 transition hover:bg-slate-800/90">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl ${admin.is_super_admin ? 'bg-rose-400/15 text-rose-200' : 'bg-indigo-400/15 text-indigo-200'}`}>
                  {admin.avatar ? <img src={admin.avatar} alt="" className="h-full w-full object-cover" /> : admin.is_super_admin ? <ShieldAlert className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">{admin.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${admin.is_super_admin ? 'bg-rose-400/10 text-rose-200' : 'bg-indigo-400/10 text-indigo-200'}`}>{roleLabel(admin)}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">{admin.full_department_path || admin.department_name || '未分配部门'} · {admin.username || admin.email || '-'}</div>
                </div>
                {renderUserActions(admin)}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-slate-300">
              <Building2 className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">部门组织树</h2>
              <p className="mt-0.5 text-xs text-slate-500">来自钉钉通讯录的完整层级</p>
            </div>
          </div>
          <span className="text-xs text-slate-500">当前显示 {visibleCount} 人</span>
        </div>
        <div className="max-h-[720px] overflow-y-auto p-3">
          {rootDepartments.map((department) => renderDepartment(department))}
          {unassignedUsers.length ? (
            <div className="mt-2 rounded-2xl border border-dashed border-slate-700 p-3">
              <div className="mb-2 text-xs font-medium text-slate-500">未分配部门</div>
              {unassignedUsers.map((member) => (
                <div key={member.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-800/60">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-sm text-white">{member.name.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">{member.name}</div>
                    <div className="truncate text-xs text-slate-500">{member.username || '-'}</div>
                  </div>
                  {renderUserActions(member)}
                </div>
              ))}
            </div>
          ) : null}
          {!rootDepartments.length && !unassignedUsers.length ? (
            <div className="flex h-40 flex-col items-center justify-center text-slate-500">
              <Search className="mb-3 h-6 w-6" />
              <div className="text-sm">没有找到匹配的成员或部门</div>
            </div>
          ) : null}
        </div>
      </section>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setShowCreateModal(false)}>
          <form onSubmit={handleCreateUser} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-700 bg-slate-800 p-4 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">新增本地用户</h2>
                <p className="mt-1 text-sm text-slate-400">用于无法通过钉钉登录的临时账号。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setShowCreateModal(false)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-700 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-6 space-y-4">
              {([
                ['name', '姓名', '输入姓名'],
                ['username', '用户名', '邮箱或登录名'],
                ['password', '初始密码', '设置初始密码'],
              ] as const).map(([key, label, placeholder]) => (
                <label key={key} className="block text-sm font-medium text-slate-300">
                  {label}
                  <input
                    required
                    type={key === 'password' ? 'password' : 'text'}
                    value={createForm[key]}
                    onChange={(event) => setCreateForm({ ...createForm, [key]: event.target.value })}
                    placeholder={placeholder}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  />
                </label>
              ))}
              <label className="block text-sm font-medium text-slate-300">
                部门
                <div className="relative mt-2">
                  <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <select
                    value={createForm.department_id}
                    onChange={(event) => setCreateForm({ ...createForm, department_id: event.target.value })}
                    className="h-11 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900/70 pl-10 pr-10 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  >
                    <option value="">暂不分配部门</option>
                    {effectiveDepartments
                      .slice()
                      .sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name, 'zh-CN'))
                      .map((department) => {
                        const depth = Math.max(0, (department.path || department.name).split('/').length - 1);
                        return (
                          <option key={department.id} value={String(department.id)}>
                            {`${'　'.repeat(depth)}${depth ? '↳ ' : ''}${department.name}`}
                          </option>
                        );
                      })}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                </div>
                {createForm.department_id ? (
                  <span className="mt-2 block truncate text-xs text-slate-500">
                    {departmentMap.get(createForm.department_id)?.path || departmentMap.get(createForm.department_id)?.name}
                  </span>
                ) : null}
              </label>
            </div>
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" onClick={() => setShowCreateModal(false)} className="h-10 rounded-xl bg-slate-700 px-4 text-sm text-slate-200 hover:bg-slate-600">取消</button>
              <button type="submit" disabled={creating} className="h-10 rounded-xl bg-indigo-500 px-5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50">{creating ? '创建中...' : '创建用户'}</button>
            </div>
          </form>
        </div>
      ) : null}

      {editTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && !savingEdit && setEditTarget(null)}>
          <form onSubmit={handleSaveEdit} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-700 bg-slate-800 p-4 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between">
              <div><h2 className="text-xl font-semibold text-white">编辑用户</h2><p className="mt-1 text-sm text-slate-400">{editTarget.username || editTarget.email || editTarget.name}</p></div>
              <button type="button" aria-label="关闭" onClick={() => setEditTarget(null)} disabled={savingEdit} className="rounded-xl p-2 text-slate-500 hover:bg-slate-700 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-slate-300">姓名<input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-indigo-500" /></label>
              <label className="block text-sm font-medium text-slate-300">
                部门
                <div className="relative mt-2">
                  <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <select
                    value={editForm.department_id}
                    onChange={(event) => setEditForm({ ...editForm, department_id: event.target.value })}
                    className="h-11 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900/70 pl-10 pr-10 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  >
                    <option value="">暂不分配部门</option>
                    {effectiveDepartments
                      .slice()
                      .sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name, 'zh-CN'))
                      .map((department) => {
                        const depth = Math.max(0, (department.path || department.name).split('/').length - 1);
                        return (
                          <option key={department.id} value={String(department.id)}>
                            {`${'　'.repeat(depth)}${depth ? '↳ ' : ''}${department.name}`}
                          </option>
                        );
                      })}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                </div>
                {editForm.department_id ? (
                  <span className="mt-2 block truncate text-xs text-slate-500">
                    {departmentMap.get(editForm.department_id)?.path || departmentMap.get(editForm.department_id)?.name}
                  </span>
                ) : null}
                <span className="mt-2 block text-xs leading-5 text-amber-300/80">手动调整后，后续同步钉钉通讯录不会覆盖该用户的部门。</span>
              </label>
              <button type="button" onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })} className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm ${editForm.is_active ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-red-500/20 bg-red-500/10 text-red-200'}`}><span>账号状态</span><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${editForm.is_active ? 'bg-emerald-400' : 'bg-red-400'}`} />{editForm.is_active ? '启用' : '停用'}</span></button>
            </div>
            <div className="mt-7 flex justify-end gap-3"><button type="button" onClick={() => setEditTarget(null)} className="h-10 rounded-xl bg-slate-700 px-4 text-sm text-slate-200 hover:bg-slate-600">取消</button><button type="submit" disabled={savingEdit || !editForm.name.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"><Check className="h-4 w-4" />{savingEdit ? '保存中...' : '保存修改'}</button></div>
          </form>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setDeleteTarget(null)}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-400/10 text-red-300"><Trash2 className="h-5 w-5" /></div>
            <h2 className="mt-5 text-xl font-semibold text-white">删除用户</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">确认删除“{deleteTarget.name}”吗？此操作会同时清理该用户的收藏与操作记录。</p>
            <div className="mt-7 flex justify-end gap-3"><button type="button" onClick={() => setDeleteTarget(null)} className="h-10 rounded-xl bg-slate-700 px-4 text-sm text-slate-200 hover:bg-slate-600">取消</button><button type="button" onClick={() => void handleDelete()} disabled={deleting} className="h-10 rounded-xl bg-red-500 px-5 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50">{deleting ? '删除中...' : '确认删除'}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UsersManage;
