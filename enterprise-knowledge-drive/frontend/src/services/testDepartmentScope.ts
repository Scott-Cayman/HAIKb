const STORAGE_KEY = 'test_department_scope_name';
const EVENT_NAME = 'test-department-scope-changed';

export const getTestDepartmentScope = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value?.trim() || null;
};

export const setTestDepartmentScope = (departmentName: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, departmentName);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: departmentName }));
};

export const clearTestDepartmentScope = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: null }));
};

export const subscribeTestDepartmentScope = (callback: (departmentName: string | null) => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<string | null>;
    callback(customEvent.detail ?? getTestDepartmentScope());
  };

  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
};
