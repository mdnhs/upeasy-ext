function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: title,
    message: message,
  });
}

const JsonFormat = {
  parse(cookieString) {
    return JSON.parse(cookieString);
  },

  format(cookies) {
    const exportedCookies = [];
    for (const cookieId in cookies) {
      if (!Object.prototype.hasOwnProperty.call(cookies, cookieId)) {
        continue;
      }
      const exportedCookie = cookies[cookieId].cookie;
      exportedCookie.storeId = null;
      if (exportedCookie.sameSite === "unspecified") {
        exportedCookie.sameSite = null;
      }
      exportedCookies.push(exportedCookie);
    }
    return JSON.stringify(exportedCookies, null, 4);
  },
};

let lastTargetUrl = "";
let lastCookies = [];

const protectedWebsites = ["https://www.netflix.com"];

const API_TOKEN =
  "c1c760298b5f5fa14c91ce1a8464f93833f135559ac9df79f79552a1321f8d62fd85fe13377b731a69dc778fe247eaf5c49d9bfd1ca95e577261e2b2884dc8b22fe991aa678c9670e2ec0490df6e616fa3e73bc9ebc9e9c67190726fa17a4734a4e6792e80ddafd239fec11c5726139bc02bae4bdef7417fb7b088e235aabccb";

// Auto-removal settings
const REMOVAL_DELAY_MINUTES = 0.3; // Set to 1 minute for demo (use 5 for production)

function validateCookie(cookie) {
  if (!cookie.name || typeof cookie.name !== "string") {
    throw new Error("Cookie name is missing or invalid");
  }
  if (!cookie.value || typeof cookie.value !== "string") {
    throw new Error("Cookie value is missing or invalid");
  }
  if (!cookie.domain || typeof cookie.domain !== "string") {
    throw new Error("Cookie domain is missing or invalid");
  }
  if (
    !/^(\.?[a-zA-Z0-9-]+\.[a-zA-Z]{2,})$/.test(cookie.domain.replace(/^\./, ""))
  ) {
    throw new Error(`Invalid domain: ${cookie.domain}`);
  }
  return true;
}

async function decrypt(text, encryptionKey) {
  const [ivHex, encryptedHex] = text.split(":");
  if (!ivHex || !encryptedHex) throw new Error("Invalid encrypted format");

  const decoder = new TextDecoder();
  const keyData = new TextEncoder().encode(
    encryptionKey.padEnd(16, "\0").slice(0, 16)
  );
  const iv = new Uint8Array(
    ivHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );
  const encryptedData = new Uint8Array(
    encryptedHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: iv,
    },
    key,
    encryptedData
  );

  return decoder.decode(decrypted);
}

function isProtectedDomain(domain) {
  if (!domain) return false;

  const normalizedDomain = domain.replace(/^www\./, "");

  return protectedWebsites.some((protectedSite) => {
    return (
      normalizedDomain === protectedSite ||
      normalizedDomain.endsWith("." + protectedSite)
    );
  });
}

async function reloadRelevantTab(targetUrl, cookies) {
  try {
    let domain = "";
    if (targetUrl) {
      const url = new URL(targetUrl);
      domain = url.hostname;
    } else if (cookies.length > 0) {
      domain = cookies[0].domain.startsWith(".")
        ? cookies[0].domain.substring(1)
        : cookies[0].domain;
    }

    if (!domain) {
      return false;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      return false;
    }

    const activeTab = tabs[0];
    const tabUrl = new URL(activeTab.url);

    if (tabUrl.hostname === domain || tabUrl.hostname.endsWith("." + domain)) {
      await chrome.tabs.reload(activeTab.id);
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

async function clearAllCookies(targetUrl, cookies) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      const activeTab = tabs[0];
      const tabUrl = new URL(activeTab.url);

      if (isProtectedDomain(tabUrl.hostname)) {
        console.log("Protected website detected. Skipping cookie clearing.");
        return 0;
      }
    }

    let removedCount = 0;
    const domainsToCheck = [];

    if (targetUrl) {
      try {
        const url = new URL(targetUrl);
        if (isProtectedDomain(url.hostname)) {
          console.log("Protected target website. Skipping cookie clearing.");
          return 0;
        }
        domainsToCheck.push(url.hostname);
        domainsToCheck.push("." + url.hostname);
      } catch (error) {}
    }

    cookies.forEach((cookie) => {
      const domain = cookie.domain.startsWith(".")
        ? cookie.domain
        : "." + cookie.domain;
      const nonDotDomain = cookie.domain.startsWith(".")
        ? cookie.domain.substring(1)
        : cookie.domain;

      if (!isProtectedDomain(nonDotDomain)) {
        domainsToCheck.push(domain, nonDotDomain);
      }
    });

    const uniqueDomains = [...new Set(domainsToCheck)];

    if (uniqueDomains.length === 0) {
      return 0;
    }

    for (const domain of uniqueDomains) {
      try {
        const domainCookies = await chrome.cookies.getAll({ domain });
        for (const cookie of domainCookies) {
          try {
            const cookieUrl = `${cookie.secure ? "https://" : "http://"}${
              cookie.domain
            }${cookie.path}`;
            await chrome.cookies.remove({
              url: cookieUrl,
              name: cookie.name,
            });
            removedCount++;
          } catch (error) {}
        }
      } catch (error) {}
    }

    console.log(`Cleared ${removedCount} cookies`);
    return removedCount;
  } catch (error) {
    console.error("Error in clearAllCookies:", error);
    return 0;
  }
}

