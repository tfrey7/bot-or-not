// Page chrome — generic widgets that wrap the reports page itself rather
// than any one tab: the tab bar, the shared confirm modal, and the
// dev-mode badge.

export { pageInstallDevBadge } from "./dev_badge.ts";
export { pageInitConfirmModal, pageOpenConfirmModal } from "./confirm_modal.ts";
export { pageInitTabs, type PageTab } from "./tabs.ts";
