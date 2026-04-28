import { create } from 'zustand';

export type DiscussionRightPanelTab = 'sediment' | 'knowledge' | 'participants';

interface DiscussionStore {
  selectedThreadBySpace: Record<string, string>;
  rightPanelTabBySpace: Record<string, DiscussionRightPanelTab>;
  knowledgeKeywordBySpace: Record<string, string>;
  setSelectedThread: (spaceId: string, threadId: string) => void;
  setRightPanelTab: (spaceId: string, tab: DiscussionRightPanelTab) => void;
  setKnowledgeKeyword: (spaceId: string, keyword: string) => void;
}

export const useDiscussionStore = create<DiscussionStore>((set) => ({
  selectedThreadBySpace: {},
  rightPanelTabBySpace: {},
  knowledgeKeywordBySpace: {},
  setSelectedThread: (spaceId, threadId) =>
    set((state) => ({
      selectedThreadBySpace: {
        ...state.selectedThreadBySpace,
        [spaceId]: threadId,
      },
    })),
  setRightPanelTab: (spaceId, tab) =>
    set((state) => ({
      rightPanelTabBySpace: {
        ...state.rightPanelTabBySpace,
        [spaceId]: tab,
      },
    })),
  setKnowledgeKeyword: (spaceId, keyword) =>
    set((state) => ({
      knowledgeKeywordBySpace: {
        ...state.knowledgeKeywordBySpace,
        [spaceId]: keyword,
      },
    })),
}));
