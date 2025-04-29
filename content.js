// content.js

const targetWebsites = [
  "https://chatgpt.com",
  "https://www.netflix.com/bd/login",
  "https://bypass.hix.ai",
];

function checkTargetWebsite() {
  const currentUrl = window.location.href;

  console.log("Current URL:", currentUrl);
  console.log("Target Websites:", targetWebsites);

  for (let website of targetWebsites) {
    if (currentUrl.includes(website)) {
      console.log("Target website matched, opening extension popup");
      // Instead of trying to directly open the popup, just notify the user
      // The popup cannot be opened programmatically due to browser security
      const notification = document.createElement('div');
      notification.style.position = 'fixed';
      notification.style.top = '10px';
      notification.style.right = '10px';
      notification.style.padding = '10px';
      notification.style.background = 'rgba(233, 113, 27, 0.9)';
      notification.style.color = 'white';
      notification.style.borderRadius = '5px';
      notification.style.zIndex = '9999';
      notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
      notification.style.transition = 'opacity 0.3s ease';
      notification.style.cursor = 'pointer';
      notification.innerHTML = 'Click to open UpEasy extension';
      
      notification.addEventListener('click', () => {
        // This will make the user click on the extension icon
        notification.style.opacity = '0';
        setTimeout(() => {
          notification.remove();
        }, 300);
      });
      
      document.body.appendChild(notification);
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
          notification.remove();
        }, 300);
      }, 5000);
      
      break;
    }
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkTargetWebsite);
} else {
  checkTargetWebsite();
}