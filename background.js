// background.js

// Event listener for opening popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openPopup") {
    // Don't try to open popup from background script - this causes errors
    console.log("Received openPopup message");
  } else if (message.action === "startCookieTimer") {
    startCookieTimer(message.data);
  }
});

// Function to start the cookie timer monitoring
function startCookieTimer(timerData) {
  console.log("Starting cookie timer for", timerData.targetUrl);

  // Check for existing alarm and clear it
  chrome.alarms.clear("cookieClearAlarm", () => {
    // Create a new alarm for 5 minutes
    chrome.alarms.create("cookieClearAlarm", {
      delayInMinutes: 1,
    });

    console.log("Alarm set to clear cookies in 5 minutes");
  });
}

// Listen for alarm trigger
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "cookieClearAlarm") {
    console.log("Cookie clear alarm triggered");

    // Get the timer data from storage
    const data = await chrome.storage.local.get("cookieTimer");
    if (!data.cookieTimer) {
      console.log("No cookie timer data found");
      return;
    }

    const { targetUrl, cookies } = data.cookieTimer;

    // Execute the cookie clearing
    await clearCookiesForTarget(targetUrl, cookies);

    // Clean up storage
    chrome.storage.local.remove("cookieTimer");
  }
});

// Function to clear cookies for a specific target
async function clearCookiesForTarget(targetUrl, cookies) {
  try {
    console.log(`Auto-clearing cookies for ${targetUrl}`);

    if (!targetUrl) {
      console.log("No target URL provided");
      return;
    }

    // Extract domain information
    const url = new URL(targetUrl);
    const domain = url.hostname;

    // Display notification to user - handle this properly
    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "UpEasy",
        message: `Access session expired for ${domain}`,
      });
    } catch (notificationError) {
      console.log("Could not create notification:", notificationError);
    }

    // Fix for the cookies domain issue
    // Get all cookies for the domain (with and without dot prefix)
    let allDomainCookies = [];
    try {
      const domainCookies = await chrome.cookies.getAll({ domain });
      allDomainCookies = allDomainCookies.concat(domainCookies);
    } catch (error) {
      console.error(`Error getting cookies for ${domain}:`, error);
    }

    // Also check for cookies with dot prefix
    try {
      const dotDomainCookies = await chrome.cookies.getAll({
        domain: `.${domain}`,
      });
      allDomainCookies = allDomainCookies.concat(dotDomainCookies);
    } catch (error) {
      console.error(`Error getting cookies for .${domain}:`, error);
    }

    let removedCount = 0;

    // Remove each cookie with proper error handling
    for (const cookie of allDomainCookies) {
      try {
        // Create the proper URL format for the cookie
        let cookieDomain = cookie.domain;
        if (cookieDomain.startsWith(".")) {
          cookieDomain = cookieDomain.substring(1);
        }

        const cookieUrl = `${
          cookie.secure ? "https" : "http"
        }://${cookieDomain}${cookie.path}`;

        // Remove the cookie
        await chrome.cookies.remove({
          url: cookieUrl,
          name: cookie.name,
        });
        removedCount++;
        console.log(
          `Successfully removed cookie: ${cookie.name} from ${cookieUrl}`
        );
      } catch (error) {
        console.error(`Error removing cookie ${cookie.name}:`, error.message);
      }
    }

    console.log(`Auto-cleared ${removedCount} cookies for ${domain}`);

    // Try to reload any open tabs for this domain - with proper error handling
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          if (!tab.url) continue;

          const tabUrl = new URL(tab.url);
          if (
            tabUrl.hostname === domain ||
            tabUrl.hostname.endsWith("." + domain)
          ) {
            chrome.tabs.reload(tab.id);
          }
        } catch (tabError) {
          console.error("Error processing tab:", tabError);
        }
      }
    } catch (tabsError) {
      console.error("Error querying tabs:", tabsError);
    }
  } catch (error) {
    console.error("Error in clearCookiesForTarget:", error);
  }
}
