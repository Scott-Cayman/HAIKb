import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Shield, User, ShieldAlert, CheckCircle, XCircle, Save } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore, User as UserType } from '../../stores/authStore';

interface CreateUserForm {
  name: string;
  username: string;
  password: string;
  department_name: string;
}

interface EditUserForm {
  name: string;
  department_name: string;
  is_active: boolean;
}

const UsersManage = () => {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>({
    name: '',
    username: '',
    password: '',
    department_name: '',
  });
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditUserForm>({
    name: '',
    department_name: '',
    is_active: true,
  });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/users');
      setUsers(response.data.users);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/admin/users', createForm);
      setShowCreateModal(false);
      setCreateForm({ name: '', username: '', password: '', department_name: '' });
      fetchUsers();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to create user');
    }
  };

  const handleUpdateRole = async (userId: number, is_admin: boolean, is_super_admin: boolean) => {
    try {
      await api.put(`/admin/users/${userId}/role`, { is_admin, is_super_admin });
      fetchUsers();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to update role');
    }
  };

  const handleStartEdit = (user: UserType) => {
    setEditingUserId(user.id);
    setEditForm({
      name: user.name,
      department_name: user.department_name || '',
      is_active: user.is_active,
    });
  };

  const handleSaveEdit = async (userId: number) => {
    try {
      await api.put(`/admin/users/${userId}`, editForm);
      setEditingUserId(null);
      fetchUsers();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('确定要删除这个用户吗？')) return;
    try {
      await api.delete(`/admin/users/${userId}`);
      fetchUsers();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to delete user');
    }
  };

  const getRoleBadge = (user: UserType) => {
    if (user.is_super_admin) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full flex items-center">
          <ShieldAlert className="w-3 h-3 mr-1" />
          超级管理员
        </span>
      );
    }
    if (user.is_admin) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full flex items-center">
          <Shield className="w-3 h-3 mr-1" />
          管理员
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-800 rounded-full flex items-center">
        <User className="w-3 h-3 mr-1" />
        普通用户
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white tracking-tight">用户管理</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          新增用户
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-200 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900/50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  用户
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  部门
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  角色
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-6 py-4">
                    {editingUserId === user.id ? (
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-3 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                      />
                    ) : (
                      <div className="flex items-center">
                        <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-white font-medium">
                          {user.name.charAt(0)}
                        </div>
                        <div className="ml-3">
                          <div className="text-sm font-medium text-white">{user.name}</div>
                          <div className="text-xs text-slate-400">{user.username || '-'}</div>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {editingUserId === user.id ? (
                      <input
                        type="text"
                        value={editForm.department_name}
                        onChange={(e) => setEditForm({ ...editForm, department_name: e.target.value })}
                        className="w-full px-3 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                      />
                    ) : (
                      <span className="text-sm text-slate-300">{user.department_name || '-'}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {getRoleBadge(user)}
                    {!user.is_super_admin && currentUser?.id !== user.id && (
                      <div className="mt-2 flex gap-2">
                        {!user.is_admin ? (
                          <button
                            onClick={() => handleUpdateRole(user.id, true, false)}
                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center"
                          >
                            <Shield className="w-3 h-3 mr-1" />
                            升为管理员
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdateRole(user.id, false, false)}
                            className="text-xs text-orange-400 hover:text-orange-300 flex items-center"
                          >
                            <User className="w-3 h-3 mr-1" />
                            降为用户
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {editingUserId === user.id ? (
                      <button
                        onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                        className={`flex items-center text-sm ${editForm.is_active ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {editForm.is_active ? <CheckCircle className="w-4 h-4 mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
                        {editForm.is_active ? '启用' : '禁用'}
                      </button>
                    ) : (
                      <span className={`flex items-center text-sm ${user.is_active ? 'text-green-400' : 'text-red-400'}`}>
                        {user.is_active ? (
                          <>
                            <CheckCircle className="w-4 h-4 mr-1" />
                            启用
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 mr-1" />
                            禁用
                          </>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {editingUserId === user.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleSaveEdit(user.id)}
                          className="text-green-400 hover:text-green-300 p-1"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingUserId(null)}
                          className="text-slate-400 hover:text-slate-300 p-1"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleStartEdit(user)}
                          className="text-slate-400 hover:text-slate-200 p-1"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {!user.is_super_admin && currentUser?.id !== user.id && (
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="text-red-400 hover:text-red-300 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-white mb-4">新增用户</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">姓名</label>
                <input
                  type="text"
                  required
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">用户名</label>
                <input
                  type="text"
                  required
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">密码</label>
                <input
                  type="password"
                  required
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">部门</label>
                <input
                  type="text"
                  value={createForm.department_name}
                  onChange={(e) => setCreateForm({ ...createForm, department_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersManage;
