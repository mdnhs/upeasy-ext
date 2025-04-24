// content.js

const targetWebsites = [
  "https://chatgpt.com", 
  "https://www.netflix.com", 
  "https://bypass.hix.ai",
];
function checkTargetWebsite() {
  const currentUrl = window.location.href;

  console.log("Current URL:", currentUrl); 
  console.log("Target Websites:", targetWebsites);

  for (let website of targetWebsites) {
    if (currentUrl.includes(website)) {
      console.log("Target website matched, sending message to open popup");
      chrome.runtime.sendMessage({ action: "openPopup" });
      break;
    }
  }
}

checkTargetWebsite();
