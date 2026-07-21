import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Folder,
  Loader2,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';

import api from '../../services/api';
import {
  folderAiPresetsApi,
  type FolderAiPreset,
  type FolderAiPresetQuestion,
} from '../../services/folderAiPresets';
import { presetPromptsApi, type PresetPromptDetail } from '../../services/presetPrompts';

type FolderItem = { id: number; name: string; parent_id: number | null };

const emptyQuestion = (): FolderAiPresetQuestion => ({
  question: '',
  aliases: [],
  answer: '',
  keywords: [],
  priority: 80,
  is_enabled: true,
});

const PresetQuestions = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedFolderId = Number(searchParams.get('folderId') || 0) || null;
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(requestedFolderId);
  const [folderQuery, setFolderQuery] = useState('');
  const [activePreset, setActivePreset] = useState<FolderAiPreset | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [inheritToChildren, setInheritToChildren] = useState(true);
  const [questions, setQuestions] = useState<FolderAiPresetQuestion[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingPreset, setLoadingPreset] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<PresetPromptDetail | null>(null);
  const [agentPromptContent, setAgentPromptContent] = useState('');
  const [agentPromptOpen, setAgentPromptOpen] = useState(true);
  const [agentPromptLoading, setAgentPromptLoading] = useState(true);
  const [agentPromptSaving, setAgentPromptSaving] = useState(false);
  const [agentPromptNotice, setAgentPromptNotice] = useState<string | null>(null);
  const [agentPromptError, setAgentPromptError] = useState<string | null>(null);

  useEffect(() => {
    const loadAgentPrompt = async () => {
      setAgentPromptLoading(true);
      setAgentPromptError(null);
      try {
        const data = await presetPromptsApi.get('agent-system');
        setAgentPrompt(data);
        setAgentPromptContent(data.content || '');
      } catch (err: any) {
        setAgentPromptError(err?.response?.data?.detail || '全局 Agent 设定加载失败');
      } finally {
        setAgentPromptLoading(false);
      }
    };
    void loadAgentPrompt();
  }, []);

  useEffect(() => {
    const loadTree = async () => {
      setLoadingTree(true);
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
        const initialId = requestedFolderId && collected.some((folder) => folder.id === requestedFolderId)
          ? requestedFolderId
          : roots[0]?.id ?? null;
        setSelectedFolderId(initialId);
      } catch (err: any) {
        setError(err?.response?.data?.detail || '目录树加载失败');
      } finally {
        setLoadingTree(false);
      }
    };
    void loadTree();
  }, []);

  useEffect(() => {
    if (!selectedFolderId) return;
    setSearchParams({ folderId: String(selectedFolderId) }, { replace: true });
    const loadPreset = async () => {
      setLoadingPreset(true);
      setError(null);
      setNotice(null);
      try {
        const data = await folderAiPresetsApi.list(selectedFolderId);
        const preset = data.presets[0] || null;
        setActivePreset(preset);
        setName(preset?.name || `${data.folder.name}预设问答`);
        setDescription(preset?.description || '该目录的常见问题与标准答案');
        setSourceContent(preset?.source_content || '');
        setInheritToChildren(preset?.inherit_to_children ?? true);
        setQuestions(preset?.questions || []);
        setWarnings([]);
      } catch (err: any) {
        setActivePreset(null);
        setQuestions([]);
        setError(err?.response?.data?.detail || '没有权限配置该目录');
      } finally {
        setLoadingPreset(false);
      }
    };
    void loadPreset();
  }, [selectedFolderId, setSearchParams]);

  const children = useMemo(() => {
    const map = new Map<number | null, FolderItem[]>();
    folders.forEach((folder) => map.set(folder.parent_id, [...(map.get(folder.parent_id) || []), folder]));
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

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || null;

  const renderFolder = (folder: FolderItem, depth: number): ReactNode => {
    if (visibleFolderIds && !visibleFolderIds.has(folder.id)) return null;
    const childFolders = children.get(folder.id) || [];
    const open = expanded.has(folder.id) || Boolean(folderQuery);
    const active = selectedFolderId === folder.id;
    return (
      <div key={folder.id}>
        <button
          type="button"
          onClick={() => setSelectedFolderId(folder.id)}
          className={`flex w-full items-center gap-2 rounded-xl py-2 pr-2 text-left text-sm transition ${
            active ? 'bg-[#dff8f5] font-semibold text-[#168f91]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
          style={{ paddingLeft: 8 + depth * 17 }}
        >
          <span
            className="grid h-5 w-5 shrink-0 place-items-center"
            onClick={(event) => {
              event.stopPropagation();
              if (!childFolders.length) return;
              setExpanded((current) => {
                const next = new Set(current);
                next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id);
                return next;
              });
            }}
          >
            {childFolders.length ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="h-1 w-1 rounded-full bg-slate-300" />}
          </span>
          <Folder className={`h-4 w-4 shrink-0 ${active ? 'text-[#2bbfba]' : 'text-slate-400'}`} />
          <span className="truncate">{folder.name.replace(/王朝/g, '王潮')}</span>
        </button>
        {open ? childFolders.map((child) => renderFolder(child, depth + 1)) : null}
      </div>
    );
  };

  const handleOrganize = async () => {
    if (!selectedFolderId || !sourceContent.trim()) return;
    setOrganizing(true);
    setError(null);
    setNotice(null);
    try {
      const data = await folderAiPresetsApi.organize(selectedFolderId, sourceContent);
      setQuestions(data.questions);
      setWarnings(data.warnings || []);
      setNotice(`已整理出 ${data.question_count} 条问答。请核对后再发布。`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'AI 整理失败');
    } finally {
      setOrganizing(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedFolderId) return;
    const validQuestions = questions.filter((item) => item.question.trim() && item.answer.trim());
    if (!name.trim() || validQuestions.length === 0) {
      setError('请填写名称，并至少保留一条完整问答');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await folderAiPresetsApi.publish(selectedFolderId, {
        preset_id: activePreset?.id,
        name,
        description,
        source_content: sourceContent,
        inherit_to_children: inheritToChildren,
        questions: validQuestions,
      });
      setActivePreset(saved);
      setQuestions(saved.questions);
      setNotice(`已发布第 ${saved.version} 版，并完成 ${saved.questions.length} 条问题的检索索引。`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '发布失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAgentPrompt = async () => {
    if (!agentPrompt?.can_edit || !agentPromptContent.trim()) return;
    setAgentPromptSaving(true);
    setAgentPromptError(null);
    setAgentPromptNotice(null);
    try {
      const saved = await presetPromptsApi.update('agent-system', { content: agentPromptContent });
      setAgentPrompt(saved);
      setAgentPromptContent(saved.content || '');
      setAgentPromptNotice('全局 Agent 设定已生效，后续回答会直接使用新版本。');
    } catch (err: any) {
      setAgentPromptError(err?.response?.data?.detail || '全局 Agent 设定保存失败');
    } finally {
      setAgentPromptSaving(false);
    }
  };

  const updateQuestion = (index: number, patch: Partial<FolderAiPresetQuestion>) => {
    setQuestions((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  return (
    <div className="space-y-5 text-slate-800">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#23aaa7]">
            <Sparkles className="h-4 w-4" />Folder AI
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">文件夹预设问答</h1>
          <p className="mt-2 text-sm text-slate-500">输入正常文本，AI 整理成可快速命中的问答；预览确认后才会发布。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setActivePreset(null);
            setName(`${selectedFolder?.name || '当前目录'}预设问答`);
            setDescription('该目录的常见问题与标准答案');
            setSourceContent('');
            setQuestions([]);
            setWarnings([]);
          }}
          disabled={!selectedFolderId}
          title={!selectedFolderId ? '请先选择一个文件夹' : undefined}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#bfe9e5] bg-white px-4 py-2.5 text-sm font-semibold text-[#198f91] shadow-sm transition hover:bg-[#f1fbfa] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#45d5c4]/15 disabled:cursor-not-allowed disabled:!border-slate-200 disabled:!bg-slate-100 disabled:!text-slate-400 disabled:shadow-none disabled:hover:!bg-slate-100"
        >
          <Plus className="h-4 w-4" />{selectedFolderId ? '新建配置' : '请先选择文件夹'}
        </button>
      </header>

      <section className="overflow-hidden rounded-[24px] border border-[#bfe9e5] bg-white shadow-[0_14px_38px_rgba(56,128,139,0.08)]">
        <button
          type="button"
          onClick={() => setAgentPromptOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left md:px-6"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#ddfaf5] to-[#e4f7ff] text-[#159b9b]">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold text-slate-900">全局 Agent 设定</h2>
                <span className="rounded-full bg-[#e8faf7] px-2 py-0.5 text-[11px] font-semibold text-[#168f91]">所有非预设直答生效</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">只维护身份、回答边界和输出规则；产品、制度与业务知识请放在对应文件夹预设中。</p>
            </div>
          </div>
          {agentPromptOpen ? <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />}
        </button>

        {agentPromptOpen ? (
          <div className="border-t border-slate-100 px-5 py-5 md:px-6">
            {agentPromptLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />正在读取当前生效提示词</div>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                  <textarea
                    value={agentPromptContent}
                    onChange={(event) => setAgentPromptContent(event.target.value)}
                    rows={12}
                    readOnly={!agentPrompt?.can_edit}
                    className="w-full resize-y rounded-2xl border border-slate-200 bg-[#fbfefd] px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-[#6ed6d0] focus:ring-4 focus:ring-[#6ed6d0]/10 read-only:cursor-default read-only:bg-slate-50"
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs">
                      {agentPromptError ? <span className="text-rose-600">{agentPromptError}</span> : null}
                      {agentPromptNotice ? <span className="text-[#168f91]">{agentPromptNotice}</span> : null}
                      {!agentPromptError && !agentPromptNotice ? <span className="text-slate-400">只有超级管理员可以修改；保存后无需重启服务。</span> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveAgentPrompt()}
                      disabled={!agentPrompt?.can_edit || agentPromptSaving || !agentPromptContent.trim()}
                      title={!agentPrompt?.can_edit ? '只有超级管理员可以修改全局 Agent 设定' : undefined}
                      className="admin-primary-action inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#45d5c4]/20 disabled:cursor-not-allowed"
                    >
                      {agentPromptSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {agentPromptSaving
                        ? '正在保存'
                        : !agentPrompt?.can_edit
                          ? '仅超级管理员可保存'
                          : !agentPromptContent.trim()
                            ? '请输入设定内容'
                            : '保存全局设定'}
                    </button>
                  </div>
                </div>

                <aside className="rounded-2xl border border-slate-200 bg-[#f8fcfc] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Zap className="h-4 w-4 text-[#20aaa7]" />当前回答链路</div>
                  <ol className="mt-4 space-y-3 text-xs leading-5 text-slate-600">
                    <li className="rounded-xl bg-white px-3 py-2"><b className="text-slate-800">1. 权限范围</b><br />只检查用户可见目录与文件。</li>
                    <li className="rounded-xl bg-white px-3 py-2"><b className="text-slate-800">2. 文件夹预设</b><br />命中后直接返回管理员发布的答案。</li>
                    <li className="rounded-xl bg-white px-3 py-2"><b className="text-slate-800">3. RAG 检索</b><br />未命中预设时才搜索可见文件总结。</li>
                    <li className="rounded-xl bg-white px-3 py-2"><b className="text-slate-800">4. 最终回答</b><br />仅加载左侧全局设定与本次检索证据。</li>
                  </ol>
                </aside>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {(error || notice) ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-[#bce9e3] bg-[#edfbf9] text-[#147f80]'}`}>
          {error || notice}
        </div>
      ) : null}

      <div className="grid min-h-[720px] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(56,128,139,0.08)] xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-slate-100 bg-[#fbfefd] p-4 xl:border-b-0 xl:border-r">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={folderQuery} onChange={(event) => setFolderQuery(event.target.value)} placeholder="搜索文件夹" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-[#6ed6d0] focus:ring-4 focus:ring-[#6ed6d0]/10" />
          </div>
          <div className="max-h-[650px] overflow-y-auto pr-1">
            {loadingTree ? <div className="flex items-center gap-2 p-4 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />加载目录树</div> : (children.get(null) || []).map((folder) => renderFolder(folder, 0))}
          </div>
        </aside>

        <main className="min-w-0 p-5 md:p-7">
          {loadingPreset ? (
            <div className="grid min-h-[560px] place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : selectedFolder ? (
            <div className="space-y-6">
              <section className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400"><Folder className="h-4 w-4" />当前绑定目录</div>
                  <h2 className="mt-2 text-xl font-bold text-slate-900">{selectedFolder.name.replace(/王朝/g, '王潮')}</h2>
                  <p className="mt-1 text-sm text-slate-500">用户必须能查看该目录，才可能命中这里发布的答案。</p>
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <input type="checkbox" checked={inheritToChildren} onChange={(event) => setInheritToChildren(event.target.checked)} className="h-4 w-4 accent-[#2bbfba]" />
                  子文件夹继承
                </label>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-medium text-slate-700">配置名称<input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3.5 py-3 font-normal outline-none focus:border-[#6ed6d0] focus:ring-4 focus:ring-[#6ed6d0]/10" /></label>
                <label className="space-y-2 text-sm font-medium text-slate-700">说明<input value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3.5 py-3 font-normal outline-none focus:border-[#6ed6d0] focus:ring-4 focus:ring-[#6ed6d0]/10" /></label>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-[#fbfefd] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-semibold text-slate-900">原始问题文本</h3><p className="mt-1 text-xs text-slate-500">可直接粘贴制度、FAQ、流程或普通段落，无需手写 Markdown 格式。</p></div>
                  <button
                    type="button"
                    onClick={() => void handleOrganize()}
                    disabled={organizing || !sourceContent.trim()}
                    title={!sourceContent.trim() ? '请先输入需要整理的原始文本' : undefined}
                    className="admin-gradient-action inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-[0_8px_22px_rgba(53,190,190,0.2)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#45d5c4]/20 disabled:cursor-not-allowed"
                  >
                    {organizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                    {organizing ? '正在整理' : !sourceContent.trim() ? '请先输入原始文本' : 'AI 整理并预览'}
                  </button>
                </div>
                <textarea value={sourceContent} onChange={(event) => setSourceContent(event.target.value)} rows={10} placeholder="例如：会议室需要在钉钉工作台的会议室应用中预定……" className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-[#6ed6d0] focus:ring-4 focus:ring-[#6ed6d0]/10" />
                {warnings.map((warning) => <div key={warning} className="mt-2 flex items-start gap-2 text-xs leading-5 text-amber-600"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</div>)}
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><h3 className="font-semibold text-slate-900">发布前预览</h3><p className="mt-1 text-xs text-slate-500">标准问题和口语别名用于命中；答案按这里的文本原样优先返回。</p></div>
                  <button type="button" onClick={() => setQuestions((current) => [...current, emptyQuestion()])} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />添加问答</button>
                </div>
                <div className="space-y-3">
                  {questions.map((item, index) => (
                    <article key={item.id || `draft-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_auto]">
                        <input value={item.question} onChange={(event) => updateQuestion(index, { question: event.target.value })} placeholder="标准问题" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#6ed6d0]" />
                        <input value={(item.aliases || []).join('，')} onChange={(event) => updateQuestion(index, { aliases: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} placeholder="口语别名，用逗号分隔" className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-[#6ed6d0]" />
                        <button type="button" onClick={() => setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-500" aria-label="删除该问答"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <textarea value={item.answer} onChange={(event) => updateQuestion(index, { answer: event.target.value })} rows={4} placeholder="标准答案" className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#6ed6d0]" />
                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_auto]">
                        <label className="space-y-1.5 text-xs text-slate-500">
                          <span>关键词（参与命中，用逗号分隔）</span>
                          <input
                            value={(item.keywords || []).join('，')}
                            onChange={(event) => updateQuestion(index, {
                              keywords: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean),
                            })}
                            placeholder="例如：考勤时间、打卡时间"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#6ed6d0]"
                          />
                        </label>
                        <label className="space-y-1.5 text-xs text-slate-500">
                          <span>命中优先级</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={item.priority}
                            onChange={(event) => updateQuestion(index, {
                              priority: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                            })}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#6ed6d0]"
                          />
                        </label>
                        <label className="flex items-end gap-2 pb-2.5 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={item.is_enabled}
                            onChange={(event) => updateQuestion(index, { is_enabled: event.target.checked })}
                            className="h-4 w-4 accent-[#2bbfba]"
                          />
                          启用该问答
                        </label>
                      </div>
                    </article>
                  ))}
                  {questions.length === 0 ? <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 text-center text-sm text-slate-400"><div><FileText className="mx-auto mb-2 h-6 w-6" />粘贴文本后点击“AI 整理并预览”</div></div> : null}
                </div>
              </section>

              <div className="flex justify-end border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={() => void handlePublish()}
                  disabled={saving || questions.length === 0}
                  title={questions.length === 0 ? '请先整理或添加至少一条问答' : undefined}
                  className="admin-primary-action inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold shadow-lg shadow-slate-300/40 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#45d5c4]/20 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? '正在发布' : questions.length === 0 ? '暂无可发布问答' : '确认发布'}
                </button>
              </div>
            </div>
          ) : <div className="grid min-h-[560px] place-items-center text-sm text-slate-400">请选择文件夹</div>}
        </main>
      </div>
    </div>
  );
};

export default PresetQuestions;
