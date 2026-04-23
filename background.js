console.log("[Bot or Not] background loaded");

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "open-tabs") {
    message.urls.forEach((url) => {
      browser.tabs.create({ url });
    });
  }
});
