// Page chrome — generic widgets that wrap the reports page itself rather
// than any one tab: the tab bar, the AI command bar + chat modal, the
// shared confirm modal, and the dev-mode badge.

export { pageInstallDevBadge } from "./dev_badge.ts";
export {
  pageInitCommandBar,
  type PageCommandBarHandle,
} from "./command_bar.ts";
export { pageInitConfirmModal, pageOpenConfirmModal } from "./confirm_modal.ts";
export { pageInitTabs, type PageTab } from "./tabs.ts";
