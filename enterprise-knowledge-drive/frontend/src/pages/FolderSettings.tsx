import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FolderCog, ImageUp, Palette, Save, ShieldCheck, Users } from 'lucide-react';

import FolderVisualEditor from '../components/folders/FolderVisualEditor';
import { resolveAssetUrl, folderIconOptions, getFolderVisualConfig, type FolderDisplayMode } from '../config/folderVisuals';
import api, { clearCache } from '../services/api';

type FolderBasic = {
  id: number;
  name: string;
  description?: string | null;
  parent_id: number | null;
  cover_url?: string | null;
  display_mode?: FolderDisplayMode | null;
  icon_key?: string | null;
  icon_bg_from?: string | null;
  icon_bg_to?: string | null;
  icon_color?: string | null;
  card_bg_from?: string | null;
  card_bg_via?: string | null;
  card_bg_to?: string | null;
  card_glow_color?: string | null;
  can_manage_settings: boolean;
  created_by?: number | null;
};

type FolderUser = {
  id: number;
  name: string;
  department_name?: string | null;
};

type PermissionContext = {
  is_super_admin: boolean;
  is_creator: boolean;
  is_manager: boolean;
  can_manage_settings: boolean;
};

type FolderSettingsResponse = {
  folder: FolderBasic;
  manager_users: FolderUser[];
  candidate_users: FolderUser[];
  permission_context: PermissionContext;
};

