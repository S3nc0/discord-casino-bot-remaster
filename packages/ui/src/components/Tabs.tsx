import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../utils.ts';

export interface TabItem {
  id: string;
  /** Short 1-2 word tab label. */
  label: string;
  /** Optional 24px pixel icon above the label. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Optional panel content rendered when this tab is selected. */
  panel?: ReactNode;
}

export interface TabsProps {
  /** Accessible label for the tablist. */
  label: string;
  /** 2-5 tabs. */
  tabs: readonly TabItem[];
  /** Controlled active tab id. */
  activeId?: string;
  /** Initial active tab id for uncontrolled usage. */
  defaultActiveId?: string;
  /** Called when the user selects a tab. */
  onChange?: (id: string) => void;
  className?: string;
}

export function Tabs({ label, tabs, activeId, defaultActiveId, onChange, className }: TabsProps) {
  const baseId = useId();
  const firstEnabledId = tabs.find((tab) => !tab.disabled)?.id ?? tabs[0]?.id ?? '';
  const [internalActiveId, setInternalActiveId] = useState<string>(
    defaultActiveId ?? firstEnabledId,
  );
  const currentActiveId = activeId !== undefined ? activeId : internalActiveId;
  const [focusedId, setFocusedId] = useState<string>(currentActiveId);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const effectiveFocusedId = tabs.some((t) => t.id === focusedId && !t.disabled)
    ? focusedId
    : currentActiveId;

  const selectTab = (id: string) => {
    if (activeId === undefined) {
      setInternalActiveId(id);
    }
    setFocusedId(id);
    onChange?.(id);
  };

  const moveFocus = (fromIndex: number, direction: 1 | -1 | 'first' | 'last') => {
    const enabledTabs = tabs.filter((t) => !t.disabled);
    if (enabledTabs.length === 0) return;

    let nextTab: TabItem | undefined;
    if (direction === 'first') {
      nextTab = enabledTabs[0];
    } else if (direction === 'last') {
      nextTab = enabledTabs[enabledTabs.length - 1];
    } else {
      const currentTab = tabs[fromIndex];
      const currentEnabledIdx = currentTab
        ? enabledTabs.findIndex((t) => t.id === currentTab.id)
        : 0;
      const start = currentEnabledIdx === -1 ? 0 : currentEnabledIdx;
      const nextIdx = (start + direction + enabledTabs.length) % enabledTabs.length;
      nextTab = enabledTabs[nextIdx];
    }

    if (nextTab) {
      setFocusedId(nextTab.id);
      buttonRefs.current[nextTab.id]?.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, tab: TabItem) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(index, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(index, 'first');
        break;
      case 'End':
        event.preventDefault();
        moveFocus(index, 'last');
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!tab.disabled) {
          selectTab(tab.id);
        }
        break;
    }
  };

  const activeTab = tabs.find((t) => t.id === currentActiveId);

  return (
    <div>
      <div className={cx('bb-tabs', className)} role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const isSelected = tab.id === currentActiveId;
          const isFocusable = !tab.disabled && tab.id === effectiveFocusedId;
          const tabButtonId = `${baseId}-tab-${tab.id}`;
          const panelId = `${baseId}-panel-${tab.id}`;

          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttonRefs.current[tab.id] = el;
              }}
              id={tabButtonId}
              type="button"
              className="bb-tab bb-state"
              role="tab"
              aria-selected={isSelected}
              aria-controls={tab.panel !== undefined ? panelId : undefined}
              disabled={tab.disabled}
              tabIndex={isFocusable ? 0 : -1}
              onClick={() => {
                if (!tab.disabled) {
                  selectTab(tab.id);
                }
              }}
              onFocus={() => setFocusedId(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index, tab)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      {activeTab && activeTab.panel !== undefined && (
        <div
          id={`${baseId}-panel-${activeTab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeTab.id}`}
          tabIndex={0}
        >
          {activeTab.panel}
        </div>
      )}
    </div>
  );
}
