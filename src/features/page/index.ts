// Page chrome — generic widgets that wrap the reports page itself rather
// than any one tab: the tab bar, the AI command bar + chat modal, the
// shared confirm modal, and the dev-mode strand badge.

export { bonPageInstallStrandBadge } from "./strand_badge.ts";
export {
  bonPageInitCommandBar,
  type BonPageCommandBarDeps,
  type BonPageCommandBarHandle,
} from "./command_bar.ts";
export { bonPageOpenCommandModal } from "./command_modal.ts";
export {
  bonPageInitConfirmModal,
  bonPageOpenConfirmModal,
  type ConfirmModalOpts,
} from "./confirm_modal.ts";
export {
  bonPageInitTabs,
  type BonPageTab,
  type BonPageTabsHandle,
} from "./tabs.ts";
