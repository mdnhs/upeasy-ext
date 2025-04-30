// Constants
const CONFIG = {
  API_URL: "https://admin.upeasybd.com/api/tools/",
  API_TOKEN:
    "c1c760298b5f5fa14c91ce1a8464f93833f135559ac9df79f79552a1321f8d62fd85fe13377b731a69dc778fe247eaf5c49d9bfd1ca95e577261e2b2884dc8b22fe991aa678c9670e2ec0490df6e616fa3e73bc9ebc9e9c67190726fa17a4734a4e6792e80ddafd239fec11c5726139bc02bae4bdef7417fb7b088e235aabccb",
  ENCRYPTION_KEY: "Ad@5$%^28?3#7&$#",
  REMOVAL_DELAY_MINUTES: 0.3,
};

// State
let state = {
  lastTargetUrl: "",
  lastCookies: [],
};

/**
 * Notification Module
 */
const NotificationService = {
  show(title, message) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: title,
      message: message,
    });
  },
};

/**
 * Cookie Format Module
 */
const CookieFormatter = {
  parse(cookieString) {
    if (!cookieString) {
      throw new Error("Cannot parse empty cookie string");
    }
    try {
      return JSON.parse(cookieString);
    } catch (error) {
      console.error("JSON parsing error:", error);
      throw new Error("Failed to parse cookie data: " + error.message);
    }
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

/**
 * Cookie Validator
 */
const CookieValidator = {
  validate(cookie) {
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
      !/^(\.?[a-zA-Z0-9-]+\.[a-zA-Z]{2,})$/.test(
        cookie.domain.replace(/^\./, "")
      )
    ) {
      throw new Error(`Invalid domain: ${cookie.domain}`);
    }

    return true;
  },
};

/**
 * Crypto Module
 */
const CryptoService = {
  async decrypt(text, encryptionKey) {
    // Check if text is null or undefined
    if (!text) {
      throw new Error("Cannot decrypt null or undefined text");
    }

    const parts = text.split(":");
    if (parts.length !== 2) {
      throw new Error(
        "Invalid encrypted format: expected format 'iv:encryptedData'"
      );
    }

    const [ivHex, encryptedHex] = parts;
    if (!ivHex || !encryptedHex) {
      throw new Error("Invalid encrypted format: missing iv or encrypted data");
    }

    try {
      const decoder = new TextDecoder();
      const keyData = new TextEncoder().encode(
        encryptionKey.padEnd(16, "\0").slice(0, 16)
      );

      const ivMatches = ivHex.match(/.{1,2}/g);
      if (!ivMatches) {
        throw new Error("Invalid IV format");
      }

      const iv = new Uint8Array(ivMatches.map((byte) => parseInt(byte, 16)));

      const encryptedMatches = encryptedHex.match(/.{1,2}/g);
      if (!encryptedMatches) {
        throw new Error("Invalid encrypted data format");
      }

      const encryptedData = new Uint8Array(
        encryptedMatches.map((byte) => parseInt(byte, 16))
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
    } catch (error) {
      console.error("Decryption error:", error);
      throw new Error(`Decryption failed: ${error.message}`);
    }
  },
};

/**
 * Domain Utility
 */
const DomainUtil = {
  isProtected(domain) {
    if (!domain) return false;

    const normalizedDomain = domain.replace(/^www\./, "");

    return CONFIG.PROTECTED_WEBSITES.some((protectedSite) => {
      return (
        normalizedDomain === protectedSite ||
        normalizedDomain.endsWith("." + protectedSite)
      );
    });
  },

  getCookieUrl(cookie) {
    const protocol = cookie.secure ? "https://" : "http://";
    const domain = cookie.domain.startsWith(".")
      ? cookie.domain.substring(1)
      : cookie.domain;
    const path = cookie.path || "/";
    return `${protocol}${domain}${path}`;
  },
};

/**
 * Tab Manager
 */
const TabManager = {
  async reloadRelevantTab(targetUrl, cookies) {
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

      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length === 0) {
        return false;
      }

      const activeTab = tabs[0];
      const tabUrl = new URL(activeTab.url);

      if (
        tabUrl.hostname === domain ||
        tabUrl.hostname.endsWith("." + domain)
      ) {
        await chrome.tabs.reload(activeTab.id);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Error reloading tab:", error);
      return false;
    }
  },

  async getCurrentTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs.length > 0 ? tabs[0] : null;
  },
};

/**
 * Cookie Manager
 */
