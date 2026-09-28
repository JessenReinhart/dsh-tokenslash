import React from "react";
import SettingsCard from "./components/SettingsCard.jsx";

export function apply(ctx) {
  if (!ctx.slots) return;

  // 1. Settings plugin item: Sidebar -> Settings -> Plugins -> dsh-tokenslash
  ctx.slots.inject("settings.plugin.item", () =>
    ctx.slots.register(
      {
        name: "settings.plugin.item",
        key: "dsh-tokenslash",
      },
      (slotProps) =>
        slotProps && slotProps.view === "summary"
          ? "TypeSafe Jev token trimming: subagent routing, fork decoupling, tool pruning, compaction, goal guard"
          : React.createElement(SettingsCard, { page: true })
    )
  );

  // 2. Plugin row config: Sidebar -> Plugins -> Installed -> dsh-tokenslash -> row config
  ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register(
      {
        name: "plugins.row.config",
        key: "dsh-tokenslash#tokenslash",
      },
      (slotProps) =>
        slotProps && slotProps.view === "summary"
          ? "TypeSafe Jev token trimming suite, subagent routing & output compaction"
          : React.createElement(SettingsCard, { page: true })
    )
  );
}

export function inject(ctx) {
  apply(ctx);
}
