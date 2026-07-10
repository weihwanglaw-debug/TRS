import React from "react";

export type AdminTabItem<T extends string> = {
  key: T;
  label: React.ReactNode;
};

type AdminTabsProps<T extends string> = {
  tabs: AdminTabItem<T>[];
  activeKey: T;
  onChange: (key: T) => void;
  className?: string;
};

export default function AdminTabs<T extends string>({
  tabs,
  activeKey,
  onChange,
  className = "",
}: AdminTabsProps<T>) {
  return (
    <div className={`tab-bar mb-6 ${className}`.trim()}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          className={`tab-btn ${activeKey === tab.key ? "active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