function getCookieUrl(cookie) {
  const protocol = cookie.secure ? "https://" : "http://";
  const domain = cookie.domain.startsWith(".")
    ? cookie.domain.substring(1)
    : cookie.domain;
  const path = cookie.path || "/";
  return `${protocol}${domain}${path}`;
}

function getSameSite(sameSite) {
  if (!sameSite) return "unspecified";
  sameSite = sameSite.toLowerCase();
  const validValues = ["no_restriction", "lax", "strict"];
  if (validValues.includes(sameSite)) return sameSite;
  return "unspecified";
}

async function importCookies(cookies, targetUrl = "") {
  let successCount = 0;
  let errorCount = 0;

  for (const cookie of cookies) {
    try {
      validateCookie(cookie);
      const expirationDate = cookie.expirationDate
        ? cookie.expirationDate
        : undefined;

      await chrome.cookies.set({
        url: getCookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || "/",
        secure: cookie.secure || false,
        httpOnly: cookie.httpOnly || false,
        sameSite: getSameSite(cookie.sameSite),
        expirationDate: expirationDate,
        storeId: cookie.storeId || undefined,
      });
      successCount++;
    } catch (error) {
      errorCount++;
    }
  }

  lastTargetUrl = targetUrl;
  lastCookies = cookies;

  // In your getAccess handler, after successful cookie import:
  if (successCount > 0) {
    // Clear any existing alarm
    await chrome.alarms.clear("autoRemoveCookies");

    // Create new alarm
    const alarmTime = Date.now() + REMOVAL_DELAY_MINUTES * 60 * 1000;
    chrome.alarms.create("autoRemoveCookies", {
      delayInMinutes: REMOVAL_DELAY_MINUTES,
    });

    // Store in storage
    await chrome.storage.local.set({
      autoRemovalScheduled: true,
      scheduledRemovalTime: alarmTime,
    });

    // Update UI
    document.getElementById(
      "status"
    ).textContent = `Auto-removal in ${REMOVAL_DELAY_MINUTES} minute(s)`;
    showNotification("Login Successful", "Enjoy your experience!");
    const reloaded = await reloadRelevantTab(targetUrl, cookies);
    if (reloaded) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function loginToNetflix(email, password) {
  const emailXPath = '//*[@id=":r0:"]';
  const passwordXPath = '//*[@id=":r3:"]';

  function getElementByXPath(xpath) {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }

  const emailField = getElementByXPath(emailXPath);
  const passwordField = getElementByXPath(passwordXPath);
  const signInButton = document.querySelector('button[type="submit"]');

  if (!emailField || !passwordField || !signInButton) {
    console.error("Required fields or button not found.");
    return;
  }

  emailField.value = email;
  emailField.dispatchEvent(new Event("input", { bubbles: true }));

  passwordField.value = password;
  passwordField.dispatchEvent(new Event("input", { bubbles: true }));

  signInButton.click();
}

// Function to handle removeAccess button click
// async function handleRemoveAccess() {
//   const removeButton = document.getElementById("removeAccess");
//   const statusDiv = document.getElementById("status");

//   removeButton.disabled = true;
//   statusDiv.textContent = "Clearing cookies...";

//   const targetDomains = ["chatgpt.com", "netflix.com", "hix.ai"];

//   let cookiesClearedCount = 0;

//   for (const domain of targetDomains) {
//     try {
//       const cookies = await chrome.cookies.getAll({ domain });

//       for (const cookie of cookies) {
//         const protocol = cookie.secure ? "https:" : "http:";
//         const urlDomain = cookie.domain.startsWith(".")
//           ? cookie.domain.substring(1)
//           : cookie.domain;
//         const cookieUrl = `${protocol}//${urlDomain}${cookie.path}`;

//         try {
//           await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
//           cookiesClearedCount++;
//         } catch (error) {
//           console.error(
//             `Error removing cookie ${cookie.name} for ${domain}:`,
//             error
//           );
//         }
//       }
//     } catch (error) {
//       console.error(`Error getting cookies for ${domain}:`, error);
//     }
//   }

//   // Clear any scheduled removal
//   await chrome.alarms.clear("autoRemoveCookies");
//   await chrome.storage.local.remove([
//     "autoRemovalScheduled",
//     "scheduledRemovalTime",
//   ]);

//   statusDiv.textContent = `Cleared ${cookiesClearedCount} cookies`;
//   removeButton.disabled = false;

//   console.log(`Manually cleared ${cookiesClearedCount} cookies`);
// }

// Check for pending removal when popup opens
function checkScheduledRemoval() {
  chrome.storage.local.get(
    ["autoRemovalScheduled", "scheduledRemovalTime"],
    (result) => {
      if (result.autoRemovalScheduled && result.scheduledRemovalTime) {
        const timeLeft = Math.max(0, result.scheduledRemovalTime - Date.now());
        if (timeLeft > 0) {
          const minutes = Math.floor(timeLeft / 60000);
          const seconds = Math.floor((timeLeft % 60000) / 1000);
          console.log(`Auto-removal scheduled in ${minutes}m ${seconds}s`);
          document.getElementById(
            "status"
          ).textContent = `Auto-removal in ${minutes}m ${seconds}s`;
        } else {
          // Time has passed but removal hasn't happened yet
          document.getElementById("status").textContent = "Removal pending...";
        }
      }
    }
  );
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Set up button event listeners
  document
    .getElementById("getAccess")
    .addEventListener("click", handleGetAccess);
  // document
  //   .getElementById("removeAccess")
  //   .addEventListener("click", handleRemoveAccess);
  document
    .getElementById("closeBtn")
    .addEventListener("click", () => window.close());

  // Check for scheduled removal
  checkScheduledRemoval();
});

// Main getAccess function
async function handleGetAccess() {
  const getAccessButton = document.getElementById("getAccess");
  getAccessButton.disabled = true;
  const statusDiv = document.getElementById("status");
  statusDiv.textContent = "Processing...";

  try {
    const documentId = (await navigator.clipboard.readText()).trim();
    if (!documentId) {
      throw new Error("Clipboard is empty or contains no valid documentId");
    }

    const response = await fetch(
      `https://admin.upeasybd.com/api/tools/${encodeURIComponent(documentId)}`,
      {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const tool = data.data;

    if (!tool) {
      throw new Error("No tool data received");
    }

    if (tool.isEmailLogin) {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length === 0) {
        throw new Error("No active tab found");
      }

      const activeTab = tabs[0];
      if (activeTab.url && activeTab.url === tool.targetUrl) {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: loginToNetflix,
          args: [tool.email, tool.password],
        });

        // Schedule removal for email login too
        await chrome.alarms.clear("autoRemoveCookies");
        chrome.alarms.create("autoRemoveCookies", {
          delayInMinutes: REMOVAL_DELAY_MINUTES,
        });
        await chrome.storage.local.set({
          autoRemovalScheduled: true,
          scheduledRemovalTime: Date.now() + REMOVAL_DELAY_MINUTES * 60 * 1000,
        });

        statusDiv.textContent = "Login initiated - auto-removal scheduled";
        showNotification("Login Successful", "Enjoy your experience!");
        setTimeout(() => window.close(), 1000);
        return;
      } else {
        alert(
          `Please navigate to ${tool.targetUrl} to use email/password login.`
        );
        setTimeout(() => window.close(), 100);
        return;
      }
    }

    let cookies = [];
    if (tool.accessData) {
      const ENCRYPTION_KEY = "Ad@5$%^28?3#7&$#";
      try {
        const decryptedData = await decrypt(tool.accessData, ENCRYPTION_KEY);
        cookies = JsonFormat.parse(decryptedData);
      } catch (error) {
        console.error("Decryption or parsing error:", error);
        throw new Error("Invalid encrypted data or wrong key");
      }
    } else {
      cookies = tool.accessData || [];
    }

    if (cookies.length === 0) {
      throw new Error("No valid cookies found");
    }

    await importCookies(cookies, tool.targetUrl || "");
    statusDiv.textContent = "Cookies imported - auto-removal scheduled";

    setTimeout(() => window.close(), 1000);
  } catch (error) {
    console.error("Error:", error.message);
    statusDiv.textContent = `Error: ${error.message}`;

    // Clean up any alarms on error
    await chrome.alarms.clear("autoRemoveCookies");
    await chrome.storage.local.remove([
      "autoRemovalScheduled",
      "scheduledRemovalTime",
    ]);
  } finally {
    getAccessButton.disabled = false;
  }
}

async function debugAlarmState() {
  const alarm = await chrome.alarms.get("autoRemoveCookies");
  const storage = await chrome.storage.local.get([
    "autoRemovalScheduled",
    "scheduledRemovalTime",
  ]);

  console.log("Current Alarm:", alarm);
  console.log("Storage State:", storage);

  if (alarm) {
    const timeLeft = alarm.scheduledTime - Date.now();
    const mins = Math.floor(timeLeft / 60000);
    const secs = Math.floor((timeLeft % 60000) / 1000);
    console.log(`Alarm scheduled to trigger in ${mins}m ${secs}s`);
  }
}
