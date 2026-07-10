import { Link, useLocation } from 'react-router-dom';

const tabs = [
  { label: '首页样式', path: '/admin/settings' },
  { label: '预设问题', path: '/admin/settings/preset-prompts' },
];

const SystemSettingsTabs = () => {
  const location = useLocation();

  return (
    <div className="flex flex-wrap gap-3">
      {tabs.map((tab) => {
        const isActive = location.pathname === tab.path;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
};

export default SystemSettingsTabs;
