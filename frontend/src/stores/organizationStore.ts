import { create } from 'zustand';
import { Organization } from '../types';

interface OrganizationStore {
  organization: Organization | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  setOrganization: (organization: Organization | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateOrganization: (updates: Partial<Organization>) => void;
}

export const useOrganizationStore = create<OrganizationStore>((set, get) => ({
  organization: null,
  loading: false,
  error: null,

  setOrganization: (organization) => set({ organization }),
  
  setLoading: (loading) => set({ loading }),
  
  setError: (error) => set({ error }),
  
  updateOrganization: (updates) => set((state) => ({
    organization: state.organization ? { ...state.organization, ...updates } : null
  })),
}));