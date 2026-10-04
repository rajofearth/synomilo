import React, { createContext, useContext, useState } from 'react';

type ActiveChat = {
  type: 'user' | 'group';
  id: string; // userUID or groupID
} | null;

type ActiveChatContextType = {
  activeChat: ActiveChat;
  setActiveChat: React.Dispatch<React.SetStateAction<ActiveChat>>;
};

const ActiveChatContext = createContext<ActiveChatContextType | undefined>(undefined);

export function ActiveChatProvider({ children }: { children: React.ReactNode }) {
  const [activeChat, setActiveChat] = useState<ActiveChat>(null);

  return (
    <ActiveChatContext.Provider value={{ activeChat, setActiveChat }}>
      {children}
    </ActiveChatContext.Provider>
  );
}

// Hook for using in any component
export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error('useActiveChat must be used within an ActiveChatProvider');
  }
  return context;
}
