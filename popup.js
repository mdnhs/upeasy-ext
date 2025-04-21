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

async function reloadRelevantTab(targetUrl, cookies) {
  try {
    // Extract domain from targetUrl or first cookie's domain
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
      console.warn("No valid domain found for tab reload");
      return false;
    }

    // Query active tabs
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      console.warn("No active tab found");
      return false;
    }

    const activeTab = tabs[0];
    const tabUrl = new URL(activeTab.url);

    // Check if active tab's domain matches
    if (tabUrl.hostname === domain || tabUrl.hostname.endsWith("." + domain)) {
      await chrome.tabs.reload(activeTab.id);
      console.log(`Reloaded tab: ${activeTab.url}`);
      return true;
    } else {
      console.log(
        `Active tab (${tabUrl.hostname}) does not match target domain (${domain})`
      );
      return false;
    }
  } catch (error) {
    console.error("Failed to reload tab:", error.message);
    return false;
  }
}

async function clearAllCookies(targetUrl, cookies, statusDiv) {
  let removedCount = 0;
  const domainsToCheck = [];

  // Add domains from targetUrl
  if (targetUrl) {
    try {
      const url = new URL(targetUrl);
      domainsToCheck.push(url.hostname); // e.g., chatgpt.com
      domainsToCheck.push("." + url.hostname); // e.g., .chatgpt.com
    } catch (error) {
      console.warn("Invalid targetUrl:", targetUrl, error.message);
    }
  }

  // Add domains from cookies
  cookies.forEach((cookie) => {
    const domain = cookie.domain.startsWith(".")
      ? cookie.domain
      : "." + cookie.domain;
    const nonDotDomain = cookie.domain.startsWith(".")
      ? cookie.domain.substring(1)
      : cookie.domain;
    domainsToCheck.push(domain, nonDotDomain);
  });

  // Remove duplicates
  const uniqueDomains = [...new Set(domainsToCheck)];
  console.log("Domains to check for cookie clearing:", uniqueDomains);

  if (uniqueDomains.length === 0) {
    console.warn("No domains identified for cookie clearing");
    showStatus("Error: No domains available to clear cookies.", "error");
    return 0;
  }

  for (const domain of uniqueDomains) {
    try {
      // Fetch all cookies for the domain
      const domainCookies = await chrome.cookies.getAll({ domain });
      console.log(
        `Found ${domainCookies.length} cookies for domain: ${domain}`,
        domainCookies.map((c) => c.name)
      );

      for (const cookie of domainCookies) {
        try {
          const cookieUrl = `${cookie.secure ? "https://" : "http://"}${
            cookie.domain
          }${cookie.path}`;
          await chrome.cookies.remove({
            url: cookieUrl,
            name: cookie.name,
          });
          console.log(
            `Removed cookie: ${cookie.name} for domain: ${cookie.domain}, path: ${cookie.path}`
          );
          removedCount++;
        } catch (error) {
          console.error(
            `Failed to remove cookie ${cookie.name} for domain ${cookie.domain}:`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error(
        `Failed to fetch cookies for domain ${domain}:`,
        error.message
      );
    }
  }

  console.log(`Total cookies removed: ${removedCount}`);
  return removedCount;
}

async function importCookies(cookies, statusDiv, targetUrl = "") {
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

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
      console.log(`Set cookie: ${cookie.name} for domain: ${cookie.domain}`);
      successCount++;
    } catch (error) {
      console.error(
        `Failed to set cookie ${cookie.name || "unknown"}:`,
        error.message
      );
      errorCount++;
      errors.push(`Cookie "${cookie.name || "unknown"}": ${error.message}`);
    }
  }

  let statusMessage = `Imported ${successCount} cookies successfully. ${errorCount} failed.`;
  if (errorCount > 0) {
    statusMessage += `\nErrors:\n${errors.join("\n")}`;
  }

  // Store targetUrl and cookies for later clearing
  lastTargetUrl = targetUrl;
  lastCookies = cookies;

  // Reload tab if any cookies were imported
  if (successCount > 0) {
    const reloaded = await reloadRelevantTab(targetUrl, cookies);
    if (reloaded) {
      // Add delay to ensure cookies are set and tab reload is complete
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("Attempting to clear all cookies after tab reload");
      const removedCount = await clearAllCookies(targetUrl, cookies, statusDiv);
      statusMessage += `\nCleared ${removedCount} cookies after tab reload.`;
      if (removedCount === 0) {
        statusMessage += `\nWarning: No cookies were found to clear. Check console logs for details.`;
      }
    } else {
      statusMessage += `\nNo tab reloaded (active tab does not match domain); cookies not cleared.`;
    }
  }

  showStatus(
    statusMessage,
    errorCount > 0 || statusMessage.includes("Warning") ? "error" : "success"
  );
}

document.getElementById("getAccess").addEventListener("click", async () => {
  const statusDiv = document.getElementById("status");
  const getAccessButton = document.getElementById("getAccess");

  getAccessButton.disabled = true;
  showStatus("Fetching cookies from Strapi...", "success");

  try {
    // Read documentId from clipboard
    const documentId = (await navigator.clipboard.readText()).trim();
    if (!documentId) {
      throw new Error("Clipboard is empty or contains no valid documentId");
    }
    console.log(`Retrieved documentId from clipboard: ${documentId}`);

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
      showStatus("No tool found for the specified documentId", "error");
      return;
    }

    const cookies = tool.toolData || [];
    if (cookies.length === 0) {
      showStatus("No cookies available in the tool data", "error");
      return;
    }

    // Import cookies, reload tab, and clear cookies
    await importCookies(cookies, statusDiv, tool.targetUrl || "");
  } catch (error) {
    showStatus(`Failed to fetch cookies: ${error.message}`, "error");
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
  console.warn(
    `Invalid sameSite value: ${sameSite}. Defaulting to 'unspecified'.`
  );
  return "unspecified";
}

function showStatus(message, type) {
  const statusDiv = document.getElementById("status");
  statusDiv.textContent = message;
  statusDiv.className = type;
}
