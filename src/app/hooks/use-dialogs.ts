/**
 * useDialogs — manages open/close state for all modal dialogs in the app.
 *
 * Extracts dialog state management from AppInner so the main component
 * doesn't need to track six independent boolean states.
 */

import { useState, useCallback, useMemo } from "react";

export interface DialogStates {
  paletteOpen: boolean;
  searchOpen: boolean;
  settingsOpen: boolean;
  aboutOpen: boolean;
  shortcutsOpen: boolean;
  gotoLineOpen: boolean;
}

export interface DialogActions {
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAboutOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShortcutsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGotoLineOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openAbout: () => void;
  openShortcuts: () => void;
  openSettings: () => void;
  openSearch: () => void;
  openGotoLine: () => void;
  closeAbout: () => void;
  closeShortcuts: () => void;
  closeGotoLine: () => void;
}

export type UseDialogsReturn = DialogStates & DialogActions;

export function useDialogs(): UseDialogsReturn {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gotoLineOpen, setGotoLineOpen] = useState(false);

  const openAbout = useCallback(() => setAboutOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const openGotoLine = useCallback(() => setGotoLineOpen(true), []);
  const closeAbout = useCallback(() => setAboutOpen(false), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const closeGotoLine = useCallback(() => setGotoLineOpen(false), []);

  return useMemo(() => ({
    paletteOpen,
    searchOpen,
    settingsOpen,
    aboutOpen,
    shortcutsOpen,
    gotoLineOpen,
    setPaletteOpen,
    setSearchOpen,
    setSettingsOpen,
    setAboutOpen,
    setShortcutsOpen,
    setGotoLineOpen,
    openAbout,
    openShortcuts,
    openSettings,
    openSearch,
    openGotoLine,
    closeAbout,
    closeShortcuts,
    closeGotoLine,
  }), [paletteOpen, searchOpen, settingsOpen, aboutOpen, shortcutsOpen, gotoLineOpen,
       openAbout, openShortcuts, openSettings, openSearch, openGotoLine,
       closeAbout, closeShortcuts, closeGotoLine]);
}