const CookieManager = {
  getSameSite(sameSite) {
    if (!sameSite) return "unspecified";
    sameSite = sameSite.toLowerCase();
    const validValues = ["no_restriction", "lax", "strict"];
    if (validValues.includes(sameSite)) return sameSite;
    return "unspecified";
  },

  async importCookies(cookies, targetUrl = "") {
    let successCount = 0;
    let errorCount = 0;

    for (const cookie of cookies) {
      try {
        CookieValidator.validate(cookie);
        const expirationDate = cookie.expirationDate
          ? cookie.expirationDate
          : undefined;

        await chrome.cookies.set({
          url: DomainUtil.getCookieUrl(cookie),
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || "/",
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false,
          sameSite: this.getSameSite(cookie.sameSite),
          expirationDate: expirationDate,
          storeId: cookie.storeId || undefined,
        });
        successCount++;
      } catch (error) {
        console.error("Error importing cookie:", error);
        errorCount++;
      }
    }

    state.lastTargetUrl = targetUrl;
    state.lastCookies = cookies;

    return { successCount, errorCount };
  },

  async clearCookiesForDomains(domains) {
    let cookiesClearedCount = 0;

    for (const domain of domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });

        for (const cookie of cookies) {
          const protocol = cookie.secure ? "https:" : "http:";
          const urlDomain = cookie.domain.startsWith(".")
            ? cookie.domain.substring(1)
            : cookie.domain;
          const cookieUrl = `${protocol}//${urlDomain}${cookie.path}`;

          try {
            await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
            cookiesClearedCount++;
          } catch (error) {
            console.error(
              `Error removing cookie ${cookie.name} for ${domain}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(`Error getting cookies for ${domain}:`, error);
      }
    }

    return cookiesClearedCount;
  },
};

/**
 * Auto Removal Manager
 */
const AutoRemovalManager = {
  async scheduleRemoval() {
    // Clear any existing alarm
    await chrome.alarms.clear("autoRemoveCookies");

    // Create new alarm
    const alarmTime = Date.now() + CONFIG.REMOVAL_DELAY_MINUTES * 60 * 1000;
    chrome.alarms.create("autoRemoveCookies", {
      delayInMinutes: CONFIG.REMOVAL_DELAY_MINUTES,
    });

    // Store in storage
    await chrome.storage.local.set({
      autoRemovalScheduled: true,
      scheduledRemovalTime: alarmTime,
    });

    return alarmTime;
  },

  async cancelScheduledRemoval() {
    await chrome.alarms.clear("autoRemoveCookies");
    await chrome.storage.local.remove([
      "autoRemovalScheduled",
      "scheduledRemovalTime",
    ]);
  },

  async checkScheduledRemoval() {
    const result = await chrome.storage.local.get([
      "autoRemovalScheduled",
      "scheduledRemovalTime",
    ]);

    if (result.autoRemovalScheduled && result.scheduledRemovalTime) {
      const timeLeft = Math.max(0, result.scheduledRemovalTime - Date.now());
      if (timeLeft > 0) {
        const minutes = Math.floor(timeLeft / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        return { minutes, seconds, timeLeft };
      } else {
        return { pending: true };
      }
    }

    return null;
  },
};

/**
 * Netflix Login Helper
 */
const NetflixLoginHelper = {
  async injectLoginScript(tabId, email, password) {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: function (email, password) {
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
          return false;
        }

        emailField.value = email;
        emailField.dispatchEvent(new Event("input", { bubbles: true }));

        passwordField.value = password;
        passwordField.dispatchEvent(new Event("input", { bubbles: true }));

        signInButton.click();
        return true;
      },
      args: [email, password],
    });
  },
};

/**
 * API Service
 */
const ApiService = {
  async fetchTool(documentId) {
    try {
      const response = await fetch(
        `${CONFIG.API_URL}${encodeURIComponent(documentId)}`,
        {
          headers: {
            Authorization: `Bearer ${CONFIG.API_TOKEN}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (!data || !data.data) {
        throw new Error("Invalid API response format");
      }

      return data.data;
    } catch (error) {
      console.error("API fetch error:", error);
      throw new Error(`Failed to fetch tool data: ${error.message}`);
    }
  },
};

/**
 * UI Controller
 */
const UIController = {
  elements: {
    getAccessButton: null,
    statusDiv: null,
    closeBtn: null,
  },

  initialize() {
    this.elements.getAccessButton = document.getElementById("getAccess");
    this.elements.statusDiv = document.getElementById("status");
    this.elements.closeBtn = document.getElementById("closeBtn");

    this.elements.getAccessButton.addEventListener(
      "click",
      this.handleGetAccess
    );
    this.elements.closeBtn.addEventListener("click", () => window.close());

    this.updateRemovalStatus();
  },

  setStatus(message) {
    this.elements.statusDiv.textContent = message;
  },

  setAccessButtonState(isEnabled) {
    this.elements.getAccessButton.disabled = !isEnabled;
  },

  async updateRemovalStatus() {
    const removalStatus = await AutoRemovalManager.checkScheduledRemoval();

    if (removalStatus) {
      if (removalStatus.pending) {
        this.setStatus("Removal pending...");
      } else {
        this.setStatus(
          `Auto-removal in ${removalStatus.minutes}m ${removalStatus.seconds}s`
        );
      }
    }
  },

  handleGetAccess: async function () {
    UIController.setAccessButtonState(false);
    UIController.setStatus("Processing...");

    try {
      const documentId = (await navigator.clipboard.readText()).trim();
      if (!documentId) {
        throw new Error("Clipboard is empty or contains no valid documentId");
      }

      const tool = await ApiService.fetchTool(documentId);

      if (!tool) {
        throw new Error("No tool data received");
      }

      // Check if email and password exist before trying to decrypt
      let decryptedEmail = "";
      let decryptedPassword = "";

      try {
        if (tool.email) {
          decryptedEmail = await CryptoService.decrypt(
            tool.email,
            CONFIG.ENCRYPTION_KEY
          );
        } else {
          console.warn("Tool email is missing");
        }

        if (tool.password) {
          decryptedPassword = await CryptoService.decrypt(
            tool.password,
            CONFIG.ENCRYPTION_KEY
          );
        } else {
          console.warn("Tool password is missing");
        }
      } catch (cryptoError) {
        console.error("Decryption error:", cryptoError);
        // Continue execution as we might still have valid cookies
      }

      if (tool.isEmailLogin) {
        const activeTab = await TabManager.getCurrentTab();

        if (!activeTab) {
          throw new Error("No active tab found");
        }

        if (activeTab.url && activeTab.url === tool.targetUrl) {
          const loginResult = await NetflixLoginHelper.injectLoginScript(
            activeTab.id,
            decryptedEmail,
            decryptedPassword
          );

          if (!loginResult[0].result) {
            throw new Error("Login form not found");
          }

          // Schedule removal for email login too
          await AutoRemovalManager.scheduleRemoval();
          UIController.setStatus("Login initiated - auto-removal scheduled");
          NotificationService.show(
            "Login Successful",
            "Enjoy your experience!"
          );
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
        try {
          const decryptedData = await CryptoService.decrypt(
            tool.accessData,
            CONFIG.ENCRYPTION_KEY
          );
          if (decryptedData) {
            try {
              cookies = CookieFormatter.parse(decryptedData);
            } catch (parseError) {
              console.error("Failed to parse cookie data:", parseError);
              throw new Error("Invalid cookie data format");
            }
          } else {
            throw new Error("Decryption returned empty data");
          }
        } catch (error) {
          console.error("Cookie decryption error:", error);
          throw new Error("Failed to decrypt cookie data: " + error.message);
        }
      } else if (Array.isArray(tool.accessData)) {
        cookies = tool.accessData;
      } else {
        cookies = [];
      }

      if (!Array.isArray(cookies) || cookies.length === 0) {
        throw new Error("No valid cookies found");
      }

      const { successCount } = await CookieManager.importCookies(
        cookies,
        tool.targetUrl || ""
      );

      if (successCount > 0) {
        await AutoRemovalManager.scheduleRemoval();
        UIController.setStatus("Cookies imported - auto-removal scheduled");
        NotificationService.show("Login Successful", "Enjoy your experience!");

        const reloaded = await TabManager.reloadRelevantTab(
          tool.targetUrl,
          cookies
        );
        if (reloaded) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      setTimeout(() => window.close(), 1000);
    } catch (error) {
      UIController.setStatus(`Error: ${error.message}`);
      await AutoRemovalManager.cancelScheduledRemoval();
    } finally {
      UIController.setAccessButtonState(true);
    }
  },
};

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  UIController.initialize();
});

// Function to handle cookie removal (not currently used in UI)
async function handleRemoveAccess() {
  UIController.setAccessButtonState(false);
  UIController.setStatus("Clearing cookies...");

  const targetDomains = ["chatgpt.com", "netflix.com", "hix.ai"];
  const cookiesClearedCount = await CookieManager.clearCookiesForDomains(
    targetDomains
  );

  await AutoRemovalManager.cancelScheduledRemoval();

  UIController.setStatus(`Cleared ${cookiesClearedCount} cookies`);
  UIController.setAccessButtonState(true);

  console.log(`Manually cleared ${cookiesClearedCount} cookies`);
}

// Register for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "autoRemoveCookies") {
    const targetDomains = ["chatgpt.com", "netflix.com", "hix.ai"];
    const cookiesClearedCount = await CookieManager.clearCookiesForDomains(
      targetDomains
    );

    await AutoRemovalManager.cancelScheduledRemoval();

    console.log(`Auto-removed ${cookiesClearedCount} cookies`);
  }
});
