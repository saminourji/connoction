"use strict";
(() => {
  // src/popup.ts
  var BACKEND_URL = "http://127.0.0.1:8000";
  var extractedProfile = null;
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab");
    return tab;
  }
  function setStatus(msg, type = "loading") {
    const el = document.getElementById("status");
    el.textContent = msg;
    el.className = `status ${type}`;
    el.classList.remove("hidden");
  }
  function hideStatus() {
    const el = document.getElementById("status");
    el.classList.add("hidden");
  }
  function showSection(sectionId) {
    document.getElementById(sectionId).classList.remove("hidden");
  }
  function hideSection(sectionId) {
    document.getElementById(sectionId).classList.add("hidden");
  }
  function setButtonLoading(buttonId, loading, originalText) {
    const btn = document.getElementById(buttonId);
    if (loading) {
      btn.disabled = true;
      btn.setAttribute("data-original-text", btn.textContent || "");
      btn.textContent = "\u23F3 Loading...";
      btn.style.opacity = "0.7";
    } else {
      btn.disabled = false;
      btn.textContent = originalText || btn.getAttribute("data-original-text") || btn.textContent;
      btn.style.opacity = "1";
    }
  }
  function extractLinkedInProfile() {
    console.log("\u{1F50D} Starting comprehensive LinkedIn profile extraction...");
    function scrollAndWait(delay = 1e3) {
      return new Promise((resolve) => {
        const positions = [0, 0.25, 0.5, 0.75, 1];
        let currentPosition = 0;
        const scrollStep = () => {
          if (currentPosition < positions.length) {
            const scrollY = document.body.scrollHeight * positions[currentPosition];
            window.scrollTo(0, scrollY);
            console.log(`\u{1F4DC} Scrolling to position ${positions[currentPosition] * 100}%`);
            currentPosition++;
            setTimeout(scrollStep, delay / positions.length);
          } else {
            window.scrollTo(0, 0);
            setTimeout(resolve, 500);
          }
        };
        scrollStep();
      });
    }
    function getVisibleText(element) {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node2) {
            const parent = node2.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const style = window.getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || parent.tagName === "SCRIPT" || parent.tagName === "STYLE" || parent.tagName === "NOSCRIPT") {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      let textContent = "";
      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (text && text.length > 1) {
          textContent += text + " ";
        }
      }
      return textContent.trim();
    }
    return new Promise((resolve) => {
      setTimeout(async () => {
        console.log("\u23F3 Starting comprehensive extraction process...");
        await scrollAndWait(2e3);
        const contentSources = [
          // Main content areas
          'main[role="main"]',
          ".scaffold-layout__main",
          ".scaffold-layout-container__content",
          // Profile sections
          ".pv-top-card",
          ".pv-profile-section",
          ".artdeco-card",
          // Specific sections
          ".pv-about-section",
          ".pv-experience-section",
          ".pv-education-section",
          ".pv-skill-categories-section",
          ".pv-profile-section--education",
          ".pv-profile-section--experience",
          // Modern LinkedIn selectors
          '[data-view-name="profile-component-entity"]',
          ".pvs-list",
          ".pvs-entity"
        ];
        let allTextContent = "";
        let extractedSections = 0;
        contentSources.forEach((selector, index) => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((element, elemIndex) => {
            const visibleText = getVisibleText(element);
            if (visibleText.length > 50) {
              allTextContent += `
--- Section ${index}-${elemIndex} (${selector}) ---
`;
              allTextContent += visibleText + "\n";
              extractedSections++;
            }
          });
        });
        console.log(`\u2705 Extracted visible content from ${extractedSections} sections (no button clicking)`);
        console.log(`\u{1F4CF} Total content length: ${allTextContent.length} characters`);
        if (allTextContent.length < 2e3) {
          console.log("\u26A0\uFE0F Low content extracted, falling back to full body visible text");
          const bodyElement = document.querySelector("body");
          if (bodyElement) {
            allTextContent = getVisibleText(bodyElement);
          }
        }
        if (!allTextContent || allTextContent.length < 500) {
          console.log("\u26A0\uFE0F Very low content, using innerText fallback");
          allTextContent = document.body.innerText || document.body.textContent || "";
        }
        console.log(`\u{1F3AF} Final content length: ${allTextContent.length} characters`);
        resolve({
          linkedinUrl: window.location.href,
          htmlContent: allTextContent,
          // All other fields will be null - LLM will extract everything
          name: null,
          role: null,
          currentCompany: null,
          companies: [],
          highestDegree: null,
          field: null,
          schools: [],
          location: null
        });
      }, 500);
    });
  }
  async function extractProfile() {
    if (extractedProfile) return extractedProfile;
    const tab = await getActiveTab();
    if (!tab.url?.includes("linkedin.com")) {
      throw new Error("Please navigate to a LinkedIn profile page");
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractLinkedInProfile
    });
    extractedProfile = await result.result;
    return extractedProfile;
  }
  async function handleAddToNotion() {
    const buttonId = "addToNotionBtn";
    try {
      setButtonLoading(buttonId, true);
      setStatus("Extracting profile information...", "loading");
      const profile = await extractProfile();
      console.log("Extracted profile:", profile);
      if (!profile.htmlContent) {
        throw new Error("Could not extract page content. Make sure you're on a LinkedIn profile page.");
      }
      const linkedinReached = document.getElementById("linkedinReached").checked;
      const emailReached = document.getElementById("emailReached").checked;
      let linkedinMessage = null;
      let emailMessage = null;
      if (linkedinReached) {
        linkedinMessage = "Reached out - no message specified";
      }
      if (emailReached) {
        emailMessage = "Reached out - no message specified";
      }
      setStatus("Saving to Notion database...", "loading");
      const payload = {
        profile,
        ask: "Add to Notion",
        options: {
          saveDraftToNotion: true,
          linkedinMessage,
          emailMessage
        }
      };
      const response = await fetch(`${BACKEND_URL}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(`Server error: ${errorData.detail || response.statusText}`);
      }
      const data = await response.json();
      console.log("Backend response:", data);
      const notionContent = document.getElementById("notionContent");
      const savedFields = data.notion?.savedFields || {};
      notionContent.innerHTML = `
      <p><strong>${savedFields.name || "Profile"}</strong> saved successfully!</p>
      <p>\u{1F4CD} ${savedFields.location || "Location not found"}</p>
      <p>\u{1F4BC} ${savedFields.role || "Role not found"} ${savedFields.currentCompany ? `at ${savedFields.currentCompany}` : ""}</p>
      ${data.notion?.url ? `<a href="${data.notion.url}" target="_blank" class="notion-link">\u{1F517} Open in Notion</a>` : ""}
    `;
      showSection("notionResult");
      setStatus("Successfully saved to Notion!", "success");
      setButtonLoading(buttonId, false, "Saved!");
      setTimeout(() => {
        const btn = document.getElementById(buttonId);
        btn.textContent = "Add Profile to Notion";
      }, 2e3);
      setTimeout(hideStatus, 4e3);
    } catch (error) {
      console.error("Add to Notion error:", error);
      setStatus(`Error: ${error}`, "error");
      setButtonLoading(buttonId, false);
    }
  }
  async function handleGenerateMessage(type) {
    const buttonId = type === "linkedin" ? "generateLinkedInDraftBtn" : "generateEmailDraftBtn";
    try {
      setButtonLoading(buttonId, true);
      setStatus("Extracting profile information...", "loading");
      const profile = await extractProfile();
      if (!profile.htmlContent) {
        throw new Error("Could not extract page content. Make sure you're on a LinkedIn profile page.");
      }
      const askTextarea = document.getElementById(type === "linkedin" ? "linkedinAsk" : "emailAsk");
      const ask = askTextarea.value.trim();
      if (!ask) {
        throw new Error("Please enter your request or select a quick option");
      }
      setStatus(`Generating ${type} message with AI...`, "loading");
      const payload = {
        profile,
        ask,
        options: {
          saveDraftToNotion: false,
          messageType: type
        }
      };
      const response = await fetch(`${BACKEND_URL}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(`Server error: ${errorData.detail || response.statusText}`);
      }
      const data = await response.json();
      console.log("Backend response:", data);
      if (!data.draft) {
        throw new Error("No draft generated. Make sure OpenAI is configured in your .env file.");
      }
      if (data.notion && data.notion.savedFields?.updated_with_message) {
        setStatus(`${type === "linkedin" ? "LinkedIn" : "Email"} message generated and Notion entry updated!`, "success");
      }
      const subjectSection = document.getElementById("subjectSection");
      const draftSubject = document.getElementById("draftSubject");
      const draftBody = document.getElementById("draftBody");
      if (type === "email" && data.draft.subject) {
        subjectSection.classList.remove("hidden");
        draftSubject.value = data.draft.subject;
      } else {
        subjectSection.classList.add("hidden");
      }
      draftBody.value = data.draft.body;
      showSection("draftResult");
      if (!(data.notion && data.notion.savedFields?.updated_with_message)) {
        setStatus(`${type === "linkedin" ? "LinkedIn" : "Email"} message generated successfully!`, "success");
      }
      setButtonLoading(buttonId, false, "Generated!");
      setTimeout(() => {
        const btn = document.getElementById(buttonId);
        btn.textContent = type === "linkedin" ? "Generate LinkedIn Draft" : "Generate Email Draft";
      }, 2e3);
      setTimeout(hideStatus, 4e3);
    } catch (error) {
      console.error("Generate message error:", error);
      setStatus(`Error: ${error}`, "error");
      setButtonLoading(buttonId, false);
    }
  }
  function copyDraft() {
    const subjectEl = document.getElementById("draftSubject");
    const bodyEl = document.getElementById("draftBody");
    let fullText = bodyEl.value;
    if (!document.getElementById("subjectSection").classList.contains("hidden")) {
      fullText = `Subject: ${subjectEl.value}

${bodyEl.value}`;
    }
    navigator.clipboard.writeText(fullText).then(() => {
      const btn = document.getElementById("copyBtn");
      const originalText = btn.textContent;
      btn.textContent = "Copied!";
      btn.style.background = "#059669";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = "#10b981";
      }, 2e3);
    }).catch(() => {
      setStatus("Failed to copy to clipboard", "error");
    });
  }
  function setupQuickOptions() {
    document.querySelectorAll(".quick-option").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.target;
        const ask = target.getAttribute("data-ask");
        const isLinkedin = target.closest("#linkedinMessageSection");
        const textarea = document.getElementById(isLinkedin ? "linkedinAsk" : "emailAsk");
        textarea.value = ask || "";
        target.style.background = "#e5e7eb";
        setTimeout(() => {
          target.style.background = "white";
        }, 200);
      });
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("addToNotionBtn")?.addEventListener("click", handleAddToNotion);
    document.getElementById("generateLinkedInBtn")?.addEventListener("click", () => {
      hideSection("messageTypeSection");
      hideSection("emailMessageSection");
      showSection("linkedinMessageSection");
    });
    document.getElementById("generateEmailBtn")?.addEventListener("click", () => {
      hideSection("messageTypeSection");
      hideSection("linkedinMessageSection");
      showSection("emailMessageSection");
    });
    document.getElementById("backFromLinkedInBtn")?.addEventListener("click", () => {
      hideSection("linkedinMessageSection");
      hideSection("emailMessageSection");
      showSection("messageTypeSection");
    });
    document.getElementById("backFromEmailBtn")?.addEventListener("click", () => {
      hideSection("linkedinMessageSection");
      hideSection("emailMessageSection");
      showSection("messageTypeSection");
    });
    document.getElementById("generateLinkedInDraftBtn")?.addEventListener("click", () => handleGenerateMessage("linkedin"));
    document.getElementById("generateEmailDraftBtn")?.addEventListener("click", () => handleGenerateMessage("email"));
    document.getElementById("copyBtn")?.addEventListener("click", copyDraft);
    setupQuickOptions();
  });
})();
//# sourceMappingURL=popup.js.map
