import { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Play, Plus, Save, Square } from 'lucide-react';

import SystemSettingsTabs from '../../components/admin/SystemSettingsTabs';
import {
  presetPromptsApi,
  type CreatePresetPromptPayload,
  type PresetPromptDetail,
  type PresetPromptItem,
} from '../../services/presetPrompts';
import {
  clearTestDepartmentScope,
  getTestDepartmentScope,
  setTestDepartmentScope,
  subscribeTestDepartmentScope,
} from '../../services/testDepartmentScope';
import { useAuthStore } from '../../stores/authStore';

const formatUpdatedAt = (value?: string | null) => {
  if (!value) {
    return '未保存';
  }
  return new Date(value).toLocaleString();
};

const getManagedDepartmentName = (departmentName?: string | null, rootDepartmentName?: string | null) => {
  return rootDepartmentName || departmentName || '';
};

const PresetQuestions = () => {
  const currentUser = useAuthStore((state) => state.user);
  const isSuperAdmin = !!currentUser?.is_super_admin;
  const managedDepartmentName = useMemo(
    () => getManagedDepartmentName(currentUser?.department_name, currentUser?.root_department_name),
    [currentUser?.department_name, currentUser?.root_department_name],
  );

  const [items, setItems] = useState<PresetPromptItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PresetPromptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testDepartmentScope, setCurrentTestDepartmentScope] = useState<string | null>(getTestDepartmentScope());

  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    content: '',
  });

  const [createForm, setCreateForm] = useState<CreatePresetPromptPayload>({
    name: '',
    scope_type: isSuperAdmin ? 'global' : 'department',
    department_name: managedDepartmentName,
    description: '',
    content: '',
  });

  const loadItems = async (targetId?: string | null) => {
    const data = await presetPromptsApi.list();
    setItems(data);

    const nextId = targetId ?? selectedId ?? data[0]?.id ?? null;
    setSelectedId(nextId);

    if (nextId) {
      return nextId;
    }

    setDetail(null);
    setEditForm({ name: '', description: '', content: '' });
    return null;
  };

  const loadDetail = async (presetId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const data = await presetPromptsApi.get(presetId);
      setDetail(data);
      setEditForm({
        name: data.name,
        description: data.description || '',
        content: data.content,
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail || '加载预设问题失败');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const initialId = await loadItems();
        if (initialId) {
          await loadDetail(initialId);
        }
      } catch (err: any) {
        setError(err?.response?.data?.detail || '加载预设问题失败');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    setCreateForm((prev) => ({
      ...prev,
      scope_type: isSuperAdmin ? prev.scope_type : 'department',
      department_name: isSuperAdmin ? prev.department_name : managedDepartmentName,
    }));
  }, [isSuperAdmin, managedDepartmentName]);

  useEffect(() => {
    return subscribeTestDepartmentScope(setCurrentTestDepartmentScope);
  }, []);

  const handleSelect = async (presetId: string) => {
    setIsCreateMode(false);
    setSelectedId(presetId);
    await loadDetail(presetId);
  };

  const handleSave = async () => {
    if (!detail) {
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await presetPromptsApi.update(detail.id, {
        name: editForm.name,
        description: editForm.description,
        content: editForm.content,
      });
      setDetail(saved);
      setEditForm({
        name: saved.name,
        description: saved.description || '',
        content: saved.content,
      });
      const latestId = await loadItems(saved.id);
      if (latestId) {
        await loadDetail(latestId);
      }
      setMessage('预设问题已保存');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setMessage(null);
    setError(null);
    try {
      const payload: CreatePresetPromptPayload = {
        ...createForm,
        department_name:
          createForm.scope_type === 'department'
            ? (isSuperAdmin ? createForm.department_name : managedDepartmentName)
            : undefined,
      };
      const created = await presetPromptsApi.create(payload);
      setCreateForm({
        name: '',
        scope_type: isSuperAdmin ? createForm.scope_type : 'department',
        department_name: isSuperAdmin ? createForm.department_name || '' : managedDepartmentName,
        description: '',
        content: '',
      });
      setIsCreateMode(false);
      const latestId = await loadItems(created.id);
      if (latestId) {
        await loadDetail(latestId);
      }
      setMessage('新的预设问题已创建');
    } catch (err: any) {
      setError(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleStartDepartmentTest = (departmentName: string) => {
    setTestDepartmentScope(departmentName);
    setMessage(`已切换为按“${departmentName}”部门作用域测试，新的 AI 检索请求会按该部门生效`);
    setError(null);
  };

  const handleStopDepartmentTest = () => {
    clearTestDepartmentScope();
    setMessage('已恢复默认组织作用域测试');
    setError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>预设问题加载中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">系统配置</h1>
        <p className="text-sm text-slate-400">
          维护全集团与部门级预设问题文件，Agent 会按用户所属部门自动加载对应内容。
        </p>
        <SystemSettingsTabs />
      </div>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</div> : null}
      {testDepartmentScope ? (
        <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
          当前测试作用域：{testDepartmentScope}。当前浏览器内新的 AI 检索请求会临时按该部门执行。
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">预设列表</h2>
              <p className="mt-1 text-xs text-slate-400">
                {isSuperAdmin
                  ? '超级管理员可查看并管理全部条目'
                  : `管理员可查看全集团预设，编辑权限仍按所属部门控制；当前所属部门：${managedDepartmentName || '未绑定部门'}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsCreateMode(true);
                setDetail(null);
                setSelectedId(null);
                setError(null);
                setMessage(null);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
            >
              <Plus className="h-4 w-4" />
              新建
            </button>
          </div>

          <div className="space-y-3">
            {items.length === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-5 text-sm text-slate-400">
                暂无可管理的预设问题。
              </div>
            ) : (
              items.map((item) => {
                const isActive = !isCreateMode && selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-slate-700/60 p-2 text-slate-200">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {item.scope_type === 'global' ? '全集团' : item.department_name || '部门未设置'}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">最近更新：{formatUpdatedAt(item.updated_at)}</div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg">
          {isCreateMode ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white">新建预设问题</h2>
                <p className="mt-1 text-sm text-slate-400">新建后会自动生成对应的 Markdown 文件，并加入后台可编辑列表。</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm text-slate-300">名称</span>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-indigo-500"
                    placeholder="例如：海口创意设计中心预设问题"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm text-slate-300">作用范围</span>
                  <select
                    value={createForm.scope_type}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        scope_type: event.target.value as 'global' | 'department',
                      }))
                    }
                    disabled={!isSuperAdmin}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-indigo-500 disabled:opacity-70"
                  >
                    {isSuperAdmin ? <option value="global">全集团</option> : null}
                    <option value="department">部门</option>
                  </select>
                </label>

                {createForm.scope_type === 'department' ? (
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm text-slate-300">部门名称</span>
                    <input
                      type="text"
                      value={isSuperAdmin ? createForm.department_name || '' : managedDepartmentName}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, department_name: event.target.value }))}
                      disabled={!isSuperAdmin}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-indigo-500 disabled:opacity-70"
                    />
                  </label>
                ) : null}

                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm text-slate-300">说明</span>
                  <input
                    type="text"
                    value={createForm.description || ''}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-indigo-500"
                    placeholder="选填，方便后台识别用途"
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Markdown 内容</span>
                <textarea
                  value={createForm.content}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, content: event.target.value }))}
                  className="min-h-[420px] w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition focus:border-indigo-500"
                  placeholder="# 预设问题标题"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-60"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  创建预设问题
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateMode(false);
                    if (items[0]?.id) {
                      void handleSelect(items[0].id);
                    }
                  }}
                  className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
                >
                  取消
                </button>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="flex items-center gap-3 text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>正在加载内容...</span>
            </div>
          ) : detail ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">{detail.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {detail.scope_type === 'global' ? '全集团统一文件' : `部门文件：${detail.department_name || '-'}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    文件位置：{detail.relative_path}，最近更新：{formatUpdatedAt(detail.updated_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {detail.scope_type === 'department' && detail.department_name ? (
                    testDepartmentScope === detail.department_name ? (
                      <button
                        type="button"
                        onClick={handleStopDepartmentTest}
                        className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
                      >
                        <Square className="h-4 w-4" />
                        停止该部门测试
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStartDepartmentTest(detail.department_name!)}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-400"
                      >
                        <Play className="h-4 w-4" />
                        按该部门测试
                      </button>
                    )
                  ) : testDepartmentScope ? (
                    <button
                      type="button"
                      onClick={handleStopDepartmentTest}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
                    >
                      <Square className="h-4 w-4" />
                      恢复默认测试
                    </button>
                  ) : null}
                  <div className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-300">
                    {detail.can_edit ? '可编辑' : '只读'}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm text-slate-300">名称</span>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                    disabled={!detail.can_edit}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-indigo-500 disabled:opacity-70"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm text-slate-300">说明</span>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                    disabled={!detail.can_edit}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-indigo-500 disabled:opacity-70"
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Markdown 内容</span>
                <textarea
                  value={editForm.content}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, content: event.target.value }))}
                  disabled={!detail.can_edit}
                  className="min-h-[520px] w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition focus:border-indigo-500 disabled:opacity-70"
                />
              </label>

              {detail.can_edit ? (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    保存修改
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center text-slate-400">
              请选择左侧预设问题，或点击“新建”创建新的 Markdown 配置文件。
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PresetQuestions;
