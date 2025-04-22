// JsonFormat class (non-module version)
/**
 * This class is responsible for parsing and formatting cookies to the JSON format.
 */
const JsonFormat = {
  /**
   * Parses a string of cookie in the JSON format to a cookie object.
   * @param {string} cookieString Cookies in the JSON format.
   * @return {object} List of Cookies.
   */
  parse(cookieString) {
    return JSON.parse(cookieString);
  },

  /**
   * Formats a list of cookies into a JSON formatted string.
   * @param {Cookie[]} cookies Cookies to format.
   * @return {string} JSON formatted cookie string.
   */
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

const API_TOKEN =
  "c1c760298b5f5fa14c91ce1a8464f93833f135559ac9df79f79552a1321f8d62fd85fe13377b731a69dc778fe247eaf5c49d9bfd1ca95e577261e2b2884dc8b22fe991aa678c9670e2ec0490df6e616fa3e73bc9ebc9e9c67190726fa17a4734a4e6792e80ddafd239fec11c5726139bc02bae4bdef7417fb7b088e235aabccb";

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
  let removedCount = 0;
  const domainsToCheck = [];

  if (targetUrl) {
    try {
      const url = new URL(targetUrl);
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
    domainsToCheck.push(domain, nonDotDomain);
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
  if (removedCount > 0) {
    setTimeout(() => {
      window.close();
    }, 100);
  }
  return removedCount;
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

  if (successCount > 0) {
    const reloaded = await reloadRelevantTab(targetUrl, cookies);
    if (reloaded) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await clearAllCookies(targetUrl, cookies);
    }
  }
}

document.getElementById("getAccess").addEventListener("click", async () => {
  const getAccessButton = document.getElementById("getAccess");
  getAccessButton.disabled = true;

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

    let cookies = [];
    if (tool.accessData) {
      const ENCRYPTION_KEY = "Ad@5$%^28?3#7&$#";
      try {
        // Await the decrypt function
        const decryptedData = await decrypt(tool.accessData, ENCRYPTION_KEY);
        // Parse the decrypted JSON
        cookies = JsonFormat.parse(decryptedData);
      } catch (error) {
        console.error("Decryption or parsing error:", error);
        throw new Error("Invalid encrypted data or wrong key");
      }
    } else {
      // Handle non-encrypted data (original behavior)
      cookies = tool.accessData || [];
    }

    if (cookies.length === 0) {
      throw new Error("No valid cookies found");
    }

    await importCookies(cookies, tool.targetUrl || "");
  } catch (error) {
    console.error("Error:", error.message);
    // Optionally notify user of the error
    // sendNotification(error.message);
  } finally {
    getAccessButton.disabled = false;
  }
});

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
