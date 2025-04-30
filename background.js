function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: title,
    message: message,
  });
}

// Listener for alarm triggers
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "autoRemoveCookies") {
    await clearTargetCookies();

    // Clear the storage
    await chrome.storage.local.remove([
      "autoRemovalScheduled",
      "scheduledRemovalTime",
    ]);

    // Send notification
    showNotification("Thank you!", "Automatically cleared cookies");
  }
});

// Cookie clearing function
async function clearTargetCookies() {
  const targetDomains = ["chatgpt.com", "netflix.com", "hix.ai"];

  let totalCleared = 0;

  for (const domain of targetDomains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const cookie of cookies) {
        // Remove leading dot from cookie.domain, if present
        const normalizedDomain = cookie.domain.startsWith(".")
          ? cookie.domain.slice(1)
          : cookie.domain;
        const url = `${
          cookie.secure ? "https://" : "http://"
        }${normalizedDomain}${cookie.path}`;
        await chrome.cookies.remove({ url, name: cookie.name });
        totalCleared++;
      }
    } catch (error) {
      showNotification("Please login", `Do login in ${domain}`);
    }
  }

  // showNotification(
  //   "Clearing Complete",
  //   `Automatically cleared ${totalCleared} items`
  // );
  // Reload tabs matching the target domains
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url) {
        const tabUrl = new URL(tab.url);
        const tabDomain = tabUrl.hostname;
        // Check if tab's domain or subdomain matches any target domain
        for (const domain of targetDomains) {
          if (tabDomain === domain || tabDomain.endsWith(`.${domain}`)) {
            await chrome.tabs.reload(tab.id);
            break;
          }
        }
      }
    }
  } catch (error) {
    showNotification("Tab Reload Error", "Failed to reload tabs");
  }
  return totalCleared;
}

// Ensure alarms persist across extension restarts
chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get([
    "autoRemovalScheduled",
    "scheduledRemovalTime",
  ]);

  if (result.autoRemovalScheduled && result.scheduledRemovalTime) {
    const timeLeft = result.scheduledRemovalTime - Date.now();
    if (timeLeft > 0) {
      chrome.alarms.create("autoRemoveCookies", {
        when: result.scheduledRemovalTime,
      });
    } else {
      // If time has passed but wasn't executed
      await clearTargetCookies();
      await chrome.storage.local.remove([
        "autoRemovalScheduled",
        "scheduledRemovalTime",
      ]);
    }
  }
});