const FolderSettings = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderBasic | null>(null);
  const [permissionContext, setPermissionContext] = useState<PermissionContext | null>(null);
  const [candidateUsers, setCandidateUsers] = useState<FolderUser[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    display_mode: 'icon' as FolderDisplayMode,
    cover_url: '',
    icon_key: 'book-open',
    icon_bg_from: '#8cf3d5',
    icon_bg_to: '#44d7cc',
    icon_color: '#ffffff',
    card_bg_from: '#ebfff7',
    card_bg_via: '#d8fff3',
    card_bg_to: '#c1f7ec',
    card_glow_color: '#ffffff',
    manager_user_ids: [] as number[],
  });

  useEffect(() => {
    const fetchSettings = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);

      try {
        const response = await api.get<FolderSettingsResponse>(`/folders/${id}/settings`);
        const data = response.data;
        const visual = getFolderVisualConfig(data.folder);

        setFolder(data.folder);
        setPermissionContext(data.permission_context);
        setCandidateUsers(data.candidate_users);
        setForm({
          name: data.folder.name || '',
          description: data.folder.description || '',
          display_mode: visual.displayMode,
          cover_url: visual.coverUrl,
          icon_key: visual.iconKey,
          icon_bg_from: visual.iconBgFrom,
          icon_bg_to: visual.iconBgTo,
          icon_color: visual.iconColor,
          card_bg_from: visual.cardBgFrom,
          card_bg_via: visual.cardBgVia,
          card_bg_to: visual.cardBgTo,
          card_glow_color: visual.cardGlowColor,
          manager_user_ids: data.manager_users.map((user) => user.id),
        });
      } catch (err: any) {
        setError(err?.response?.data?.detail || '加载文件夹配置失败');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [id]);

  const filteredCandidates = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return candidateUsers;

    return candidateUsers.filter((user) => {
      const department = user.department_name || '';
      return user.name.toLowerCase().includes(keyword) || department.toLowerCase().includes(keyword);
    });
  }, [candidateUsers, searchKeyword]);

  const selectedManagers = useMemo(
    () => candidateUsers.filter((user) => form.manager_user_ids.includes(user.id)),
    [candidateUsers, form.manager_user_ids],
  );

  const toggleManager = (userId: number) => {
    setForm((prev) => ({
      ...prev,
      manager_user_ids: prev.manager_user_ids.includes(userId)
        ? prev.manager_user_ids.filter((id) => id !== userId)
        : [...prev.manager_user_ids, userId],
    }));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await api.put<FolderSettingsResponse>(`/folders/${id}/settings`, {
        name: form.name,
        description: form.description || null,
        display_mode: form.display_mode,
        cover_url: form.cover_url || null,
        icon_key: form.icon_key,
        icon_bg_from: form.icon_bg_from,
        icon_bg_to: form.icon_bg_to,
        icon_color: form.icon_color,
        card_bg_from: form.card_bg_from,
        card_bg_via: form.card_bg_via,
        card_bg_to: form.card_bg_to,
        card_glow_color: form.card_glow_color,
        manager_user_ids: form.manager_user_ids,
      });

      const data = response.data;
      const visual = getFolderVisualConfig(data.folder);
      clearCache();
      setFolder(data.folder);
      setPermissionContext(data.permission_context);
      setCandidateUsers(data.candidate_users);
      setForm((prev) => ({
        ...prev,
        name: data.folder.name || '',
        description: data.folder.description || '',
        display_mode: visual.displayMode,
        cover_url: visual.coverUrl,
        icon_key: visual.iconKey,
        icon_bg_from: visual.iconBgFrom,
        icon_bg_to: visual.iconBgTo,
        icon_color: visual.iconColor,
        card_bg_from: visual.cardBgFrom,
        card_bg_via: visual.cardBgVia,
        card_bg_to: visual.cardBgTo,
        card_glow_color: visual.cardGlowColor,
        manager_user_ids: data.manager_users.map((user) => user.id),
      }));
      setMessage('文件夹视觉配置已保存');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !id) return;

    setUploadingCover(true);
    setMessage(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post<{ cover_url: string; display_mode: FolderDisplayMode }>(
        `/folders/${id}/cover-upload`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        },
      );
      clearCache();
      setForm((prev) => ({
        ...prev,
        cover_url: response.data.cover_url,
        display_mode: response.data.display_mode,
      }));
      setMessage('封面上传成功');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '封面上传失败');
    } finally {
      setUploadingCover(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">加载文件夹配置中...</div>;
  }

  if (error && !folder) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-600">{error}</div>;
  }

  if (!folder || !permissionContext?.can_manage_settings) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-700">你没有该文件夹的配置权限。</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/folders/${folder.id}`)}
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 text-slate-500">
              <FolderCog className="h-4 w-4" />
              <span className="text-sm">文件夹独立配置</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{folder.name}</h1>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !form.name.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      <div className="space-y-6">
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">基础配置</h2>
            <p className="mt-1 text-sm text-slate-500">文件夹名称和说明在这里维护。</p>

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">文件夹名称</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  placeholder="请输入文件夹名称"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">文件夹描述</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  className="min-h-28 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  placeholder="补充文件夹说明，帮助成员理解用途"
                />
              </label>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-semibold text-slate-900">权限配置</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">统一管理编辑依据和文件夹管理者分配。</p>

            <div className="mt-5 space-y-5">
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                当前可编辑依据：
                {permissionContext.is_super_admin ? ' 超级管理员' : ''}
                {permissionContext.is_creator ? ' 创建者' : ''}
                {permissionContext.is_manager ? ' 文件夹管理者' : ''}
              </div>
              <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                配置编辑权限固定为：`超级管理员 / 创建者 / 文件夹管理者`
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <div className="text-sm font-semibold text-slate-900">文件夹管理者</div>
                </div>
                <p className="mt-1 text-sm text-slate-500">被勾选的成员可进入该文件夹的独立配置页。</p>

                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                  placeholder="搜索成员或部门"
                  className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                />

                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                  {filteredCandidates.map((user) => (
                    <label
                      key={user.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={form.manager_user_ids.includes(user.id)}
                        onChange={() => toggleManager(user.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800">{user.name}</div>
                        <div className="text-xs text-slate-500">{user.department_name || '未设置部门'}</div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="mb-2 text-sm font-medium text-slate-700">已选管理者</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedManagers.map((user) => (
                      <span key={user.id} className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                        {user.name}
                      </span>
                    ))}
                    {selectedManagers.length === 0 ? <span className="text-sm text-slate-400">暂未设置额外管理者</span> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-violet-600" />
            <h2 className="text-lg font-semibold text-slate-900">视觉模式</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">支持图标加色块组合，或用封面图替代卡片组件。</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, display_mode: 'icon' }))}
              className={`rounded-2xl border p-4 text-left transition ${form.display_mode === 'icon' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className="text-sm font-semibold text-slate-900">图标模式</div>
              <div className="mt-1 text-sm text-slate-500">预设图标库 + 色块渐变组合</div>
            </button>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, display_mode: 'cover' }))}
              className={`rounded-2xl border p-4 text-left transition ${form.display_mode === 'cover' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className="text-sm font-semibold text-slate-900">封面模式</div>
              <div className="mt-1 text-sm text-slate-500">上传图片或填写封面地址，替代图标组件</div>
            </button>
          </div>

          {form.display_mode === 'icon' ? (
            <div className="mt-6 space-y-5">
              <div>
                <div className="mb-3 text-sm font-medium text-slate-700">选择图标</div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {folderIconOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, icon_key: option.key }))}
                      className={`rounded-2xl border px-4 py-4 transition ${form.icon_key === option.key ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-11 w-11 items-center justify-center rounded-2xl shadow-[0_10px_20px_rgba(99,102,241,0.12)]"
                          style={{
                            backgroundImage: `linear-gradient(135deg, ${form.icon_bg_from} 0%, ${form.icon_bg_to} 100%)`,
                            color: form.icon_color,
                          }}
                        >
                          <option.icon className="h-5 w-5" />
                        </div>
                        <div className="text-sm font-medium text-slate-800">{option.label}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <FolderVisualEditor
                value={{
                  name: form.name,
                  description: form.description,
                  icon_key: form.icon_key,
                  icon_bg_from: form.icon_bg_from,
                  icon_bg_to: form.icon_bg_to,
                  icon_color: form.icon_color,
                  card_bg_from: form.card_bg_from,
                  card_bg_via: form.card_bg_via,
                  card_bg_to: form.card_bg_to,
                  card_glow_color: form.card_glow_color,
                }}
                onFieldChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
              />
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCoverUpload}
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingCover}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    <ImageUp className="h-4 w-4" />
                    {uploadingCover ? '上传中...' : '上传封面'}
                  </button>
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">封面地址</span>
                  <input
                    type="text"
                    value={form.cover_url}
                    onChange={(event) => setForm((prev) => ({ ...prev, cover_url: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    placeholder="https://example.com/cover.png 或上传后的 /covers/xxx.png"
                  />
                </label>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                {form.cover_url ? (
                  <img
                    src={resolveAssetUrl(form.cover_url)}
                    alt=""
                    className="h-64 w-full rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-64 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-400">
                    上传封面后会在这里预览
                  </div>
                )}
                <div className="mt-4">
                  <div className="text-lg font-semibold text-slate-900">{form.name || '文件夹名称预览'}</div>
                  <div className="mt-1 text-sm text-slate-500">{form.description || '文件夹描述预览'}</div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div> : null}
    </div>
  );
};

export default FolderSettings;
