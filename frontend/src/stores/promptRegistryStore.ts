import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PromptRegistryStatusFilter = 'all' | 'draft' | 'published' | 'archived';

interface PromptRegistryStore {
  scene: string;
  role: string;
  categoryTab: string;
  statusFilter: PromptRegistryStatusFilter;
  setScene: (scene: string) => void;
  setRole: (role: string) => void;
  setCategoryTab: (categoryTab: string) => void;
  setStatusFilter: (statusFilter: PromptRegistryStatusFilter) => void;
}

export const usePromptRegistryStore = create<PromptRegistryStore>()(
  persist(
    (set) => ({
      scene: '',
      role: '',
      categoryTab: '',
      statusFilter: 'all',
      setScene: (scene) =>
        set((state) => (state.scene === scene ? state : { scene })),
      setRole: (role) =>
        set((state) => (state.role === role ? state : { role })),
      setCategoryTab: (categoryTab) =>
        set((state) => (state.categoryTab === categoryTab ? state : { categoryTab })),
      setStatusFilter: (statusFilter) =>
        set((state) => (state.statusFilter === statusFilter ? state : { statusFilter })),
    }),
    {
      name: 'prompt-registry-filters-store-v1',
      partialize: (state) => ({
        scene: state.scene,
        role: state.role,
        categoryTab: state.categoryTab,
        statusFilter: state.statusFilter,
      }),
    },
  ),
);
