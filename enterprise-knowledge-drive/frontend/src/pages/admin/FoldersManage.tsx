import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderLock,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

import api, { clearCache } from '../../services/api';

type FolderItem = {
  id: number;
  name: string;
  parent_id: number | null;
  description?: string | null;
  cover_url?: string | null;
  display_mode?: string | null;
  icon_key?: string | null;
  icon_bg_from?: string | null;
  icon_bg_to?: string | null;
  icon_color?: string | null;
  card_bg_from?: string | null;
  card_bg_via?: string | null;
  card_bg_to?: string | null;
  card_glow_color?: string | null;
};

type UserItem = { id: number; name: string; department_name?: string | null };
type PermissionCapability = 'view' | 'download' | 'edit' | 'upload' | 'delete';
type PermissionRule = { capability: PermissionCapability; subject_type: 'all' | 'org' | 'user'; subject_value?: string | null };
type InheritanceSource = { folder_id: number; folder_name: string } | null;
type SettingsResponse = {
  folder: FolderItem;
  manager_users: UserItem[];
  candidate_users: UserItem[];
  available_org_units: string[];
  permission_rules: PermissionRule[];
  effective_permission_rules: PermissionRule[];
  permission_inheritance: Record<string, InheritanceSource>;
};

const normalizeOrgPaths = (values: string[]) => {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return unique
    .filter((value) => value.includes('/') || !unique.some((candidate) => candidate.endsWith(`/${value}`)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
};

const capabilityOptions: Array<{
  value: PermissionCapability;
  label: string;
  description: string;
}> = [
  { value: 'view', label: '查看', description: '允许在线查看目录与文件' },
  { value: 'download', label: '下载', description: '允许下载文件到本地' },
  { value: 'upload', label: '上传与新建', description: '允许上传文件和新建子文件夹' },
  { value: 'edit', label: '重命名', description: '允许重命名文件与文件夹' },
  { value: 'delete', label: '删除', description: '允许删除目录内的文件与子文件夹' },
];

const FoldersManage = () => {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [directRules, setDirectRules] = useState<PermissionRule[]>([]);
  const [activeCapability, setActiveCapability] = useState<PermissionCapability>('view');
  const [folderQuery, setFolderQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTree = async () => {
    setLoadingTree(true);
    setError(null);
    try {
      const collected: FolderItem[] = [];
      let parents: Array<number | null> = [null];
      while (parents.length) {
        const batches = await Promise.all(
          parents.map((parentId) => api.get<FolderItem[]>('/folders', { params: parentId == null ? {} : { parent_id: parentId } })),
        );
        const level = batches.flatMap((response) => response.data || []);
        collected.push(...level);
        parents = level.map((folder) => folder.id);
      }
      setFolders(collected);
      const roots = collected.filter((folder) => folder.parent_id == null);
      setExpanded(new Set(roots.map((folder) => folder.id)));
      if (!selectedId && roots.length) setSelectedId(roots[0].id);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '目录树加载失败');
    } finally {
      setLoadingTree(false);
    }
  };

  useEffect(() => { void loadTree(); }, []);

  useEffect(() => {
    if (!selectedId) return;
    const loadSettings = async () => {
      setLoadingSettings(true);
      setError(null);
      setNotice(null);
      try {
        const response = await api.get<SettingsResponse>(`/folders/${selectedId}/settings`);
        setSettings(response.data);
        setDirectRules(response.data.permission_rules || []);
      } catch (err: any) {
        setSettings(null);
        setError(err?.response?.data?.detail || '没有权限管理此目录');
      } finally {
        setLoadingSettings(false);
      }
    };
    void loadSettings();
  }, [selectedId]);

  const children = useMemo(() => {
    const map = new Map<number | null, FolderItem[]>();
    folders.forEach((folder) => {
      const list = map.get(folder.parent_id) || [];
      list.push(folder);
      map.set(folder.parent_id, list);
    });
    return map;
  }, [folders]);

  const visibleFolderIds = useMemo(() => {
    const needle = folderQuery.trim().toLocaleLowerCase('zh-CN');
    if (!needle) return null;
    const ids = new Set<number>();
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    folders.filter((folder) => folder.name.toLocaleLowerCase('zh-CN').includes(needle)).forEach((folder) => {
      let current: FolderItem | undefined = folder;
      while (current) {
        ids.add(current.id);
        current = current.parent_id == null ? undefined : byId.get(current.parent_id);
      }
    });
    return ids;
  }, [folderQuery, folders]);

  const hasRule = (subjectType: PermissionRule['subject_type'], value?: string | null) =>
    directRules.some((rule) => rule.capability === activeCapability && rule.subject_type === subjectType && (rule.subject_value || null) === (value || null));

  const toggleRule = (subjectType: PermissionRule['subject_type'], value?: string | null) => {
    const exists = hasRule(subjectType, value);
    setDirectRules((current) => exists
      ? current.filter((rule) => !(rule.capability === activeCapability && rule.subject_type === subjectType && (rule.subject_value || null) === (value || null)))
      : [...current, { capability: activeCapability, subject_type: subjectType, subject_value: value || null }]);
  };

  const clearDirectRules = () => setDirectRules((rules) => rules.filter((rule) => rule.capability !== activeCapability));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const folder = settings.folder;
      const response = await api.put<SettingsResponse>(`/folders/${folder.id}/settings`, {
        name: folder.name,
        description: folder.description || null,
        cover_url: folder.cover_url || null,
        display_mode: folder.display_mode || 'icon',
        icon_key: folder.icon_key || 'folder',
        icon_bg_from: folder.icon_bg_from || '#8cf3d5',
        icon_bg_to: folder.icon_bg_to || '#44d7cc',
        icon_color: folder.icon_color || '#ffffff',
        card_bg_from: folder.card_bg_from || '#ebfff7',
        card_bg_via: folder.card_bg_via || '#d8fff3',
        card_bg_to: folder.card_bg_to || '#c1f7ec',
        card_glow_color: folder.card_glow_color || '#ffffff',
        manager_user_ids: settings.manager_users.map((user) => user.id),
        view_rules: directRules.filter((rule) => rule.capability === 'view').map(({ subject_type, subject_value }) => ({ subject_type, subject_value })),
        download_rules: directRules.filter((rule) => rule.capability === 'download').map(({ subject_type, subject_value }) => ({ subject_type, subject_value })),
        edit_rules: directRules.filter((rule) => rule.capability === 'edit').map(({ subject_type, subject_value }) => ({ subject_type, subject_value })),
        upload_rules: directRules.filter((rule) => rule.capability === 'upload').map(({ subject_type, subject_value }) => ({ subject_type, subject_value })),
        delete_rules: directRules.filter((rule) => rule.capability === 'delete').map(({ subject_type, subject_value }) => ({ subject_type, subject_value })),
      });
      setSettings(response.data);
      setDirectRules(response.data.permission_rules || []);
      clearCache();
      setNotice('权限已保存，所有下级文件夹和文件会立即继承');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '权限保存失败');
    } finally {
      setSaving(false);
    }
  };

  const orgPaths = useMemo(() => normalizeOrgPaths(settings?.available_org_units || []), [settings]);
  const users = useMemo(() => {
    const needle = userQuery.trim().toLocaleLowerCase('zh-CN');
    return (settings?.candidate_users || []).filter((user) =>
      !needle || `${user.name} ${user.department_name || ''}`.toLocaleLowerCase('zh-CN').includes(needle),
    ).slice(0, 80);
  }, [settings, userQuery]);

  const renderFolder = (folder: FolderItem, depth: number): ReactNode => {
    if (visibleFolderIds && !visibleFolderIds.has(folder.id)) return null;
    const childFolders = children.get(folder.id) || [];
    const open = expanded.has(folder.id) || !!folderQuery;
    return (
      <div key={folder.id}>
        <button
          onClick={() => setSelectedId(folder.id)}
          className={`group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition ${selectedId === folder.id ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30' : 'text-slate-300 hover:bg-slate-800'}`}
          style={{ paddingLeft: 10 + depth * 18 }}
        >
          <span
            onClick={(event) => {
              event.stopPropagation();
              if (!childFolders.length) return;
              setExpanded((current) => {
                const next = new Set(current);
                next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id);
                return next;
              });
            }}
            className="grid h-5 w-5 shrink-0 place-items-center"
          >
            {childFolders.length ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="h-1 w-1 rounded-full bg-slate-600" />}
          </span>
          <Folder className={`h-4 w-4 shrink-0 ${selectedId === folder.id ? 'text-indigo-400' : 'text-slate-500'}`} />
          <span className="truncate">{folder.name.replace(/王朝/g, '王潮')}</span>
        </button>
        {open && childFolders.map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  const activeOption = capabilityOptions.find((option) => option.value === activeCapability)!;
  const inheritedFrom = settings?.permission_inheritance?.[activeCapability];
  const effectiveRules = directRules.some((rule) => rule.capability === activeCapability)
    ? directRules.filter((rule) => rule.capability === activeCapability)
    : (settings?.effective_permission_rules || []).filter((rule) => rule.capability === activeCapability);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-400"><ShieldCheck className="h-4 w-4" />访问控制</div>
          <h1 className="text-3xl font-bold tracking-tight text-white">文件权限</h1>
          <p className="mt-2 text-sm text-slate-400">按整个集团、钉钉部门或具体人员配置可见范围。子级默认继承最近一级权限。</p>
        </div>
        <button onClick={() => void loadTree()} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:bg-slate-700">
          <RefreshCw className={`h-4 w-4 ${loadingTree ? 'animate-spin' : ''}`} />刷新目录
        </button>
      </div>

      {(error || notice) && <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{error || notice}</div>}

      <div className="grid min-h-[680px] grid-cols-1 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/70 shadow-2xl shadow-slate-950/20 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="max-h-[360px] overflow-hidden border-b border-slate-700/80 bg-slate-900/55 p-4 xl:max-h-none xl:border-b-0 xl:border-r">
          <div className="relative mb-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={folderQuery} onChange={(event) => setFolderQuery(event.target.value)} placeholder="搜索文件夹" className="w-full rounded-xl border border-slate-700 bg-slate-950/60 py-2.5 pl-9 pr-3 text-sm text-slate-200 outline-none focus:border-indigo-500" /></div>
          <div className="max-h-[285px] overflow-y-auto pr-1 xl:max-h-[610px]">{loadingTree ? <div className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />加载目录树</div> : (children.get(null) || []).map((folder) => renderFolder(folder, 0))}</div>
        </aside>

        <main className="p-4 md:p-6">
          {loadingSettings ? <div className="grid h-full place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : settings ? (
            <div className="mx-auto max-w-3xl space-y-6">
              <div className="flex flex-col gap-4 border-b border-slate-700 pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500"><FolderLock className="h-4 w-4" />当前目录</div><h2 className="text-xl font-semibold text-white">{settings.folder.name.replace(/王朝/g, '王潮')}</h2></div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => navigate(`/admin/preset-prompts?folderId=${settings.folder.id}`)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-400/20"><Sparkles className="h-4 w-4" />配置 AI 预设</button>
                  <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 hover:bg-indigo-400 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}保存权限</button>
                </div>
              </div>

              <section className="rounded-2xl border border-slate-700 bg-slate-900/45 p-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {capabilityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setActiveCapability(option.value)}
                      className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        activeCapability === option.value
                          ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-950/25'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-700 bg-slate-900/45 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div><h3 className="font-semibold text-slate-100">继承策略</h3><p className="mt-1 text-sm leading-6 text-slate-400">本目录未单独配置时，自动继承最近上级目录；一旦添加规则，本目录会独立生效并继续传递给所有子级。</p></div>
                  <button onClick={clearDirectRules} className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">恢复继承</button>
                </div>
                <div className="mt-4 rounded-xl bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
                  {directRules.some((rule) => rule.capability === activeCapability) ? `当前目录：使用独立${activeOption.label}权限` : inheritedFrom ? `当前目录：继承自“${inheritedFrom.folder_name.replace(/王朝/g, '王潮')}”` : `当前目录：未授予普通用户${activeOption.label}权限`}
                </div>
              </section>

              <section className="space-y-4">
                <div><h3 className="font-semibold text-slate-100">谁可以{activeOption.label}</h3><p className="mt-1 text-sm text-slate-400">{activeOption.description}。管理员的管理范围仍严格受其所属部门限制。</p></div>
                <button onClick={() => toggleRule('all')} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition ${hasRule('all') ? 'border-indigo-400/50 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'}`}>
                  <span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Building2 className="h-5 w-5" /></span><span><span className="block font-medium text-slate-100">整个集团可{activeOption.label}</span><span className="mt-0.5 block text-xs text-slate-500">对全部启用账号授予此项能力</span></span></span>{hasRule('all') && <Check className="h-5 w-5 text-indigo-400" />}
                </button>
              </section>

              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
                  <div className="mb-3 flex items-center gap-2 font-medium text-slate-200"><UsersRound className="h-4 w-4 text-cyan-400" />钉钉部门</div>
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {orgPaths.map((path) => <button key={path} onClick={() => toggleRule('org', path)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${hasRule('org', path) ? 'bg-cyan-500/12 text-cyan-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}><span className="truncate">{path}</span>{hasRule('org', path) && <Check className="h-4 w-4 shrink-0" />}</button>)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
                  <div className="mb-3 flex items-center gap-2 font-medium text-slate-200"><UserRound className="h-4 w-4 text-amber-400" />指定人员</div>
                  <div className="relative mb-2"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="搜索姓名或部门" className="w-full rounded-lg border border-slate-700 bg-slate-950/60 py-2 pl-8 pr-3 text-xs text-slate-200 outline-none focus:border-indigo-500" /></div>
                  <div className="max-h-52 space-y-1 overflow-y-auto pr-1">{users.map((user) => <button key={user.id} onClick={() => toggleRule('user', String(user.id))} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${hasRule('user', String(user.id)) ? 'bg-amber-500/10 text-amber-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}><span className="min-w-0"><span className="block truncate">{user.name}</span><span className="block truncate text-[11px] text-slate-600">{user.department_name || '未分配部门'}</span></span>{hasRule('user', String(user.id)) && <Check className="h-4 w-4 shrink-0" />}</button>)}</div>
                </div>
              </section>

              <section>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">当前生效对象</div>
                <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border border-dashed border-slate-700 p-3">
                  {effectiveRules.length ? effectiveRules.map((rule, index) => <span key={`${rule.subject_type}-${rule.subject_value}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-xs text-slate-200">{rule.subject_type === 'all' ? '整个集团' : rule.subject_type === 'org' ? rule.subject_value : settings.candidate_users.find((user) => String(user.id) === rule.subject_value)?.name || `用户 ${rule.subject_value}`}{directRules.includes(rule) && <X className="h-3 w-3 cursor-pointer text-slate-500" onClick={() => toggleRule(rule.subject_type, rule.subject_value)} />}</span>) : <span className="text-sm text-slate-600">暂无显式权限对象</span>}
                </div>
              </section>
            </div>
          ) : <div className="grid h-full place-items-center text-sm text-slate-500">请选择可管理的文件夹</div>}
        </main>
      </div>
    </div>
  );
};

export default FoldersManage;
